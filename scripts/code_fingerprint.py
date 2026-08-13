#!/usr/bin/env python3
"""실행 중인 코드와 워크트리를 대조하는 지문 — CO-Y-13의 근본책.

**왜 필요한가.** 2026-08-11에 `docker build`가 소스 변경을 못 봤다. 순서대로:
워크트리 파일에 `knowledge_level` 13곳 → 빌드한 이미지에는 0곳 → build context는
정확 → 빌드 로그에서 `COPY app ./app`이 CACHED → `--no-cache`로도 여전히 옛 코드 →
바인드 마운트로 읽으면 13곳. BuildKit의 **로컬 컨텍스트 스냅샷**이 낡은 것이었고
`--no-cache`는 *레이어* 캐시만 끄지 *컨텍스트* 캐시는 안 건드린다.
`docker builder prune -af` 후에야 최신이 됐다.

피해는 캐시 자체가 아니라 **몰랐다는 것**이다. 그 사이 UI·세션 검증이 전부 낡은
백엔드를 대상으로 돌았고, 실재하지 않는 🔴 결함(CO-Y-12 "상위 300건 도달 불가")을
등재했다가 한 시간 만에 철회했다. 부품을 하나씩 실측해 놓고도 **"실행 중인 코드가
내가 읽는 코드와 같은가"를 마지막에야 물었다.**

**왜 git SHA가 아니라 파일 지문인가 — 이 선택이 핵심이다.**
빌드 인자로 넣은 git SHA는 호스트가 빌드 시각에 **주입**하는 값이라 `COPY`를 타고
오지 않는다. CO-Y-13의 바로 그 상황(컨텍스트 스냅샷이 낡음)에서는 **새 SHA가 옛
파일과 함께 실린다** — `/health`가 "최신입니다"라고 거짓말한다. 잡으려던 실패
모드에서 정확히 무력하다. 파일 지문은 **이미지에 실제로 들어간 파일**을 읽으므로
그 거짓말을 할 수 없다.

대신 알 수 있는 것이 다르다: 지문은 "어느 커밋인가"를 말하지 못하고
**"워크트리와 같은가 다른가"**만 말한다. CO-Y-13이 요구한 것이 정확히 그것이다.

사용:
    python scripts/code_fingerprint.py backend/app     # 워크트리 쪽
    curl -s localhost:8000/health | jq -r .code_fingerprint   # 실행 중인 쪽
두 값이 다르면 이미지가 낡은 것이다 — `docker builder prune -af` 후 재빌드한다.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path


def fingerprint(root: Path) -> str:
    """디렉토리 아래 .py 전건의 내용 지문 12자.

    경로도 함께 먹인다 — 내용이 같은 채 **파일이 이동·삭제**된 것도 잡아야 한다.
    정렬은 파일시스템 순회 순서에 흔들리지 않게 하려는 것이고, `__pycache__`는
    빌드 산물이라 뺀다(같은 소스가 컨테이너 안팎에서 다른 값을 내면 못 쓴다).
    """
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "backend/app")
    if not target.is_dir():
        sys.exit(f"디렉토리가 아니다: {target}")
    print(fingerprint(target))
