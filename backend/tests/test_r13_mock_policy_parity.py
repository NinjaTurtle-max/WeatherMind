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


@needs_node
class TestSessionRecipe:
    def test_배합이_같다(self, policy):
        assert policy["session_recipe"] == settings.SESSION_RECIPE

    def test_board_상한이_같다(self, policy):
        """CO-H5 — 목 뱅크에 board가 늘어도 서버와 같은 상한을 쓴다.

        지금 목 뱅크는 board가 소수라 상한에 닿지 않는다. 그래서 더 중요하다 —
        **발현하지 않는 정책은 갈려도 아무도 모른다.** 에너지 상수를 목이 리터럴로
        복사한 채 대조가 0이던 CO-J-9가 정확히 그렇게 생겼다.
        """
        assert policy["daily_board_cap"] == settings.DAILY_BOARD_CAP

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

    def test_유닛_세션은_왕관을_주지_않는다(self, policy, session_src):
        """§2.10 소유권 이전 — 유닛 직접 진입은 연습 전용(grant_crown=False 고정)."""
        assert policy["crown"]["unit_session_grants_crown"] is False
        assert re.search(r"grant_crown=False", session_src), (
            "서버 유닛 세션이 grant_crown=False가 아니다"
        )
        assert not re.search(r"grant_crown=True", session_src), (
            "유닛 세션에 왕관을 주는 분기가 되살아났다 (§2.10)"
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
