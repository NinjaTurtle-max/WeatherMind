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

# 시드 데이터 공백 허용 목록은 **없다**. S4(§2.4)가 slider 4문항의
# min·max·step·unit을 저작해 마지막 공백이 메워졌으므로, 예외 목록을 남기면
# "알려진 공백"이라는 거짓 진술이 상주하게 된다 — 빈 집합 계약으로 바꾼다.
# 새 유형·새 요구 필드가 저작 없이 들어오면 아래 test_시드_데이터_공백_없음이 잡는다.


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

    def test_시드_규모_고정(self):
        """규모 고정 — 증감 시 이 계약과 §0 영향표를 함께 갱신."""
        # R12 §9: 53+47+40+1(bs 보드) = 141
        # R13 2일차: +13 — 전수 재분류로 배치고사 후보 격자에 빈 칸이 드러나 메운 분
        #   (pressure_front adult 0 · typhoon middle_high 0 · air_mass elementary 0 ·
        #    heat_island adult 0). 저작이 아니라 **구멍 메우기**라 본시드 직행이었다.
        # R13 2일차 통합 병합: +83 = 237. 1단계 18 · 3단계 18 · 6단계 15 · 재난 15 ·
        #   보드 7 · 보드 규칙 확장 10. 단계 분포 36/43/37/62/28/31.
        # R13 잔여 웨이브 CO-L-F1: **+35 = 272.** adult 밴드(kl 5)에 basic-science 6태그와
        #   wildfire_weather가 **전건 0**이라 성인 유저가 그 유닛에서 0문항 세션을 받았다.
        #   7태그 × 5건 저작. 코드 폴백(CO-L2)은 굶주림을 막을 뿐이고 `docs/specs/11` §97의
        #   "level_group 3종 전부 저작"은 데이터로만 닫힌다 — 안전망 ≠ 스펙 준수.
        # R13 잔여 웨이브 CO-A2 저작(2026-08-09): board 34 → 46 · 시드 272 → 284.
        #   재난 축(wildfire 2→5 · flood 2→5)과 초등 공백(2→6)을 메웠다. 신규 12건은
        #   전부 guided + 팔레트 2 + 하위 밴드라 난이도 1이고, d1 블록 끝에 끼워
        #   기존 34건의 board_order를 뒤로 밀었다(단조 계약 유지).
        # R13-02 T2 저작 웨이브 1(2026-08-10): **+56 = 340.** 6 → 10단계 확장 직후
        #   하단(kl 1~3) 저작분이다. 재분류가 드러낸 **빈 칸 10개**를 먼저 메웠다:
        #   kl1 × (energy_transfer·heat_island·radiation_budget·temperature_heat) ·
        #   kl2 × typhoon · kl3 × (air_mass·anomaly·co2_climate·pressure_front·typhoon).
        #   유형은 board 0(판정 규칙 동반 저작이 필요해 생성·저작 대상 밖) 나머지 6종 혼합,
        #   explanation_hint 56/56 저작 — 사람 해설이 있으면 런타임이 LLM을 안 부른다.
        # 저작 웨이브 1-b(2026-08-10): **+58 = 398.** kl4 빈 칸 2개(energy_transfer·
        #   phase_change)와 1건짜리 5칸 보강 18건 + **kl8 신규 40건**(학부 대기과학).
        #   kl8은 10단계 확장으로 생긴 칸이라 3건뿐이었다. 상위 칸은 어휘 게이트가
        #   거의 무력하므로(8단계 문항은 8단계 이하 전 용어 통과) **표본 검수가 게이트를
        #   대신한다** — CO-B4-c 참조.
        # 저작 웨이브 1-c(2026-08-10): **+144 = 542.** 10단계 확장으로 생긴 상위 칸을
        #   4인 병렬로 채웠다 — kl6 64(고2~3 일반선택, 종전 **0건**) · kl9 40(학부
        #   고학년 종관, 종전 **0건**) · kl10 40(기상청 실무). 이제 **10단계 전건이 40건
        #   이상**이라 어느 단계로 배정돼도 세션이 굶지 않는다.
        #   ⚠️ 같은 배치에서 본시드 [44](태풍 강도)의 **사실 오류**를 고쳤다: 2026년
        #   개편으로 '중·강·매우 강·초강력' 등급 이름이 폐지되고 숫자 1~5가 됐다.
        #   풍속 경계(17·25·33·44·54)는 그대로라 문구 교체로 살렸고, 정답이 업무 규정
        #   수치이므로 kl 7 → **10**으로 재판정했다. 같은 문항이 staging au1에도 있어 함께 고쳤다.
        # 저작 웨이브 2-a(2026-08-10): +22 = 564. kl5 보강 — flood_response·
        # heat_island가 2건뿐이었고, 전체 유형에서 부족한 ordering·match 위주로 저작.
        assert len(_seed_items()) == 564


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

    def test_시드_데이터_공백_없음(self):
        """시드에 값 자체가 없는 (유형, 필드) 조합이 **하나도 없다** (S4 완료 후 계약).

        서버는 시드에 없는 키를 주입하지 않으므로(§2.1) 시드 공백은 그대로
        프론트 기본값 렌더(예: slider 0~100·무단위)로 이어진다 — 공백 자체가 결함이다.
        """
        gaps = {
            (item["question_type"], field, i)
            for i, item in enumerate(_seed_items())
            for field in REQUIRED_FIELDS[item["question_type"]]
            if field not in (item.get("template_json") or {})
        }
        assert not gaps, (
            "요구 필드가 시드에 저작되지 않은 문항: "
            f"{sorted(gaps)} — 저작 누락이거나 요구 필드 표가 바뀌었다"
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

    @pytest.mark.xfail(
        strict=True,
        reason="알려진 위반 (R10-07 S4 실측): QuestionCard.jsx의 slider 분기는 "
        "question.min/max/step/unit만 읽고 template_json 폴백이 없다. 서버는 "
        "그 4필드를 template_json 안에 실어 보내므로(§2.1) 시드에 저작해도 UI에는 "
        "닿지 않는다 — SSR 실측: template_json 모양 → min=0 max=100 무단위, "
        "최상위 평면 모양 → min=0 max=40 'm/s'. match·ordering은 폴백이 있어 무수정 "
        "연결됨. 프론트 소유 파일이라 이 스프린트 범위 밖 — 폴백이 추가되면 XPASS로 "
        "실패해 이 마커를 지우게 만든다.",
    )
    def test_slider_페이로드에_template_json_폴백이_있다(self):
        """위 test_요구_필드가_실제로_소비된다는 `question.X`만 있어도 통과한다 —
        서버가 실제로 쓰는 자리(template_json)를 프론트가 읽는지는 구분하지 못한다.
        그 구멍을 여기서 따로 고정한다(match: `question.pairs ?? question.template_json?.pairs`
        와 같은 폴백 idiom)."""
        src = QUESTION_CARD_PATH.read_text(encoding="utf-8")
        missing = [
            field
            for field in REQUIRED_FIELDS["slider"]
            if f"question.template_json?.{field}" not in src
        ]
        assert not missing, (
            f"slider {missing}에 template_json 폴백이 없다 — 서버가 보낸 저작값이 버려진다"
        )

    def test_유형_분기가_7종_전수(self):
        src = QUESTION_CARD_PATH.read_text(encoding="utf-8")
        branched = set(re.findall(r"question_type === '(\w+)'", src))
        # board는 isBoard 변수로 분기한다(question_type === 'board' 비교는 :43)
        missing = set(EXPECTED_TYPES) - branched
        assert not missing, f"프론트에 렌더 분기가 없는 유형: {sorted(missing)}"
