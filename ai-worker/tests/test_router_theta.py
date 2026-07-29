"""Router Chain θ 우선순위 로직 — R6 WeatherBrain 통합.

θ(abilities)가 있으면 1순위 분기 신호이고 weak_tags 정답률은 폴백임을 고정한다.
n=0(사전값만) 능력은 "정보 없음"이라 focused 트리거에서 제외되는 규칙도 검증한다.

실행: ai-worker 디렉토리에서 `python -m pytest tests -q`.
"""

from __future__ import annotations

from app.chains.router_chain import route


class TestThetaPriority:
    def test_신호없으면_general(self):
        assert route([], [], [])["route"] == "general"

    def test_낮은_θ_개념이_focused_타겟(self):
        abilities = [
            {"concept_tag": "typhoon", "theta": -1.5, "se": 0.4, "n": 8},
            {"concept_tag": "co2_climate", "theta": 0.8, "se": 0.4, "n": 6},
        ]
        result = route([], [], abilities)
        assert result == {"route": "focused", "target_concept_tag": "typhoon"}

    def test_충분한_θ_와_연속정답이면_advanced(self):
        abilities = [{"concept_tag": "typhoon", "theta": 1.2, "se": 0.3, "n": 10}]
        result = route([], [True, True, True], abilities)
        assert result["route"] == "advanced"

    def test_사전값만인_개념은_focused_트리거_제외(self):
        # n=0 이면 실제 응답 없음 → "약점"이 아니라 "정보 없음"이므로 무시.
        abilities = [{"concept_tag": "typhoon", "theta": -2.0, "se": 1.0, "n": 0}]
        result = route([], [], abilities)
        assert result["route"] == "general"

    def test_θ가_weak_tags보다_우선(self):
        # weak_tags는 focused를 가리키지만 θ는 충분 → θ 우선(general).
        abilities = [{"concept_tag": "typhoon", "theta": 0.9, "se": 0.3, "n": 5}]
        weak_tags = [{"concept_tag": "co2_climate", "accuracy_rate": 20.0}]
        result = route(weak_tags, [], abilities)
        assert result["route"] == "general"


class TestAccuracyFallback:
    def test_θ부재시_weak_tags_사용(self):
        weak_tags = [{"concept_tag": "co2_climate", "accuracy_rate": 30.0}]
        result = route(weak_tags, [], [])
        assert result == {"route": "focused", "target_concept_tag": "co2_climate"}

    def test_θ부재_콜드스타트_general(self):
        assert route([], [], [])["route"] == "general"

    def test_사전값만_있어도_weak_tags로_폴백(self):
        # abilities가 전부 n=0 이면 θ 신호 없음 → weak_tags 폴백 경로.
        abilities = [{"concept_tag": "typhoon", "theta": 0.0, "se": 1.0, "n": 0}]
        weak_tags = [{"concept_tag": "co2_climate", "accuracy_rate": 25.0}]
        result = route(weak_tags, [], abilities)
        assert result == {"route": "focused", "target_concept_tag": "co2_climate"}
