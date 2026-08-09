"""섹션 표시 메타(부제·예상 소요·세부 주제) 계약 — GET /curriculum.

시안(learn_session_mockup)이 요구하는 값인데 유닛에서 파생할 수 없어
`database/seed/section_meta.json`이 소유한다. 여기서 지키는 것:

  ① 시드에 있는 섹션은 세 값이 그대로 응답에 실린다.
  ② **시드에 없는 섹션도 트리에서 빠지지 않는다** — 메타만 비고 유닛은 그대로다.
     (구 시드·타 코스에서 섹션이 통째로 사라지면 학습 경로가 비어 버린다.)
  ③ 파일이 없거나 깨져도 트리는 동작한다(board_regions 선례).
  ④ topics는 concept_tag보다 잘게 쪼갠 값이다 — 둘을 같은 것으로 쓰지 않는다.
"""

import json

import pytest

from app.services import curriculum_service


@pytest.fixture(autouse=True)
def _clear_meta_cache():
    """프로세스 캐시를 테스트마다 비운다 — 파일을 갈아끼우는 케이스가 있다."""
    curriculum_service._section_meta_cache = None
    yield
    curriculum_service._section_meta_cache = None


def test_시드_섹션은_메타_3종을_싣는다():
    meta = curriculum_service.load_section_meta()
    assert "공기의 힘" in meta, f"시드에 '공기의 힘'이 없다: {sorted(meta)}"
    row = meta["공기의 힘"]
    assert row["subtitle"], "부제가 비어 있다"
    assert isinstance(row["est_minutes"], int) and row["est_minutes"] > 0
    assert len(row["topics"]) >= 2, f"세부 주제가 너무 적다: {row['topics']}"


def test_시드_파일의_모든_섹션이_units_json의_섹션명과_일치한다():
    """섹션명이 어긋나면 메타가 조용히 안 붙는다 — 화면에서만 티가 난다.

    양방향 검증(고아 메타 0 AND 메타 없는 섹션 0). 코스 필터를 두면 기초과학
    섹션의 메타 결손이 구조적으로 안 걸린다 — 그래서 4/7(당시 3섹션 무메타)
    결손이 감사 전까지 안 잡혔다. 전 코스를 본다."""
    root = curriculum_service.SECTION_META_PATH.parents[0]
    units = json.loads((root / "units.json").read_text(encoding="utf-8"))
    unit_sections = {u["section"] for u in units}
    meta_sections = set(curriculum_service.load_section_meta())
    orphan_meta = meta_sections - unit_sections
    missing_meta = unit_sections - meta_sections
    assert not orphan_meta, f"units.json에 없는 섹션에 메타가 달려 있다: {sorted(orphan_meta)}"
    assert not missing_meta, f"메타가 없는 섹션이 units.json에 있다: {sorted(missing_meta)}"


def test_시드의_모든_섹션이_필수값을_갖는다():
    """'공기의 힘' 하나만 보던 기존 계약을 시드 전건으로 넓힌다 — 신규 행이
    subtitle 누락·est_minutes<=0·topics 부족으로 조용히 반쪽만 저작되는 것을 잡는다."""
    meta = curriculum_service.load_section_meta()
    assert len(meta) >= 8, f"섹션이 너무 적다: {sorted(meta)}"
    for section, row in meta.items():
        assert row["subtitle"], f"[{section}] 부제가 비어 있다"
        assert isinstance(row["est_minutes"], int) and row["est_minutes"] > 0, (
            f"[{section}] est_minutes 이상: {row['est_minutes']}"
        )
        assert len(row["topics"]) >= 2, f"[{section}] 세부 주제가 너무 적다: {row['topics']}"


def test_메타가_없는_섹션은_빈_값이지_예외가_아니다():
    meta = curriculum_service.load_section_meta()
    row = meta.get("존재하지 않는 섹션", {})
    assert row.get("subtitle") is None
    assert row.get("topics", []) == []


def test_파일이_없어도_빈_dict로_디그레이드한다(monkeypatch, tmp_path):
    monkeypatch.setattr(curriculum_service, "SECTION_META_PATH", tmp_path / "없음.json")
    curriculum_service._section_meta_cache = None
    assert curriculum_service.load_section_meta() == {}


def test_파일이_깨져도_빈_dict로_디그레이드한다(monkeypatch, tmp_path):
    broken = tmp_path / "section_meta.json"
    broken.write_text("{ 이건 JSON이 아니다", encoding="utf-8")
    monkeypatch.setattr(curriculum_service, "SECTION_META_PATH", broken)
    curriculum_service._section_meta_cache = None
    assert curriculum_service.load_section_meta() == {}


def test_topics는_concept_tag와_다른_축이다():
    """topics를 concept_tag로 대체하면 한 섹션이 칩 1~2개로 뭉개진다."""
    from app.services.weatherbrain_service import CONCEPT_TAGS

    meta = curriculum_service.load_section_meta()
    all_topics = {t for row in meta.values() for t in row["topics"]}
    assert all_topics, "세부 주제가 하나도 없다"
    assert not (all_topics & set(CONCEPT_TAGS)), (
        f"topics에 concept_tag가 그대로 들어 있다: {sorted(all_topics & set(CONCEPT_TAGS))}"
    )
