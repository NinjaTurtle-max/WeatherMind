"""구조적(JSON 라인) 로깅 — R11-01 웨이브 3 (마일스톤 5 하드닝, §7.0 로깅·헬스체크).

- 로그 1건 = JSON 1줄: {"ts", "level", "logger", "msg"} + 요청 로그는
  {"method", "path", "status", "duration_ms"} 추가. APM·분산 트레이싱은 범위 밖.
- **uvicorn 기본과의 공존**: uvicorn은 자기 로거(uvicorn / uvicorn.error /
  uvicorn.access)에 전용 핸들러를 붙이고 propagate를 끊은 채 기동한다. 여기서는
  **루트 로거에만** JSON 핸들러를 붙이므로 uvicorn 로그를 건드리지도, 중복
  출력하지도 않는다. 앱 로거(app.*)는 기본 propagate=True라 루트로 흘러
  JSON으로 나간다.
- 요청 단위 접근 로그는 uvicorn.access가 아니라 `RequestLogMiddleware`
  (로거 이름 `app.request`)가 책임진다 — 상태코드·지연(ms)까지 구조화하기 위함.
  uvicorn.access를 끄는 것은 배포 설정(`--no-access-log`)의 몫으로 두고 코드는
  강제하지 않는다(이중 출력은 무해·형식만 다름).
"""
import json
import logging
import time
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# 요청 로그가 extra로 싣는 구조화 필드 — JsonFormatter가 이 이름만 추려 싣는다.
REQUEST_LOG_FIELDS = ("method", "path", "status", "duration_ms")

_request_logger = logging.getLogger("app.request")

# setup_logging 멱등성 표식 (핸들러 중복 부착 방지)
_HANDLER_FLAG = "_weathermind_json_handler"


class JsonFormatter(logging.Formatter):
    """레코드 1건을 JSON 1줄로 직렬화한다 (ensure_ascii=False — 한국어 메시지 원문 유지)."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for field in REQUEST_LOG_FIELDS:
            value = record.__dict__.get(field)
            if value is not None:
                entry[field] = value
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def setup_logging(level: int = logging.INFO) -> None:
    """루트 로거에 JSON 핸들러를 1회 부착한다 (재호출 무해 — 멱등).

    uvicorn 로거는 건드리지 않는다(모듈 독스트링 참조). 루트 레벨은 INFO로
    내린다 — 요청 로그(INFO)가 기본 WARNING에 막히지 않도록.
    """
    root = logging.getLogger()
    if any(getattr(h, _HANDLER_FLAG, False) for h in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    setattr(handler, _HANDLER_FLAG, True)
    root.addHandler(handler)
    if root.level == logging.NOTSET or root.level > level:
        root.setLevel(level)


class RequestLogMiddleware(BaseHTTPMiddleware):
    """요청 1건 = 로그 1건 (method·path·status·duration_ms).

    예외로 응답 없이 끝난 요청도 status=500으로 기록 후 재전파한다 — 예외 자체는
    상위(예외 핸들러·uvicorn)가 처리하고, 여기서는 관측만 책임진다.
    """

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            self._log(request, 500, start, level=logging.ERROR)
            raise
        self._log(request, response.status_code, start)
        return response

    @staticmethod
    def _log(request: Request, status: int, start: float, level: int = logging.INFO) -> None:
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        _request_logger.log(
            level,
            "%s %s -> %d",
            request.method,
            request.url.path,
            status,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": status,
                "duration_ms": duration_ms,
            },
        )
