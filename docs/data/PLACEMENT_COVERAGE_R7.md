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
