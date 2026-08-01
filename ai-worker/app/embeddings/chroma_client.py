"""Chroma HttpClient 싱글턴 + 컬렉션 3종 관리 (01_database_schema.md Chroma 섹션).

컬렉션: weather_daily / climate_concepts / anomaly_cases
임베딩 모델: text-embedding-3-small (1536차원, langchain-openai OpenAIEmbeddings 경유)
검색: cosine similarity, top_k=3, relevance threshold 0.7
"""

from __future__ import annotations

import threading

import chromadb
from langchain_openai import OpenAIEmbeddings

from app.config import settings

COLLECTION_WEATHER_DAILY = "weather_daily"
COLLECTION_CLIMATE_CONCEPTS = "climate_concepts"
COLLECTION_ANOMALY_CASES = "anomaly_cases"

ALL_COLLECTIONS = (
    COLLECTION_WEATHER_DAILY,
    COLLECTION_CLIMATE_CONCEPTS,
    COLLECTION_ANOMALY_CASES,
)

_lock = threading.Lock()
_client: chromadb.HttpClient | None = None
_embeddings: OpenAIEmbeddings | None = None
# 컬렉션 핸들 캐시 — get_or_create_collection은 HTTP 왕복이므로 호출마다
# 재수행하지 않는다(R7-02 S7 지연 완화). 성공한 핸들만 캐시해 Chroma 장애 시
# 폴백 동작(호출부 예외 처리)은 기존과 동일하게 유지된다.
_collections: dict[str, object] = {}


def get_chroma_client() -> "chromadb.api.ClientAPI":
    """Chroma HttpClient 싱글턴을 반환한다."""
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = chromadb.HttpClient(
                    host=settings.CHROMA_HOST,
                    port=settings.CHROMA_PORT,
                )
    return _client


def get_embeddings() -> OpenAIEmbeddings:
    """OpenAIEmbeddings(text-embedding-3-small) 싱글턴을 반환한다."""
    global _embeddings
    if _embeddings is None:
        with _lock:
            if _embeddings is None:
                _embeddings = OpenAIEmbeddings(
                    model=settings.EMBEDDING_MODEL,
                    api_key=settings.EMBEDDING_API_KEY,
                )
    return _embeddings


def get_collection(name: str):
    """컬렉션 get_or_create (cosine 거리 공간). 핸들은 최초 1회만 조회 후 캐시."""
    if name not in ALL_COLLECTIONS:
        raise ValueError(f"unknown collection: {name}")
    collection = _collections.get(name)
    if collection is None:
        with _lock:
            collection = _collections.get(name)
            if collection is None:
                collection = get_chroma_client().get_or_create_collection(
                    name=name,
                    metadata={"hnsw:space": "cosine"},
                )
                _collections[name] = collection
    return collection


def query_collection(
    name: str,
    query_text: str,
    top_k: int = 3,
) -> list[dict]:
    """단일 컬렉션 유사도 검색.

    Returns:
        [{"text": str, "relevance": float, "source": str, "metadata": dict}, ...]
        relevance = 1 - cosine distance (높을수록 유사)
    """
    collection = get_collection(name)
    if collection.count() == 0:
        return []

    query_vector = get_embeddings().embed_query(query_text)
    result = collection.query(
        query_embeddings=[query_vector],
        n_results=top_k,
        include=["documents", "distances", "metadatas"],
    )

    hits: list[dict] = []
    documents = result.get("documents") or [[]]
    distances = result.get("distances") or [[]]
    metadatas = result.get("metadatas") or [[]]
    for doc, dist, meta in zip(documents[0], distances[0], metadatas[0]):
        hits.append(
            {
                "text": doc,
                "relevance": 1.0 - float(dist),
                "source": name,
                "metadata": meta or {},
            }
        )
    return hits
