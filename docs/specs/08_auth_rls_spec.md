# 인증 흐름 · RLS 주입 상세 스펙

> JWT → PostgreSQL Row-Level Security 연결은 개념만으론 구현 불가. 실제 흐름을 명시한다.

## 전체 인증 흐름

```
1. 로그인 → JWT access token 발급 (payload에 user_id, level_group 포함)
2. 이후 모든 요청 → Authorization: Bearer {token} 헤더
3. FastAPI 의존성(get_current_user)이 토큰 검증 → user_id 추출
4. DB 세션 시작 시 SET app.current_user_id = '{user_id}' 실행
5. 이후 모든 쿼리는 RLS 정책에 의해 자동으로 해당 user_id 데이터만 반환
```

## 핵심: RLS 주입 의존성 (backend/app/core/dependencies.py)

```python
async def get_db_with_rls(
    user: User = Depends(get_current_user),
) -> AsyncSession:
    async with async_session() as session:
        # RLS 정책이 참조하는 세션 변수 주입
        await session.execute(
            text("SET app.current_user_id = :uid"),
            {"uid": str(user.id)}
        )
        yield session
```

**중요**: 이 SET은 트랜잭션/세션 단위로만 유효. 커넥션 풀 재사용 시 다른 유저 값이 남지 않도록 `SET LOCAL` 사용 권장, 또는 요청마다 새 세션.

## JWT 검증 의존성

```python
async def get_current_user(
    token: str = Depends(oauth2_scheme),
) -> User:
    payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(401, "Invalid token")
    # Redis 세션 유효성 확인 (로그아웃된 토큰 차단)
    if not await redis.exists(f"session:{user_id}"):
        raise HTTPException(401, "Session expired")
    user = await get_user_by_id(user_id)
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

---

## 바이브 코딩 지시사항

```
backend/app/core/security.py에 JWT 생성/검증, bcrypt 해싱 함수를,
backend/app/core/dependencies.py에 get_current_user, get_db_with_rls 의존성을
위 스펙대로 구현해줘. oauth2_scheme은 OAuth2PasswordBearer 사용.
모든 보호된 라우터는 Depends(get_db_with_rls)로 DB 세션을 받아서
RLS가 자동 적용되도록 해줘. SET LOCAL 방식으로 커넥션 풀 오염을 방지해줘.
```
