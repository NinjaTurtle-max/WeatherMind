"""pytest 공통 설정 — celery 루트를 import 경로에 추가 (어느 cwd에서든 실행 가능).

backend/tests/conftest.py · ai-worker/tests/conftest.py와 동일한 방식이다.
세 컨텍스트가 최상위 패키지명 `app`을 공유하므로 **한 프로세스에서 섞어 돌리면
안 된다** — `scripts/ci.sh`의 `run_pytest_in`이 서비스마다 별도 서브셸에서
`cd <서비스> && python -m pytest tests` 하는 구조가 그 격리다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
