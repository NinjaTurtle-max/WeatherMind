"""시드 데이터 계약 테스트 (S9) — database/seed/content_items.json이 §3.3을 준수하는가.

단일 진실원 원칙: 검증 로직을 테스트 안에 재기술하지 않고 실제 모듈을 쓴다.
- §3.3 스키마: backend app.scripts.seed_content.validate_entry (적재기가 쓰는 그 검증기)
- 품질 게이트 1단: ai-worker app.chains.validate_chain.run_heuristic_checks
  — ai-worker도 backend와 같은 최상위 패키지명 `app`을 쓰므로, sys.modules의
  backend `app.*`을 잠시 내리고 ai-worker 경로에서 임포트한 뒤 원상 복구한다.
- 허용 슬롯: backend app.services.session_service.ALLOWED_SLOTS / SLOT_RE

품질 게이트 요청 형태(§3.4)는 {"question": <template_json 형식>}이며 question에
question_type이 포함되므로, 시드의 형제 필드 question_type을 병합해 전달한다.
"""
import importlib
import json
import sys
from pathlib import Path

import pytest

from app.scripts.seed_content import validate_entry
from app.services.session_service import ALLOWED_SLOTS, SLOT_RE

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"
AI_WORKER_DIR = REPO_ROOT / "ai-worker"


def _import_ai_worker_validate_chain():
    """ai-worker의 validate_chain을 backend `app` 패키지와 충돌 없이 임포트."""
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module("app.chains.validate_chain")
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


validate_chain = _import_ai_worker_validate_chain()

SEED_ITEMS: list[dict] = json.loads(SEED_PATH.read_text(encoding="utf-8"))
ITEM_IDS = [f"{i:02d}-{item.get('concept_tag', '?')}" for i, item in enumerate(SEED_ITEMS)]


def _slots_of(item: dict) -> set[str]:
    """template_json 전체 문자열에서 {today.*} 슬롯 추출."""
    text = json.dumps(item.get("template_json", {}), ensure_ascii=False)
    return set(SLOT_RE.findall(text))


class TestSeedSchema:
    """§3.3 스키마 — 적재기(seed_content)의 검증기를 그대로 통과해야 한다."""

    def test_S8_AC_24건_이상(self):
        assert len(SEED_ITEMS) >= 24

    @pytest.mark.parametrize(
        ("index", "item"), list(enumerate(SEED_ITEMS)), ids=ITEM_IDS
    )
    def test_스키마_위반_없음(self, index, item):
        assert validate_entry(item, index) == []

    def test_시드는_전건_active(self):
        """§3.3: 시드는 사람 저작이므로 status=active로 적재."""
        assert all(item.get("status") == "active" for item in SEED_ITEMS)

    def test_source_refs_근거_연결(self):
        """CONTENT_GUIDE: source.kind=seed + climate_concepts 근거 청크 참조 필수."""
        for i, item in enumerate(SEED_ITEMS):
            source = item.get("source") or {}
            assert source.get("kind") == "seed", f"[{i}] source.kind"
            refs = source.get("refs")
            assert isinstance(refs, list) and refs, f"[{i}] source.refs 비어 있음"


class TestSeedCoverage:
    """S8 AC: 6태그 × 2학령 커버, 슬롯 문항 ≥ 6건."""

    def test_6태그_전부_존재(self):
        tags = {item["concept_tag"] for item in SEED_ITEMS}
        assert tags == {
            "pressure_front", "typhoon", "air_mass",
            "heat_island", "co2_climate", "anomaly",
        }

    def test_태그마다_2개_이상_학령_커버(self):
        coverage: dict[str, set[str]] = {}
        for item in SEED_ITEMS:
            coverage.setdefault(item["concept_tag"], set()).add(item["level_group"])
        thin = {tag: groups for tag, groups in coverage.items() if len(groups) < 2}
        assert not thin, f"학령 커버 부족 태그: {thin}"

    def test_슬롯_문항_6건_이상(self):
        live = [item for item in SEED_ITEMS if item.get("uses_live_slots")]
        assert len(live) >= 6


class TestSeedSlots:
    """§3.3 허용 슬롯 5종만 사용, uses_live_slots 플래그와 실제 사용 일치."""

    def test_허용_슬롯만_사용(self):
        for i, item in enumerate(SEED_ITEMS):
            illegal = _slots_of(item) - set(ALLOWED_SLOTS)
            assert not illegal, f"[{i}] 허용되지 않은 슬롯: {illegal}"

    def test_uses_live_slots_플래그와_실사용_일치(self):
        """플래그 false인데 슬롯이 있으면 원문 노출, true인데 없으면 live 풀 오염."""
        for i, item in enumerate(SEED_ITEMS):
            has_slots = bool(_slots_of(item))
            assert bool(item.get("uses_live_slots")) == has_slots, (
                f"[{i}] uses_live_slots={item.get('uses_live_slots')} 이지만 "
                f"슬롯 사용={has_slots}"
            )

    def test_슬라이더_정답에는_슬롯_비사용(self):
        """현 시드 계약: 슬라이더 정답은 0~100 고정 숫자 문자열 (§3.3).

        슬롯 정답 슬라이더가 추가되면 품질 게이트 slider_range와의 관계를
        먼저 정의해야 한다 — 그 전까지 이 불변식을 고정한다.
        """
        for i, item in enumerate(SEED_ITEMS):
            if item["question_type"] == "slider":
                answer = str(item["template_json"]["correct_answer"])
                assert not SLOT_RE.search(answer), f"[{i}] 슬라이더 정답에 슬롯: {answer}"


class TestHeuristicQualityGate:
    """ai-worker 품질 게이트 1단(§3.4)을 시드 26건 전체가 통과한다."""

    @pytest.mark.parametrize(
        ("index", "item"), list(enumerate(SEED_ITEMS)), ids=ITEM_IDS
    )
    def test_휴리스틱_전체_통과(self, index, item):
        question = {**item["template_json"], "question_type": item["question_type"]}
        checks = validate_chain.run_heuristic_checks(question, item["concept_tag"])
        failed = [c for c in checks if not c["passed"]]
        assert not failed, f"[{index}] 휴리스틱 실패: {failed}"
