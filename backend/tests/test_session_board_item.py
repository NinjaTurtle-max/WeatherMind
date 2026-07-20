"""세션 발급 시 board 문항의 template_json 노출 계약 — 스프린트 R3-01 §3.3 (R3-S2).

실서버 세션에서 board 문항이 오면 프론트가 palette·initial_state 없이는 보드를
못 그린다. SessionItem이 render된 board 플레이 필드를 template_json으로 노출하되,
비밀 정답(correct_answer)은 방어적으로 제외하는지 순수 함수 수준에서 검증한다(DB 불필요).
"""
from app.routers.session import (
    BOARD_TEMPLATE_FIELDS,
    _board_template_json,
    _to_session_item,
)

BOARD_QUESTION = {
    "question_type": "board",
    "concept_tag": "pressure_front",
    "question_text": "수도권에 소나기를 내려 보세요",
    "mode": "guided",
    "guide_steps": ["한랭전선을 수도권에 놓아 보세요", "습기를 60 이상으로"],
    "initial_state": {"zones": ["서해", "수도권", "태백산맥", "동해안"], "elements": []},
    "palette": ["front:cold", "moisture"],
    "goal_conditions": [{"zone": 1, "phenomenon": "shower"}],
    "hints": ["공기 중에 무엇이 충분해야 할까요?", "차가운 공기가 파고들면..."],
    # 방어 대상 — 노출되면 안 됨 (board는 미사용 필드지만 만약 저작되어도 제외)
    "correct_answer": "비밀",
}

MC_QUESTION = {
    "question_type": "multiple_choice",
    "concept_tag": "typhoon",
    "question_text": "태풍의 에너지원은?",
    "options": ["수증기 응결열", "지열", "조력", "풍력"],
    "correct_answer": "수증기 응결열",
}


class TestBoardTemplateJson:
    def test_board_플레이_필드_노출(self):
        tj = _board_template_json(BOARD_QUESTION)
        assert tj is not None
        for field in ("mode", "guide_steps", "initial_state", "palette", "goal_conditions", "hints"):
            assert tj[field] == BOARD_QUESTION[field]
        assert tj["question_text"] == BOARD_QUESTION["question_text"]

    def test_correct_answer_제외(self):
        tj = _board_template_json(BOARD_QUESTION)
        assert "correct_answer" not in tj

    def test_화이트리스트_외_키는_안_샌다(self):
        """template_json 키는 board 플레이 화이트리스트의 부분집합이어야 한다."""
        tj = _board_template_json(BOARD_QUESTION)
        assert set(tj).issubset(set(BOARD_TEMPLATE_FIELDS))

    def test_누락_필드는_생략(self):
        """goal_only 모드 등 guide_steps 없는 board는 해당 키만 빠진다."""
        q = {k: v for k, v in BOARD_QUESTION.items() if k != "guide_steps"}
        q["mode"] = "goal_only"
        tj = _board_template_json(q)
        assert "guide_steps" not in tj
        assert tj["mode"] == "goal_only"

    def test_board_외_유형은_None(self):
        assert _board_template_json(MC_QUESTION) is None


class TestSessionItemBoard:
    def test_board_item_template_json_노출_정답_미포함(self):
        item = _to_session_item(
            "20260720-001", BOARD_QUESTION, "middle_high", source="bank", slot_filled=False
        )
        assert item.question_type == "board"
        assert item.template_json is not None
        assert item.template_json["palette"] == ["front:cold", "moisture"]
        # 직렬화 산출물 어디에도 정답이 노출되지 않는다
        dumped = item.model_dump()
        assert "correct_answer" not in dumped
        assert "correct_answer" not in dumped["template_json"]

    def test_비board_item은_template_json_None(self):
        item = _to_session_item(
            "20260720-002", MC_QUESTION, "middle_high", source="bank", slot_filled=False
        )
        assert item.template_json is None
        assert item.options == MC_QUESTION["options"]
