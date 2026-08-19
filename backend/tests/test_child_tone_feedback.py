"""초등 학령 톤(MT-11) — `effective_tone` 첫 소비처 계약.

이 파일이 무는 것은 셋이다:

1. **파이프가 이어졌는가** — `build_feedback`이 실제로 `effective_tone`을 읽고
   그 값에 따라 다른 문자열을 낸다. 조사 문서
   (`docs/design/research/RESEARCH_MT8_10_11_DIFFICULTY.md` §1.4)가 「소비처 0건」으로
   지목한 자리라, **여기가 비면 톤 축 전체가 장식**이 된다.
2. **전역 변경이 아닌가** — child가 아닌 톤(그리고 `user=None`)은 해설이 **바이트
   동일**해야 한다. 학령과 무관하게 문구가 바뀌면 그건 다른 작업이다.
3. **오변환을 안 하는가** — 변환 규칙이 닿지 않는 문장은 손대지 않고, 그런 문장이
   섞인 해설은 통째로 원문이다(섞인 어투 금지 불변식).

⚠️ **수치를 박지 않는다**(CLAUDE.md §0-2). 시드가 자라면 「초등 해설 몇 건이
바뀌는가」는 움직인다. 그래서 시드 대상 검사는 **건수가 아니라 성질**만 단정한다
— "예외가 안 난다" · "바뀐 문장은 존댓 분류를 통과한다" · "안 바뀐 것은 원문과
바이트 동일하다".
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.services import answer_service, tone_text, weatherbrain_service

# 조사 문서 §2.2의 존댓 분류기 — 변환 결과를 재는 **독립 오라클**이다.
# (치환 규칙과 다른 식으로 쓰여 있어야 자기 자신을 채점하지 않는다.)
POLITE = re.compile(r"(요|니다|니까|시오|세요)$")

SEED = (
    Path(__file__).resolve().parents[2]
    / "database"
    / "seed"
    / "content_items.json"
)


class _FakeUser:
    """`effective_tone`이 보는 두 속성만 가진 최소 객체."""

    def __init__(self, tone=None, level_group=None):
        self.tone = tone
        self.level_group = level_group


# ═══════════════════════════════════════════════════════════════
# 1. 변환 규칙 (순수 함수)
# ═══════════════════════════════════════════════════════════════


class TestSoftenRules:
    @pytest.mark.parametrize(
        "plain,expected",
        [
            # 받침 있는 음절 + 다 → 답니다 (어간을 건드리지 않는다)
            ("공기가 위로 올라간다.", "공기가 위로 올라간답니다."),
            ("르 불규칙도 어간을 안 건드린다: 사람들이 그렇게 부른다.",
             "르 불규칙도 어간을 안 건드린다: 사람들이 그렇게 부른답니다."),
            ("바람이 구름을 만든다.", "바람이 구름을 만든답니다."),
            ("비가 올 수 있다.", "비가 올 수 있답니다."),
            ("그런 날은 덥다.", "그런 날은 덥답니다."),
            ("어제보다 따뜻해졌다.", "어제보다 따뜻해졌답니다."),
            # 서술격 이다 → 이랍니다
            ("이것이 열대야의 기준이다.", "이것이 열대야의 기준이랍니다."),
            ("그래서 밤이 더운 것이다.", "그래서 밤이 더운 것이랍니다."),
        ],
    )
    def test_받침_있는_문말은_부드러워진다(self, plain, expected):
        assert tone_text.soften_for_tone(plain, "child") == expected

    @pytest.mark.parametrize(
        "text",
        [
            # 받침 없는 음절 + 다 — 형용사(다르답니다)와 명사(하나랍니다)가
            # 문자열만으로 안 갈린다. 그래서 **둘 다 건드리지 않는다**.
            "지역마다 기온이 모두 다르다.",
            "이것은 온난화의 사례 가운데 하나다.",
            "낮과 밤의 기온 차가 크다.",
            "그 값은 30%다.",
        ],
    )
    def test_받침_없는_문말은_손대지_않는다(self, text):
        assert tone_text.soften_for_tone(text, "child") == text

    @pytest.mark.parametrize(
        "text",
        [
            "밖에 나가지 않는 것이 가장 안전해요.",
            "구름은 물방울로 이루어져 있습니다.",
            "우산을 챙기세요.",
        ],
    )
    def test_이미_존댓말이면_바이트_동일(self, text):
        assert tone_text.soften_for_tone(text, "child") == text

    @pytest.mark.parametrize(
        "plain,expected",
        [
            ("그것은 구름이 아니다.", "그것은 구름이 아니랍니다."),
            (
                "공기가 위로 올라간다. 그것은 햇볕 때문이 아니다.",
                "공기가 위로 올라간답니다. 그것은 햇볕 때문이 아니랍니다.",
            ),
        ],
    )
    def test_아니다는_존댓_오분류를_뚫고_변환된다(self, plain, expected):
        """🔴 `_POLITE`가 `니다$`를 물어 `아니다`를 존댓으로 **오분류**한다.

        오분류된 문장은 원문으로 남으므로 전부-아니면-전무 스킵에도 안 걸리고,
        `~답니다.` 옆에 `~아니다.`가 서서 **섞인 어투가 그대로 통과한다.**
        분기 순서가 뒤집히면 두 번째 케이스가 즉시 운다.
        """
        assert tone_text.soften_for_tone(plain, "child") == expected

    def test_진짜_존댓_아닙니다는_안_건드린다(self):
        """`아닙니다`는 `닙니다`로 끝나 위 분기에 안 걸린다(과잉 변환 방지)."""
        text = "그것은 구름이 아닙니다."
        assert tone_text.soften_for_tone(text, "child") == text

    def test_한_문장이라도_못_바꾸면_해설_전체가_원문이다(self):
        """섞인 어투 금지 — `~답니다.`와 `~한다.`가 한 문단에 공존하면 안 된다."""
        mixed = "공기가 위로 올라간다. 지역마다 기온이 모두 다르다."
        assert tone_text.soften_for_tone(mixed, "child") == mixed

    def test_존댓과_한다체가_섞인_원문은_전부_존댓이_된다(self):
        source = "비가 올 수 있어요. 그래서 우산을 챙긴다."
        assert (
            tone_text.soften_for_tone(source, "child")
            == "비가 올 수 있어요. 그래서 우산을 챙긴답니다."
        )

    def test_멱등이다(self):
        source = "공기가 위로 올라간다. 그래서 구름이 생긴다."
        once = tone_text.soften_for_tone(source, "child")
        assert once != source
        assert tone_text.soften_for_tone(once, "child") == once

    def test_꼬리_구두점과_따옴표를_잃지_않는다(self):
        assert (
            tone_text.soften_for_tone("이런 밤을 '열대야'라고 한다.", "child")
            == "이런 밤을 '열대야'라고 한답니다."
        )

    def test_줄바꿈_구분자가_보존된다(self):
        source = "공기가 위로 올라간다.\n그래서 구름이 생긴다."
        assert (
            tone_text.soften_for_tone(source, "child")
            == "공기가 위로 올라간답니다.\n그래서 구름이 생긴답니다."
        )

    @pytest.mark.parametrize("text", ["", "   ", "1013 hPa", "___"])
    def test_한국어가_아니거나_빈_입력은_그대로(self, text):
        assert tone_text.soften_for_tone(text, "child") == text

    def test_받침_판정(self):
        assert tone_text.has_batchim("간")
        assert tone_text.has_batchim("있")
        assert not tone_text.has_batchim("나")
        assert not tone_text.has_batchim("르")
        assert not tone_text.has_batchim("A")


class TestToneGate:
    @pytest.mark.parametrize("tone", ["teen", "adult", "", "unknown"])
    def test_child가_아니면_바이트_동일(self, tone):
        source = "공기가 위로 올라간다. 그래서 구름이 생긴다."
        assert tone_text.soften_for_tone(source, tone) == source

    def test_child_톤_이름이_weatherbrain과_같다(self):
        """값 복제의 드리프트 감시 — 어느 한쪽이 바뀌면 여기서 운다."""
        assert tone_text.CHILD_TONE in weatherbrain_service.TONES
        assert (
            weatherbrain_service.LEVEL_GROUP_TONE["elementary"]
            == tone_text.CHILD_TONE
        )


# ═══════════════════════════════════════════════════════════════
# 2. 배선 — build_feedback이 정말 effective_tone을 읽는가
# ═══════════════════════════════════════════════════════════════

PLAIN_Q = {
    "question_type": "multiple_choice",
    "explanation_hint": "따뜻한 공기는 가벼워서 위로 올라간다.",
}
SOFTENED = "따뜻한 공기는 가벼워서 위로 올라간답니다."


async def _feedback(user):
    return await answer_service.build_feedback(
        db=None,
        user=user,
        question=PLAIN_Q,
        answer="x",
        is_correct=False,
        concept_tag="pressure_front",
        phenomena=None,
        board_rules=None,
    )


class TestFeedbackWiring:
    @pytest.mark.anyio
    async def test_초등_학습자는_부드러운_해설을_받는다(self):
        """🔴 파이프의 가운데 — 이 단정이 `effective_tone`의 첫 소비처를 문다."""
        assert await _feedback(_FakeUser(level_group="elementary")) == SOFTENED

    @pytest.mark.anyio
    async def test_신고된_child_톤도_같은_길로_간다(self):
        """파생(level_group)이 아니라 저장값(users.tone)으로 와도 같아야 한다."""
        assert await _feedback(_FakeUser(tone="child", level_group="adult")) == SOFTENED

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "user",
        [
            _FakeUser(level_group="middle_high"),
            _FakeUser(level_group="adult"),
            _FakeUser(level_group="expert"),
            _FakeUser(tone="teen", level_group="elementary"),
            None,  # 미지 유저 → 파생 폴백(teen)
        ],
    )
    async def test_초등이_아니면_해설이_바이트_동일하다(self, user):
        assert await _feedback(user) == PLAIN_Q["explanation_hint"]

    @pytest.mark.anyio
    async def test_출처_라벨은_변환과_무관하게_authored다(self):
        """텍스트를 다듬어도 그 글은 여전히 사람이 쓴 것이다(심사 배점 ⑤ 표기)."""
        assert answer_service.feedback_source(PLAIN_Q) == "authored"
        assert await _feedback(_FakeUser(level_group="elementary")) != PLAIN_Q[
            "explanation_hint"
        ]

    @pytest.mark.anyio
    async def test_board_갈래는_톤_변환을_타지_않는다(self, monkeypatch):
        monkeypatch.setattr(
            answer_service.board_engine,
            "select_feedback",
            lambda *a, **k: "규칙이 성립한다.",
        )
        board_q = {"question_type": "board", "explanation_hint": "무시돼야 한다."}
        text = await answer_service.build_feedback(
            db=None,
            user=_FakeUser(level_group="elementary"),
            question=board_q,
            answer="{}",
            is_correct=True,
            concept_tag="pressure_front",
            phenomena=None,
            board_rules=None,
        )
        assert text == "규칙이 성립한다."


# ═══════════════════════════════════════════════════════════════
# 3. 시드 전수 — 성질만 단정한다(건수 금지)
# ═══════════════════════════════════════════════════════════════


def _elementary_hints() -> list[str]:
    items = json.loads(SEED.read_text(encoding="utf-8"))
    hints = []
    for item in items:
        level = item.get("knowledge_level")
        band = (
            weatherbrain_service.level_group_of_knowledge_level(level)
            if level is not None
            else item.get("level_group")
        )
        if band != "elementary":
            continue
        hint = str((item.get("template_json") or {}).get("explanation_hint") or "").strip()
        if hint:
            hints.append(hint)
    return hints


class TestSeedCorpus:
    def test_초등_해설_전건이_예외_없이_지나간다(self):
        hints = _elementary_hints()
        assert hints, "초등 밴드 해설이 하나도 없다 — 픽스처가 분기에 못 닿았다"
        for hint in hints:
            tone_text.soften_for_tone(hint, "child")

    def test_바뀐_해설은_모든_문장이_존댓_분류를_통과한다(self):
        """독립 오라클 검사 — 바뀐 것은 **전 문장이** 존댓이어야 한다.

        한 문장이라도 한다체로 남으면 섞인 어투가 화면에 나간 것이다.

        ⚠️ 오라클이 변환기와 **같은 정규식**을 쓰면 같은 맹점을 공유한다 —
        `_POLITE`의 `니다$`는 한다체 `아니다`를 존댓으로 오분류하므로, 그 꼬리는
        여기서 **따로** 배제한다. (이 한 줄이 없으면 `아니다`가 남은 섞인 해설이
        오라클을 그냥 통과한다.)
        """
        touched = 0
        for hint in _elementary_hints():
            out = tone_text.soften_for_tone(hint, "child")
            if out == hint:
                continue
            touched += 1
            for sentence in re.split(r"(?<=[.!?])\s+", out):
                core = sentence.strip().rstrip(" .!?~'\"”’)…")
                if not core:
                    continue
                assert not core.endswith(
                    "아니다"
                ), f"오분류로 한다체가 남았다: {sentence!r} ← {hint!r}"
                assert POLITE.search(core), f"한다체가 남았다: {sentence!r} ← {hint!r}"
        assert touched, "초등 해설이 한 건도 안 바뀌었다 — 변환기가 죽어 있다"

    def test_초등이_아닌_밴드는_시드_전건_바이트_동일(self):
        """전역 변경 금지 — 다른 학령의 해설은 이 착지로 한 글자도 안 바뀐다."""
        items = json.loads(SEED.read_text(encoding="utf-8"))
        for item in items:
            hint = str(
                (item.get("template_json") or {}).get("explanation_hint") or ""
            ).strip()
            if not hint:
                continue
            for tone in ("teen", "adult"):
                assert tone_text.soften_for_tone(hint, tone) == hint
