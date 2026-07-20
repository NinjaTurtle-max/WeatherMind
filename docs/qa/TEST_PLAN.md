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

## 4. 실행 방법·환경

```bash
# backend (repo/backend에서)
python -m pytest tests -q          # 145 passed 기대
# ai-worker (repo/ai-worker에서)
python -m pytest tests -q          # 11 passed 기대
```
- 의존성: fastapi·sqlalchemy·pydantic(-settings)·slowapi·python-jose·redis·pytest
  (backend/requirements.txt). ai-worker 1단 테스트는 pydantic·pytest만으로 동작
  (LLM 의존성은 지연 임포트).
- DB·Redis·외부 API 불필요 — CI(스토리 S10 scripts/ci.sh)에서 그대로 실행 가능.

## 5. DoD 대조 (TEAM_PROCESS.md §2.2)

- [x] 계약(§3)·07번 공식과 산출물 일치 — §2 매핑 표
- [x] 신규 로직 테스트 통과 — 156/156
- [x] 타 직군 디렉토리 미수정 — backend/tests/·docs/qa/만 변경 (mock은 읽기 전용 검사)
- [x] 결정 기록 — 각 테스트 파일 docstring + 본 문서
