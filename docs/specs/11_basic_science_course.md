# 11 — 기초과학 코스 개념 트리 설계

**작성: 2026-08-04 (PM, R11-01 항목 S). 상위 문서: `docs/ROADMAP.md` §5.1.1**(다과정
구조·θ 교차 유지·"기초과학은 기상의 선행 코스"). 코스 **구조**(모델·API)는 R11-01
계약 F가, 이 문서는 **무엇을 가르치는 코스인가**를 확정한다. 문항 저작은 키 게이트
G1(ROADMAP §5.3.1) 이후 — 이 문서가 그 저작의 발주서다.

## 0. 설계 원칙 (ROADMAP §5.1.1의 구체화)

1. **개념 태그가 θ의 통화다 — 코스는 묶음일 뿐이다.** 기초과학에서 측정한 "복사" θ가
   기상 코스 열섬 문항의 난이도 선택에 그대로 반영되어야 한다. 따라서 태그는
   `user_concept_ability`·IRT가 이미 쓰는 평면 네임스페이스에 **추가**되며, 코스
   접두사를 붙이지 않는다(`bs_radiation` ❌ → `radiation` ✅).
2. **기존 6태그는 불변.** `pressure_front`·`typhoon`·`air_mass`·`heat_island`·
   `co2_climate`·`anomaly`는 기상 코스 소유이고, 기초과학은 새 태그만 도입한다 —
   기존 문항·θ·약점 태그 데이터가 전부 그 6태그에 걸려 있다.
3. **"기상 이해의 전제"가 유닛 선정 기준이다.** 일반 과학 교양이 아니라, 기상 코스의
   각 섹션이 암묵적으로 가정하는 물리 개념을 역산해서 채운다(§2의 대응표가 근거).
4. **선행은 코스 간 잠금이 아니라 권장 경로다(웨이브 1 기준).** 기존 유저를 기초과학
   뒤로 잠그면 하위 호환이 깨진다. 코스 간 선행 관계는 구조(추천·표기)로 두고,
   강제 잠금 여부는 신규 유저 온보딩(R10-J 본체) 설계와 함께 웨이브 2에서 판정한다.

## 1. 신규 개념 태그 6종

기존 6태그와 같은 입도(섹션당 1~2태그, 문항 5~13건이 걸릴 수 있는 폭)로 자른다.

| 태그 | 이름 | 다루는 것 | 기상 코스에서 쓰이는 곳 |
|---|---|---|---|
| `temperature_heat` | 온도와 열 | 온도 vs 열, 비열, 열평형 | 기단의 성질(대륙/해양), 열섬 축열 |
| `radiation_budget` | 복사와 에너지 수지 | 태양복사·지구복사, 흡수/반사, 온실효과의 물리 | `co2_climate` 전체, 열섬(아스팔트 흡수) |
| `pressure_basics` | 압력의 기초 | 압력=힘/면적, 공기 무게, 고도와 기압 | `pressure_front` 전체, 슬라이더 hPa 문항 |
| `phase_change` | 물의 상태변화 | 증발·응결·잠열, 습도의 의미 | 전선의 구름 생성, 태풍 에너지원(잠열) |
| `density_buoyancy` | 밀도와 부력 | 온도→밀도→뜨고 가라앉음, 대류 | 기단 충돌, 보드 퍼즐 대류 판정 |
| `energy_transfer` | 에너지의 이동 | 전도·대류·복사 3형식 비교 | 대기 순환, 해륙풍, 열섬 완화 |

**로더 반영**: 문항 저작 시점(G1)에 `seed_content.ALLOWED_CONCEPT_TAGS`에 6태그를
추가한다 — 지금 추가하지 않는 이유는 태그만 열어두면 문항 없는 태그가 약점 태그·복습
큐 계산에 빈 축으로 끼기 때문이다. 트리(유닛)와 태그는 이 문서가, 개방 시점은 저작이
결정한다.

## 2. 섹션·유닛 트리 (3섹션 8유닛)

기상 코스(4섹션 12유닛)의 2/3 규모로 시작한다 — 선행 코스는 본 코스보다 가벼워야
이탈 없이 통과된다(듀오링고의 기초 스킬이 짧은 것과 같은 원리. 벤치마킹 근거는
Observation_Report_02·03에만 둔다 — 대외 문서 언급 금지 규약).

`units.json` 필드 규약(`id`·`section`·`unit_order`·`title`·`concept_tag`·
`prereq_unit_id`·`kind`·`crown_target`)을 그대로 따른다. id 접두사는 `bs-`.

### 섹션 1 — 열과 빛 (온도·복사)

| # | id | 제목(안) | concept_tag | prereq | kind |
|---|---|---|---|---|---|
| 1 | `bs-temp-vs-heat` | 온도와 열은 다르다 | `temperature_heat` | — | quiz |
| 2 | `bs-specific-heat` | 물은 왜 천천히 데워질까 | `temperature_heat` | bs-temp-vs-heat | quiz |
| 3 | `bs-radiation` | 햇빛이 지구를 데우는 방법 | `radiation_budget` | bs-temp-vs-heat | quiz |

### 섹션 2 — 공기의 무게 (압력·밀도)

| # | id | 제목(안) | concept_tag | prereq | kind |
|---|---|---|---|---|---|
| 1 | `bs-pressure` | 공기에도 무게가 있다 | `pressure_basics` | — | quiz |
| 2 | `bs-density-buoyancy` | 뜨거운 공기는 왜 올라갈까 | `density_buoyancy` | bs-pressure | quiz |
| 3 | `bs-convection-board` | 대류를 만들어 보자 | `density_buoyancy` | bs-density-buoyancy | **board** |

### 섹션 3 — 물과 에너지 (상태변화·이동)

| # | id | 제목(안) | concept_tag | prereq | kind |
|---|---|---|---|---|---|
| 1 | `bs-phase-change` | 사라진 물은 어디로 갔나 | `phase_change` | — | quiz |
| 2 | `bs-energy-transfer` | 열이 이동하는 세 가지 길 | `energy_transfer` | bs-phase-change | quiz |

- 섹션 내 선행만 걸고 **섹션 간 선행은 걸지 않는다** — 기상 코스와 같은 규약
  (섹션 첫 유닛 prereq=null). 순서는 unit_order가 표현한다.
- `bs-convection-board`는 기존 보드 퍼즐 엔진 재사용 — 대류 판정 규칙이
  `board_rules.json`에 이미 있다(한랭전선 vs 대류 우선순위 벡터 존재). 신규 판정
  규칙 저작 불요, 기존 퍼즐 중 대류 중심 배치를 선별 귀속.

### 기상 코스와의 개념 대응 (선행이 실제로 유효한 근거)

| 기상 섹션 | 전제하는 기초과학 유닛 |
|---|---|
| 하늘 읽기 (`pressure_front`) | bs-pressure, bs-density-buoyancy |
| 공기의 힘 (`air_mass`) | bs-temp-vs-heat, bs-specific-heat, bs-density-buoyancy |
| 큰 바람 (`typhoon`) | bs-phase-change (잠열이 태풍 에너지원) |
| 도시와 기후 (`heat_island`·`co2_climate`·`anomaly`) | bs-radiation, bs-energy-transfer |

## 3. 문항 저작 발주 규격 (G1 배치 입력)

- 유닛당 신규·복습 소화가 가능한 최소 **5문항** × 8유닛 = **40문항**이 파일럿 하한.
  유형 배합은 기상 코스 관례(mc 중심 + slider·cloze 혼합, 보드 유닛은 기존 퍼즐 귀속).
- slider 문항은 계약 G(`payload_contract`) 적용 — min/max/step/unit 필수. 예:
  "물 1g을 1℃ 올리는 데 필요한 열량(cal)" min=0 max=10 step=1 unit=cal.
- 생성 프롬프트의 `concept_tag` 화이트리스트(03번 스펙)에 신규 6태그 추가 필요 —
  **03번 스펙과 `quiz_gen_chain.py`를 동시 개정**해야 하며 `test_prompt_spec_parity`가
  드리프트를 감시한다.
- `level_group`은 3종 전부 저작하되 elementary를 기본 톤으로 — 선행 코스의 독자는
  기상 코스보다 어리다고 가정한다.

## 4. 이 문서가 결정하지 않는 것

- **코스 간 강제 잠금 여부** — 웨이브 2(온보딩 재배치와 함께). §0-4.
- 배치고사(θ 선해제)가 기초과학 유닛도 여는지 — placement 개념 커버리지가 신규
  6태그를 포함해야 하는가의 문제. 마일스톤 4 트랙(C1)의 복원 검증 결과를 보고 판정.
- 문항 실물 — G1 배치.
