"""2축 분리 골격(R13-0 §1·§3.1) — knowledge_level·tone 스키마와 NULL 폴백 계약.

이 스프린트의 과제는 **값이 아니라 그릇**이다. 6단계 표는 CU-1의 교육과정 조사가
확정하므로(docs/specs/12_curriculum_levels.md), 여기서 고정하는 것은 값이 아니라
구조다:

- 단계 수 N은 `KNOWLEDGE_LEVEL_BANDS` 길이에서만 나온다 — 숫자가 코드에 박히면
  조사 결과가 6→7로 움직일 때 마이그레이션까지 다시 열어야 한다(§4가 피하라는 2회 개정).
- **NULL 폴백 3종**: knowledge_level NULL → level_group 파생 / tone NULL →
  level_group 파생 / 기존 소비처는 한 줄도 안 바뀌고 계속 동작.
- CHECK 제약은 6단계 대응으로 **한 번에** 확장한다(0012).

`level_group`은 걷어내지 않는다(§3.2) — 새 축에서 파생하는 뷰로 남고, 미분류 문항은
저장된 값을 그대로 돌려받는다. 그 "그대로"가 하위 호환의 증명이다.

실행: backend 디렉토리에서 `python -m pytest tests/test_two_axis_levels.py -q`.
"""

from __future__ import annotations

import asyncio
import importlib.util
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.models.content_item import ContentItem
from app.models.user import User
from app.routers import progress as progress_router
from app.services import placement_service as ps
from app.services import session_service
from app.services import weatherbrain_service as wb

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION_0012 = VERSIONS_DIR / "20260806_0012_two_axis_levels.py"


def make_item(level_group="middle_high", knowledge_level=None, **overrides):
    """실 ContentItem — 새 컬럼의 모델 기본값(None)까지 함께 검증한다."""
    item = ContentItem(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        level_group=level_group,
        question_type="multiple_choice",
        template_json={"question_text": "q", "correct_answer": "a"},
    )
    item.knowledge_level = knowledge_level
    for key, value in overrides.items():
        setattr(item, key, value)
    return item


def _seed_entry(**overrides) -> dict:
    """시드 JSON 한 항목의 최소 유효형 — validate_entry 계약 테스트용."""
    entry = {
        "concept_tag": "typhoon",
        "level_group": "adult",
        "question_type": "short_answer",
        "template_json": {"question_text": "q", "correct_answer": "a"},
    }
    entry.update(overrides)
    return entry


def make_user(level_group="middle_high", tone=None, **overrides) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        nickname="테스터",
        level_group=level_group,
        xp=0,
        streak_count=0,
        streak_freeze_count=0,
    )
    user.tone = tone
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


# ═══════════════════════════════════════════════════════════════
# 지식 수준 표 — 단계 수 N은 표에서만 나온다 (값은 CU-1이 채운다)
# ═══════════════════════════════════════════════════════════════


class TestKnowledgeLevelTable:
    def test_단계_수는_표_길이에서_파생(self):
        """N을 상수로 박지 않았는지 — 조사가 단계 수를 바꿔도 표 한 줄만 고쳐야 한다."""
        assert wb.KNOWLEDGE_LEVEL_MIN == 1
        assert wb.KNOWLEDGE_LEVEL_MAX == (
            wb.KNOWLEDGE_LEVEL_MIN + len(wb.KNOWLEDGE_LEVEL_BANDS) - 1
        )

    def test_표의_값은_전부_기존_밴드(self):
        """새 축은 기존 밴드 어휘 위에 얹힌다 — 파생 뷰가 성립하는 전제."""
        assert set(wb.KNOWLEDGE_LEVEL_BANDS) <= set(wb.LEVEL_GROUP_BANDS)

    def test_모든_밴드가_최소_한_단계를_갖는다(self):
        """전사(surjective)여야 밴드→단계→밴드 왕복이 항등이다 — 하위 호환의 근거."""
        assert set(wb.KNOWLEDGE_LEVEL_BANDS) == set(wb.LEVEL_GROUP_BANDS)

    def test_단계가_올라갈수록_밴드도_안_내려간다(self):
        """단조 비감소 — 지식 수준이 난이도 축이라는 의미론(LEVEL_GROUP_BANDS 순서)."""
        ranks = [wb.LEVEL_GROUP_BANDS.index(b) for b in wb.KNOWLEDGE_LEVEL_BANDS]
        assert ranks == sorted(ranks)

    def test_전_단계가_밴드로_해석된다(self):
        for level in range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1):
            assert wb.level_group_of_knowledge_level(level) in wb.LEVEL_GROUP_BANDS

    def test_범위_밖은_양끝으로_클램프(self):
        """상한을 DB가 아니라 앱이 보므로(0012) 방어가 여기 있어야 한다."""
        assert wb.level_group_of_knowledge_level(0) == wb.KNOWLEDGE_LEVEL_BANDS[0]
        assert wb.level_group_of_knowledge_level(-7) == wb.KNOWLEDGE_LEVEL_BANDS[0]
        assert (
            wb.level_group_of_knowledge_level(wb.KNOWLEDGE_LEVEL_MAX + 99)
            == wb.KNOWLEDGE_LEVEL_BANDS[-1]
        )

    def test_무정보_기본값_밴드는_게스트_학령과_같다(self):
        """이원 정의 감시 — 게스트와 미지 값이 다른 자리로 떨어지면 파생이 갈라진다."""
        from app.routers.auth import GUEST_LEVEL_GROUP

        assert wb.NEUTRAL_LEVEL_GROUP == GUEST_LEVEL_GROUP
        assert wb.NEUTRAL_LEVEL_GROUP in wb.LEVEL_GROUP_BANDS


# ═══════════════════════════════════════════════════════════════
# NULL 폴백 ①: knowledge_level NULL → level_group 파생
# ═══════════════════════════════════════════════════════════════


class TestKnowledgeLevelNullFallback:
    def test_신규_ContentItem의_기본값은_None(self):
        """기존 저작·시드 경로가 새 컬럼을 만지지 않아도 미분류(NULL)다."""
        assert make_item().knowledge_level is None

    @pytest.mark.parametrize("band", wb.LEVEL_GROUP_BANDS)
    def test_미분류는_밴드_대표_단계로_폴백(self, band):
        level = wb.effective_knowledge_level(make_item(level_group=band))
        assert wb.KNOWLEDGE_LEVEL_MIN <= level <= wb.KNOWLEDGE_LEVEL_MAX
        assert level == wb.knowledge_level_of_level_group(band)

    @pytest.mark.parametrize("band", wb.LEVEL_GROUP_BANDS)
    def test_밴드_단계_밴드_왕복은_항등(self, band):
        """폴백이 문항을 다른 밴드로 옮기지 않는다 — 재분류 전 안전의 핵심."""
        level = wb.knowledge_level_of_level_group(band)
        assert wb.level_group_of_knowledge_level(level) == band

    @pytest.mark.parametrize("band", wb.LEVEL_GROUP_BANDS)
    def test_대표값은_밴드의_최하_단계(self, band):
        """미분류를 실제보다 어렵게 보지 않는다(과대평가는 학습자를 막는다)."""
        expected = min(
            level
            for level, mapped in enumerate(
                wb.KNOWLEDGE_LEVEL_BANDS, start=wb.KNOWLEDGE_LEVEL_MIN
            )
            if mapped == band
        )
        assert wb.knowledge_level_of_level_group(band) == expected

    def test_분류된_문항은_저장값이_이긴다(self):
        item = make_item(level_group="elementary", knowledge_level=wb.KNOWLEDGE_LEVEL_MAX)
        assert wb.effective_knowledge_level(item) == wb.KNOWLEDGE_LEVEL_MAX
        assert wb.effective_level_group(item) == wb.KNOWLEDGE_LEVEL_BANDS[-1]

    def test_미지_밴드는_표_중앙(self):
        level = wb.knowledge_level_of_level_group("ghost")
        assert wb.KNOWLEDGE_LEVEL_MIN <= level <= wb.KNOWLEDGE_LEVEL_MAX
        assert level == (wb.KNOWLEDGE_LEVEL_MIN + wb.KNOWLEDGE_LEVEL_MAX) // 2

    def test_컬럼이_없는_대역도_폴백(self):
        """SimpleNamespace 스텁(기존 테스트 대역)이 깨지지 않는다 — getattr 방어."""
        stub = SimpleNamespace(level_group="adult")
        assert wb.effective_knowledge_level(stub) == wb.knowledge_level_of_level_group(
            "adult"
        )
        assert wb.effective_level_group(stub) == "adult"


# ═══════════════════════════════════════════════════════════════
# NULL 폴백 ②: tone NULL → level_group 파생
# ═══════════════════════════════════════════════════════════════


class TestToneNullFallback:
    def test_신규_User_행의_기본값은_None(self):
        assert make_user().tone is None

    @pytest.mark.parametrize(
        ("band", "tone"),
        [
            ("elementary", "child"),
            ("middle_high", "teen"),
            ("adult", "adult"),
            ("expert", "adult"),  # 신고 학령은 아니지만(§5) 방어적으로 성인 톤
        ],
    )
    def test_미신고는_학령에서_파생(self, band, tone):
        assert wb.effective_tone(make_user(level_group=band)) == tone
        assert tone in wb.TONES

    @pytest.mark.parametrize("tone", wb.TONES)
    def test_신고값은_그대로(self, tone):
        """축이 갈렸다는 증명 — 성인 학령 신고와 무관하게 톤이 독립적으로 선다."""
        assert wb.effective_tone(make_user(level_group="adult", tone=tone)) == tone

    def test_성인_톤_초급_지식이_표현_가능하다(self):
        """§1이 말하는 '지금 없는 그 칸' — 톤은 성인, 지식은 최하 단계."""
        user = make_user(level_group="elementary", tone="adult")
        item = make_item(level_group="elementary")
        assert wb.effective_tone(user) == "adult"
        assert wb.effective_knowledge_level(item) == wb.KNOWLEDGE_LEVEL_MIN

    def test_어휘_밖_저장값은_파생으로_방어(self):
        assert wb.effective_tone(make_user("elementary", tone="grownup")) == "child"
        assert wb.effective_tone(make_user("elementary", tone="")) == "child"

    def test_미지_학령은_무정보_기본_톤(self):
        assert wb.effective_tone(make_user(level_group="ghost")) == (
            wb.LEVEL_GROUP_TONE[wb.NEUTRAL_LEVEL_GROUP]
        )

    def test_tone_속성이_없는_대역도_파생(self):
        assert wb.effective_tone(SimpleNamespace(level_group="elementary")) == "child"


# ═══════════════════════════════════════════════════════════════
# NULL 폴백 ③: 기존 소비처 무변경 (파생 뷰는 무해한 추가여야 한다)
# ═══════════════════════════════════════════════════════════════


class TestExistingConsumersUnchanged:
    """`level_group`을 읽는 기존 경로가 한 줄도 안 바뀌고 오늘과 같은 값을 본다."""

    @pytest.mark.parametrize("band", wb.LEVEL_GROUP_BANDS)
    def test_미분류_문항의_파생_뷰는_저장값_그대로(self, band):
        """정규화하지 않는 것이 요점 — 파생 뷰가 값을 손대면 하위 호환이 깨진다."""
        assert wb.effective_level_group(make_item(level_group=band)) == band

    def test_pool_level_groups_불변(self):
        """세션 풀 필터(session_service:187) — θ 유무 두 갈래 모두 오늘 그대로."""
        assert session_service.pool_level_groups("middle_high", None) == ["middle_high"]
        assert set(session_service.pool_level_groups("elementary", 1.0)) == {
            "elementary",
            "adult",
        }

    def test_placement_픽은_불변(self):
        """배치고사 선발이 새 컬럼 없는 dict 후보로도 오늘과 같이 돈다."""
        candidates = [
            {
                "id": f"item-{tag}-{group}",
                "concept_tag": tag,
                "level_group": group,
                "question_type": "multiple_choice",
                "uses_live_slots": False,
            }
            for tag in wb.PLACEMENT_QUIZ_TAGS
            for group in ps.LEVEL_GROUPS
        ]
        picks = ps.plan_placement_picks(candidates, "middle_high")
        assert len(picks) == len(wb.PLACEMENT_QUIZ_TAGS)
        assert {p["level_group"] for p in picks} <= set(ps.LEVEL_GROUPS)

    def test_저작_검증기는_knowledge_level_없이_통과(self):
        """시드 JSON에 새 키가 없어도 저작이 막히지 않는다(재분류는 별건 소유)."""
        from app.scripts.seed_content import validate_entry

        assert validate_entry(
            {
                "concept_tag": "typhoon",
                "level_group": "adult",
                "question_type": "short_answer",
                "template_json": {"question_text": "q", "correct_answer": "a"},
            },
            0,
        ) == []

    def test_출제_필터와_배합은_새_축을_읽지_않는다(self):
        """소스 계약 — kl은 **정렬**에만 쓰이고 **필터·배합**에는 못 들어온다.

        ⚠️ **2026-08-09 개정(CO-E-1).** 이 테스트는 직전까지
        `test_출제_선정은_아직_새_축을_읽지_않는다`라는 이름으로 `_fetch_pools`·
        `_fetch_unit_pool`까지 금지해 **6단계 해상도가 서빙에 닿는 것을 막고
        있었다.** 그런데 그 사이 두 전제가 무너졌다:

        - **"아무도 신고하지 않아 항상 NULL"이 거짓이 됐다** — 시드 문항이 전건
          `knowledge_level` 분류를 마쳤다(2026-08-09 실측 284/284).
        - **유닛 경로는 이미 이 선을 넘었다** — `curriculum_service`의
          `rank_by_knowledge_level`(CO-L-F2)이 프로덕션에서 kl로 재정렬한다.
          즉 금지는 daily에만 걸려 있었고, 결과는 "유닛은 6단계·daily는 4칸"이라는
          **비대칭**이었다. 안전망이 결함을 한쪽에만 영구화한 형태다.

        그래서 금지를 없애는 대신 **경계를 옮겨 적는다.** 남는 위험은 원래
        독스트링이 지목한 것 하나다 — 미분류(NULL) 문항이 **풀에서 탈락**하는 것.
        정렬은 미분류를 뒤로 보낼 뿐이지만 필터는 굶긴다. 그러므로:

        - 금지: `build_pool_query`(SQL WHERE) · `pool_level_groups`(밴드 선택) ·
          `plan_bank_picks`(배합) — 여기에 kl이 들어오면 굶기거나 계약을 흔든다.
        - 허용: 조회 조립부(`_fetch_pools`·`_fetch_unit_pool`) — **정렬 위임만**.
        - `placement_service`는 파일 전체 금지 유지(배치고사 3밴드 고정은 CO-D1
          별건이고, 그 판정 전에 kl이 새면 안 된다).
        """
        import inspect

        for fn in (
            session_service.build_pool_query,
            session_service.pool_level_groups,
            session_service.plan_bank_picks,
        ):
            assert "knowledge_level" not in inspect.getsource(fn), fn.__name__
        assert "knowledge_level" not in Path(ps.__file__).read_text(encoding="utf-8")

    def test_daily_풀_재정렬은_유닛과_같은_함수를_쓴다(self):
        """CO-E-1 — 두 경로가 갈리면 결함이 형태만 바꿔 남는다.

        `_fetch_pools`가 자체 정렬 로직을 새로 쓰지 않고
        `rank_by_knowledge_level`에 위임하는지를 소스로 고정한다. 이 함수가
        정렬의 **단일 소유자**여야 강등 방향(같은 거리면 쉬운 쪽)이 한 곳에서만
        정의된다.
        """
        import inspect

        src = inspect.getsource(session_service._fetch_pools)
        assert "rank_by_knowledge_level" in src
        assert "theta_to_knowledge_level" in src

    def test_생성_문항_적재는_신고값을_그대로_흘려보낸다(self):
        """쓰기 자리는 **열려 있다** — 신고가 오면 저장되고, 없으면 NULL이다.

        단계 판정(specs/12 §4 R2~R6)은 사람 몫이고 level_group에서 기계 복원하는
        것은 §5.3이 금지한다. 그래서 이 자리는 "복원"하지 않고 **비워 둔다**.
        """
        base = {
            "concept_tag": "typhoon",
            "question_type": "short_answer",
            "question_text": "q",
            "correct_answer": "a",
        }
        assert (
            session_service.generated_item_entry(base, level_group="adult")[
                "knowledge_level"
            ]
            is None
        )
        reported = session_service.generated_item_entry(
            {**base, "knowledge_level": 3}, level_group="adult"
        )
        assert reported["knowledge_level"] == 3
        # 컬럼으로 가는 키는 문항 본문(template_json)에 섞이지 않는다
        assert "knowledge_level" not in reported["template_json"]

    def test_θ_경로_상수는_불변(self):
        """1일차(BE-2) 산출물을 그대로 재사용했는지 — 골격 작업이 밴드를 안 건드렸다."""
        assert wb.LEVEL_GROUP_BANDS == (
            "elementary",
            "middle_high",
            "adult",
            "expert",
        )
        assert wb.THETA_BAND_BOUNDS == (-0.5, 0.5, 1.5)
        assert len(wb.THETA_BAND_LABELS) == len(wb.LEVEL_GROUP_BANDS)


class TestKnowledgeLevelIsPersisted:
    """시드 적재가 knowledge_level을 **실제로 저장**한다 (R13 2일차 PM).

    발단: 저작 3팀(CT-2·CT-3·CT-4)이 독립적으로 같은 것을 보고했다 — 0012가 컬럼을
    만들었는데 `upsert_entries`가 그 키를 읽지 않아, staging 문항이 부여한 단계가
    적재에서 통째로 유실된다. 컬럼이 있는데 값이 안 들어가는 것은 "그릇만 있고
    내용은 없다"라 골격 작업의 목적 자체를 무효로 만든다.

    상한을 여기서 검증하는 이유: 0012가 DB CHECK에 하한만 걸었다(단계 수 N이
    6→7로 움직여도 마이그레이션을 다시 열지 않기 위해). 그 대가로 **상한은 앱이
    본다**는 계약이 생겼고, 그 앱이 시드 로더다.
    """

    def test_유효한_단계는_통과(self):
        from app.scripts.seed_content import validate_entry

        for level in range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1):
            assert validate_entry(_seed_entry(knowledge_level=level), 0) == []

    @pytest.mark.parametrize(
        "bad",
        [
            0,
            wb.KNOWLEDGE_LEVEL_MAX + 1,
            -1,
            "3",  # JSON 문자열 — 조용히 통과하면 DB에서 형 오류로 터진다
            3.5,
            True,  # bool은 int의 하위형이라 명시적으로 막지 않으면 1로 샌다
        ],
    )
    def test_범위_밖과_형_불일치는_탈락(self, bad):
        from app.scripts.seed_content import validate_entry

        errors = validate_entry(_seed_entry(knowledge_level=bad), 0)
        assert any("knowledge_level" in e for e in errors), (bad, errors)

    def test_생략은_여전히_통과(self):
        """미분류(NULL) 적재 — 재분류 전 본시드 141건이 전부 이 경로다."""
        from app.scripts.seed_content import validate_entry

        assert validate_entry(_seed_entry(), 0) == []

    def test_삽입_경로가_컬럼에_값을_넣는다(self):
        """소스 계약 — upsert 두 갈래 **모두** knowledge_level을 쓴다.

        DB 왕복 없이 소스를 보는 이유: 이 결함의 성격이 "쓰는 코드가 아예 없다"라
        한 줄의 존재 여부가 곧 계약이다(0011 마이그레이션 소스 단정과 같은 관례).
        """
        from app.scripts import seed_content

        src = Path(seed_content.__file__).read_text(encoding="utf-8")
        assert 'knowledge_level=entry.get("knowledge_level")' in src, "삽입 경로 누락"
        assert (
            'existing.knowledge_level = entry.get("knowledge_level")' in src
        ), "갱신 경로 누락 — 재분류 결과를 재적재해도 반영되지 않는다"

    def test_상한은_표_길이를_따라간다(self):
        """단계 수가 늘어도 로더를 손댈 필요가 없다 — 숫자를 박지 않았는지 감시."""
        from app.scripts import seed_content

        src = Path(seed_content.__file__).read_text(encoding="utf-8")
        assert "KNOWLEDGE_LEVEL_MAX" in src
        assert f"<= {wb.KNOWLEDGE_LEVEL_MAX}" not in src


class TestDerivedViewMatchesSpec:
    """파생표가 `docs/specs/12` §5.3의 정본과 같은가 (2026-08-07 정정).

    골격 착지 시점의 표는 1일차 4밴드를 기계적으로 편 초안이라 3→middle_high ·
    4→adult였다. 조사가 확정한 §5.3은 **중학교를 둘로 쪼갠** 결과(3·4 모두
    middle_high)이고, 그 차이가 실물에 미치는 영향이 크다 — 4단계는 뱅크의 35%다.
    초안대로 두면 그 49건이 성인 밴드로 흘러 "중급인데 어렵다"는 관찰 문제 #1이
    분류 체계 안에서 재생산된다.
    """

    SPEC_5_3 = {1: "elementary", 2: "elementary", 3: "middle_high",
                4: "middle_high", 5: "adult", 6: "expert"}

    @pytest.mark.parametrize("level,band", sorted(SPEC_5_3.items()))
    def test_단계별_파생_밴드(self, level, band):
        assert wb.level_group_of_knowledge_level(level) == band

    def test_단계_수는_여섯(self):
        assert (wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX) == (1, 6)

    def test_중학교가_두_단계를_갖는다(self):
        """§3.2 — 안 쪼개면 141문항의 45%가 한 칸에 몰려 중간 구멍이 재발한다."""
        assert wb.KNOWLEDGE_LEVEL_BANDS.count("middle_high") == 2


# ═══════════════════════════════════════════════════════════════
# CHECK 제약 확장 — 모델과 실DB(0012)가 갈라지지 않는다
# ═══════════════════════════════════════════════════════════════


def _model_check(table, name: str) -> str:
    for constraint in table.constraints:
        if constraint.name == name:
            return str(constraint.sqltext)
    raise AssertionError(f"{name} 제약이 모델에 없다")


def _quoted(text: str) -> list[str]:
    return re.findall(r"'([^']*)'", text)


class TestCheckConstraintExpansion:
    MIGRATION_SRC = MIGRATION_0012.read_text(encoding="utf-8")

    @pytest.mark.parametrize(
        ("table", "name"),
        [
            (User.__table__, "ck_users_level_group"),
            (ContentItem.__table__, "ck_content_items_level_group"),
        ],
    )
    def test_level_group_제약이_전_밴드를_수용(self, table, name):
        """3종이면 expert 문항이 실DB 적재에서 전건 거부된다(§5)."""
        assert _quoted(_model_check(table, name)) == list(wb.LEVEL_GROUP_BANDS)

    def test_tone_제약은_NULL과_3종(self):
        sqltext = _model_check(User.__table__, "ck_users_tone")
        assert _quoted(sqltext) == list(wb.TONES)
        assert "IS NULL" in sqltext  # 미신고 허용 = 하위 호환

    def test_knowledge_level_제약에_상한이_없다(self):
        """단계 수 N을 DDL에 박으면 조사 결과가 움직일 때 2회 개정이다(§4).

        상한은 앱(KNOWLEDGE_LEVEL_MAX)이 본다 — daily_goal_items·region 선례.
        """
        sqltext = _model_check(
            ContentItem.__table__, "ck_content_items_knowledge_level"
        )
        assert "IS NULL" in sqltext  # 미분류 허용
        assert ">= 1" in sqltext
        assert "<" not in sqltext
        assert str(wb.KNOWLEDGE_LEVEL_MAX) not in sqltext

    def test_마이그레이션과_모델이_같은_제약을_쓴다(self):
        """모델과 실DB가 갈라지면 테스트는 통과하고 적재만 조용히 실패한다."""
        assert _quoted(self.MIGRATION_SRC.split("_LEVEL_GROUPS_4 =")[1].split("\n")[0]) == list(
            wb.LEVEL_GROUP_BANDS
        )
        assert _quoted(self.MIGRATION_SRC.split("_TONES =")[1].split("\n")[0]) == list(
            wb.TONES
        )
        assert (
            "knowledge_level IS NULL OR knowledge_level >= 1" in self.MIGRATION_SRC
        )

    def test_downgrade가_3종을_복원한다(self):
        assert _quoted(
            self.MIGRATION_SRC.split("_LEVEL_GROUPS_3 =")[1].split("\n")[0]
        ) == ["elementary", "middle_high", "adult"]

    def test_신고_학령은_여전히_3종(self):
        """DB 제약을 넓혀도 가입 신고는 넓히지 않는다(§5) — expert는 출제 난이도 전용."""
        from app.schemas.auth import LevelGroup

        assert set(LevelGroup.__args__) == {"elementary", "middle_high", "adult"}


# ═══════════════════════════════════════════════════════════════
# 마이그레이션 0012 (0011 관례 — downgrade 필수·단일 head)
# ═══════════════════════════════════════════════════════════════


def _load_migration(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestMigration0012:
    def test_revision_체인(self):
        module = _load_migration(MIGRATION_0012)
        assert module.revision == "0012_two_axis_levels"
        assert module.down_revision == "0011_retry_round"

    def test_downgrade_왕복_정의(self):
        module = _load_migration(MIGRATION_0012)
        assert callable(module.upgrade) and callable(module.downgrade)
        src = MIGRATION_0012.read_text(encoding="utf-8")
        for table, column in (
            ("content_items", "knowledge_level"),
            ("users", "tone"),
        ):
            assert f'sa.Column("{column}"' in src
            assert f'op.drop_column("{table}", "{column}")' in src

    def test_단일_head(self):
        """alembic heads가 **하나** — 병렬 담당의 번호 충돌 감시(0010 관례)."""
        revisions: dict[str, str | None] = {}
        pattern = re.compile(
            r'^(revision|down_revision)(?::\s*[^=]+)?\s*=\s*(?:"([^"]+)"|None)',
            re.MULTILINE,
        )
        for path in VERSIONS_DIR.glob("*.py"):
            found = dict(
                (kind, value or None)
                for kind, value in pattern.findall(path.read_text(encoding="utf-8"))
            )
            revisions[found["revision"]] = found.get("down_revision")
        referenced = {down for down in revisions.values() if down}
        assert set(revisions) - referenced == {"0013_league_result_unique"}

    def test_모델_컬럼_계약(self):
        """둘 다 nullable·서버 기본값 없음 — NULL 폴백이 코드 소유라는 뜻(region 선례)."""
        knowledge = ContentItem.__table__.columns["knowledge_level"]
        assert knowledge.nullable is True and knowledge.server_default is None
        assert knowledge.type.__class__.__name__ == "SmallInteger"

        tone = User.__table__.columns["tone"]
        assert tone.nullable is True and tone.server_default is None
        assert tone.type.length == 16


# ═══════════════════════════════════════════════════════════════
# GET /progress/me — tone 노출 (additive, 해석된 값)
# ═══════════════════════════════════════════════════════════════


class _CountResult:
    def scalar_one(self):
        return 0


class FakeMeDB:
    async def execute(self, stmt):
        return _CountResult()


@pytest.fixture()
def me_deps(monkeypatch):
    async def fake_tier(db, user_id):
        return "stratus"

    async def fake_energy(db, user):
        return {"clouds": 5, "max": 5, "next_regen_sec": 0, "updated_at": None}

    async def fake_spine(db, user):
        return {
            "units_total": 0, "units_cleared": 0,
            "crowns_earned": 0, "crowns_total": 0, "current_unit": None,
        }

    monkeypatch.setattr(progress_router.league_service, "get_current_tier", fake_tier)
    monkeypatch.setattr(progress_router.energy_service, "get_state", fake_energy)
    monkeypatch.setattr(progress_router.curriculum_service, "get_spine", fake_spine)


class TestMeExposesTone:
    def _me(self, user):
        return asyncio.run(progress_router.get_me(user=user, db=FakeMeDB()))

    def test_미신고는_학령_파생값_노출(self, me_deps):
        """region(원본 노출)과 달리 해석된 값 — 프론트에 설정 화면이 없다(§3.2)."""
        assert self._me(make_user(level_group="elementary")).tone == "child"
        assert self._me(make_user(level_group="middle_high")).tone == "teen"

    def test_신고값_노출(self, me_deps):
        assert self._me(make_user(level_group="elementary", tone="adult")).tone == "adult"

    def test_노출값은_항상_톤_어휘_안(self, me_deps):
        for band in wb.LEVEL_GROUP_BANDS:
            assert self._me(make_user(level_group=band)).tone in wb.TONES
