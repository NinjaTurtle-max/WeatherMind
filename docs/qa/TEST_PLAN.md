# 테스트 계획 — 스프린트 R2-01 S9 (QA)

> 운영 규칙: TEAM_PROCESS.md §1.6 (시프트 레프트 · 리스크 기반 우선순위 · P0~P3).
> 계약 원전: SPRINT_R2_01.md §3, docs/specs/07_gamification_spec.md.
> 실기동 검증 절차는 docs/qa/INTEGRATION_CHECKLIST.md 참조.

## 1. 리스크 기반 우선순위

돈·데이터 손실 > 핵심 루프 > 표시 오류 순. 이 프로젝트에서 "돈"에 해당하는
자산은 **XP·스트릭(유저 진행 자산)**과 **문항 뱅크(콘텐츠 자산)**다.

| 우선순위 | 영역 | 리스크 시나리오 | 검증 수단 |
|---|---|---|---|
| **P0** | XP 계산·채점 정확성 | 공식 오적용 → 전 유저 진행 자산 오염, 복구 불가 | test_gamification_formulas / test_answer_service |
| **P0** | 멱등성 (재제출·세션 발급·complete) | 이중 XP 적립·세션 중복 발급 → 데이터 정합 붕괴 | test_review_fix_regressions / 체크리스트 §3 |
| **P0** | RLS 유저 격리 | 타 유저 세션 접근 → 데이터 유출 | 체크리스트 §7 (실기동 전용) |
| **P1** | 세션 배합 (§3.2) | 배합 오류 → 핵심 학습 루프 품질 저하, 세션 발급 실패 | test_session_mix |
| **P1** | 스트릭 프리즈 (§3.5) | 오소모·오지급 → 유저 신뢰 자산(스트릭) 손상 | test_streak_freeze / 체크리스트 §4 |
| **P1** | 레이트리밋 (§3.6) | 부재 시 어뷰징(XP 파밍·생성 비용 폭증), 오구현 시 전역 차단 | test_rate_limit_keys / 체크리스트 §5 |
| **P1** | 시드·품질 게이트 (§3.3·§3.4) | 결함 문항 적재 → 오답 판정 분쟁, 콘텐츠 신뢰 손상 | test_seed_contract / ai-worker test_validate |
| **P2** | 실황 슬롯 치환 (§3.2 live) | 원문 `{today.*}` 노출·정답 불일치 — 표시·단일 문항 범위 | test_live_slots / 체크리스트 §3.1 |
| **P2** | 에러 코드·표시 계약 | mock↔서버 불일치 → 프론트 오처리 (기능 자체는 동작) | test_error_code_contract |

## 2. 자동화 커버리지 현황 (2026-07-20, 웨이브 2)

backend 145건 + ai-worker 11건 = **156건, 전부 통과** (DB·네트워크 불필요,
FakeDB/순수 함수 패턴). 실행: 각 디렉토리에서 `python -m pytest tests -q`.

| 계약 | 테스트 파일 | 건수 | 비고 |
|---|---|---|---|
| 07번 XP/레벨/약점/정확도/ELO 공식 | backend/tests/test_gamification_formulas.py | 30 | **신규** — 경계값(49/50·199/200), 1.5배 반올림, 수치 예제 |
| §3.1 채점 파이프라인·세션 XP 원자 가산 | backend/tests/test_answer_service.py | 7 | 웨이브 1 작성 |
| 리뷰 확정 1번 회귀(재제출 부수효과 0, /quiz 경로 세션 XP) | backend/tests/test_review_fix_regressions.py | 7 | **신규** — 라우터 레벨 포함 |
| §3.1 에러 코드 표준 ↔ mock 문자열 일치 | backend/tests/test_error_code_contract.py | 7 | **신규** — 소스 텍스트 검사 |
| §3.2 배합(2/2/1·대체·폴백·3연속 금지) | backend/tests/test_session_mix.py | 10 | 웨이브 1 작성 |
| §3.2 실황 슬롯 추출·치환·불변성 | backend/tests/test_live_slots.py | 7 | 웨이브 1 작성 |
| §3.3 시드 스키마·커버리지·슬롯 + §3.4 휴리스틱 26건 전건 통과 | backend/tests/test_seed_contract.py | 61 | **신규** — ai-worker validate_chain을 sys.path 조작으로 실임포트 (단일 진실원) |
| §3.5 스트릭 프리즈(소모·지급·리셋) | backend/tests/test_streak_freeze.py | 10 | 웨이브 1 작성 |
| §3.6 레이트리밋 키 산정(XFF 1홉·유저 키) | backend/tests/test_rate_limit_keys.py | 6 | 웨이브 1 작성 |
| §3.4 품질 게이트 골든셋·llm_skipped·1단 실패 시 2단 생략 | ai-worker/tests/test_validate.py | 11 | 웨이브 1 작성 |

**자동화 미커버 → 통합 체크리스트로만 검증** (실기동 필요):
마이그레이션 0002 적용 · 시드 DB 적재 멱등 · 세션 발급 E2E(라우터+DB+Redis) ·
동시 발급 UNIQUE 경합 · RLS 격리 · 429 실동작·한도 수치 · Redis 퀴즈 캐시 ·
Celery 주간 정산. → INTEGRATION_CHECKLIST.md §1~§7.

## 3. 이번 라운드 발견 결함·관찰 목록

스위트 실행과 소스·계약 대조에서 **P0~P2 결함 0건**. 관찰 3건:

| # | 분류 | 내용 | 조치 제안 |
|---|---|---|---|
| 1 | **P3** | mock(frontend/mock/apiMockPlugin.js)에 429 `RATE_LIMITED` 시뮬레이션 부재 — §3.1 표준 4코드 중 유일하게 mock에 없음. 프론트가 레이트리밋 UX(재시도 안내)를 mock으로 리허설할 수 없다. 나머지 3코드는 문자열 일치 확인 완료 (test_error_code_contract가 지속 가드) | R3에서 프론트가 mock에 429 경로 추가 검토 |
| 2 | **P3** (스펙 모호) | 약점+첫시도 정답 XP = (10+5)×1.5 = 22.5 → 파이썬 `round()`의 banker's rounding으로 **22** 적립. 07번 스펙은 "1.5배"만 규정하고 반올림 방식 미규정 — 일반 기대(반올림=23)와 1XP 차이 가능 | PM이 07번에 반올림 방식 명문화. 현재 값(22)은 test_gamification_formulas가 회귀 고정 |
| 3 | 관찰 (백로그) | 시드 26건의 adult 학령 문항이 3건뿐(air_mass·co2_climate·anomaly만). S8 AC(6태그×2학령)는 충족하나 adult 유저의 new 풀이 얇아 §3.2 배합이 생성 폴백에 조기 의존 | R3 시드 증보 시 adult 우선 저작 |

웨이브 1 리뷰 확정 10건의 수정은 모두 코드에 반영되어 있음을 확인
(멱등 가드·세션 XP 서비스층 이관, XFF 1홉 키, 원자 UPDATE, 코드 표준 통일 등 —
관련 회귀 테스트가 각각 존재).

---

# PART B — R3~R5 통합 검증 (통합 웨이브 2, 2026-07-22)

> 계약 원전: SPRINT_R3_01.md·R4_01.md·R5_01.md §3. R2(PART A) 위에 대기 보드 퍼즐·
> 신규 3유형(R3)·보상 루프(R4)·커리큘럼·구름 에너지(R5)를 얹었다. 각 직군 자체
> 테스트가 이미 탄탄하므로 QA는 **직군 경계 계약 회귀**를 net-new로 보강하고 전 스위트를
> 재실행했다.

## B-1. R3~R5 리스크 기반 우선순위

| 우선순위 | 영역 | 리스크 시나리오 | 검증 수단 |
|---|---|---|---|
| **P0** | 보드 권위 채점 (R3 §3.4) | 클라이언트 판정 신뢰 → 위조 클리어로 XP·왕관 부정 취득 | test_r3_r5_contract(스키마 구조+GRADERS) / test_board_engine |
| **P0** | 구름 소모·회복 원자성 (R5 §3.3) | 이중 차감/무한 회복 → 리텐션 자원 오염, 무료 파밍 | test_cloud_energy / 체크리스트 §13 |
| **P0** | 커리큘럼 잠금 체인 (R5 §3.2) | slug↔자연키 불일치로 prereq 소실 → 전 유닛 무잠금(핵심 기능 무력화) | test_curriculum_tree / test_r3_r5_contract(3자 정합) / 체크리스트 §10·§12 |
| **P0** | 보상 XP 정확·멱등 (R4 §3.1·3.4) | 퀘스트 이중 지급·대결 오정산 → 진행 자산 오염 | test_quest_recalc / test_duel / test_badge_award |
| **P1** | 신규 3유형 채점 (R3 §3.6) | match/ordering/cloze 오채점 → 오답 분쟁 | test_grader_registry |
| **P1** | 규칙 데이터 무결성 (R3 §3.2) | priority 모순·조건 문법 위반 → 비결정 판정 | test_board_engine / test_seed_contract(board_rules) |
| **P1** | 리그 티어 경계 (R4 §3.2) | ELO 경계 오산 → 잘못된 승급/배지 | test_league_tier |
| **P1** | 시드 계약 규모 (R3~R5 §3.3) | content 47·units 12·badges 5·rules 8 이탈 → 콘텐츠/커리큘럼 결손 | test_seed_contract |
| **P2** | 신규 에러 코드 계약 (R3~R5) | mock↔서버 불일치 → 프론트 오처리 | test_error_code_contract |
| **P2** | 세션 board 렌더 필드 (R3 §3.3) | template_json 미노출 → 실서버 board 문항 렌더 불가 | test_session_board_item |

## B-2. 자동화 커버리지 (2026-07-22)

backend **404 passed + 1 skipped** + ai-worker **53 passed** = **457 통과 / 1 skip**
(DB·네트워크 불필요, 순수함수·소스텍스트·시드파일 패턴). R2 대비 +301 (156→457).

| 계약 | 테스트 파일 | 건수 | 라운드 |
|---|---|---|---|
| R3 §3.1·3.2 보드 엔진(검증·판정·규칙·공유벡터 10) | backend/test_board_engine.py | 47 | R3 |
| R3 §3.6 채점기 레지스트리(7유형) | backend/test_grader_registry.py | 23 | R3 |
| R3 §3.3 SessionItem template_json 노출(리뷰 결함 회귀) | backend/test_session_board_item.py | 7 | R3 |
| R4 §3.1 퀘스트 당일집계 재계산·멱등·1회지급 | backend/test_quest_recalc.py | 15 | R4 |
| R4 §3.2 리그 티어 ELO 경계(1099/1100/1549/1550) | backend/test_league_tier.py | 17 | R4 |
| R4 §3.3 배지 지급·멱등 | backend/test_badge_award.py | 7 | R4 |
| R4 §3.4 예보 대결 예측 결정성·노이즈범위·승패 | backend/test_duel.py | 24 | R4 |
| R5 §3.3 구름 에너지 회복·소모·경계·플래그 | backend/test_cloud_energy.py | 20 | R5 |
| R5 §3.2 커리큘럼 트리·잠금·왕관·실 units.json 12 | backend/test_curriculum_tree.py | 24 | R5 |
| R2~R5 에러 코드 표준(R2 4종 + **R3~R5 7종 총점검**) | backend/test_error_code_contract.py | 16 | R2+**QA** |
| R2~R5 시드 계약(content 47 + **units·badges·board_rules**) | backend/test_seed_contract.py | 114 | R2+**QA** |
| **R3~R5 계약 회귀(보드 권위·구름 상수·커리큘럼 3자 정합)** | backend/test_r3_r5_contract.py | 14 | **QA 신규** |
| R5 §3.6 커리큘럼 게이트(unit 참조 무결성) | ai-worker/test_curriculum_validate.py | 14 | R5 |
| R2~R4 품질 게이트 골든셋(신규 4유형 포함) | ai-worker/test_validate.py | 39 | R2~R4 |
| (그 외 R2 계승분 — PART A §2) | backend/test_*.py 다수 | 나머지 | R2 |

**QA 웨이브 2 신규·확장 (34건)**: test_r3_r5_contract.py(신규 14) +
test_error_code_contract.py(R3~R5 7종 → +9) + test_seed_contract.py(units/badges/
board_rules/47건 → +11). 370→404.

**자동화 미커버 → 통합 체크리스트로만 검증**: 마이그레이션 0003~0005 순차·롤백,
신규 시드 DB 적재 멱등, 구름 소모/회복 실동작·원자성, 대결 정산 크론, 잠금 해제
E2E, RLS(quests·badges·duels·user_unit_progress). → INTEGRATION_CHECKLIST.md §9~§15.

## B-3. R3~R5 발견 결함·관찰

전 스위트 실행(457 통과)과 소스·계약 대조에서 **P0~P2 결함 0건**. 관찰 2건:

| # | 분류 | 내용 | 조치 제안 |
|---|---|---|---|
| 4 | **P3 (실행 절차)** | ai-worker는 conftest.py·pytest.ini가 없어 `pytest`(bare) 직접 실행 시 `app` 모듈 임포트 실패로 2파일 수집 오류. `python -m pytest`(cwd를 sys.path에 추가)로는 정상(각 테스트 docstring에 명시). CI(scripts/ci.sh)가 `python -m pytest`를 쓰면 무영향 | ai-worker에 `conftest.py`(빈 파일) 또는 `pyproject.toml[tool.pytest] rootdir` 추가로 bare `pytest`도 견고화 검토(AI/DevOps 소유) |
| 5 | 관찰 (밸런스) | R5 회고 기록: 일일 자유세션(5문항)과 구름 5개는 정합하나 mock 데모(9문항)는 중간 소진 발생 — 의도된 리텐션 루프. 유닛 세션 문항 수/구름 비율은 실사용 데이터로 튜닝 대상 | R6 원격 구성화 후보(문서화된 결정) |

**리뷰 확정 결함 회귀 반영 확인**: R3 SessionItem.template_json 노출
(test_session_board_item), R4 게이트 시그니처 정합·duel 크론(체크리스트 §14),
R5 slug 로더 정합·잠금 체인 생존(test_curriculum_tree·test_r3_r5_contract) —
각 회귀 테스트가 존재하며 전건 통과.

## 4. 실행 방법·환경

```bash
# backend (repo/backend에서)
python -m pytest tests -q          # 404 passed, 1 skipped 기대 (R2~R5)
# ai-worker (repo/ai-worker에서)
python -m pytest tests -q          # 53 passed 기대  (bare `pytest`는 §B-3 #4 참조)
```
- 의존성: fastapi·sqlalchemy·pydantic(-settings)·slowapi·python-jose·redis·pytest
  (backend/requirements.txt). ai-worker 1단·게이트 테스트는 pydantic·pytest만으로 동작
  (LLM 의존성은 지연 임포트).
- DB·Redis·외부 API 불필요 — CI(스토리 S10 scripts/ci.sh)에서 그대로 실행 가능.
- 스크래치패드 civenv: `.../scratchpad/civenv/bin/python -m pytest`.

## 5. DoD 대조 (TEAM_PROCESS.md §2.2)

- [x] 계약(§3 R2~R5)·07번 공식과 산출물 일치 — §2·§B-2 매핑 표
- [x] 신규 로직 테스트 통과 — R2 156/156, R2~R5 통합 457/457(+1 skip)
- [x] 타 직군 디렉토리 미수정 — backend/tests/·docs/qa/만 변경 (mock·소스는 읽기 전용 검사, 소스 무수정)
- [x] 결정 기록 — 각 테스트 파일 docstring + 본 문서(PART A·B)
