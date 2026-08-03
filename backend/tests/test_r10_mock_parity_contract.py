"""mock ↔ 서버 정합 계약 (스프린트 R10-07 §2.3, S3).

프론트 mock(`frontend/mock/apiMockPlugin.js`)은 손으로 쓴 픽스처라 서버가 실제로
내보내는 것과 조용히 어긋난다. R10-01·R10-07에서 같은 실패가 3번 반복됐다:
mock·프론트 스모크는 전부 초록인데 실서버 경로가 끊겨 있었고, 관찰 보고서의 수치
서술("첫날 세션 9문항 중 4개 중복")조차 mock 값이었다(실서버는 5문항).

여기서 mock 픽스처를 **읽기 전용으로 파싱**해 서버 계약과 대조한다
(백엔드 소유 파일만 수정 — mock 교정 여부는 PM 판단, §2.3 주의).

알려진 위반 2건은 `xfail(strict=True)`로 고정한다 — "지금 어긋나 있음"을 CI가
계속 보고하고, 누군가 mock을 교정하면 XPASS로 실패해 이 마커를 지우게 만든다.
"""
import json
import re
from pathlib import Path

import pytest

from app.core.config import settings

REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"

# 서버가 유형별로 내보내는 페이로드 키 — routers/session.QUESTION_PAYLOAD_FIELDS를
# 시드 실데이터에 적용한 실측값으로 계산한다(하드코딩 사본 금지).
from app.routers.session import QUESTION_PAYLOAD_FIELDS  # noqa: E402

MOCK_ONLY_KEYS = {"_mock"}  # 목 전용 채점 정보 (stripMock이 응답 직전 제거)


# ── 최소 JS 리터럴 파서 (문자열·주석 마스킹 후 괄호 깊이 추적) ──────────────────
def _mask(src: str) -> str:
    """문자열 리터럴·주석을 같은 길이의 공백으로 치환 — 깊이/키 스캔을 안전하게."""
    out: list[str] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "'\"`":
            quote = c
            out.append(" ")
            i += 1
            while i < n and src[i] != quote:
                if src[i] == "\\":
                    out.append(" ")
                    i += 1
                if i < n:
                    out.append("\n" if src[i] == "\n" else " ")
                    i += 1
            out.append(" ")
            i += 1
        elif c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                out.append("\n" if src[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _array_elements(src: str, name: str) -> list[tuple[str, str]]:
    """`const NAME = [ ... ]`의 최상위 원소들을 (원문, 마스킹본) 쌍으로 돌려준다."""
    m = re.search(rf"const {name}\s*=\s*\[", src)
    assert m, f"mock에서 const {name} = [ 를 못 찾음 — 파서/픽스처 확인"
    masked = _mask(src)
    depth, i, cur = 1, m.end(), m.end()
    spans: list[tuple[int, int]] = []
    while i < len(masked):
        c = masked[i]
        if c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0:
                spans.append((cur, i))
                break
        elif c == "," and depth == 1:
            spans.append((cur, i))
            cur = i + 1
        i += 1
    else:  # pragma: no cover - 픽스처가 깨진 경우
        pytest.fail(f"const {name} 배열이 닫히지 않음")
    return [
        (src[a:b], masked[a:b]) for a, b in spans if masked[a:b].strip()
    ]


KEY_RE = re.compile(r"(\w+)\s*:")


def _keys_at_depth(masked: str, depth_wanted: int, start: int = 0, end: int | None = None) -> set[str]:
    """마스킹본에서 지정 괄호 깊이의 객체 키를 모은다."""
    end = len(masked) if end is None else end
    keys: set[str] = set()
    depth = 0
    for m in re.finditer(r"[\[\]{}()]|\w+\s*:", masked[start:end]):
        token = m.group()
        if token in "[{(":
            depth += 1
        elif token in "]})":
            depth -= 1
        elif depth == depth_wanted:
            keys.add(token.split(":")[0].strip())
    return keys


def _mock_item_fields(raw: str, masked: str) -> tuple[str | None, set[str]]:
    """mock 문항 1건 → (question_type, 프론트가 읽을 수 있는 필드 집합).

    프론트는 `question.X ?? question.template_json?.X` 폴백을 쓰므로
    최상위 키와 template_json 내부 키를 합집합으로 본다.
    """
    tm = re.search(r"question_type:\s*'(\w+)'", raw)
    qtype = tm.group(1) if tm else None
    fields = _keys_at_depth(masked, 1) - MOCK_ONLY_KEYS
    tj = re.search(r"template_json:\s*\{", masked)
    if tj:
        # template_json 블록의 끝(중괄호 짝) 찾기
        depth, i = 1, tj.end()
        while i < len(masked) and depth:
            if masked[i] in "[{(":
                depth += 1
            elif masked[i] in "]})":
                depth -= 1
            i += 1
        fields |= _keys_at_depth(masked, 0, tj.end(), i - 1)
    return qtype, fields


@pytest.fixture(scope="module")
def mock_src() -> str:
    assert MOCK_PATH.exists(), "apiMockPlugin.js 경로 변경 시 이 계약을 갱신할 것"
    return MOCK_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def seed_items() -> list[dict]:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


class TestParserSanity:
    """파서가 조용히 0건을 반환하면 계약이 무력화된다 — 먼저 자신을 검증한다."""

    def test_세션_배열_파싱됨(self, mock_src):
        assert len(_array_elements(mock_src, "SESSION_ITEMS")) > 0

    def test_보드_배열_파싱됨(self, mock_src):
        assert len(_array_elements(mock_src, "BOARD_PUZZLES")) > 0

    def test_유형_추출됨(self, mock_src):
        types = {
            _mock_item_fields(raw, masked)[0]
            for raw, masked in _array_elements(mock_src, "SESSION_ITEMS")
        }
        assert None not in types and len(types) >= 5, f"유형 추출 실패: {types}"


class TestMockServerParity:
    @pytest.mark.xfail(
        strict=True,
        reason="알려진 위반 (§2.3): mock 세션 9문항 vs SESSION_RECIPE 합 5 — "
        "픽스처 교정은 PM 판단",
    )
    def test_세션_문항수가_SESSION_RECIPE_총합(self, mock_src):
        recipe_total = sum(settings.SESSION_RECIPE.values())
        mock_count = len(_array_elements(mock_src, "SESSION_ITEMS"))
        assert mock_count == recipe_total, (
            f"mock 세션 items {mock_count}건 vs 서버 배합 총합 {recipe_total}건 — "
            "mock 기반 관찰이 실서버 규모를 왜곡한다(관찰 보고서 §1의 분모 9가 이것)"
        )

    @pytest.mark.xfail(
        strict=True,
        reason="알려진 위반 (§2.3): mock BOARD_PUZZLES 4건 vs 시드 board 12건 — "
        "픽스처 교정은 PM 판단",
    )
    def test_보드_퍼즐수가_시드_board_문항수(self, mock_src, seed_items):
        seed_boards = sum(1 for it in seed_items if it["question_type"] == "board")
        mock_count = len(_array_elements(mock_src, "BOARD_PUZZLES"))
        assert mock_count == seed_boards, (
            f"mock BOARD_PUZZLES {mock_count}건 vs 시드 board {seed_boards}건 — "
            "mock으로는 퍼즐 커버리지를 판단할 수 없다"
        )

    def test_유형별_필드가_서버_이상(self, mock_src, seed_items):
        """mock 유형별 필드 집합 ⊇ 서버 노출 집합.

        서버가 내보내기 시작한 필드를 mock이 안 갖고 있으면, mock에서만 초록인
        (또는 반대로 mock에서만 렌더되는) 드리프트가 다시 생긴다.
        """
        # 서버 실측: 시드 × QUESTION_PAYLOAD_FIELDS + options 전용 컬럼
        server: dict[str, set[str]] = {}
        for item in seed_items:
            qtype = item["question_type"]
            template = item.get("template_json") or {}
            exposed = {
                key for key in QUESTION_PAYLOAD_FIELDS.get(qtype, ()) if key in template
            }
            if "options" in template:
                exposed.add("options")
            server.setdefault(qtype, set()).update(exposed)

        mock: dict[str, set[str]] = {}
        for raw, masked in _array_elements(mock_src, "SESSION_ITEMS"):
            qtype, fields = _mock_item_fields(raw, masked)
            if qtype:
                mock.setdefault(qtype, set()).update(fields)

        problems = []
        for qtype, exposed in server.items():
            if qtype not in mock:
                continue  # mock 커버리지 부족은 위 문항수 계약이 다룬다
            missing = exposed - mock[qtype]
            if missing:
                problems.append(f"{qtype}: mock에 없는 서버 필드 {sorted(missing)}")
        assert not problems, "mock↔서버 유형별 필드 드리프트:\n  " + "\n  ".join(problems)

    def test_mock이_정답성_필드를_응답에_싣지_않는다(self, mock_src):
        """mock 응답 필드에 correct_answer·explanation_hint가 없어야 서버 계약과 같다.

        (채점 정보는 `_mock` 안에만 두고 stripMock이 제거하는 것이 mock의 규약이다.)
        """
        leaks = []
        for raw, masked in _array_elements(mock_src, "SESSION_ITEMS"):
            qtype, fields = _mock_item_fields(raw, masked)
            for secret in ("correct_answer", "explanation_hint"):
                if secret in fields:
                    leaks.append(f"{qtype}: {secret}")
        assert not leaks, f"mock이 응답 필드로 정답을 노출: {leaks}"
