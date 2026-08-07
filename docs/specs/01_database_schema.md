# DB 스키마 상세 스펙

> 이 문서는 Claude Code 등 AI 코딩 도구에 그대로 입력해서 SQLAlchemy 모델 + Alembic 마이그레이션을 생성하는 데 쓴다.

## PostgreSQL 테이블 5종

### 1. users
| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| email | VARCHAR(255) | UNIQUE, NOT NULL | |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt |
| nickname | VARCHAR(50) | NOT NULL | |
| level_group | VARCHAR(20) | NOT NULL, CHECK IN ('elementary','middle_high','adult') | 초등/중고등/성인 |
| xp | INTEGER | NOT NULL, DEFAULT 0 | |
| streak_count | INTEGER | NOT NULL, DEFAULT 0 | |
| last_login_date | DATE | NULL | 스트릭 계산용 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

RLS 정책: `CREATE POLICY user_isolation ON users USING (id = current_setting('app.current_user_id')::uuid);`

### 2. quiz_logs
| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| quiz_id | VARCHAR(50) | NOT NULL | 문제 고유 ID (날짜+시퀀스) |
| concept_tag | VARCHAR(50) | NOT NULL | 예: 'pressure_front', 'heat_island' |
| question_type | VARCHAR(20) | CHECK IN ('multiple_choice','short_answer','slider') | |
| question_json | JSONB | NOT NULL | Quiz Gen Chain 출력 원본 |
| user_answer | TEXT | NULL | |
| is_correct | BOOLEAN | NULL | |
| elapsed_sec | INTEGER | NULL | |
| answered_at | TIMESTAMPTZ | DEFAULT now() | |

RLS: user_id 기반 격리 (users와 동일 패턴)

인덱스: `CREATE INDEX idx_quiz_logs_user_concept ON quiz_logs(user_id, concept_tag);` (Router Chain 집계용)

### 3. weak_tags
| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id | |
| concept_tag | VARCHAR(50) | NOT NULL | |
| wrong_count | INTEGER | DEFAULT 0 | |
| total_count | INTEGER | DEFAULT 0 | |
| accuracy_rate | NUMERIC(5,2) | GENERATED ALWAYS AS (CASE WHEN total_count=0 THEN 0 ELSE round(100.0*(total_count-wrong_count)/total_count,2) END) STORED | |
| updated_at | TIMESTAMPTZ | DEFAULT now() | |

UNIQUE(user_id, concept_tag)

**Router Chain 분기 임계값**: `accuracy_rate < 60` → 집중 문제 분기 (개발계획서 3-2 기준과 일치)

### 4. attendance
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users.id |
| attend_date | DATE | NOT NULL |
| streak_count_snapshot | INTEGER | |

UNIQUE(user_id, attend_date)

### 5. league_results
| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id | |
| week_start | DATE | NOT NULL | |
| predicted_value | JSONB | NOT NULL | 예: {"temp_max": 28, "rain_prob": 30} |
| actual_value | JSONB | NULL | 관측 확정 후 채움 |
| accuracy_score | NUMERIC(5,2) | NULL | |
| elo_rating_after | INTEGER | NULL | |

---

## 벡터 저장소 — 없다 (R13 3일차, 2026-08-07 철거)

여기엔 Chroma 컬렉션 3종(`weather_daily`·`climate_concepts`·`anomaly_cases`)과
임베딩 모델(`text-embedding-3-small`, 1536차원)·검색 파라미터(top_k=3, threshold 0.7)가
적혀 있었다. **셋 다 지웠고, 되살릴 이유가 아직 없다.**

- `climate_concepts`의 소비처(피드백 체인)는 이제 `concept_tag`로
  `database/seed/climate_concepts.json`을 **직접 조회**한다. 코퍼스가 8KB(35항목·
  12태그)라 색인이 푸는 문제가 없다. 근거는 `docs/specs/03_ai_chains_spec.md` §3.1.
- `weather_daily`가 실어 나르던 오늘 날씨는 같은 프롬프트에 `today_weather_json`으로
  **이미 직접** 들어간다 — 같은 정보의 두 번째 경로였다. Celery 수집 태스크는 그대로
  살아 있고(Redis 캐시), 사라진 것은 벡터 갱신 트리거뿐이다.
- `anomaly_cases`는 **선언만 되고 어디서도 읽히지 않았다**(3컬렉션 중 실사용 1종).

되살리려면 먼저 "태그가 불확정인 검색 질의"나 "수 MB 코퍼스"가 생겼는지 보라.
그 전에는 벡터 저장소가 답인 질문이 이 서비스에 없다.

---

## Redis 키 네이밍 규칙

| 키 패턴 | TTL | 용도 |
|---|---|---|
| `weather:{date}:{region}` | 1시간 | 기상청 API 응답 캐시 |
| `session:{user_id}` | 7일 | JWT refresh token |
| `quiz:{date}:{level_group}` | 24시간 | 일일 문제 캐시 |
| `celery:task:*` | - | Celery 브로커 큐 |

---

## 바이브 코딩 지시사항 (Claude Code에 그대로 전달할 문장)

```
backend/app/models/ 아래에 SQLAlchemy 2.0 스타일(Mapped, mapped_column)로
users, quiz_log, weak_tag, attendance, league_result 5개 모델을 위 스펙대로 작성해줘.
UUID는 postgresql.UUID(as_uuid=True) 사용, 관계는 relationship()으로 연결해줘.
그 다음 alembic revision --autogenerate로 초기 마이그레이션을 만들어줘.
RLS 정책은 alembic migration 안에 raw SQL(op.execute)로 포함시켜줘.
```
