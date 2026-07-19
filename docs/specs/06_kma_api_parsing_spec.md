# 기상청 API 연동 상세 스펙

> KMA(기상청) 공공데이터 API는 응답 구조가 복잡하다. 이 문서 없이 AI가 파싱 코드를 짜면
> 거의 항상 틀린다. 실제 응답 구조와 파싱 규칙을 명시한다.

## 공통 사항

- 인증: 쿼리 파라미터 `serviceKey`에 발급키 삽입 (URL 인코딩 주의 — 이미 인코딩된 키면 재인코딩 금지)
- 응답 포맷: `dataType=JSON` 파라미터 필수 (기본은 XML)
- 모든 응답은 `response.body.items.item[]` 경로에 실제 데이터가 있음
- `response.header.resultCode == "00"` 이 성공. 그 외는 에러 (03=데이터없음, 파싱 전 반드시 체크)

---

## 1. 단기예보 (getVilageFcst)

**요청 파라미터**
| 파라미터 | 값 | 설명 |
|---|---|---|
| serviceKey | {발급키} | |
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

## 3. 과거관측 (getAsosDalyInfoList)

**요청 파라미터**
| 파라미터 | 값 |
|---|---|
| startDt / endDt | YYYYMMDD |
| stnIds | 지점번호 (서울=108, 부산=159, 강릉=105) |

**응답**: 일별 관측값 (평균기온 avgTa, 최고 maxTa, 일강수량 sumRn 등)
→ 이상기후 사례 큐레이션 및 Chroma anomaly_cases 임베딩 원본.

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
