"""문항 유형별 페이로드 노출 — 유형 전수 계약 가드 (스프린트 R10-07 §2.2, S2).

이 스프린트의 진짜 산출물. `_board_template_json`이 board만 화이트리스트를 반환하고
나머지 유형은 None이라, match의 `pairs`·ordering의 `items`가 **API 응답에 존재하지
않아** 프론트가 항목 0개로 렌더했다(실서버에서 6문항 = 시드 11%가 풀 수 없는 상태).

기존 테스트가 이걸 못 잡은 이유(§0):
- `test_session_board_item.py`의 화이트리스트 계약은 **board만** 감시한다.
- 프론트 mock은 손으로 쓴 픽스처라 `pairs`·`items`를 이미 갖고 있다.
→ 그래서 여기서는 **시드 전건 × 7유형 전수**로, 서버 직렬화 산출물(SessionItem)이
   프론트 QuestionCard.jsx가 요구하는 필드를 실제로 담는지 검증한다.

검증 경로는 실서빙과 동일하다:
  session_service.create_daily_session(:502-506) = {**template_json, concept_tag,
  question_type} → routers/session._to_session_item → SessionItem.model_dump()
데일리·유닛·배치 세션이 모두 `session_today_response` → `_to_session_item`을 쓰므로
이 한 지점이 전 세션 모드의 계약이다.
"""
import json
import re
from pathlib import Path

import pytest

from app.routers.session import _to_session_item

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"
QUESTION_CARD_PATH = (
    REPO_ROOT / "frontend" / "src" / "modules" / "quiz" / "QuestionCard.jsx"
)

# ── 프론트 요구 필드 표 (근거: QuestionCard.jsx 유형별 렌더 분기) ──────────────
#   multiple_choice : (question.options ?? []).map(...)                      :63
#   short_answer    : 텍스트 입력 — 추가 페이로드 불필요                      :80
#   cloze           : question_text의 ___ 자리 — 추가 페이로드 불필요         :80
#   slider          : question.min/max/step/unit (없으면 0~100 기본값)        :110-126
#   board           : AtmosphereBoard(puzzle=question.template_json)         :148
#   match           : question.pairs ?? question.template_json?.pairs        :172
#   ordering        : question.items / question.shuffled (+ template_json)   :293-294
REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "multiple_choice": ("options",),
    "short_answer": (),
    "cloze": (),
    "slider": ("min", "max", "step", "unit"),
    # board 렌더 필수 집합 = test_session_board_item.RENDER_REQUIRED와 동일
    "board": (
        "question_text",
        "mode",
        "initial_state",
        "palette",
        "goal_conditions",
        "hints",
    ),
    "match": ("pairs",),
    "ordering": ("items", "shuffled"),
}

# 7유형 전수 — 시드에 하나라도 0건이면 실패(가드가 조용히 무력화되는 경로 차단, §2.2)
EXPECTED_TYPES = frozenset(REQUIRED_FIELDS)

# 어떤 유형의 응답에도 실려선 안 되는 필드 (§2.1 — 정답·정답 유도)
SECRET_FIELDS = ("correct_answer", "explanation_hint")

# S4(데이터 저작) 대기 중인 **알려진 시드 공백**. 서버 직렬화 결함이 아니라 시드에
# 값이 없는 것이며, 빈 값·기본값 주입은 금지(§2.1)라 노출도 되지 않는다.
# 새 공백이 생기면 실패하고, S4가 채우면 그냥 사라진다(부분집합 계약).
KNOWN_SEED_GAPS = frozenset(
    {("slider", "min"), ("slider", "max"), ("slider", "step"), ("slider", "unit")}
)


def _seed_items() -> list[dict]:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def _serve(item: dict) -> dict:
    """시드 1건 → API 응답 dict (실서빙 경로와 동일 조립)."""
    question = {
        **(item.get("template_json") or {}),
        "concept_tag": item["concept_tag"],
        "question_type": item["question_type"],
    }
    return _to_session_item(
        "20260803-000",
        question,
        item.get("level_group", "middle_high"),
        source="bank",
        slot_filled=False,
    ).model_dump()


def _visible(dump: dict) -> dict:
    """프론트가 읽는 필드 집합 — `question.X ?? question.template_json?.X` 폴백 반영."""
    return {**(dump.get("template_json") or {}), **dump}


def _label(item: dict, index: int) -> str:
    return f"[{index}] {item['question_type']}/{item['concept_tag']}"


class TestSeedTypeCoverage:
    """공허 통과 방지 — 요구 필드 표와 시드 유형이 서로를 덮는다."""

    def test_시드_유형이_7종_전수(self):
        types = {it["question_type"] for it in _seed_items()}
        assert types == set(EXPECTED_TYPES), (
            f"시드 유형과 요구 필드 표 불일치 — 표에만 있음: {sorted(set(EXPECTED_TYPES) - types)}, "
            f"시드에만 있음: {sorted(types - set(EXPECTED_TYPES))}"
        )

    def test_유형별_시드_1건_이상(self):
        items = _seed_items()
        counts = {t: sum(1 for it in items if it["question_type"] == t) for t in EXPECTED_TYPES}
        empty = [t for t, n in counts.items() if n == 0]
        assert not empty, f"시드 0건 유형 — 가드가 무력화된다: {empty} (counts={counts})"

    def test_시드_53문항(self):
        """규모 고정 — 증감 시 이 계약과 §0 영향표를 함께 갱신."""
        assert len(_seed_items()) == 53


class TestEverySeedItemIsPlayable:
    """§2.2 핵심 — 시드 전건이 프론트 요구 필드를 응답에 갖는다."""

    def test_전건_요구_필드_노출(self):
        broken: list[str] = []
        for i, item in enumerate(_seed_items()):
            qtype = item["question_type"]
            template = item.get("template_json") or {}
            visible = _visible(_serve(item))
            for field in REQUIRED_FIELDS[qtype]:
                if field not in template:
                    continue  # 시드 부재는 아래 데이터 공백 계약이 담당
                if field not in visible:
                    broken.append(f"{_label(item, i)}: {field} 미노출")
                elif visible[field] != template[field]:
                    broken.append(f"{_label(item, i)}: {field} 변형/소실")
        assert not broken, (
            "시드에 값이 있는데 API 응답에 없는 필드 — 프론트가 렌더하지 못한다:\n  "
            + "\n  ".join(broken)
        )

    def test_데이터_공백은_알려진_것뿐(self):
        """시드에 값 자체가 없는 (유형, 필드) 조합은 S4 대기분에 한정된다."""
        gaps = {
            (item["question_type"], field)
            for item in _seed_items()
            for field in REQUIRED_FIELDS[item["question_type"]]
            if field not in (item.get("template_json") or {})
        }
        assert gaps <= KNOWN_SEED_GAPS, (
            f"알려지지 않은 시드 데이터 공백: {sorted(gaps - KNOWN_SEED_GAPS)} — "
            "저작 누락이거나 요구 필드 표가 바뀌었다"
        )

    def test_전건_정답_미노출(self):
        leaks: list[str] = []
        for i, item in enumerate(_seed_items()):
            dump = _serve(item)
            flat = json.dumps(dump, ensure_ascii=False, default=str)
            for secret in SECRET_FIELDS:
                if secret in dump or secret in (dump.get("template_json") or {}):
                    leaks.append(f"{_label(item, i)}: {secret}")
                assert f'"{secret}"' not in flat, f"{_label(item, i)}: {secret} 직렬화 유출"
        assert not leaks, "정답성 필드 유출:\n  " + "\n  ".join(leaks)

    def test_전건_최소_렌더_가능(self):
        """어떤 유형이든 문항 문구는 비어있지 않다(board는 template_json 경유)."""
        for i, item in enumerate(_seed_items()):
            visible = _visible(_serve(item))
            assert visible.get("question_text"), f"{_label(item, i)}: question_text 없음"


class TestPayloadPassthrough:
    """저작되면 노출된다 — 유형별 화이트리스트의 통과 계약 (시드 데이터와 독립).

    slider처럼 지금 시드에 값이 없는 유형도 여기서 직렬화 계약을 고정해 두면
    S4가 값을 채우는 순간 자동으로 프론트에 붙는다.
    """

    CASES = {
        "match": {
            "pairs": [{"left": "겨울", "right": "시베리아 기단"}],
        },
        "ordering": {
            "items": ["a", "b", "c"],
            "shuffled": True,
        },
        "slider": {"min": 0, "max": 40, "step": 1, "unit": "m/s"},
        "multiple_choice": {"options": ["1", "2"]},
    }

    @pytest.mark.parametrize("qtype", sorted(CASES))
    def test_요구_필드_통과(self, qtype):
        question = {
            "question_type": qtype,
            "concept_tag": "typhoon",
            "question_text": "문항 문구",
            "correct_answer": "비밀",
            "explanation_hint": "정답 유도 해설",
            **self.CASES[qtype],
        }
        dump = _to_session_item(
            "20260803-001", question, "middle_high", source="bank", slot_filled=False
        ).model_dump()
        visible = _visible(dump)
        for field, value in self.CASES[qtype].items():
            assert visible.get(field) == value, f"{qtype}: {field} 미노출"
        for secret in SECRET_FIELDS:
            assert secret not in visible, f"{qtype}: {secret} 유출"

    @pytest.mark.parametrize("qtype", ["short_answer", "cloze"])
    def test_추가_페이로드_불필요_유형은_None(self, qtype):
        question = {
            "question_type": qtype,
            "concept_tag": "typhoon",
            "question_text": "문항 문구",
            "correct_answer": "비밀",
        }
        item = _to_session_item(
            "20260803-002", question, "middle_high", source="bank", slot_filled=False
        )
        assert item.template_json is None

    def test_시드에_없는_키는_주입되지_않는다(self):
        """빈 값·기본값 주입 금지(§2.1) — 데이터 부재가 가려지면 S4를 못 찾는다."""
        question = {
            "question_type": "slider",
            "concept_tag": "typhoon",
            "question_text": "태풍 기준 풍속은?",
            "correct_answer": "17",
        }
        dump = _to_session_item(
            "20260803-003", question, "middle_high", source="bank", slot_filled=False
        ).model_dump()
        payload = dump.get("template_json") or {}
        for field in ("min", "max", "step", "unit"):
            assert field not in payload, f"{field}에 기본값이 주입됐다"


class TestFrontendRequirementSource:
    """요구 필드 표 ↔ QuestionCard.jsx 실제 소비 (소스 텍스트 계약).

    프론트가 새 필드를 소비하기 시작했는데 표가 안 따라오면 이 스프린트의 결함이
    그대로 재발한다. board는 AtmosphereBoard가 소비하므로
    test_session_board_item.py의 양방향 계약이 담당한다(중복 감시 회피).
    """

    def test_프론트_파일_존재(self):
        assert QUESTION_CARD_PATH.exists(), "QuestionCard.jsx 경로 변경 시 이 계약을 갱신할 것"

    @pytest.mark.parametrize(
        "qtype,field",
        [
            (t, f)
            for t, fields in REQUIRED_FIELDS.items()
            if t != "board"
            for f in fields
        ],
    )
    def test_요구_필드가_실제로_소비된다(self, qtype, field):
        src = QUESTION_CARD_PATH.read_text(encoding="utf-8")
        pattern = re.compile(
            rf"question(?:\?)?\.(?:template_json\?\.)?{re.escape(field)}\b"
        )
        assert pattern.search(src), (
            f"{qtype} 요구 필드 {field}를 QuestionCard.jsx에서 못 찾음 — "
            "요구 필드 표가 프론트와 어긋났다"
        )

    def test_유형_분기가_7종_전수(self):
        src = QUESTION_CARD_PATH.read_text(encoding="utf-8")
        branched = set(re.findall(r"question_type === '(\w+)'", src))
        # board는 isBoard 변수로 분기한다(question_type === 'board' 비교는 :43)
        missing = set(EXPECTED_TYPES) - branched
        assert not missing, f"프론트에 렌더 분기가 없는 유형: {sorted(missing)}"
