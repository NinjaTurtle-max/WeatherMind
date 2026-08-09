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

DB를 쓰지 않는 라우터라 TestClient + get_current_user 오버라이드만으로 돈다
(test_auth_convert 관례). 실행: `python -m pytest tests/test_detective_router.py -q`
"""
import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
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


@pytest.fixture()
def client():
    user = User(id=uuid.uuid4(), email="detective@test.invalid", level_group="middle_high")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


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

    def test_XP는_적립되지_않는다(self, client, cases):
        """영속이 없어 재제출로 무한 적립되므로 0으로 고정했다(스키마 주석 참조).

        PM이 영속을 붙이기로 판정하면 이 테스트가 그 변경의 수신자가 된다.
        """
        case = cases[0]
        body = self._solve(client, case, case["solution"]["answer_hypothesis_id"]).json()
        assert body["xp_earned"] == 0


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
