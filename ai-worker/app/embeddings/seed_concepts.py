"""Chroma climate_concepts 시드 적재 스크립트 — 09_seed_data_spec.md.

실행 (10_versions_run_guide.md):
    docker compose exec ai-worker python -m app.embeddings.seed_concepts

동작:
1. database/seed/climate_concepts.json 로드
2. 각 text를 text-embedding-3-small로 임베딩 (chroma_client 싱글턴 재사용)
3. Chroma climate_concepts 컬렉션에 upsert (metadata: concept_tag, grade_level)

멱등성: id를 f"{concept_tag}-{index}" (concept_tag별 등장 순서)로 고정하고
upsert를 사용하므로, 재실행해도 중복 없이 동일 문서가 갱신된다.

시드 파일 경로 우선순위:
1. 환경변수 CLIMATE_CONCEPTS_PATH
2. /app/database/seed/climate_concepts.json (컨테이너에 마운트/복사된 경우)
3. 이 모듈 위치에서 상위로 올라가며 database/seed/climate_concepts.json 탐색 (로컬 개발)
"""

from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from pathlib import Path

from app.embeddings.chroma_client import (
    COLLECTION_CLIMATE_CONCEPTS,
    get_collection,
    get_embeddings,
)

logger = logging.getLogger(__name__)

SEED_FILENAME = "climate_concepts.json"
SEED_RELATIVE_PATH = Path("database") / "seed" / SEED_FILENAME


def resolve_seed_path() -> Path:
    """climate_concepts.json 경로를 결정한다."""
    env_path = os.environ.get("CLIMATE_CONCEPTS_PATH")
    if env_path:
        path = Path(env_path)
        if path.is_file():
            return path
        raise FileNotFoundError(f"CLIMATE_CONCEPTS_PATH not found: {path}")

    candidates: list[Path] = [Path("/app") / SEED_RELATIVE_PATH]
    for parent in Path(__file__).resolve().parents:
        candidates.append(parent / SEED_RELATIVE_PATH)

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    raise FileNotFoundError(
        f"{SEED_FILENAME} 을 찾을 수 없습니다. "
        f"CLIMATE_CONCEPTS_PATH 환경변수를 지정하거나 {SEED_RELATIVE_PATH} 를 준비하세요."
    )


def load_chunks(path: Path) -> list[dict]:
    """시드 JSON을 로드하고 필수 필드를 검증한다."""
    chunks = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(chunks, list) or not chunks:
        raise ValueError(f"시드 파일이 비어 있거나 리스트가 아닙니다: {path}")
    for i, chunk in enumerate(chunks):
        for key in ("concept_tag", "grade_level", "text"):
            if not chunk.get(key):
                raise ValueError(f"시드 청크 #{i}에 '{key}' 필드가 없습니다")
    return chunks


def seed(path: Path | None = None) -> int:
    """시드 청크를 임베딩해 climate_concepts 컬렉션에 upsert 한다.

    Returns:
        적재(upsert)한 청크 수
    """
    seed_path = path or resolve_seed_path()
    chunks = load_chunks(seed_path)
    logger.info("loaded %d seed chunks from %s", len(chunks), seed_path)

    # 멱등 id: concept_tag + concept_tag 내 등장 순서 index
    counters: dict[str, int] = defaultdict(int)
    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict] = []
    for chunk in chunks:
        tag = chunk["concept_tag"]
        ids.append(f"{tag}-{counters[tag]}")
        counters[tag] += 1
        documents.append(chunk["text"])
        metadatas.append(
            {"concept_tag": tag, "grade_level": chunk["grade_level"]}
        )

    embeddings = get_embeddings().embed_documents(documents)

    collection = get_collection(COLLECTION_CLIMATE_CONCEPTS)
    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )
    logger.info(
        "upserted %d chunks into '%s' (collection count: %d)",
        len(ids),
        COLLECTION_CLIMATE_CONCEPTS,
        collection.count(),
    )
    return len(ids)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    count = seed()
    print(f"seeded {count} chunks into '{COLLECTION_CLIMATE_CONCEPTS}'")


if __name__ == "__main__":
    main()
