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

    def test_두_번째_이후_유닛_세션_크기가_같다(self, policy):
        """**첫 세션은 배합 총합(10), 두 번째 이후가 이 값**(2026-08-13 확정).

        종전 목은 이 자리에 하드코딩 `3`을 갖고 서버(4)와 조용히 갈려 있었다 —
        대조가 0인 정책이 리터럴로 복사돼 있는 CO-J-9와 똑같은 모양이다.
        """
        assert policy["unit_session_size"] == settings.UNIT_SESSION_SIZE

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

    그래서 무는 것은 셋이다:
      1. `frontend/src`에 `/login`·`/register` **라우트 참조가 0건**
      2. `App.jsx` 라우트 표에 그 경로가 없다
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

    def test_프론트에_로그인_가입_라우트_참조가_없다(self):
        """계약 1 — `frontend/src` 전역 0건.

        ALLOWED 예외가 없다. 종전에는 LoginPage·RegisterPage끼리의 상호 링크를
        허용했는데 **두 파일이 삭제됐고**, App.jsx도 이제 깨끗해야 한다.

        `.jsx`뿐 아니라 `.js`도 훑는다(위 ROUTE_MARKERS 주석의 learnEntry 선례).
        `/auth/login`·`/auth/register`는 계정 전환이 쓰는 실 엔드포인트라 남지만,
        마커가 전부 `to:`/`path=`/`navigate(` 접두를 요구하므로 걸리지 않는다.
        """
        offenders = []
        for path in sorted([*self.FRONT.rglob("*.jsx"), *self.FRONT.rglob("*.js")]):
            src = path.read_text(encoding="utf-8")
            for marker in self.ROUTE_MARKERS:
                if marker in src:
                    offenders.append(f"{path.relative_to(self.FRONT)}: {marker}")
        assert not offenders, (
            "로그인·회원가입 화면으로 가는 라우트 참조가 되살아났다 — 그 화면은 "
            "2026-08-12에 제거됐고 게스트는 재진입 경로가 없다(진도 영구 소실). "
            "진도를 지키는 통로는 /account/convert다: " + " · ".join(offenders)
        )

    def test_App_라우트_표에_로그인_가입_경로가_없다(self):
        """계약 2 — 라우트 정의 자체가 사라졌는가.

        위 1번은 `src` 전역을 훑으므로 App.jsx도 포함하지만, 이 계약은 **App.jsx가
        라우트 표의 단일 소유자**라는 사실에 기대어 따로 못 박는다. 라우트가
        되살아나는 회귀는 여기서 먼저 운다.
        """
        src = (self.FRONT / "App.jsx").read_text(encoding="utf-8")
        for path in ("/login", "/register"):
            for marker in (f'path="{path}"', f"path='{path}'"):
                assert marker not in src, (
                    f"App.jsx 라우트 표에 {path}가 되살아났다 — 로그인·회원가입 "
                    "구조는 2026-08-12에 제거됐다"
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
        # 실패 분기가 "그 외" 분기보다 **먼저** 와야 한다. 종전에는 뒤 분기가
        # `Navigate to="/login"`이었고 그 문자열로 순서를 쟀다 — 로그인 화면이
        # 없어졌으므로 이제 두 분기 모두 GuestIssueRetry다. 순서는 실패 플래그가
        # 정착 플래그보다 앞서는 것으로 잰다.
        assert src.index("guestFailed)") < src.index("guestSettled)"), (
            "발급 실패가 '그 외' 분기에 먼저 잡힌다 — 실패 전용 안내가 죽는다"
        )
