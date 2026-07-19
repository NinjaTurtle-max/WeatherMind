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
| GET | /me | XP·레벨·스트릭 조회 | `{xp, level, streak_count, next_level_xp}` |
| GET | /weak-tags | 내 약점 태그 목록 (accuracy_rate 오름차순) | `WeakTag[]` |
| POST | /attendance | 출석 체크 (하루 1회) | `{streak_count, is_new_record}` |

---

## 4. League API (`/api/v1/league`)

| Method | Path | 설명 | 요청 | 응답 |
|---|---|---|---|---|
| GET | /current | 이번 주 예측 대상 기간·지역 | - | `{week_start, region, mid_forecast}` |
| POST | /predict | 예측값 제출 (주 1회) | `{temp_max, temp_min, rain_prob}` | `{"submitted": true}` |
| GET | /leaderboard | 순위표 | `?week=...` | `LeagueRank[]` |
| GET | /me/results | 내 리그 이력 | - | `LeagueResult[]` |

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
