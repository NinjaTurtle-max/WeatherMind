"""목↔서버 **정책** 실값 대조 (R13 CO-J-9 / CO-A6 — 2026-08-08).

`test_r10_mock_parity_contract.py`가 "목이 내보내는 **페이로드**"를 대조한다면,
이 파일은 "목이 그 페이로드를 만들 때 쓰는 **정책·상수**"를 대조한다.

감사 실측(CO-J-9): 목 패리티가 4도메인 중 **배합 하나만** 보고 있었고
- **에너지 상수 3종**은 목이 하드코딩 리터럴로 복사한 채 대조가 **0**이었다.
  서버 `Settings.CLOUD_*`를 env로 조정하면 목은 조용히 옛 값으로 남는다.
- **왕관은 이미 행위가 갈라져 있었다**: 서버는 유닛 세션에 `grant_crown=False`
  (§2.10 소유권 이전)인데 목은 왕관을 줬고, 판정 범위도 서버는 진도 블록
  5문항인데 목은 15문항 전건이었다(CO-A6). 목 위 스모크는 전부 초록이었다.

방법은 R10 계약과 같다 — 목이 `__mockPolicy()`로 노출하는 **실값**을 node로 읽어
서버 실값과 비교한다. **여기에 기대값 사본을 쓰지 않는다**: 사본을 두면 계약이
자기 자신을 대조하게 되고, 그것이 애초에 J-9가 생긴 방식이다.

node가 없는 환경에서는 실값 대조가 skip되므로, python만으로 도는 **소스 계약**을
함께 둔다(목이 정책을 노출하는가 · 서버 코드가 그 정책대로 쓰여 있는가).
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app.core.config import settings
from app.schemas.auth import LevelGroup
from app.services import session_service

REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"
SESSION_ROUTER = REPO_ROOT / "backend" / "app" / "routers" / "session.py"

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(
    NODE is None, reason="node 미설치 — 목 실값 대조 불가 (소스 계약은 계속 돈다)"
)


@pytest.fixture(scope="module")
def policy() -> dict:
    """목 모듈을 node로 import해 정책 실값을 읽는다 (읽기 전용)."""
    if NODE is None:  # pragma: no cover - skip 마커가 먼저 걸린다
        pytest.skip("node 미설치")
    code = (
        f"const m = await import({str(MOCK_PATH.as_uri())!r});"
        "process.stdout.write(JSON.stringify(m.__mockPolicy()));"
    )
    proc = subprocess.run(
        [NODE, "--input-type=module", "-e", code],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=MOCK_PATH.parent,
    )
    assert proc.returncode == 0, (
        "목 모듈 import 실패 — __mockPolicy export가 사라졌거나 목이 깨졌다:\n"
        f"{proc.stderr[-2000:]}"
    )
    return json.loads(proc.stdout)


@pytest.fixture(scope="module")
def session_src() -> str:
    return SESSION_ROUTER.read_text(encoding="utf-8")


@needs_node
class TestEnergyConstants:
    """구름 에너지 3종 — 목이 리터럴로 복사하던 자리(CO-J-9)."""

    def test_최대치가_같다(self, policy):
        assert policy["cloud_max"] == settings.CLOUD_MAX

    def test_회복_주기가_같다(self, policy):
        assert policy["cloud_regen_minutes"] == settings.CLOUD_REGEN_MINUTES

    def test_소모량이_같다(self, policy):
        assert policy["cloud_cost"] == settings.CLOUD_COST


def server_block_order() -> list[str]:
    """서버의 **출제 순서를 실행으로 캐낸다** — 소스에 적힌 문장이 아니라 실동작.

    `plan_bank_picks`는 배합 dict의 키 순서가 아니라 **블록 호출 순서**로 픽을
    쌓는다(그 함수의 독스트링이 소유자를 그렇게 못박는다). 그래서 기대값을 여기
    사본으로 적지 않고, 블록마다 자기 풀만으로 배합을 채울 수 있게 넉넉히 준 뒤
    나온 kind 나열에서 순서를 읽는다 — 사본을 두면 이 계약이 자기 자신을 대조하게
    되고, 그것이 애초에 CO-J-9가 생긴 방식이다.
    """
    recipe = settings.SESSION_RECIPE

    def pool(kind: str, question_type: str = "multiple_choice") -> list[dict]:
        return [
            {"id": f"{kind}-{i}", "question_type": question_type}
            for i in range(recipe.get(kind, 0))
        ]

    picks, missing = session_service.plan_bank_picks(
        pool("new"),
        pool("review"),
        pool("live"),
        unit_pool=pool("unit"),
        board_pool=pool("board", "board"),
    )
    assert missing == 0, f"블록마다 풀을 다 줬는데 배합이 {missing}건 비었다"
    order: list[str] = []
    for pick in picks:
        if not order or order[-1] != pick["kind"]:
            order.append(pick["kind"])
    assert len(order) == len(set(order)), (
        f"한 블록이 두 번 끊겨 나왔다({order}) — 풀 구성이 부족분 대체를 탔다"
    )
    return order


@needs_node
class TestSessionRecipe:
    def test_배합이_같다(self, policy):
        assert policy["session_recipe"] == settings.SESSION_RECIPE

    def test_출제_순서가_같다(self, policy):
        """**목이 서버와 같은 순서로 문항을 내보내는가** (2026-08-13 신설).

        목은 `new → review → live → board`, 서버는 `live → new → review → board`로
        조용히 갈려 있었다. 하루 첫 유닛 세션이 데일리 화면을 공유하게 되면서
        이 갭은 단순한 목 결함이 아니라 **눈으로 하는 검증을 무효화하는 자리**가
        됐다 — 화면에서 본 순서가 진짜 결함인지 목 인공물인지 구분되지 않는다.

        서버 쪽 기대값은 `plan_bank_picks`를 **실행해서** 얻는다(위 헬퍼).
        """
        assert policy["block_order"] == server_block_order()

    def test_순서에_배합의_전_블록이_들어_있다(self, policy):
        """배합에 자리가 있는데 순서 목록에 없으면 그 블록은 **영영 안 나간다**."""
        wanted = {k for k, v in settings.SESSION_RECIPE.items() if v}
        assert set(policy["block_order"]) >= wanted, (
            f"목 출제 순서에 {sorted(wanted - set(policy['block_order']))} 블록이 없다"
        )

    def test_board_상한이_같다(self, policy):
        """CO-H5 — 목 뱅크에 board가 늘어도 서버와 같은 상한을 쓴다.

        지금 목 뱅크는 board가 소수라 상한에 닿지 않는다. 그래서 더 중요하다 —
        **발현하지 않는 정책은 갈려도 아무도 모른다.** 에너지 상수를 목이 리터럴로
        복사한 채 대조가 0이던 CO-J-9가 정확히 그렇게 생겼다.
        """
        assert policy["daily_board_cap"] == settings.DAILY_BOARD_CAP

    def test_두_번째_이후_유닛_세션_크기가_같다(self, policy):
        """**첫 세션은 배합 총합(10), 두 번째 이후가 이 값**(2026-08-13 확정).

        종전 목은 이 자리에 하드코딩 `3`을 갖고 서버(4)와 조용히 갈려 있었다 —
        대조가 0인 정책이 리터럴로 복사돼 있는 CO-J-9와 똑같은 모양이다.
        """
        assert policy["unit_session_size"] == settings.UNIT_SESSION_SIZE

    def test_배치고사_문항_수가_같다(self, policy):
        """온보딩 배치고사 크기 — 서버 `Settings.PLACEMENT_SIZE`(2026-08-13 신설).

        이 브랜치가 `PLACEMENT_SIZE`를 **6 → 10**으로 올렸다
        (`target_level_sequence`가 지식 단계 1~10을 한 번씩 겨냥하려면 슬롯이
        10칸이어야 한다). 목의 `PLACEMENT_ITEMS`는 `CONCEPT_TAGS`(6종)에서
        만들어져 **6문항에 멈춰 있었고**, `__mockPolicy()`가 이 크기를 노출하지
        않아 **패리티가 원리적으로 못 봤다** — 에너지 상수 3종이 리터럴 사본인
        채 대조가 0이던 CO-J-9와 정확히 같은 모양이다.

        ⚠️ 목이 내보내는 값은 선언 상수가 아니라 **실제로 만들어진 배열의
        길이**여야 한다(`placement_size: PLACEMENT_ITEMS.length`). 상수를
        내보내면 배열이 6건이어도 이 계약이 초록이 된다.
        """
        assert policy["placement_size"] == settings.PLACEMENT_SIZE

    def test_보드_잠금_앞보기가_같다(self, policy):
        """MT-24 — 목이 잠금 규칙을 흉내 내되 **앞보기 칸 수까지** 같아야 한다.

        이 값이 갈리면 목 위 스모크에서는 3칸이 열리는데 실서버에서는 1칸만
        열리는(또는 그 반대) 화면이 된다. 잠금은 학습자가 **무엇을 할 수 있는지**를
        정하므로, 갈린 채로 초록이면 스모크가 검증하는 동선 자체가 실서버에 없다.
        """
        from app.routers.board import BOARD_UNLOCK_LOOKAHEAD

        assert policy["board_unlock_lookahead"] == BOARD_UNLOCK_LOOKAHEAD


@needs_node
class TestLevelGroups:
    """학령 3값 — R13 CO-P-5로 목에도 학령이 생겼다(GET/PATCH /auth/me)."""

    def test_허용값_집합이_같다(self, policy):
        from typing import get_args

        assert set(policy["level_groups"]) == set(get_args(LevelGroup))

    def test_게스트_기본_학령이_같다(self, policy):
        from app.routers.auth import GUEST_LEVEL_GROUP

        assert policy["guest_level_group"] == GUEST_LEVEL_GROUP

    def test_게스트_이메일_도메인이_같다(self, policy):
        """프론트 isGuestUser의 두 번째 판별 신호 — 어긋나면 게스트가 정식으로 읽힌다."""
        from app.routers.auth import GUEST_EMAIL_DOMAIN

        assert policy["guest_email_domain"] == GUEST_EMAIL_DOMAIN

    def test_보드_난이도_잠금표가_같다(self, policy):
        """학습 수준 → 열리는 최고 난이도 (2026-08-10).

        목이 서버보다 **느슨하면** 목 위 스모크·디자인 확인에서는 열리는 퍼즐이
        실서버에서 403이 되고, **빡빡하면** 그 반대다. 어느 쪽이든 목으로 본
        화면이 거짓말이 된다 — CO-J-9가 정확히 그 모양이었다.
        """
        from app.routers.board import BAND_MAX_DIFFICULTY

        assert policy["board_band_max_difficulty"] == BAND_MAX_DIFFICULTY


@needs_node
class TestKnowledgeLevelAxis:
    """지식 단계 축 — **목에 아예 없던** 도메인(2026-08-12).

    목의 `GET /progress/me`가 `knowledge_level`·`knowledge_level_max`를 안 보내서
    `KnowledgeLevelCard`가 목에서 **항상 null**을 반환했다. 카드가 통째로 안 뜨니
    프론트 스모크 24종 중 어느 것도 그 카드를 렌더해 본 적이 없었고, 그 상태로
    카드를 /me 오른쪽 열로 옮기는 배치 변경이 들어갔다. J-9가 "값이 갈렸다"였다면
    이것은 "필드가 없었다"다 — 갈림보다 조용하다.

    분모(MAX)와 경계(BOUNDS)가 어긋나면 목 화면의 「10단계 중 3단계」가 실서버에서
    다른 숫자가 된다. 두 값 모두 서버가 소유하고 목은 사본이라 실값으로 문다.
    """

    def test_지식_단계_분모가_같다(self, policy):
        from app.services.weatherbrain_service import KNOWLEDGE_LEVEL_MAX

        assert policy["knowledge_level_max"] == KNOWLEDGE_LEVEL_MAX

    def test_θ_단계_경계가_같다(self, policy):
        from app.services.weatherbrain_service import THETA_KNOWLEDGE_LEVEL_BOUNDS

        assert policy["theta_knowledge_level_bounds"] == list(
            THETA_KNOWLEDGE_LEVEL_BOUNDS
        )

    def test_목이_같은_θ에서_같은_밴드를_낸다(self, policy):
        """4밴드 축도 같은 θ에서 같아야 한다.

        지식 단계를 붙이다 발견했다(2026-08-12): 목 `thetaToLevelGroup`에
        **expert 가지가 없어** θ≥1.5에서 목은 adult, 서버는 expert였다. 두 축은
        접으면 같아야 하는데(`level_group_of_knowledge_level ∘
        theta_to_knowledge_level == theta_to_level_group`) 목만 그 불변식을
        깨고 있었고, 밴드로 잠기는 보드 난이도까지 이 값을 탄다.
        """
        import json
        import subprocess

        from app.services.weatherbrain_service import theta_to_level_group

        samples = [-9.0, -0.51, -0.5, 0.0, 0.49, 0.5, 1.0, 1.49, 1.5, 2.0, 9.0]
        code = (
            f"const m = await import({str(MOCK_PATH.as_uri())!r});"
            f"const xs = {json.dumps(samples)};"
            "process.stdout.write(JSON.stringify(xs.map(m.__thetaToLevelGroup)));"
        )
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=MOCK_PATH.parent,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        mock_bands = json.loads(proc.stdout)
        server_bands = [theta_to_level_group(x) for x in samples]
        mismatched = [
            (x, m, s) for x, m, s in zip(samples, mock_bands, server_bands) if m != s
        ]
        assert not mismatched, f"θ→밴드가 갈린다 (θ, 목, 서버): {mismatched}"

    def test_두_축이_목_안에서도_접힌다(self, policy):
        """목 스스로도 2축 정합을 지키는가 — 단계를 밴드로 접으면 밴드와 같아야."""
        import json
        import subprocess

        from app.services.weatherbrain_service import level_group_of_knowledge_level

        samples = [-9.0, -0.5, 0.0, 0.5, 1.0, 1.5, 1.75, 2.0, 2.25, 9.0]
        code = (
            f"const m = await import({str(MOCK_PATH.as_uri())!r});"
            f"const xs = {json.dumps(samples)};"
            "process.stdout.write(JSON.stringify(xs.map((x) => "
            "[m.__thetaToKnowledgeLevel(x), m.__thetaToLevelGroup(x)])));"
        )
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=MOCK_PATH.parent,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        broken = [
            (x, lvl, band, level_group_of_knowledge_level(lvl))
            for x, (lvl, band) in zip(samples, json.loads(proc.stdout))
            if level_group_of_knowledge_level(lvl) != band
        ]
        assert not broken, f"목의 2축이 안 접힌다 (θ, 단계, 밴드, 접은값): {broken}"

    def test_목이_같은_θ에서_같은_단계를_낸다(self, policy):
        """경계값 전건 대조 — 표만 같고 **비교 방향**(< vs <=)이 다르면 경계에서
        갈린다. 목은 `findIndex(theta < bound)`, 서버는 `if theta < bound`다.
        """
        import json
        import subprocess

        from app.services.weatherbrain_service import theta_to_knowledge_level

        bounds = policy["theta_knowledge_level_bounds"]
        # 경계 위·정확히·아래를 모두 던진다(경계는 하위 제외·상위 포함 관례)
        samples = [-9.0, 9.0]
        for b in bounds:
            samples += [b - 0.01, b, b + 0.01]

        code = (
            f"const m = await import({str(MOCK_PATH.as_uri())!r});"
            f"const xs = {json.dumps(samples)};"
            "process.stdout.write(JSON.stringify(xs.map(m.__thetaToKnowledgeLevel)));"
        )
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=MOCK_PATH.parent,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        mock_levels = json.loads(proc.stdout)
        server_levels = [theta_to_knowledge_level(x) for x in samples]
        mismatched = [
            (x, m, s)
            for x, m, s in zip(samples, mock_levels, server_levels)
            if m != s
        ]
        assert not mismatched, f"θ→단계가 갈린다 (θ, 목, 서버): {mismatched}"


@needs_node
class TestCrownPolicy:
    """왕관 — **행위가 이미 갈라져 있던** 도메인(CO-A6 / CO-J-9).

    목이 서버와 다른 왕관 정책을 갖고 있으면 "목에선 클리어되는데 실서버는 안 되는"
    갈림이 스모크 초록 뒤에 숨는다. 실제로 그랬다.
    """

    def test_일일_왕관_판정_범위가_진도_블록이다(self, policy, session_src):
        """서버 `_crown_scope_logs`가 kind=='unit'만 보는지 실소스로 확인한다."""
        assert policy["crown"]["daily_scope_kind"] == "unit"
        assert re.search(
            r"def _crown_scope_logs.*?kinds\.get\(log\.quiz_id\) == \"unit\"",
            session_src,
            re.S,
        ), "서버가 진도 블록(kind='unit')으로 왕관 범위를 좁히지 않는다"

    def test_진도_블록_0은_세션_전체로_폴백하지_않는다(self, policy, session_src):
        """CO-M7 — 폴백하면 왕관 기준이 5문항에서 15문항으로 조용히 올라간다."""
        assert policy["crown"]["daily_scope_fallback_to_session"] is False
        fn = re.search(r"def _crown_scope_logs.*?\n\ndef ", session_src, re.S)
        assert fn, "_crown_scope_logs를 못 찾았다 — 이 계약을 갱신할 것"
        # 독스트링은 이 결함의 **경위를 설명하느라** `... or logs`를 인용한다 —
        # 검사 대상은 코드부뿐이다(독스트링을 세면 설명이 곧 위반이 된다).
        code = fn.group(0).split('"""')[-1]
        assert "or logs" not in code, (
            "블록 0에서 세션 전체로 폴백하는 `... or logs`가 되살아났다 (CO-M7)"
        )

    def test_유닛_왕관은_하루_첫_세션에만_붙는다(self, policy, session_src):
        """2026-08-13 확정 — 「하루의 첫 유닛 세션이 곧 데일리 세션」.

        ⚠️ **이 계약은 뒤집혔고, 종전 판은 사실상 헛돌고 있었다.** 예전 본문은
        `grant_crown=False`가 소스에 **존재**하는지만 봤는데, 2026-08-12에 서버가
        `grant_crown=all_correct`로 바뀐 뒤에도 초록이었다 — 그 문자열이 **경위를
        설명하는 주석**에 남아 있었기 때문이다. 문자열 존재로 정책을 재는 검사는
        주석 하나에 속는다. 그래서 지금은 **실제 인자식**을 문다.

        무는 것 셋:
          ⑴ 목이 같은 정책을 신고한다(`daily_first_only`).
          ⑵ 서버가 `all_correct`와 `daily_first`의 **논리곱**을 넘긴다.
          ⑶ 왕관 분기가 「첫 세션인가」를 **재계산하지 않는다** — 발급 시점 도장을
             읽기만 한다. 재계산하면 두 유닛을 열어 역순으로 완료할 때 둘 다 첫
             세션이 되거나 둘 다 아니게 된다.
        """
        assert policy["crown"]["unit_session_grants_crown"] == "daily_first_only"
        assert re.search(r"grant_crown=all_correct and daily_first", session_src), (
            "서버 유닛 세션의 왕관이 「만점 ∧ 하루 첫 세션」이 아니다"
        )
        assert re.search(
            r'daily_first = bool\(\s*\(getattr\(session, "recipe_json", None\) or \{\}\)'
            r'\.get\("daily_first"\)',
            session_src,
        ), "왕관 분기가 recipe_json 도장을 읽지 않는다"

    def test_첫_세션_판정은_발급_시점에_찍힌_도장이다(self, policy, session_src):
        """완료 시점 재계산 금지 — 라우터가 세션 수를 **세지 않아야** 한다."""
        assert policy["crown"]["unit_first_stamped_at_issue"] is True
        # 주석은 걷어낸다 — 판정의 소유자가 어디인지 **설명하느라** 그 함수 이름을
        # 인용하므로, 주석까지 세면 근거를 남길수록 테스트가 우는 뒤집힌 유인이
        # 생긴다(같은 파일 `test_진도_블록_0은_...`이 쓰는 것과 같은 방법).
        code = "\n".join(
            line
            for line in session_src.splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "is_first_unit_session_today" not in code, (
            "라우터가 완료 시점에 「첫 세션인가」를 재계산한다 — 판정의 소유자는 "
            "발급 시점(curriculum_service.create_unit_session)이고 여기는 도장을 "
            "읽기만 해야 한다(역순 완료 경합)"
        )

    def test_왕관_대상_쌍이_진도_블록_유닛에서_나온다(self, policy, session_src):
        """CO-M6 — concept과 kind를 다른 출처에서 뽑으면 왕관이 증발한다."""
        assert policy["crown"]["target_source"] == "unit_block"
        assert re.search(
            r"def _crown_target.*?block\.get\(\"concept_tag\"\).*?block\.get\(\"kind\"\)",
            session_src,
            re.S,
        ), "서버가 unit_block의 (concept_tag, kind) 쌍을 왕관 대상으로 쓰지 않는다"


class TestMockExposesPolicy:
    """소스 계약(python 전용) — node 없이도 배선이 살아 있는지 본다."""

    def test_목이_정책을_노출한다(self):
        src = MOCK_PATH.read_text(encoding="utf-8")
        assert "export const __mockPolicy" in src, (
            "목이 __mockPolicy를 노출하지 않는다 — 이 계약 전체가 skip된다"
        )

    def test_목이_에너지_상수를_리터럴로_재복사하지_않는다(self):
        """정책 dict가 상수 **식별자**를 참조해야 한다(값을 다시 적으면 드리프트한다)."""
        src = MOCK_PATH.read_text(encoding="utf-8")
        block = re.search(r"export const __mockPolicy = \(\) => \(\{(.*?)\n\}\);", src, re.S)
        assert block, "__mockPolicy 본문을 못 찾았다 — 이 계약을 갱신할 것"
        body = block.group(1)
        assert "cloud_max: CLOUD_MAX" in body
        assert "cloud_cost: CLOUD_COST" in body
        assert "CLOUD_REGEN_MS" in body
        assert "session_recipe: MOCK_SESSION_RECIPE" in body
        # 배치고사 크기만은 **상수가 아니라 실제 배열 길이**를 내보내야 한다 —
        # 상수를 내보내면 배열이 옛 크기(6)에 멈춰 있어도 패리티가 초록이다
        # (2026-08-13 결함 ④가 그렇게 숨어 있었다).
        assert "placement_size: PLACEMENT_ITEMS.length" in body

    def test_목도_재사용_판정을_구름_게이트보다_먼저_한다(self):
        """2026-08-13 결함 ① — **서버와 목이 같은 결함을 갖고 있었다.**

        서버가 오늘·같은 유닛의 미완료 세션을 재사용하게 되면서(D10-3 대체),
        구름 게이트는 **신규 발급 분기 안**으로 들어갔다. 목의
        `startUnitSession`은 재사용을 처음부터 하고 있었는데 게이트는 그 앞에
        있었다 — 구름 0인 학습자가 이미 발급된 세션에 재진입하면 목에서도 429가
        났다는 뜻이고, 「이미 발급된 세션은 잔량 0이어도 끝까지 보장」(R10)이
        목 위 스모크에서 원리적으로 확인 불가였다.

        `__mockPolicy()`로는 잴 수 없는 **순서**라 소스로 문다(같은 파일의
        `test_계약14_...`가 서버 쪽에 쓰는 것과 같은 방법).
        """
        src = MOCK_PATH.read_text(encoding="utf-8")
        fn = re.search(
            r"function startUnitSession\(.*?\n\}\n", src, re.S
        )
        assert fn, "목의 startUnitSession을 못 찾았다 — 이 계약을 갱신할 것"
        block = fn.group(0)
        reuse_at = block.index("sessions.get(sessionId)")
        gate_at = block.index("requireCloudEntry()")
        assert reuse_at < gate_at, (
            "목이 재사용 조회보다 먼저 구름 게이트를 건다 — 이미 발급된 세션에 "
            "재진입하는 학습자가 429로 쫓겨난다(서버는 신규 발급 분기 안에서만 건다)"
        )


class TestNoLoginInMainFlow:
    """로그인 화면이 **없다** — MT-29 → 2026-08-12 클라이언트 지시로 강화.

    ⚠️ **계약이 뒤집혔다.** 이 클래스는 원래 "라우트 자체는 의도적으로 존치한다"고
    적혀 있었다(로그인 화면이 정식 계정의 재진입 통로이자 게스트 발급 실패의
    도착지라는 근거였다). 2026-08-12 클라이언트 지시로 로그인·회원가입 구조를
    전면 제거하면서 그 전제가 둘 다 무너졌다:

      · 게스트 비밀번호는 무작위 시크릿이라 **애초에 재진입 경로가 없다.**
        로그인 화면은 게스트에게 돌아올 문이 아니라 막다른 길이었다.
      · 발급 실패의 도착지는 이미 `GuestIssueRetry`로 갈려 나갔다(MT-29 본체).
        로그인 화면이 받던 몫이 남아 있지 않다.

    진도를 지키는 통로는 로그인이 아니라 **계정 전환**(`/account/convert`)이고,
    그쪽은 그대로 산다.

    ⚠️⚠️ **계약이 두 번째로 뒤집혔다(2026-08-14 클라이언트 결정 ⓑ) — 절반만.**

    위 8/12 전제는 **게스트에게는 참이었지만 「전환을 마친 사용자」를 못 봤다.**
    저장(계정 전환)을 마치면 그 사람은 **자기가 정한 이메일·비밀번호**를 가진 정식
    계정이다 — 「무작위 시크릿이라 재진입 경로가 없다」가 그 사람에게는 거짓이다.
    그리고 저장 안내 문구는 *"다른 기기에서도 이어서 배울 수 있어요"*라고 계속
    말하고 있었다. **돌아올 문이 없는데 하는 약속**이 실서버까지 갔다(대장 §4.14).

    그래서 `/login`이 「**진도 불러오기**」라는 이름으로 돌아왔다(「진도 저장」의 짝).
    ⚠️ **되돌아온 것은 라우트뿐이고, 규정을 지키던 부분은 그대로다:**
      · `/register`는 **여전히 0건**이다. 가입은 저장(전환) 동선이 소유한다.
      · **주 동선(navItems·SideNav·TabBar·헤더)에 링크 0건** — 그것이 「로그인 없이
        열려야 한다」는 규정의 해석이다. 진입은 「진도 저장」 카드 한 줄뿐이다.
      · **발급 실패 폴백은 되돌아오지 않는다**(계약 3) — 그것이 MT-29가 고친 결함
        자체였다(연결 나쁜 심사위원에게 규정이 금지한 화면을 보여 주는 경로).

    그래서 무는 것은 셋이다:
      1. `/register` 참조 0건 · `/login` 참조는 **정확히 승인된 집합과 같다**
      2. `App.jsx` 라우트 표에 `/register`가 없고 **`/login`은 있어야 한다**
      3. 발급 실패를 `GuestIssueRetry`가 받고, **재시도가 effect 의존성에 있다**

    ⚠️ 3번의 뒷단이 핵심이다 — 재시도 버튼이 리렌더만 일으키고 발급을 다시 안 걸면
    화면이 영구 스피너가 되고 사용자가 갇힌다(실제로 그렇게 커밋된 적이 있다.
    2026-08-12 코드 리뷰). 그래서 문자열 존재가 아니라 **의존성 배열**을 문다.
    """

    FRONT = Path(__file__).resolve().parents[2] / "frontend" / "src"

    # ⚠️ **부분 문자열로 세면 안 된다.** `/auth/login`·`/auth/register`는 계정 전환이
    # 쓰는 정당한 **API 엔드포인트**라 `api/auth.js`에 그대로 남고, 산문 주석에도
    # "종전에는 /login으로 튕겼다" 같은 경위 기술이 남는다. 무는 것은 화면으로
    # 가는 **라우트 참조**이므로 라우트 모양의 마커만 센다.
    ROUTE_MARKERS = tuple(
        tmpl.format(path=path)
        for path in ("/login", "/register")
        for tmpl in (
            'to="{path}"',
            "to='{path}'",
            'navigate("{path}")',
            "navigate('{path}')",
            'path="{path}"',
            "path='{path}'",
            'Navigate to="{path}"',
            # ⚠️ **`.js` 헬퍼가 목적지를 데이터로 들고 있는 선례가 있다** —
            # `modules/curriculum/learnEntry.js`의 `pickLearnEntry`가
            # `{ kind: 'daily', to: '/daily' }`를 돌려주고 화면이 그걸 `<Link to>`에
            # 그대로 꽂는다. JSX 속성만 보면 그런 경로는 감시를 빠져나간다.
            "to: '{path}'",
            'to: "{path}"',
        )
    )

    # 🔴 **승인된 `/login` 참조 — 이 집합 자체가 계약이다.**
    #
    # 「허용 목록」이 아니라 **정확한 집합**으로 문다. 목록이면 빠지는 것을 못 보지만
    # 집합이면 **양쪽으로** 운다:
    #   · 세 번째 참조가 생기면(navItems에 탭 추가·헤더 링크·엉뚱한 navigate) 붉다
    #   · 승인된 참조가 사라져도 붉다(진입점만 지우면 라우트가 고아가 된다)
    # ⚠️ **여기에 줄을 더하는 것은 테스트 수정이 아니라 계약 변경이다** — 주 동선
    #    링크 0건이 규정 해석의 근거이므로 클라이언트 결정 없이 늘리지 말 것.
    SANCTIONED_LOGIN_REFS = {
        # 라우트 정의 — 표의 단일 소유자
        'App.jsx: path="/login"',
        # 진입점 ⑴ — 「진도 저장」 카드. 이미 저장한 사람이 이 카드를 다시 보는
        # 경우가 곧 「돌아오려는 사람」이라 자리도 여기가 맞다.
        'modules/progress/ProgressPage.jsx: to="/login"',
        # 🔴 진입점 ⑵ — **첫 접속 정보 입력 화면**(2026-08-19 클라이언트 지시로 추가).
        #
        # ⚠️ 이 줄을 더한 것은 테스트 수정이 아니라 **계약 변경**이다(위 주석).
        #    근거를 남긴다 — 나중에 「누가 늘렸나」를 물을 때 답이 있어야 한다:
        #      · 클라이언트 지시(2026-08-19): *"진도 불러오기를 진입 시점에 노출"* —
        #        실서버 실측으로 **진입 화면에 진입점이 0건**이었고 `/login` URL을
        #        직접 아는 사람만 닿았다. 화면이 닉네임을 적게 해 놓고 그 이름으로
        #        돌아올 문이 안 보이는 상태였다.
        #      · 규정 판정(`docs/team/HACKATHON_RULES.md` §0, 2026-08-14 확정):
        #        금지되는 것은 **주 동선이 계정·결제를 요구하는 것**이지 인증 표면의
        #        존재가 아니다 — 「진도 불러오기」 진입도 규정 안이다.
        # ⚠️ **주 동선 0건은 그대로다.** 이 화면은 「건너뛰기」로 통과되는 진입
        #    화면이고 navItems·SideNav·TabBar에는 여전히 참조가 없다. 진입점이
        #    관문이 되지 않는다는 반대 방향 단정은 프론트
        #    `tests/loadProgress.contract.test.mjs` ④가 소유한다.
        "modules/onboarding/EntryInfoPage.jsx: navigate('/login')",
    }

    def test_프론트에_로그인_가입_라우트_참조가_없다(self):
        """계약 1 — `/register`는 0건, `/login`은 **승인된 집합과 정확히 일치**.

        `.jsx`뿐 아니라 `.js`도 훑는다(위 ROUTE_MARKERS 주석의 learnEntry 선례).
        `/auth/login`·`/auth/register`는 계정 전환·진도 불러오기가 쓰는 실
        엔드포인트라 남지만, 마커가 전부 `to:`/`path=`/`navigate(` 접두를 요구하므로
        걸리지 않는다.
        """
        found = []
        for path in sorted([*self.FRONT.rglob("*.jsx"), *self.FRONT.rglob("*.js")]):
            src = path.read_text(encoding="utf-8")
            for marker in self.ROUTE_MARKERS:
                if marker in src:
                    found.append(f"{path.relative_to(self.FRONT)}: {marker}")

        register_refs = [f for f in found if "/register" in f]
        assert not register_refs, (
            "회원가입 화면으로 가는 라우트 참조가 되살아났다 — 가입은 저장(계정 "
            "전환) 동선이 소유한다: " + " · ".join(register_refs)
        )

        login_refs = {f for f in found if "/login" in f}
        extra = login_refs - self.SANCTIONED_LOGIN_REFS
        missing = self.SANCTIONED_LOGIN_REFS - login_refs
        assert not extra, (
            "승인되지 않은 「진도 불러오기」 진입이 생겼다 — 주 동선 링크 0건이 "
            "「로그인 없이 열려야 한다」는 규정의 해석이고, 진입은 「진도 저장」 카드 "
            "하나뿐이다(대장 §4.14). 늘리려면 클라이언트 결정이 먼저다: "
            + " · ".join(sorted(extra))
        )
        assert not missing, (
            "승인된 「진도 불러오기」 참조가 사라졌다 — 라우트나 진입점 한쪽만 지우면 "
            "고아가 된다(라우트만 남으면 갈 길이 없고, 링크만 남으면 `*`가 삼킨다): "
            + " · ".join(sorted(missing))
        )

    def test_App_라우트_표에_로그인_가입_경로가_없다(self):
        """계약 2 — 라우트 정의 자체가 사라졌는가.

        위 1번은 `src` 전역을 훑으므로 App.jsx도 포함하지만, 이 계약은 **App.jsx가
        라우트 표의 단일 소유자**라는 사실에 기대어 따로 못 박는다. 라우트가
        되살아나는 회귀는 여기서 먼저 운다.
        """
        src = (self.FRONT / "App.jsx").read_text(encoding="utf-8")
        for marker in ('path="/register"', "path='/register'"):
            assert marker not in src, (
                "App.jsx 라우트 표에 /register가 되살아났다 — 가입 구조는 "
                "2026-08-12에 제거됐고 저장(계정 전환)이 그 몫을 갖는다"
            )
        # 🔴 **`/login`은 이제 「없어야」가 아니라 「있어야」다**(2026-08-14 ⓑ).
        # 방향을 뒤집어 못박는 이유: 라우트를 다시 지우면 **아무도 울지 않는다.**
        # 프론트 계약 ㉮는 문구가 겸손해서 초록이고(약속을 안 하므로), 「진도 저장」
        # 카드의 링크는 `*` catch-all에 삼켜져 조용히 `/`로 튕긴다 — 화면상으로는
        # 「눌러도 아무 일도 안 일어난다」로 보인다.
        assert 'path="/login"' in src or "path='/login'" in src, (
            "App.jsx에서 진도 불러오기 라우트가 사라졌다 — 「진도 저장」 카드의 "
            "진입 링크가 `*`에 삼켜져 조용히 학습 화면으로 튕긴다(대장 §4.14 ⓑ)"
        )
        # 삭제된 페이지 모듈을 다시 임포트하지도 않는다(파일 자체가 git rm 됐다).
        # ⚠️ **맨 이름으로 세지 않는다.** `LoginPage`는 "종전에 LoginPage가 …했다"
        # 같은 경위 기술로 주석에 정당하게 남는다(CLAUDE.md: 메커니즘 서술과
        # 근거 참조는 남기고 고유명사만 바꾼다). 무는 것은 **import 문**이다.
        for gone in ("LoginPage", "RegisterPage"):
            assert not re.search(rf"^import\s+.*\b{gone}\b.*$", src, re.M), (
                f"App.jsx가 삭제된 {gone}을 임포트한다 — 파일은 git rm 됐다"
            )

    def test_발급_실패는_재시도_화면으로_받고_재시도가_실제로_돈다(self):
        """계약 3 — 실패를 `GuestIssueRetry`가 받고 재시도가 effect를 다시 돌린다.

        ⚠️ 앞단(문자열 존재)만 물면 **아무 일도 안 하는 재시도 버튼**이 통과한다 —
        실제로 그렇게 커밋됐다. `bump`로 리렌더만 하면 발급 effect의 의존성
        `[accessToken]`이 그대로(null)라 재발급이 안 걸리고, 재시도 화면이 영구
        스피너로 바뀐다. MT-29가 막으려던 결과 그 자체다.

        그래서 **재시도 신호가 effect 의존성 배열에 있는지**를 문다.
        누르는 것까지 보는 실마운트 계약은
        `frontend/tests/onboardingGating.smoke.test.mjs`(시나리오 10-b)가 소유한다.
        """
        src = (self.FRONT / "App.jsx").read_text(encoding="utf-8")
        assert "guestFailed" in src, "발급 실패와 그 외(토큰 없음)를 구분하지 않는다"
        assert "GuestIssueRetry" in src, "발급 실패에 재시도 화면이 없다"

        # 재시도 신호(retryTick)가 발급 effect의 의존성 배열에 있어야 한다.
        deps = re.search(r"\}, \[accessToken([^\]]*)\]\);", src)
        assert deps, (
            "게스트 발급 effect의 의존성 배열(`[accessToken…]`)을 못 찾았다 — "
            "이 계약을 갱신할 것"
        )
        assert "retryTick" in deps.group(1), (
            "재시도가 effect 의존성에 없다 — 버튼이 리렌더만 일으키고 발급을 다시 "
            "걸지 않는다. 재시도 화면이 영구 스피너가 되고 사용자가 갇힌다"
        )
        # 실패 분기가 "그 외" 분기보다 **먼저** 와야 한다. 순서 표기가 두 번
        # 바뀌었다: 처음에는 뒤 분기가 `Navigate to="/login"`이라 그 문자열로 쟀고,
        # 로그인 화면 제거 뒤에는 두 분기 모두 `GuestIssueRetry`라 플래그 이름
        # (`guestSettled)`)으로 쟀다. 2026-08-14부터 뒤 분기는 조건이 늘어난
        # `guestSettled || hadAccount`라 **닫는 괄호가 붙지 않는다** — 그래서
        # 여기서는 `if (` 다음의 플래그 등장 위치로 잰다(조건이 또 늘어나도 산다).
        fail_at = src.index("if (guestFailed)")
        settled_at = src.index("if (guestSettled")
        assert fail_at < settled_at, (
            "발급 실패가 '그 외' 분기에 먼저 잡힌다 — 실패 전용 안내가 죽는다"
        )

    def test_만료는_재시도가_아니라_선택_화면이고_새로고침을_건넌다(self):
        """계약 3-b — **「다시 시도」가 계정 교체가 되면 안 된다**(2026-08-14).

        계약 3은 「발급 **실패**를 재시도로 받는다」를 지킨다. 그 옆에 다른 상황이
        있다: 토큰을 **가진 적이 있는데 지워진** 경우(401 인터셉터 →
        `authStore.logout()`). 종전에는 그 자리도 `GuestIssueRetry`를 재사용했고,
        버튼이 `resetGuestAutoIssue()`로 **새 게스트를 발급**했다 — 게스트
        비밀번호는 무작위 시크릿이라 옛 진도로 돌아갈 길이 없다. 버튼 이름은
        「다시 시도」인데 결과는 진도 영구 소실이었다.

        두 겹을 문다. 하나만 있으면 나머지 하나로 우회된다:
          ⓐ 만료 전용 화면(`SessionExpired`)이 있고 그 분기가 존재한다.
          ⓑ 판정이 **persist되는 값**(`authStore.hadAccount`)에 걸린다 —
             모듈 스코프 플래그만 보면 **새로고침 한 번**에 「첫 방문자」로
             둔갑해 안내 화면이 통째로 우회된다.

        누르는 것까지 보는 실마운트 계약은
        `frontend/tests/entryFlow.smoke.test.mjs` ⑩~⑫가 소유한다.
        """
        src = (self.FRONT / "App.jsx").read_text(encoding="utf-8")
        assert "SessionExpired" in src, (
            "만료를 발급 실패와 같은 화면으로 받는다 — 「다시 시도」가 곧 계정 "
            "교체가 되고 게스트 진도가 영구 소실된다"
        )
        assert "hadAccount" in src, (
            "만료 판정이 모듈 스코프 플래그에만 걸려 있다 — 새로고침 한 번이면 "
            "「첫 방문자」와 구분되지 않아 새 게스트가 조용히 발급된다"
        )
        deps = re.search(r"\}, \[accessToken([^\]]*)\]\);", src)
        assert deps and "hadAccount" in deps.group(1), (
            "`hadAccount`가 발급 effect 의존성에 없다 — 「새로 시작하기」가 "
            "플래그만 지우고 발급을 다시 걸지 않아 버튼이 죽은 것처럼 보인다"
        )

        store = (self.FRONT / "store" / "authStore.js").read_text(encoding="utf-8")
        logout_line = next(
            line for line in store.splitlines() if line.strip().startswith("logout:")
        )
        assert "hadAccount" not in logout_line, (
            "`logout()`이 `hadAccount`까지 지운다 — 토큰과 같은 수명이 되면 "
            "만료 안내가 새로고침 한 번으로 사라진다(이 값의 존재 이유가 그것이다)"
        )
        partialize = src_partialize = re.search(
            r"partialize:\s*\(state\)\s*=>\s*\(\{(.*?)\}\)", store, re.S
        )
        assert partialize and "hadAccount" in partialize.group(1), (
            "`hadAccount`가 persist에 실리지 않는다 — 새로고침을 못 건너므로 "
            "있으나 마나 하다"
        )


# ═══════════════════════════════════════════════════════════════
# 🔴 그물 밖이던 사본 넷 (2026-08-20 전수 대조에서 드러남)
# ═══════════════════════════════════════════════════════════════
class TestUnnettedCopies:
    """목이 서버 로직을 **자체 구현**한 자리 중 `__mockPolicy()`에 안 실려 있던 것들.

    값이 오늘 같아도 노출이 없으면 **서버가 바뀔 때 아무 소리가 안 난다.**
    같은 파일 안에서 어떤 사본은 대조되고 어떤 사본은 안 되던 것이 위험이었다 —
    있는 쪽만 보고 「목은 대조된다」고 읽기 쉽다.
    """

    def test_사전_b_표가_같다(self, policy):
        from app.services import weatherbrain_service as wb
        assert policy["level_group_item_b"] == {
            k: float(v) for k, v in wb.LEVEL_GROUP_ITEM_B.items()
        }

    def test_기본_b가_같다(self, policy):
        from app.services import weatherbrain_service as wb
        assert policy["default_item_b"] == float(wb.DEFAULT_ITEM_B)

    def test_표현_톤_표가_같다(self, policy):
        from app.services import weatherbrain_service as wb
        assert policy["level_group_tone"] == dict(wb.LEVEL_GROUP_TONE)

    def test_보드_난이도_규칙이_같은_답을_낸다(self, policy):
        """🔴 **표가 아니라 규칙을 잰다.**

        `board_band_max_difficulty`(표)는 이미 대조되고 있었는데 **규칙**은 아니었다.
        실제로 갈려 있었다 — 서버는 `isinstance(palette, (list, dict))`로 세고 목은
        배열만 셌다. 시드 55건이 전부 배열이라 **오늘만** 답이 같았다.
        ⇒ 목이 내려보낸 표본의 입력을 **서버 함수에 그대로 넣어** 답을 대조한다.
        ⚠️ 표본에 **객체 palette가 들어 있는지**까지 확인한다 — 그 갈래가 빠지면
           이 검사가 다시 「입력이 그 갈래를 안 밟아서」 초록이 된다.
        """
        from app.routers.board import board_difficulty

        samples = policy["board_difficulty_samples"]
        assert samples, "목이 보드 난이도 표본을 안 내보낸다"
        # ⚠️ **3개 이상인 객체**여야 한다(2026-08-20 되돌림에서 잡힘). 처음엔
        #    "객체 palette가 하나라도 있으면 됨"으로 썼는데, 2개짜리 객체가
        #    표본에 남아 있어 **3개 이상 갈래를 지워도 이 검사가 통과**했다.
        #    갈리는 지점은 `len(palette) >= 3`이므로 그 지점을 밟는 표본을 요구한다.
        assert any(
            isinstance(c["template"].get("palette"), dict)
            and len(c["template"]["palette"]) >= 3
            for c in samples
        ), "표본에 **3개 이상인 객체 palette**가 없다 — 규칙이 갈려도 답이 같아 초록이 된다"
        bad = [
            (c, board_difficulty(c["template"], c["level_group"]))
            for c in samples
            if board_difficulty(c["template"], c["level_group"]) != c["out"]
        ]
        assert not bad, "목과 서버의 보드 난이도 규칙이 갈렸다: " + "; ".join(
            f"{c['template']}/{c['level_group']}: 목 {c['out']} vs 서버 {srv}"
            for c, srv in bad
        )

    def test_대결_승리_XP가_같다(self, policy):
        """액수를 프론트가 하드코딩하지 않도록 서버가 보내는 값이다(R10).
        목도 그 값을 흉내내므로 사본이고, 사본이면 대조해야 한다."""
        from app.services import duel_service
        assert policy["duel_win_xp"] == duel_service.DUEL_WIN_XP
