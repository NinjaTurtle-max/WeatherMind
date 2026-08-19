"""개발 실행기 계약 — `dev.cmd`가 backend 이미지를 **다시 빌드**하는가.

## 왜 이 테스트가 있는가 (2026-08-19 실사고)

backend 컨테이너는 코드와 데이터를 **다른 경로로** 받는다:

- `backend/app/`   → `backend/Dockerfile`의 `COPY app ./app` (이미지 빌드 시점에 고정)
- `database/seed/` → `docker-compose.yml`의 바인드 마운트 (호스트 파일이 그대로 보인다)

그래서 `--build` 없이 `docker compose up -d backend`를 하면 **새 시드 + 옛 코드**가
만난다. 둘이 한 커밋에서 함께 바뀌었을 때 정확히 어긋나는데, MT-18(`f45e1aa`)이
바로 그랬다 — `board_rules.json`에 태풍 규칙을, `board_engine.PHENOMENA`에
`'typhoon'`을 같이 넣었다. 옛 이미지가 새 규칙 파일을 읽고
`validate_rules`가 터져 503 `BOARD_RULES_UNAVAILABLE`이 났다:

    rules[0](tropical_cyclone_genesis): phenomenon 'typhoon' enum 밖

증상은 **보드 문항이 통째로 못 풀린다**인데, 저장소 소스는 초록이라(로컬
`validate_rules`는 통과한다) 원인이 안 보였다. 코드가 아니라 **컨테이너 수명**이
문제인 종류라 `pytest`로는 절대 잡히지 않는다 — `test_ci_workflow_contract`가
CI 설정 파일을 읽어 대조하는 것과 같은 이유로, 여기서는 실행기 스크립트를 읽는다.

⚠️ 이 계약은 `dev.cmd` 한 줄만 보는 게 아니라 **그 줄이 필요한 이유**(= backend가
소스 바인드 마운트 없이 이미지에 COPY된다)까지 함께 문다. 언젠가 dev용 소스
마운트가 생기면 `--build`는 불필요해지는데, 그때 이 테스트는 **그 사실을 알려
주며** 실패해야 한다(조용히 통과하면 안 된다).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DEV_CMD = REPO_ROOT / "dev.cmd"
COMPOSE = REPO_ROOT / "docker-compose.yml"
BACKEND_DOCKERFILE = REPO_ROOT / "backend" / "Dockerfile"

# dev.cmd에서 백엔드 스택을 띄우는 줄. `%DC%`는 compose v2/v1 분기 변수다.
_UP_LINE = re.compile(r"^\s*%DC%\s+up\s+(?P<args>.*)$", re.MULTILINE)


def _dev_cmd_text() -> str:
    if not DEV_CMD.exists():
        pytest.skip("dev.cmd 없음 (Windows 실행기 미배치 환경)")
    # dev.cmd는 chcp 65001을 쓰는 UTF-8 파일이다.
    return DEV_CMD.read_text(encoding="utf-8")


def test_dev_cmd_는_backend_이미지를_다시_빌드한다():
    text = _dev_cmd_text()
    ups = _UP_LINE.findall(text)
    assert ups, "dev.cmd에 `%DC% up ...` 줄이 없다 — 실행기 구조가 바뀌었으면 이 계약도 고쳐야 한다"

    backend_ups = [args for args in ups if "backend" in args]
    assert backend_ups, "dev.cmd의 `up` 줄이 backend를 띄우지 않는다"
    for args in backend_ups:
        assert "--build" in args, (
            "dev.cmd가 backend를 `--build` 없이 띄운다 — 이미지에 COPY된 옛 코드가 "
            "바인드 마운트된 새 시드를 읽어 보드 판정이 503으로 죽는다(2026-08-19 사고). "
            f"문제의 줄: `%DC% up {args.strip()}`"
        )


def test_backend는_소스를_이미지에_굽고_소스_마운트가_없다():
    """위 계약의 **전제**. 이게 깨지면 `--build` 요구가 근거를 잃는다.

    dev용 소스 바인드 마운트(`./backend/app:/app/app` 같은 것)가 생기면 코드가
    호스트에서 live로 들어오므로 `--build`는 더 이상 필수가 아니다. 그때는 위
    테스트를 지우면 되는데, **지워도 된다는 사실을 알려 주는 것**이 이 테스트다.
    """
    dockerfile = BACKEND_DOCKERFILE.read_text(encoding="utf-8")
    assert re.search(r"^\s*COPY\s+app\s+\./app\s*$", dockerfile, re.MULTILINE), (
        "backend/Dockerfile이 더 이상 `COPY app ./app`을 하지 않는다 — "
        "코드가 이미지에 구워지지 않으면 dev.cmd의 `--build` 요구를 재검토할 것"
    )

    compose = COMPOSE.read_text(encoding="utf-8")
    # backend 서비스 블록만 잘라 본다(다음 최상위 2칸 들여쓰기 서비스 직전까지).
    match = re.search(r"^  backend:\n(?P<body>(?:.*\n)*?)(?=^  \S)", compose, re.MULTILINE)
    assert match, "docker-compose.yml에서 backend 서비스 블록을 찾지 못했다"
    body = match.group("body")
    # `build: ./backend`는 마운트가 아니다 — **볼륨 항목만** 본다.
    mounts = re.findall(r"^\s*-\s*(\./[^\s:]+:[^\s]+)$", body, re.MULTILINE)
    assert not [m for m in mounts if m.startswith("./backend")], (
        "backend 서비스에 호스트 소스 마운트가 생겼다 — 그러면 코드가 live로 들어오므로 "
        "dev.cmd의 `--build` 계약(test_dev_cmd_는_backend_이미지를_다시_빌드한다)을 "
        "지워도 된다. 이 테스트는 그 사실을 알리려고 실패한다."
    )
    # 시드는 반대로 **마운트여야** 한다 — 이 비대칭이 사고의 원인이자 전제다.
    assert any(m.startswith("./database/seed:/database/seed") for m in mounts), (
        "database/seed 바인드 마운트가 사라졌다 — 시드가 이미지에 함께 구워진다면 "
        "코드·데이터가 따로 낡는 비대칭이 없어지므로 이 계약을 재검토할 것"
    )
