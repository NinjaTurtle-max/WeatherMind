"""세션 발급 시 board 문항의 template_json 노출 계약 — 스프린트 R3-01 §3.3 (R3-S2).

실서버 세션에서 board 문항이 오면 프론트가 palette·initial_state 없이는 보드를
못 그린다. SessionItem이 render된 board 플레이 필드를 template_json으로 노출하되,
비밀 정답(correct_answer)은 방어적으로 제외하는지 순수 함수 수준에서 검증한다(DB 불필요).

R8-09 확장: 화이트리스트 누락으로 세션 내 보드에서 §3.5 타이머(time_limit_sec)·
실화 배지(based_on)가 사라진 버그의 재발 방지 —
- 화이트리스트 ↔ 프론트 AtmosphereBoard.jsx 소비 필드 집합 일치 (소스 텍스트 계약,
  test_error_code_contract 전례)
- 실제 시드 board 12건 전부: 화이트리스트 통과 후에도 렌더 필수 필드 온전 +
  correct_answer 무유출
"""
import json
import re
from pathlib import Path

from app.routers.session import (
    BOARD_TEMPLATE_FIELDS,
    _question_payload,
    _to_session_item,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
ATMOSPHERE_BOARD_PATH = (
    REPO_ROOT / "frontend" / "src" / "modules" / "board" / "AtmosphereBoard.jsx"
)
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"

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
    # §3.5 표시용 필드 — 세션 내 보드에서도 노출돼야 한다 (R8-09)
    "time_limit_sec": 60,
    "based_on": {
        "event_name": "2018년 기록적 폭염",
        "event_date": "2018-08-01",
        "region": "서울·수도권",
    },
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
        tj = _question_payload(BOARD_QUESTION)
        assert tj is not None
        for field in ("mode", "guide_steps", "initial_state", "palette", "goal_conditions", "hints"):
            assert tj[field] == BOARD_QUESTION[field]
        assert tj["question_text"] == BOARD_QUESTION["question_text"]

    def test_미니미션_타이머_실화배지_노출(self):
        """R8-09: §3.5 표시용 필드(time_limit_sec·based_on)가 세션 내 보드에서
        사라지지 않는다 — 화이트리스트 누락 버그의 재발 가드."""
        tj = _question_payload(BOARD_QUESTION)
        assert tj["time_limit_sec"] == 60
        assert tj["based_on"] == BOARD_QUESTION["based_on"]

    def test_correct_answer_제외(self):
        tj = _question_payload(BOARD_QUESTION)
        assert "correct_answer" not in tj

    def test_화이트리스트_외_키는_안_샌다(self):
        """template_json 키는 board 플레이 화이트리스트의 부분집합이어야 한다."""
        tj = _question_payload(BOARD_QUESTION)
        assert set(tj).issubset(set(BOARD_TEMPLATE_FIELDS))

    def test_누락_필드는_생략(self):
        """goal_only 모드 등 guide_steps 없는 board는 해당 키만 빠진다."""
        q = {k: v for k, v in BOARD_QUESTION.items() if k != "guide_steps"}
        q["mode"] = "goal_only"
        tj = _question_payload(q)
        assert "guide_steps" not in tj
        assert tj["mode"] == "goal_only"

    def test_페이로드_불필요_유형은_None(self):
        """multiple_choice는 options 전용 컬럼으로 나가므로 페이로드가 없다.

        R10-07 §2.1 이후 board 외 유형도 페이로드를 받지만(match·ordering·slider),
        추가 페이로드가 필요 없는 유형은 여전히 None이다.
        """
        assert _question_payload(MC_QUESTION) is None


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


# AtmosphereBoard.jsx의 puzzle.<field> / puzzle?.<field> 접근 리터럴
PUZZLE_FIELD_RE = re.compile(r"\bpuzzle\??\.(\w+)")


class TestWhitelistFrontendContract:
    """R8-09 계약: 화이트리스트 = AtmosphereBoard가 소비하는 puzzle 필드 집합.

    프론트가 새 표시 필드를 소비하기 시작했는데 백엔드 화이트리스트가 안 따라오면
    (이번 버그) 여기서 잡힌다. 역방향(프론트가 안 쓰는 필드를 노출)도 드리프트로
    간주해 양방향 일치를 요구한다. test_error_code_contract의 소스 텍스트 검사 전례.
    """

    def test_프론트_파일_존재(self):
        assert ATMOSPHERE_BOARD_PATH.exists(), (
            "AtmosphereBoard.jsx 경로 변경 시 이 테스트를 갱신할 것"
        )

    def test_화이트리스트가_프론트_소비_필드와_일치(self):
        src = ATMOSPHERE_BOARD_PATH.read_text(encoding="utf-8")
        consumed = set(PUZZLE_FIELD_RE.findall(src))
        assert consumed, "puzzle 필드 접근을 하나도 못 찾음 — 정규식/컴포넌트 확인"
        whitelist = set(BOARD_TEMPLATE_FIELDS)
        missing = consumed - whitelist
        assert not missing, (
            f"프론트가 소비하는데 화이트리스트에 없는 필드: {sorted(missing)} — "
            "세션 내 보드에서 해당 UI가 사라진다 (R8-09 버그의 재발)"
        )
        unused = whitelist - consumed
        assert not unused, (
            f"화이트리스트에 있는데 프론트가 소비하지 않는 필드: {sorted(unused)} — "
            "불필요 노출(드리프트), 목록을 정리하거나 프론트 소비를 확인할 것"
        )

    def test_프론트가_정답_필드를_소비하지_않는다(self):
        """양방향 일치의 안전 전제 — 프론트가 correct/answer성 필드를 쓰기 시작하면
        일치 강제가 정답 유출 압력이 되므로 여기서 먼저 실패시킨다."""
        src = ATMOSPHERE_BOARD_PATH.read_text(encoding="utf-8")
        consumed = set(PUZZLE_FIELD_RE.findall(src))
        leaky = {f for f in consumed if "correct" in f.lower() or "answer" in f.lower()}
        assert not leaky, f"프론트가 정답성 필드를 소비: {sorted(leaky)}"
        assert "correct_answer" not in BOARD_TEMPLATE_FIELDS


class TestSeedBoardRoundTrip:
    """R8-09: 실제 시드 board 문항 전건이 화이트리스트 통과 후에도 렌더 온전.

    서빙 경로(session_service.create_daily_session)와 동일하게
    question = {**template_json, concept_tag, question_type}를 만들어
    _question_payload에 통과시킨다.
    """

    # 세션 내 보드 렌더에 반드시 필요한 필드 (AtmosphereBoard·§3.3)
    RENDER_REQUIRED = ("question_text", "mode", "initial_state", "palette", "goal_conditions", "hints")

    @classmethod
    def setup_class(cls):
        items = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        cls.boards = [it for it in items if it["question_type"] == "board"]

    def _serve(self, item: dict) -> dict:
        question = {
            **item["template_json"],
            "concept_tag": item["concept_tag"],
            "question_type": item["question_type"],
        }
        return _question_payload(question)

    def test_시드_board_수_고정(self):
        """시드 board 문항 수 고정 — 증감 시 이 계약과 §3.5 커버리지를 함께 갱신."""
        # R12 §9 13건 → R13 2일차 통합 병합으로 34건(2일차 저작 7 + 규칙 확장 10 +
        # 재난 연쇄 4). 규칙이 8→13종이 되면서 저단계·상단계 퍼즐이 함께 열렸다.
        # staging 승격(2026-08-14): 46 → **49**. CO-I-2/X-1 잔여 3건
        # (`pressure_front`·kl4)에 `board_order`·`title`·`summary`를 채웠다.
        # ⚠️ **말미에 붙이지 않았다** — 셋 다 난이도 2라 난이도 3 구간(옛 37~46) 뒤에
        # 두면 `test_board_progression`의 **단조 증가 계약이 깨진다**(실제로 깨졌고
        # 그래서 옮겼다). 난이도 2 블록 끝인 36 다음 **37~39**로 넣고 옛 37~46을
        # +3 밀었다. 순차 잠금(MT-24)이 이 순서 위에 서 있으므로 자리가 계약이다.
        # ㉣ 개통(2026-08-18): 49 → **52**. 요소 4종 팔레트를 쓰는 첫 보드들이다.
        # MT-19 일기도 판독(2026-08-18): 52 → **53**. 이 판은 **말미(53)에 붙였다** —
        # 위 staging 3건과 달리 난이도가 3이라(팔레트 4종 + adult) 난이도 3 구간 끝에
        # 이어지고, 뒤 번호를 밀 필요가 없다. 새 규칙·새 현상은 쓰지 않는다.
        assert len(self.boards) == 53

    def test_전건_렌더_필수_필드_온전(self):
        for i, item in enumerate(self.boards):
            tj = self._serve(item)
            assert tj is not None, f"[{i}] board인데 template_json이 None"
            for field in self.RENDER_REQUIRED:
                assert tj.get(field) == item["template_json"][field], (
                    f"[{i}] {item['concept_tag']}: 렌더 필수 필드 {field}가 "
                    "화이트리스트 통과 후 소실/변형"
                )

    def test_전건_표시용_확장_필드_보존(self):
        """template에 저작된 time_limit_sec·based_on은 그대로 서빙된다."""
        timers = badges = 0
        for item in self.boards:
            tpl, tj = item["template_json"], self._serve(item)
            if "time_limit_sec" in tpl:
                timers += 1
                assert tj["time_limit_sec"] == tpl["time_limit_sec"]
            if "based_on" in tpl:
                badges += 1
                assert tj["based_on"] == tpl["based_on"]
        # 시드 현행: 미니 미션 2건 · 재현 퍼즐 2건 (§3.5)
        assert timers == 2 and badges == 2

    def test_전건_정답_무유출(self):
        for i, item in enumerate(self.boards):
            tj = self._serve(item)
            assert "correct_answer" not in tj, f"[{i}] correct_answer 유출"
            assert set(tj).issubset(set(BOARD_TEMPLATE_FIELDS)), (
                f"[{i}] 화이트리스트 밖 키 유출: {set(tj) - set(BOARD_TEMPLATE_FIELDS)}"
            )
