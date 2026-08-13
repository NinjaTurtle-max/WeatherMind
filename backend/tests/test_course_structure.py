"""다과정 구조 (R11-01 §3 F) — 시드·스코프 순수 함수·0009 체인·API 경로 계약.

계약의 최우선 조건은 **완전 하위 호환**이라 핵심 단정을 이렇게 고정한다:
"course_id NULL(또는 속성 부재 — 기존 테스트 픽스처·0009 이전 시드)은 기본 코스
(weather) 소속"이며 판정 유일 지점은 curriculum_service.scope_units_to_course다.

함께 가드하는 것:
- 시드 정합: courses.json 2코스(weather=기존 4섹션 전부 귀속·basic-science=빈 트리),
  prereq 구조(기초과학은 기상의 선행 코스 — ROADMAP §5.1.1), units.json course 필드.
- 마이그레이션 0009: revision 체인 단일 head(0009_courses), downgrade 존재(0008 관례).
- 모델: courses 메타데이터·units.course_id nullable FK(additive).
- 라우터: /api/v1/courses 신설이 additive — 기존 /api/v1/curriculum 경로 불변.
- θ 불변: user_concept_ability에 코스 컬럼이 없다(코스별 θ 분리 금지).
"""
import asyncio
import importlib.util
import json
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.scripts import seed_courses, seed_units
from app.services import curriculum_service as cs

REPO_ROOT = Path(__file__).resolve().parents[2]
COURSES_JSON = REPO_ROOT / "database" / "seed" / "courses.json"
UNITS_JSON = REPO_ROOT / "database" / "seed" / "units.json"
VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def load_courses_seed():
    return json.loads(COURSES_JSON.read_text(encoding="utf-8"))


def load_units_seed():
    return json.loads(UNITS_JSON.read_text(encoding="utf-8"))


def make_course(slug, order=1, prereq=None, title="C", description=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=slug,
        title=title,
        description=description,
        course_order=order,
        prereq_course_id=prereq,
    )


def make_unit(course_id="unset"):
    """course_id='unset'이면 속성 자체가 없는 레거시 픽스처를 흉내낸다."""
    unit = SimpleNamespace(id=uuid.uuid4(), slug=f"u-{uuid.uuid4().hex[:6]}")
    if course_id != "unset":
        unit.course_id = course_id
    return unit


# ═══════════════════════════════════════════════════════════════
# 시드 — courses.json
# ═══════════════════════════════════════════════════════════════


class TestCoursesSeed:
    def test_두_코스_존재(self):
        slugs = {c["id"] for c in load_courses_seed()}
        assert slugs == {"weather", "basic-science"}

    def test_전_엔트리_로더_검증_통과(self):
        for index, entry in enumerate(load_courses_seed()):
            assert seed_courses.validate_entry(entry, index) == []

    def test_slug_course_order_유일(self):
        data = load_courses_seed()
        slugs = [c["id"] for c in data]
        orders = [c["course_order"] for c in data]
        assert len(slugs) == len(set(slugs))
        assert len(orders) == len(set(orders))

    def test_코스_간_선행_구조_기초과학이_기상의_선행(self):
        """ROADMAP §5.1.1 — 기초과학은 기상 코스의 선행 코스(구조만, UX는 웨이브 2)."""
        by_slug = {c["id"]: c for c in load_courses_seed()}
        assert by_slug["weather"]["prereq_course_id"] == "basic-science"
        assert by_slug["basic-science"]["prereq_course_id"] is None

    def test_prereq_전부_파일_내_해석_그리고_순환_없음(self):
        by_slug = {c["id"]: c for c in load_courses_seed()}
        for slug, entry in by_slug.items():
            seen = {slug}
            cursor = entry["prereq_course_id"]
            while cursor is not None:
                assert cursor in by_slug, f"{slug}의 prereq {cursor!r} 미해석"
                assert cursor not in seen, f"코스 선행 순환: {slug} → {cursor}"
                seen.add(cursor)
                cursor = by_slug[cursor]["prereq_course_id"]

    def test_로더가_불량_엔트리를_거른다(self):
        assert seed_courses.validate_entry({"id": "", "title": "t", "course_order": 1}, 0)
        assert seed_courses.validate_entry({"id": "x", "title": "t"}, 0)  # order 누락
        assert seed_courses.validate_entry(
            {"id": "x", "title": "t", "course_order": 1, "prereq_course_id": " "}, 0
        )


# ═══════════════════════════════════════════════════════════════
# 시드 — units.json 코스 귀속 (additive)
# ═══════════════════════════════════════════════════════════════


#: 기상 코스 섹션 = `SECTION_ORDER`의 지식 단계 10칸.
#:
#: ⚠️ **2026-08-12: 리터럴 4종에서 파생으로 바꿨다.** 종전 값은
#: `("하늘 읽기", "공기의 힘", "큰 바람", "도시와 기후")`였는데, CO-G1 순환식
#: 재구조화로 그 4종이 시드에서 통째로 사라졌다. 그 결과 아래 두 테스트가
#: **매칭 0건으로 공허하게 통과**했다 — 계약이 죽었는데 초록이라 아무도 몰랐다
#: (대장 I절 「만들어 두고 안 쓰는 것」의 전형). 리터럴을 다시 적으면 같은 일이
#: 또 생기므로 `SECTION_ORDER`에서 파생시키고, 아래에서 **매칭 건수를 단정**해
#: 공허 통과 자체를 불가능하게 만든다.
WEATHER_SECTIONS = tuple(cs.SECTION_ORDER[:10])


class TestUnitsSeedCourse:
    def test_기상_섹션_전_유닛이_weather_귀속(self):
        """계약 F: 기상 섹션의 유닛은 전부 weather 코스에 귀속(불변)."""
        matched = [e for e in load_units_seed() if e["section"] in WEATHER_SECTIONS]
        # 공허 통과 방지 — 섹션명이 낡으면 매칭 0건이 되어 아래 루프가 무의미해진다
        assert len(matched) >= 50, (
            f"기상 섹션에 매칭된 유닛이 {len(matched)}건뿐 — WEATHER_SECTIONS가 "
            "시드와 갈렸다(이 테스트가 공허하게 통과하던 실패 유형)"
        )
        for entry in matched:
            assert entry.get("course") == "weather", entry["id"]
        # 역방향: weather 코스 유닛은 전부 기상 섹션 안에 있다(양방향이라야 계약이다)
        weather = [e for e in load_units_seed() if e.get("course") == "weather"]
        assert {e["id"] for e in weather} == {e["id"] for e in matched}

    def test_참조_코스가_courses_json에_존재(self):
        course_slugs = {c["id"] for c in load_courses_seed()}
        referenced = {e["course"] for e in load_units_seed() if e.get("course")}
        assert referenced <= course_slugs

    #: specs/11 §2가 저작한 기초과학 **원 8유닛**. 이 집합은 커리큘럼이 커져도
    #: **사라지면 안 되는 것**이라 여기 남긴다(전체 목록이 아니라 하한이다).
    SPECS11_ORIGINAL_UNITS = frozenset({
        "bs-temp-vs-heat", "bs-specific-heat", "bs-radiation",
        "bs-pressure", "bs-density-buoyancy", "bs-convection-board",
        "bs-phase-change", "bs-energy-transfer",
    })

    def test_basic_science는_specs11_원8유닛을_보존한다(self):
        """기초과학 트리 계약 — **부분집합**으로 판정한다 (2026-08-12 재작성).

        ⚠️ 종전엔 id **전체 집합 등식**(8종)이었다. 2026-08-12 재산출로 기초과학이
        8 → **99유닛**이 되면서 그 등식은 저작이 늘 때마다 깨지는 핀이 됐다 —
        그런데 이 테스트가 실제로 지키려던 것은 "몇 개인가"가 아니라
        **specs/11 §2가 저작한 원 유닛이 사라지지 않았는가**다(id가 사라지면
        `user_progress` 계열의 참조가 끊긴다 — CO-Y-10의 형제 문제).
        그래서 등식을 **부분집합 + 개수 핀**으로 가른다.
        """
        bs = [e for e in load_units_seed() if e.get("course") == "basic-science"]
        ids = {e["id"] for e in bs}
        assert len(bs) == 99
        missing = self.SPECS11_ORIGINAL_UNITS - ids
        assert missing == set(), (
            f"specs/11 원 유닛이 사라졌다: {sorted(missing)} — "
            "id가 사라지면 진도 참조가 끊긴다(재배치는 되지만 삭제는 안 된다)"
        )
        assert "bs-convection-board" in {e["id"] for e in bs if e["kind"] == "board"}
        assert all(e["section"] not in WEATHER_SECTIONS for e in bs)
        # 섹션 간 선행 없음(specs/11 §2): 각 섹션 첫 유닛 prereq=null
        firsts = [e for e in bs if e["unit_order"] == 1]
        assert len(firsts) == 3
        assert all(e["prereq_unit_id"] is None for e in firsts)

    def test_units_로더가_course_필드를_수용(self):
        for index, entry in enumerate(load_units_seed()):
            assert seed_units.validate_entry(entry, index) == []

    def test_units_로더_course_누락은_여전히_통과_불량은_거른다(self):
        base = dict(load_units_seed()[0])
        legacy = {k: v for k, v in base.items() if k != "course"}
        assert seed_units.validate_entry(legacy, 0) == []  # 하위 호환(선택 필드)
        assert seed_units.validate_entry({**base, "course": ""}, 0)
        assert seed_units.validate_entry({**base, "course": 123}, 0)


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — scope_units_to_course (하위 호환 핵심 단정)
# ═══════════════════════════════════════════════════════════════


class TestScopeUnitsToCourse:
    def test_기본_코스는_NULL_귀속을_포함(self):
        """핵심 하위 호환: 0009 이전 시드·기존 유저는 weather가 기본."""
        weather = make_course("weather")
        legacy = make_unit(course_id=None)
        owned = make_unit(course_id=weather.id)
        scoped = cs.scope_units_to_course(
            [legacy, owned], weather.id, is_default=True
        )
        assert scoped == [legacy, owned]

    def test_기본_코스는_속성_부재_픽스처도_포함(self):
        """기존 989 테스트의 SimpleNamespace 유닛(course_id 무속성) 동일 동작."""
        bare = make_unit()  # course_id 속성 없음
        assert cs.scope_units_to_course([bare], None, is_default=True) == [bare]

    def test_기본_코스는_타_코스_귀속을_제외(self):
        weather, basic = make_course("weather"), make_course("basic-science", 2)
        other = make_unit(course_id=basic.id)
        assert (
            cs.scope_units_to_course([other], weather.id, is_default=True) == []
        )

    def test_비기본_코스는_자기_귀속만_NULL은_새지_않음(self):
        basic = make_course("basic-science")
        legacy = make_unit(course_id=None)
        owned = make_unit(course_id=basic.id)
        scoped = cs.scope_units_to_course(
            [legacy, owned], basic.id, is_default=False
        )
        assert scoped == [owned]

    def test_비기본_코스_미상이면_빈_스코프(self):
        """미존재 코스 방어 — NULL 귀속(레거시)이 임의 코스로 새지 않는다."""
        legacy = make_unit(course_id=None)
        assert cs.scope_units_to_course([legacy], None, is_default=False) == []


class TestCourseView:
    def test_units_total과_slug_변환(self):
        basic = make_course("basic-science", 1)
        weather = make_course("weather", 2, prereq=basic.id)
        slug_by_id = {c.id: c.slug for c in (basic, weather)}
        units = [make_unit(course_id=None), make_unit(course_id=weather.id)]

        wv = cs.course_view(weather, units, slug_by_id)
        assert wv["id"] == "weather"
        assert wv["is_default"] is True
        assert wv["prereq_course_id"] == "basic-science"
        assert wv["units_total"] == 2  # NULL 귀속 포함(하위 호환)

        bv = cs.course_view(basic, units, slug_by_id)
        assert bv["is_default"] is False
        assert bv["prereq_course_id"] is None
        assert bv["units_total"] == 0  # 빈 트리


# ═══════════════════════════════════════════════════════════════
# DB 결합부 — load_scoped_units (monkeypatch, DB 불요)
# ═══════════════════════════════════════════════════════════════


class TestLoadScopedUnits:
    def _patch(self, monkeypatch, units, courses):
        by_slug = {c.slug: c for c in courses}

        async def fake_load_units(db):
            return units

        async def fake_get_course(db, slug):
            return by_slug.get(slug)

        monkeypatch.setattr(cs, "load_units", fake_load_units)
        monkeypatch.setattr(cs, "get_course_by_slug", fake_get_course)

    def test_코스_미시드_DB는_현행_그대로_전량(self, monkeypatch):
        """courses 행이 없어도(0009 직후·테스트 DB) 기본 트리는 전량 — 회귀 0 조건."""
        units = [make_unit(course_id=None), make_unit()]
        self._patch(monkeypatch, units, courses=[])
        assert asyncio.run(cs.load_scoped_units(FakeDB())) == units

    def test_기본_코스는_NULL과_weather_귀속(self, monkeypatch):
        weather, basic = make_course("weather"), make_course("basic-science", 2)
        legacy, owned, other = (
            make_unit(course_id=None),
            make_unit(course_id=weather.id),
            make_unit(course_id=basic.id),
        )
        self._patch(monkeypatch, [legacy, owned, other], [weather, basic])
        assert asyncio.run(cs.load_scoped_units(FakeDB())) == [legacy, owned]
        assert asyncio.run(cs.load_scoped_units(FakeDB(), "weather")) == [
            legacy, owned,
        ]

    def test_비기본_코스는_자기_귀속만(self, monkeypatch):
        weather, basic = make_course("weather"), make_course("basic-science", 2)
        legacy, other = make_unit(course_id=None), make_unit(course_id=basic.id)
        self._patch(monkeypatch, [legacy, other], [weather, basic])
        assert asyncio.run(cs.load_scoped_units(FakeDB(), "basic-science")) == [
            other
        ]

    def test_미존재_비기본_코스는_빈_목록(self, monkeypatch):
        self._patch(monkeypatch, [make_unit(course_id=None)], courses=[])
        assert asyncio.run(cs.load_scoped_units(FakeDB(), "nope")) == []


class FakeDB:
    """execute에 닿으면 실패 — 위 테스트는 로드 함수가 전부 패치됐음을 함께 보장."""

    async def execute(self, stmt):  # pragma: no cover
        raise AssertionError("패치되지 않은 DB 접근")


# ═══════════════════════════════════════════════════════════════
# 마이그레이션 0009 — revision 체인·downgrade (0008 관례)
# ═══════════════════════════════════════════════════════════════


def _load_migration(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestMigration0009:
    MIGRATION = VERSIONS_DIR / "20260804_0009_courses.py"

    def test_revision_체인(self):
        module = _load_migration(self.MIGRATION)
        assert module.revision == "0009_courses"
        assert module.down_revision == "0008_daily_goal"

    def test_downgrade_왕복_정의(self):
        """0008 관례 — downgrade 필수. 실DB 왕복은 PM이 웨이브 종료 시 일괄."""
        module = _load_migration(self.MIGRATION)
        assert callable(module.upgrade) and callable(module.downgrade)
        source = self.MIGRATION.read_text(encoding="utf-8")
        # downgrade가 upgrade의 역순 전부를 다룬다 — 컬럼 드롭 + 테이블 드롭
        assert 'op.drop_column("units", "course_id")' in source
        assert 'op.drop_table("courses")' in source

    def test_단일_head는_최신_리비전(self):
        """alembic heads 단일 — 병렬 담당의 번호 충돌 감시(§2).

        head 값 자체는 최신 마이그레이션 추가 시 함께 전진한다(0010: R11-01 §8
        users.region — test_user_region.py가 0010 head를 고정).
        """
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
        heads = set(revisions) - referenced
        assert len(heads) == 1, f"alembic head가 갈라졌다: {heads}"


# ═══════════════════════════════════════════════════════════════
# 모델 메타데이터 — additive 스키마·θ 불변
# ═══════════════════════════════════════════════════════════════


class TestModelMetadata:
    def test_courses_테이블(self):
        from app.models import Base

        table = Base.metadata.tables["courses"]
        assert {"id", "slug", "title", "description", "course_order",
                "prereq_course_id"} <= set(table.columns.keys())
        prereq_fks = list(table.columns["prereq_course_id"].foreign_keys)
        assert prereq_fks and str(prereq_fks[0].column) == "courses.id"

    def test_units_course_id_nullable_FK(self):
        """additive 컬럼 — nullable(기존 행·기존 테스트 무영향)이어야 한다."""
        from app.models import Base

        column = Base.metadata.tables["units"].columns["course_id"]
        assert column.nullable is True
        fks = list(column.foreign_keys)
        assert fks and str(fks[0].column) == "courses.id"

    def test_user_concept_ability_불변_코스_컬럼_없음(self):
        """계약 F: θ는 코스를 가로질러 개념 태그 단위 — 코스별 분리 금지."""
        from app.models import Base

        columns = set(Base.metadata.tables["user_concept_ability"].columns.keys())
        assert not any("course" in name for name in columns)


# ═══════════════════════════════════════════════════════════════
# 라우터 — /api/v1/courses additive · 기존 경로 불변 · 404 코드
# ═══════════════════════════════════════════════════════════════


class TestRoutes:
    def _paths(self):
        from app.main import app

        return {route.path for route in app.routes}

    def test_코스_경로_신설(self):
        paths = self._paths()
        assert "/api/v1/courses" in paths
        assert "/api/v1/courses/{slug}" in paths

    def test_기존_커리큘럼_경로_불변(self):
        paths = self._paths()
        assert "/api/v1/curriculum" in paths
        assert "/api/v1/curriculum/units/{slug}/session" in paths

    def test_미존재_코스_404_COURSE_NOT_FOUND(self, monkeypatch):
        from fastapi import HTTPException

        from app.routers import curriculum as router_module

        async def none_course(db, slug):
            return None

        monkeypatch.setattr(
            router_module.curriculum_service, "get_course_by_slug", none_course
        )
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                router_module.get_curriculum(
                    course="nope", user=SimpleNamespace(), db=FakeDB()
                )
            )
        assert exc.value.status_code == 404
        assert exc.value.detail["code"] == "COURSE_NOT_FOUND"

    def test_코스_상세_미존재_404(self, monkeypatch):
        from fastapi import HTTPException

        from app.routers import curriculum as router_module

        async def empty_views(db):
            return []

        monkeypatch.setattr(
            router_module.curriculum_service, "course_views", empty_views
        )
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                router_module.get_course(
                    "nope", user=SimpleNamespace(), db=FakeDB()
                )
            )
        assert exc.value.status_code == 404
        assert exc.value.detail["code"] == "COURSE_NOT_FOUND"
