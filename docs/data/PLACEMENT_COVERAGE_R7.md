# 배치고사 문항 커버리지 감사 (R7-01 S4)

> 대상: `database/seed/content_items.json` (v3, 47건)
> 배치고사 적격 조건: `question_type != 'board'` AND `uses_live_slots == false` AND `status == 'active'`
> 요구: 6 concept_tag × 3 level_group 조합마다 적격 문항 **≥ 1건**
> 집계 방법: 시드 JSON 전건 순회 스크립트 (CONTENT_GUIDE §6-2와 동일 방식)

## 1. 커버리지 매트릭스 — 보강 전 (적격 문항 수)

| concept_tag | elementary | middle_high | adult |
|---|---|---|---|
| air_mass | 1 | 3 | **0** |
| anomaly | 1 | 2 | 1 |
| co2_climate | 1 | 3 | 1 |
| heat_island | 1 | 3 | 1 |
| pressure_front | 1 | 3 | 1 |
| typhoon | 2 | 3 | 1 |

## 2. 구멍

| # | 조합 | 원인 |
|---|---|---|
| 1 | air_mass × adult | 해당 셀의 유일한 문항(편서풍대 객관식)이 `uses_live_slots=true`(`{today.region}`)라 배치고사 부적격 |

구멍은 1개 조합뿐이다. (참고: 적격 1건뿐인 셀이 7개 있으나 요구 조건 ≥1은 충족 —
배치고사 출제 다양성 관점의 후속 증보 후보로만 기록한다.)

## 3. 저작 목록 (구멍 보강, 2건)

| # | concept_tag | level_group | question_type | 내용 | 근거 청크 |
|---|---|---|---|---|---|
| 1 | air_mass | adult | multiple_choice | 시베리아 기단의 서해 통과 시 변질 → 서해안 폭설 메커니즘 | air_mass-3 |
| 2 | air_mass | adult | short_answer | 중위도 열 수송·날씨의 서→동 이동을 만드는 편서풍 | air_mass-2 |

두 건 모두 `uses_live_slots=false`, `status=active`, CONTENT_GUIDE §1~§4 준수.
단일 구멍이지만 배치고사가 같은 셀에서 문항을 고를 여지를 주기 위해 유형을 달리해 2건 저작.

## 4. 커버리지 매트릭스 — 보강 후 (적격 문항 수, 총 49건)

| concept_tag | elementary | middle_high | adult |
|---|---|---|---|
| air_mass | 1 | 3 | **2** |
| anomaly | 1 | 2 | 1 |
| co2_climate | 1 | 3 | 1 |
| heat_island | 1 | 3 | 1 |
| pressure_front | 1 | 3 | 1 |
| typhoon | 2 | 3 | 1 |

18/18 조합 적격 문항 ≥ 1건 충족.

## 5. 후속 조치 (데이터 소유 범위 밖 — 담당 직군 처리 필요)

- `backend/tests/test_seed_contract.py` `test_R3_R5_시드_증보_47건`이 시드 총량을
  47로 고정하고 있어, 본 증보(47→49) 반영 시 해당 계약 수치 갱신이 필요하다
  (데이터 직군은 backend 코드를 수정하지 않으므로 백엔드 담당에게 이관).

---

## 6. R7-02 S8 증보 — 취약 셀 4건 보강 (2026-07-29)

§2 각주에 후속 증보 후보로 기록해 둔 "적격 1건뿐인 셀" 중 4건을 승격해 보강했다.
배치고사를 서로소(문항 중복 없이)로 구성할 때 이 셀들은 재고가 1건뿐이어서 같은
문항이 항상 출제되는 취약 셀이었다.

### 6.1 저작 목록 (4건, 시드 총량 49→53)

| # | concept_tag | level_group | question_type | 내용 | 근거 청크 |
|---|---|---|---|---|---|
| 1 | air_mass | elementary | short_answer | 겨울 한파를 몰고 오는 차고 건조한 공기 덩어리 → 시베리아 기단 | air_mass-1 |
| 2 | anomaly | elementary | cloze | 폭염·한파처럼 평소 범위를 크게 벗어나는 현상 → 이상기후 | anomaly-0 |
| 3 | pressure_front | adult | ordering | 저기압 접근 → 공기 수렴 → 상승기류 → 냉각·구름 → 비의 과정 배열 | pressure_front-0 |
| 4 | typhoon | adult | match | 발생 해역·에너지원·태풍의 눈·상륙 후 변화 연결 | typhoon-0, 1, 2 |

4건 모두 `uses_live_slots=false`, `status=active`, CONTENT_GUIDE §1~§4 준수.
기존 재고와 유형을 달리해(기존 셀 재고는 mc·mc·short·mc) 셀 내 유형 다양성도 확보했다.

### 6.2 커버리지 매트릭스 — 보강 후 (적격 문항 수, 총 53건)

| concept_tag | elementary | middle_high | adult |
|---|---|---|---|
| air_mass | **2** | 3 | 2 |
| anomaly | **2** | 2 | 1 |
| co2_climate | 1 | 3 | 1 |
| heat_island | 1 | 3 | 1 |
| pressure_front | 1 | 3 | **2** |
| typhoon | 2 | 3 | **2** |

18/18 조합 적격 ≥ 1건 유지, 보강 4셀은 적격 2건으로 상향. (적격 1건 셀은 10→6개.
남은 6개는 후속 증보 후보로 계속 기록만 한다.)

### 6.3 검증 결과·후속 조치 (2026-07-29)

- `seed_content.validate_entry` 53건 전건 통과, ai-worker 1단 휴리스틱
  게이트(`run_heuristic_checks`) 신규 4건 PASS, ai-worker 테스트 86 passed·1 skipped.
- backend 테스트 497건 통과, **1건 의도적 실패**:
  `test_seed_contract.py::test_R3_R7_시드_증보_49건`이 시드 총량을 49로 고정하고
  있어 본 증보(49→53) 반영 시 53으로의 계약 수치 갱신이 필요하다 — §5와 동일하게
  백엔드 담당에게 이관(R7-05 전례대로 통합 웨이브에서 처리).
