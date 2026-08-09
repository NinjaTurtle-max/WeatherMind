"""celery가 부르는 `/internal/*` 경로가 ai-worker에 실재하는가 (CO-J-11 / CO-SN4).

배경: celery는 ai-worker를 **HTTP 문자열 리터럴**로 부른다. 문자열이라 어떤 정적
검사에도 안 걸리고, 실패해도 태스크가 삼키면 로그 한 줄로 끝난다 — `embed-weather`
404를 매일 삼켰던 것이 정확히 이 구조다(그 경로는 R13 3일차 RAG 철거로 사라졌고,
celery 쪽 호출도 함께 걷혔다. 남은 것은 주석뿐이라 이 테스트가 지금은 초록이다).

지금 살아 있는 유일한 호출은 `retrain.py:69`의 `/internal/weatherbrain/calibrate`이고,
**그 존재를 단정하는 테스트가 리포에 0건**이었다. 8/18 IRT b 재보정이 그 한 줄에
걸려 있다(CO-U-13) — CO-Q-1을 고쳐도 이 홉이 끊기면 재보정은 여전히 안 돈다.

ai-worker를 임포트하지 않고 **소스 텍스트만** 대조한다. 두 서비스가 최상위
패키지명 `app`을 공유해서 같은 프로세스에서 함께 임포트할 수 없고, 이 검사에
필요한 것은 경로 문자열 집합뿐이다.
"""
import re
from pathlib import Path

import pytest

CELERY_APP = Path(__file__).resolve().parents[1] / "app"
AI_WORKER_MAIN = (
    Path(__file__).resolve().parents[2] / "ai-worker" / "app" / "main.py"
)

# `@app.get("/internal/...")` · `@app.post("/internal/...", ...)` 양쪽을 잡는다.
_ROUTE_RE = re.compile(r'@app\.(?:get|post|put|delete)\(\s*\n?\s*"(/internal/[^"]+)"')
# celery 소스의 경로 리터럴. 주석 줄은 제외한다 — 철거된 기능의 설명문까지
# 계약으로 삼으면 문서를 못 고친다.
_LITERAL_RE = re.compile(r'"(/internal/[^"]+)"')


def _ai_worker_routes() -> set[str]:
    return set(_ROUTE_RE.findall(AI_WORKER_MAIN.read_text(encoding="utf-8")))


def _celery_called_paths() -> dict[str, str]:
    """경로 → 처음 발견된 `파일:행` (실패 메시지에 쓴다)."""
    found: dict[str, str] = {}
    for path in sorted(CELERY_APP.rglob("*.py")):
        for lineno, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if line.lstrip().startswith("#"):
                continue
            for match in _LITERAL_RE.findall(line):
                found.setdefault(match, f"{path.name}:{lineno}")
    return found


def test_ai_worker_라우트_추출이_비어_있지_않다():
    """정규식이 상류 리팩터링으로 0건을 뽑으면 아래 검사가 조용히 무의미해진다."""
    routes = _ai_worker_routes()
    assert len(routes) >= 5, f"ai-worker /internal 라우트 추출 실패: {routes}"
    assert "/internal/weatherbrain/calibrate" in routes


def test_celery가_부르는_경로가_전부_실재한다():
    routes = _ai_worker_routes()
    missing = {
        path: where
        for path, where in _celery_called_paths().items()
        if path not in routes
    }
    assert not missing, (
        f"ai-worker에 없는 /internal 경로를 celery가 호출한다: {missing}. "
        "라우트를 추가하거나 호출을 걷어내세요 — 404를 삼키면 배치가 조용히 죽습니다."
    )


@pytest.mark.parametrize(
    "path", ["/internal/weatherbrain/calibrate"]
)
def test_8월18일_재보정이_의존하는_경로(path):
    """명시 단정 — 위 일반 검사는 celery가 호출을 지우면 공집합으로 통과한다."""
    assert path in _ai_worker_routes()
