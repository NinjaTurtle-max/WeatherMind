"""BKT 서빙 배선 계약 — R13-01 §5-1.

knowledge_tracing.py는 R6부터 합성 데이터 복원까지 검증돼 있었지만 **임포트하는
곳이 한 곳도 없었다**(테스트 안에서만 살았다). 이 파일은 그 모듈이 실제 서빙
경로(mastery_snapshot → /internal/weatherbrain/mastery)에 붙어 있음을 고정한다.

수학 정확성은 test_knowledge_tracing.py(합성 복원)가 담당한다. 여기서 지키는 것은
배선 계약이다:
  1. 단조성 — 연속 정답이면 P(숙련)이 오르고 연속 오답이면 내린다.
  2. 콜드스타트 — 관측 < MASTERY_MIN_RESPONSES면 cold_start=true.
  3. HTTP 왕복 — 요청/응답 스키마와 개념 다건 처리.
  4. 재적합 좌석 — params로 개념별 파라미터를 주입할 수 있고 출처가 표시된다.
  5. θ 독립 — 숙련 엔드포인트는 IRT를 호출하지 않고, 그 역도 같다.
"""

from __future__ import annotations

import pytest

from app.weatherbrain.knowledge_tracing import (
    MASTERY_MIN_RESPONSES,
    SERVING_PRIOR,
    BKTParams,
    mastery_snapshot,
)


class TestMasterySnapshot:
    """모듈 레벨 서빙 헬퍼 — langchain 없이도 도는 순수 계산."""

    def test_연속_정답이면_숙련이_오른다(self):
        seq = []
        prev = mastery_snapshot(seq)["p_mastery"]
        for _ in range(8):
            seq.append(True)
            cur = mastery_snapshot(seq)["p_mastery"]
            assert cur > prev, f"정답 누적인데 숙련이 안 올랐다: {prev} → {cur}"
            prev = cur

    def test_연속_오답이면_숙련이_내린다(self):
        # 정답 8회로 충분히 올려놓은 뒤 오답을 누적한다(바닥에서 시작하면
        # p_learn 전이가 하강을 상쇄할 수 있어 단조성 검증이 무뎌진다).
        seq = [True] * 8
        prev = mastery_snapshot(seq)["p_mastery"]
        for _ in range(6):
            seq.append(False)
            cur = mastery_snapshot(seq)["p_mastery"]
            assert cur < prev, f"오답 누적인데 숙련이 안 내렸다: {prev} → {cur}"
            prev = cur

    def test_관측이_없으면_사전값이고_콜드스타트다(self):
        snap = mastery_snapshot([])
        assert snap["n"] == 0
        assert snap["cold_start"] is True
        assert snap["p_mastery"] == pytest.approx(SERVING_PRIOR.p_init)

    def test_콜드스타트_경계는_MASTERY_MIN_RESPONSES(self):
        for n in range(MASTERY_MIN_RESPONSES):
            assert mastery_snapshot([True] * n)["cold_start"] is True
        assert mastery_snapshot([True] * MASTERY_MIN_RESPONSES)["cold_start"] is False

    def test_다음_정답확률은_확률_구간이고_숙련과_함께_오른다(self):
        low = mastery_snapshot([False] * 5)
        high = mastery_snapshot([True] * 5)
        for snap in (low, high):
            assert 0.0 <= snap["p_next_correct"] <= 1.0
        assert high["p_next_correct"] > low["p_next_correct"]

    def test_파라미터_주입이_결과를_바꾼다(self):
        """재적합 좌석 — fit_bkt 산출물을 그대로 넣을 수 있어야 한다."""
        fitted = BKTParams(p_init=0.9, p_learn=0.5, p_guess=0.1, p_slip=0.05)
        assert (
            mastery_snapshot([True, True], fitted)["p_mastery"]
            > mastery_snapshot([True, True])["p_mastery"]
        )


# HTTP 배선은 app.main(=langchain 경유)을 임포트한다 — test_weatherbrain_endpoints
# 와 같은 가드.
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


class TestMasteryEndpoint:
    def test_개념_다건_왕복(self, client):
        resp = client.post(
            "/internal/weatherbrain/mastery",
            json={
                "concepts": [
                    {"concept_tag": "typhoon", "corrects": [True] * 6},
                    {"concept_tag": "air_mass", "corrects": [False] * 6},
                    {"concept_tag": "anomaly", "corrects": [True]},
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["min_responses"] == MASTERY_MIN_RESPONSES
        got = {m["concept_tag"]: m for m in body["masteries"]}
        assert set(got) == {"typhoon", "air_mass", "anomaly"}
        assert got["typhoon"]["p_mastery"] > got["air_mass"]["p_mastery"]
        assert got["typhoon"]["cold_start"] is False
        assert got["anomaly"]["cold_start"] is True  # 1건 — 데이터 부족
        assert got["typhoon"]["params_source"] == "prior"
        assert got["typhoon"]["n"] == 6

    def test_빈_요청은_빈_목록(self, client):
        resp = client.post("/internal/weatherbrain/mastery", json={"concepts": []})
        assert resp.status_code == 200
        assert resp.json()["masteries"] == []

    def test_params_주입은_출처가_fitted(self, client):
        resp = client.post(
            "/internal/weatherbrain/mastery",
            json={
                "concepts": [{"concept_tag": "typhoon", "corrects": [True, True, True]}],
                "params": {
                    "typhoon": {
                        "p_init": 0.9,
                        "p_learn": 0.5,
                        "p_guess": 0.1,
                        "p_slip": 0.05,
                    }
                },
            },
        )
        assert resp.status_code == 200
        m = resp.json()["masteries"][0]
        assert m["params_source"] == "fitted"

    def test_인증_없으면_401(self):
        """다른 /internal/*과 같은 키 검증 — override 없이 확인."""
        assert app.dependency_overrides == {}
        resp = TestClient(app).post(
            "/internal/weatherbrain/mastery", json={"concepts": []}
        )
        assert resp.status_code == 401

    def test_숙련_엔드포인트는_IRT를_호출하지_않는다(self, client, monkeypatch):
        """θ와 독립 — 한 축이 바뀌어도 다른 축이 흔들리지 않는 전제."""
        import app.main as main

        def boom(*_a, **_k):  # pragma: no cover - 호출되면 실패
            raise AssertionError("mastery가 IRT estimate_ability를 호출했다")

        monkeypatch.setattr(main, "estimate_ability", boom)
        resp = client.post(
            "/internal/weatherbrain/mastery",
            json={"concepts": [{"concept_tag": "typhoon", "corrects": [True, False]}]},
        )
        assert resp.status_code == 200

    def test_IRT_추정은_BKT를_호출하지_않는다(self, client, monkeypatch):
        import app.main as main

        def boom(*_a, **_k):  # pragma: no cover - 호출되면 실패
            raise AssertionError("estimate가 BKT mastery_snapshot을 호출했다")

        monkeypatch.setattr(main, "mastery_snapshot", boom)
        resp = client.post(
            "/internal/weatherbrain/estimate",
            json={
                "level_group": "middle_high",
                "concepts": [
                    {
                        "concept_tag": "typhoon",
                        "responses": [{"b": 0.0, "a": 1.0, "correct": True}] * 3,
                    }
                ],
            },
        )
        assert resp.status_code == 200
