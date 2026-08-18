"""현상 판정 + 보드 매칭 계약 테스트 — SPRINT_R13_02 §T3 ⑴·⑵.

클라이언트가 「오늘 날씨 반영 보드」라고 부른 기능의 판정 층을 고정한다. §T3의
완료 판정 두 줄이 이 파일의 계약이다:

  「현상 판정 함수 — 순수 함수」        → TestPurity · TestLadder
  「보드 매칭 — 9종 어휘 전건 매칭 가능」 → TestMatch9 (합성) · TestSeedCoverage (실시드)

**어휘의 소유자는 `database/seed/board_rules.json`이다.** 모듈 상수
`PHENOMENA`는 순수성(파일 I/O 금지) 때문에 값을 복제하고 있고, 그 복제가
드리프트하면 「보드가 없는 현상」이 생겨 board 자리가 조용히 폴백으로 샌다 —
`TestVocabulary`가 시드 JSON을 읽어 그것을 CI 실패로 전환한다(`test_kma_contract`·
`test_ci_workflow_contract`와 같은 저장소 관례: 파이썬 밖 파일을 파싱해 대조).

backend↔celery 교차 컨텍스트 계약은 `test_phenomenon_celery_contract.py`가 소유한다.

DB·네트워크 불필요. 실행: backend에서 `python -m pytest tests/test_weather_phenomenon.py -q`.
"""
import copy
import json
from pathlib import Path

import pytest

from app.services import weather_phenomenon as wp

SEED_DIR = Path(__file__).resolve().parents[2] / "database" / "seed"


def _seed(name: str):
    return json.loads((SEED_DIR / name).read_text(encoding="utf-8"))


# ═══════════════════════════════════════════════════════════════
# 대역 — KMA 단기예보 dict (backend·celery가 같은 모양을 만든다)
# ═══════════════════════════════════════════════════════════════


def hour(**categories):
    """예보 1시간대. 카테고리 키는 KMA 원문 그대로(TMP·POP·SKY·REH·WSD·PTY…)."""
    return {"datetime": "202608120900", **categories}


def wx(*hours, region="서울"):
    return {"region": region, "forecasts": list(hours)}


# ═══════════════════════════════════════════════════════════════
# 어휘 계약 — board_rules.json이 소유한다
# ═══════════════════════════════════════════════════════════════


class TestVocabulary:
    def test_어휘는_board_rules의_현상_집합과_같다(self):
        rules = _seed("board_rules.json")
        from_rules = {r["then"]["phenomenon"] for r in rules}
        assert set(wp.PHENOMENA) == from_rules, (
            "현상 어휘의 소유자는 board_rules.json이다 — 여기서 어휘를 새로 만들면 "
            "그 현상을 목표로 하는 보드가 없어 board 자리가 폴백으로 샌다"
        )

    def test_어휘_개수(self):
        """§T3 완료 판정이 「9종 어휘 전건」이라 개수 자체가 계약이었다.

        🔴 **2026-08-18에 두 수로 갈렸다.** ㉣의 경보급 3종은 `board_rules`의 거울에는
        속하지만 **실황 판정으로는 도달할 수 없다**(조건 4개 동시 성립을 실황
        카테고리로 알 수 없다). 그래서 사문 판정의 대상은 `CLASSIFIABLE`이고,
        **T3가 말한 9종은 그쪽**이다.
        """
        assert len(wp.PHENOMENA) == len(set(wp.PHENOMENA)) == 12
        assert len(wp.CLASSIFIABLE) == 9, "T3 완료 판정의 9종은 실황 도달 집합이다"
        assert set(wp.BOARD_ONLY_PHENOMENA) < set(wp.PHENOMENA)

    def test_cloudy는_어휘가_아니다(self):
        """board_engine의 무성립 기본값이지 board_rules가 목표로 삼는 어휘가 아니다."""
        from app.services import board_engine

        assert board_engine.DEFAULT_OUTCOME["phenomenon"] == "cloudy"
        assert "cloudy" not in wp.PHENOMENA

    def test_판정_결과는_항상_어휘_안이거나_None(self):
        cases = [
            wx(), wx(hour()), wx(hour(TMP=20, POP=50, SKY=3, REH=70, WSD=3)),
            wx(hour(PTY=9, POP=100)),           # 미지의 PTY 코드
            {}, {"forecasts": None}, {"forecasts": [None, "쓰레기", 3]},
        ]
        for case in cases:
            assert wp.classify_phenomenon(case) in (*wp.PHENOMENA, None)


# ═══════════════════════════════════════════════════════════════
# 순수 함수 계약 — 결정적 · 입력 불변 · 외부 의존 없음
# ═══════════════════════════════════════════════════════════════


class TestPurity:
    SAMPLE = wx(
        hour(TMX=31.0, TMP=29.0, POP=70, SKY=4, REH=88, WSD=8.0, PTY=1),
        hour(TMP=27.0, POP=80, SKY=4, REH=90, WSD=7.5, PTY=1),
    )

    def test_같은_입력은_항상_같은_판정(self):
        """결정성 — 흔들리면 같은 날 두 번 발급한 세션이 다른 보드를 낸다."""
        first = wp.classify_phenomenon(self.SAMPLE)
        assert all(wp.classify_phenomenon(self.SAMPLE) == first for _ in range(20))

    def test_입력을_변형하지_않는다(self):
        before = copy.deepcopy(self.SAMPLE)
        wp.classify_phenomenon(self.SAMPLE)
        wp.summarize(self.SAMPLE)
        assert self.SAMPLE == before

    def test_요약_신호는_결측을_None으로_돌려준다(self):
        """어느 신호가 비어서 판정이 None인지 보이는 것이 운영의 절반이다."""
        empty = wp.summarize(wx())
        assert empty["temp_max"] is None and empty["rain_prob"] is None
        assert empty["humidity_max"] is None and empty["wind_max"] is None
        assert empty["sky"] is None and empty["pty"] == set()

    def test_문자열_값은_숫자_신호에서_무시된다(self):
        """PCP·PTY가 '강수없음' 같은 문자열로 오는 경로의 방어."""
        signals = wp.summarize(wx(hour(TMP="강수없음", POP="없음", SKY=1)))
        assert signals["temp_max"] is None and signals["rain_prob"] is None
        assert signals["sky"] == 1


# ═══════════════════════════════════════════════════════════════
# 판정 사다리 — 순서 자체가 계약이다
# ═══════════════════════════════════════════════════════════════


class TestLadder:
    @pytest.mark.parametrize(
        ("label", "weather", "expected"),
        [
            # 1. 눈 — PTY 눈 계열이 최우선
            ("PTY 눈", wx(hour(PTY=3, POP=80, TMP=-1)), "snow"),
            ("PTY 비/눈", wx(hour(PTY=2, POP=70, TMP=0)), "snow"),
            ("영하 + 강수확률", wx(hour(TMX=-2.0, POP=80)), "snow"),
            # 2·3. 재난 축
            (
                "포화 + 강풍 + 강수",
                wx(hour(REH=92, WSD=9.0, POP=90, TMP=22, PTY=1)),
                "flood_risk",
            ),
            (
                "건조 + 강풍 + 무강수",
                wx(hour(REH=25, WSD=9.0, POP=0, TMP=18, SKY=1)),
                "wildfire_risk",
            ),
            # 4. 폭염
            ("최고 34도 · 비 없음", wx(hour(TMX=34.0, POP=10, SKY=1)), "heatwave"),
            # 5. 강수
            ("PTY 소나기", wx(hour(PTY=4, POP=60, TMP=30)), "shower"),
            ("PTY 비 · 한때", wx(hour(PTY=1, POP=65, TMP=20)), "rain"),
            # 6·7. 무강수 축
            ("포화 · 비 없음", wx(hour(REH=95, POP=10, SKY=4, TMP=15)), "fog"),
            ("맑음 · 비 없음", wx(hour(SKY=1, POP=0, REH=50, TMP=20)), "clear"),
        ],
    )
    def test_사다리_대표값(self, label, weather, expected):
        assert wp.classify_phenomenon(weather) == expected, label

    @pytest.mark.parametrize(
        ("label", "weather", "expected"),
        [
            # 🔴 결함 원형 — POP은 낮은데 기상청이 PTY로 강수를 직접 알려준 날.
            (
                "34도 · POP 40 · PTY 4(소나기)",
                wx(hour(TMX=34.0, POP=40, PTY=4, TMP=34)),
                "shower",
            ),
            (
                "35도 · POP 30 · PTY 1(비)",
                wx(hour(TMX=35.0, POP=30, PTY=1, TMP=35)),
                "rain",
            ),
            # 경계 — PTY 0(강수 없음)은 종전과 같이 폭염이다.
            ("34도 · POP 40 · PTY 0", wx(hour(TMX=34.0, POP=40, PTY=0, TMP=34)), "heatwave"),
            # 경계 — PTY 결측(관측 없음)도 종전과 같이 POP만으로 판정한다.
            ("34도 · POP 40 · PTY 없음", wx(hour(TMX=34.0, POP=40, TMP=34)), "heatwave"),
        ],
    )
    def test_폭염은_예보된_강수를_덮지_않는다(self, label, weather, expected):
        """🔴 **4번 계단이 5번 계단의 1순위 신호를 무시하고 있었다.**

        사다리는 강수를 "PTY가 1순위, 결측이면 POP 폴백"으로 판정한다고 적어
        놓고, 그 **위** 계단인 폭염은 `wet`(POP)만 보고 `pty`를 안 읽었다.
        그래서 `TMX 34 · POP 40 · PTY 4`처럼 **기상청이 소나기를 직접 알려준
        날**에 `heatwave`가 나갔다 — 확률이 관측을 덮은 셈이고, 그날의 보드가
        소나기 대신 폭염으로 배정됐다.

        경계 두 개를 함께 문다: `PTY 0`(강수 없음을 **명시**)과 PTY 결측은
        종전 그대로 폭염이어야 한다 — 안 그러면 이 수정이 폭염 자체를 죽인다.
        """
        assert wp.classify_phenomenon(weather) == expected, label

    def test_지속형_비는_젖은_시간대_비율로_가른다(self):
        """장마(persistent_rain) vs 한때 비(rain) — 하루치 예보로 쓸 수 있는 유일한 신호."""
        long_rain = wx(*[hour(PTY=1, POP=90, TMP=22) for _ in range(6)])
        assert wp.classify_phenomenon(long_rain) == "persistent_rain"

        brief = wx(
            hour(PTY=1, POP=80, TMP=22),
            *[hour(PTY=1, POP=20, TMP=22) for _ in range(5)],
        )
        assert wp.classify_phenomenon(brief) == "rain"

    def test_눈이_침수보다_먼저다(self):
        """겨울 강풍·강수 날에 침수 보드가 나가면 안 된다 — 사다리 1위가 눈인 이유."""
        winter_storm = wx(hour(PTY=3, POP=90, REH=95, WSD=12.0, TMP=-3))
        assert wp.classify_phenomenon(winter_storm) == "snow"

    def test_비_오는_33도는_폭염이_아니다(self):
        """그날의 「오늘의 날씨」로 인식되는 것은 강수 쪽이다."""
        hot_and_wet = wx(hour(TMX=34.0, POP=80, TMP=30, REH=70))
        assert wp.classify_phenomenon(hot_and_wet) == "shower"

    def test_재난은_습도_풍속이_둘_다_있어야_판정한다(self):
        """한쪽이 결측이면 재난으로 넘기지 않는다 — 없는 근거로 재난을 부르지 않는다."""
        no_wind = wx(hour(REH=95, POP=90, TMP=20, PTY=1))
        assert wp.classify_phenomenon(no_wind) != "flood_risk"
        no_humidity = wx(hour(WSD=10.0, POP=0, TMP=18, SKY=1))
        assert wp.classify_phenomenon(no_humidity) != "wildfire_risk"

    @pytest.mark.parametrize(
        ("label", "weather"),
        [
            ("실황 캐시 없음", {}),
            ("예보 배열 빔", wx()),
            ("흐리지만 비는 없는 평범한 날", wx(hour(SKY=4, POP=10, REH=60, TMP=22))),
            ("구름많음", wx(hour(SKY=3, POP=20, REH=65, TMP=24))),
        ],
    )
    def test_판정_불가는_None이다(self, label, weather):
        """None은 「보드 없음」이 아니라 「board_order 순」이라는 뜻이다(§T3)."""
        assert wp.classify_phenomenon(weather) is None, label

    def test_실황_도달_집합_전건이_도달_가능하다(self):
        """어휘에 있는데 어떤 입력으로도 안 나오는 현상 = 사문(死文) 판정.

        ⚠️ 대상은 `CLASSIFIABLE`이다 — 보드 전용 3종(경보급)은 **실황이 만들 수 없는
        것이 정상**이고, 그것까지 요구하면 만들 수 없는 것을 만들라는 계약이 된다.
        그 셋이 실황에서 **안 나온다는 사실 자체**는 아래 별도 단정이 문다.
        """
        reachable = {
            wp.classify_phenomenon(w)
            for w in [
                wx(hour(PTY=3, POP=80)),
                wx(hour(REH=92, WSD=9.0, POP=90, TMP=22)),
                wx(hour(REH=25, WSD=9.0, POP=0, TMP=18, SKY=1)),
                wx(hour(TMX=34.0, POP=10, SKY=1)),
                wx(hour(PTY=4, POP=60, TMP=30)),
                wx(hour(PTY=1, POP=65, TMP=20)),
                wx(*[hour(PTY=1, POP=90, TMP=22) for _ in range(6)]),
                wx(hour(REH=95, POP=10, SKY=4, TMP=15)),
                wx(hour(SKY=1, POP=0, REH=50, TMP=20)),
            ]
        }
        assert reachable == set(wp.CLASSIFIABLE)

    def test_보드_전용_현상은_실황에서_안_나온다(self):
        """경보급 3종이 실황 판정으로 새면 **보드에서만 만들 수 있다는 전제**가 깨진다.

        그러면 브리핑·실황 문항이 「산불 경보급」을 말하면서 그 근거(기단·전선 조합)를
        보여줄 수 없게 된다. 도달성의 **반대 방향** 계약이다.
        """
        inputs = [
            wx(hour(PTY=3, POP=80)),
            wx(hour(REH=25, WSD=12.0, POP=0, TMP=30, SKY=1)),   # 건조·강풍·맑음
            wx(*[hour(PTY=1, POP=95, TMP=22, REH=98) for _ in range(6)]),  # 지속 강수
            wx(hour(TMX=36.0, POP=0, SKY=1)),
        ]
        produced = {wp.classify_phenomenon(w) for w in inputs}
        leaked = produced & set(wp.BOARD_ONLY_PHENOMENA)
        assert not leaked, f"실황 판정이 보드 전용 현상을 냈다: {leaked}"


# ═══════════════════════════════════════════════════════════════
# 보드 매칭 — 합성 문항 (9종 전건 + board_order 폴백)
# ═══════════════════════════════════════════════════════════════


def board_item(item_id, *, phenomenon=None, order=None, kl=None):
    """board 문항 대역 — 매칭이 읽는 필드만 갖춘다.

    ⚠️ `knowledge_level`은 **컬럼**이라 template_json 밖에 있다(난이도 축).
    """
    template = {"question_text": item_id}
    if phenomenon is not None:
        template["goal_conditions"] = [{"zone": 1, "phenomenon": phenomenon}]
    if order is not None:
        template["board_order"] = order
    return {
        "id": item_id,
        "question_type": "board",
        "template_json": template,
        "knowledge_level": kl,
    }


class TestMatch9:
    """§T3 완료 판정 「9종 어휘 전건 매칭 가능」."""

    @pytest.fixture()
    def pool(self):
        # 현상별 1건 + 현상 없는 잡음 2건. board_order는 역순으로 매겨
        # "board_order가 낮아서 뽑힌 것"과 "현상이 맞아서 뽑힌 것"을 구분한다.
        items = [
            board_item(p, phenomenon=p, order=90 - i)
            for i, p in enumerate(wp.PHENOMENA)
        ]
        items += [board_item("filler-1", order=1), board_item("filler-2", order=2)]
        return items

    @pytest.mark.parametrize("phenomenon", wp.PHENOMENA)
    def test_9종_전건이_자기_보드로_매칭된다(self, pool, phenomenon):
        picked = wp.match_board(pool, phenomenon)
        assert phenomenon in wp.goal_phenomena(picked), (
            f"{phenomenon}: board_order가 더 낮은 후보가 있어도 "
            "현상 일치가 우선해야 한다"
        )

    def test_현상에_맞는_보드가_없으면_board_order_폴백(self, pool):
        """「없으면 board_order」 — 여기서 매칭이 실패가 아니라 열화가 된다."""
        without_snow = [i for i in pool if "snow" not in wp.goal_phenomena(i)]
        picked = wp.match_board(without_snow, "snow")
        assert picked["id"] == "filler-1"
        assert wp.board_order(picked) == 1

    def test_판정이_None이면_board_order_순(self, pool):
        assert wp.match_board(pool, None)["id"] == "filler-1"

    def test_후보가_없으면_None(self):
        assert wp.match_board([], "snow") is None
        assert wp.order_boards_for_today([], "snow") == []

    def test_버리지_않고_정렬만_한다(self, pool):
        """걸러 버리면 중복·상한으로 첫 후보를 못 쓸 때 배합이 비고 유료 생성으로 샌다."""
        ordered = wp.order_boards_for_today(pool, "snow")
        assert len(ordered) == len(pool)
        assert {id(i) for i in ordered} == {id(i) for i in pool}

    def test_board_order_결측은_맨_뒤로(self):
        """저작 누락이 앞줄을 차지하면 난이도 진행 계약이 깨진다."""
        items = [board_item("no-order"), board_item("has-order", order=7)]
        assert [i["id"] for i in wp.order_boards_for_today(items, None)] == [
            "has-order", "no-order",
        ]

    def test_정렬은_결정적이다(self, pool):
        first = [i["id"] for i in wp.order_boards_for_today(pool, "fog")]
        for _ in range(10):
            assert [i["id"] for i in wp.order_boards_for_today(pool, "fog")] == first

    def test_ORM_행처럼_속성으로_와도_읽는다(self):
        """실행 시 입력은 dict가 아니라 ContentItem 행이다."""
        from types import SimpleNamespace

        row = SimpleNamespace(
            id="orm",
            template_json={
                "goal_conditions": [{"phenomenon": "fog"}], "board_order": 3,
            },
        )
        assert wp.goal_phenomena(row) == {"fog"}
        assert wp.board_order(row) == 3
        assert wp.match_board([row], "fog") is row


class TestTargetLevel:
    """단계 근접 축 — **밴드 필터가 사라진 뒤 보드의 유일한 난이도 방벽**.

    출제 축이 `knowledge_level` 단독으로 단일화되며(담당 I) 밴드 필터가 빠졌고,
    그 순간 kl 1 학습자의 보드가 `rain 1→4 · fog 2→4 · snow 2→4`로 밀렸다.
    하루 1문항이지만 초등 동선의 **유일한** 보드라 그 1건이 전부다.

    우선순위는 현상(1) → 단계(2) → board_order(3)이고, 순서 자체가 계약이다.
    """

    def test_표적_kl이_낮으면_낮은_보드가_이긴다(self):
        """실시드 `rain`의 실제 형태 — (kl 1, order 19) vs (kl 4, order 5)."""
        easy = board_item("rain-kl1", phenomenon="rain", order=19, kl=1)
        hard = board_item("rain-kl4", phenomenon="rain", order=5, kl=4)
        assert wp.match_board([hard, easy], "rain", 1)["id"] == "rain-kl1", (
            "board_order가 더 앞서도 표적 단계에 가까운 쪽이 이겨야 한다 — "
            "밴드 필터가 하던 일을 이제 이 축이 받는다"
        )

    def test_표적_kl이_높으면_높은_보드가_이긴다(self):
        """방벽이지 하향 고정이 아니다 — 위로도 똑같이 따라가야 한다."""
        easy = board_item("rain-kl1", phenomenon="rain", order=1, kl=1)
        hard = board_item("rain-kl5", phenomenon="rain", order=40, kl=5)
        assert wp.match_board([easy, hard], "rain", 5)["id"] == "rain-kl5"

    def test_현상이_단계보다_우선한다(self):
        """1순위는 「오늘 날씨 반영」이다 — 단계에 양보하면 기능의 정의가 무너진다."""
        off_phenomenon = board_item("fog-kl1", phenomenon="fog", order=1, kl=1)
        on_phenomenon = board_item("rain-kl9", phenomenon="rain", order=40, kl=9)
        assert wp.match_board([off_phenomenon, on_phenomenon], "rain", 1)["id"] == (
            "rain-kl9"
        )

    def test_단계가_같으면_board_order가_가른다(self):
        near = board_item("a", phenomenon="rain", order=3, kl=2)
        far = board_item("b", phenomenon="rain", order=9, kl=2)
        assert wp.match_board([far, near], "rain", 2)["id"] == "a"

    def test_표적이_None이면_개정_전과_같다(self):
        """콜드스타트(θ 없음) — 거리가 전건 0이라 정렬이 종전과 동일해야 한다."""
        items = [
            board_item(f"i{i}", phenomenon="rain", order=order, kl=kl)
            for i, (order, kl) in enumerate([(19, 1), (5, 4), (40, 5)])
        ]
        assert [i["id"] for i in wp.order_boards_for_today(items, "rain", None)] == [
            i["id"] for i in wp.order_boards_for_today(items, "rain")
        ]
        assert wp.order_boards_for_today(items, "rain")[0]["id"] == "i1"  # order 5

    def test_단계_미분류는_뒤로(self):
        """미분류가 「표적과 딱 맞는 것」처럼 앞줄을 차지하면 안 된다."""
        graded = board_item("graded", phenomenon="rain", order=50, kl=9)
        ungraded = board_item("ungraded", phenomenon="rain", order=1, kl=None)
        assert wp.match_board([ungraded, graded], "rain", 1)["id"] == "graded"

    def test_폴백_구간에도_단계가_적용된다(self):
        """현상이 안 맞아 board_order 폴백으로 가도 난이도 방벽은 살아 있어야 한다."""
        easy = board_item("easy", phenomenon="fog", order=30, kl=1)
        hard = board_item("hard", phenomenon="fog", order=2, kl=8)
        assert wp.match_board([hard, easy], "snow", 1)["id"] == "easy"

    def test_정렬은_여전히_결정적이고_버리지_않는다(self):
        items = [
            board_item(f"i{i}", phenomenon="rain", order=i, kl=(i % 5) + 1)
            for i in range(12)
        ]
        first = [i["id"] for i in wp.order_boards_for_today(items, "rain", 3)]
        assert len(first) == len(items)
        for _ in range(10):
            assert [
                i["id"] for i in wp.order_boards_for_today(items, "rain", 3)
            ] == first

    @pytest.mark.parametrize("target", [1, 2, 3, 4, 5])
    def test_실시드에서_표적_단계에_가장_가까운_보드가_나온다(self, target):
        boards = [
            i for i in _seed("content_items.json")
            if i.get("question_type") == "board"
        ]
        picked = wp.match_board(boards, "rain", target)
        levels = [
            wp.knowledge_level(b) for b in boards if "rain" in wp.goal_phenomena(b)
        ]
        best = min(abs(level - target) for level in levels)
        assert abs(wp.knowledge_level(picked) - target) == best


# ═══════════════════════════════════════════════════════════════
# 실시드 커버리지 — 합성이 아니라 진짜 문항으로 9종이 되는가
# ═══════════════════════════════════════════════════════════════


class TestSeedCoverage:
    @pytest.fixture(scope="class")
    def boards(self):
        return [
            i for i in _seed("content_items.json")
            if i.get("question_type") == "board"
        ]

    @pytest.mark.parametrize("phenomenon", wp.PHENOMENA)
    def test_현상마다_실제_board_문항이_있다(self, boards, phenomenon):
        picked = wp.match_board(boards, phenomenon)
        assert picked is not None and phenomenon in wp.goal_phenomena(picked), (
            f"{phenomenon}를 목표로 하는 board 문항이 시드에 0건이다 — "
            "그 현상이 나온 날의 board 자리는 board_order 폴백으로 열화한다"
        )

    def test_board_문항은_전건_board_order를_갖는다(self, boards):
        missing = [
            b["template_json"].get("question_text", "?")[:20]
            for b in boards if wp.board_order(b) is None
        ]
        assert not missing, f"board_order 없는 board 문항: {missing}"

    def test_board_목표_현상은_전건_어휘_안이다(self, boards):
        unknown = {
            p for b in boards for p in wp.goal_phenomena(b) if p not in wp.PHENOMENA
        }
        assert not unknown, f"board_rules에 없는 목표 현상: {unknown}"
