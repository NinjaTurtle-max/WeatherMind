"""`database/seed/*.json` 경로 해석 — 한 곳에서만 푼다.

## 왜 모듈이 따로 생겼는가

이 관례(env 탈출구 → `/app` 마운트 → 상위 탐색)를 처음 푼 것은
`chains/knowledge_level.resolve_vocabulary_path`이고, 그 독스트링은 당시
`embeddings/seed_concepts.resolve_seed_path`를 "같은 관례"로 가리키고 있었다.
R13 3일차에 벡터 검색을 철거하면서 `embeddings/` 전체가 사라졌고, 동시에
`rag_chain`이 `climate_concepts.json`을 **직접 읽는 두 번째 소비자**가 됐다.
소비자가 둘이 된 시점에 세 번째 복사본을 만드는 대신 관례를 이 모듈에 모은다 —
컨테이너 마운트 규약(`./database/seed:/app/database/seed:ro`)이 바뀌면
고칠 곳이 하나여야 한다.

의존은 stdlib까지다. 무키 경로(폴백 피드백·결정적 게이트)에 필요한 것을
langchain 뒤에 두지 않는다는 `payload_contract`·`knowledge_level`의 규약을 잇는다.
"""

from __future__ import annotations

import os
from pathlib import Path

SEED_DIR_RELATIVE = Path("database") / "seed"


def resolve_seed_path(filename: str, env_var: str) -> Path:
    """`database/seed/<filename>` 경로를 결정한다.

    1. 환경변수 `env_var` (탈출구 — 지정했는데 없으면 **조용히 넘어가지 않고** 예외)
    2. `/app/database/seed/<filename>` (컨테이너 마운트 — docker-compose가
       `./database/seed:/app/database/seed:ro`로 얹는다)
    3. 이 모듈에서 상위로 올라가며 `database/seed/<filename>` 탐색 (로컬 개발)
    """
    relative = SEED_DIR_RELATIVE / filename

    env_path = os.environ.get(env_var)
    if env_path:
        path = Path(env_path)
        if path.is_file():
            return path
        raise FileNotFoundError(f"{env_var} not found: {path}")

    candidates: list[Path] = [Path("/app") / relative]
    for parent in Path(__file__).resolve().parents:
        candidates.append(parent / relative)
    for candidate in candidates:
        if candidate.is_file():
            return candidate

    raise FileNotFoundError(
        f"{filename}을 찾을 수 없다. {env_var}를 지정하거나 {relative}를 준비할 것 "
        "(컨테이너는 database/seed 마운트가 필요하다)"
    )
