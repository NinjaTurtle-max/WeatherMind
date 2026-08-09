"""θ 임계의 학령 상대성 계약 — R13 CO-U-3.

θ는 절대 스케일이지만 응답이 적을 때는 사전분포로 수축하고, 그 사전평균은 가입 시
**신고한** level_group에서 온다. 그래서 θ에 절대 임계를 걸면 "무엇을 맞혔나"가 아니라
"가입할 때 무엇이라고 적었나"를 재게 되고, 실제로 판정이 의도와 반대로 뒤집혔다.

이 파일이 고정하는 것 넷:
  ① 상대 임계의 값(자기 밴드 경계 = 사전평균 ± 반폭)과 middle_high에서의 현행값 일치
  ② 판정의 학령 균일성 — 같은 (정답수, 응답수)면 네 밴드가 같은 판정
  ③ 사다리 단조성 — focus < weak < unlock
  ④ backend ↔ ai-worker router_chain 임계 드리프트

②·④는 **실제 EAP 추정기를 돌려** 확인한다(수치를 손으로 적으면 추정기가 바뀔 때
계약이 조용히 거짓이 된다 — CO-U-2가 정확히 그 실패였다: 함수 경계에서 참인 성질이
합성에서 거짓이었고 계약 테스트는 θ를 직접 주입해 통과했다).
"""

from __future__ import annotations

import ast
import asyncio
import importlib
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import ai_client
from app.services import curriculum_service as cs
from app.services import session_service
from app.services import weatherbrain_service as wb

REPO_ROOT = Path(__file__).resolve().parents[2]
AI_WORKER_DIR = REPO_ROOT / "ai-worker"
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _import_ai_worker(dotted: str):
    """ai-worker 모듈을 backend `app` 패키지와 충돌 없이 임포트
    (test_weatherbrain_contract._import_ai_worker_priors 관례 답습)."""
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module(dotted)
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


irt = _import_ai_worker("app.weatherbrain.irt")
priors = _import_ai_worker("app.weatherbrain.priors")
router_chain = _import_ai_worker("app.chains.router_chain")

BANDS = wb.LEVEL_GROUP_BANDS
# 가입 시 **신고 가능한** 학령 — expert는 파생 밴드라 신고 경로가 없다
# (schemas.auth.LevelGroup · placement_service.LEVEL_GROUPS).
DECLARABLE_BANDS = tuple(b for b in BANDS if b != "expert")


def _theta_after(level_group: str, correct: list[bool]) -> float:
    """학령 표준문항(사전 b)만 푼 학습자의 추정 θ — 오늘의 기본 출제 경로.

    풀 필터가 level_group이고 item_params가 비어 있어 밴드 내 b가 상수이므로,
    실제 파이프라인이 만드는 응답이 정확히 이 모양이다(CO-U-3 재현 조건).
    """
    prior_mean, prior_sd = priors.level_group_prior(level_group)
    b = priors.prior_item_b(level_group)
    responses = [(b, 1.0, ok) for ok in correct]
    return irt.estimate_ability(responses, prior_mean, prior_sd).theta


class TestThresholdValues:
    """① 값 — 자기 밴드 경계이고, middle_high에서는 현행 절대값과 같다."""

    def test_반폭은_경계_튜플에서_파생된다(self):
        assert wb.THETA_BAND_HALF_WIDTH == pytest.approx(0.5)
        assert wb.THETA_FOCUS_DELTA == -wb.THETA_BAND_HALF_WIDTH
        assert wb.THETA_UNLOCK_DELTA == wb.THETA_BAND_HALF_WIDTH

    @pytest.mark.parametrize("level_group", BANDS)
    def test_임계는_자기_밴드의_경계다(self, level_group):
        prior_mean = wb.band_prior_theta(level_group)
        assert wb.focus_theta_threshold(level_group) == pytest.approx(prior_mean - 0.5)
        assert wb.unlock_theta_threshold(level_group) == pytest.approx(prior_mean + 0.5)

    def test_middle_high는_현행_절대임계와_동일(self):
        """순수 확장 계약 — 중립 밴드의 판정은 한 건도 바뀌지 않는다."""
        assert wb.focus_theta_threshold("middle_high") == pytest.approx(
            router_chain.THETA_FOCUS_THRESHOLD
        )
        assert wb.unlock_theta_threshold("middle_high") == pytest.approx(
            wb._THETA_INTERMEDIATE_MAX
        )

    def test_미지_학령은_중립으로_폴백(self):
        assert wb.band_prior_theta("nope") == wb.DEFAULT_ITEM_B
        assert wb.focus_theta_threshold("nope") == pytest.approx(-0.5)
        assert wb.unlock_theta_threshold("nope") == pytest.approx(0.5)

    def test_사다리가_단조다(self):
        """③ focus < weak < unlock — "약점 아님"보다 "선해금"이 항상 엄격하다.

        순서가 뒤집히면 약점으로 분류된 개념의 유닛이 선해제되는 모순이 생긴다.
        """
        for level_group in BANDS:
            assert (
                wb.focus_theta_threshold(level_group)
                < wb.weak_theta_threshold(level_group)
                < wb.unlock_theta_threshold(level_group)
            )


class TestVerdictIsUniformAcrossBands:
    """② 학령 균일성 — 실제 EAP를 돌려 확인한다.

    이것이 CO-U-3의 본체다. 절대 임계에서는 아래 단정이 전부 거짓이었다
    (elementary는 1정답에도 focused, adult는 1오답에도 선해금).
    """

    @pytest.mark.parametrize("level_group", BANDS)
    def test_학령표준문항_1정답으로는_선해금되지_않는다(self, level_group):
        theta = _theta_after(level_group, [True])
        assert theta < wb.unlock_theta_threshold(level_group), (
            f"{level_group}: 1문항 근거로 유닛이 열린다 (θ={theta:.4f})"
        )

    @pytest.mark.parametrize("level_group", BANDS)
    def test_학령표준문항_2연속정답이면_선해금된다(self, level_group):
        theta = _theta_after(level_group, [True, True])
        assert theta >= wb.unlock_theta_threshold(level_group), (
            f"{level_group}: 2연속 정답인데 선해금이 영영 안 열린다 (θ={theta:.4f})"
        )

    @pytest.mark.parametrize("level_group", BANDS)
    def test_반타작은_선해금되지_않는다(self, level_group):
        theta = _theta_after(level_group, [True, False])
        assert theta < wb.unlock_theta_threshold(level_group)

    @pytest.mark.parametrize("level_group", BANDS)
    def test_1오답으로는_focused가_되지_않는다(self, level_group):
        theta = _theta_after(level_group, [False])
        assert theta >= wb.focus_theta_threshold(level_group), (
            f"{level_group}: 1오답에 보강 집중으로 떨어진다 (θ={theta:.4f})"
        )

    @pytest.mark.parametrize("level_group", BANDS)
    def test_2연속오답이면_focused다(self, level_group):
        theta = _theta_after(level_group, [False, False])
        assert theta < wb.focus_theta_threshold(level_group), (
            f"{level_group}: 2연속 오답인데 보강이 안 걸린다 (θ={theta:.4f})"
        )

    def test_신고_가능한_세_학령의_판정이_전건_같다(self):
        """(정답수, 응답수) 격자 20칸 전건에서 세 밴드의 두 판정이 일치해야 한다.

        범위를 **신고 가능한 학령**(placement_service.LEVEL_GROUPS 3종)으로 두는
        이유는 U-3이 "가입할 때 적은 값이 판정을 가른다"는 결함이기 때문이다.
        expert는 신고 경로가 없는 파생 밴드이고, EAP 격자 상한에 눌려 같은 응답의
        이동폭이 작다(U-8) — 그 편차는 아래 테스트가 따로 기록한다.
        """
        grid = [(k, n) for n in range(1, 6) for k in range(0, n + 1)]
        for k, n in grid:
            pattern = [True] * k + [False] * (n - k)
            verdicts = set()
            for level_group in DECLARABLE_BANDS:
                theta = _theta_after(level_group, pattern)
                verdicts.add(
                    (
                        theta < wb.focus_theta_threshold(level_group),
                        theta >= wb.unlock_theta_threshold(level_group),
                    )
                )
            assert len(verdicts) == 1, f"k={k}/n={n}에서 학령별 판정이 갈린다: {verdicts}"

    def test_expert_밴드의_잔여_편차를_기록한다(self):
        """열린 채로 남는 것 — CO-U-8의 재확인이지 이 수리의 범위가 아니다.

        expert 밴드는 EAP 격자 상한(4.0)에 붙어 같은 응답의 θ 이동폭이 작다. 그래서
        임계 바로 옆 칸에서만 세 학령과 갈린다. 20칸 중 **정확히 두 칸**이다:

          k/n = 1/1  약점 판정 — expert만 rel +0.3362 < logit(0.6) +0.40547 → 약점
                     (나머지 셋은 +0.4068~+0.4135. 마진 0.0013~0.0081의 칼날이라
                      격자·사전 sd가 바뀌면 셋도 함께 넘어간다)
          k/n = 3/4  선해금 판정 — expert만 rel +0.4925 < +0.5 → 선해금 안 됨
                     (나머지 셋은 +0.5318~+0.5335)

        weak 임계(logit 0.6)는 R8-01 §3.5 계약이고 격자 범위는 ai-worker irt 소유라
        이 수리에서 건드리지 않았다. 이 테스트는 상태를 **기록으로 고정**한다 —
        U-8을 고치면 여기가 깨져서 알게 된다.
        """
        assert _theta_after("expert", [True]) < wb.weak_theta_threshold("expert")
        for level_group in DECLARABLE_BANDS:
            assert _theta_after(level_group, [True]) >= wb.weak_theta_threshold(
                level_group
            )

        pattern = [True] * 3 + [False]
        assert _theta_after("expert", pattern) < wb.unlock_theta_threshold("expert")
        for level_group in DECLARABLE_BANDS:
            assert _theta_after(level_group, pattern) >= wb.unlock_theta_threshold(
                level_group
            )

    def test_절대임계였다면_판정이_갈렸다(self):
        """반증 대조 — 이 테스트가 깨지면 U-3이 애초에 없었다는 뜻이다.

        고치기 전 실제 동작을 고정한다: 절대 임계 −0.5/+0.5에서는 elementary가
        1정답에도 focused이고 adult는 1오답에도 선해금이었다.
        """
        assert _theta_after("elementary", [True]) < -0.5
        assert _theta_after("adult", [False]) >= 0.5
        assert _theta_after("middle_high", [True]) < 0.5


class TestRouterChainParity:
    """④ backend ↔ ai-worker 드리프트 (상수 이원화 관례)."""

    @pytest.mark.parametrize("level_group", BANDS)
    def test_임계값이_두_서비스에서_같다(self, level_group):
        assert router_chain.focus_theta_threshold(level_group) == pytest.approx(
            wb.focus_theta_threshold(level_group)
        )

    def test_level_group_None이면_종전_절대임계로_폴백(self):
        """하위호환 — 호출측이 학령을 아직 안 넘기는 동안 동작이 변하지 않는다."""
        assert router_chain.focus_theta_threshold(None) == pytest.approx(
            router_chain.THETA_FOCUS_THRESHOLD
        )

    def test_route가_학령을_받으면_판정이_뒤집힌다(self):
        """elementary 학습자가 학령 표준문항을 1개 맞힌 상황."""
        theta = _theta_after("elementary", [True])
        abilities = [{"concept_tag": "typhoon", "theta": theta, "se": 0.9, "n": 1}]

        legacy = router_chain.route([], [], abilities)
        assert legacy["route"] == "focused"  # 절대 임계 — 맞혀도 보강 대상

        fixed = router_chain.route([], [], abilities, level_group="elementary")
        assert fixed["route"] == "general"


# ══════════════════════════════════════════════════════════════════════════
# ⑤ 배선 — CO-V-1·V-2 (2026-08-08)
#
# ①~④는 **함수 경계**의 성질이다. CO-U-3이 남긴 진짜 결함은 그 함수를 아무도
# 부르지 않는 것이었고(CO-I "만들어 두고 안 쓰는 것"), CLAUDE.md가 적은 교훈이
# 정확히 이 자리다 — *"함수 경계에서 참인 성질이 합성에서 거짓"*. 그래서 아래는
# 값이 아니라 **호출부가 값을 넘기는지**를 단정한다.
# ══════════════════════════════════════════════════════════════════════════


class _EmptyResult:
    def scalars(self):
        return self

    def all(self):
        return []


class _EmptyDB:
    """decide_route가 최근 정오답만 조회하는 최소 대역 DB (weak_tag_rows·abilities 주입)."""

    async def execute(self, *_args, **_kwargs):
        return _EmptyResult()


class TestRouterWiring:
    """CO-V-1 — session_service → ai_client → ai-worker 3홉이 학령을 실제로 나른다."""

    def test_홉1_decide_route가_유저_학령을_넘긴다(self, monkeypatch):
        captured: dict = {}

        async def fake_router_decide(
            user_id, weak_tags, recent_results, abilities, level_group=None
        ):
            captured["level_group"] = level_group
            return {"route": "general", "target_concept_tag": None}

        monkeypatch.setattr(ai_client, "router_decide", fake_router_decide)
        user = SimpleNamespace(id=uuid.uuid4(), level_group="elementary")
        asyncio.run(
            session_service.decide_route(_EmptyDB(), user, [], abilities=[])
        )
        assert captured["level_group"] == "elementary"

    def test_홉2_ai_client_payload에_실린다(self, monkeypatch):
        captured: dict = {}

        async def fake_post(path, payload, timeout=60.0):
            captured["payload"] = payload
            return {"route": "general", "target_concept_tag": None}

        monkeypatch.setattr(ai_client, "_post", fake_post)
        asyncio.run(ai_client.router_decide("u1", [], [], [], level_group="adult"))
        assert captured["payload"]["level_group"] == "adult"

    def test_홉2_미전달은_None으로_나가_종전_동작(self, monkeypatch):
        """레거시 호출부(routers/quiz.py 계열) 하위 호환 — None이면 절대 임계 폴백."""
        captured: dict = {}

        async def fake_post(path, payload, timeout=60.0):
            captured["payload"] = payload
            return {"route": "general", "target_concept_tag": None}

        monkeypatch.setattr(ai_client, "_post", fake_post)
        asyncio.run(ai_client.router_decide("u1", [], [], []))
        assert captured["payload"]["level_group"] is None

    def test_홉3_ai_worker가_받아서_route에_넘긴다(self):
        """ai-worker/main.py를 **소스로** 대조한다.

        임포트하면 langchain 설치 여부에 판정이 갈린다(CLAUDE.md: 미설치 시 조용히
        skip). 파이썬 밖·프로세스 밖 파일을 파싱해 대조하는 계약 테스트는
        test_ci_workflow_contract·test_prompt_spec_parity의 선례다.
        """
        tree = ast.parse((AI_WORKER_DIR / "app" / "main.py").read_text("utf-8"))

        request_model = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.ClassDef) and n.name == "RouterDecideRequest"
        )
        fields = {
            n.target.id
            for n in request_model.body
            if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)
        }
        assert "level_group" in fields, "RouterDecideRequest가 학령을 받지 않는다"

        endpoint = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "router_decide"
        )
        route_call = next(
            n
            for n in ast.walk(endpoint)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute)
            and n.func.attr == "route"
        )
        passed = {
            kw.arg: ast.unparse(kw.value)
            for kw in route_call.keywords
            if kw.arg is not None
        }
        assert passed.get("level_group") == "body.level_group", (
            "엔드포인트가 router_chain.route에 학령을 넘기지 않는다"
        )


class TestUnlockWiring:
    """CO-V-2 — 선해금 임계가 학령을 받고, 호출부 전건이 유저 학령을 넘긴다."""

    def test_임계함수를_본다_절대상수가_아니라(self):
        """placement_unlock_floor가 학령에 따라 실제로 다른 답을 낸다."""
        units = [
            SimpleNamespace(
                section="하늘 읽기", unit_order=1, concept_tag="typhoon"
            )
        ]
        abilities = [{"concept_tag": "typhoon", "theta": 0.9, "se": 0.4, "n": 2}]
        assert cs.placement_unlock_floor(abilities, units, "middle_high") == 1
        # adult 밴드 임계는 1.5 — 같은 θ 0.9로는 열리지 않는다
        assert cs.placement_unlock_floor(abilities, units, "adult") == 0

    @pytest.mark.parametrize("level_group", BANDS)
    def test_실추정_θ로_2연속정답이면_세_학령_모두_열린다(self, level_group):
        """②의 성질이 **선해금 함수를 통과해서도** 참인지 — 합성 검증."""
        units = [
            SimpleNamespace(
                section="하늘 읽기", unit_order=1, concept_tag="typhoon"
            )
        ]

        def _floor(correct):
            theta = _theta_after(level_group, correct)
            abilities = [
                {
                    "concept_tag": "typhoon",
                    "theta": theta,
                    "se": 0.9,
                    "n": len(correct),
                }
            ]
            return cs.placement_unlock_floor(abilities, units, level_group)

        assert _floor([True]) == 0, f"{level_group}: 1문항으로 유닛이 열린다"
        assert _floor([True, True]) == 1, f"{level_group}: 2연속 정답인데 안 열린다"

    def test_호출부_전건이_유저_학령을_넘긴다(self):
        """소스 대조 — 한 곳이라도 상수·누락이면 CO-L4형 어긋남이 되살아난다.

        필수 위치인자라 런타임 TypeError로도 잡히지만, 그건 그 경로가 **실행될 때**
        뿐이다. 여기서는 넘기는 **값이 유저 학령인지**까지 본다(고정 문자열을
        박아 넣어 조용히 종전 동작으로 되돌리는 것이 CO-U-3의 발생 경로였다).
        """
        expected = {
            "placement_unlock_floor": 3,  # (abilities, units, level_group)
            "active_course_units": 4,  # (units, progress, abilities, level_group)
        }
        allowed = {"user.level_group", "level_group"}
        seen = 0
        for rel in (
            "app/services/curriculum_service.py",
            "app/routers/dev.py",
        ):
            src = (BACKEND_ROOT / rel).read_text("utf-8")
            tree = ast.parse(src)
            defs = {
                n.name
                for n in ast.walk(tree)
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            }
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = (
                    node.func.id
                    if isinstance(node.func, ast.Name)
                    else node.func.attr
                    if isinstance(node.func, ast.Attribute)
                    else None
                )
                if name not in expected:
                    continue
                arity = expected[name]
                assert len(node.args) == arity, (
                    f"{rel}:{node.lineno} {name} 호출이 학령을 안 넘긴다"
                )
                actual = ast.unparse(node.args[arity - 1])
                assert actual in allowed, (
                    f"{rel}:{node.lineno} {name}의 학령 인자가 {actual!r}"
                )
                seen += 1
            # 정의부가 있는 파일이면 그 시그니처도 확인
            for name, arity in expected.items():
                if name in defs:
                    fn = next(
                        n
                        for n in ast.walk(tree)
                        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                        and n.name == name
                    )
                    assert len(fn.args.args) == arity
                    assert fn.args.args[arity - 1].arg == "level_group"
                    assert not fn.args.defaults, (
                        f"{name}에 기본값이 생기면 호출부 누락이 조용해진다"
                    )
        # placement_unlock_floor 6곳(active_course_units 내부 2 · get_curriculum ·
        # is_unit_locked · find_crown_unit · dev.build_state) + active_course_units
        # 2곳(get_spine · progress_block_pool). ⚠️ 인계 문서는 "호출 4곳"이라
        # 적었는데 CO-L1·CO-L4 수리가 그 뒤에 2곳을 더 만들었다 — 그 둘을 절대
        # 임계로 남기면 "트리엔 열렸는데 POST는 403"이 되살아난다.
        assert seen == 8, f"호출부 8곳을 기대했는데 {seen}곳을 봤다 (드리프트)"
