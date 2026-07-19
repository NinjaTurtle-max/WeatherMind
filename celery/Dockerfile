FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 기본은 worker. beat는 docker-compose에서 command로 덮어쓴다.
CMD ["celery", "-A", "app.celery_app", "worker", "--loglevel=info"]
