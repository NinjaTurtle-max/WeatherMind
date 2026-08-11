"""WeatherBrain θ 파이프라인 계약 — R13 CO-U-1·U-2·U-4 · CO-E-1·E-2. DB 불필요.

`test_weatherbrain_contract`가 **상수·함수 경계**를 지킨다면 이 파일은 **합성**을
지킨다. 검수 9(CARRYOVER §U)가 찾아낸 결함의 성격이 정확히 그것이었다 —
`test_weak_concepts_학령_상대적`은 θ를 직접 주입해 통과하는데, 그 θ를 만드는
파이프라인은 학령 상대성이 항등적으로 상쇄된 값만 만들어냈다. 함수 경계에서 참인
성질이 합성에서 거짓이었다.

그래서 여기서는 **quiz_logs 유사 입력 → 응답 조립 → EAP 추정 → weak 판정**을
끝까지 통과시킨다. HTTP는 쓰지 않는다(ai-worker 수학 모듈을 직접 임포트 —
test_weatherbrain_contract의 priors 임포트 관례를 그대로 답습).

실행: backend에서 `python -m pytest tests/test_weatherbrain_theta_pipeline.py -q`.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import placement_service as ps
from app.services import weatherbrain_service as wb

AI_WORKER_DIR = Path(__file__).resolve().parents[2] / "ai-worker"


def _import_ai_worker(module_name: str):
    """ai-worker 모듈을 backend `app` 패키지와 충돌 없이 임포트
    (test_weatherbrain_contract._import_ai_worker_priors 관례 답습)."""
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module(module_name)
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


irt = _import_ai_worker("app.weatherbrain.irt")
priors = _import_ai_worker("app.weatherbrain.priors")


def _log(concept="typhoon", item_id=None, correct=True):
    """quiz_logs 행 대역 — 조립기가 읽는 속성 3개만 갖는다."""
    return SimpleNamespace(
        concept_tag=concept, content_item_id=item_id, is_correct=correct
    )


def _estimate(responses, level_group):
    """조립 결과 한 개념분을 ai-worker와 동일한 경로로 EAP 추정한다.

    main.weatherbrain_estimate가 하는 일과 같다(b가 채워져 있으므로 prior_b
    폴백은 타지 않는다 — 그 폴백이 CO-U-1의 결함이었다)."""
    mean, sd = priors.level_group_prior(level_group)
    resp = [(r["b"], r["a"], r["correct"]) for r in responses]
    return irt.estimate_ability(resp, prior_mean=mean, prior_sd=sd).theta


# ═══════════════════════════════════════════════════════════════
# CO-U-1 — 조립기가 **문항의** 사전 b를 쓴다
# ═══════════════════════════════════════════════════════════════
class TestAssembleUsesItemDifficulty:
    def test_미보정_문항은_문항_사전_b(self):
        """유저가 adult여도 elementary 문항의 b는 −1.0이다(신고 그룹 무관)."""
        item = uuid.uuid4()
        out = wb.assemble_responses(
            [_log(item_id=item, correct=True)],
            {},
            {item: "elementary"},
            "adult",
        )
        assert out["typhoon"] == [{"b": -1.0, "a": 1.0, "correct": True}]

    def test_보정값이_사전_b보다_우선(self):
        item = uuid.uuid4()
        out = wb.assemble_responses(
            [_log(item_id=item, correct=False)], {item: 2.75}, {item: "elementary"}, "adult"
        )
        assert out["typhoon"][0]["b"] == pytest.approx(2.75)

    def test_문항을_모르면_신고_그룹_폴백(self):
        """content_item_id NULL(생성 문항 등)일 때만 유저 신고 그룹으로 떨어진다."""
        out = wb.assemble_responses([_log(item_id=None)], {}, {}, "adult")
        assert out["typhoon"][0]["b"] == wb.LEVEL_GROUP_ITEM_B["adult"]

    def test_미지_밴드는_DEFAULT_ITEM_B(self):
        item = uuid.uuid4()
        out = wb.assemble_responses([_log(item_id=item)], {}, {item: "화성인"}, "adult")
        assert out["typhoon"][0]["b"] == wb.DEFAULT_ITEM_B

    def test_미채점_로그는_표본이_아니다(self):
        assert wb.assemble_responses([_log(correct=None)], {}, {}, "adult") == {}


# ═══════════════════════════════════════════════════════════════
# CO-U-4 — placement와 refresh가 같은 응답에 같은 b를 쓴다
# ═══════════════════════════════════════════════════════════════
class TestAssembleParityWithPlacement:
    """배치가 만든 θ를 첫 세션 발급이 덮어쓰지 않는다는 계약.

    두 조립기가 같은 입력에 같은 출력을 내면 두 경로의 EAP 입력이 같고, 사전분포도
    같은 level_group에서 나오므로 θ가 일치한다(ai-worker placement/estimate 모두
    estimate_ability 하나를 쓴다). placement_service는 **읽기만** 한다.
    """

    @staticmethod
    def _fixture():
        calibrated_item, prior_item, unknown_item = (uuid.uuid4() for _ in range(3))
        logs = [
            _log("typhoon", calibrated_item, True),
            _log("typhoon", prior_item, False),
            _log("air_mass", unknown_item, True),
            _log("air_mass", None, False),          # 생성 문항 — 문항 미상
            _log("anomaly", prior_item, None),      # 미채점
        ]
        calibrated = {calibrated_item: 1.25}
        groups = {prior_item: "expert", unknown_item: "elementary"}
        return logs, calibrated, groups

    @pytest.mark.parametrize("declared", ["elementary", "middle_high", "adult"])
    def test_두_조립기가_동일한_b_리스트(self, declared):
        logs, calibrated, groups = self._fixture()
        mine = wb.assemble_responses(logs, calibrated, groups, declared)
        theirs = ps.assemble_placement_responses(logs, calibrated, groups, declared)
        assert mine == theirs

    @pytest.mark.parametrize("declared", ["elementary", "middle_high", "adult"])
    def test_동일_응답에서_θ가_일치(self, declared):
        """CO-U-4 회귀: 배치 −0.718 → refresh −1.000으로 덮이던 자리."""
        logs, calibrated, groups = self._fixture()
        mine = wb.assemble_responses(logs, calibrated, groups, declared)
        theirs = ps.assemble_placement_responses(logs, calibrated, groups, declared)
        for tag in mine:
            assert _estimate(mine[tag], declared) == pytest.approx(
                _estimate(theirs[tag], declared)
            )


# ═══════════════════════════════════════════════════════════════
# CO-U-2 — 학령 상대성이 **파이프라인 입력**에서 살아 있다
# ═══════════════════════════════════════════════════════════════
class TestWeakVerdictIsLevelRelativeEndToEnd:
    """`test_weak_concepts_학령_상대적`(θ 직접 주입)의 합성 버전.

    같은 문항·같은 정오답 패턴을 세 학령에 먹여 판정이 갈리는지 본다. 갈리지
    않으면 약점 판정은 "정답률 < 60%"와 등가로 축소된 것이다(CO-U-2).
    """

    GROUPS = ("elementary", "middle_high", "adult")

    @staticmethod
    def _verdict(item_band, n, k, level_group):
        item = uuid.uuid4()
        logs = [_log("typhoon", item, i < k) for i in range(n)]
        responses = wb.assemble_responses(logs, {}, {item: item_band}, level_group)
        theta = _estimate(responses["typhoon"], level_group)
        abilities = [{"concept_tag": "typhoon", "theta": theta, "se": 0.4, "n": n}]
        return theta, wb.weak_concepts(abilities, level_group)

    def test_중고_문항_3문항_2정답은_초등만_통과(self):
        """실측: θ −0.302 / +0.302 / +0.923, 임계 −0.595 / +0.405 / +1.405."""
        verdicts = {g: self._verdict("middle_high", 3, 2, g) for g in self.GROUPS}
        assert verdicts["elementary"][1] == []
        assert verdicts["middle_high"][1] == ["typhoon"]
        assert verdicts["adult"][1] == ["typhoon"]

    def test_성인_문항_3문항_2정답은_성인만_약점(self):
        """같은 정답률(66.7%)·더 어려운 문항 → 갈리는 쌍이 반대로 뒤집힌다.

        실측: θ +0.077 / +0.698 / +1.301. 두 테스트를 합치면 세 학령이 서로
        **모두** 구별된다(초등≠중고는 여기, 중고≠성인은 위 테스트).
        """
        verdicts = {g: self._verdict("adult", 3, 2, g) for g in self.GROUPS}
        assert verdicts["elementary"][1] == []
        assert verdicts["middle_high"][1] == []
        assert verdicts["adult"][1] == ["typhoon"]

    def test_구_조립_규칙이었다면_세_학령이_동일했다(self):
        """대조군 — b를 **유저** 사전 b로 채우면(CO-U-1 이전) 판정이 상쇄된다.

        이 테스트가 깨진다면 상쇄가 되살아난 것이 아니라 대조군 계산이 틀린
        것이다. 위 두 테스트와 짝으로 읽어야 의미가 있다(수리 전/후 대조).
        """
        outcomes = set()
        for group in self.GROUPS:
            user_b = wb.LEVEL_GROUP_ITEM_B[group]
            responses = [{"b": user_b, "a": 1.0, "correct": i < 2} for i in range(3)]
            theta = _estimate(responses, group)
            abilities = [{"concept_tag": "typhoon", "theta": theta, "se": 0.4, "n": 3}]
            outcomes.add(tuple(wb.weak_concepts(abilities, group)))
        assert outcomes == {("typhoon",)}


# ═══════════════════════════════════════════════════════════════
# CO-E-2 — 2축 파생 뷰가 실제 런타임 경로에 배선됐다
# ═══════════════════════════════════════════════════════════════
class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeDB:
    """execute를 해석하지 않는 FakeDB — 준비된 행을 그대로 돌려준다."""

    def __init__(self, rows):
        self._rows = rows

    async def execute(self, stmt):
        return _FakeResult(self._rows)


class TestEffectiveLevelGroupIsWired:
    def test_knowledge_level이_있으면_새_축에서_파생(self):
        """저장 level_group='adult' + knowledge_level=4 → 실효 밴드 middle_high.

        `effective_level_group`의 첫 프로덕션 호출자(CO-E-2). 이 경로가 끊기면
        2축 값을 잘못 넣어도 서빙이 한 글자도 안 바뀌는 상태로 되돌아간다.
        """
        item = uuid.uuid4()
        rows = [SimpleNamespace(id=item, level_group="adult", knowledge_level=4)]
        got = asyncio.run(wb._load_item_level_groups(_FakeDB(rows), {item}))
        assert got == {item: "middle_high"}

    def test_미분류_문항은_저장_level_group_그대로(self):
        item = uuid.uuid4()
        rows = [SimpleNamespace(id=item, level_group="adult", knowledge_level=None)]
        got = asyncio.run(wb._load_item_level_groups(_FakeDB(rows), {item}))
        assert got == {item: "adult"}

    def test_빈_집합은_질의하지_않는다(self):
        assert asyncio.run(wb._load_item_level_groups(None, set())) == {}


# ═══════════════════════════════════════════════════════════════
# CO-E-1 — θ → 지식 수준(N단계) 매핑
# ═══════════════════════════════════════════════════════════════
class TestThetaToKnowledgeLevel:
    def test_경계_개수가_단계_수와_정합(self):
        assert len(wb.THETA_KNOWLEDGE_LEVEL_BOUNDS) == len(wb.KNOWLEDGE_LEVEL_BANDS) - 1

    def test_경계가_오름차순(self):
        bounds = wb.THETA_KNOWLEDGE_LEVEL_BOUNDS
        assert list(bounds) == sorted(bounds)
        assert len(set(bounds)) == len(bounds)

    def test_현재_표의_경계값(self):
        """10단계 표(1·2 초등 · 3·4 중학 · 5·6 고교 · 7~10 전문)의 파생 결과.

        6 → 10 확장(2026-08-10)으로 경계가 5개에서 9개가 됐다. **앞의 네 값은
        그대로**다 — 하단 1~4를 안 건드렸기 때문이고, 그것이 이 확장이 기존
        학습자의 서빙을 안 흔든다는 증거다. 늘어난 것은 0.5 위쪽뿐이다.
        """
        assert wb.THETA_KNOWLEDGE_LEVEL_BOUNDS == (
            -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 1.75, 2.0, 2.25
        )
        assert len(wb.THETA_KNOWLEDGE_LEVEL_BOUNDS) == wb.KNOWLEDGE_LEVEL_MAX - 1

    def test_기존_4밴드_경계를_부분집합으로_포함(self):
        """THETA_BAND_BOUNDS를 바꾸지 않고 **더 잘게** 나눈 것임을 고정."""
        assert set(wb.THETA_BAND_BOUNDS) <= set(wb.THETA_KNOWLEDGE_LEVEL_BOUNDS)

    @pytest.mark.parametrize(
        "theta,level",
        [
            # 하단 절반은 6단계 시절과 **한 칸도 안 바뀌었다**(경계 −1.0·−0.5·0.0·0.5).
            (-9.0, 1), (-1.01, 1), (-1.0, 2), (-0.51, 2),
            (-0.5, 3), (-0.01, 3), (0.0, 4), (0.49, 4),
            # 여기부터가 10단계 확장분 — 종전에는 0.5 이상이 전부 5·6 두 칸이었다.
            (0.5, 5), (0.99, 5), (1.0, 6), (1.49, 6),
            (1.5, 7), (1.74, 7), (1.75, 8), (1.99, 8),
            (2.0, 9), (2.24, 9), (2.25, 10), (9.0, 10),
        ],
    )
    def test_구간(self, theta, level):
        assert wb.theta_to_knowledge_level(theta) == level

    def test_치역이_단계_범위_안(self):
        for i in range(-600, 601):
            level = wb.theta_to_knowledge_level(i / 100.0)
            assert wb.KNOWLEDGE_LEVEL_MIN <= level <= wb.KNOWLEDGE_LEVEL_MAX

    def test_단조증가(self):
        prev = wb.KNOWLEDGE_LEVEL_MIN
        for i in range(-600, 601):
            level = wb.theta_to_knowledge_level(i / 100.0)
            assert level >= prev
            prev = level

    def test_4밴드로_접으면_기존_매핑과_동일(self):
        """E-1의 정합 조건 — 6단계 소비자와 4밴드 소비자가 같은 난이도를 본다.

        경계값 정확히 위(−0.5·0.5·1.5)를 포함해 전 구간을 훑는다. 한쪽 경계만
        움직이면 여기서 깨진다.
        """
        for i in range(-600, 601):
            theta = i / 100.0
            folded = wb.level_group_of_knowledge_level(
                wb.theta_to_knowledge_level(theta)
            )
            assert folded == wb.theta_to_level_group(theta), theta

    def test_ai_worker_역매핑과도_정합(self):
        """교차 서비스 — 접은 결과가 priors.theta_to_target_level_group과 같다."""
        for i in range(-600, 601):
            theta = i / 100.0
            folded = wb.level_group_of_knowledge_level(
                wb.theta_to_knowledge_level(theta)
            )
            assert folded == priors.theta_to_target_level_group(theta), theta
