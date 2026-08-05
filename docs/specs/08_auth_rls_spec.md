# 인증 흐름 · RLS 주입 상세 스펙

> JWT → PostgreSQL Row-Level Security 연결은 개념만으론 구현 불가. **실제 구현된
> 동작 기준**으로 명시한다 (R11-01 §7에서 실동작 정합으로 갱신 — 이전 판은
> 설계 서술과 실동작이 달랐다).

## 전체 인증 흐름

```
1. 로그인 → JWT access token 발급 (payload에 user_id(sub), level_group 포함)
2. 이후 모든 요청 → Authorization: Bearer {token} 헤더
3. FastAPI 의존성(get_current_user)이 토큰 검증 + Redis session:{user_id} 존재
   확인 → User 로드
4. 유저 컨텍스트 라우터는 get_db_with_rls 세션 사용 — 트랜잭션 시작 직후
   set_config('app.current_user_id', :uid, true) 실행 (SET LOCAL 동등)
5. 이후 그 요청의 모든 쿼리는 user_isolation 정책에 의해 자동으로 해당
   user_id 데이터만 반환
```

## DB 세션 의존성 2종 (backend/app/core/dependencies.py — 실제 구현)

| 의존성 | GUC 주입 | 용도 |
|---|---|---|
| `get_db` | 없음 | 유저 컨텍스트가 없는 auth 라우터(로그인·가입·refresh) · 전체 공개 집계(리그 리더보드) |
| `get_db_with_rls` | `set_config('app.current_user_id', :uid, true)` | 유저 데이터를 다루는 전 라우터 (dev 라우터 포함) |

```python
async def get_db_with_rls(
    user: User = Depends(get_current_user),
) -> AsyncGenerator:
    async with async_session() as session:
        async with session.begin():
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user.id)},
            )
            yield session
```

**GUC 수명 계약**: `set_config(..., is_local := true)`는 `SET LOCAL`과 동일 —
**트랜잭션 스코프**라 커넥션 풀 오염이 없다. 이 세션은 요청 전체가
`session.begin()` 단일 트랜잭션이고 서비스 계층은 `flush`만 쓴다(중간 `commit`
금지 — commit 하는 순간 GUC가 사라져 앱 롤에서는 이후 쿼리가 전부 0행이 된다).
예외적으로 register/guest는 `get_db` 세션에서 유저 INSERT 후 같은 set_config를
수동 주입해 user_concept_ability 초기 θ 시딩(WITH CHECK)을 충족한다.

## 접속 롤 분리 (R11-01 §7 — RLS 런타임 무효 해소)

배경: 종전 런타임 접속 롤(`POSTGRES_USER`=weathermind)은 superuser·bypassrls·
테이블 소유자여서 **user_isolation 정책이 한 번도 적용되지 않았다**(정책은
존재하나 무효 — 유저 격리가 앱 `user_id` 필터 단독이었다). 해소는 정책 재설계가
아니라 **접속 롤 분리**로 한다:

| 채널 | 롤 | 속성 | URL env |
|---|---|---|---|
| 런타임 (FastAPI backend) | `weathermind_app` | NOSUPERUSER·NOBYPASSRLS·LOGIN·테이블 비소유 → **RLS 실제 강제** | `DATABASE_URL` |
| 마이그레이션 (alembic) | `weathermind` (소유자) | DDL·RLS 정책 생성 권한 | `MIGRATION_DATABASE_URL` (backend/alembic/env.py가 env 직독, 미설정 시 DATABASE_URL 폴백) |
| celery 배치 (KMA 수집·리그 정산) | `weathermind` (소유자) | 전 유저 정산은 격리 대상이 아님 | `DATABASE_URL` (.env 원본 — backend 서비스만 compose에서 앱 롤로 오버라이드) |

롤·GRANT·기본권한(`ALTER DEFAULT PRIVILEGES` — 이후 마이그레이션이 만드는 새
테이블 자동 GRANT)의 SSOT:
- 신규 볼륨: `database/init.sql` (initdb 1회)
- 기존 볼륨·정책 포함 완전 적용: `backend/app/scripts/rls_app_role.sql`
  (**멱등** — 검증 쿼리 V1~V8·롤백 절차 동봉. 신규 볼륨도 `alembic upgrade head`
  후 1회 실행해야 완성)

### 앱 롤 예외 정책 2건 (user_isolation은 전 테이블 무접촉)

RLS 정책은 permissive-OR 결합이므로, 기존 `user_isolation`(11개 테이블)을
유지한 채 `weathermind_app` 한정 정책을 **추가**한다:

| 테이블 | 정책 | 범위 | 근거 |
|---|---|---|---|
| `users` | `app_auth_users` | FOR ALL USING(true) WITH CHECK(true) | 인증 카탈로그 — 로그인(이메일 조회)·가입/게스트(INSERT)·get_current_user(PK 조회)·guest/convert(UPDATE)가 유저 컨텍스트 성립 **이전**에 실행된다(닭-달걀). users의 격리는 종전대로 앱 로직 책임 |
| `league_results` | `app_leaderboard_read` | FOR SELECT USING(true) | 공개 리더보드가 설계상 전 유저 집계. 쓰기는 user_isolation 그대로 강제 |

나머지 **9개 테이블**(quiz_logs·weak_tags·attendance·sessions·duels·
user_quest_progress·user_badges·user_unit_progress·user_concept_ability)은
예외 없이 user_isolation이 앱 롤에 실제 강제된다 — DB 계층이 앱 `user_id`
필터의 2층 방어선이 된다. 드리프트 감시: `backend/tests/test_rls_role_contract.py`.

## JWT 검증 의존성 (실제 구현 동일 의미론)

```python
async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    payload = decode_token(token)          # JWTError → 401
    user_id = payload.get("sub")           # 없으면 401
    # Redis 세션 유효성 확인 (로그아웃된 토큰 차단)
    if not await redis.exists(f"session:{user_id}"):
        raise 401
    user = await session.get(User, uuid.UUID(user_id))  # 별도 세션(get_db 계열)
    return user
```

## 비밀번호 해싱

- `passlib[bcrypt]` 사용, rounds=12
- 회원가입 시 해싱, 로그인 시 verify

## 토큰 정책

| 토큰 | 만료 | 저장 위치 |
|---|---|---|
| access token | 30분 | 클라이언트 메모리 (Zustand) |
| refresh token | 7일 | Redis `session:{user_id}` + httpOnly 쿠키 |

로그아웃: Redis `session:{user_id}` 삭제 → 이후 모든 access token 무효화.
게스트 전환(guest/convert)·로그인 재발급은 `session:{user_id}` 단일 슬롯
덮어쓰기로 기존 refresh token을 즉시 회전한다.
