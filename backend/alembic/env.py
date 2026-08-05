"""Alembic 환경 — async engine(asyncpg) 대응.

접속 URL 우선순위 (R11-01 §7 — RLS 롤 분리):
1. `MIGRATION_DATABASE_URL` env 직독 — 마이그레이션은 **소유자 롤**(DDL·RLS 정책
   생성 권한)로 접속한다. 런타임 `DATABASE_URL`이 비특권 앱 롤(weathermind_app)로
   전환된 뒤에도 alembic만은 소유자 롤을 유지하기 위한 분리 채널.
   config.py(Settings — BE-1 소유)는 건드리지 않는다(env 직독이 계약).
2. 폴백: 기존과 동일하게 app.core.config.settings.DATABASE_URL (05번 스펙 env 변수)
   — MIGRATION_DATABASE_URL 미설정 환경(로컬·CI)은 종전 동작 그대로다.
"""
import asyncio
import logging
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# backend 루트를 sys.path에 추가 (alembic이 어느 cwd에서 실행되든 app import 가능)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.models import Base  # noqa: E402  (모델 5종 metadata 등록)

config = context.config
# ConfigParser 보간을 피하려고 %를 이스케이프한다(비밀번호에 %-인코딩이 와도 안전).
_env_url = os.environ.get("MIGRATION_DATABASE_URL")
if _env_url and "changeme" in _env_url:
    # env 직독 채널은 BE-1의 Settings 기반 changeme fail-fast 감지 범위 밖이다.
    # 마이그레이션은 운영자 수동 실행 컨텍스트라 거부 대신 경고 1줄(폴백 URL의
    # placeholder는 Settings 관할이므로 여기서 다루지 않는다).
    logging.getLogger("alembic.env").warning(
        "MIGRATION_DATABASE_URL에 placeholder 자격증명(changeme)이 있습니다 — "
        "소유자 롤 비밀번호를 교체하세요."
    )
_migration_url = _env_url or settings.DATABASE_URL
config.set_main_option("sqlalchemy.url", _migration_url.replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """--sql 모드: 엔진 없이 SQL 스크립트만 생성."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
