"""실황 문항의 **정답**이 오늘 날씨에서 도출되는가 — 차별점 계약 (담당 R, R13-02 §T3).

# 이 파일이 지키는 것

WeatherMind의 대외 차별점 한 줄은 「오늘 실제 날씨가 문항에 들어간다」이다. 그런데
슬롯이 **지문에만** 들어가면 화면에 오늘 기온이 찍힐 뿐 **정답은 날마다 그대로**다 —
그것은 차별점이 아니라 배경 장식이다. `SPRINT_R13_02` §T3이 그 구분을 처음 적었다:

    "지금 실황 자산은 8건·전부 MC·정답 고정이다. **MC로는 정답이 날마다 못 바뀐다**
     — `slider`·`short_answer`가 차별점의 실제 형태다."

`test_seed_contract.py`는 「슬롯을 쓰는 문항이 몇 건인가」(`test_슬롯_문항_6건_이상`)를
세지만 **정답이 슬롯인가**는 아무도 세지 않았다. 그래서 20건 중 4건만 정답이 바뀌는
상태(실질 비중 20%)가 초록 상태로 유지됐다. 이 파일이 그 빈자리를 맡는다.

# N = 10의 근거 — 「달성한 수」가 아니라 「세션 1회당 1건」에서 왔다

배합(`Settings.SESSION_RECIPE`)은 세션 10문항 중 **실황 2건**을 뽑고, 실황 풀은
클라이언트 결정 ④에 따라 **20유형 · 10일 순환**이다. 실황 풀 20건 중 정답이 슬롯인
문항이 k건이면 한 세션이 담는 그런 문항의 기댓값은

    2 × (k / 20) = k / 10

이다. **k = 10이 「평균적인 하루 세션이 정답이 매일 바뀌는 문항을 최소 1건 만난다」의
경계**다. 그 아래에서는 심사·시연에서 세션을 한 번 돌렸을 때 차별점이 화면에 안 나올
수 있다 — 하한을 여기 두는 이유가 그것이다. k가 9였다면 이 테스트는 9로 내려가는
것이 아니라 **붉어야 한다**.

⚠️ 그러므로 **실황 풀 크기(20)나 배합의 live(2)가 바뀌면 이 상수를 다시 계산할 것.**
둘 다 이 파일의 소유가 아니다(`database/seed/content_items.json` · `Settings`).

# 왜 상한 유형이 short_answer·cloze뿐인가 — slider는 게이트 4곳에 막혀 있다

`slider`가 "오늘 기온을 맞혀 보라"는 가장 자연스러운 형태지만, `correct_answer`에
`{today.*}`를 넣으면 **저작 시점에** 네 곳이 "정답이 숫자가 아니다"로 떨군다:
`validate_chain.slider_range` · 계약 G `payload_contract.check_slider_values` ·
`seed_content.validate_entry` · `test_seed_contract.test_슬라이더_정답에는_슬롯_비사용`.
넷 다 이 담당의 소유 밖이라 열지 않았다. 여는 판단을 하더라도 정적 `min`/`max`와
±10 절대오차가 남으므로(오늘 값이 범위 밖이면 도달 불가 문항이 된다) 별도 설계가 필요하다.
"""
import json
from pathlib import Path

import pytest

from app.services.answer_service import grade
from app.services.session_service import ALLOWED_SLOTS, SLOT_RE, fill_live_slots

SEED_PATH = Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"
SEED_ITEMS: list[dict] = json.loads(SEED_PATH.read_text(encoding="utf-8"))

# 위 독스트링 「N = 10의 근거」 참조 — 달성치에서 파생시키지 말 것.
MIN_SLOT_ANSWER_ITEMS = 10

# 실황 치환 하네스 — test_live_slots.WEATHER와 같은 형식(§3.3 weather 캐시).
# 값을 일부러 서로 다르게 둬서 "아무 값이나 넣어도 통과"가 되지 않게 한다.
SLOT_VALUES = {
    "today.region": "서울",
    "today.temp_max": "31",
    "today.temp_min": "23",
    "today.rain_prob": "60",
    "today.sky": "구름많음",
}


def _answer_of(item: dict) -> str:
    return str((item.get("template_json") or {}).get("correct_answer") or "")


def _label(item: dict, index: int) -> str:
    return f"[{index}] {item.get('question_type')}/{item.get('concept_tag')}"


SLOT_ANSWER_ITEMS: list[tuple[int, dict]] = [
    (i, item)
    for i, item in enumerate(SEED_ITEMS)
    if SLOT_RE.search(_answer_of(item))
]
SLOT_ANSWER_IDS = [_label(item, i) for i, item in SLOT_ANSWER_ITEMS]


class TestSlotAnswerFloor:
    """정답이 오늘 날씨에서 도출되는 문항이 세션당 1건 기댓값을 넘는가."""

    def test_정답이_슬롯인_문항이_하한_이상(self):
        assert len(SLOT_ANSWER_ITEMS) >= MIN_SLOT_ANSWER_ITEMS, (
            f"정답이 {{today.*}}인 문항이 {len(SLOT_ANSWER_ITEMS)}건 — 하한 "
            f"{MIN_SLOT_ANSWER_ITEMS}건 미달. 실황 슬롯이 지문에만 있으면 화면에만 "
            "오늘 날씨가 찍히고 정답은 날마다 그대로다(= 배경 장식). "
            "근거는 이 파일 독스트링 「N = 10의 근거」."
        )

    def test_슬롯_정답_문항은_전부_uses_live_slots다(self):
        """플래그가 false면 live 풀 밖으로 나가 **치환 없이** 서빙된다.

        그 경로에서는 유저가 "{today.temp_max}" 원문을 정답으로 적어야 맞는,
        아무도 풀 수 없는 문항이 된다.
        """
        broken = [
            _label(item, i)
            for i, item in SLOT_ANSWER_ITEMS
            if not item.get("uses_live_slots")
        ]
        assert not broken, f"정답에 슬롯이 있는데 uses_live_slots=false: {broken}"


@pytest.mark.parametrize(("index", "item"), SLOT_ANSWER_ITEMS, ids=SLOT_ANSWER_IDS)
class TestEverySlotAnswerIsSolvable:
    """슬롯 정답 문항 전건이 「치환 → 채점」 왕복을 실제로 통과하는가."""

    def test_정답이_슬롯_하나로만_이뤄진다(self, index, item):
        """`_grade_text`는 완전 일치 채점이라 정답에 군더더기가 붙으면 전건 오답이 된다.

        "{today.temp_max}도"처럼 단위를 붙이면 유저가 "31도"라고 써야만 맞는데
        지문은 "숫자만 쓰시오"라고 말한다 — 게이트가 보지 않는 채점 결함이다
        (CLAUDE.md 「1,000건 통과가 1,000건 검증은 아니다」의 그 유형).
        """
        answer = _answer_of(item)
        assert SLOT_RE.fullmatch(answer), (
            f"{_label(item, index)} 정답이 슬롯 단독이 아니다: {answer!r}"
        )

    def test_정답_슬롯이_허용_5종_안에_있다(self, index, item):
        used = set(SLOT_RE.findall(_answer_of(item)))
        assert used <= set(ALLOWED_SLOTS), (
            f"{_label(item, index)} 허용 밖 정답 슬롯: {used - set(ALLOWED_SLOTS)}"
        )

    def test_정답_슬롯이_지문에도_보인다(self, index, item):
        """지문에 없는 값을 정답으로 요구하면 화면만 보고는 풀 수 없다.

        §T3 「개황 지문은 정답 판정에 쓰지 않는다」와 어긋나지 않는다 — 지문은 오늘
        값을 **보여 주기만** 하고, 어느 값이 답인지는 문항이 묻는 개념이 정한다.
        """
        template = item.get("template_json") or {}
        question_slots = set(SLOT_RE.findall(str(template.get("question_text") or "")))
        answer_slots = set(SLOT_RE.findall(_answer_of(item)))
        assert answer_slots <= question_slots, (
            f"{_label(item, index)} 정답 슬롯 {answer_slots - question_slots}이 "
            "지문에 없다 — 유저가 값을 볼 수 없다"
        )

    def test_치환_후_채점이_오늘_값을_정답으로_인정한다(self, index, item):
        """발급(fill_live_slots) → 채점(GRADERS) 왕복. 실서빙과 같은 두 모듈을 쓴다."""
        rendered, ok = fill_live_slots(item["template_json"], SLOT_VALUES)
        assert ok, f"{_label(item, index)} 치환 실패 — 미치환 슬롯이 남는다"
        assert not SLOT_RE.search(json.dumps(rendered, ensure_ascii=False)), (
            f"{_label(item, index)} 치환 후에도 슬롯 원문이 남았다"
        )

        question = {**rendered, "question_type": item["question_type"]}
        today_answer = rendered["correct_answer"]
        assert today_answer in SLOT_VALUES.values(), (
            f"{_label(item, index)} 치환된 정답이 오늘 값이 아니다: {today_answer!r}"
        )
        assert grade(question, today_answer) is True, (
            f"{_label(item, index)} 오늘 값을 제출했는데 오답 처리된다"
        )

    def test_어제_값을_제출하면_오답이다(self, index, item):
        """정답이 **날마다 바뀐다**는 것의 실제 검증 — 고정 정답이면 여기서 걸린다.

        같은 슬롯의 값만 바꾼 두 날을 만들어, 어제 값이 오늘 채점에서 오답이 되는지
        본다. 정답이 슬롯을 참조하지 않으면 두 날의 정답이 같아져 이 단정이 깨진다.
        """
        slot = SLOT_RE.findall(_answer_of(item))[0]
        yesterday = {**SLOT_VALUES, slot: "17"}
        assert yesterday[slot] != SLOT_VALUES[slot], "하네스 값이 겹쳤다"

        today_rendered, _ = fill_live_slots(item["template_json"], SLOT_VALUES)
        yesterday_rendered, _ = fill_live_slots(item["template_json"], yesterday)
        assert today_rendered["correct_answer"] != yesterday_rendered["correct_answer"]

        question = {**today_rendered, "question_type": item["question_type"]}
        assert grade(question, yesterday_rendered["correct_answer"]) is False, (
            f"{_label(item, index)} 어제 정답이 오늘도 정답이다 — 정답이 고정이다"
        )


# ═══════════════════════════════════════════════════════════════
# 밴드 안 정답 슬롯 유일성 (2026-08-20)
# ═══════════════════════════════════════════════════════════════
#
# 왜 필요한가 — **정답이 날마다 바뀌어도 「무엇을 묻는지」가 고정이면 외워서 맞힌다.**
# 위 계약들은 문항 **한 건씩** 본다: 정답이 슬롯인가, 치환되는가, 어제 값이 오답인가.
# 전부 초록인 채로 실측이 이랬다(2026-08-20):
#
#     elementary  {today.temp_min} 2벌 · {today.temp_max} 2벌
#     adult       {today.temp_max} 2벌
#
# 학습자는 한 밴드 안에서만 문항을 만나므로(`level_group`이 진입에서 고정된다),
# elementary 학습자에게는 실황 정답이 **사실상 기온 두 종류**뿐이다. 지문을 안 읽고
# 「실황이면 최고기온」으로 찍어도 절반이 맞는다 — 문항을 몰라도 맞히는 길이고,
# 그 길이 열려 있는 동안은 정답이 날마다 바뀌는 것이 난이도를 만들지 못한다.
#
# ⚠️ **개수 하한이 아니라 유일성으로 문다.** 「밴드마다 슬롯 3종 이상」 같은 하한은
# 슬롯이 5종뿐이라 밴드가 커지면 저절로 깨지고, 반대로 문항이 2건인 밴드에서는
# 공허하게 통과한다. 유일성은 밴드 크기와 무관하게 같은 것을 말한다.
#
# 상한은 구조가 이미 준다: 허용 슬롯이 5종(`ALLOWED_SLOTS`)이므로 한 밴드의 슬롯
# 정답 문항은 **최대 5건**이다. 그 위로 저작하려면 슬롯 계약(§3.3)을 먼저 넓혀야
# 하고, 그때 이 테스트가 먼저 붉어져 그 판단을 사람에게 돌린다.


def _band_of(item: dict) -> str:
    return str(item.get("level_group") or "(미분류)")


def _slot_of(item: dict) -> str:
    return SLOT_RE.findall(_answer_of(item))[0]


class TestSlotAnswersDifferWithinBand:
    """같은 밴드 안에서 실황 정답 슬롯이 겹치지 않는다."""

    def test_밴드마다_정답_슬롯이_서로_다르다(self):
        by_band: dict[str, list[tuple[str, str]]] = {}
        for index, item in SLOT_ANSWER_ITEMS:
            by_band.setdefault(_band_of(item), []).append(
                (_slot_of(item), _label(item, index))
            )

        collisions = []
        for band, entries in sorted(by_band.items()):
            seen: dict[str, list[str]] = {}
            for slot, label in entries:
                seen.setdefault(slot, []).append(label)
            for slot, labels in sorted(seen.items()):
                if len(labels) > 1:
                    collisions.append(f"{band} · {slot} × {len(labels)}벌: {labels}")

        assert not collisions, (
            "같은 밴드 안에서 실황 정답 슬롯이 겹친다 — 학습자가 지문을 안 읽고 "
            "「이 밴드의 실황이면 늘 이 값」으로 외워서 맞힐 수 있다:\n  "
            + "\n  ".join(collisions)
        )

    def test_이_계약이_공허하지_않다(self):
        """겹칠 **재료가 있는** 밴드가 실제로 있는가 — 공허 통과 방지.

        슬롯 정답 문항이 밴드마다 1건뿐이면 위 단정은 저절로 참이다. 그때는 계약이
        지키는 것이 없으므로, 「2건 이상인 밴드가 하나라도 있다」를 함께 문다.
        """
        counts: dict[str, int] = {}
        for _, item in SLOT_ANSWER_ITEMS:
            band = _band_of(item)
            counts[band] = counts.get(band, 0) + 1
        assert any(n >= 2 for n in counts.values()), (
            f"슬롯 정답 문항이 밴드마다 1건 이하다({counts}) — 유일성 단정이 공허하다"
        )

    def test_미분류_밴드에_슬롯_정답_문항이_없다(self):
        """`level_group`이 없으면 어느 밴드에서 겹치는지 판정할 수 없다.

        위 단정은 미분류를 하나의 밴드로 묶어 보므로 판정이 성립하기는 하지만,
        그 묶음은 화면에서 학습자가 만나는 단위가 아니다 — 애초에 없어야 한다.
        """
        unclassified = [
            _label(item, index)
            for index, item in SLOT_ANSWER_ITEMS
            if not item.get("level_group")
        ]
        assert not unclassified, f"level_group 없는 슬롯 정답 문항: {unclassified}"
