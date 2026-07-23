"""pytest 공통 설정 — ai-worker 루트를 import 경로에 추가 (어느 cwd에서든 실행 가능).

bare `pytest`(또는 저장소 루트에서 `pytest ai-worker`)는 rootdir을 sys.path에
넣지 않아 `app.chains ...` import가 실패한다. `python -m pytest`만 통과하던 문제를
backend/tests/conftest.py와 동일한 방식으로 해소한다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
