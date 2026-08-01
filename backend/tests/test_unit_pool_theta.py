"""θ→유닛 세션 풀 연결 (R7-02 §3.3) — 쿼리 구성 검증. DB 불필요.

test_theta_difficulty의 패턴을 따른다: FakeDB가 execute된 SELECT를 캡처하고
(해석 없이 빈 결과 반환), 컴파일된 SQL 문자열로 구조를 고정한다.

증명 사슬 (초등 유저 board 풀 0건 → 영구 잠금 하드 블록의 해소):
1. 콜드스타트(θ None)는 현행 완전 불변 — 가입 그룹 단일 + random 정렬.
2. θ가 있으면 pool_level_groups가 가입 그룹 ∪ θ 매핑 그룹으로 풀을 확장하고
   |b−θ| 정렬이 붙는다 — elementary에 board가 0건이어도 middle_high board가
   풀에 들어와 read-sky-board 유닛이 진행 가능해진다.
3. kind별 question_type 필터(board/비board)와 concept_tag 필터는 유지된다.
4. θ 읽기는 load_abilities(read-only) — refresh_abilities·ai-worker 호출 없음.
"""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace

from app.services import curriculum_service as cs
from app.services import weatherbrain_service as wb


class _FakeResult:
    def scalars(self):
        return self

    def all(self):
        return []


class FakeDB:
    """execute된 stmt를 캡처만 하고 빈 결과 반환 — 쿼리 구성(SQL 구조) 검증용."""

    def __init__(self):
        self.stmts = []

    async def execute(self, stmt):
        self.stmts.append(stmt)
        return _FakeResult()


class _FakeUser:
    id = uuid.uuid4()
    level_group = "elementary"


def make_unit(kind="quiz", concept_tag="pressure_front"):
    return SimpleNamespace(kind=kind, concept_tag=concept_tag)


def pool_sql(monkeypatch, *, abilities, unit) -> str:
    """_unit_content_pool이 실행한 SELECT의 컴파일 SQL(소문자)을 돌려준다."""
    calls = {"load": 0, "refresh": 0}

    async def fake_load(db, user):
        calls["load"] += 1
        return abilities

    async def fail_refresh(db, user):  # read-only 경로 가드
        calls["refresh"] += 1
        raise AssertionError("유닛 풀은 refresh_abilities를 호출하면 안 된다")

    monkeypatch.setattr(wb, "load_abilities", fake_load)
    monkeypatch.setattr(wb, "refresh_abilities", fail_refresh)
    db = FakeDB()
    items = asyncio.run(cs._unit_content_pool(db, _FakeUser(), unit))
    assert items == []
    assert calls == {"load": 1, "refresh": 0}
    # 쿼리 2개가 정상이다 — 유닛 풀은 R10-01 D8-5의 **best-effort 2단 조회**다.
    # 1차는 "오늘 이미 응답한 문항" 제외(신선도 우선), 결과가 UNIT_SESSION_SIZE보다
    # 적으면 제외를 뗀 2차로 백필한다. FakeDB는 항상 빈 결과를 돌려주므로 1차가
    # 0건 → 백필이 **항상** 발동해 stmts는 결정적으로 2개다.
    # 하드 제외(1단 조회)로 되돌리면 같은 유닛 당일 재진입 시 0문항 세션이 발급되며,
    # 유닛 세션에는 daily의 quiz-generate 폴백이 없어 복구되지 않는다(반복보다 나쁜 회귀).
    # 이 파일이 지키는 계약(θ 그룹 확장·|b−θ| 정렬·kind별 question_type 필터)은
    # 아래 SQL 텍스트 assert가 검증하며, 1차 조회(stmts[0])에 그대로 걸려 있다.
    assert len(db.stmts) == 2
    return str(db.stmts[0]).lower()


class TestColdStart:
    def test_θ_None이면_현행_불변_단일_그룹_random(self, monkeypatch):
        sql = pool_sql(monkeypatch, abilities=[], unit=make_unit(kind="quiz"))
        assert "item_params" not in sql  # θ 정렬 join 없음
        assert "order by random()" in sql
        assert "content_items.level_group in" in sql
        assert "content_items.concept_tag in" in sql
        assert "uses_live_slots is false" in sql or "uses_live_slots is 0" in sql
        assert "question_type !=" in sql  # quiz 유닛: board 제외

    def test_콜드스타트_board_유닛은_board_유형만(self, monkeypatch):
        sql = pool_sql(monkeypatch, abilities=[], unit=make_unit(kind="board"))
        assert "question_type =" in sql
        assert "question_type !=" not in sql
        assert "order by random()" in sql


class TestThetaExpansion:
    # 초등 가입 + concept θ=1.0 (n>0) → 풀 그룹이 elementary ∪ adult 로 확장
    ABILITIES = [
        {"concept_tag": "pressure_front", "theta": 1.0, "se": 0.4, "n": 4},
    ]

    def test_θ가_있으면_그룹_확장과_거리_정렬(self, monkeypatch):
        sql = pool_sql(
            monkeypatch, abilities=self.ABILITIES, unit=make_unit(kind="quiz")
        )
        assert "left outer join item_params" in sql
        assert "order by abs(coalesce(item_params.b, case" in sql
        # pool_level_groups("elementary", 1.0) == ["adult", "elementary"] → IN 2개
        params = cs.session_service.pool_level_groups("elementary", 1.0)
        assert params == ["adult", "elementary"]

    def test_board_유닛_하드_블록_해소_경로(self, monkeypatch):
        """초등 board 0건이어도 θ 확장 그룹의 board 문항이 풀에 들어온다."""
        abilities = [
            {"concept_tag": "pressure_front", "theta": 0.0, "se": 0.4, "n": 3},
        ]
        sql = pool_sql(
            monkeypatch, abilities=abilities, unit=make_unit(kind="board")
        )
        assert "left outer join item_params" in sql  # θ 경로 활성
        assert "question_type =" in sql  # board 필터 유지
        # θ=0.0 → middle_high — 시드상 board 10건이 있는 그룹이 풀에 합류
        assert cs.session_service.pool_level_groups("elementary", 0.0) == [
            "elementary",
            "middle_high",
        ]

    def test_다른_개념의_θ만_있으면_가중_평균으로_동작(self, monkeypatch):
        """unit.concept_tag θ가 없어도 overall_theta 폴백(가중 평균)으로 θ 경로."""
        abilities = [
            {"concept_tag": "typhoon", "theta": 1.0, "se": 0.4, "n": 2},
        ]
        sql = pool_sql(
            monkeypatch, abilities=abilities, unit=make_unit(kind="quiz")
        )
        assert "left outer join item_params" in sql
