"""R10-01 §3.1(뱅크 중복 방지 단기 완화) 웨이브 0 — 구현 전 "빨간" 계약 테스트.

관찰 보고서 03의 P0: 첫날 세션 9문항 중 4개가 방금 본 배치고사 문항과 동일했다.
근본 해결(뱅크 확장)은 R10-02로 분리됐고, 이번 스프린트의 단기 완화책은
**"오늘 KST 안에 이미 응답한 content_item은 당일 세션 풀에서 제외"** 다
(§5 "배치고사 출제분을 당일 세션 풀에서 제외"의 일반화 — 배치고사만이 아니라
그날 응답한 모든 문항).

new 풀은 이미 **전기간** served 제외가 걸려 있어(session_service.py:339~341)
중복이 나지 않는다. 문제는 review·live 풀 — 두 쿼리에는 served_subq가 전달되지
않아 방금 본 문항이 그대로 다시 뽑힌다. 따라서 계약은 "review·live에도 오늘 응답
제외를 걸고, new는 전기간 제외를 그대로 유지" 다.

웨이브 1에서 session_service에 추가될 API (없으므로 지금은 AttributeError로 실패):

- kst_day_start_utc(day: date) -> datetime          (순수, KST 자정의 UTC 시각)
- answered_today_subq(user_id, day_start_utc)       (실행 없는 SELECT 구성)
- _fetch_pools가 review·live 쿼리에도 위 서브쿼리를 served_subq로 전달

계약 번호는 SA-1 임무 정의의 15~18번을 쓴다. 관례: DB 없이 FakeDB가 캡처한
SELECT의 컴파일 SQL 문자열로 구조를 고정한다(test_unit_pool_theta 방식).
신규 이름은 모듈 최상단에서 import하지 않는다(collection 에러 방지).
"""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import session_service as ss

KST = timezone(timedelta(hours=9))
DAY = date(2026, 8, 1)


# ═══════════════════════════════════════════════════════════════
# 대역 (test_unit_pool_theta.FakeDB 관례)
# ═══════════════════════════════════════════════════════════════


class _FakeResult:
    def scalars(self):
        return self

    def all(self):
        return []


class FakeDB:
    """execute된 stmt를 캡처만 하고 빈 결과 반환 — 쿼리 구성(SQL 구조) 검증용."""

    def __init__(self):
        self.stmts: list = []

    async def execute(self, stmt):
        self.stmts.append(stmt)
        return _FakeResult()


def make_user() -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), level_group="elementary")


def pool_sqls(*, weak_concepts=("typhoon",), theta=None) -> dict[str, str]:
    """_fetch_pools가 실행한 SELECT를 종류별(new/review/live) 컴파일 SQL로 분류.

    실행 순서에 의존하지 않도록 SQL 특징으로 분류한다 —
    live: `uses_live_slots is true` · review: `concept_tag in` · new: 나머지.
    """
    db = FakeDB()
    pools = asyncio.run(
        ss._fetch_pools(db, make_user(), list(weak_concepts), theta)
    )
    assert pools == ([], [], []), "대역은 빈 풀을 반환해야 한다(구성만 검증)"
    sqls = [str(stmt).lower() for stmt in db.stmts]
    live = [s for s in sqls if "uses_live_slots is true" in s or "uses_live_slots is 1" in s]
    review = [s for s in sqls if s not in live and "concept_tag in" in s]
    new = [s for s in sqls if s not in live and s not in review]
    assert len(live) == 1 and len(review) == 1 and len(new) == 1, (
        f"풀 3종 분류 실패 (new={len(new)}, review={len(review)}, live={len(live)}) "
        "— _fetch_pools의 쿼리 구성이 바뀌었다면 이 헬퍼를 갱신할 것"
    )
    return {"new": new[0], "review": review[0], "live": live[0]}


# ═══════════════════════════════════════════════════════════════
# 계약 15 · KST 하루 경계 (순수)
# ═══════════════════════════════════════════════════════════════


class TestKstDayStart:
    """[계약 15] "오늘"은 KST 자정 기준이다 — answered_at(UTC)과 비교할 경계값.

    세션 발급이 이미 `datetime.now(KST).date()`로 하루를 정의하므로
    (session.py:182 · curriculum.py:84) 중복 제외 경계도 같은 기준이어야 한다.
    UTC 자정을 쓰면 KST 00:00~09:00 사이 응답이 "어제"로 새어 중복이 재발한다.
    """

    def test_계약15_KST_자정의_UTC_시각(self):
        assert ss.kst_day_start_utc(DAY) == datetime(
            2026, 7, 31, 15, 0, 0, tzinfo=timezone.utc
        ), "2026-08-01 KST 00:00 = 2026-07-31 15:00Z"

    def test_계약15_어제_2359_KST는_제외_대상_아님(self):
        start = ss.kst_day_start_utc(DAY)
        yesterday_late = datetime(2026, 7, 31, 23, 59, tzinfo=KST)
        assert yesterday_late < start, (
            "어제 23:59 KST 응답이 '오늘 응답'으로 잡히면 어제 본 문항까지 "
            "복습 풀에서 빠져 풀이 고갈된다"
        )

    def test_계약15_오늘_0001_KST는_제외_대상(self):
        start = ss.kst_day_start_utc(DAY)
        today_early = datetime(2026, 8, 1, 0, 1, tzinfo=KST)
        assert today_early >= start, (
            "오늘 00:01 KST 응답이 경계 밖으로 새면 중복 방지가 무력해진다"
        )

    def test_계약15_경계_자정_정각은_포함(self):
        start = ss.kst_day_start_utc(DAY)
        assert datetime(2026, 8, 1, 0, 0, tzinfo=KST) == start

    def test_계약15_tz_aware_반환(self):
        result = ss.kst_day_start_utc(DAY)
        assert result.tzinfo is not None, (
            "naive datetime은 timestamptz 컬럼 비교에서 서버 로컬 해석 위험"
        )
        assert result.utcoffset() == timedelta(0), "UTC로 정규화해 반환할 것"


# ═══════════════════════════════════════════════════════════════
# 계약 15 · 서브쿼리 구성 (실행 없음)
# ═══════════════════════════════════════════════════════════════


class TestAnsweredTodaySubquery:
    """[계약 15] "오늘 응답한 content_item_id" 서브쿼리 구성."""

    def _sql(self) -> str:
        subq = ss.answered_today_subq(uuid.uuid4(), ss.kst_day_start_utc(DAY))
        return str(subq).lower()

    def test_계약15_content_item_id를_선택(self):
        sql = self._sql()
        assert "quiz_logs.content_item_id" in sql and "from quiz_logs" in sql, (
            f"quiz_logs.content_item_id를 뽑는 SELECT가 아니다: {sql}"
        )

    def test_계약15_뱅크_문항만_NULL_제외(self):
        sql = self._sql()
        assert "content_item_id is not null" in sql, (
            "content_item_id IS NULL(생성 문항·보드 로그)이 NOT IN 서브쿼리에 "
            "섞이면 SQL NOT IN이 전건 false가 되어 풀이 통째로 비워진다"
        )

    def test_계약15_유저_스코프와_당일_경계(self):
        sql = self._sql()
        assert "quiz_logs.user_id" in sql, "유저 스코프 없는 제외는 전역 오차단"
        assert "quiz_logs.answered_at >=" in sql, (
            "answered_at >= 당일 시작 조건이 없다 — 전기간 제외가 되어 복습 풀이 "
            "영구 고갈된다(new 풀과 달리 review는 재출제가 목적)"
        )


# ═══════════════════════════════════════════════════════════════
# 계약 16·17·18 · 풀 쿼리 반영
# ═══════════════════════════════════════════════════════════════


class TestPoolDedupWiring:
    def test_계약16_review_풀에_오늘_응답_제외(self):
        """[계약 16] review 쿼리에 NOT IN(오늘 응답) 제외가 포함된다.

        현재 review 풀은 served_subq를 받지 않아(session_service.py:362~376)
        배치고사에서 방금 본 약점 문항이 그대로 재출제된다 — P0의 직접 원인.
        """
        sql = pool_sqls()["review"]
        assert "not in" in sql, (
            "review 풀에 제외 조건이 없다 — 방금 본 문항이 당일 복습으로 재출제된다"
        )
        assert "quiz_logs.answered_at >=" in sql, (
            "review 제외가 '오늘' 경계로 한정되지 않았다 — 전기간 제외는 복습 "
            "자체를 없애는 과도한 차단"
        )

    def test_계약17_live_풀에도_오늘_응답_제외(self):
        """[계약 17] live(실황 슬롯) 쿼리에도 동일 제외가 걸린다."""
        sql = pool_sqls()["live"]
        assert "not in" in sql, (
            "live 풀에 제외 조건이 없다 — 실황 문항 1개가 매 세션 반복 노출된다"
        )
        assert "quiz_logs.answered_at >=" in sql, (
            "live 제외도 '오늘' 경계로 한정할 것(실황 문항은 날마다 값이 바뀌어 "
            "재사용이 정상)"
        )

    def test_계약18_new_풀은_전기간_제외_유지(self):
        """[계약 18] 회귀 — new 풀의 served 제외는 '전기간'이어야 한다.

        신규 문항은 한 번 본 뒤 다시 '신규'가 아니다. 여기에 당일 경계를 붙이면
        어제 본 문항이 오늘 다시 신규로 나온다.
        """
        sql = pool_sqls()["new"]
        assert "not in" in sql, "new 풀의 전기간 served 제외가 사라졌다(회귀)"
        assert "quiz_logs.content_item_id is not null" in sql
        assert "quiz_logs.answered_at >=" not in sql, (
            "new 풀 제외에 당일 경계가 붙었다 — 어제 본 신규 문항이 오늘 다시 "
            "신규로 출제된다"
        )

    def test_계약16_17_18_모든_풀이_유저_스코프(self):
        """제외 서브쿼리는 항상 본인 응답만 본다."""
        for kind, sql in pool_sqls().items():
            if "not in" in sql:
                assert "quiz_logs.user_id" in sql, (
                    f"{kind} 풀의 제외 서브쿼리에 user_id 스코프가 없다"
                )

    @pytest.mark.parametrize("theta", [None, 1.0])
    def test_계약16_17_θ_유무와_무관하게_제외_적용(self, theta):
        """콜드스타트(θ None)와 θ 경로 양쪽 모두에서 중복 방지가 작동한다."""
        sqls = pool_sqls(theta=theta)
        for kind in ("review", "live"):
            assert "quiz_logs.answered_at >=" in sqls[kind], (
                f"θ={theta} 경로의 {kind} 풀에 오늘 응답 제외가 빠졌다"
            )

    def test_계약16_약점_없으면_review_쿼리_없음_회귀(self):
        """weak_concepts가 비면 review 쿼리를 아예 실행하지 않는 현행 유지."""
        db = FakeDB()
        asyncio.run(ss._fetch_pools(db, make_user(), [], None))
        assert len(db.stmts) == 2, (
            f"약점 없을 때 쿼리 수가 2(new·live)가 아니다: {len(db.stmts)}"
        )
