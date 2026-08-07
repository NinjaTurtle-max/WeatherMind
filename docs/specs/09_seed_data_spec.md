# 시드 데이터 스펙 (climate_concepts 개념 문서)

> 피드백 체인이 학습자에게 "사실"을 말하려면 그 개념의 정본이 있어야 한다.
> 그 정본이 `database/seed/climate_concepts.json`이다.
>
> **적재 단계는 없다(R13 3일차, 2026-08-07).** 이 파일은 원래 Chroma에 임베딩해
> 넣는 원본이었고, 이 문서도 "초기 적재 스펙"이었다. 지금은 ai-worker가 컨테이너에
> 마운트된 이 json을 그대로 읽는다 — 별도 적재 명령·벡터 저장소·임베딩 키가 없다.
> 왜 검색을 걷어냈는지는 `docs/specs/03_ai_chains_spec.md` §3.1.

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

## 소비 경로 (적재 스크립트 없음)

```
1. docker-compose가 ./database/seed 를 ai-worker의 /app/database/seed 에 :ro 마운트
2. ai-worker/app/chains/rag_chain.py 가 concept_tag → 문서 리스트로 색인 (프로세스 캐시)
3. 피드백 생성 시 그 태그의 문서 전부를 프롬프트 참고 지식 블록에 주입
```

경로 해석 관례(env `CLIMATE_CONCEPTS_PATH` → `/app` 마운트 → 상위 탐색)는
`ai-worker/app/chains/seed_paths.py`가 단일 소유한다 — `level_vocabulary.json`도
같은 함수를 쓴다. **마운트가 없으면 개념 문서가 통째로 비고**, 그 경우 피드백은
참고 지식 줄이 빠진 변형 프롬프트로 나간다(조용히 거짓을 말하지는 않는다).

### 개념 문서가 없는 태그

본시드 실측(2026-08-07): 문항 237건 중 15건(`flood_response`·`wildfire_weather`)이
개념 문서가 없는 태그다. 이 둘의 문서를 쓰면 그만큼 피드백 품질이 올라간다 —
저작 대상이지 결함은 아니다.

---

## 바이브 코딩 지시사항

```
database/seed/climate_concepts.json 파일을 위 6개 concept_tag 각각에 대해
3개씩 총 18개 청크로 만들어줘 (내용은 중학교 과학 교과 수준의 정확한 기상 지식으로).
(적재 스크립트 지시는 R13 3일차에 삭제됐다 — 임베딩·벡터 저장소가 없다.)
```
