"""배치고사 일괄 채점 단위·계약 테스트 — 스프린트 R7-02 §3.1·§3.7.

FakeDB(실행 statement 수집 대역)·순수 함수 관례로 DB 없이 검증한다
(test_answer_service·test_placement 스타일). 대상:

- ai_client.rag_feedback 타임아웃 10s 계약 (§3.7 — 채점 지연 원인 제거,
  드리프트 감시)
"""
import asyncio

from app.services import ai_client


class TestRagFeedbackTimeoutContract:
    """§3.7: rag-feedback 타임아웃 60s→10s — 다른 내부 호출(15s)과 정합.

    문항별 answer 경로가 문항마다 rag_feedback을 동기 대기하는 것이 채점 지연의
    원인이었다. 상수 기본값 = 계약값(10s) 유지가 계약 (SESSION_RECIPE·CLOUD_* 전례).
    """

    def test_타임아웃_상수는_계약값_10s(self):
        assert ai_client.RAG_FEEDBACK_TIMEOUT == 10.0

    def test_rag_feedback은_전용_타임아웃으로_호출(self, monkeypatch):
        """_post 기본값(60s)이 아니라 RAG_FEEDBACK_TIMEOUT을 명시 전달한다."""
        captured = {}

        async def fake_post(path, payload, timeout=60.0):
            captured["path"] = path
            captured["timeout"] = timeout
            return {"feedback": "ok"}

        monkeypatch.setattr(ai_client, "_post", fake_post)
        asyncio.run(
            ai_client.rag_feedback(
                question_text="q",
                user_answer="a",
                is_correct=True,
                concept_tag="typhoon",
                today_weather={},
            )
        )
        assert captured["path"] == "/internal/rag-feedback"
        assert captured["timeout"] == 10.0
