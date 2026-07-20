"""스트릭 프리즈(R2-01 §3.5) + 07번 스트릭 공식 단위 테스트.

update_streak은 User 인스턴스의 속성만 갱신하는 순수 로직이라 DB 없이 검증한다.
"""
from datetime import date, timedelta

from app.models.user import User
from app.services import xp_service

TODAY = date(2026, 7, 19)


def make_user(
    streak: int = 0, freeze: int = 0, last_login: date | None = None
) -> User:
    return User(
        streak_count=streak,
        streak_freeze_count=freeze,
        last_login_date=last_login,
    )


class TestStreakBasic:
    def test_어제_출석이면_연속(self):
        user = make_user(streak=3, last_login=TODAY - timedelta(days=1))
        streak, milestone, freeze_used = xp_service.update_streak(user, TODAY)
        assert streak == 4
        assert milestone is False
        assert freeze_used is False

    def test_같은_날_재출석은_변화_없음(self):
        user = make_user(streak=3, freeze=1, last_login=TODAY)
        streak, milestone, freeze_used = xp_service.update_streak(user, TODAY)
        assert (streak, milestone, freeze_used) == (3, False, False)
        assert user.streak_freeze_count == 1

    def test_첫_출석은_1(self):
        user = make_user(streak=0, last_login=None)
        streak, _, _ = xp_service.update_streak(user, TODAY)
        assert streak == 1


class TestStreakFreeze:
    def test_그제_출석_프리즈_보유시_소모하고_연속_유지(self):
        user = make_user(streak=5, freeze=2, last_login=TODAY - timedelta(days=2))
        streak, _, freeze_used = xp_service.update_streak(user, TODAY)
        assert streak == 6
        assert freeze_used is True
        assert user.streak_freeze_count == 1

    def test_그제_출석_프리즈_없으면_리셋(self):
        user = make_user(streak=5, freeze=0, last_login=TODAY - timedelta(days=2))
        streak, _, freeze_used = xp_service.update_streak(user, TODAY)
        assert streak == 1
        assert freeze_used is False

    def test_사흘_결손은_프리즈_보유해도_리셋(self):
        user = make_user(streak=10, freeze=2, last_login=TODAY - timedelta(days=3))
        streak, _, freeze_used = xp_service.update_streak(user, TODAY)
        assert streak == 1
        assert freeze_used is False
        assert user.streak_freeze_count == 2  # 소모 없음


class TestFreezeGrant:
    def test_7일_마일스톤_달성시_프리즈_1_지급(self):
        user = make_user(streak=6, freeze=0, last_login=TODAY - timedelta(days=1))
        streak, milestone, _ = xp_service.update_streak(user, TODAY)
        assert streak == 7
        assert milestone is True  # +50 XP 대상 (07번)
        assert user.streak_freeze_count == 1

    def test_최대_보유_2_초과_지급_안함(self):
        user = make_user(streak=6, freeze=2, last_login=TODAY - timedelta(days=1))
        streak, milestone, _ = xp_service.update_streak(user, TODAY)
        assert streak == 7
        assert milestone is True
        assert user.streak_freeze_count == xp_service.MAX_STREAK_FREEZE

    def test_프리즈로_유지하며_7일_달성시에도_지급(self):
        # 그제 출석(프리즈 소모) + 그 결과 7일 도달 → 소모 1, 지급 1로 상쇄
        user = make_user(streak=6, freeze=1, last_login=TODAY - timedelta(days=2))
        streak, milestone, freeze_used = xp_service.update_streak(user, TODAY)
        assert streak == 7
        assert milestone is True
        assert freeze_used is True
        assert user.streak_freeze_count == 1

    def test_30일_마일스톤은_XP만_프리즈_지급_없음(self):
        user = make_user(streak=29, freeze=0, last_login=TODAY - timedelta(days=1))
        streak, milestone, _ = xp_service.update_streak(user, TODAY)
        assert streak == 30
        assert milestone is True
        assert user.streak_freeze_count == 0  # §3.5는 7일 마일스톤만 지급
