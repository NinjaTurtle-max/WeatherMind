"""분반 리더보드 계약 테스트 — 스프린트 R13-01 §2.8 (BE-2).

설계: 전역 순위를 DIVISION_SIZE(기본 30)명씩 연속 블록으로 잘라 분반을 만들고,
내 분반 안에서의 지역 순위와 바로 위·아래와의 점수 격차를 돌려준다.
친구·팔로우 모델은 신설하지 않는다(§2.8 범위 밖).

build_division_view는 DB 의존이 없는 순수 함수라 여기서 DB 없이 검증한다
(placement_service의 순수/결합 분리 관례).

실행: backend 디렉토리에서 `python -m pytest tests/test_league_division.py -q`.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.core.config import Settings
from app.services import league_service as ls


def _ranked(n: int, *, scored: bool = True) -> list[dict]:
    """전역 순위 오름차순 n명 — 1등 100점, 이후 1점씩 하락(결정적)."""
    return [
        {
            "user_id": uuid.UUID(int=i),
            "nickname": f"u{i}",
            "accuracy_score": Decimal(100 - i) if scored else None,
            "elo_rating": 1200 - i if scored else None,
            "tier": "cumulus" if scored else None,
        }
        for i in range(n)
    ]


class TestDivisionConstants:
    def test_기본값은_계약_수치(self):
        """env 미설정 기본값 = 계약 수치(30인·이웃 3) — PLACEMENT_SIZE 전례."""
        assert Settings.model_fields["LEAGUE_DIVISION_SIZE"].default == 30
        assert Settings.model_fields["LEAGUE_NEIGHBOR_SPAN"].default == 3
        assert ls.DIVISION_SIZE == 30
        assert ls.NEIGHBOR_SPAN == 3


class TestDivisionIndex:
    @pytest.mark.parametrize(
        ("rank", "index"),
        [(1, 0), (30, 0), (31, 1), (60, 1), (61, 2), (300, 9)],
    )
    def test_순위가_30인_블록으로_나뉜다(self, rank, index):
        assert ls.division_index_of(rank) == index

    @pytest.mark.parametrize(
        ("total", "count"),
        [(0, 1), (1, 1), (30, 1), (31, 2), (60, 2), (61, 3)],
    )
    def test_분반_개수(self, total, count):
        assert ls.division_count_of(total) == count


class TestDivisionSplit:
    def test_30인_이하는_분할되지_않는다(self):
        rows = _ranked(30)
        view = ls.build_division_view(rows, rows[0]["user_id"])
        assert view["division_count"] == 1
        assert view["division_index"] == 0
        assert view["division_member_count"] == 30
        assert view["total_participants"] == 30

    def test_31인이면_두_분반으로_쪼개진다(self):
        rows = _ranked(31)
        first = ls.build_division_view(rows, rows[0]["user_id"])
        last = ls.build_division_view(rows, rows[30]["user_id"])
        assert first["division_count"] == last["division_count"] == 2
        assert first["division_index"] == 0
        assert first["division_member_count"] == 30
        # 31등은 2번 분반의 1등 — 분반 리더보드의 존재 이유(작은 못의 큰 물고기)
        assert last["division_index"] == 1
        assert last["division_member_count"] == 1
        assert last["my_rank"] == 1
        assert last["my_global_rank"] == 31

    def test_경계_직전_직후_소속(self):
        rows = _ranked(61)
        assert ls.build_division_view(rows, rows[29]["user_id"])["division_index"] == 0
        assert ls.build_division_view(rows, rows[30]["user_id"])["division_index"] == 1
        assert ls.build_division_view(rows, rows[59]["user_id"])["division_index"] == 1
        assert ls.build_division_view(rows, rows[60]["user_id"])["division_index"] == 2

    def test_지역_순위와_전역_순위가_분리된다(self):
        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[64]["user_id"])
        assert view["my_global_rank"] == 65
        assert view["my_rank"] == 5  # 3번 분반(61~90)의 5등
        me = [e for e in view["entries"] if e["is_me"]]
        assert len(me) == 1
        assert me[0]["rank"] == 5 and me[0]["global_rank"] == 65

    def test_분할_크기는_인자로_조정된다(self):
        rows = _ranked(10)
        view = ls.build_division_view(rows, rows[7]["user_id"], size=4)
        assert view["division_size"] == 4
        assert view["division_count"] == 3
        assert view["division_index"] == 1  # 8등 → 2번째 블록(5~8)
        assert view["my_rank"] == 4


class TestNeighborWindow:
    def test_위아래_각_3명과_나(self):
        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[64]["user_id"])
        assert len(view["entries"]) == 7
        assert [e["global_rank"] for e in view["entries"]] == list(range(62, 69))

    def test_창은_분반을_넘지_않는다(self):
        """분반 1등은 위쪽 이웃이 없다 — 반대쪽으로 늘려 채우지 않는다."""
        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[30]["user_id"])  # 2번 분반 1등
        assert view["my_rank"] == 1
        assert [e["global_rank"] for e in view["entries"]] == [31, 32, 33, 34]
        assert view["entries"][0]["is_me"] is True

    def test_분반_꼴찌는_아래쪽_이웃이_없다(self):
        rows = _ranked(60)
        view = ls.build_division_view(rows, rows[29]["user_id"])  # 1번 분반 꼴찌
        assert view["my_rank"] == 30
        assert [e["global_rank"] for e in view["entries"]] == [27, 28, 29, 30]

    def test_이웃_수는_인자로_조정된다(self):
        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[64]["user_id"], span=1)
        assert [e["global_rank"] for e in view["entries"]] == [64, 65, 66]

    def test_span_0이면_나만(self):
        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[64]["user_id"], span=0)
        assert len(view["entries"]) == 1
        assert view["entries"][0]["is_me"] is True


class TestNeighborGap:
    def test_바로_위_아래와의_격차(self):
        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[64]["user_id"])
        # 64등 36점 · 65등 35점 · 66등 34점 → 위 1점, 아래 1점
        assert view["gap_above"] == Decimal(1)
        assert view["gap_below"] == Decimal(1)

    def test_격차는_등수가_아니라_점수차다(self):
        rows = _ranked(5)
        rows[1]["accuracy_score"] = Decimal("90.50")
        rows[2]["accuracy_score"] = Decimal("60.25")
        view = ls.build_division_view(rows, rows[2]["user_id"])
        assert view["gap_above"] == Decimal("30.25")

    def test_분반_1등은_위쪽_격차가_없다(self):
        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[30]["user_id"])
        assert view["gap_above"] is None
        assert view["gap_below"] == Decimal(1)

    def test_분반_꼴찌는_아래쪽_격차가_없다(self):
        rows = _ranked(60)
        view = ls.build_division_view(rows, rows[29]["user_id"])
        assert view["gap_below"] is None

    def test_미정산이면_격차는_null(self):
        """accuracy_score가 아직 NULL(주간 정산 전)이면 격차를 지어내지 않는다."""
        rows = _ranked(10, scored=False)
        view = ls.build_division_view(rows, rows[5]["user_id"])
        assert view["gap_above"] is None and view["gap_below"] is None
        assert view["my_rank"] == 6  # 순위 자체는 나온다


class TestNonParticipant:
    def test_미참가자는_0번_분반_상단_미리보기(self):
        rows = _ranked(100)
        view = ls.build_division_view(rows, uuid.UUID(int=9999))
        assert view["my_rank"] is None
        assert view["my_global_rank"] is None
        assert view["gap_above"] is None and view["gap_below"] is None
        assert view["division_index"] == 0
        assert [e["global_rank"] for e in view["entries"]] == [1, 2, 3, 4, 5, 6, 7]
        assert all(e["is_me"] is False for e in view["entries"])

    def test_참가자_0명(self):
        view = ls.build_division_view([], uuid.UUID(int=1))
        assert view["entries"] == []
        assert view["total_participants"] == 0
        assert view["division_count"] == 1
        assert view["my_rank"] is None


class TestDivisionApiShape:
    """FE-3 전달 계약 — 응답 스키마 필드가 실제로 채워지는지."""

    def test_뷰가_스키마_필드를_모두_채운다(self):
        from app.schemas.league import LeagueDivision

        rows = _ranked(100)
        view = ls.build_division_view(rows, rows[64]["user_id"])
        model = LeagueDivision(
            week_start="2026-08-03",
            **{
                **view,
                "entries": [
                    {k: v for k, v in e.items() if k != "user_id"}
                    for e in view["entries"]
                ],
            },
        )
        assert model.my_rank == 5
        assert len(model.entries) == 7
        assert model.entries[3].is_me is True
        assert model.entries[3].rank == 5

    def test_라우터에_division_경로가_등록됐다(self):
        from app.routers.league import router

        paths = {r.path for r in router.routes}
        assert "/api/v1/league/division" in paths

    def test_닉네임만_노출하고_user_id는_새지_않는다(self):
        """리더보드는 전체 유저 집계라 RLS 밖이다 — 식별자 노출을 스키마로 막는다."""
        from app.schemas.league import DivisionRank

        assert "user_id" not in DivisionRank.model_fields
