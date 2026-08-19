"""목(mock) 잠금 규칙이 서버와 같은 축을 보는가 — 결함 ⑩ (2026-08-19)

`frontend/mock/apiMockPlugin.js`는 개발 서버(`VITE_MOCK=1`)에서 백엔드를 대신하며
**잠금 판정을 자체 재구현**한다. 서버(`curriculum_service.is_locked`)와 갈리면
「dev에서만 열리는 / dev에서만 안 열리는」 결함이 되고, **프론트 스모크가 결함
상태를 계약으로 굳힌다.**

⚠️ **이 파일이 있는 이유는 실제 사고다.** 같은 8/18 롤링분에서 ⑧⑨를 백엔드만
고치고 목을 안 고쳤더니 dev 화면은 결함 그대로였다. 그래서 ⑩에서는 목도 같이
고쳤는데, **고친 것을 지켜 주는 계약이 없으면 같은 일이 또 일어난다.**

파싱으로 대조하는 이유: 목은 vite 플러그인(순수 JS)이라 파이썬에서 실행할 수
없다. 그래서 **규칙이 참조하는 축의 이름**을 정규식으로 확인한다 — 값 대조가
아니라 「두 축을 다 보고 있는가」의 확인이다(선례:
`test_daily_goal_session_parity.py`가 값 소유자 4곳을 같은 방식으로 문다).
"""

import re
from pathlib import Path

import pytest

_MOCK = (
    Path(__file__).resolve().parents[2] / "frontend" / "mock" / "apiMockPlugin.js"
)


@pytest.fixture(scope="module")
def mock_src() -> str:
    if not _MOCK.exists():  # pragma: no cover - 경로가 바뀌면 즉시 알아야 한다
        pytest.fail(f"목 플러그인을 찾지 못했다: {_MOCK}")
    return _MOCK.read_text(encoding="utf-8")


def _is_unit_locked_body(src: str) -> str:
    """`isUnitLocked` 화살표 함수의 본문만 떼어낸다."""
    m = re.search(r"const isUnitLocked = \([^)]*\) => \{(.*?)\n\};", src, re.S)
    assert m, "목에서 isUnitLocked 정의를 찾지 못했다 — 이름이 바뀌었나?"
    return m.group(1)


class TestMockLockRuleSeesBothAxes:
    def test_잠금_규칙이_attempted_at을_본다(self, mock_src):
        """**결함 ⑩의 목 쪽 실체.** 이 축이 없으면 dev에서 다음 유닛이 안 열린다."""
        body = _is_unit_locked_body(mock_src)
        assert "attempted_at" in body, (
            "목의 잠금 규칙이 진행 축(attempted_at)을 안 본다 — 서버는 보는데 "
            "목이 안 보면 dev 화면만 종전 결함 상태로 남는다"
        )

    def test_잠금_규칙이_crowns도_함께_본다(self, mock_src):
        """서버가 `crowns >= 1`을 OR로 남긴 것과 같아야 한다(기존 학습자 보호)."""
        body = _is_unit_locked_body(mock_src)
        assert "crowns" in body, "목이 보상 축을 잃었다 — 서버는 OR로 남겼다"

    def test_두_축이_OR로_묶여_있다(self, mock_src):
        """AND면 「만점이면서 해 본」 유닛만 열린다 — 종전보다 더 잠긴다."""
        body = _is_unit_locked_body(mock_src)
        assert "||" in body, (
            "두 축이 OR가 아니다 — 서버는 `crowns >= 1 or attempted_at is not None`"
        )
        assert "&&" not in body.split("return")[-1], (
            "반환식에 AND가 섞였다 — 어느 한 축만 참일 때 열리지 않는다"
        )

    def test_첫_유닛과_선해제는_종전과_같다(self, mock_src):
        """회귀 감시 — 새 축이 기존 두 무잠금 경로를 밀어내지 않았다."""
        body = _is_unit_locked_body(mock_src)
        assert "prereq_unit_id" in body, "첫 유닛 무잠금 분기가 사라졌다"
        assert "preUnlockedUnits" in body, "배치 선해제 분기가 사라졌다"


class TestMockRecordsAttemptOnCompletion:
    """규칙만 맞고 기록이 없으면 아무것도 안 열린다 — 쓰는 자리도 문다."""

    def test_세션_완료와_dev_경로_양쪽에서_기록한다(self, mock_src):
        writes = re.findall(r"attempted_at\s*=\s*new Date\(\)", mock_src)
        assert len(writes) >= 2, (
            "attempted_at을 쓰는 자리가 2곳 미만이다 — 세션 완료 경로와 /dev 경로 "
            f"양쪽이 필요하다(실측 {len(writes)}곳)"
        )

    def test_모든_기록_자리가_각각_멱등이다(self, mock_src):
        """서버 `mark_unit_attempted`와 같이 첫 시각을 덮지 않는다.

        🔴 **첫 판이 공허했다**(2026-08-19, 변이로 발견). 종전 단정은
        *"어딘가에 `attempted_at == null` 가드가 있다"* 였는데, 가드가 **두 자리**에
        있으므로 **한 자리의 멱등을 깨도 다른 자리가 남아 초록**이었다. 실제로
        세션 완료 경로의 가드를 지운 변이가 통과했다.

        ⇒ **자리마다** 묻는다. 쓰는 줄 전부가 `== null` 가드를 같은 줄에 지녀야
        한다(두 자리 모두 `if (…== null) x = new Date()` 한 줄 형태다). 가드를
        여러 줄로 풀어 쓰면 이 단정이 빨강이 나므로, 그때는 형태를 함께 갱신한다 —
        **조용히 통과하는 것보다 낫다.**
        """
        lines = [
            (i + 1, ln)
            for i, ln in enumerate(mock_src.splitlines())
            if re.search(r"attempted_at\s*=\s*new Date\(\)", ln)
        ]
        assert lines, "attempted_at을 쓰는 자리가 아예 없다"
        unguarded = [(no, ln.strip()) for no, ln in lines if "== null" not in ln]
        assert not unguarded, (
            "멱등 가드가 없는 기록 자리가 있다 — 첫 시도 시각을 덮는다: "
            + " / ".join(f"L{no}: {ln}" for no, ln in unguarded)
        )

    def test_기본_진도_행이_새_축을_가진다(self, mock_src):
        """행을 만들 때 축이 빠지면 `undefined`가 되어 판정이 흔들린다."""
        assert re.search(
            r"crowns: 0, cleared_at: null, attempted_at: null", mock_src
        ), "목의 기본 진도 행에 attempted_at이 없다"
