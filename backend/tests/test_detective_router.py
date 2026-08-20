"""기후 탐정 API 계약 — /api/v1/detective (R13, 대장 CO-N-2).

여기서 지키는 것:
  ① **상세 응답에 정답이 없다** — verdict·feedback·supporting_clues·solution·
     answer_hypothesis_id가 JSON 어디에도(중첩 포함) 나타나지 않는다. 세션의
     QUESTION_PAYLOAD_FIELDS 화이트리스트가 세운 "구조적 제외" 관례와 같은 급의
     보증이다. 문자열 단정이 아니라 **재귀 키 워크**로 본다 — 필드를 하나 늘리다
     정답을 딸려 보내는 회귀는 눈으로 못 잡는다.
  ② **단서 조사가 서버 계약이다** — min_clues 미만이면 422 NOT_ENOUGH_CLUES.
     이 계약이 빠지면 기후 탐정은 객관식 한 문제가 된다(심사 배점 ②).
  ③ 해설(solution)은 **정답을 맞혔을 때만** 나간다 — 오답을 반복해 긁을 수 없다.
  ④ 시드 데이터 자체의 무결성 — 케이스마다 정답 가설이 정확히 1개이고,
     supporting_clues·answer_hypothesis_id가 실재 id를 가리킨다.
  ⑤ **XP는 최초 정답 1회만** — 같은 케이스 재제출은 0이고, 6케이스를 다 맞히면
     합이 시드의 xp_reward 총합(185)이다. 이게 없으면 `quiz_logs` 마커를 걷어내도
     아무도 울지 않고, 재제출 무한 적립이 조용히 되살아난다.

목록·상세는 지금도 DB를 안 본다. `solve`만 `get_db_with_rls`를 쓰므로(멱등 마커)
그 의존을 **상태를 가진 가짜 세션**으로 갈아 끼운다 — 백엔드 테스트에 라이브 DB
하네스가 없어서 `test_board_clear_scope`의 `_CaptureDB` 관례를 상태 있게 늘렸다.
가짜가 `add()`한 행을 기억하므로 ⓐ첫 회 적립 ⓑ재제출 0이 **API 왕복으로** 걸린다.
실행: `python -m pytest tests/test_detective_router.py -q`
"""
import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.sql.dml import Update

from app.core.dependencies import get_current_user, get_db_with_rls
from app.main import app
from app.models.user import User
from app.routers import detective

SEED_PATH = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "detective_cases.json"
)

# 상세 응답에 절대 있으면 안 되는 키 (중첩 포함)
SECRET_KEYS = {
    "verdict",
    "feedback",
    "supporting_clues",
    "solution",
    "answer_hypothesis_id",
    "explanation",
    "takeaway",
}


class _Result:
    """execute() 반환 대역 — 존재 조회(.first())만 쓰면 되는 최소 형태."""

    def __init__(self, rows):
        self._rows = list(rows)

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeDB:
    """상태를 가진 AsyncSession 대역 — add()한 마커 행을 기억한다.

    `_CaptureDB`(test_board_clear_scope)를 상태 있게 늘린 것. 잡아 두기만 하면
    「이미 받았다」 조회가 언제나 빈 결과라 재제출이 항상 첫 회처럼 보인다 —
    ⓑ가 구조적으로 통과해 버리므로 감지기가 아니게 된다.
    """

    def __init__(self):
        self.added = []       # db.add()된 QuizLog 마커
        self.xp_amounts = []  # add_xp가 실행한 UPDATE의 가산액

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def execute(self, stmt):
        if isinstance(stmt, Update):
            # xp_service.add_xp — UPDATE users SET xp = xp + :xp_1
            self.xp_amounts.append(stmt.compile().params["xp_1"])
            return _Result([])
        # 마커 존재 조회: 바인드된 (user_id, quiz_id)와 일치하는 행이 있는가
        bound = {str(v) for v in stmt.compile().params.values()}
        rows = [
            (row,)
            for row in self.added
            if str(row.user_id) in bound and str(row.quiz_id) in bound
        ]
        return _Result(rows)


@pytest.fixture()
def client():
    user = User(id=uuid.uuid4(), email="detective@test.invalid", level_group="middle_high")
    db = _FakeDB()
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_with_rls] = lambda: db
    try:
        test_client = TestClient(app)
        test_client.db = db      # 마커·적립액을 테스트에서 들여다본다
        test_client.user = user
        yield test_client
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db_with_rls, None)


@pytest.fixture()
def cases():
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def walk_keys(node):
    """중첩 JSON의 모든 키를 훑는다 — 얕은 단정으로는 회귀를 못 잡는다."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from walk_keys(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk_keys(value)


class TestSeedPromoted:
    """staging에만 있던 케이스가 본시드로 승격됐는가 — 이게 없으면 화면이 0이다."""

    def test_본시드_파일이_존재하고_케이스가_있다(self, cases):
        assert SEED_PATH.exists()
        assert len(cases) >= 2

    def test_케이스마다_정답_가설이_정확히_1개(self, cases):
        for case in cases:
            corrects = [h for h in case["hypotheses"] if h["verdict"] == "correct"]
            assert len(corrects) == 1, case["case_id"]
            assert case["solution"]["answer_hypothesis_id"] == corrects[0]["hypothesis_id"]

    def test_가설의_supporting_clues가_실재_단서를_가리킨다(self, cases):
        for case in cases:
            clue_ids = {c["clue_id"] for c in case["clues"]}
            for hypothesis in case["hypotheses"]:
                unknown = set(hypothesis.get("supporting_clues", [])) - clue_ids
                assert not unknown, (case["case_id"], unknown)

    def test_min_clues가_단서_개수를_넘지_않는다(self, cases):
        """넘으면 그 케이스는 영원히 제출 불가다(도달 불가 화면)."""
        for case in cases:
            assert 0 < case["min_clues"] <= len(case["clues"]), case["case_id"]


class TestListCases:
    def test_목록은_요약만_준다(self, client, cases):
        res = client.get("/api/v1/detective/cases")
        assert res.status_code == 200
        body = res.json()
        assert len(body) == len(cases)
        first = body[0]
        assert first["case_id"] == cases[0]["case_id"]
        assert first["headline"] == cases[0]["intro"]["headline"]
        assert first["clue_count"] == len(cases[0]["clues"])
        assert first["min_clues"] == cases[0]["min_clues"]

    def test_목록에도_정답이_없다(self, client):
        leaked = SECRET_KEYS & set(walk_keys(client.get("/api/v1/detective/cases").json()))
        assert not leaked

    def test_케이스가_0건이면_200_빈_배열(self, client, monkeypatch):
        """빈 상태로 200을 주지 않으면 프론트가 에러 화면에 갇힌다(CO-S-3 부류)."""
        monkeypatch.setattr(detective, "_cases_cache", [])
        res = client.get("/api/v1/detective/cases")
        assert res.status_code == 200
        assert res.json() == []


class TestCaseDetail:
    def test_플레이에_필요한_것을_모두_준다(self, client, cases):
        case = cases[0]
        body = client.get(f"/api/v1/detective/cases/{case['case_id']}").json()
        assert body["title"] == case["title"]
        assert len(body["series"]) == len(case["series"])
        assert len(body["clues"]) == len(case["clues"])
        assert len(body["hypotheses"]) == len(case["hypotheses"])
        # 단서는 증거이지 정답이 아니다 — 전문이 온다
        assert body["clues"][0]["text"] == case["clues"][0]["text"]
        # 시계열 점도 온전해야 차트를 그린다
        assert body["series"][0]["points"] == case["series"][0]["points"]

    def test_상세_응답_어디에도_정답_키가_없다(self, client, cases):
        for case in cases:
            body = client.get(f"/api/v1/detective/cases/{case['case_id']}").json()
            leaked = SECRET_KEYS & set(walk_keys(body))
            assert not leaked, (case["case_id"], leaked)

    def test_가설은_id와_텍스트뿐(self, client, cases):
        body = client.get(f"/api/v1/detective/cases/{cases[0]['case_id']}").json()
        for hypothesis in body["hypotheses"]:
            assert set(hypothesis) == {"hypothesis_id", "text"}

    def test_정답_피드백_문구가_본문에_섞여_있지_않다(self, client, cases):
        """키 이름을 안 써도 값이 새면 같은 유출이다 — 원문 대조로 한 겹 더 본다."""
        for case in cases:
            raw = client.get(f"/api/v1/detective/cases/{case['case_id']}").text
            for hypothesis in case["hypotheses"]:
                assert hypothesis["feedback"][:40] not in raw
            assert case["solution"]["explanation"][:40] not in raw

    def test_없는_케이스는_404(self, client):
        res = client.get("/api/v1/detective/cases/no-such-case")
        assert res.status_code == 404
        assert res.json()["code"] == "CASE_NOT_FOUND"


class TestSolve:
    def _solve(self, client, case, hypothesis_id, clue_ids=None):
        clues = clue_ids if clue_ids is not None else [
            c["clue_id"] for c in case["clues"][: case["min_clues"]]
        ]
        return client.post(
            f"/api/v1/detective/cases/{case['case_id']}/solve",
            json={"hypothesis_id": hypothesis_id, "opened_clue_ids": clues},
        )

    def test_정답이면_해설까지_온다(self, client, cases):
        case = cases[0]
        answer = case["solution"]["answer_hypothesis_id"]
        body = self._solve(client, case, answer).json()
        assert body["verdict"] == "correct"
        assert body["correct"] is True
        assert body["solution"]["explanation"] == case["solution"]["explanation"]
        assert body["solution"]["takeaway"] == case["solution"]["takeaway"]

    def test_오답이면_피드백만_오고_해설은_없다(self, client, cases):
        case = cases[0]
        wrong = next(h for h in case["hypotheses"] if h["verdict"] == "incorrect")
        body = self._solve(client, case, wrong["hypothesis_id"]).json()
        assert body["correct"] is False
        assert body["feedback"] == wrong["feedback"]
        assert body["solution"] is None

    def test_partial_판정이_보존된다(self, client, cases):
        """정오 2분기로 접으면 저작된 '방향은 맞다' 피드백이 버려진다."""
        case = cases[0]
        partial = next(h for h in case["hypotheses"] if h["verdict"] == "partial")
        body = self._solve(client, case, partial["hypothesis_id"]).json()
        assert body["verdict"] == "partial"
        assert body["correct"] is False
        assert body["solution"] is None

    def test_단서를_덜_열면_422(self, client, cases):
        case = cases[0]
        res = self._solve(
            client,
            case,
            case["solution"]["answer_hypothesis_id"],
            clue_ids=[c["clue_id"] for c in case["clues"][: case["min_clues"] - 1]],
        )
        assert res.status_code == 422
        assert res.json()["code"] == "NOT_ENOUGH_CLUES"

    def test_미지_단서_id로_하한을_우회할_수_없다(self, client, cases):
        case = cases[0]
        res = self._solve(
            client,
            case,
            case["solution"]["answer_hypothesis_id"],
            clue_ids=["fake-1", "fake-2", "fake-3", "fake-4"],
        )
        assert res.status_code == 422
        assert res.json()["code"] == "NOT_ENOUGH_CLUES"

    def test_중복_단서_id로도_우회할_수_없다(self, client, cases):
        case = cases[0]
        one = case["clues"][0]["clue_id"]
        res = self._solve(client, case, case["solution"]["answer_hypothesis_id"], clue_ids=[one] * 9)
        assert res.status_code == 422

    def test_없는_가설은_422(self, client, cases):
        case = cases[0]
        res = self._solve(client, case, "hypothesis-that-does-not-exist")
        assert res.status_code == 422
        assert res.json()["code"] == "UNKNOWN_HYPOTHESIS"

    def test_없는_케이스_제출은_404(self, client):
        res = client.post(
            "/api/v1/detective/cases/no-such-case/solve",
            json={"hypothesis_id": "x", "opened_clue_ids": ["a", "b", "c"]},
        )
        assert res.status_code == 404


class TestXpAward:
    """⑤ XP는 최초 정답 1회만 (2026-08-20 PM 판정 — 마이그레이션 없이 적립).

    종전 `test_XP는_적립되지_않는다`가 "PM이 영속을 붙이기로 판정하면 이 테스트가
    그 변경의 수신자가 된다"고 적어 둔 그 수신자다. 0 고정 단정을 지운 게 아니라
    **실제 적립액 단정으로 갈아 끼운 것**이다.
    """

    def _solve(self, client, case, hypothesis_id):
        return client.post(
            f"/api/v1/detective/cases/{case['case_id']}/solve",
            json={
                "hypothesis_id": hypothesis_id,
                "opened_clue_ids": [c["clue_id"] for c in case["clues"][: case["min_clues"]]],
            },
        )

    def _answer(self, case):
        return case["solution"]["answer_hypothesis_id"]

    def test_계약a_최초_정답이면_케이스의_xp_reward가_적립된다(self, client, cases):
        case = cases[0]
        body = self._solve(client, case, self._answer(case)).json()
        assert body["xp_earned"] == case["xp_reward"] > 0
        # 응답 숫자만 맞고 DB가 안 움직이면 화면만 거짓말한다 — 적립도 함께 본다
        assert client.db.xp_amounts == [case["xp_reward"]]

    def test_계약b_같은_케이스_재제출은_0이고_두_번_적립되지_않는다(self, client, cases):
        case = cases[0]
        first = self._solve(client, case, self._answer(case)).json()
        second = self._solve(client, case, self._answer(case)).json()
        assert first["xp_earned"] == case["xp_reward"]
        assert second["xp_earned"] == 0
        assert client.db.xp_amounts == [case["xp_reward"]]  # 두 번째는 UPDATE 자체가 없다
        assert len(client.db.added) == 1                    # 마커도 하나뿐

    def test_계약b_재제출해도_판정과_해설은_그대로_온다(self, client, cases):
        """중복 방어가 XP만 막아야지 정답 화면까지 막으면 다시 볼 수가 없다."""
        case = cases[0]
        self._solve(client, case, self._answer(case))
        second = self._solve(client, case, self._answer(case)).json()
        assert second["correct"] is True
        assert second["solution"]["explanation"] == case["solution"]["explanation"]

    def test_계약c_6케이스를_다_맞히면_총합이_시드_합과_같다(self, client, cases):
        total = sum(self._solve(client, c, self._answer(c)).json()["xp_earned"] for c in cases)
        assert total == sum(c["xp_reward"] for c in cases) == 185
        assert sum(client.db.xp_amounts) == 185
        assert len(client.db.added) == len(cases)

    def test_오답은_0이고_마커를_남기지_않아_다시_받을_수_있다(self, client, cases):
        """첫 제출을 태우는 규칙이면 한 번 헛짚은 사람은 영원히 0이다."""
        case = cases[0]
        wrong = next(h for h in case["hypotheses"] if h["verdict"] == "incorrect")
        assert self._solve(client, case, wrong["hypothesis_id"]).json()["xp_earned"] == 0
        assert client.db.added == []
        assert self._solve(client, case, self._answer(case)).json()["xp_earned"] == case["xp_reward"]

    def test_partial도_0이고_마커를_남기지_않는다(self, client, cases):
        case = cases[0]
        partial = next(h for h in case["hypotheses"] if h["verdict"] == "partial")
        assert self._solve(client, case, partial["hypothesis_id"]).json()["xp_earned"] == 0
        assert client.db.added == []

    def test_422로_막힌_제출은_적립도_마커도_없다(self, client, cases):
        """단서 하한을 못 넘긴 요청이 XP를 흘리면 조사 강제가 무의미해진다."""
        case = cases[0]
        res = client.post(
            f"/api/v1/detective/cases/{case['case_id']}/solve",
            json={
                "hypothesis_id": self._answer(case),
                "opened_clue_ids": [c["clue_id"] for c in case["clues"][: case["min_clues"] - 1]],
            },
        )
        assert res.status_code == 422
        assert client.db.added == [] and client.db.xp_amounts == []

    def test_마커는_복습_큐_계열에_보이지_않는_모양이다(self, client, cases):
        """`is_correct`가 NULL이 아니면 문항 없는 개념 태그가 복습 사다리에 올라간다.

        읽는 쪽 전부가 `is_correct IS NOT NULL`로 거르는 것이 이 설계의 전제다
        (schemas/detective.py 독스트링). 모양이 바뀌면 여기서 운다.
        """
        case = cases[0]
        self._solve(client, case, self._answer(case))
        marker = client.db.added[0]
        assert marker.is_correct is None
        assert marker.content_item_id is None   # 가리킬 content_items 행이 없다
        assert marker.session_id is None
        assert marker.question_type is None     # board 클리어 집합에 안 섞인다
        assert marker.quiz_id == f"detective-{case['case_id']}"
        assert len(marker.quiz_id) <= 50        # quiz_logs.quiz_id는 String(50)
        assert marker.user_id == client.user.id

    def test_마커_quiz_id는_케이스마다_다르다(self, client, cases):
        """한 케이스를 맞히면 다른 케이스까지 받은 것으로 접히면 안 된다."""
        ids = {detective.detective_quiz_id(c["case_id"]) for c in cases}
        assert len(ids) == len(cases)
        assert all(len(qid) <= 50 for qid in ids)


class TestLoadCasesResilience:
    def test_파일이_없으면_빈_목록(self, monkeypatch, tmp_path):
        monkeypatch.setattr(detective, "_cases_cache", None)
        monkeypatch.setattr(detective, "CASES_PATH", tmp_path / "missing.json")
        assert detective.load_cases() == []

    def test_깨진_JSON이면_빈_목록(self, monkeypatch, tmp_path):
        broken = tmp_path / "broken.json"
        broken.write_text("{not json", encoding="utf-8")
        monkeypatch.setattr(detective, "_cases_cache", None)
        monkeypatch.setattr(detective, "CASES_PATH", broken)
        assert detective.load_cases() == []

    def test_status가_active가_아니면_제외(self, monkeypatch, tmp_path):
        path = tmp_path / "cases.json"
        path.write_text(
            json.dumps([{"case_id": "a", "status": "draft"}, {"case_id": "b", "status": "active"}]),
            encoding="utf-8",
        )
        monkeypatch.setattr(detective, "_cases_cache", None)
        monkeypatch.setattr(detective, "CASES_PATH", path)
        assert [c["case_id"] for c in detective.load_cases()] == ["b"]

    def test_캐시_복구(self, monkeypatch):
        """다른 테스트가 캐시를 흔들어도 본시드로 돌아온다(테스트 순서 독립)."""
        monkeypatch.setattr(detective, "_cases_cache", None)
        assert len(detective.load_cases()) >= 2
