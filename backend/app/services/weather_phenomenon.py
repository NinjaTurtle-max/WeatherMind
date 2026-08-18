"""오늘의 실황(KMA 단기예보) → 대기현상 어휘 1종 판정 + 보드 매칭 —
스프린트 SPRINT_R13_02 §T3 「현상 판정 함수」·「보드 매칭」.

클라이언트가 「오늘 날씨 반영 보드」라고 부른 기능의 판정 층이다. 세션 배합에
`board: 1`이 들어가는데, 그 한 자리가 **아무 보드가 아니라 오늘 현상에 맞는 보드**
여야 한다. 이 모듈이 그 두 단계를 소유한다:

    KMA 단기예보 dict ──(classify_phenomenon)──► 현상 어휘 1종 | None
                                                      │
    board 문항 후보 ──(order_boards_for_today)────────┘──► 정렬된 후보

## 이 파일의 계약 ① — **순수 함수 모듈**

DB·네트워크·시계(`datetime.now`)·난수·`app.*` import가 **하나도 없다**. 표준
라이브러리만 쓴다. 이것은 스타일이 아니라 계약이고 두 가지가 걸려 있다:

- **결정성**: 같은 예보 dict는 언제 호출해도 같은 현상을 낸다. 판정이 흔들리면
  같은 날 두 번 발급된 세션이 다른 보드를 낸다.
- **celery 재사용 가능성**(§T3 완료 판정 「backend↔celery 계약 테스트」).
  celery는 별도 빌드 컨텍스트라 backend를 import할 수 없다(CLAUDE.md 「교차 빌드
  컨텍스트 중복은 물리적 병합이 아니라 단일 소유자+계약 테스트로 해소」).
  이 파일이 `app.*`에 의존하지 않는 한 celery는 **파일 그대로** 쓸 수 있고,
  `tests/test_phenomenon_celery_contract.py`가 ⓐ import 문을 AST로 파싱해 순수성을
  ⓑ backend 밖 컨텍스트에서 단독 로드한 사본과 판정 일치를 감시한다.
  ⚠️ **지금 celery에 이 모듈을 부르는 태스크는 없다.** 계약 테스트는 "쓰고 있다"가
  아니라 "쓸 수 있다"를 고정한다 — 나중에 배치가 필요해질 때 이 파일이 이미
  옮길 수 있는 상태임을 보증하는 것이 목적이다.

## 이 파일의 계약 ② — **현상 어휘의 소유자는 `board_rules.json`이다**

`PHENOMENA` 9종은 `database/seed/board_rules.json`의 `then.phenomenon` 집합과
**정확히 같아야 한다**. 여기서 새 어휘를 만들면 보드가 없는 현상이 생기고, 그
현상이 나온 날의 보드 자리는 조용히 폴백으로 샌다. 값을 여기 적는 이유는 순수성
(파일 I/O 금지) 때문이고, 드리프트는 `test_weather_phenomenon.py`의 어휘 계약
테스트가 시드 JSON을 읽어 대조한다.

`board_engine.DEFAULT_OUTCOME`의 `"cloudy"`는 **여기 없다**. 그것은 규칙이 하나도
성립하지 않았을 때 보드 엔진이 내는 기본 판정이지 `board_rules.json`이 목표로
삼는 어휘가 아니고, 실제로 `cloudy`를 목표로 하는 board 문항은 시드에 0건이다.
그래서 "비도 안 오고 맑지도 않은 흐린 날"은 `cloudy`가 아니라 **None**이다 —
없는 어휘를 지어내는 대신 board_order 폴백으로 보낸다(§T3 「없으면 board_order」).

## 임계값은 어디서 왔나 (⚠️ PM 판정 대기)

기상 특보·산불 경보의 실제 기준을 정박점으로 잡되, 단기예보가 주는 값
(TMP/TMX/TMN·POP·SKY·REH·WSD·PTY)으로 표현 가능한 형태로 옮겼다. 각 임계에
근거를 주석으로 달았다. **이 수치들은 실운영 로그로 재보정할 대상**이며(8/11~18),
값 변경은 이 파일 하나만 고치면 된다 — 판정이 여기 한 곳에만 있기 때문이다.
"""
from collections import Counter
from typing import Any, Sequence

# ── 현상 어휘 (board_rules.json `then.phenomenon` 전건 — 위 계약 ② 참조) ──
PHENOMENA = (
    "shower",
    "rain",
    "persistent_rain",
    "snow",
    "fog",
    "heatwave",
    "clear",
    "flood_risk",
    "wildfire_risk",
    # ㉣ 4조건 규칙의 고유 결과 — 경보급(2026-08-18). 이 튜플은 board_rules의
    # `then.phenomenon` 전건과 **같아야** 하고 그 일치를 계약 테스트가 문다.
    # ⚠️ 실황 판정(`classify`)은 이 셋을 **내지 않는다** — 4조건 동시 성립은
    # 보드 위에서만 만들 수 있고, 실황 카테고리로는 그 조합을 알 수 없다.
    "severe_storm",
    "wildfire_warning",
    "flood_warning",
    # MT-18 전문가 보드(2026-08-18) — 태풍·온실효과. 위 셋과 **같은 성질**이다:
    # 조건 4개 동시 성립이라 실황 카테고리로는 도달할 수 없다(→ BOARD_ONLY).
    "typhoon",
    "tropical_night",
)

# ── 🔴 어휘가 두 역할을 겸하고 있었다 — 갈랐다 (2026-08-18) ────────────────────
# `PHENOMENA`는 두 가지로 동시에 쓰였다: ⑴ **board_rules의 거울**(계약 ②) ⑵ **실황
# 판정이 낼 수 있는 집합**(사문 판정 — 어휘에 있는데 어떤 입력으로도 안 나오면 죽은 값).
# ㉣의 경보급 3종이 들어오자 그 겸용이 깨졌다: ⑴에는 속하지만 ⑵에는 **속할 수 없다.**
# 조건 4개가 **동시에** 맞아야 나는 결과이고, 실황 카테고리(하늘·습도·풍속·강수형태)로는
# 「기단이 시베리아인가」·「전선이 정체인가」를 알 수 없기 때문이다.
#
# 그래서 사문 판정의 대상을 **`CLASSIFIABLE`**로 좁힌다. 이 분리가 없으면 둘 중 하나가
# 거짓이 된다 — 어휘를 안 늘리면 board_rules 거울이 깨지고, 늘린 채로 도달성을 요구하면
# **실황이 만들 수 없는 것을 만들라고** 요구한다.
BOARD_ONLY_PHENOMENA = (
    "severe_storm", "wildfire_warning", "flood_warning",
    # MT-18(2026-08-18). `typhoon`은 실황으로 **부분적으로는** 알 수 있어 보이지만
    # (강풍 + 강수) 이 어휘가 뜻하는 것은 「태풍이 발생·유지되는 조건이 갖춰졌다」이고
    # 그 판정에는 해수면 온도와 연직 시어가 필요하다 — READ_CATEGORIES에 없다.
    # `tropical_night`도 최저기온만으로는 **되돌림이 원인인지**를 가릴 수 없다.
    # 실황으로 반쯤 닮은 값을 내면 사문 판정이 아니라 **오판정**이 된다.
    "typhoon", "tropical_night",
)
CLASSIFIABLE = tuple(p for p in PHENOMENA if p not in BOARD_ONLY_PHENOMENA)

# ── KMA 단기예보 카테고리 (읽는 것만) ──
# backend weather_api.KMA_CATEGORY · celery kma_client.KMA_CATEGORY **양쪽에 다
# 있는 키**만 읽는다 — 한쪽에만 있는 키를 읽으면 celery 컨텍스트에서 판정이 달라진다.
# 계약 테스트가 이 튜플이 두 매핑의 교집합에 포함되는지 검사한다.
READ_CATEGORIES = ("TMP", "TMN", "TMX", "POP", "SKY", "REH", "WSD", "PTY")

# ── PTY(강수형태) 코드 ── 0없음/1비/2비눈/3눈/4소나기 (+5빗방울/6빗방울눈날림/7눈날림)
PTY_RAIN = frozenset({1, 5})
PTY_SNOW = frozenset({2, 3, 6, 7})
PTY_SHOWER = frozenset({4})

# ── 판정 임계 ──────────────────────────────────────────────────────────────
# 폭염: 일 최고기온 33℃ 이상 = 기상청 폭염주의보 발표기준.
HEATWAVE_TEMP_MAX = 33.0
# 산불 위험: 산림청 산불위험 경보가 「실효습도 45% 이하 + 풍속 7m/s 이상」을
# 기준으로 쓴다. 단기예보 REH는 실효습도가 아니라 상대습도라 그대로 45를 쓰면
# 봄·가을 오후 대부분이 걸린다 — 건조주의보 기준(실효습도 35%)까지 조인다.
WILDFIRE_HUMIDITY_MAX = 35.0
STRONG_WIND_MS = 7.0          # 산림청 산불 기준 풍속 · 기상청 풍속 단계 「약간 강함」 상단
# 침수 위험: 보드 규칙 `flood_risk_saturated_inflow`의 모델(포화 + 유입)을 실황으로
# 옮긴 것이다 — 공기가 물기로 가득 차고(REH≥85) 그 물기를 계속 실어 나를 바람이
# 있고(WSD≥7) 실제로 비가 예보된(POP≥60) 날. 강수량(PCP)을 쓰지 않는 이유는
# 그 값이 "30.0~50.0mm"·"강수없음" 같은 **문자열**로 와서 숫자 추출이 조용히
# 비는 필드이기 때문이다(weather_api.parse_kma_value 주석 참조).
FLOOD_HUMIDITY_MIN = 85.0
FLOOD_RAIN_PROB = 60.0
# 안개: 포화에 가까운 습도 + 강수 없음. 복사안개·이류안개 공통의 최소 조건이다.
FOG_HUMIDITY_MIN = 90.0
# 강수 판정 임계 — PTY가 비어 있는 예보(발표 시각에 따라 결측)의 폴백 경로에서만 쓴다.
RAIN_PROB_THRESHOLD = 60.0
DRY_RAIN_PROB = 30.0          # 이 아래를 "비 안 오는 날"로 본다 (fog·clear 전제)
WILDFIRE_RAIN_PROB = 20.0
# 지속형 비(장마) vs 한때 비: 예보 시간대의 몇 할이 젖어 있는가.
WET_HOUR_POP = 60.0
PERSISTENT_WET_RATIO = 0.6
PERSISTENT_RAIN_PROB = 70.0
# 소나기 폴백: PTY 결측인데 비 확률이 높고 더운 날은 대류성 소나기로 본다.
SHOWER_TEMP_MAX = 25.0
SKY_CLEAR = 1                 # SKY 1맑음/3구름많음/4흐림


# ═══════════════════════════════════════════════════════════════
# 예보 dict 읽기 — backend·celery가 **같은 모양**을 만든다
#   {"region": str, "forecasts": [{"datetime": "YYYYMMDDHHMM", "TMP": 28.0, ...}]}
# (backend weather_api.group_forecast_items · celery kma_client.get_short_forecast)
# ═══════════════════════════════════════════════════════════════


def _numbers(forecasts: Sequence[Any], category: str) -> list[float]:
    """예보 항목에서 category 숫자값만 (문자·결측 무시).

    `weather_api.forecast_numbers`와 **의미가 같다**. import하지 않고 다시 쓰는
    것은 이 모듈의 순수성 계약(위 ①) 때문이고, 두 구현의 동치는 계약 테스트가
    같은 입력을 양쪽에 먹여 감시한다.
    """
    values: list[float] = []
    for entry in forecasts or ():
        if not isinstance(entry, dict):
            continue
        value = entry.get(category)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        values.append(float(value))
    return values


def summarize(weather: Any) -> dict[str, Any]:
    """예보 dict → 판정에 쓰는 요약 신호. 값을 못 구한 신호는 None이다.

    분리해 두는 이유는 판정 실패를 디버깅할 때 "어느 신호가 비었나"가 곧 답이기
    때문이다(무키 실운영에서 KMA가 죽으면 전 신호가 None이 된다).
    """
    forecasts = weather.get("forecasts") if isinstance(weather, dict) else None
    forecasts = forecasts or []

    tmx = _numbers(forecasts, "TMX")
    tmp = _numbers(forecasts, "TMP")
    tmn = _numbers(forecasts, "TMN")
    pop = _numbers(forecasts, "POP")
    reh = _numbers(forecasts, "REH")
    wsd = _numbers(forecasts, "WSD")
    sky = [int(v) for v in _numbers(forecasts, "SKY")]
    pty = {int(v) for v in _numbers(forecasts, "PTY") if v}

    return {
        # temp_max/temp_min은 extract_slot_values와 같은 규칙(TMX/TMN 우선, 없으면
        # TMP의 최대/최소)이다 — 같은 날의 같은 예보에서 화면 슬롯과 판정이 서로
        # 다른 기온을 보면 유저에게는 그냥 버그로 보인다.
        "temp_max": tmx[0] if tmx else (max(tmp) if tmp else None),
        "temp_min": tmn[0] if tmn else (min(tmp) if tmp else None),
        "rain_prob": max(pop) if pop else None,
        "wet_ratio": (
            sum(1 for v in pop if v >= WET_HOUR_POP) / len(pop) if pop else None
        ),
        "humidity_max": max(reh) if reh else None,
        "humidity_min": min(reh) if reh else None,
        "wind_max": max(wsd) if wsd else None,
        "sky": Counter(sky).most_common(1)[0][0] if sky else None,
        "pty": pty,
    }


# ═══════════════════════════════════════════════════════════════
# ⑴ 현상 판정 — 순수 함수
# ═══════════════════════════════════════════════════════════════


def classify_phenomenon(weather: Any) -> str | None:
    """KMA 단기예보 dict → `PHENOMENA` 1종. 판정 불가면 **None**.

    **사다리(위에서부터 먼저 맞는 것 하나)** — 순서 자체가 계약이다:

      1. snow          눈 계열 PTY, 또는 영하인데 비 확률이 높은 날
      2. flood_risk    포화 + 강풍 + 강수 (재난은 일반 강수를 선점한다)
      3. wildfire_risk 건조 + 강풍 + 무강수
      4. heatwave      최고 33℃ 이상이면서 비는 오지 않는 날
                       (「비가 안 온다」 = PTY에 비·소나기가 없고 ∧ POP도 낮음)
      5. shower/rain/persistent_rain   PTY 우선, 결측이면 POP 폴백
      6. fog           포화에 가깝고 비는 없는 날
      7. clear         SKY 맑음 + 무강수
      8. None          그 밖(흐리지만 비는 없는 평범한 날 · 실황 결측)

    눈을 맨 위에 두는 이유: 겨울 강풍·강수 날에 flood_risk가 먼저 걸리면 눈 오는
    날에 침수 보드가 나간다. 재난(2·3)이 일반 강수(5)보다 위인 이유: 그날의
    「오늘의 날씨」로 유저가 인식하는 것이 재난 쪽이다.

    **None을 돌려주는 것이 정상 경로다.** 호출측(`order_boards_for_today`)이
    board_order 폴백으로 받는다 — 없는 어휘를 지어내지 않는다(모듈 독스트링 ②).
    """
    s = summarize(weather)
    temp_max, rain_prob = s["temp_max"], s["rain_prob"]
    humidity_max, humidity_min, wind_max = (
        s["humidity_max"], s["humidity_min"], s["wind_max"],
    )
    pty = s["pty"]
    wet = rain_prob if rain_prob is not None else 0.0
    dry_enough = rain_prob is not None and rain_prob < DRY_RAIN_PROB

    # 1. 눈
    if pty & PTY_SNOW:
        return "snow"
    if temp_max is not None and temp_max <= 0 and wet >= RAIN_PROB_THRESHOLD:
        return "snow"

    # 2·3. 재난 축 — 습도·풍속이 둘 다 있어야 판정한다(둘 중 하나가 결측이면 건너뛴다).
    if wind_max is not None and wind_max >= STRONG_WIND_MS:
        if (
            humidity_max is not None
            and humidity_max >= FLOOD_HUMIDITY_MIN
            and wet >= FLOOD_RAIN_PROB
        ):
            return "flood_risk"
        if (
            humidity_min is not None
            and humidity_min <= WILDFIRE_HUMIDITY_MAX
            and rain_prob is not None
            and rain_prob <= WILDFIRE_RAIN_PROB
        ):
            return "wildfire_risk"

    # 4. 폭염 — 비 오는 날의 33℃는 폭염보다 강수가 「오늘의 날씨」다.
    #
    # ⚠️ **「비 오는 날」의 판정은 POP 하나가 아니다.** 종전에는 `wet`(POP)만 보고
    # `pty`를 안 읽어서, 기상청이 **강수형태를 직접 알려준** 날조차 폭염이 선점했다:
    # `TMX 34 · POP 40 · PTY 4(소나기)` → 소나기가 예보된 날에 `heatwave`가 나갔다.
    # 5번 계단이 "PTY가 1순위, 결측이면 POP 폴백"인 것과 정면으로 어긋난다 —
    # 관측이 있는데 확률로 덮은 셈이다. 눈(PTY_SNOW)은 1번에서 이미 반환됐으므로
    # 여기서 볼 것은 비·소나기 둘뿐이다.
    raining_now = bool(pty & (PTY_SHOWER | PTY_RAIN))
    if (
        temp_max is not None
        and temp_max >= HEATWAVE_TEMP_MAX
        and not raining_now
        and wet < FLOOD_RAIN_PROB
    ):
        return "heatwave"

    # 5. 강수 — PTY(기상청이 직접 알려주는 강수형태)가 1순위, 결측이면 POP 폴백.
    if pty & PTY_SHOWER:
        return "shower"
    if pty & PTY_RAIN:
        return _rain_kind(s)
    if wet >= RAIN_PROB_THRESHOLD:
        if temp_max is not None and temp_max >= SHOWER_TEMP_MAX:
            return "shower"
        return _rain_kind(s)

    # 6. 안개
    if dry_enough and humidity_max is not None and humidity_max >= FOG_HUMIDITY_MIN:
        return "fog"

    # 7. 맑음
    if dry_enough and s["sky"] == SKY_CLEAR:
        return "clear"

    # 8. 판정 없음 — 구름많음·흐림인데 비는 없는 날, 그리고 실황 결측 전부.
    return None


def _rain_kind(signals: dict[str, Any]) -> str:
    """비가 온다는 것까지 정해진 뒤의 갈래 — 오래 가면 persistent_rain.

    「장마처럼 여러 날 지속되는 비」(board_rules `stationary_front_monsoon`)를
    하루치 예보로 근사할 수 있는 유일한 신호가 **젖어 있는 시간대의 비율**이다.
    """
    wet_ratio = signals["wet_ratio"]
    rain_prob = signals["rain_prob"] or 0.0
    if (
        wet_ratio is not None
        and wet_ratio >= PERSISTENT_WET_RATIO
        and rain_prob >= PERSISTENT_RAIN_PROB
    ):
        return "persistent_rain"
    return "rain"


# ═══════════════════════════════════════════════════════════════
# ⑵ 보드 매칭 — 오늘 현상을 목표로 하는 board 문항 우선, 없으면 board_order
# ═══════════════════════════════════════════════════════════════


def _template(item: Any) -> dict[str, Any]:
    """content_item(ORM 행 · dict · 테스트 대역)에서 template_json을 꺼낸다."""
    template = (
        item.get("template_json") if isinstance(item, dict)
        else getattr(item, "template_json", None)
    )
    return template if isinstance(template, dict) else {}


def goal_phenomena(item: Any) -> set[str]:
    """board 문항이 목표로 하는 현상 집합 (`template_json.goal_conditions[].phenomenon`).

    한 문항이 여러 존에 서로 다른 목표를 걸 수 있어 집합이다.
    """
    conditions = _template(item).get("goal_conditions")
    if not isinstance(conditions, list):
        return set()
    return {
        c["phenomenon"]
        for c in conditions
        if isinstance(c, dict) and isinstance(c.get("phenomenon"), str)
    }


def board_order(item: Any) -> int | None:
    """`template_json.board_order` — 커리큘럼이 정한 보드 진행 순서(난이도 단조 증가)."""
    order = _template(item).get("board_order")
    if isinstance(order, bool) or not isinstance(order, (int, float)):
        return None
    return int(order)


def knowledge_level(item: Any) -> int | None:
    """문항의 지식 단계 — **컬럼값**이다(`template_json` 안이 아니다).

    난이도 축의 유일한 값이고, `level_group`(표현 톤)과 다른 축이다.
    미분류는 None이 정상값이라 여기서 파생하지 않는다.
    """
    level = (
        item.get("knowledge_level") if isinstance(item, dict)
        else getattr(item, "knowledge_level", None)
    )
    if isinstance(level, bool) or not isinstance(level, (int, float)):
        return None
    return int(level)


# 단계 미분류 보드의 거리 — 분류된 것들보다 **뒤**로 보낸다. 시드 board는
# 2026-08-12 실측 46/46 전건 분류돼 있어 현재 도달하지 않는 방어값이고, 새 보드가
# 단계 없이 들어와도 "표적과 딱 맞는 것"처럼 앞줄을 차지하지 못하게 막는다.
UNGRADED_DISTANCE = 99


def order_boards_for_today(
    items: Sequence[Any],
    phenomenon: str | None,
    target_level: int | None = None,
) -> list[Any]:
    """board 후보를 **오늘 현상 → 단계 근접 → board_order** 순으로 재정렬한다.

    버리지 않고 **정렬만** 하는 것이 요점이다. 호출측(`plan_bank_picks`)은 중복
    제외·상한 때문에 첫 후보를 못 쓸 수 있는데, 걸러 버리면 그 자리가 배합에서
    비고 결국 유료 생성으로 샌다(CO-M1·CO-H5가 live·board에서 이미 겪은 누수).
    그래서 「현상 불일치」는 탈락이 아니라 **뒤 순위**다 = board_order 폴백.

    `phenomenon`이 None(실황 결측·판정 없음)이면 현상 축이 통째로 무효가 되고
    나머지 두 축만 남는다 — §T3의 「없으면 board_order」가 그것이다.

    ## 왜 `target_level`이 **가운데** 끼는가 (2026-08-12, 담당 I 회귀 수리)

    출제 축이 `knowledge_level` 단독으로 단일화되면서 **밴드 필터가 사라졌는데,
    보드에게는 그 필터가 유일한 난이도 방벽이었다**. 하류 정렬 키(`board_order`)가
    유일값이라 상류에서 미리 단계 정렬을 해 둬도 살아남지 못한다(I 실측) —
    합성은 반드시 이 한 키 안에서 일어나야 한다. 결과로 kl 1 학습자의 보드가
    `clear 1→3 · rain 1→4 · fog 2→4 · snow 2→4 · flood_risk 2→4`로 밀려 있었다.

    순서가 곧 우선순위 선언이다:
      1순위 **오늘 날씨 반영** — 이 기능의 정의라 단계에 양보하지 않는다
      2순위 **배치고사에 따른 위치 배정** — 같은 현상 안에서 표적 단계에 가까운 것
      3순위 **board_order** — 커리큘럼이 정한 진행 순서(동률 해소)

    `target_level`이 None(콜드스타트·θ 없음)이면 거리가 전건 0이라 **정렬 결과가
    개정 전과 완전히 같다**. 정렬은 안정적이라 같은 입력이 항상 같은 순서를 낸다.
    """
    def sort_key(item: Any) -> tuple[int, int, int, int]:
        matched = bool(phenomenon) and phenomenon in goal_phenomena(item)
        if target_level is None:
            distance = 0
        else:
            level = knowledge_level(item)
            distance = (
                UNGRADED_DISTANCE if level is None else abs(level - target_level)
            )
        order = board_order(item)
        # board_order 결측은 있는 것들 **뒤**로 — 저작 누락이 앞줄을 차지하지 않게.
        return (
            0 if matched else 1,
            distance,
            0 if order is not None else 1,
            order or 0,
        )

    return sorted(items, key=sort_key)


def match_board(
    items: Sequence[Any],
    phenomenon: str | None,
    target_level: int | None = None,
) -> Any | None:
    """오늘 낼 board 1건 (후보가 없으면 None) — `order_boards_for_today`의 머리."""
    ordered = order_boards_for_today(items, phenomenon, target_level)
    return ordered[0] if ordered else None
