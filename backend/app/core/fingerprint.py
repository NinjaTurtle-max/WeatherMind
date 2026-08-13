"""실행 중인 코드의 지문 — 이미지가 낡았는지 밖에서 보게 한다 (CO-Y-13).

경위와 왜 git SHA가 아닌지는 `scripts/code_fingerprint.py`가 소유한다. 요지만:
**빌드 인자로 주입한 SHA는 `COPY`를 타고 오지 않아 낡은 파일 위에 새 SHA를
실을 수 있다** — 잡으려던 실패 모드에서 무력하다. 파일 지문은 이미지에 실제로
들어간 파일을 읽으므로 그 거짓말을 못 한다.

⚠️ **복제다.** backend·ai-worker가 빌드 컨텍스트를 공유하지 않아 물리적으로
합칠 수 없다. 저장소 관례대로 **단일 소유자(scripts/) + 계약 테스트**로 묶는다
(`test_code_fingerprint.py`가 세 구현의 출력 일치를 문다).
"""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parent.parent  # backend/app


@lru_cache(maxsize=1)
def code_fingerprint() -> str:
    """`app/` 아래 .py 전건의 지문 12자. 임포트 뒤 한 번만 센다.

    경로도 함께 먹인다 — 내용이 같은 채 파일이 이동·삭제된 것도 잡아야 한다.
    실패해도 서비스를 멈추지 않는다: 지문은 진단용이지 기능이 아니다.
    """
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
