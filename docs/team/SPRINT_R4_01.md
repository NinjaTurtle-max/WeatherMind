# 스프린트 R4-01 백로그 — 보상 루프 완성 (퀘스트·배지·리그 티어·예보 대결·미니 미션)

> 운영 규칙: docs/team/TEAM_PROCESS.md. §3 계약 고정. R3 종료 후 착수.

## 1. 스프린트 목표

XP를 벌 이유(퀘스트·대결)와 쌓인 실력이 보이는 장치(배지·티어)를 완성해 보상 루프를
닫는다. 관측 보고서 №2 §6.3의 예보 대결·미니 미션·재현 퍼즐을 구현한다.

**범위 제외(부채 명시)**: 기후 탐정 스토리·AI 캐스터 롤플레이(LLM 키 필요),
웹푸시(브라우저 구독 인프라), IRT 재학습(사용자 데이터 필요) — 로드맵 유지, 최종 보고에 명시.

## 2. 스토리와 담당

| # | 스토리 | 담당 | AC |
|---|---|---|---|
| R4-S1 | 일일 퀘스트 3종이 세션·보드 플레이로 진행되고 완료 시 보너스 XP | 백엔드+프론트 | §3.1, 당일 1회 완료, 진행 UI |
| R4-S2 | 리그 티어(구름 5단계)가 ELO로 산정·표시된다 | 백엔드(celery 포함)+프론트 | §3.2, 정산 시 tier 기록, 리더보드·프로필 표시 |
| R4-S3 | 배지가 저장·표시된다 (스트릭 3종 + 무오답 세션 + 티어 승급) | 백엔드+데이터+프론트 | §3.3, 중복 지급 없음 |
| R4-S4 | 사용자는 매일 AI 캐스터와 내일 예보 대결을 한다 | 백엔드(celery 포함)+프론트 | §3.4, 다음날 실측 정산, 승리 +15 XP |
| R4-S5 | 미니 미션(시간제한 보드)·재현 퍼즐(실제 사건 초기조건) | 데이터+프론트 | §3.5, 각 2건 이상 |
| R4-S6 | 품질 게이트가 R4 콘텐츠 메타를 검증 | AI | 시간제한·재현 필드 휴리스틱 |

## 3. 계약 (고정)

### 3.1 퀘스트

- 정의 3종(코드 고정): `daily_xp_30`(오늘 XP 합계 ≥30, 보상 +10) /
  `weak_correct_1`(약점 태그 정답 1회, +10) / `live_answered`(실황 문항 1회 응답, +5).
- 테이블(Alembic 0004): `quests`(id, code UNIQUE, title, rule_json, xp_reward) 정적 3행
  시드(마이그레이션 내 INSERT), `user_quest_progress`(user_id FK, quest_id FK, quest_date,
  progress INT, done BOOL, UNIQUE(user_id, quest_id, quest_date), RLS user_isolation).
- 갱신 시점: 세션 complete·보드 attempt 성공 시 **당일 quiz_logs·XP 집계로 재계산**
  (이벤트 카운터 아님 — 멱등). 완료 전환 시 xp_reward 지급(1회).
- API: GET /api/v1/progress/quests → `[{code, title, progress, target, done, xp_reward}]`

### 3.2 리그 티어 (구름 분류 네이밍 — §3 벤치마킹 원칙: 독자 세계관)

| tier 코드 | 표시명 | 조건(정산 시점 ELO) |
|---|---|---|
| stratus | 층운 | < 1100 (기본) |
| cumulus | 적운 | ≥ 1100 |
| nimbostratus | 난층운 | ≥ 1250 |
| cumulonimbus | 적란운 | ≥ 1400 |
| typhoon_eye | 태풍의 눈 | ≥ 1550 |

- `league_results.tier VARCHAR(20)` 추가(0004). celery 주간 정산이 elo_rating_after로
  tier 산정·기록. `/league/leaderboard` 응답에 tier 포함, `/progress/me`에 현재 tier
  (최근 정산 기준, 없으면 stratus).
- **소유권 예외**: 이번 스프린트에서 celery/app/tasks/league.py는 백엔드 직군이 수정한다.

### 3.3 배지

- `badges`(id, code UNIQUE, title, description) — 시드는 database/seed/badges.json
  (데이터 저작 5종: streak_7, streak_30, streak_100, perfect_session, tier_promoted),
  백엔드 로더가 seed_content와 같은 패턴으로 적재. `user_badges`(user_id FK, badge_id FK,
  earned_at, UNIQUE(user_id, badge_id), RLS).
- 지급 시점: streak_*는 출석 마일스톤(기존 update_streak 반환 활용), perfect_session은
  세션 complete(5/5 정답), tier_promoted는 정산 태스크(직전 tier보다 상승 시).
- API: GET /api/v1/progress/badges → `[{code, title, description, earned_at|null}]`

### 3.4 예보 대결 (daily duel)

- `duels`(id, user_id FK, duel_date UNIQUE(user_id, duel_date), user_pred JSONB,
  ai_pred JSONB, actual JSONB NULL, user_score/ai_score NUMERIC NULL,
  result VARCHAR(4) NULL CHECK IN ('win','lose','draw'), RLS) — 0004.
- AI 캐스터 예측 생성(백엔드, LLM 불필요): KMA 내일 예보(TMX·POP)에 결정적 노이즈
  (해시 시드 기반 온도 ±2.0·강수 ±15 범위) — 제출 시점에 함께 생성·고정.
- API: GET /api/v1/duel/today(오늘 대결 상태·AI 예측은 제출 후 공개),
  POST /api/v1/duel/today `{temp_max, rain_prob}` (1일 1회, 재제출 409 ALREADY_SUBMITTED),
  GET /api/v1/duel/history.
- 정산: celery 일일 태스크(기존 리그 정산 패턴·accuracy_score 재사용) — 어제 duels에
  실측 기록, 점수 비교로 result, 승리 시 +15 XP. 무실측 시 재시도(리그와 동일).

### 3.5 미니 미션·재현 퍼즐 (board 콘텐츠 확장)

- template_json 선택 필드 추가: `time_limit_sec`(미니 미션, 60~120),
  `based_on`({"event_name", "event_date", "region"} — 재현 퍼즐, anomaly 태그 필수).
- 프론트: time_limit_sec 있으면 카운트다운, 초과 시 실패 처리(재도전 무제한).
  based_on 있으면 "실화 배지" 표시(사건명·날짜).
- 서버 채점은 기존 board 채점기 그대로(시간은 v1에서 클라이언트 신고 — 부채 기록).

### 3.6 품질 게이트 확장

- board 휴리스틱에 추가: time_limit_sec 있으면 60~120 정수, based_on 있으면
  3필드 존재 + concept_tag가 anomaly.

## 4. 웨이브

- 웨이브 1(병렬): 백엔드(S1~S4 + 0004) / 프론트(S1·S2·S3·S4·S5 UI) / 데이터(badges.json,
  미니 미션 2·재현 퍼즐 2 시드, 가이드 갱신) / AI(S6)
- 웨이브 2(R3+R4 통합): QA(전 스프린트 회귀 + 신규 계약 테스트 + 체크리스트 갱신) /
  DevOps(ci 재실행·compose 정합·런북 갱신)

## 5. 리뷰 노트 · 회고

(웨이브 종료 시 PM 기록)
