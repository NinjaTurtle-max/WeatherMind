# API 스펙

> FastAPI 라우터 4종 상세 정의. 각 엔드포인트는 Pydantic 스키마와 함께 작성한다.

## 공통 규칙

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer {JWT}` 헤더 (auth 라우터 제외 전부 필수)
- 에러 응답 포맷: `{"detail": "메시지", "code": "ERROR_CODE"}`
- 모든 timestamp는 ISO 8601 UTC

---

## 1. Auth API (`/api/v1/auth`)

| Method | Path | 설명 | 요청 | 응답 |
|---|---|---|---|---|
| POST | /register | 회원가입 | `{email, password, nickname, level_group}` | `{user_id, access_token}` |
| POST | /login | 로그인 | `{email, password}` | `{access_token, refresh_token}` |
| POST | /refresh | 토큰 갱신 | `{refresh_token}` | `{access_token}` |
| POST | /logout | 로그아웃 (Redis 세션 삭제) | - | `{"success": true}` |

JWT payload: `{"sub": user_id, "level_group": ..., "exp": ...}`
→ 이 payload가 PostgreSQL RLS의 `current_setting('app.current_user_id')`에 세션 시작 시 주입됨 (`SET app.current_user_id = '{user_id}'`)

---

## 2. Quiz API (`/api/v1/quiz`)

| Method | Path | 설명 | 요청 | 응답 |
|---|---|---|---|---|
| GET | /today | 오늘의 퀴즈 조회 (Redis 캐시 우선) | - | `QuizQuestion[]` |
| POST | /{quiz_id}/answer | 답안 제출 | `{answer: string}` | `AnswerResult` |
| GET | /history | 내 퀴즈 이력 | `?limit=20` | `QuizLog[]` |

**QuizQuestion 스키마**
```json
{
  "quiz_id": "20260710-001",
  "concept_tag": "pressure_front",
  "question_type": "multiple_choice",
  "question_text": "오늘 서울 하늘이 흐린 이유로 가장 알맞은 것은?",
  "options": ["고기압 확장", "저기압 접근", "황사", "복사냉각"],
  "level_group": "middle_high"
}
```

**AnswerResult 스키마** (내부적으로 ai-worker의 RAG Chain 호출 결과 포함)
```json
{
  "is_correct": false,
  "correct_answer": "저기압 접근",
  "feedback": "저기압이 접근하면 상승기류가 발달해 구름이 만들어져요. 오늘 서울은...",
  "xp_earned": 0,
  "concept_tag": "pressure_front"
}
```

---

## 3. Progress API (`/api/v1/progress`)

| Method | Path | 설명 | 응답 |
|---|---|---|---|
| GET | /me | XP·레벨·스트릭·티어·에너지·스파인 종합 | `ProgressMe` (아래) |
| GET | /weak-tags | θ 파생 약점 개념 (학령 상대 임계, θ 오름차순 — R8-01 §3.5) | `WeakConceptOut[]` (아래) |
| POST | /attendance | 출석 체크 (하루 1회) | `{streak_count, is_new_record}` |
| GET | /quests | 오늘의 일일 퀘스트 진행/완료 (R4-01 §3.1) | `[{code, title, progress, target, done, xp_reward}]` |
| GET | /badges | 배지 정의 + 획득 시각 — 미획득은 `earned_at: null` (R4-01 §3.3) | `[{code, title, description, earned_at}]` |
| GET | /energy | 구름 에너지 잔량·회복 ETA (R5-01 §3.3) | `{clouds, max, next_regen_sec, updated_at}` |
| GET | /abilities | WeatherBrain 개념별 IRT 능력 θ, 약한 순 (R6 §5) | `[{concept_tag, theta, theta_se, num_responses, level_label, updated_at}]` |

**ProgressMe 스키마** (GET /me — 현행 전체 필드, R8-01 §3.3 기준)
```json
{
  "xp": 120,
  "level": 2,
  "streak_count": 4,
  "streak_freeze_count": 1,
  "next_level_xp": 200,
  "tier": "cumulus",
  "clouds": 3,
  "next_regen_sec": 840,
  "placement_done": true,
  "spine": {
    "units_total": 12,
    "units_cleared": 2,
    "crowns_earned": 3,
    "crowns_total": 15,
    "current_unit": {"slug": "read-sky-board", "title": "지도에 전선을 세워 비를 내려라"}
  }
}
```
- `streak_freeze_count`: 스트릭 프리즈("구름 방패") 보유 수 (R2-01 §3.5)
- `tier`: 최근 리그 정산 티어, 없으면 `stratus` (R4-01 §3.2)
- `clouds`/`next_regen_sec`: 구름 에너지 잔량·다음 회복 ETA(초) (R5-01 §3.3)
- `placement_done`: 배치고사 완료 여부 — 온보딩 진입 분기 (R7-01 §3.5)
- `spine`: 유닛 진도 축 서버 집계 (R8-01 §3.3). `current_unit`은 잠기지 않은
  첫 미클리어 유닛(`{slug, title}`), 전부 클리어/잠금이면 `null`. `slug`는
  커리큘럼 트리 노출 `id`와 동일한 안정 참조 — `POST /curriculum/units/{slug}/session`
  경로 파라미터로 그대로 쓴다.

**WeakConceptOut 스키마** (GET /weak-tags — R8-01 §3.5, 구 `WeakTag[]`(accuracy_rate 집계) 대체)
```json
[
  {"concept_tag": "typhoon", "theta": -0.62, "threshold": 0.405, "num_responses": 4}
]
```
- 판정(θ 파생 단일 공급원): `num_responses > 0 AND theta < threshold` 인 개념만
  실린다 — 목록에 있으면 곧 약점. `threshold`는 학령 상대 임계
  (`b(level_group) + logit(0.6)`; middle_high ≈ 0.405). 정렬은 θ 오름차순(약한 순).

---

## 4. League API (`/api/v1/league`)

| Method | Path | 설명 | 요청 | 응답 |
|---|---|---|---|---|
| GET | /current | 이번 주 예측 대상 기간·지역 | - | `{week_start, region, mid_forecast}` |
| POST | /predict | 예측값 제출 (주 1회) | `{temp_max, temp_min, rain_prob}` | `{"submitted": true}` |
| GET | /leaderboard | 순위표 | `?week=...` | `LeagueRank[]` |
| GET | /me/results | 내 리그 이력 | - | `LeagueResult[]` |

---

## 5. Duel API (`/api/v1/duel`) — R4-01 §3.4 + R9-01 §3.1·§3.2 현행화

| Method | Path | 설명 | 요청 | 응답 |
|---|---|---|---|---|
| GET | /today | 오늘 대결(=내일 예보) 상태 | - | `DuelToday` |
| POST | /today | 내일 예보 제출 (1일 1회) | `{temp_max, rain_prob, evidence?}` | `DuelToday` |
| GET | /briefing | 대상일 판단 재료 일괄 (R9-01 §3.1 ②) | - | `DuelBriefing` |
| GET | /history | 내 지난 대결 이력 (정산 포함) | - | `DuelHistoryItem[]` |

**DuelToday 스키마** (R9-01 additive 필드 포함)
```json
{
  "duel_date": "2026-07-31",
  "submitted": true,
  "base_forecast": {"temp_max": 31.0, "rain_prob": 60, "noise_scale": null},
  "user_pred": {"temp_max": 29.0, "rain_prob": 40},
  "ai_pred": {"temp_max": 31.2, "rain_prob": 55, "noise_scale": 0.7},
  "actual": null,
  "user_score": null,
  "ai_score": null,
  "result": null,
  "evidence": ["pop_trend", "recent_rain"],
  "evidence_review": null,
  "caster_grade": "nimbostratus"
}
```
- `base_forecast`(R9-01 §3.1 ① additive): KMA 대상일 기준 예보. 실패·키 부재·
  대상일 미포함이면 `null` — 캐스터 내부 폴백 base(20.0/30)는 비노출.
- `ai_pred`는 제출 후에만 공개(`submitted=false`면 `null`). `noise_scale`은
  AI 캐스터 전용 감사 스냅샷(§3.2) — 유저 예측·R9 이전 행은 `null`.
- `evidence`(§3.1 ③ additive): 제출 시 선택한 근거 코드(user_pred JSONB 동봉
  저장, 마이그레이션 0). 화이트리스트 5종: `pop_trend`·`humidity_high`·
  `temp_drop`·`sky_overcast`·`recent_rain`. 순서 보존 중복 제거, 빈 배열은 `null`.
- `evidence_review`(§3.1 ④ additive): 정산 후에만 채워지는 근거 적중 해설
  `[{code, hit, note}]` — 결정적 순수 함수(`review_evidence`)로 계산.
- `caster_grade`(§3.2 additive): 제출 시점 캐스터 티어명 스냅샷(ai_pred JSONB
  파생). 티어별 노이즈 배율(계약 수치): stratus 1.00 / cumulus 0.85 /
  nimbostratus 0.70 / cumulonimbus 0.55 / typhoon_eye 0.40 — 기본 노이즈
  ±2.0℃/±15%p에 진폭만 곱한다(시드 (user,date) 불변 — 결정성 보존).

**DuelBriefing 스키마** (GET /briefing — R9-01 §3.1 ②)
```json
{
  "region": "서울",
  "target_date": "2026-07-31",
  "hourly": [{"datetime": "202607301500", "tmp": 30.0, "pop": 60, "pcp": 0.0,
              "reh": 75.0, "wsd": 2.5, "sky": 3, "pty": 0}],
  "today_observed": {"max_ta": 31.2, "min_ta": 24.0, "sum_rn": 0.0},
  "recent_days": [{"date": "2026-07-29", "max_ta": 30.1, "sum_rn": 12.5}]
}
```
- 전부 Redis 1h 캐시 뒤 — 부분 실패는 해당 필드만 `null`/빈 배열로 내리고
  **200 유지**(KMA 키 부재 시 프론트 degraded 모드, 예측 입력은 가능). DB 미사용.
- `hourly`는 제출일+대상일을 함께 담아 추세(pop_trend)·전일 대비(temp_drop)
  판단 재료를 제공. `today_observed`는 ASOS 일자료(D+1 공표라 당일 `null` 흔함).

**DuelHistoryItem**: DuelToday와 동일 정산 필드 + `evidence`·`evidence_review`·
`caster_grade`(전부 JSONB 스냅샷 파생 — R9 이전 행은 `null`).

**에러 코드**: 재제출 409 `ALREADY_SUBMITTED` · 범위 밖 예측 422
`INVALID_PREDICTION` · 미지 근거 코드 422 `INVALID_EVIDENCE`(§3.1-R9,
frontend mock과 문자열 일치 — test_error_code_contract가 가드).

---

## 내부 전용 엔드포인트 (ai-worker ↔ backend 통신, 프론트 미노출)

| Method | Path | 설명 |
|---|---|---|
| POST | /internal/router-decide | quiz_logs 누적 데이터 전달 → Router Chain 분기 결과 수신 |
| POST | /internal/rag-feedback | 오답 정보 전달 → RAG Chain 피드백 생성 요청 |
| POST | /internal/quiz-generate | 기상청 데이터 전달 → Quiz Gen Chain 문제 생성 요청 |

인증: 내부 네트워크 전용이므로 Docker 내부 서비스명(`http://ai-worker:8001`)으로만 접근, 별도 API 키로 보호.

---

## 바이브 코딩 지시사항

```
backend/app/routers/ 아래에 auth.py, quiz.py, progress.py, league.py 4개 파일을 만들어줘.
각 라우터는 APIRouter()로 만들고 위 스펙의 엔드포인트를 전부 구현해줘.
Quiz API의 answer 제출 시 ai-worker 서비스(http://ai-worker:8001/internal/rag-feedback)를
httpx.AsyncClient로 호출해서 피드백을 받아오는 로직을 services/ai_client.py에 분리해줘.
Pydantic 스키마는 backend/app/schemas/ 아래 도메인별 파일로 나눠줘 (quiz.py, auth.py 등).
```
