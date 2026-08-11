"""시드 데이터 계약 테스트 (S9) — database/seed/content_items.json이 §3.3을 준수하는가.

단일 진실원 원칙: 검증 로직을 테스트 안에 재기술하지 않고 실제 모듈을 쓴다.
- §3.3 스키마: backend app.scripts.seed_content.validate_entry (적재기가 쓰는 그 검증기)
- 품질 게이트 1단: ai-worker app.chains.validate_chain.run_heuristic_checks
  — ai-worker도 backend와 같은 최상위 패키지명 `app`을 쓰므로, sys.modules의
  backend `app.*`을 잠시 내리고 ai-worker 경로에서 임포트한 뒤 원상 복구한다.
- 허용 슬롯: backend app.services.session_service.ALLOWED_SLOTS / SLOT_RE

품질 게이트 요청 형태(§3.4)는 {"question": <template_json 형식>}이며 question에
question_type이 포함되므로, 시드의 형제 필드 question_type을 병합해 전달한다.
"""
import importlib
import json
import sys
from pathlib import Path

import pytest

from app.scripts.seed_content import validate_entry
from app.services.session_service import ALLOWED_SLOTS, SLOT_RE

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = REPO_ROOT / "database" / "seed"
SEED_PATH = SEED_DIR / "content_items.json"
UNITS_PATH = SEED_DIR / "units.json"
BADGES_PATH = SEED_DIR / "badges.json"
BOARD_RULES_PATH = SEED_DIR / "board_rules.json"
AI_WORKER_DIR = REPO_ROOT / "ai-worker"


def _import_ai_worker_validate_chain():
    """ai-worker의 validate_chain을 backend `app` 패키지와 충돌 없이 임포트."""
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module("app.chains.validate_chain")
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


validate_chain = _import_ai_worker_validate_chain()

SEED_ITEMS: list[dict] = json.loads(SEED_PATH.read_text(encoding="utf-8"))
ITEM_IDS = [f"{i:02d}-{item.get('concept_tag', '?')}" for i, item in enumerate(SEED_ITEMS)]


def _slots_of(item: dict) -> set[str]:
    """template_json 전체 문자열에서 {today.*} 슬롯 추출."""
    text = json.dumps(item.get("template_json", {}), ensure_ascii=False)
    return set(SLOT_RE.findall(text))


class TestSeedSchema:
    """§3.3 스키마 — 적재기(seed_content)의 검증기를 그대로 통과해야 한다."""

    def test_S8_AC_24건_이상(self):
        assert len(SEED_ITEMS) >= 24

    def test_시드_증보_누적(self):
        """R3~R5 증보 47건 + R7-01 배치 커버리지 보강 2건(§5)
        + R7-02 배치 취약 셀 보강 4건(docs/data/PLACEMENT_COVERAGE_R7.md §6.3) = 53건."""
        # R12 §9: 53(R3~R7 증보) + 47(기상 확장) + 40(기초과학) + 1(bs 보드) = 141
        # R13 2일차: +13 배치고사 격자 구멍 메우기 = 154. 전수 재분류로 셀이 다시
        # 갈리면서 네 셀이 0이 됐다 — 셀에 1건뿐이면 두 신고 그룹이 같은 문항을 집어
        # 서로소가 깨진다(test_placement의 TestDisjointPicksRealSeed가 잡은 지점).
        # R13 2일차 통합 병합: +83 = 237(1단계 18 · 3단계 18 · 6단계 15 · 재난 15 ·
        # 보드 7 · 보드 규칙 확장 10). 실질 0건이던 6단계가 31건이 됐다.
        # R13 잔여 웨이브(CO-L-F1): +35 = 272. `docs/specs/11:97`이 요구한
        # "level_group 3종 전부 저작"이 **데이터 레벨에서 위반**이었다 — kl5(adult)
        # 밴드에 basic-science 6태그(density_buoyancy·energy_transfer·phase_change·
        # pressure_basics·radiation_budget·temperature_heat)와 wildfire_weather가
        # **전건 0건**이었고, CO-L2의 전 밴드 필터는 안전망일 뿐 스펙 준수가 아니다.
        # 7태그 × 5건, 유형 혼합(mc·short_answer·cloze·match 각 7 · ordering 4 ·
        # slider 3, board 0), explanation_hint 35/35 저작(CO-I-1로 화면 노출 = LLM
        # 호출 대체). ordering이 4건인 것은 정규화 정답이 "0,1,2,3(,4)" 뿐이라
        # **태그당 패턴 수만큼만 가능**하기 때문이다 — phase_change는 세 패턴이
        # 이미 포화라 slider로 대체했다(CO-C5의 ordering 상한과 같은 계열).
        # R13-02 T2 저작 웨이브 1(2026-08-10): +56 = 340. 6 → 10단계 확장 직후
        # 하단(kl 1~3) 분이고, 재분류가 드러낸 **빈 칸 10개**를 먼저 메웠다.
        # ⚠️ CO-C5(ordering 상한)는 같은 날 해소됐다 — `answer_signature`가 ordering에
        # 항목 내용을, slider에 측정 축을 함께 넣어 정답 키가 내용을 보게 됐다.
        # 위 문단의 "패턴 수만큼만 가능"은 그 이전 기술이라 지금은 참이 아니다.
        # 저작 웨이브 1-b(2026-08-10): +58 = 398. kl4 보강 18 + kl8 신규 40.
        # 저작 웨이브 1-c(2026-08-10): +144 = 542. kl6 64 · kl9 40 · kl10 40 —
        # 10단계 확장으로 생긴 상위 칸을 4인 병렬로 채웠다. 10단계 전건 40건 이상.
        # 저작 웨이브 2-a(2026-08-10): +22 = 564. kl5 보강 — flood_response·
        # heat_island가 2건뿐이었고, 전체 유형에서 부족한 ordering·match 위주로 저작.
        # 저작 웨이브 2-b(2026-08-10): +45 = 609. kl7(고 진로선택) — 24건으로
        # 10단계 중 가장 얇았다. 이 배치가 어휘표 결함 2건을 드러냈다(아래 주석).
        # 저작 웨이브 2-c(2026-08-10): +70 = 679. kl1 35 · kl2 35 — 초등 두 칸이
        # 목표(각 100)에 거의 닿았다(98·94).
        # 저작 웨이브 2-d(2026-08-10): +60 = 739. kl3 40 · kl4 20.
        assert len(SEED_ITEMS) == 739

    @pytest.mark.parametrize(
        ("index", "item"), list(enumerate(SEED_ITEMS)), ids=ITEM_IDS
    )
    def test_스키마_위반_없음(self, index, item):
        assert validate_entry(item, index) == []

    def test_시드는_전건_active(self):
        """§3.3: 시드는 사람 저작이므로 status=active로 적재."""
        assert all(item.get("status") == "active" for item in SEED_ITEMS)

    def test_source_refs_근거_연결(self):
        """CONTENT_GUIDE: source.kind=seed + climate_concepts 근거 청크 참조 필수."""
        for i, item in enumerate(SEED_ITEMS):
            source = item.get("source") or {}
            # R12 §9: Claude 저작분은 kind="claude-authored"(출처 추적 — 회수 단위)
            assert source.get("kind") in ("seed", "claude-authored"), f"[{i}] source.kind"
            refs = source.get("refs")
            assert isinstance(refs, list) and refs, f"[{i}] source.refs 비어 있음"


class TestSeedCoverage:
    """S8 AC: 6태그 × 2학령 커버, 슬롯 문항 ≥ 6건."""

    def test_14태그_전부_존재(self):
        """기상 6종(R3~) + 기초과학 6종(R12 §9 — specs/11 §1) + 재난 2종(R13 §2.4).

        재난 축은 R13 1일차에 `ALLOWED_CONCEPT_TAGS`로 열렸지만 문항이 0건이라
        **빈 태그**였다(약점 태그·복습 큐의 빈 축이 되지 않도록 개방과 저작을 함께
        한다는 R12 AU-2 관례를 어긴 상태). 2일차 통합 병합으로 15건이 들어와
        실체가 생겼다. 지진은 범위 밖 확정(지질학) — 여기 늘어나면 안 된다.
        """
        tags = {item["concept_tag"] for item in SEED_ITEMS}
        assert tags == {
            "pressure_front", "typhoon", "air_mass",
            "heat_island", "co2_climate", "anomaly",
            "temperature_heat", "radiation_budget", "pressure_basics",
            "phase_change", "density_buoyancy", "energy_transfer",
            "wildfire_weather", "flood_response",
        }

    def test_태그마다_2개_이상_학령_커버(self):
        coverage: dict[str, set[str]] = {}
        for item in SEED_ITEMS:
            coverage.setdefault(item["concept_tag"], set()).add(item["level_group"])
        thin = {tag: groups for tag, groups in coverage.items() if len(groups) < 2}
        assert not thin, f"학령 커버 부족 태그: {thin}"

    def test_슬롯_문항_6건_이상(self):
        live = [item for item in SEED_ITEMS if item.get("uses_live_slots")]
        assert len(live) >= 6


class TestSeedSlots:
    """§3.3 허용 슬롯 5종만 사용, uses_live_slots 플래그와 실제 사용 일치."""

    def test_허용_슬롯만_사용(self):
        for i, item in enumerate(SEED_ITEMS):
            illegal = _slots_of(item) - set(ALLOWED_SLOTS)
            assert not illegal, f"[{i}] 허용되지 않은 슬롯: {illegal}"

    def test_uses_live_slots_플래그와_실사용_일치(self):
        """플래그 false인데 슬롯이 있으면 원문 노출, true인데 없으면 live 풀 오염."""
        for i, item in enumerate(SEED_ITEMS):
            has_slots = bool(_slots_of(item))
            assert bool(item.get("uses_live_slots")) == has_slots, (
                f"[{i}] uses_live_slots={item.get('uses_live_slots')} 이지만 "
                f"슬롯 사용={has_slots}"
            )

    def test_슬라이더_정답에는_슬롯_비사용(self):
        """현 시드 계약: 슬라이더 정답은 0~100 고정 숫자 문자열 (§3.3).

        슬롯 정답 슬라이더가 추가되면 품질 게이트 slider_range와의 관계를
        먼저 정의해야 한다 — 그 전까지 이 불변식을 고정한다.
        """
        for i, item in enumerate(SEED_ITEMS):
            if item["question_type"] == "slider":
                answer = str(item["template_json"]["correct_answer"])
                assert not SLOT_RE.search(answer), f"[{i}] 슬라이더 정답에 슬롯: {answer}"


class TestHeuristicQualityGate:
    """ai-worker 품질 게이트 1단(§3.4)을 시드 26건 전체가 통과한다."""

    @pytest.mark.parametrize(
        ("index", "item"), list(enumerate(SEED_ITEMS)), ids=ITEM_IDS
    )
    def test_휴리스틱_전체_통과(self, index, item):
        question = {**item["template_json"], "question_type": item["question_type"]}
        checks = validate_chain.run_heuristic_checks(question, item["concept_tag"])
        failed = [c for c in checks if not c["passed"]]
        assert not failed, f"[{index}] 휴리스틱 실패: {failed}"


# ═══════════════════════════════════════════════════════════════
# R3~R5 신규 시드 계약: units(12) · badges(5) · board_rules(8종)
# ═══════════════════════════════════════════════════════════════

from app.services import board_engine  # noqa: E402  (파일 하단 R3~R5 확장)

UNITS = json.loads(UNITS_PATH.read_text(encoding="utf-8"))
BADGES = json.loads(BADGES_PATH.read_text(encoding="utf-8"))
BOARD_RULES = json.loads(BOARD_RULES_PATH.read_text(encoding="utf-8"))


class TestUnitsSeedContract:
    """§3.2-R5: units.json 유닛 계약(로더/잠금 정합은 test_curriculum_tree가 담당).

    R12 AU-2: 기초과학 코스(specs/11 §2) bs- 8유닛 추가 — 기상 12 + 기초과학 8 = 20.
    코스 구분은 course 필드로 시드에서 파생한다(하드코딩 대신 시드 파생).
    """

    def test_24유닛_기상16_기초과학8(self):
        by_course: dict[str, int] = {}
        for u in UNITS:
            by_course[u.get("course")] = by_course.get(u.get("course"), 0) + 1
        assert len(UNITS) == 24
        assert by_course == {"weather": 16, "basic-science": 8}

    def test_섹션은_기상5_기초과학3(self):
        """기상 코스는 관측보고서 4섹션 + **재난 1섹션**(R13 CO-A1), 기초과학은 specs/11 §2의 3섹션.

        「위험한 하늘」은 R13에서 개통했다 — 재난 문항 15건이 시드에 있는데
        `units.json`에 유닛이 0건이라 **학습 경로에서 도달 불가**였다.
        """
        weather_sections = list(
            dict.fromkeys(u["section"] for u in UNITS if u.get("course") == "weather")
        )
        assert weather_sections == [
            "하늘 읽기", "공기의 힘", "큰 바람", "도시와 기후", "위험한 하늘",
        ]
        bs_sections = list(
            dict.fromkeys(
                u["section"] for u in UNITS if u.get("course") == "basic-science"
            )
        )
        assert bs_sections == ["열과 빛", "공기의 무게", "물과 에너지"]

    def test_board_유닛은_board_퍼즐_태그를_가진다(self):
        """board kind 유닛의 concept_tag는 board 퍼즐이 존재하는 태그여야 한다
        (§3.2 board 유닛은 해당 concept_tag board 퍼즐 사용).

        기상 코스 한정 계약: 기초과학 bs-convection-board(density_buoyancy)의
        퍼즐 귀속은 specs/11 §2 "기존 퍼즐 중 대류 중심 배치 선별 귀속"으로,
        au2 staging → content_items.json 병합이 PM 게이트 소관이라 본시드만 읽는
        이 테스트는 병합 전까지 기상 코스 board 유닛만 검증한다(병합 시 확장).
        """
        board_tags = {
            item["concept_tag"]
            for item in SEED_ITEMS
            if item["question_type"] == "board"
        }
        for u in UNITS:
            if u["kind"] == "board" and u.get("course") == "weather":
                assert u["concept_tag"] in board_tags, (
                    f"board 유닛 {u['id']}의 태그 {u['concept_tag']}에 board 퍼즐 없음"
                )


class TestBadgesSeedContract:
    """§3.3-R4: badges.json 5종(streak 3 + perfect_session + tier_promoted)."""

    def test_5종_코드_정확(self):
        codes = {b["code"] for b in BADGES}
        assert codes == {
            "streak_7", "streak_30", "streak_100",
            "perfect_session", "tier_promoted",
        }

    def test_필수_필드_존재(self):
        for b in BADGES:
            assert b.get("code") and b.get("title") and b.get("description"), b


V1_RULE_IDS = frozenset({
    "cold_front_shower", "stationary_front_monsoon", "warm_front_steady_rain",
    "siberian_snow", "convective_shower", "radiation_fog",
    "north_pacific_heatwave", "siberian_clear",
})
# v1 8규칙의 최저 priority. 확장 규칙은 전부 이 아래여야 한다 — 아래 테스트가 근거.
V1_MIN_PRIORITY = 30


class TestBoardRulesSeedContract:
    """§3.2-R3: board_rules.json v1 필수 8종 + priority 전역 유일 + 스키마 통과.

    R13 확장(BE-B, 2026-08-07): 사문 기단 2종(yangtze·okhotsk)을 살리고 전선·기단을
    쓰지 않는 순수 대류 규칙을 추가해 8 → 13종이 됐다. "8종"을 수로 고정하던 계약은
    **확장을 막을 뿐 기존 판정을 지켜주지 않으므로**, 지켜야 할 실질(=v1 8규칙의
    판정 불변)을 직접 고정하는 계약으로 바꾼다 — 아래 두 테스트가 그것이다.
    """

    def test_v1_8규칙이_전부_남아있다(self):
        ids = {r["id"] for r in BOARD_RULES}
        assert V1_RULE_IDS <= ids, f"v1 규칙 소실: {V1_RULE_IDS - ids}"
        assert len(BOARD_RULES) == len(ids), "규칙 id 중복"

    def test_확장_규칙은_v1보다_낮은_priority다(self):
        """v1 판정 불변의 **구조적 보증**: 확장 규칙 priority < v1 최저(30)이면,
        v1 규칙이 성립하는 어떤 존 상태에서도 확장 규칙이 이길 수 없다
        (엔진은 존별 최고 priority 1개만 적용 — board_engine.evaluate).
        수로 세는 계약(len == 8)이 막지 못하던 것이 정확히 이 회귀다."""
        for rule in BOARD_RULES:
            if rule["id"] in V1_RULE_IDS:
                assert rule["priority"] >= V1_MIN_PRIORITY, rule["id"]
            else:
                assert rule["priority"] < V1_MIN_PRIORITY, (
                    f"확장 규칙 {rule['id']}의 priority {rule['priority']}가 "
                    f"v1 최저 {V1_MIN_PRIORITY} 이상 — v1 판정을 덮을 수 있다"
                )

    def test_확장_규칙은_미배치_존_기본상태에서_성립하지_않는다(self):
        """미배치 존은 moisture=40·sun=50이고 판정이 cloudy/cumulus여야 한다(§3.2).
        기단·전선을 요구하지 않는 수치 전용 규칙이 이 기본값에서 성립하면 **보드의
        모든 빈 존이 한꺼번에 뒤집힌다** — 공유 벡터 전건이 무배치 존 3칸을 단정한다."""
        empty = {"zones": list(board_engine.ZONES), "elements": []}
        for outcome in board_engine.evaluate(empty, BOARD_RULES):
            assert outcome["rule_id"] is None, outcome
            assert (outcome["phenomenon"], outcome["cloud"]) == ("cloudy", "cumulus")

    def test_기단_4종이_전부_규칙에_쓰인다(self):
        """R13 발견: subtype enum에는 4종이 있는데 yangtze·okhotsk를 **어떤 규칙도
        참조하지 않아** 보드에 놓아도 항상 cloudy였다(사문 요소). 재발 방지."""
        conditions = {c for r in BOARD_RULES for c in r["when"]}
        for subtype in sorted(board_engine.AIR_MASS_SUBTYPES):
            assert any(c == f"air_mass:{subtype}" for c in conditions), (
                f"기단 {subtype}을(를) 참조하는 규칙이 없다 — 배치해도 판정이 바뀌지 않는다"
            )

    def test_전선_기단_없이_성립하는_규칙이_있다(self):
        """specs/11 §2 bs-convection-board(기초과학 3단계)는 전선·기단
        ([9과17-04] 4단계) 없이 성립하는 규칙이 있어야 저작 가능하다."""
        pure = [
            r for r in BOARD_RULES
            if all(not c.startswith(("front:", "air_mass:")) for c in r["when"])
        ]
        assert len(pure) >= 3, f"순수 조절값 규칙 부족: {[r['id'] for r in pure]}"

    def test_엔진_스키마_통과(self):
        """적재 없이 규칙 엔진 검증기를 그대로 통과(단일 진실원)."""
        board_engine.validate_rules(BOARD_RULES)  # 위반 시 BoardRulesError

    def test_priority_전역_유일(self):
        """엔진은 (priority, when집합) 동률만 거부 — 전역 priority 유일성은
        R5 리뷰가 수기 검증한 별도 계약이라 여기서 회귀 고정한다."""
        priorities = [r["priority"] for r in BOARD_RULES]
        assert len(priorities) == len(set(priorities)), f"priority 중복: {priorities}"

    def test_v1_필수_현상_전부_커버(self):
        """§3.2 v1 8규칙이 내는 대기현상(한랭전선 소나기·온난전선 비·정체전선 장마·
        대류성 소나기·복사안개·폭염·눈·맑음)이 모두 존재한다."""
        phenomena = {r["then"]["phenomenon"] for r in BOARD_RULES}
        required = {
            "shower", "rain", "persistent_rain",
            "fog", "heatwave", "snow", "clear",
        }
        assert required <= phenomena, f"누락 현상: {required - phenomena}"

    def test_v1_필수_조건_요소_전부_등장(self):
        """전선 3종·기단(시베리아·북태평양)이 규칙 조건에 등장(8규칙 계열 커버)."""
        conditions = " ".join(c for r in BOARD_RULES for c in r["when"])
        for token in ("front:cold", "front:warm", "front:stationary",
                      "air_mass:siberian", "air_mass:north_pacific"):
            assert token in conditions, f"필수 조건 요소 누락: {token}"
