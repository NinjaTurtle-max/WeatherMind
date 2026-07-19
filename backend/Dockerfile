# WeatherMind backend — 05번 스펙: multi-stage build, python:3.12-slim
FROM python:3.12-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── runtime ──
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# docker-compose healthcheck가 curl을 사용한다
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

WORKDIR /app

COPY app ./app
COPY alembic.ini .
COPY alembic ./alembic

EXPOSE 8000

# DB 마이그레이션은 기동 후 별도 실행: docker compose exec backend alembic upgrade head
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
