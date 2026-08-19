-- ════════════════════════════════════════════════════════════════════════════
-- WeatherMind — 앱 전용 비특권 롤 적용 스크립트 (R11-01 §7 RLS 롤 분리)
--
-- 대상: **기존 볼륨**(신규 볼륨은 database/init.sql이 롤·GRANT를 선반영하지만,
--   아래 앱 롤 예외 정책은 테이블 생성 후에만 가능하므로 신규 볼륨도 마이그레이션
--   뒤 이 스크립트를 1회 실행한다 — 이 파일이 단일 적용 지점).
-- 실행 주체: PM (게이트에서, 소유자 롤로). 담당(BE-2)은 산출까지 — §7.2 특칙.
-- 멱등: 전 구문이 IF NOT EXISTS / 재실행 무해(GRANT·ALTER DEFAULT PRIVILEGES는
--   본래 멱등). 몇 번을 다시 돌려도 상태가 같다.
--
-- 실행:
--   docker compose exec -T postgres \
--     psql -U weathermind -d weathermind -v ON_ERROR_STOP=1 \
--     < backend/app/scripts/rls_app_role.sql
--
-- 전제: alembic upgrade head 완료(users·league_results 테이블 실존).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 롤 생성 (NOSUPERUSER·NOBYPASSRLS·LOGIN·테이블 비소유) ────────────────
-- 비밀번호는 dev 기본값 — 운영 전환 시:
--   ALTER ROLE weathermind_app PASSWORD '<POSTGRES_APP_PASSWORD>';
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'weathermind_app') THEN
    CREATE ROLE weathermind_app LOGIN PASSWORD 'weathermind_app_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- ── 2. 접속·스키마·기존 테이블 일괄 GRANT ───────────────────────────────────
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO weathermind_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO weathermind_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO weathermind_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO weathermind_app;

-- ── 3. 기본 권한 — 이후 마이그레이션이 만드는 새 객체 자동 GRANT ────────────
-- 이 스크립트는 소유자 롤(POSTGRES_USER)로 실행되므로 FOR ROLE 생략 = 그 롤 기준.
-- 이게 빠지면 다음 마이그레이션마다 새 테이블에 대한 앱 접근이 깨진다.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO weathermind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO weathermind_app;

-- ── 4. 앱 롤 예외 정책 2건 (user_isolation 정책은 전 테이블 무접촉 유지) ─────
-- RLS 정책은 permissive-OR 결합이라, 기존 user_isolation을 건드리지 않고
-- weathermind_app **한정** 정책을 추가한다. 다른 비특권 롤(weathermind_smoke_rls
-- 등)에는 여전히 user_isolation만 적용된다(스모크 6단계 의미 불변).
--
-- 왜 필요한가 — 이 2건이 없으면 앱 롤 전환 즉시 인증·리더보드가 전면 0행:
--  (a) users: 인증 카탈로그. 로그인(이메일 조회)·가입/게스트(INSERT — WITH CHECK)·
--      get_current_user(PK 조회)·refresh·guest/convert(UPDATE)가 전부
--      **유저 컨텍스트(app.current_user_id) 성립 이전**에 실행된다. GUC 기반
--      user_isolation만으로는 구조적으로 자기 행을 찾을 수 없다(닭-달걀).
--      → users의 유저 격리는 종전대로 앱 로직(user_id 필터) 책임으로 남긴다.
--  (b) league_results SELECT: 공개 리더보드(GET /league/leaderboard)가 설계상
--      전 유저 집계다(라우터 주석 "전체 유저 집계 — RLS 미적용 세션").
--      쓰기(WITH CHECK)는 예외 없음 — user_isolation이 그대로 강제된다.
-- 나머지 10개 RLS 테이블(quiz_logs·weak_tags·attendance·sessions·duels·
-- user_quest_progress·user_badges·user_unit_progress·user_concept_ability·
-- hindcast_attempts)은
-- 예외 없이 user_isolation이 앱 롤에 실제 강제된다 — 이번 항목의 실체.
-- (hindcast_attempts는 마이그레이션 0016 신설 — MT-30 과거 예보. 예외 0건.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'users'
                   AND policyname = 'app_auth_users') THEN
    CREATE POLICY app_auth_users ON users
      TO weathermind_app USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'league_results'
                   AND policyname = 'app_leaderboard_read') THEN
    CREATE POLICY app_leaderboard_read ON league_results
      FOR SELECT TO weathermind_app USING (true);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 세트 (PM 실행용 — 적용 후 소유자 롤로 실행, 기대값 주석)
-- ════════════════════════════════════════════════════════════════════════════
--
-- [V1] 롤 속성 — 기대: 1행, super=f bypassrls=f login=t
--   SELECT rolname, rolsuper AS super, rolbypassrls AS bypassrls,
--          rolcanlogin AS login
--   FROM pg_roles WHERE rolname = 'weathermind_app';
--
-- [V2] 테이블 비소유 — 기대: 0
--   SELECT count(*) FROM pg_tables
--   WHERE schemaname = 'public' AND tableowner = 'weathermind_app';
--
-- [V3] GRANT 수 — 기대: SELECT 그랜트 테이블 수 = public 전체 테이블 수
--   (2026-08-05 실측 18. 두 값이 같으면 누락 0)
--   SELECT
--     (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
--      WHERE grantee = 'weathermind_app' AND privilege_type = 'SELECT'
--        AND table_schema = 'public') AS granted,
--     (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS total;
--
-- [V4] 기본 권한 등록 — 기대: relations(r)·sequences(S) 각 1행 이상,
--   defaclacl에 weathermind_app 포함
--   SELECT defaclobjtype, defaclacl::text FROM pg_default_acl
--   WHERE defaclacl::text LIKE '%weathermind_app%';
--
-- [V5] 정책 지형 — 기대: user_isolation 12개(전 RLS 테이블) 불변 +
--   app_auth_users(users)·app_leaderboard_read(league_results) 각 1개
--   SELECT tablename, policyname, roles::text
--   FROM pg_policies WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
-- [V6] 격리 실증 ① — 앱 롤 + 자기 컨텍스트: 자기 행만 보인다
--   (<UID_A>·<UID_B>는 users에 실존하는 서로 다른 유저 id로 치환)
--   BEGIN;
--   SET LOCAL ROLE weathermind_app;
--   SELECT set_config('app.current_user_id', '<UID_A>', true);
--   SELECT count(*) FROM quiz_logs WHERE user_id = '<UID_A>';  -- 기대: 본인 건수
--   SELECT count(*) FROM quiz_logs WHERE user_id = '<UID_B>';  -- 기대: 0 ★핵심
--   SELECT count(*) FROM sessions  WHERE user_id = '<UID_B>';  -- 기대: 0
--   ROLLBACK;
--
-- [V7] 격리 실증 ② — 앱 롤 + 컨텍스트 미설정: 데이터 테이블 전부 0행
--   BEGIN;
--   SET LOCAL ROLE weathermind_app;
--   SELECT count(*) FROM quiz_logs;       -- 기대: 0 (GUC 미설정 → NULL 비교)
--   SELECT count(*) FROM users;           -- 기대: 전체 수 (예외 정책 — 인증 경로)
--   SELECT count(*) FROM league_results;  -- 기대: 전체 수 (예외 정책 — 리더보드)
--   ROLLBACK;
--
-- [V8] 예외 정책의 쓰기 격리 유지 — league_results는 SELECT만 예외
--   BEGIN;
--   SET LOCAL ROLE weathermind_app;
--   SELECT set_config('app.current_user_id', '<UID_A>', true);
--   UPDATE league_results SET accuracy_score = accuracy_score
--   WHERE user_id = '<UID_B>';            -- 기대: UPDATE 0
--   ROLLBACK;
--
-- ── 롤백 (적용 취소 — 런타임 URL을 소유자 롤로 되돌린 뒤 실행) ──────────────
--   DROP POLICY IF EXISTS app_auth_users ON users;
--   DROP POLICY IF EXISTS app_leaderboard_read ON league_results;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM weathermind_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     REVOKE USAGE, SELECT ON SEQUENCES FROM weathermind_app;
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM weathermind_app;
--   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM weathermind_app;
--   REVOKE USAGE ON SCHEMA public FROM weathermind_app;
--   -- (선택) DROP ROLE weathermind_app;  -- 접속 세션이 없을 때만 성공
