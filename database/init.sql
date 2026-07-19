-- ════════════════════════════════════════════════════
-- WeatherMind 데이터베이스 초기화 (postgres 컨테이너 최초 기동 시 1회 실행)
--
-- 이 파일은 PostgreSQL 확장(EXTENSION) 생성만 담당한다.
-- 테이블 스키마 · 인덱스 · RLS 정책은 backend의 Alembic 마이그레이션이
-- 단독 소유한다 (docs/specs/01_database_schema.md, DEVELOPMENT_PLAN.md 표준 결정).
--   적용: docker compose exec backend alembic upgrade head
-- ════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4() (호환용)
