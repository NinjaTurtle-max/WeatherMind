"""유닛 제목의 **표시 계약** — `database/seed/units.json`이 소유하는 그 문자열.

## 왜 이 파일이 생겼나 (2026-08-13, 담당 AH)

클라이언트 제보: *"「기압과 전선 · 빈칸 채우기」 이 멘트가 어느 정도 일정 섹션
이후부터 계속 동일해."* 실측한 결과 기상 코스 138유닛의 제목이 **73종**뿐이었고,
**32종이 중복이며 97유닛이 거기 걸려** 있었다(「태풍 · 골라내기」 8회).

원인은 제목의 축이 모자란 것이었다. `docs/design/cyclic_sections.md` §4.4는 제목을
`{개념 표시명} · {문항유형 부제}` 두 조각으로 정하고, 개념 표시명을 **kl1~3 / kl4~10
두 단**으로만 갈랐다. 순환식 커리큘럼(CO-G1)은 **같은 개념을 10단계에 재등장**시키므로
조합이 `8개념 × 6부제`로 바닥나고, 같은 설계 문서가 *"제목은 한 섹션 안에서 유일하다.
다른 섹션과는 겹칠 수 있다"*고 그 중복을 명시적으로 허용해 두었다. 그 허용이 화면에서
클라이언트가 본 증상이 됐다.

해소는 개념 표시명을 **(개념 × 지식 단계) 칸마다** 저작하는 쪽이었다. 부제(문항 유형)는
학습자에게 "무엇을 하게 되는지"를 알리는 정보라 그대로 뒀다.

## 이 파일이 무는 것

⑴ **비어 있지 않다** — 제목은 화면 카드의 유일한 식별자다(아이콘은 개념당 하나라
   같은 개념 유닛끼리 구분되지 않는다).
⑵ **길이 상한** — 카드가 `max-w-[8rem] text-xs`(≈2줄)라 실측 상한을 넘기면 잘린다.
   상한은 **재작업 전 실측값**에서 왔다: 기상 21자 · 기초과학 32자(기초과학은 §4.5
   규약대로 제목이 단계 표시명을 자기 안에 싣는다). 파생값이 아니라 화면 제약이다.
⑶ **섹션 안에서 제목이 유일** — 설계 §4.4가 생성기에 걸어 둔 단정. 코드가 아니라
   생성기 안에만 있어 데이터가 손저작으로 바뀌면 아무도 안 봤다.
⑷ **코스 안에서 같은 제목은 2회까지** — ⑶만으로는 이번 결함을 못 막는다(중복은 전부
   섹션 **사이**에 있었다). 상한을 2로 잡은 근거는 **남은 중복 수에서 파생시킨 것이
   아니다**(현재 실측 중복 0). 클라이언트의 표현이 "계속 동일"이고, 10섹션을 지나며
   같은 문자열을 **세 번째** 만나는 순간이 "이 앱은 같은 말만 한다"로 읽히는 지점이다.
   서로 다른 두 단계가 정말 같은 것을 가르치면 2회는 허용한다 — 억지 차별화가 더 나쁘다.
⑸ **어휘 단계** — 제목의 용어가 그 섹션의 지식 단계에서 쓸 수 있는 말인가.
   판정식은 `docs/specs/12` §7.4와 같다: 제목은 **배경 어휘 용법**이므로 임계는
   `name_ok_from`(없으면 `introduced_at`). 설계 §4.4가 "생성기가 제목 전건을
   재검사한다"고 적어 둔 그 검사이고, 생성기 밖에는 소유자가 없었다.

⚠️ 섹션 → 지식 단계는 여기서 다시 만들지 않고 `curriculum_service.SECTION_KNOWLEDGE_LEVEL`
을 쓴다(같은 사실의 두 번째 사본이 이 저장소에서 가장 잘 기록된 실패 유형이다).
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from app.services.curriculum_service import SECTION_KNOWLEDGE_LEVEL

REPO = Path(__file__).resolve().parents[2]
SEED_DIR = REPO / "database" / "seed"
UNITS_PATH = SEED_DIR / "units.json"
VOCAB_PATH = SEED_DIR / "level_vocabulary.json"

UNITS: list[dict] = json.loads(UNITS_PATH.read_text(encoding="utf-8"))
VOCAB_TERMS: list[dict] = json.loads(VOCAB_PATH.read_text(encoding="utf-8"))["terms"]

DEFAULT_COURSE = "weather"

#: 코스별 제목 길이 상한(글자 수). 재작업 전 실측 최대값 = 화면이 이미 감당하던 폭.
#: 기초과학이 넉넉한 것은 §4.5가 그 코스 제목에만 단계 표시명을 넣기 때문이다.
TITLE_MAX_LEN = {"weather": 21, "basic-science": 32}

#: 한 코스 안에서 같은 제목이 나와도 되는 최대 횟수. 근거는 모듈 독스트링 ⑷.
MAX_TITLE_REPEAT_IN_COURSE = 2


def course_of(unit: dict) -> str:
    return unit.get("course", DEFAULT_COURSE)


def units_by_course() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for unit in UNITS:
        out.setdefault(course_of(unit), []).append(unit)
    return out


def vocab_threshold(term: dict) -> int:
    """배경 어휘 용법의 임계 — docs/specs/12 §7.4."""
    return term.get("name_ok_from") or term["introduced_at"]


UNIT_IDS = [u["id"] for u in UNITS]


class TestTitlePresence:
    @pytest.mark.parametrize("unit", UNITS, ids=UNIT_IDS)
    def test_제목이_비어_있지_않다(self, unit):
        title = unit.get("title")
        assert isinstance(title, str) and title.strip(), unit["id"]
        assert title == title.strip(), f"{unit['id']}: 앞뒤 공백"


class TestTitleLength:
    @pytest.mark.parametrize("unit", UNITS, ids=UNIT_IDS)
    def test_카드가_감당하는_길이를_넘지_않는다(self, unit):
        limit = TITLE_MAX_LEN[course_of(unit)]
        assert len(unit["title"]) <= limit, (
            f"{unit['id']}: {len(unit['title'])}자 > {limit}자 — "
            "카드(max-w-[8rem] text-xs)에서 잘린다"
        )

    def test_상한이_실측_최대값과_같은_코스가_있다(self):
        """상한이 실제 데이터와 동떨어진 값으로 굳는 것을 막는다.

        상한을 아무렇게나 키우면 ⑵는 통과만 하는 장식이 된다. 적어도 한 코스는
        상한에 닿아 있어야 그 숫자가 화면 실측에서 왔음이 유지된다.
        """
        by_course = units_by_course()
        touching = [
            c for c, us in by_course.items()
            if max(len(u["title"]) for u in us) == TITLE_MAX_LEN[c]
        ]
        assert touching, f"상한에 닿는 코스가 없다: {TITLE_MAX_LEN}"


class TestTitleUniqueness:
    def test_섹션_안에서_제목이_유일하다(self):
        """cyclic_sections.md §4.4가 생성기에 걸어 둔 단정."""
        by_section: dict[str, list[str]] = {}
        for unit in UNITS:
            by_section.setdefault(unit["section"], []).append(unit["title"])
        offenders = {
            section: [t for t, n in Counter(titles).items() if n > 1]
            for section, titles in by_section.items()
        }
        offenders = {s: t for s, t in offenders.items() if t}
        assert not offenders, offenders

    def test_코스_안에서_같은_제목은_두_번까지다(self):
        """섹션 안 유일성만으로는 못 막는 결함 — 중복은 전부 섹션 사이에 있었다."""
        offenders = {}
        for course, units in units_by_course().items():
            counts = Counter(u["title"] for u in units)
            over = {t: n for t, n in counts.items() if n > MAX_TITLE_REPEAT_IN_COURSE}
            if over:
                offenders[course] = over
        assert not offenders, (
            f"같은 코스에서 {MAX_TITLE_REPEAT_IN_COURSE}회를 넘겨 되풀이되는 제목: "
            f"{offenders} — 단계가 올라가도 화면 문구가 그대로라는 뜻이다"
        )


class TestTitleVocabularyLevel:
    """제목의 용어가 그 섹션 단계에서 쓸 수 있는 말인가 (docs/specs/12 §7.4)."""

    LEVELLED = [u for u in UNITS if u["section"] in SECTION_KNOWLEDGE_LEVEL]

    def test_단계_축이_있는_섹션이_실제로_있다(self):
        assert self.LEVELLED, "SECTION_KNOWLEDGE_LEVEL과 시드 섹션이 어긋났다"

    @pytest.mark.parametrize(
        "unit", LEVELLED, ids=[u["id"] for u in LEVELLED]
    )
    def test_상위_단계_용어가_하위_제목에_없다(self, unit):
        level = SECTION_KNOWLEDGE_LEVEL[unit["section"]]
        violations = [
            (term["term"], vocab_threshold(term))
            for term in VOCAB_TERMS
            if term["term"] in unit["title"] and level < vocab_threshold(term)
        ]
        assert not violations, (
            f"{unit['id']}({unit['section']}, kl{level}) 제목 「{unit['title']}」에 "
            f"도입 단계가 더 높은 용어: {violations}"
        )
