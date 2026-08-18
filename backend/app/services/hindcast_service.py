"""과거 예보(hindcast) — 저장된 과거 하루의 실관측으로 되돌아가 예보자가 된다 (MT-30).

「예보 대결」(duel)은 **오늘 제출 → 내일 정산**이라 실데이터가 쌓이기를 기다려야
한다(ROADMAP §5.3이 "노력으로 해결되지 않는다"고 적은 그 공백). hindcast는 같은
채점 축을 **과거 날짜**로 돌려 그 대기를 없앤다 — 새 채점 모델이 아니라
`duel_service.settle_scores`(=`league_service.accuracy_score` + `duel_result`)
**그대로 재사용**이다(대장 §0.8.6 MT-30 착지 형태).

## ⚠️ 왜 픽스처인가 — 과거 관측은 이 저장소에 적재되지 않는다 (실측 2026-08-18)

세 경로를 다 확인했고 **과거 관측을 조회 가능한 형태로 남기는 곳이 없다**:

1. `celery/app/tasks/weather.py`(수집 배치)는 KMA 단기예보를 **Redis에 1h TTL**로만
   쓴다(`WEATHER_CACHE_TTL_SEC`). 영속 테이블에 넣는 코드가 없다.
2. 과거 관측은 `weather_api.get_past_observation`이 **요청 때마다 KMA ASOS를 실호출**해
   가져온다(Redis 1h 캐시 + 실패 마커 5분). **KMA 키가 없으면 KMAApiError**이고
   상위가 degraded로 흡수한다 — 즉 키 없는 환경에서는 과거 관측이 **0건**이다.
3. 실관측이 DB에 남는 유일한 자리는 `duels.actual`·`league_results.actual_value`
   JSONB인데, 이것은 **그 날짜에 그 유저가 참가했을 때만** 생기는 유저 스코프 행이다
   (RLS 격리 대상). 과거 관측 아카이브가 아니다.

그래서 **없는 데이터를 합성하지 않는다**(합성하면 「과거 예보」가 아니라 「가짜 이력」이
된다 — 워커 브리핑 지시). 대신 **실제로 일어난 공개 기록 날짜를 소수 고정**해 픽스처로
두고, 값마다 **출처를 코드에 명시**한다(`sources`). 화면·API 응답도 이것이
**데모용 고정 날짜**임을 숨기지 않는다(`is_demo_fixture`·`DISCLOSURE`).

KMA 키가 생기면 이 픽스처는 `get_past_observation`으로 임의 날짜를 끌어오는 경로로
대체될 수 있다 — 그때 지울 자리를 알아보게 픽스처를 한 곳에 모아 둔다.

## AI 캐스터의 기준값은 「평년값(climatology)」이다

duel은 KMA **내일 예보**를 캐스터 기준값으로 쓴다. 과거 날짜에는 그런 예보가 남아
있지 않고, **없는 과거 예보를 지어내면 그것도 가짜 이력**이다. 그래서 기준값을
그 날짜의 **평년값**으로 둔다 — 예보 검증에서 실력을 재는 표준 기준선이 climatology이고
(예보가 평년값보다 나은가), 값은 재현 가능한 공개 자료에서 계산했다(`caster_base` 주석).

학습자는 "평년값 ± 결정적 노이즈"를 내는 캐스터를 이겨야 한다 — 기록적인 날일수록
평년값이 크게 틀리므로, 극값을 알아보는 것 자체가 실력이 된다.

LLM은 관여하지 않는다(무키 전 기능 동작 계약).
"""
import uuid
from datetime import date

from app.services.duel_service import (
    caster_noise_scale,
    ai_caster_prediction,
    settle_scores,
)

# 화면·응답에 함께 내리는 고지 문구 — 「데모용 고정 날짜」를 숨기지 않는다.
# 프론트는 이 문구를 i18n 키로 렌더하고, 서버 응답에도 담아 API만 보는 심사자에게도
# 같은 사실이 닿게 한다.
DISCLOSURE = (
    "과거 관측을 서버에 적재하는 경로가 아직 없어, 공개 기록으로 검증된 "
    "고정 날짜만 제공하는 데모입니다. 값의 출처는 각 회차 결과에 함께 표시됩니다."
)

# 예측값 허용 범위 — duel(_TEMP_MIN/_TEMP_MAX)과 같은 계약을 쓴다.
TEMP_MIN, TEMP_MAX = -60.0, 60.0


# ═══════════════════════════════════════════════════════════════
# 픽스처 — 실제로 일어난 날, 출처를 값마다 명시
# ═══════════════════════════════════════════════════════════════
#
# `actual.sum_rn`은 **실관측 강수량(mm)**을 그대로 담는다. 채점에 쓰는 rain_prob은
# `scoring_actual()`이 celery `settle_daily_duel`과 **동일하게 이진화**한다
# (sumRn > 0 → 100, 아니면 0). 단일 일자에는 강수 '확률'이 없으므로 관측 강수
# 유무로 환산하는 그 규칙을 복제하지 않고 재사용 의도로 같은 식을 쓴다.
#
# `caster_base`는 그 달력날짜의 **평년값**이다. 산출 방법(재현 가능):
#   Open-Meteo ERA5 재분석 아카이브(무키 공개 API)의 서울(37.5665N, 126.978E)
#   1991~2020년 30년 자료에서 해당 달력날짜의
#     temp_max = 일최고기온 30년 산술평균
#     rain_prob = 강수 발생일 비율(precipitation_sum > 0 인 해의 비율)
#   질의: archive-api.open-meteo.com/v1/archive?...&daily=temperature_2m_max,
#         precipitation_sum&timezone=Asia/Seoul (2026-08-18 실행)
#
HINDCAST_CASES: tuple[dict, ...] = (
    {
        "case_id": "seoul-2018-08-01",
        "observed_date": date(2018, 8, 1),
        "region": "서울",
        "station": "108",  # 서울기상관측소(종로구 송월동) — weather_api.KMA_STATION
        "title": "2018년 8월 1일 — 서울",
        "intro": (
            "북태평양 고기압과 티베트 고기압이 겹쳐 한반도 상공에 열돔이 자리 잡은 "
            "날입니다. 장마가 일찍 끝나고 맑은 하늘이 이어졌습니다. "
            "이날 서울의 최고기온과 강수확률을 예보해 보세요."
        ),
        "actual": {"temp_max": 39.6, "sum_rn": 0.0},
        "sources": {
            "temp_max": (
                "39.6℃ — 기상 관측 이래 서울 최고기온(공식 기록, 서울기상관측소 108). "
                "종전 기록 1994-07-24 38.4℃를 경신. "
                "출처: weather.com(2018-08-01 보도)·AccuWeather·나무위키 「2018년 폭염/대한민국」"
            ),
            "sum_rn": (
                "0.0mm(무강수) — 열돔 절정일. "
                "출처: Open-Meteo ERA5 재분석 아카이브 일강수량 0.00mm(서울, 2018-08-01)"
            ),
        },
        "caster_base": {"temp_max": 29.6, "rain_prob": 70},
        "explanation": (
            "실제 최고기온은 39.6℃로, 평년값(29.6℃)보다 10℃나 높았습니다. "
            "열돔이 형성되면 하강기류가 구름을 막아 일사가 그대로 지표를 가열하고, "
            "밤에도 열이 빠져나가지 못해 기온이 누적됩니다. "
            "강수확률을 낮게 본 예보가 맞았습니다 — 고기압 하강기류 아래에서는 "
            "대기가 안정해 비구름이 만들어지지 못합니다."
        ),
    },
    {
        "case_id": "seoul-2022-08-08",
        "observed_date": date(2022, 8, 8),
        "region": "서울",
        "station": "108",
        "title": "2022년 8월 8일 — 서울",
        "intro": (
            "정체전선이 수도권에 남북으로 좁게 걸리고, 남서쪽에서 다량의 수증기가 "
            "계속 유입된 날입니다. 대기 하층과 상층의 온도차가 커 적란운이 "
            "제자리에서 반복 발달했습니다. "
            "이날 서울의 최고기온과 강수확률을 예보해 보세요."
        ),
        "actual": {"temp_max": 27.2, "sum_rn": 129.6},
        "sources": {
            "temp_max": (
                "27.2℃ — Open-Meteo ERA5 재분석 아카이브(서울, 2022-08-08). "
                "⚠️ KMA 공식 관측소(108) 값을 확인하지 못해 **재분석 값**을 쓴다. "
                "당일 예보가 낮 최고 28℃였던 보도(경향신문 2022-08-07)와 정합적이다."
            ),
            "sum_rn": (
                "129.6mm — 서울기상관측소(종로구 송월동, 108) 일강수량 **공식 기록**. "
                "같은 날 동작구 신대방동 AWS는 381.5mm를 기록했으나 이는 공식 기록이 "
                "아니다(서울시 공식 강수량은 송월동 관측값만 인정). "
                "출처: 위키백과 「2022년 한국 중부 집중호우」"
            ),
        },
        "caster_base": {"temp_max": 29.4, "rain_prob": 70},
        "explanation": (
            "실제 일강수량은 129.6mm였고, 최고기온은 27.2℃로 평년값(29.4℃)보다 "
            "낮았습니다. 두꺼운 비구름이 일사를 막으면 낮 기온이 오르지 못합니다 — "
            "강수를 맞히면 기온도 낮게 잡아야 앞뒤가 맞습니다. "
            "정체전선은 이름처럼 잘 움직이지 않아 같은 지역에 강수가 누적됩니다."
        ),
    },
)


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음
# ═══════════════════════════════════════════════════════════════


def list_cases() -> tuple[dict, ...]:
    """제공 중인 과거 예보 회차 전체 (고정 픽스처)."""
    return HINDCAST_CASES


def get_case(case_id: str) -> dict | None:
    """case_id로 회차를 찾는다. 없으면 None(라우터가 404 판정)."""
    return next((c for c in HINDCAST_CASES if c["case_id"] == case_id), None)


def scoring_actual(case: dict) -> dict:
    """채점용 실측값 — celery `settle_daily_duel._duel_actual_for_day`와 동일 형태.

    단일 일자라 강수 '확률'이 없으므로 **관측 강수 유무로 이진화**한다
    (sumRn > 0 → 100.0, 아니면 0.0). duel 정산이 쓰는 그 규칙과 같아야
    `accuracy_score`가 두 경로에서 같은 뜻을 갖는다.
    """
    actual = case["actual"]
    return {
        "temp_max": actual["temp_max"],
        "rain_prob": 100.0 if actual["sum_rn"] > 0 else 0.0,
    }


def caster_prediction(case: dict, user_id: uuid.UUID | str, elo: int | None) -> dict:
    """이 회차의 AI 캐스터 예측 — 평년값 기준 + 결정적 노이즈 (duel과 같은 함수).

    시드는 (user_id, 관측일)이라 같은 유저·같은 회차는 **항상 같은 예측**이다.
    적응형 노이즈(R9-01 §3.2)도 duel과 똑같이 적용한다 — 티어가 높으면 캐스터가
    더 정확해진다.
    """
    base = case["caster_base"]
    scale = caster_noise_scale(elo)
    pred = ai_caster_prediction(
        base["temp_max"],
        base["rain_prob"],
        str(user_id),
        case["observed_date"],
        noise_scale=scale,
    )
    return {**pred, "noise_scale": scale}


def grade(case: dict, user_pred: dict, ai_pred: dict) -> tuple[float, float, str]:
    """(user_score, ai_score, result) — duel 정산 경로 그대로 재사용.

    새 채점 축을 만들지 않는다: `settle_scores`가 `league_service.accuracy_score`와
    `duel_result`를 부르고, 그 둘이 07번 문서 공식의 단일 소유자다.
    """
    return settle_scores(user_pred, ai_pred, scoring_actual(case))


def validate_prediction(temp_max: float, rain_prob: int) -> bool:
    """예보 예측값 범위 검증 — duel `_validate_prediction`과 같은 경계."""
    return TEMP_MIN <= temp_max <= TEMP_MAX and 0 <= rain_prob <= 100
