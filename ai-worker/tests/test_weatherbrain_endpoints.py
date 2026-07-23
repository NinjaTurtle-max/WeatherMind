"""WeatherBrain 내부 엔드포인트 HTTP 배선 검증 — R6 §5.

TestClient로 estimate/placement/calibrate 및 router-decide(abilities) 엔드포인트의
요청·응답 스키마 배선을 확인한다(수학 정확성은 test_weatherbrain_irt가 담당). 내부 API
키 의존성은 dependency_overrides로 우회 — LLM·DB·네트워크 불필요.

실행: ai-worker 디렉토리에서 `python -m pytest tests -q`.
"""

from __future__ import annotations

import pytest

# app.main은 quiz_gen/rag 체인을 통해 langchain을 임포트한다. 그 의존성이 없는
# 환경(로컬 최소 설치)에서는 이 HTTP 배선 테스트를 건너뛴다 — 실제 ai-worker
# 컨테이너(requirements.txt에 langchain 포함)와 CI에서는 정상 수집·실행된다.
pytest.importorskip("langchain_core")

from starlette.testclient import TestClient  # noqa: E402

from app.main import app, verify_internal_api_key  # noqa: E402


@pytest.fixture()
def client():
    app.dependency_overrides[verify_internal_api_key] = lambda: None
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_placement_사전만_배정(client):
    resp = client.post(
        "/internal/weatherbrain/placement",
        json={"level_group": "elementary", "concept_tags": ["typhoon", "co2_climate"]},
    )
    assert resp.status_code == 200
    abilities = {a["concept_tag"]: a for a in resp.json()["abilities"]}
    assert set(abilities) == {"typhoon", "co2_climate"}
    # 초등 사전평균 -1.0, 응답 없으므로 n=0.
    assert abilities["typhoon"]["theta"] == pytest.approx(-1.0)
    assert abilities["typhoon"]["n"] == 0


def test_estimate_전부정답이면_θ상승(client):
    resp = client.post(
        "/internal/weatherbrain/estimate",
        json={
            "level_group": "middle_high",
            "concepts": [
                {
                    "concept_tag": "typhoon",
                    "responses": [{"b": 0.0, "a": 1.0, "correct": True}] * 8,
                }
            ],
        },
    )
    assert resp.status_code == 200
    ability = resp.json()["abilities"][0]
    assert ability["concept_tag"] == "typhoon"
    assert ability["theta"] > 0.5
    assert ability["n"] == 8


def test_estimate_b없으면_사전난이도로_대체(client):
    # b=null 이면 level_group 사전 난이도로 대체돼도 200·유효 응답.
    resp = client.post(
        "/internal/weatherbrain/estimate",
        json={
            "level_group": "adult",
            "concepts": [
                {
                    "concept_tag": "co2_climate",
                    "responses": [{"b": None, "a": 1.0, "correct": False}] * 5,
                }
            ],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["abilities"][0]["n"] == 5


def test_calibrate_희소데이터_빈결과(client):
    resp = client.post(
        "/internal/weatherbrain/calibrate",
        json={"responses": []},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["item_b"] == {}
    assert body["n_responses"] == 0


def test_router_decide_abilities_우선(client):
    resp = client.post(
        "/internal/router-decide",
        json={
            "user_id": "u1",
            "weak_tags": [{"concept_tag": "co2_climate", "accuracy_rate": 20.0}],
            "recent_results": [],
            "abilities": [
                {"concept_tag": "typhoon", "theta": -1.5, "se": 0.4, "n": 8}
            ],
        },
    )
    assert resp.status_code == 200
    # θ가 우선 → weak_tags(co2_climate)가 아니라 typhoon이 focused 타겟.
    assert resp.json() == {"route": "focused", "target_concept_tag": "typhoon"}
