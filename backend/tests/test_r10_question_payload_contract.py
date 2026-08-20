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
        # 저작 웨이브 2-b(2026-08-10): **+45 = 609.** kl7(고 진로선택) — 24건으로
        #   10단계 중 가장 얇았다. 이제 전 단계가 40건 이상이다.
        #   ⚠️ 이 배치가 **어휘표 결함 2건**을 드러냈고 둘 다 같은 날 고쳤다:
        #   ⑴ `기압경도력`이 8단계였는데 `[12고지02-03]`은 '압력 경도력·전향력·원심력·
        #      마찰력'을 **한 문장에 묶는다** — 전향력은 7인데 이것만 8이었다. basis가
        #      "세부 코드 미확인"이라 standard가 null이었고, 그 탓에 10단계 기계 재배치가
        #      교육과정 밖(8)으로 보냈다. → **7로 정정**
        #   ⑵ 띄어쓴 `기압 경도력`이 어휘표에 **없어서 게이트를 그냥 통과**했다.
        #      본시드 6건이 이 표기를 쓴다. 감률 계열은 '건조 단열'처럼 띄어쓴 변형을
        #      일부러 등재해 뒀는데 이 항목만 빠져 있었다. → **변형 등재**
        # 저작 웨이브 2-c(2026-08-10): **+70 = 679.** kl1 35 · kl2 35.
        #   저작자가 **어휘 게이트가 통과시켰을 문항을 스스로 버린** 사례를 남겼다:
        #   "하루 최고기온 몇 ℃ 이상이면 폭염인가"(33℃)는 금칙어가 하나도 없어 게이트를
        #   지나가지만, 정답이 **특보 발표 기준**이라 스펙 03 규칙 4에 따라 10단계다.
        #   B4가 실증한 "게이트는 어휘만 본다"의 반대 방향 사례 — 상위 단계 지식이
        #   **수치의 출처**로 숨어 있는 경우다.
        # 저작 웨이브 2-d(2026-08-10): **+60 = 739.** kl3 40 · kl4 20. 저작자가
        #   본시드 편중(kl3는 density_buoyancy·temperature_heat, kl4는 air_mass·
        #   pressure_front 포화)을 실측하고 **빈 칸부터** 채웠다. 판정 기준을
        #   "풀이가 닫히는 데 필요한 것이 물질 하나의 성질인가(3), 대기라는 계의
        #   작동인가(4)"로 세우고, 문항마다 **정박한 물리량**을 `source.refs[1]`에
        #   적게 해 이름을 못 대면 폐기했다 — "쉬운 말로 쓴 어려운 추론"의 대응책이다.
        # 저작 웨이브 3-a(2026-08-10): +15 = 754. kl5 잔여 — **kl5가 정확히 100건**으로
        #   목표에 닿은 첫 단계다. 하위 5칸(1~5)이 모두 94건 이상이 됐다.
        # 저작 웨이브 3-b(2026-08-10): **+120 = 874.** kl6 30 · kl10 30 · kl8 30 · kl9 30.
        #   **전 단계가 69건 이상**이 됐다. kl10 저작자가 수치 근거를 신뢰도 등급으로
        #   나눠 보고했고(1차 페이지 직접 조회 / 인용 / 검색만), 약한 것을 스스로 표시했다.
        #   ⚠️ PM이 1건 교체: kl6 '질소 78%' slider는 **정답 자체가 kl3~4 사실**(공기 조성)
        #   이고 6단계다움이 해설에만 있었다 — 저작자가 유보로 표시해 왔고 그 판정이 옳았다.
        #   '갇힌 여분의 열 중 바다가 흡수한 몫'(90%)으로 바꿔 6단계 사고가 답을 고르는 데
        #   쓰이게 했다.
        # 저작 웨이브 4-a(2026-08-10): **+6 = 880.** kl6 잔여 — kl5·kl6이 각 100건이
        #   됐고 하위 6칸이 모두 94건 이상이다.
        #   ⚠️ 같은 커밋에서 **채점 결함 2건**을 고쳤다(kl8·9 저작자가 승격 뒤 이관):
        #   ⑴ slider 60노트/정답 30 — '3분의 1' 오독값 20이 정답과 거리 **정확히 10**이고
        #      관용오차가 `<= 10` **포함**이라 오독이 정답 처리됐다 → 90노트/45로 교체.
        #   ⑵ cloze 정답 '하강' — 완전 일치 채점이라 개념상 맞는 '낮아진다'가 오답 →
        #      정량 답(시간당 2hPa)으로 교체.
        #   둘 다 **게이트는 통과**했다. 채점 단계의 결함은 lint가 보지 않는다.
        # 저작 웨이브 4-b(2026-08-10): **+120 = 1000 — 대회 목표 달성.**
        #   kl7·8·9 각 100(마지막 저작자 88건) · kl10 100(PM 26건) · kl2 100(PM 6건).
        #   **하루에 284 → 1000**(+716). 단계 분포 `98/100/98/104/100/100/100/100/100/100`
        #   — 10칸이 모두 98건 이상이라 어느 단계로 배정돼도 세션이 굶지 않는다.
        #   14개념 태그 전건 사용 · explanation_hint 921/1000(92%)이라 그만큼 런타임
        #   LLM 호출이 사람 해설로 대체된다.
        # R13-02 T3 실황(2026-08-12): **+12 = 1012.** 실황 문항 8 → 20건.
        #   그중 4건은 `correct_answer` 자체가 `{today.*}` 슬롯이라 **정답이 날마다
        #   바뀐다** — 종전 8건은 전부 MC·정답 고정이라 슬롯이 배경 장식이었다.
        #   4건 전부 `short_answer`인 것은 선택이 아니라 제약이다: slider에 슬롯
        #   정답을 넣으면 `validate_chain.slider_range`·계약 G `check_payload`·
        #   `seed_content.validate_entry` 세 곳이 "정답이 숫자가 아님"으로 떨군다.
        # staging board 승격(2026-08-14): **+3 = 1015.** board 46 → 49
        #   (CO-I-2/X-1 잔여 — 셋 다 `pressure_front`·kl4라 **조작 다양성은 안 는다**.
        #   그 판정은 CO-K4(조건 문법이 2형뿐)가 소유한다).
        # ㉣ 상위 보드 3판(2026-08-18): +3 = **1018** · board 49 → 52.
        # MT-19 일기도 판독 1판(2026-08-18): +1. **이 판은 새 규칙을 쓰지 않는다** —
        # 판독은 새 물리가 아니라 **읽는 방향의 반전**이라(기존 보드는 원인을 놓아
        # 결과를 만들고, 이 판은 결과를 읽어 원인을 고른다) 기존 `cold_front_shower`가
        # 그대로 판정한다. 규칙 파일·엔진·현상 어휘 변경이 0이다.
        # ⚠️ 자리는 **47**이다(처음 53에 붙였다가 내렸다) — kl6 보드가 expert kl7~10
        # 블록 뒤에 앉으면 adult 학습자가 kl9~10 재난 보드를 지나야 닿는다. 종전
        # 47~52는 48~53으로 밀렸고, **배포 전이라 재잠금되는 학습자가 0명**이었다(§5.19).
        # MT-18 전문가 보드 2판(2026-08-18): +2 · board_order **54·55**.
        # 태풍(kl9) · 온실효과=열대야(kl10). **새 배치 요소는 0개**이고 둘 다 기존 5종의
        # 조합으로 성립한다 — 요소를 늘리면 프론트 팔레트·UI·i18n까지 번진다.
        # ⚠️ ㉣ 3판과 같은 구조적 이유로 **규칙과 보드가 같은 PR이어야 한다**:
        # `test_weather_phenomenon.TestSeedCoverage`가 「현상마다 실제 board 문항이
        # 있다」를 물어, 규칙만 넣으면 새 현상 2종에서 즉시 빨강이 된다.
        # ⇒ 두 몫을 합쳐 **1021문항 · board 55판**이다.
        # 경계층·대기역학·대기물리 보드 6판(2026-08-20): **+6 = 1027** · board 55 → **61**.
        # 클라이언트 지시(전문가 수준 대기역학·대기물리 다양화). **새 규칙·새 요소·새
        # 개념 태그 0건** — 기존 4조건 규칙 3종(cold_front_squall_storm ·
        # tropical_cyclone_genesis · greenhouse_tropical_night)의 **고유 결과**만
        # 목표로 삼았다. 4조건 규칙이 아닌 목표(fog·clear·shower)를 쓰면 우선순위가
        # 높은 2조건 규칙이 먼저 이겨 「가르치려는 요소를 빼도 목표를 채운다」가 된다.
        # 보드가 안 쓰던 개념 태그 4종(phase_change·temperature_heat·energy_transfer·
        # radiation_budget)을 활용해 대기물리·경계층 축을 태그 수준에서도 열었다.
        # 🔴 병합(2026-08-20): 연무 1판 + 통합 브랜치 2판 = **1030** · board **64**
        assert len(_seed_items()) == 1030


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
