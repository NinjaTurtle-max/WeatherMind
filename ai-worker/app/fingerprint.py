"""실행 중인 코드의 지문 — 이미지가 낡았는지 밖에서 보게 한다 (CO-Y-13).

경위와 왜 git SHA가 아닌지는 `scripts/code_fingerprint.py`가 소유한다. 요지만:
**빌드 인자로 주입한 SHA는 `COPY`를 타고 오지 않아 낡은 파일 위에 새 SHA를
실을 수 있다** — 잡으려던 실패 모드에서 무력하다.

⚠️ backend와 **의도된 복제**다(빌드 컨텍스트가 갈려 물리적으로 합칠 수 없다).
일치는 `backend/tests/test_code_fingerprint.py`가 계약으로 문다.
"""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parent  # ai-worker/app


@lru_cache(maxsize=1)
def code_fingerprint() -> str:
    """`app/` 아래 .py 전건의 지문 12자. 임포트 뒤 한 번만 센다."""
    try:
        digest = hashlib.sha256()
        for path in sorted(_APP_ROOT.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            digest.update(path.relative_to(_APP_ROOT).as_posix().encode())
            digest.update(path.read_bytes())
        return digest.hexdigest()[:12]
    except OSError:
        return "unknown"
