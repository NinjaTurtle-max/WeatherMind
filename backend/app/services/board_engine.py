"""대기 보드 퍼즐 규칙 엔진 — 스프린트 R3-01 §3.1·§3.2 (R3-S1py).

순수 함수 모듈: DB·네트워크 의존 없음. 프론트 JS 인터프리터와 동일 입력→동일
판정을 보장해야 하므로(§ R3-S1 AC), 판정 의미론을 여기 명문화한다:

- 보드(§3.1): 존 0~3 고정. 배치 요소는 air_mass·front·moisture·sun·**wind** 5종이고
  존당 기단·전선 각 최대 1, moisture/sun/wind 존당 각 최대 1(0~100). 미배치 존의
  moisture/sun/wind는 기본값 40/50/**20**.
- 조건(§3.2)은 정확히 2형만 허용: "<type>:<subtype>"(존재 검사, type은
  air_mass|front) / "<field><op><숫자>"(field는 moisture|sun|wind, op는 >=·<= 만).
  그 외 문법은 규칙 스키마 검증에서 거부한다(인터프리터 단순성 유지 — 계약 고정).

- **wind는 왜 subtype(방향)이 아니라 level(세기)인가** (R13 재난 보드 확장):
  판정은 "조건이 전부 **같은 존**에서 AND로 성립"이고 엔진에 존↔존 전파가 없다.
  방향(북서풍·남서풍)이 의미를 갖는 것은 "어디에서 어디로 옮겨 가느냐"인데,
  그 축이 엔진에 없으므로 방향을 subtype으로 넣어도 **판정에 기여할 수 없는
  사문 요소**가 된다(기단 yangtze·okhotsk가 규칙에 안 쓰여 사문이던 R13 발견과
  같은 성격). 반면 세기(강풍)는 산불 위험·수증기 유입 강도를 직접 좌우하고
  기존 부등호 문법이 그대로 표현한다 — **새 조건 문법을 0개 늘리고** 파이썬·JS
  이중 구현의 대조면을 넓히지 않는다. 방향은 판정이 아니라 표시의 문제로 남긴다.
- 판정: 존별로 when 조건이 전부 그 존에서 성립(AND)하는 규칙 중 priority 최고
  1개를 적용. priority 동률이면 규칙 파일 순서상 앞선 규칙(결정적 판정 —
  같은 조건에 같은 priority는 §3.2가 금지하며 스키마 검증이 거부한다).
  성립 규칙이 없으면 {"phenomenon": "cloudy", "cloud": "cumulus"}.
- 규칙 파일: 기본 database/seed/board_rules.json, 환경변수 BOARD_RULES_PATH로
  오버라이드. 데이터 직군이 병렬 저작 중이므로 부재 시 명확한 예외
  (BoardRulesNotFoundError)를 낸다. 로드 결과는 프로세스 캐시(경로 키).
"""
import json
import os
import re
from pathlib import Path
from typing import Any

# ── 보드 모델 계약 (§3.1) ──
ZONES = ("서해", "수도권", "태백산맥", "동해안")  # index 0~3 고정
ZONE_COUNT = len(ZONES)
AIR_MASS_SUBTYPES = frozenset({"siberian", "north_pacific", "yangtze", "okhotsk"})
FRONT_SUBTYPES = frozenset({"cold", "warm", "stationary"})
ELEMENT_SUBTYPES = {"air_mass": AIR_MASS_SUBTYPES, "front": FRONT_SUBTYPES}
LEVEL_TYPES = ("moisture", "sun", "wind")    # 존당 1개, level 0~100
PLACEABLE_TYPES = frozenset({"air_mass", "front", "moisture", "sun", "wind"})
DEFAULT_MOISTURE = 40                        # 미배치 존 기본값 (§3.1)
DEFAULT_SUN = 50
# 평상시 약한 바람. 낮게 잡는 것이 계약이다 — 재난 규칙이 wind>= 로 발화하므로
# 기본값이 높으면 **미배치 존 전부가 재난으로 뒤집힌다**
# (test_seed_contract.test_확장_규칙은_미배치_존_기본상태에서_성립하지_않는다).
DEFAULT_WIND = 20
LEVEL_DEFAULTS = {"moisture": DEFAULT_MOISTURE, "sun": DEFAULT_SUN, "wind": DEFAULT_WIND}

# ── 판정 출력 계약 (§3.2) ──
# wildfire_risk·flood_risk는 R13 재난 축 확장(CO-A3·CO-K4) — "재난 보드가 clear를
# 목표로 삼는" 상태를 끝내려면 재난이 **판정 결과**로 존재해야 한다.
PHENOMENA = frozenset(
    {
        "shower", "rain", "persistent_rain", "snow", "fog", "heatwave", "clear",
        "cloudy", "wildfire_risk", "flood_risk",
        # ㉣ 4조건 규칙의 **고유 결과**(2026-08-18 PM 판정). 이름은 기상청 어휘를
        # 따른다 — 「위험(주의보)」 위의 **경보급**이고, 조건 4개가 동시에 맞을 때만 난다.
        # ⚠️ **왜 고유 결과가 필요했나**: 4조건 규칙이 지름길(2조건)과 같은 현상을
        # 내면 `check_goals`가 둘을 구분할 수 없어(rule_id 축이 없다) **가르치려는
        # 요소를 무시해도 통과**했다. 그리고 그 요소를 놓으면 v1 규칙이 이겨
        # **오히려 실패**했다 — 무시가 통과하고 배움이 실패하는 역전이었다.
        # rule_id로 채점하는 길(ⓐ)은 기각했다: 정당한 다른 경로로 목표 날씨를 만든
        # 학습자가 오답이 되어 §3.2(결과가 채점 대상)를 뒤집는다.
        "severe_storm", "wildfire_warning", "flood_warning",
        # MT-18 전문가 보드(2026-08-18) — 태풍·온실효과. 역시 **조건 4개 규칙의
        # 고유 결과**라 위 3종과 같은 계약 위에 선다(priority > 100).
        # ⚠️ **새 배치 요소는 0개다** — 둘 다 기존 5종(기단·전선·습기·일사·바람)의
        # 조합으로 성립한다. 요소를 늘리면 프론트 팔레트·UI·i18n까지 번진다.
        # `tropical_night`(열대야)이 온실효과 왕복 구조의 결과 이름이다 —
        # 「CO₂를 놓으면 더워진다」가 아니라 **되돌리는 기체(수증기)와 밤**을
        # 조작하게 만든 결과다(board_rules.json note_authoring 참조).
        "typhoon", "tropical_night",
    }
)
CLOUDS = frozenset({"cumulonimbus", "nimbostratus", "stratus", "cumulus", "none"})
DEFAULT_OUTCOME = {"phenomenon": "cloudy", "cloud": "cumulus"}  # 무성립 기본값

# 피드백 폴백 문구 (§3.4 — RAG 미호출 경로의 정적 문구)
FEEDBACK_PASS_DEFAULT = "목표한 대기현상을 만들어냈어요! 요소의 배치가 날씨를 결정합니다."
FEEDBACK_FAIL_DEFAULT = "아직 목표 현상이 나타나지 않았어요. 요소 배치를 바꿔 다시 시도해 보세요."

# ── 규칙 파일 로더 설정 ──
BOARD_RULES_ENV_VAR = "BOARD_RULES_PATH"
DEFAULT_RULES_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "board_rules.json"
)
_rules_cache: dict[str, list[dict[str, Any]]] = {}

# 조건 문법 2형 (§3.2) — 이 두 정규식 외의 문법은 전부 거부
_PRESENCE_RE = re.compile(r"^(air_mass|front):([a-z_]+)$")
_NUMERIC_RE = re.compile(r"^(moisture|sun|wind)(>=|<=)(\d+(?:\.\d+)?)$")


class BoardValidationError(Exception):
    """§3.1 보드 모델 위반 (유저 제출 board_state — 라우터에서 422 변환)."""


class BoardRulesError(Exception):
    """규칙 JSON 스키마 위반 (데이터 저작 오류 — 라우터에서 503 변환)."""


class BoardRulesNotFoundError(BoardRulesError):
    """규칙 파일 부재 (데이터 직군 저작 대기 — 라우터에서 503 변환)."""


# ═══════════════════════════════════════════════════════════════
# 보드 검증 (§3.1)
# ═══════════════════════════════════════════════════════════════


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_board(board: Any) -> None:
    """§3.1 보드 모델 검증. 위반 시 BoardValidationError (사유 포함)."""
    if not isinstance(board, dict):
        raise BoardValidationError("board는 객체여야 합니다")
    zones = board.get("zones")
    if zones is not None and (not isinstance(zones, list) or len(zones) != ZONE_COUNT):
        raise BoardValidationError(f"zones는 {ZONE_COUNT}개 존 배열이어야 합니다")
    elements = board.get("elements", [])
    if not isinstance(elements, list):
        raise BoardValidationError("elements는 배열이어야 합니다")

    # 존당 개수 제약: 기단·전선 각 최대 1, moisture/sun 각 최대 1 (§3.1)
    per_zone_counts: dict[tuple[int, str], int] = {}
    for index, element in enumerate(elements):
        prefix = f"elements[{index}]"
        if not isinstance(element, dict):
            raise BoardValidationError(f"{prefix}: 요소는 객체여야 합니다")
        etype = element.get("type")
        if etype not in PLACEABLE_TYPES:
            raise BoardValidationError(
                f"{prefix}: 배치 불가 type {etype!r} (허용: {sorted(PLACEABLE_TYPES)})"
            )
        zone = element.get("zone")
        if not isinstance(zone, int) or isinstance(zone, bool) or not 0 <= zone < ZONE_COUNT:
            raise BoardValidationError(f"{prefix}: zone은 0~{ZONE_COUNT - 1} 정수여야 합니다")

        if etype in ELEMENT_SUBTYPES:
            subtype = element.get("subtype")
            if subtype not in ELEMENT_SUBTYPES[etype]:
                raise BoardValidationError(
                    f"{prefix}: {etype} subtype {subtype!r} 불허 "
                    f"(허용: {sorted(ELEMENT_SUBTYPES[etype])})"
                )
        else:  # moisture | sun | wind
            level = element.get("level")
            if not _is_number(level) or not 0 <= level <= 100:
                raise BoardValidationError(f"{prefix}: {etype} level은 0~100이어야 합니다")

        key = (zone, etype)
        per_zone_counts[key] = per_zone_counts.get(key, 0) + 1
        if per_zone_counts[key] > 1:
            raise BoardValidationError(
                f"{prefix}: 존 {zone}에 {etype}이(가) 2개 이상 배치됨 (존당 최대 1)"
            )


def zone_states(board: dict[str, Any]) -> list[dict[str, Any]]:
    """검증된 보드를 존별 판정 상태 4개로 정규화한다 (미배치 기본값 적용).

    반환 각 항목: {"air_mass": subtype|None, "front": subtype|None,
                  "moisture": 0~100, "sun": 0~100, "wind": 0~100}
    """
    states = [
        {"air_mass": None, "front": None, **LEVEL_DEFAULTS}
        for _ in range(ZONE_COUNT)
    ]
    for element in board.get("elements", []):
        state = states[element["zone"]]
        etype = element["type"]
        if etype in ELEMENT_SUBTYPES:
            state[etype] = element["subtype"]
        else:
            state[etype] = element["level"]
    return states


# ═══════════════════════════════════════════════════════════════
# 조건 파싱·평가 (§3.2 — 2형 문법만)
# ═══════════════════════════════════════════════════════════════


def parse_condition(condition: Any) -> tuple:
    """조건 문자열 → ("presence", type, subtype) | ("numeric", field, op, value).

    §3.2 문법 2형 외에는 BoardRulesError (op는 >=·<= 만, field는 moisture|sun|wind).
    """
    if not isinstance(condition, str):
        raise BoardRulesError(f"조건은 문자열이어야 합니다: {condition!r}")
    match = _PRESENCE_RE.match(condition)
    if match:
        etype, subtype = match.group(1), match.group(2)
        if subtype not in ELEMENT_SUBTYPES[etype]:
            raise BoardRulesError(f"조건 {condition!r}: {etype} subtype 불허")
        return ("presence", etype, subtype)
    match = _NUMERIC_RE.match(condition)
    if match:
        return ("numeric", match.group(1), match.group(2), float(match.group(3)))
    raise BoardRulesError(
        f"허용되지 않는 조건 문법: {condition!r} "
        "(\"air_mass|front:<subtype>\" 또는 \"moisture|sun|wind>=|<=<숫자>\" 만 허용)"
    )


def _condition_holds(parsed: tuple, state: dict[str, Any]) -> bool:
    if parsed[0] == "presence":
        _, etype, subtype = parsed
        return state[etype] == subtype
    _, field, op, value = parsed
    actual = float(state[field])
    return actual >= value if op == ">=" else actual <= value


# ═══════════════════════════════════════════════════════════════
# 규칙 스키마 검증·판정
# ═══════════════════════════════════════════════════════════════


def validate_rules(rules: Any) -> None:
    """§3.2 규칙 JSON 스키마 검증. 위반 시 BoardRulesError.

    같은 조건 집합에 같은 priority(규칙 간 모순)도 여기서 거부한다 —
    판정 비결정성을 데이터 저작 시점에 차단.
    """
    if not isinstance(rules, list) or not rules:
        raise BoardRulesError("규칙 파일 최상위는 비어있지 않은 배열이어야 합니다")
    seen_ids: set[str] = set()
    seen_when: set[tuple[int, frozenset[str]]] = set()
    for index, rule in enumerate(rules):
        prefix = f"rules[{index}]"
        if not isinstance(rule, dict):
            raise BoardRulesError(f"{prefix}: 규칙은 객체여야 합니다")
        rule_id = rule.get("id")
        if not isinstance(rule_id, str) or not rule_id:
            raise BoardRulesError(f"{prefix}: id(문자열) 누락")
        if rule_id in seen_ids:
            raise BoardRulesError(f"{prefix}: id 중복 {rule_id!r}")
        seen_ids.add(rule_id)
        priority = rule.get("priority")
        if not isinstance(priority, int) or isinstance(priority, bool):
            raise BoardRulesError(f"{prefix}({rule_id}): priority(정수) 누락")
        when = rule.get("when")
        if not isinstance(when, list) or not when:
            raise BoardRulesError(f"{prefix}({rule_id}): when은 비어있지 않은 배열이어야 합니다")
        for condition in when:
            parse_condition(condition)  # 문법 위반 시 BoardRulesError
        then = rule.get("then")
        if not isinstance(then, dict):
            raise BoardRulesError(f"{prefix}({rule_id}): then(객체) 누락")
        if then.get("phenomenon") not in PHENOMENA:
            raise BoardRulesError(
                f"{prefix}({rule_id}): phenomenon {then.get('phenomenon')!r} enum 밖"
            )
        if then.get("cloud") not in CLOUDS:
            raise BoardRulesError(f"{prefix}({rule_id}): cloud {then.get('cloud')!r} enum 밖")
        if not isinstance(rule.get("explain"), str) or not rule["explain"].strip():
            raise BoardRulesError(f"{prefix}({rule_id}): explain(문자열) 누락")
        when_key = (priority, frozenset(when))
        if when_key in seen_when:
            raise BoardRulesError(
                f"{prefix}({rule_id}): 같은 조건에 같은 priority — 규칙 간 모순 (§3.2 금지)"
            )
        seen_when.add(when_key)


def evaluate(board: dict[str, Any], rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """보드 상태 → 존별 대기현상 판정 (§3.2). 존 4개 전부 반환.

    반환: [{"zone": 0, "zone_name": ..., "phenomenon": ..., "cloud": ...,
            "rule_id": ...|None, "explain": ...|None}, ...]
    rule_id None = 성립 규칙 없음(기본값 cloudy/cumulus, explain=None).

    zone_name·explain(R9-01 §1 additive): 프론트 확정 리플레이 캡션용 —
    로컬 엔진(frontend/src/lib/boardEngine.js evaluateBoard)과 형태 통일.
    판정(phenomenon·cloud·rule_id)에는 영향 없다.
    """
    validate_board(board)
    validate_rules(rules)
    parsed_rules = [
        (rule, [parse_condition(c) for c in rule["when"]]) for rule in rules
    ]
    results: list[dict[str, Any]] = []
    for zone, state in enumerate(zone_states(board)):
        best: dict[str, Any] | None = None
        best_priority: int | None = None
        for rule, conditions in parsed_rules:
            if all(_condition_holds(c, state) for c in conditions):
                # priority 동률은 파일 순서상 앞선 규칙 유지 (> 비교 — 결정적)
                if best_priority is None or rule["priority"] > best_priority:
                    best, best_priority = rule, rule["priority"]
        if best is None:
            results.append(
                {
                    "zone": zone,
                    "zone_name": ZONES[zone],
                    **DEFAULT_OUTCOME,
                    "rule_id": None,
                    "explain": None,
                }
            )
        else:
            results.append(
                {
                    "zone": zone,
                    "zone_name": ZONES[zone],
                    "phenomenon": best["then"]["phenomenon"],
                    "cloud": best["then"]["cloud"],
                    "rule_id": best["id"],
                    "explain": best["explain"],
                }
            )
    return results


def check_goals(
    phenomena: list[dict[str, Any]], goal_conditions: list[dict[str, Any]]
) -> bool:
    """§3.3 goal_conditions 전부 충족(AND) 여부.

    goal은 {"zone": 0~3, "phenomenon": ...}이며 "cloud"가 있으면 함께 비교한다.
    goal_conditions가 비면 False — 목표 없는 문항이 자동 정답이 되는 것을 방어
    (저작 오류는 품질 게이트 §3.7 소관이지만 채점은 보수적으로).
    """
    if not goal_conditions:
        return False
    for goal in goal_conditions:
        zone = goal.get("zone")
        if not isinstance(zone, int) or not 0 <= zone < ZONE_COUNT:
            return False
        outcome = phenomena[zone]
        if outcome["phenomenon"] != goal.get("phenomenon"):
            return False
        if "cloud" in goal and outcome["cloud"] != goal["cloud"]:
            return False
    return True


def select_feedback(
    template: dict[str, Any],
    phenomena: list[dict[str, Any]],
    passed: bool,
    rules: list[dict[str, Any]],
) -> str:
    """board 피드백 (§3.4 — RAG 호출 없이): 정답이면 성립 규칙 explain,
    오답이면 hints 1단계(hints[0]). 해당 자료가 없으면 정적 폴백 문구."""
    if passed:
        rules_by_id = {rule["id"]: rule for rule in rules}
        for goal in template.get("goal_conditions") or []:
            zone = goal.get("zone")
            if isinstance(zone, int) and 0 <= zone < ZONE_COUNT:
                rule = rules_by_id.get(phenomena[zone].get("rule_id"))
                if rule:
                    return rule["explain"]
        return FEEDBACK_PASS_DEFAULT
    hints = template.get("hints") or []
    if hints and isinstance(hints[0], str) and hints[0].strip():
        return hints[0]
    return FEEDBACK_FAIL_DEFAULT


# ═══════════════════════════════════════════════════════════════
# 규칙 파일 로더 (프로세스 캐시)
# ═══════════════════════════════════════════════════════════════


def rules_path() -> Path:
    """환경변수 BOARD_RULES_PATH 우선, 없으면 database/seed/board_rules.json."""
    override = os.environ.get(BOARD_RULES_ENV_VAR)
    return Path(override) if override else DEFAULT_RULES_PATH


def load_rules(path: Path | str | None = None) -> list[dict[str, Any]]:
    """규칙 파일 로드 + 스키마 검증 + 프로세스 캐시 (경로 키).

    Raises:
        BoardRulesNotFoundError: 파일 부재 (데이터 직군 저작 대기 — 경로 안내 포함).
        BoardRulesError: JSON 파싱 실패 또는 §3.2 스키마 위반.
    """
    resolved = Path(path) if path is not None else rules_path()
    cache_key = str(resolved)
    if cache_key in _rules_cache:
        return _rules_cache[cache_key]
    if not resolved.exists():
        raise BoardRulesNotFoundError(
            f"보드 규칙 파일이 없습니다: {resolved} — 데이터 직군이 "
            f"database/seed/board_rules.json을 저작하면 활성화됩니다 "
            f"(환경변수 {BOARD_RULES_ENV_VAR}로 경로 오버라이드 가능)"
        )
    try:
        rules = json.loads(resolved.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BoardRulesError(f"보드 규칙 JSON 파싱 실패 ({resolved}): {exc}") from exc
    validate_rules(rules)
    _rules_cache[cache_key] = rules
    return rules


def clear_rules_cache() -> None:
    """프로세스 캐시 초기화 (테스트·규칙 파일 갱신 후 재로드용)."""
    _rules_cache.clear()
