# 시드 데이터 스펙 (Chroma climate_concepts 초기 적재)

> RAG가 작동하려면 Chroma에 지식이 있어야 한다. MVP용 최소 교과 개념 시드를 정의한다.
> 실제로는 이 내용을 database/seed/climate_concepts.json으로 만들어 초기 임베딩한다.

## 개념 태그 목록 (concept_tag 표준)

| concept_tag | 개념명 | 교과 연계 |
|---|---|---|
| pressure_front | 기압·전선 | 중2 과학 날씨 |
| typhoon | 태풍 | 중2 과학 날씨 |
| air_mass | 기단·대기순환 | 중2 과학 날씨 |
| heat_island | 열섬효과 | 통합과학 |
| co2_climate | CO₂와 기후변화 | 통합과학 환경 |
| anomaly | 이상기후 인과관계 | 통합과학 환경 |

## 시드 콘텐츠 예시 (각 개념당 3~5개 청크)

```json
[
  {
    "concept_tag": "pressure_front",
    "grade_level": "middle_high",
    "text": "저기압은 주변보다 기압이 낮은 지역으로, 공기가 모여 상승기류가 발달한다. 상승한 공기가 냉각되면 구름이 만들어지고 비가 내리기 쉽다. 그래서 저기압이 다가오면 날씨가 흐려지고 비가 올 확률이 높아진다."
  },
  {
    "concept_tag": "pressure_front",
    "grade_level": "middle_high",
    "text": "전선은 성질이 다른 두 기단이 만나는 경계면이다. 한랭전선은 찬 공기가 따뜻한 공기를 밀어올려 좁은 지역에 강한 비를 내리고, 온난전선은 넓은 지역에 약한 비를 오래 내린다."
  },
  {
    "concept_tag": "heat_island",
    "grade_level": "elementary",
    "text": "도시는 아스팔트와 콘크리트가 낮 동안 햇빛의 열을 저장했다가 밤에 내보내기 때문에 시골보다 더 덥다. 이것을 도시 열섬 현상이라고 한다. 자동차와 에어컨에서 나오는 열도 도시를 더 덥게 만든다."
  },
  {
    "concept_tag": "co2_climate",
    "grade_level": "adult",
    "text": "이산화탄소(CO₂)는 대표적인 온실가스로, 지구가 방출하는 적외선을 흡수해 대기 온도를 높인다. 산업화 이후 화석연료 사용으로 대기 중 CO₂ 농도가 크게 증가했으며, 이는 지구 평균기온 상승의 주요 원인으로 지목된다."
  }
]
```

> 위는 예시. MVP에선 6개 concept_tag × 각 3~5청크 = 약 20~30개 청크면 충분.
> 콘텐츠는 기상청·교과서 공개 자료 기반으로 팀이 직접 작성 (저작권·정확성 확보).

## 적재 스크립트 (ai-worker/app/embeddings/seed_concepts.py)

```
1. database/seed/climate_concepts.json 로드
2. 각 text를 text-embedding-3-small로 임베딩
3. Chroma climate_concepts 컬렉션에 upsert (metadata: concept_tag, grade_level)
4. 최초 1회 실행 (docker compose 최초 기동 후 수동 or init 스크립트)
```

---

## 바이브 코딩 지시사항

```
database/seed/climate_concepts.json 파일을 위 6개 concept_tag 각각에 대해
3개씩 총 18개 청크로 만들어줘 (내용은 중학교 과학 교과 수준의 정확한 기상 지식으로).
그리고 ai-worker/app/embeddings/seed_concepts.py에 이 json을 읽어서
text-embedding-3-small로 임베딩 후 Chroma climate_concepts 컬렉션에 적재하는
스크립트를 작성해줘. 멱등성 보장(재실행해도 중복 안 되게 id는 concept_tag+index).
```
