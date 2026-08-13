"""구름 에너지 지연 회복·소모 단위 테스트 — 스프린트 R5-01 §3.3.

regen_amount·apply_regen·next_regen_sec·plan_consume는 DB 의존이 없는 순수 함수라
경계(0분·19분·20분·100분·MAX clamp)와 소모·소진(OUT_OF_CLOUDS)·무제한(플래그)을
DB 없이 검증한다.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.services import energy_service as es

NOW = datetime(2026, 7, 21, 12, 0, 0, tzinfo=timezone.utc)


def _ago(minutes: float) -> datetime:
    return NOW - timedelta(minutes=minutes)


class TestRegenAmount:
    def test_0분_경과는_회복_0(self):
        assert es.regen_amount(2, _ago(0), NOW) == 0

    def test_19분_경과는_회복_0(self):
        assert es.regen_amount(2, _ago(19), NOW) == 0

    def test_20분_경과는_회복_1(self):
        assert es.regen_amount(2, _ago(20), NOW) == 1

    def test_100분_경과는_회복_5(self):
        # 100 // 20 = 5. 2+5=7 ≤ MAX(10)이라 clamp가 안 걸린다.
        # ⚠️ MT-7로 만렙이 5 → 10이 되면서 이 값이 3 → 5로 바뀌었다(종전에는
        # clamp에 잘려 3이었다). 아래에 clamp 자체를 보는 케이스를 따로 둔다.
        assert es.regen_amount(2, _ago(100), NOW) == 5

    def test_만렙을_넘겨_회복하지_않는다(self):
        """clamp 경계 — 위 케이스가 만렙 상향으로 clamp를 안 타게 됐다.

        경과 시간을 만렙에서 파생해, 다음에 만렙이 또 바뀌어도 이 검사는 살아 있다.
        """
        long_enough = _ago((es.CLOUD_MAX + 2) * es.CLOUD_REGEN_MINUTES)
        assert es.regen_amount(2, long_enough, NOW) == es.CLOUD_MAX - 2

    def test_MAX면_회복_0(self):
        assert es.regen_amount(es.CLOUD_MAX, _ago(100), NOW) == 0

    def test_기준시각_부재는_회복_0(self):
        assert es.regen_amount(0, None, NOW) == 0

    def test_0에서_100분이면_MAX까지만(self):
        assert es.regen_amount(0, _ago(100), NOW) == 5  # 0+5=MAX


class TestApplyRegen:
    def test_잉여_시간_carry(self):
        # 25분 경과: 1개 회복(20분 소진), updated_at은 20분만 전진 → 5분 잉여 carry
        new_clouds, new_updated = es.apply_regen(2, _ago(25), NOW)
        assert new_clouds == 3
        assert new_updated == _ago(25) + timedelta(minutes=20)  # = 5분 전

    def test_미경과는_updated_at_불변(self):
        new_clouds, new_updated = es.apply_regen(2, _ago(10), NOW)
        assert new_clouds == 2
        assert new_updated == _ago(10)

    def test_MAX_도달시_updated_at_now로(self):
        # 시간을 만렙에서 파생한다 — 100분 리터럴은 만렙 5 시절에만 만렙을 채웠다.
        new_clouds, new_updated = es.apply_regen(
            3, _ago((es.CLOUD_MAX + 2) * es.CLOUD_REGEN_MINUTES), NOW
        )
        assert new_clouds == es.CLOUD_MAX
        assert new_updated == NOW

    def test_기준시각_부재는_now로_확립(self):
        new_clouds, new_updated = es.apply_regen(4, None, NOW)
        assert (new_clouds, new_updated) == (4, NOW)


class TestNextRegenSec:
    def test_MAX면_0(self):
        assert es.next_regen_sec(es.CLOUD_MAX, _ago(0), NOW) == 0

    def test_방금_소모_직후는_20분(self):
        # 5개 만렙에서 방금(0분) → 회복 없음, 다음까지 20분
        assert es.next_regen_sec(0, _ago(0), NOW) == 20 * 60

    def test_5분_경과면_15분_남음(self):
        assert es.next_regen_sec(2, _ago(5), NOW) == 15 * 60

    def test_25분_경과면_1개_회복후_15분_남음(self):
        # 1개 회복 소진 후 5분 잉여 → 다음까지 15분
        assert es.next_regen_sec(2, _ago(25), NOW) == 15 * 60


class TestPlanConsume:
    def test_만렙에서_소모하면_1_감소(self):
        clouds, updated = es.plan_consume(es.CLOUD_MAX, _ago(0), NOW)
        assert clouds == es.CLOUD_MAX - 1

    def test_0이고_미회복이면_OUT_OF_CLOUDS(self):
        with pytest.raises(es.OutOfCloudsError) as ei:
            es.plan_consume(0, _ago(5), NOW)
        assert ei.value.next_regen_sec == 15 * 60

    def test_0이지만_20분_경과면_회복후_소모_가능(self):
        # 회복 1 → 소모 1 → 0
        clouds, _ = es.plan_consume(0, _ago(20), NOW)
        assert clouds == 0

    def test_ENERGY_비활성이면_무제한_무소모(self):
        clouds, updated = es.plan_consume(0, _ago(0), NOW, enabled=False)
        assert clouds == 0  # 소진 상태여도 no-op (429 안 남)
        assert updated == _ago(0)

    def test_소모는_updated_at_불변(self):
        # 5분 경과 상태에서 소모 → 회복 주기 진행분(updated_at) 유지
        _, updated = es.plan_consume(3, _ago(5), NOW)
        assert updated == _ago(5)
