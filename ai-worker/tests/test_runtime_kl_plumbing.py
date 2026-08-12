"""`/internal/quiz-generate` 입구가 난이도·유형을 버리지 않는지 — R13 CO-E-4 / CO-O-9.

## 왜 이 테스트가 있는가

결함은 "필드가 없다"가 아니라 **"보냈는데 중간에서 조용히 사라진다"**였다.
`QuizGenerateRequest`가 `weather_data·level_group·route·target_concept_tag` 4키만
선언하고 있어서, backend가 `knowledge_level`을 실어 보내도 pydantic이 미선언
필드를 떨어뜨리고 엔드포인트는 4개만 체인에 넘겼다. `generate_quiz`는 그때 이미
`knowledge_level`을 받을 준비가 돼 있었으므로(스펙 03 §2 규칙 3) 잃어버린 지점은
정확히 이 두 홉이다.

그래서 단정하는 것은 "요청이 200이다"가 아니라 **"`generate_quiz`가 그 값을 인자로
받는다"**이다. 200만 보면 값이 사라져도 초록이다 — 그게 이 항목의 결함 자체다.

## 두 필드의 취급이 다른 이유

- `knowledge_level`: 체인이 **이미 받는다**. 끝까지 도달하는 것을 단정한다.
- `question_type`: 체인 시그니처 확장과 프롬프트 규칙이 별건(quiz_gen_chain 소유)
  이라 착지 순서가 갈릴 수 있다. 그래서 엔드포인트는 **체인이 받는 인자만** 넘기고
  (`inspect.signature` 필터), 여기서는 "체인이 받으면 전달된다"와 "안 받아도 죽지
  않는다" 두 성질을 나눠 단정한다. 어느 쪽으로 착지하든 이 파일은 초록이다.

실행: ai-worker 디렉토리에서 `python -m pytest tests -q`.
"""

from __future__ import annotations

import inspect

import pytest

# app.main은 체인을 통해 langchain을 끌어온다 — 최소 설치 환경 관례
# (test_weatherbrain_endpoints와 동일).
pytest.importorskip("langchain_core")

from starlette.testclient import TestClient  # noqa: E402

from app.chains import quiz_gen_chain  # noqa: E402
from app.main import QuizGenerateRequest, app, verify_internal_api_key  # noqa: E402

_BASE_BODY = {
    "weather_data": {"region": "서울", "temp": 31.2},
    "level_group": "adult",
    "route": "general",
    "target_concept_tag": "typhoon",
}
_STUB_QUESTION = {
    "question_type": "multiple_choice",
    "concept_tag": "typhoon",
    "quiz_id": "20260810-001",
}


@pytest.fixture()
def client():
    app.dependency_overrides[verify_internal_api_key] = lambda: None
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def captured(monkeypatch):
    """generate_quiz를 **kwargs 스텁으로 갈아 끼우고 받은 인자를 기록한다."""
    seen: dict = {}

    def fake_generate(**kwargs):
        seen.update(kwargs)
        return dict(_STUB_QUESTION)

    monkeypatch.setattr(quiz_gen_chain, "generate_quiz", fake_generate)
    return seen


class TestRequestSchema:
    def test_두_필드가_스키마에_선언돼_있다(self):
        """필드명은 backend·프롬프트 담당과 합의된 이름이다 — 오타가 곧 유실이다."""
        fields = QuizGenerateRequest.model_fields
        assert fields["knowledge_level"].annotation is not None
        assert fields["question_type"].annotation is not None
        # 둘 다 선택 입력이어야 한다. 필수로 만들면 레거시 호출부(quiz.py 계열)와
        # 콜드스타트(θ 없음)가 422로 죽는다.
        assert fields["knowledge_level"].default is None
        assert fields["question_type"].default is None

    def test_미선언이면_조용히_사라진다_회귀_방어(self):
        """pydantic이 미선언 키를 떨어뜨리는 성질 자체를 고정한다.

        이 성질이 있기 때문에 '보냈다'만으로는 아무것도 증명되지 않는다 —
        아래 종단 단정이 필요한 이유다.
        """
        parsed = QuizGenerateRequest(**_BASE_BODY, **{"없는키": 1})
        assert not hasattr(parsed, "없는키")


class TestKnowledgeLevelReachesChain:
    def test_체인이_knowledge_level을_인자로_받는다(self, client, captured):
        resp = client.post(
            "/internal/quiz-generate", json={**_BASE_BODY, "knowledge_level": 5}
        )
        assert resp.status_code == 200
        assert captured["knowledge_level"] == 5

    def test_미지정이면_None으로_간다(self, client, captured):
        """콜드스타트 계약 — 값을 지어내지 않고 모델 자기 신고에 맡긴다."""
        resp = client.post("/internal/quiz-generate", json=_BASE_BODY)
        assert resp.status_code == 200
        assert captured["knowledge_level"] is None

    def test_실체인_시그니처가_이미_받는다(self):
        """스텁이 아니라 진짜 generate_quiz가 이 인자를 받는지 — 배관의 종점."""
        assert "knowledge_level" in inspect.signature(
            quiz_gen_chain.generate_quiz
        ).parameters

    def test_톤은_요청이_보낸_그대로_간다(self, client, captured):
        """level_group을 난이도로 재해석하거나 덮어쓰지 않는다(스펙 03 §2 규칙 2)."""
        resp = client.post(
            "/internal/quiz-generate",
            json={**_BASE_BODY, "level_group": "elementary", "knowledge_level": 6},
        )
        assert resp.status_code == 200
        assert captured["level_group"] == "elementary"
        assert captured["knowledge_level"] == 6


class TestQuestionTypeWiring:
    def test_체인이_받으면_전달된다(self, client, captured):
        """captured 스텁은 **kwargs라 필터가 통과시킨다 — 착지 후의 동작."""
        resp = client.post(
            "/internal/quiz-generate", json={**_BASE_BODY, "question_type": "cloze"}
        )
        assert resp.status_code == 200
        assert captured["question_type"] == "cloze"

    def test_체인이_안_받으면_죽지_않고_경고를_남긴다(
        self, client, monkeypatch, caplog
    ):
        """프롬프트 담당 착지 전 상태 — 500이 아니라 200 + warning이어야 한다.

        조용히 버리면 이 항목이 고치는 결함이 형태만 바꿔 남으므로, 유실은
        **로그로 관측 가능**해야 한다.
        """
        def narrow_generate(
            weather_data, level_group, route=None, target_concept_tag=None,
            knowledge_level=None,
        ):
            return dict(_STUB_QUESTION)

        monkeypatch.setattr(quiz_gen_chain, "generate_quiz", narrow_generate)
        with caplog.at_level("WARNING"):
            resp = client.post(
                "/internal/quiz-generate",
                json={**_BASE_BODY, "question_type": "cloze"},
            )
        assert resp.status_code == 200
        assert any("question_type" in r.getMessage() for r in caplog.records)

    def test_None이면_경고하지_않는다(self, client, monkeypatch, caplog):
        """값이 없는 것은 유실이 아니다 — 매 생성마다 경고가 쌓이면 로그가 죽는다."""
        def narrow_generate(
            weather_data, level_group, route=None, target_concept_tag=None,
            knowledge_level=None,
        ):
            return dict(_STUB_QUESTION)

        monkeypatch.setattr(quiz_gen_chain, "generate_quiz", narrow_generate)
        with caplog.at_level("WARNING"):
            resp = client.post("/internal/quiz-generate", json=_BASE_BODY)
        assert resp.status_code == 200
        assert not [
            r for r in caplog.records if "question_type" in r.getMessage()
        ]
