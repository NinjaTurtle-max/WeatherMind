-- ════════════════════════════════════════════════════
-- WeatherMind 데이터베이스 초기화 (postgres 컨테이너 최초 기동 시 1회 실행)
--
-- 이 파일은 (1) PostgreSQL 확장 생성 (2) 앱 전용 비특권 롤 생성·권한 부여를 담당한다.
-- 테이블 스키마 · 인덱스 · RLS 정책은 backend의 Alembic 마이그레이션이
-- 단독 소유한다 (docs/specs/01_database_schema.md, DEVELOPMENT_PLAN.md 표준 결정).
--   적용: docker compose exec backend alembic upgrade head
--
-- ⚠️ 이 파일은 **신규 볼륨**에서만 실행된다(docker-entrypoint-initdb.d 규약).
--   기존 볼륨에는 backend/app/scripts/rls_app_role.sql(멱등, 같은 내용의 상위집합)을
--   소유자 롤로 실행한다. 또한 앱 롤 예외 정책(users·league_results — 아래 주석)은
--   테이블이 있어야 만들 수 있으므로, 신규 볼륨도 `alembic upgrade head` 후
--   rls_app_role.sql을 1회 실행해야 런타임 앱 롤 전환이 완성된다.
-- ════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4() (호환용)

-- ── 앱 전용 비특권 롤 (R11-01 §7 — RLS 롤 분리) ─────────────────────────────
-- 문제: 기존 런타임 접속 롤(POSTGRES_USER)은 superuser·bypassrls·테이블 소유자라
--   user_isolation 정책이 한 번도 적용되지 않았다(RLS 런타임 무효 — ROADMAP §2.1).
-- 해소: 런타임(FastAPI backend)은 이 롤(weathermind_app)로 접속한다.
--   NOSUPERUSER·NOBYPASSRLS·테이블 비소유 → RLS가 실제로 강제된다.
--   마이그레이션(alembic)·celery 배치는 소유자 롤 유지(DDL·전 유저 정산 권한).
-- 비밀번호는 dev 기본값 — 운영 전환 시 ALTER ROLE weathermind_app PASSWORD '...'
--   (시크릿 위생은 BE-1/DO-2 항목과 연동. compose는 POSTGRES_APP_PASSWORD로 주입).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'weathermind_app') THEN
    CREATE ROLE weathermind_app LOGIN PASSWORD 'weathermind_app_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- 접속·스키마 사용 권한 (DB 이름은 하드코딩하지 않는다 — POSTGRES_DB 가변)
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO weathermind_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO weathermind_app;

-- 기존 객체 일괄 DML GRANT (initdb 시점엔 0개지만 멱등·재사용 겸용)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO weathermind_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO weathermind_app;

-- ⚠️ 핵심: 이후 마이그레이션이 소유자 롤로 **새 테이블·시퀀스를 만들 때 자동 GRANT**.
--   이 파일은 POSTGRES_USER(=마이그레이션 소유자 롤)로 실행되므로 FOR ROLE 생략 =
--   그 롤의 기본 권한을 바꾼다. 이게 빠지면 다음 마이그레이션마다 앱이 깨진다.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO weathermind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO weathermind_app;
