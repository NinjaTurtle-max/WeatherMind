"""R3~R5 계약 회귀 테스트 (통합 웨이브 2, QA) — 순수함수·소스텍스트·시드파일 기반.

기존 스위트(test_board_engine·test_cloud_energy·test_curriculum_tree)가 각 모듈의
동작을 촘촘히 검증하므로, 이 파일은 **직군 경계를 가로지르는 계약 관점**만 net-new로
가드한다(동작 재검증 아님):

- 보드 채점 권위성(§3.4): 서버가 board_state를 엔진으로 재판정하며, 클라이언트가
  판정 결과(passed/phenomena)를 **주입할 통로 자체가 없다**(요청 스키마 구조 증명) +
  실제 채점 레지스트리(GRADERS["board"])가 goal_conditions로만 판정한다.
- 구름 에너지 상수(§3.3): CLOUD_MAX=5·CLOUD_REGEN_MINUTES=20이 소스의 리터럴 상수와
  일치(계약 수치 고정).
- 커리큘럼 3자 스키마 정합(§3.2·§3.6): 동일한 units.json을 백엔드 로더(seed_units)와
  AI 게이트(validate_chain.validate_curriculum)가 **둘 다** 수용한다.

DB·네트워크 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import importlib
import json
import sys
from pathlib import Path

import pytest

from app.schemas.board import BoardAttemptRequest, BoardAttemptResult
from app.schemas.quiz import AnswerRequest, AnswerResult
from app.schemas.session import SessionAnswerRequest
from app.services import answer_service, board_engine

REPO_ROOT = Path(__file__).resolve().parents[2]
AI_WORKER_DIR = REPO_ROOT / "ai-worker"
UNITS_JSON = REPO_ROOT / "database" / "seed" / "units.json"
CONTENT_JSON = REPO_ROOT / "database" / "seed" / "content_items.json"


# ═══════════════════════════════════════════════════════════════
# 보드 채점 권위성 (§3.4) — 클라이언트 신고 무시, goal_conditions로만 판정
# ═══════════════════════════════════════════════════════════════


@pytest.fixture
def clean_rules(monkeypatch):
    """실제 board_rules.json으로 채점하도록 BOARD_RULES_PATH 오버라이드·캐시 격리."""
    monkeypatch.delenv(board_engine.BOARD_RULES_ENV_VAR, raising=False)
    board_engine.clear_rules_cache()
    yield
    board_engine.clear_rules_cache()


class TestBoardAuthorityStructural:
    """가장 강한 권위 증명: 요청 스키마에 클라이언트 판정 주입 필드가 없다.

    passed/phenomena는 오직 응답(Result) 스키마에만 존재한다 → 신뢰할 클라이언트
    판정이 구조적으로 존재하지 않는다(§3.4 "클라이언트 판정을 신뢰하지 않는다").
    """

    def test_요청_스키마는_board_state만_받는다(self):
        assert set(BoardAttemptRequest.model_fields) == {"board_state"}
        # 세션·퀴즈 answer 요청도 board_state 외에 판정 필드가 없다
        assert "board_state" in AnswerRequest.model_fields
        assert "board_state" in SessionAnswerRequest.model_fields

    def test_요청_스키마에_판정_필드_부재(self):
        forbidden = {"passed", "phenomena", "is_correct", "cleared", "score"}
        for schema in (BoardAttemptRequest, AnswerRequest, SessionAnswerRequest):
            leaked = forbidden & set(schema.model_fields)
            assert not leaked, f"{schema.__name__}에 클라이언트 판정 주입 필드: {leaked}"

    def test_판정_필드는_응답_스키마에만(self):
        assert {"passed", "phenomena"} <= set(BoardAttemptResult.model_fields)
        assert "phenomena" in AnswerResult.model_fields


class TestBoardAuthorityGrading:
    """채점 레지스트리 GRADERS["board"]가 board_state 재판정으로만 정오답을 낸다."""

    # 수도권(존 1)에 한랭전선 + 습기 70 → cold_front_shower(priority 100) → shower
    _PASS_STATE = {
        "elements": [
            {"type": "front", "subtype": "cold", "zone": 1},
            {"type": "moisture", "level": 70, "zone": 1},
        ]
    }
    # 습기 제거 → 기본값 40(<60) → 규칙 미성립 → cloudy (shower 아님)
    _FAIL_STATE = {"elements": [{"type": "front", "subtype": "cold", "zone": 1}]}
    _GOAL = [{"zone": 1, "phenomenon": "shower"}]

    def test_board_grader가_레지스트리에_등록(self):
        assert answer_service.GRADERS.get("board") is not None

    def test_규칙상_성립하면_정답(self, clean_rules):
        question = {"goal_conditions": self._GOAL}
        answer = json.dumps(self._PASS_STATE)
        assert answer_service.GRADERS["board"](question, answer) is True

    def test_규칙상_미성립이면_오답(self, clean_rules):
        """클라이언트가 무엇을 신고하든 board_state가 목표를 못 만들면 오답."""
        question = {"goal_conditions": self._GOAL}
        answer = json.dumps(self._FAIL_STATE)
        assert answer_service.GRADERS["board"](question, answer) is False

    def test_목표만_바꿔도_같은_board_state_판정_뒤집힘(self, clean_rules):
        """정답 여부는 board_state의 실제 판정과 goal_conditions의 대조 결과일 뿐 —
        클라이언트 신고가 아니라 서버 재판정이 권위."""
        answer = json.dumps(self._PASS_STATE)  # 실제로는 shower 생성
        # goal이 heatwave면 같은 board_state라도 오답 (재판정이 shower를 내므로)
        heat_goal = {"goal_conditions": [{"zone": 1, "phenomenon": "heatwave"}]}
        assert answer_service.GRADERS["board"](heat_goal, answer) is False

    def test_evaluate_board_answer_반환_계약(self, clean_rules):
        """(phenomena 4존, passed bool, rules) — feedback이 explain 쓰는 근거."""
        question = {"goal_conditions": self._GOAL}
        phenomena, passed, rules = answer_service.evaluate_board_answer(
            question, self._PASS_STATE
        )
        assert passed is True
        assert len(phenomena) == board_engine.ZONE_COUNT
        assert phenomena[1]["phenomenon"] == "shower"
        assert rules  # 규칙 파일 로드됨


# ═══════════════════════════════════════════════════════════════
# 구름 에너지 상수 (§3.3) — 소스 리터럴 = 계약 수치
# ═══════════════════════════════════════════════════════════════


class TestCloudEnergyConstants:
    """§3.3 상수값이 계약 수치로 고정되어 있다 (동작은 test_cloud_energy 담당).

    R5.5에서 값을 env로 튜닝 가능하게 외부화했으므로 '소스 리터럴' 대신 **Settings
    기본값**이 계약 수치와 일치하는지 감시한다(기본값 변경 = 스펙 드리프트). 서비스가
    실제로 그 기본값을 반영하는지도 임포트값으로 확인한다.
    """

    def test_상수_임포트값(self):
        from app.services import energy_service

        assert energy_service.CLOUD_MAX == 5
        assert energy_service.CLOUD_REGEN_MINUTES == 20

    def test_Settings_기본값_계약수치(self):
        """계약 수치(§3.3)가 Settings 기본값에 고정되어 있는지(우회 아님) 확인."""
        from app.core.config import Settings

        fields = Settings.model_fields
        assert fields["CLOUD_MAX"].default == 5
        assert fields["CLOUD_REGEN_MINUTES"].default == 20
        assert fields["CLOUD_COST"].default == 1

    def test_ENERGY_ENABLED_기본_true(self):
        """§3.4 하위 호환: 기능 플래그 기본값 true (false면 무제한)."""
        from app.core.config import Settings

        assert Settings.model_fields["ENERGY_ENABLED"].default is True


# ═══════════════════════════════════════════════════════════════
# 커리큘럼 3자 스키마 정합 (§3.2·§3.6) — units.json ↔ 로더 ↔ AI 게이트
# ═══════════════════════════════════════════════════════════════


def _import_ai_worker_validate_chain():
    """ai-worker validate_chain을 backend `app` 패키지와 충돌 없이 임포트.

    (test_seed_contract와 동일 패턴 — 두 디렉토리가 최상위 패키지명 `app`을 공유.)
    """
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module("app.chains.validate_chain")
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


class TestCurriculumThreeWaySchema:
    """동일 units.json을 백엔드 로더와 AI 게이트가 모두 수용한다(잠금 체인 계약).

    R5 통합 결함(slug↔자연키 스키마 불일치 → prereq 소실)의 재발 방지: 세 저작물이
    같은 파일 스키마에 정합해야 실기동에서 잠금이 살아 있다. 루트 유일·순환·잠금 체인
    자체는 test_curriculum_tree가 담당 — 여기선 **AI 게이트 정합**을 net-new로 잇는다.
    """

    def test_units_json_로드(self):
        units = json.loads(UNITS_JSON.read_text(encoding="utf-8"))
        assert isinstance(units, list) and len(units) == 12

    def test_백엔드_로더_수용(self):
        from app.scripts.seed_units import validate_entry

        units = json.loads(UNITS_JSON.read_text(encoding="utf-8"))
        errors = [e for i, u in enumerate(units) for e in validate_entry(u, i)]
        assert errors == [], f"백엔드 seed_units 로더가 units.json 거부: {errors}"

    def test_AI_게이트_수용(self):
        """validate_chain.validate_curriculum(§3.6)이 동일 units.json + content로 통과.

        board 유닛(concept_tag: pressure_front·air_mass·anomaly)마다 해당 태그의
        board 퍼즐이 content_items에 실재하는지까지 교차 검증한다(board_puzzle_exists).
        """
        validate_chain = _import_ai_worker_validate_chain()
        units = json.loads(UNITS_JSON.read_text(encoding="utf-8"))
        content = json.loads(CONTENT_JSON.read_text(encoding="utf-8"))
        result = validate_chain.validate_curriculum(units, content)
        failed = [c for c in result["checks"] if not c["passed"]]
        assert result["passed"] is True, f"AI 커리큘럼 게이트 실패: {failed}"
        names = {c["name"] for c in result["checks"]}
        assert "board_puzzle_exists" in names  # board 유닛↔퍼즐 교차검증 실행됨
