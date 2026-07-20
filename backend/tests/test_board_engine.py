"""대기 보드 규칙 엔진 단위 테스트 — 스프린트 R3-01 §3.1·§3.2 (R3-S1py).

DB·네트워크 없이 순수 함수만 검증한다(엔진은 board_engine 순수 모듈).
프론트(JS) 인터프리터와 동일 판정을 보장하는 공유 계약을 고정한다:
- §3.1 보드 검증(존 범위·존당 최대 1·level 0~100·미배치 기본값 40/50)
- §3.2 조건 2형 파싱(존재/숫자 비교, op는 >=·<= 만) + priority 최고 1개 + 기본값
- 경계값 60/59 (moisture>=60)
- 규칙 파일 로더(캐시·부재 예외·인라인 미니 규칙 자립)

공유 테스트 벡터(database/seed/board_test_vectors.json)는 데이터 직군이 저작 중 —
존재하면 로드해 전 케이스를 검증하고, 부재 시 pytest.skip(통합 시 자동 활성화).
"""
import json
from pathlib import Path

import pytest

from app.services import board_engine as be
from app.services.board_engine import (
    BoardRulesError,
    BoardRulesNotFoundError,
    BoardValidationError,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
TEST_VECTORS_PATH = REPO_ROOT / "database" / "seed" / "board_test_vectors.json"

# 테스트 자립용 인라인 미니 규칙 (데이터 파일 없이도 엔진 계약을 고정) —
# §3.2 문법·enum을 그대로 따르되 판정 경로만 최소로 덮는다.
MINI_RULES = [
    {
        "id": "cold_front_shower",
        "priority": 10,
        "when": ["front:cold", "moisture>=60"],
        "then": {"phenomenon": "shower", "cloud": "cumulonimbus"},
        "explain": "한랭전선이 습한 공기를 파고들어 적란운·소나기.",
    },
    {
        "id": "np_heatwave",
        "priority": 8,
        "when": ["air_mass:north_pacific", "sun>=70"],
        "then": {"phenomenon": "heatwave", "cloud": "none"},
        "explain": "북태평양기단 + 강한 일사로 폭염.",
    },
    {
        "id": "front_only_low",
        "priority": 2,
        "when": ["front:cold"],
        "then": {"phenomenon": "rain", "cloud": "nimbostratus"},
        "explain": "한랭전선 일반(저우선).",
    },
]


def _board(elements):
    return {"zones": list(be.ZONES), "elements": elements}


# ═══════════════════ §3.1 보드 검증 ═══════════════════


class TestValidateBoard:
    def test_최소_보드_통과(self):
        be.validate_board(_board([]))

    def test_zones_개수_틀리면_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board({"zones": ["a", "b"], "elements": []})

    def test_zones_생략_허용(self):
        be.validate_board({"elements": [{"type": "sun", "level": 50, "zone": 0}]})

    def test_배치불가_type_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board(_board([{"type": "cloud", "zone": 0}]))

    def test_존_범위밖_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board(_board([{"type": "sun", "level": 50, "zone": 4}]))

    def test_존_bool은_정수아님_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board(_board([{"type": "sun", "level": 50, "zone": True}]))

    def test_기단_subtype_불허_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board(_board([{"type": "air_mass", "subtype": "x", "zone": 0}]))

    def test_level_범위밖_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board(_board([{"type": "moisture", "level": 101, "zone": 0}]))

    def test_level_숫자아님_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board(_board([{"type": "moisture", "level": "high", "zone": 0}]))

    def test_존당_기단_2개_거부(self):
        with pytest.raises(BoardValidationError):
            be.validate_board(
                _board(
                    [
                        {"type": "air_mass", "subtype": "siberian", "zone": 1},
                        {"type": "air_mass", "subtype": "yangtze", "zone": 1},
                    ]
                )
            )

    def test_다른_존_기단_2개는_허용(self):
        be.validate_board(
            _board(
                [
                    {"type": "air_mass", "subtype": "siberian", "zone": 0},
                    {"type": "air_mass", "subtype": "yangtze", "zone": 1},
                ]
            )
        )


class TestZoneDefaults:
    def test_미배치_존_기본값_40_50(self):
        states = be.zone_states(_board([]))
        assert len(states) == be.ZONE_COUNT
        assert all(s["moisture"] == 40 and s["sun"] == 50 for s in states)
        assert all(s["air_mass"] is None and s["front"] is None for s in states)

    def test_배치값이_기본값을_덮는다(self):
        states = be.zone_states(
            _board(
                [
                    {"type": "moisture", "level": 80, "zone": 2},
                    {"type": "front", "subtype": "warm", "zone": 2},
                ]
            )
        )
        assert states[2]["moisture"] == 80
        assert states[2]["front"] == "warm"
        assert states[2]["sun"] == 50  # 미배치 → 기본값 유지


# ═══════════════════ §3.2 조건 파싱 ═══════════════════


class TestParseCondition:
    def test_존재_조건(self):
        assert be.parse_condition("front:cold") == ("presence", "front", "cold")

    def test_숫자_조건_ge(self):
        assert be.parse_condition("moisture>=60") == ("numeric", "moisture", ">=", 60.0)

    def test_숫자_조건_le(self):
        assert be.parse_condition("sun<=30") == ("numeric", "sun", "<=", 30.0)

    @pytest.mark.parametrize(
        "bad",
        [
            "moisture>60",     # op는 >=·<= 만
            "moisture==60",
            "temp>=60",        # field는 moisture|sun 만
            "cloud:cumulus",   # 존재 검사 type은 air_mass|front 만
            "front:typhoon",   # subtype enum 밖
            "front cold",
            "",
        ],
    )
    def test_문법_외_거부(self, bad):
        with pytest.raises(BoardRulesError):
            be.parse_condition(bad)


# ═══════════════════ §3.2 판정(evaluate) ═══════════════════


class TestEvaluate:
    def test_존별_4개_반환(self):
        results = be.evaluate(_board([]), MINI_RULES)
        assert [r["zone"] for r in results] == [0, 1, 2, 3]

    def test_무성립_기본값_cloudy_cumulus(self):
        results = be.evaluate(_board([]), MINI_RULES)
        for r in results:
            assert r["phenomenon"] == "cloudy" and r["cloud"] == "cumulus"
            assert r["rule_id"] is None

    def test_규칙_성립_판정(self):
        board = _board(
            [
                {"type": "front", "subtype": "cold", "zone": 1},
                {"type": "moisture", "level": 70, "zone": 1},
            ]
        )
        r1 = be.evaluate(board, MINI_RULES)[1]
        assert r1["phenomenon"] == "shower"
        assert r1["cloud"] == "cumulonimbus"
        assert r1["rule_id"] == "cold_front_shower"

    def test_priority_최고_1개_적용(self):
        # front:cold + moisture>=60 → cold_front_shower(10) vs front_only_low(2) 동시 성립
        board = _board(
            [
                {"type": "front", "subtype": "cold", "zone": 0},
                {"type": "moisture", "level": 65, "zone": 0},
            ]
        )
        assert be.evaluate(board, MINI_RULES)[0]["rule_id"] == "cold_front_shower"

    def test_저우선_규칙만_성립하면_그것_적용(self):
        # front:cold 있으나 moisture 기본값 40 < 60 → 고우선 미성립, 저우선만
        board = _board([{"type": "front", "subtype": "cold", "zone": 0}])
        assert be.evaluate(board, MINI_RULES)[0]["rule_id"] == "front_only_low"


class TestBoundary6059:
    """§3.2 경계값 — moisture>=60은 60 성립·59 미성립."""

    def _shower_at(self, moisture):
        board = _board(
            [
                {"type": "front", "subtype": "cold", "zone": 0},
                {"type": "moisture", "level": moisture, "zone": 0},
            ]
        )
        return be.evaluate(board, MINI_RULES)[0]["rule_id"]

    def test_60_성립(self):
        assert self._shower_at(60) == "cold_front_shower"

    def test_59_미성립_저우선으로_강등(self):
        assert self._shower_at(59) == "front_only_low"


# ═══════════════════ goal 판정·피드백 ═══════════════════


class TestCheckGoals:
    def test_AND_충족(self):
        ph = be.evaluate(
            _board(
                [
                    {"type": "front", "subtype": "cold", "zone": 1},
                    {"type": "moisture", "level": 70, "zone": 1},
                ]
            ),
            MINI_RULES,
        )
        assert be.check_goals(ph, [{"zone": 1, "phenomenon": "shower"}]) is True

    def test_한_조건이라도_불충족이면_False(self):
        ph = be.evaluate(_board([]), MINI_RULES)
        assert be.check_goals(ph, [{"zone": 1, "phenomenon": "shower"}]) is False

    def test_빈_goal은_False(self):
        ph = be.evaluate(_board([]), MINI_RULES)
        assert be.check_goals(ph, []) is False

    def test_cloud도_비교(self):
        ph = be.evaluate(
            _board(
                [
                    {"type": "front", "subtype": "cold", "zone": 1},
                    {"type": "moisture", "level": 70, "zone": 1},
                ]
            ),
            MINI_RULES,
        )
        assert be.check_goals(
            ph, [{"zone": 1, "phenomenon": "shower", "cloud": "cumulonimbus"}]
        ) is True
        assert be.check_goals(
            ph, [{"zone": 1, "phenomenon": "shower", "cloud": "stratus"}]
        ) is False


class TestSelectFeedback:
    def test_정답이면_성립규칙_explain(self):
        template = {"goal_conditions": [{"zone": 1, "phenomenon": "shower"}], "hints": ["h0"]}
        ph = be.evaluate(
            _board(
                [
                    {"type": "front", "subtype": "cold", "zone": 1},
                    {"type": "moisture", "level": 70, "zone": 1},
                ]
            ),
            MINI_RULES,
        )
        fb = be.select_feedback(template, ph, True, MINI_RULES)
        assert fb == MINI_RULES[0]["explain"]

    def test_오답이면_hints_0(self):
        template = {"goal_conditions": [{"zone": 1, "phenomenon": "shower"}], "hints": ["첫 힌트", "둘째"]}
        ph = be.evaluate(_board([]), MINI_RULES)
        assert be.select_feedback(template, ph, False, MINI_RULES) == "첫 힌트"

    def test_오답_hints_없으면_폴백(self):
        ph = be.evaluate(_board([]), MINI_RULES)
        assert be.select_feedback({}, ph, False, MINI_RULES) == be.FEEDBACK_FAIL_DEFAULT


# ═══════════════════ 규칙 스키마 검증 ═══════════════════


class TestValidateRules:
    def test_유효_규칙_통과(self):
        be.validate_rules(MINI_RULES)

    def test_빈_배열_거부(self):
        with pytest.raises(BoardRulesError):
            be.validate_rules([])

    def test_id_중복_거부(self):
        dup = [MINI_RULES[0], {**MINI_RULES[1], "id": "cold_front_shower"}]
        with pytest.raises(BoardRulesError):
            be.validate_rules(dup)

    def test_phenomenon_enum밖_거부(self):
        bad = [{**MINI_RULES[0], "then": {"phenomenon": "typhoon", "cloud": "none"}}]
        with pytest.raises(BoardRulesError):
            be.validate_rules(bad)

    def test_같은조건_같은priority_모순_거부(self):
        conflict = [
            MINI_RULES[0],
            {
                "id": "clash",
                "priority": 10,
                "when": ["moisture>=60", "front:cold"],  # 순서만 다른 동일 집합
                "then": {"phenomenon": "rain", "cloud": "nimbostratus"},
                "explain": "모순 규칙.",
            },
        ]
        with pytest.raises(BoardRulesError):
            be.validate_rules(conflict)


# ═══════════════════ 규칙 파일 로더 ═══════════════════


class TestRulesLoader:
    def test_부재_경로는_NotFound(self, tmp_path):
        be.clear_rules_cache()
        with pytest.raises(BoardRulesNotFoundError):
            be.load_rules(tmp_path / "nope.json")

    def test_env_오버라이드(self, tmp_path, monkeypatch):
        be.clear_rules_cache()
        path = tmp_path / "rules.json"
        path.write_text(json.dumps(MINI_RULES), encoding="utf-8")
        monkeypatch.setenv(be.BOARD_RULES_ENV_VAR, str(path))
        assert be.rules_path() == path
        assert be.load_rules() == MINI_RULES

    def test_로드_결과_캐시(self, tmp_path):
        be.clear_rules_cache()
        path = tmp_path / "rules.json"
        path.write_text(json.dumps(MINI_RULES), encoding="utf-8")
        first = be.load_rules(path)
        path.write_text(json.dumps(MINI_RULES[:1]), encoding="utf-8")  # 파일 변경
        assert be.load_rules(path) is first  # 캐시 반환(재파싱 안 함)
        be.clear_rules_cache()
        assert len(be.load_rules(path)) == 1  # 캐시 초기화 후 재로드

    def test_스키마위반_파일은_거부(self, tmp_path):
        be.clear_rules_cache()
        path = tmp_path / "bad.json"
        path.write_text(json.dumps([{"id": "x"}]), encoding="utf-8")
        with pytest.raises(BoardRulesError):
            be.load_rules(path)


# ═══════════════════ 공유 테스트 벡터 (데이터 저작 대기) ═══════════════════


class TestSharedVectors:
    """database/seed/board_test_vectors.json 존재 시 전 케이스 판정 일치 검증.

    벡터 스키마(계약 §4): [{"name","board","rules"?,"expected": [{zone,phenomenon,
    cloud}]}]. expected는 공유 판정 표현(존별 zone·phenomenon·cloud)이며 rule_id는
    백엔드 내부 부가정보라 비교에서 제외한다(프론트 JS 인터프리터와 동일 판정 보증).
    규칙은 벡터에 인라인이 있으면 그것을, 없으면 board_rules.json을 쓴다.
    파일 부재 시 skip — 데이터 통합 시 자동 활성화된다.
    """

    def _load(self):
        if not TEST_VECTORS_PATH.exists():
            pytest.skip("board_test_vectors.json 데이터 저작 대기")
        return json.loads(TEST_VECTORS_PATH.read_text(encoding="utf-8"))

    @staticmethod
    def _project(phenomena):
        """공유 계약 필드(zone·phenomenon·cloud)만 투영 — rule_id 등 부가정보 제외."""
        return [
            {"zone": p["zone"], "phenomenon": p["phenomenon"], "cloud": p["cloud"]}
            for p in phenomena
        ]

    def test_전_케이스_판정_일치(self):
        vectors = self._load()
        cases = vectors.get("cases", vectors) if isinstance(vectors, dict) else vectors
        assert cases, "테스트 벡터가 비어 있음"
        for case in cases:
            board = case["board"]
            rules = case.get("rules")
            if rules is None:
                rules = be.load_rules()  # 파일 부재 시 여기서 명확히 실패
            phenomena = be.evaluate(board, rules)
            if "expected" in case:
                expected = self._project(case["expected"])
                assert self._project(phenomena) == expected, (
                    f"판정 불일치: {case.get('name')}"
                )
            if "goal_conditions" in case and "passed" in case:
                assert (
                    be.check_goals(phenomena, case["goal_conditions"]) == case["passed"]
                ), f"goal 판정 불일치: {case.get('name')}"
