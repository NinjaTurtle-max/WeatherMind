# 기상청 API 연동 상세 스펙

> KMA(기상청) API는 응답 구조가 복잡하다. 이 문서 없이 AI가 파싱 코드를 짜면
> 거의 항상 틀린다. 실제 응답 구조와 파싱 규칙을 명시한다.

## ⚠️ 출처 = 기상청 API허브 (R13 전환, 2026-08-10)

종전 출처는 **공공데이터포털**(`apis.data.go.kr/1360000/...` + `serviceKey`)이었고
이 문서도 그 전제로 쓰여 있었다. 지금 출처는 **기상청 API허브**
(`apihub.kma.go.kr/api/typ02/openApi/...` + `authKey`)다. **둘은 별개 시스템이고
키도 따로다** — 한쪽 키를 다른 쪽 URL에 넣으면 인증이 깨지는데, 실패가
degraded 200으로 흡수돼 화면에는 티가 안 난다.

응답 봉투(`resultCode`·`items.item[]`)와 아래 파싱 규칙은 **그대로 유효하다**.
실제로 갈린 것은 세 가지뿐이다:

| | 종전(공공데이터포털) | 현재(API허브) |
|---|---|---|
| 인증 파라미터 | `serviceKey` | **`authKey`** |
| 단기·중기예보 | `VilageFcstInfoService_2.0` · `MidFcstInfoService` | 서비스명 동일 (호스트만 교체) |
| 과거관측 일자료 | `AsosDalyInfoService` — 기간 조회 · JSON | **typ01 `kma_sfcdd.php` — 하루 조회 · 텍스트** (§3). openApi 대체품은 **월보라 당월을 안 줘서 못 쓴다** |

API허브는 **API마다 활용신청이 따로**다(마이페이지 > 활용신청 현황). 위 3종이 전부
승인돼 있어야 하고, ASOS가 빠지면 리그·대결 정산이 조용히 빈손으로 돈다.

## 공통 사항

- 인증: 쿼리 파라미터 `authKey`에 발급키 삽입 (URL 인코딩 주의 — 이미 인코딩된 키면 재인코딩 금지)
- 응답 포맷: `dataType=JSON` 파라미터 필수 (기본은 XML)
- 모든 응답은 `response.body.items.item[]` 경로에 실제 데이터가 있음
- `response.header.resultCode == "00"` 이 성공. 그 외는 에러 (03=데이터없음, 파싱 전 반드시 체크)

---

## 1. 단기예보 (getVilageFcst)

**요청 파라미터**
| 파라미터 | 값 | 설명 |
|---|---|---|
| authKey | {발급키} | API허브 마이페이지 인증키 |
| pageNo | 1 | |
| numOfRows | 1000 | 하루치 다 받으려면 크게 |
| dataType | JSON | |
| base_date | YYYYMMDD | 발표일자 |
| base_time | 0200, 0500, 0800, 1100, 1400, 1700, 2000, 2300 중 | 발표시각 (하루 8회) |
| nx | 격자 X | 지역별 좌표 (아래 표) |
| ny | 격자 Y | |

**주요 지역 격자 좌표 (하드코딩 상수로 저장)**
```python
KMA_GRID = {
    "서울": (60, 127), "부산": (98, 76), "대구": (89, 90),
    "인천": (55, 124), "광주": (58, 74), "대전": (67, 100),
    "울산": (102, 84), "강릉": (92, 131), "제주": (52, 38),
    "수원": (60, 121), "청주": (69, 106), "전주": (63, 89),
}
```

**응답 item 구조 (핵심 카테고리만)**
```json
{
  "category": "TMP",   // 1시간 기온(℃)
  "fcstDate": "20260710",
  "fcstTime": "1500",
  "fcstValue": "28"
}
```

**카테고리 코드 매핑 (반드시 상수로)**
```python
KMA_CATEGORY = {
    "TMP": "기온",        # ℃
    "TMN": "최저기온",     # ℃ (일 1회)
    "TMX": "최고기온",     # ℃ (일 1회)
    "REH": "습도",        # %
    "WSD": "풍속",        # m/s
    "POP": "강수확률",     # %
    "PTY": "강수형태",     # 0없음/1비/2비눈/3눈/4소나기
    "SKY": "하늘상태",     # 1맑음/3구름많음/4흐림
    "PCP": "강수량",       # mm ("강수없음" 문자열 주의)
}
```

**파싱 주의점 (AI가 자주 틀리는 것)**
- `PCP`, `PTY` 값이 "강수없음" 같은 **문자열**로 올 수 있음 → 숫자 변환 전 체크
- `fcstDate`+`fcstTime` 조합으로 시간대별 정렬 필요
- 하나의 응답에 여러 시각·여러 카테고리가 flat하게 섞여 있음 → `(fcstDate, fcstTime)` 기준으로 grouping 후 category별로 재구성

**서비스 함수 시그니처 (backend/app/services/weather_api.py)**
```python
async def get_short_forecast(region: str, base_date: str, base_time: str) -> dict:
    """반환: {'region': str, 'forecasts': [{'datetime': ..., 'TMP': 28, 'REH': 75, ...}]}"""
```

---

## 2. 중기예보 (getMidLandFcst)

**요청 파라미터**
| 파라미터 | 값 |
|---|---|
| regId | 지역코드 (서울=11B00000, 부산=11H20000 등) |
| tmFc | 발표시각 YYYYMMDD0600 또는 YYYYMMDD1800 |

**응답**: 3~10일 후 오전/오후 날씨 + 강수확률
```json
{ "wf3Am": "구름많음", "wf3Pm": "맑음", "rnSt3Am": 30, "rnSt3Pm": 20, ... }
```
숫자 3~10 = N일 후. 리그 예측 기준값으로 활용.

---

## 3. 과거관측 일자료 (typ01 `kma_sfcdd.php`) — **openApi 아님**

⚠️ **API허브에는 `AsosDalyInfoService`가 없다.** 그리고 openApi 대체품
(`SfcMtlyInfoService/getDailyWthrData`)은 **월보(月報)라 당월을 주지 않는다** —
어제 날짜로 부르면 `resultCode=99 "발간되지 않은 기간입니다"`다(2026-08-10 실측).
우리가 필요한 건 전부 당월이므로(대결 정산=어제, 리그 정산=지난주, 브리핑=최근
며칠) 월보는 **쓸 수 없다.** 폴백이 아니라 **교체**인 이유다.

종전 스펙(startDt/endDt + stnIds + avgTa/maxTa/sumRn)은 공공데이터포털 시절 것이라
더는 유효하지 않다.

**요청 파라미터** (`https://apihub.kma.go.kr/api/typ01/url/kma_sfcdd.php`)
| 파라미터 | 값 |
|---|---|
| tm | YYYYMMDD — **하루 단위**. 기간은 어댑터가 날짜로 펴서 하루 1콜씩 부른다 |
| stn | 지점번호 (서울=108, 부산=159, 강릉=105 — 번호 체계는 종전과 같다) |
| help | 0 (주석 블록 축소. 파서는 `#` 줄을 어차피 버린다) |

**응답은 JSON이 아니다.** `#`로 시작하는 주석/헤더 + 콤마 구분 텍스트 1행/일.
컬럼 인덱스(0-based)와 결측 표기는 2026-08-10 서울(108) 실측으로 확정했다.

| 우리 출력 | typ01 컬럼(1-based 문서번호) | 인덱스 |
|---|---|---|
| `tm` | 1 TM | 0 |
| `avgTa` | 11 TA_AVG | 10 |
| `maxTa` | 12 TA_MAX | 11 |
| `minTa` | 14 TA_MIN | 13 |
| `sumRn` | 39 RN_DAY | 38 |

- 컬럼 수는 **57**. 미달 행은 버린다 — 어긋난 인덱스가 결측보다 나쁘다.
- **결측은 `-9` / `-9.0` / `-9.00`**이다(실측: 무강수일의 `RN_DAY=-9.0`). 문자열로
  판정해 기존 결측 표현(0.0)으로 흡수한다. 놓치면 **강수 -9mm·기온 -9℃가 정산에
  들어간다** — 승패가 조용히 틀린다.

**어댑터가 흡수한다** — `weather_api.py`(backend) / `kma_client.py`(celery)의
`asos_days` · `parse_asos_text` · `asos_value` · `normalize_asos_tm` ·
`asos_in_range`가 하루 단위 텍스트 API를 기간 조회처럼 감싸므로 **호출측 시그니처와
반환 형태는 종전 그대로**다 (`get_past_observation(start_dt, end_dt, ...)` →
`[{tm, avgTa, maxTa, minTa, sumRn}]`). 계약은
`backend/tests/test_kma_asos_adapter.py`가 소유하고, 실측 응답 1행을 픽스처로 박아
기상청이 컬럼을 바꾸면 CI가 울게 해 뒀다.

**활용신청은 「지상관측 > 종관기상관측(ASOS) > 1.3 일자료」**다 — 4.5(월보)가 아니다.
1.4 `kma_sfcdd3.php`(tm1~tm2 기간 조회)는 1콜로 끝나 더 깔끔하지만 별도 승인이
필요하다(미승인 시 **HTTP 403** — 실측). 주간 정산 7콜은 한도 20,000콜/일 대비
무시할 수 있어 1.3으로 간다.
→ 이상기후 사례 큐레이션 원본. (`anomaly_cases` 벡터 컬렉션은 선언만 되고 쓰인 적이 없어 R13 3일차에 철거됐다 — `docs/specs/01`.)

---

## 공통 에러 처리 정책

```python
# 1. resultCode 체크
if result_code != "00":
    if result_code == "03":  # NODATA
        return cached_fallback(region)  # Redis 이전 캐시
    raise KMAApiError(result_code)

# 2. 타임아웃: httpx timeout=10초, 실패 시 1회 재시도 후 캐시 fallback
# 3. 캐시 우선: 항상 Redis(weather:{date}:{region}) 먼저 확인, miss일 때만 API 호출
```

---

## 바이브 코딩 지시사항

```
backend/app/services/weather_api.py에 get_short_forecast, get_mid_forecast,
get_past_observation 3개 async 함수를 위 스펙대로 구현해줘.
KMA_GRID, KMA_CATEGORY는 상수로 파일 상단에 두고, httpx.AsyncClient 사용,
resultCode 체크 → Redis 캐시 확인 → API 호출 → 파싱 → 캐시 저장 순서로 만들어줘.
PCP/PTY의 "강수없음" 문자열 처리와 category별 grouping 로직을 반드시 포함해줘.
파싱 결과를 시간대별 dict로 재구성하는 헬퍼 함수도 같이 만들어줘.
```
