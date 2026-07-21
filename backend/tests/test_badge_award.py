"""배지 지급 규칙 계약 테스트 — 스프린트 R4-01 §3.3 (R4-S3).

지급 판정의 순수 함수(streak_badge_code·is_perfect_session)를 고정한다.
실제 중복 방지는 user_badges UNIQUE + ON CONFLICT DO NOTHING(멱등 지급)이 담당하며,
여기서는 마일스톤→배지 매핑과 무오답 판정을 검증한다.
"""
from app.services import badge_service
from app.services.badge_service import is_perfect_session, streak_badge_code
from app.services.xp_service import STREAK_MILESTONES


class TestStreakBadgeCode:
    def test_마일스톤_매핑(self):
        assert streak_badge_code(7) == "streak_7"
        assert streak_badge_code(30) == "streak_30"
        assert streak_badge_code(100) == "streak_100"

    def test_마일스톤_아니면_None(self):
        for streak in (1, 6, 8, 29, 31, 99, 101):
            assert streak_badge_code(streak) is None

    def test_xp_service_마일스톤과_1대1(self):
        """streak 배지 매핑 키가 xp_service.STREAK_MILESTONES와 정확히 일치."""
        assert set(badge_service.STREAK_BADGE_BY_MILESTONE) == set(STREAK_MILESTONES)


class TestIsPerfectSession:
    def test_전문항_정답이면_True(self):
        assert is_perfect_session(5, 5) is True

    def test_한문항_틀리면_False(self):
        assert is_perfect_session(4, 5) is False

    def test_빈_세션은_완벽_아님(self):
        assert is_perfect_session(0, 0) is False


class TestBadgeCodes:
    def test_정의_5종_코드_고정(self):
        assert {
            badge_service.BADGE_STREAK_7,
            badge_service.BADGE_STREAK_30,
            badge_service.BADGE_STREAK_100,
            badge_service.BADGE_PERFECT_SESSION,
            badge_service.BADGE_TIER_PROMOTED,
        } == {
            "streak_7", "streak_30", "streak_100",
            "perfect_session", "tier_promoted",
        }
