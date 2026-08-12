"""섹션 예상 소요시간(`est_minutes`)이 **유닛 수에서 파생**된다 — 2026-08-12.

`est_minutes`의 소유자는 `database/seed/section_meta.json`이고, 화면(학습 경로
머리말 「예상 N분」·「예상 N일」)이 유일한 소비처다. 판정에는 안 쓰이므로 여태
**아무도 이 값의 정합을 보지 않았고**, 그 결과 시드 확장을 두 번 놓쳤다:

  · 유닛이 93 → **237개**가 되는 동안 기초과학 3섹션의 값이 8유닛 시절 그대로
    남아 있었다 — 「열과 빛」이 **32유닛인데 15분**(유닛당 0.47분)이었다.
    같은 날 확장된 기상 10섹션은 유닛당 4분으로 재산출돼 있었으므로, 한 화면에서
    52분짜리 13유닛 섹션과 15분짜리 32유닛 섹션이 나란히 떴다.
  · 종전 `test_section_meta.py`는 `est_minutes > 0`만 봤다 — 그 조건은 낡은 값도
    통과시킨다. **부재가 아니라 드리프트**를 잡으려면 파생 규칙이 필요하다.

그래서 규칙을 **명시적으로 못 박는다**:

    est_minutes == 섹션의 유닛 수 × UNIT_SESSION_SIZE × MINUTES_PER_ITEM

유닛 1개 = 세션 1회(`Settings.UNIT_SESSION_SIZE` 문항)이고 문항당 1분으로 잡는다.
지금 값(4문항 × 1분 = 유닛당 4분)이 기상 10섹션 전건과 이미 일치하므로, 이 규칙은
새로 지어낸 것이 아니라 **저작이 실제로 쓴 규칙을 글로 옮긴 것**이다.

⚠️ `UNIT_SESSION_SIZE`가 바뀌면 이 테스트가 먼저 운다 — 그때 시드를 재산출하라는
뜻이지, 여기 숫자를 맞추라는 뜻이 아니다(시드가 소유자다).
"""

import json
from pathlib import Path

import pytest

from app.core.config import settings
from app.services import curriculum_service

# 문항 1건에 잡는 시간(분). 유닛당 소요 = UNIT_SESSION_SIZE × 이 값.
MINUTES_PER_ITEM = 1

UNITS_PATH = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "units.json"
)


@pytest.fixture(autouse=True)
def _clear_meta_cache():
    curriculum_service._section_meta_cache = None
    yield
    curriculum_service._section_meta_cache = None


def _units_per_section() -> dict[str, int]:
    rows = json.loads(UNITS_PATH.read_text(encoding="utf-8"))
    counts: dict[str, int] = {}
    for row in rows:
        section = row.get("section")
        if section:
            counts[section] = counts.get(section, 0) + 1
    return counts


def test_섹션_전건이_메타를_갖는다():
    """시드에 유닛이 있는 섹션은 전건 메타가 있어야 한다.

    코스를 가리지 않는다 — 기초과학 3섹션이 빠져 있어도 화면은 조용히 아무것도
    안 그리므로(부재는 None), 사람 눈으로는 결손을 못 본다.
    """
    meta = curriculum_service.load_section_meta()
    missing = sorted(set(_units_per_section()) - set(meta))
    assert not missing, f"메타 없는 섹션: {missing}"


def test_est_minutes는_유닛_수에서_파생된다():
    """유닛당 소요 × 유닛 수 == est_minutes (전 섹션·전 코스).

    이 단정이 깨지는 정상적인 경우는 하나뿐이다 — **시드에 유닛이 늘거나 줄었다.**
    그때는 `section_meta.json`을 재산출한다(이 파일을 고치지 않는다).
    """
    meta = curriculum_service.load_section_meta()
    counts = _units_per_section()
    per_unit = settings.UNIT_SESSION_SIZE * MINUTES_PER_ITEM
    drift = {
        section: (row["est_minutes"], counts[section] * per_unit, counts[section])
        for section, row in meta.items()
        if section in counts and row["est_minutes"] != counts[section] * per_unit
    }
    assert not drift, (
        "est_minutes가 유닛 수와 어긋난다 {섹션: (현재, 기대, 유닛 수)} — "
        f"유닛당 {per_unit}분: {drift}"
    )


def test_유닛당_소요는_유닛_세션_크기와_묶여_있다():
    """규칙의 두 인자가 살아 있는지 — 상수만 조용히 바뀌는 것을 막는다.

    `UNIT_SESSION_SIZE`는 env 노브라 배포마다 다를 수 있다. 그 값이 바뀌면
    예상 소요의 뜻도 바뀌므로, 시드 재산출 없이 지나가지 않게 여기서 묶는다.
    """
    assert settings.UNIT_SESSION_SIZE >= 1
    assert MINUTES_PER_ITEM >= 1
    meta = curriculum_service.load_section_meta()
    counts = _units_per_section()
    sample = next(s for s in meta if s in counts)
    assert meta[sample]["est_minutes"] == (
        counts[sample] * settings.UNIT_SESSION_SIZE * MINUTES_PER_ITEM
    )
