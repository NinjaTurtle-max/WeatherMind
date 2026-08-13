"""문항의 **학습 수준**(knowledge_level)이 세션 응답 → 화면까지 닿는가 — 2026-08-12.

## 결함의 형태

클라이언트 지적 「학습 수준 태깅이 안 보인다」. 데이터가 없어서가 아니었다:
`content_items.knowledge_level`은 문항 1,000건 **전건** 채워져 있었다. 끊긴 것은
**통로**다 — `SessionItem` 스키마에 자리가 없어 발급 응답에서 값이 사라졌고,
프론트 세션 화면에는 `knowledge_level` 참조가 0건이었다.

CO-I-1(사람 저작 해설 193건이 화면에 안 닿던 건)과 같은 유형이라 같은 방식으로
못박는다: **데이터 → 스키마 → 응답 → 화면**의 홉을 한 파일이 전수로 붙든다.

## 이 파일이 붙드는 4가지

1. **응답에 실린다** — 뱅크 문항의 컬럼값이 발급 → question_json → SessionItem까지
   값이 보존된다(홉마다 따로 단정한다. 한 홉만 봐도 초록이 나오는 자리였다).
2. **값이 없으면 없는 채로 간다** — 파생·기본값 주입 0건. 이것이 "빈 배지를 안
   그린다"는 화면 계약의 서버 쪽 절반이다.
3. **라벨은 사본이 아니다** — 10단계 교육과정 명칭표의 소유자는
   `frontend/src/i18n/resources/{ko,en}.js`의 `ability.knowledgeLevel.name`
   하나뿐이고, 세션 화면은 `lib/abilityDisplay.js`의 파생 사전을 **import해서**
   쓴다. 세션 모듈 안에 명칭 문자열이 다시 나타나면 여기서 문다.
   (소스를 파싱해 파이썬 밖 파일을 대조하는 관례는 `test_ci_workflow_contract`·
   `test_prompt_spec_parity`·`test_session_board_item`의 선례를 따른다.)
4. **목과 서버가 같은 필드를 낸다** — 목이 이 필드를 안 내면 프론트 스모크가
   실화면을 검증하지 못한다(R10-07 §2.3이 남긴 교훈).

실행: backend 디렉토리에서
`python -m pytest tests/test_session_knowledge_level_contract.py -q`.
"""
import re
from pathlib import Path
from types import SimpleNamespace

from app.routers.session import _to_session_item
from app.schemas.session import SessionItem
from app.services import session_service as ss

from test_unit_block_recipe import LEGACY_UNIT_RECIPE, issue_session

import pytest


@pytest.fixture(autouse=True)
def _fillable_recipe(monkeypatch):
    """배합을 **뱅크만으로 채워지는 값**으로 고정한다 (2026-08-12).

    `issue_session`은 실 `create_daily_session`을 돌리는데, 기본 배합
    `{live:2,new:4,review:3,board:1}`의 `board` 블록을 `plan_bank_picks`가 아직
    **모른다**(kind 분기 미구현). 그래서 배합 합 10 중 9만 뽑히고 남은 1자리가
    quiz-generate 폴백으로 새어 이 하네스의 `_DB` 대역이 `execute`에서 죽는다.

    그 누수는 이 파일의 관심사가 아니다 — 여기서 보는 것은 `knowledge_level`이
    발급 → 응답까지 보존되는가다. 진도 블록이 켜진 옛 배합으로 고정해 세션이
    뱅크만으로 차게 만든다. **board 블록 누수 자체는 session_service 소유**이고
    `test_generated_item_persist`가 xfail로 붙들고 있다.
    """
    monkeypatch.setattr(ss, "DEFAULT_RECIPE", LEGACY_UNIT_RECIPE)
    monkeypatch.setattr(ss, "SESSION_SIZE", sum(LEGACY_UNIT_RECIPE.values()))

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"
SESSION_MODULE_DIR = FRONTEND / "src" / "modules" / "session"
ABILITY_DISPLAY = FRONTEND / "src" / "lib" / "abilityDisplay.js"
KO_RESOURCE = FRONTEND / "src" / "i18n" / "resources" / "ko.js"
EN_RESOURCE = FRONTEND / "src" / "i18n" / "resources" / "en.js"
MOCK_PATH = FRONTEND / "mock" / "apiMockPlugin.js"

FIELD = "knowledge_level"


def make_item(prefix: str, i: int, knowledge_level: int | None):
    """뱅크 문항 대역 — create_daily_session이 읽는 필드 + 이 계약의 관심 컬럼.

    test_unit_block_recipe.make_item의 사본이 아니라 **확장**이다: 그쪽은 배합을
    보느라 단계 컬럼을 안 갖췄고(그래서 서비스가 getattr로 읽는다), 여기서는 그
    컬럼이 관심사라 반드시 실어야 한다.
    """
    return SimpleNamespace(
        id=f"{prefix}-{i}",
        template_json={"question_text": f"{prefix}-{i}?", "correct_answer": "a"},
        concept_tag="typhoon",
        question_type="multiple_choice",
        knowledge_level=knowledge_level,
    )


# ═══════════════════════════════════════════════════════════════
# 계약 1 · 발급 → question_json → SessionItem 까지 값이 산다
# ═══════════════════════════════════════════════════════════════


class TestValueReachesResponse:
    def test_스키마에_자리가_있다(self):
        """이 필드가 없으면 pydantic이 라우터가 넘긴 값을 조용히 버린다."""
        assert FIELD in SessionItem.model_fields, (
            "SessionItem.knowledge_level이 사라졌다 — 라우터가 값을 넘겨도 "
            "응답에서 증발한다(이 통로가 끊겨 있던 것이 2026-08-12 지적의 원인)"
        )

    def test_발급이_컬럼값을_question_json에_남긴다(self, monkeypatch):
        """홉 1 — create_daily_session의 뱅크 entry.

        `_fetch_pools` 대역이 주는 단계값이 발급 결과에 그대로 있어야 한다.
        여기가 끊기면 이후 홉이 아무리 멀쩡해도 화면에는 None만 간다.
        """
        pool = [make_item("bank", i, knowledge_level=7) for i in range(20)]
        _session, entries = issue_session(
            monkeypatch,
            shared_pool=pool,
            unit_items=[make_item("unit", i, knowledge_level=7) for i in range(5)],
        )
        assert entries, "발급 문항이 0건 — 하네스가 깨졌다"
        levels = [e["question"].get(FIELD) for e in entries]
        assert levels == [7] * len(entries), (
            f"question_json에 단계가 안 남았다: {levels}"
        )

    def test_응답_변환이_값을_보존한다(self):
        """홉 2 — question_json → SessionItem(라우터 _to_session_item)."""
        item = _to_session_item(
            "2026-08-12-001",
            {
                "concept_tag": "typhoon",
                "question_type": "multiple_choice",
                "question_text": "태풍의 위험 반원은?",
                FIELD: 9,
            },
            "adult",
            source="bank",
            slot_filled=False,
        )
        assert item.knowledge_level == 9
        # 직렬화까지 — 필드가 exclude되면 화면에는 여전히 안 간다
        assert item.model_dump()[FIELD] == 9

    def test_두_축이_동시에_실린다(self):
        """`level_group`(표현 톤)과 `knowledge_level`(난이도)은 대체가 아니라 병기다.

        한쪽이 다른 쪽 자리를 차지하는 회귀가 이 저장소에 이미 두 번 있었다
        (CO-E-4: θ 파생 난이도가 level_group 자리로 나갔다).
        """
        item = _to_session_item(
            "2026-08-12-002",
            {"question_type": "short_answer", FIELD: 2},
            "elementary",
            source="bank",
            slot_filled=False,
        )
        assert (item.level_group, item.knowledge_level) == ("elementary", 2)


# ═══════════════════════════════════════════════════════════════
# 계약 2 · 없으면 없는 채로 간다 (파생·기본값 주입 0건)
# ═══════════════════════════════════════════════════════════════


class TestAbsentStaysAbsent:
    def test_구_세션은_None이다(self):
        """개정 전에 발급된 세션의 question_json에는 이 키가 없다."""
        item = _to_session_item(
            "2026-07-01-001",
            {"question_type": "multiple_choice", "question_text": "옛 문항"},
            "middle_high",
            source="bank",
            slot_filled=False,
        )
        assert item.knowledge_level is None, (
            "값이 없는데 무언가 채워졌다 — 화면이 빈 배지·'?'를 그리게 된다"
        )

    def test_미분류_문항은_level_group에서_역산되지_않는다(self, monkeypatch):
        """단계 미분류(None) 뱅크 문항이 발급돼도 서버가 숫자를 지어내지 않는다."""
        pool = [make_item("bank", i, knowledge_level=None) for i in range(20)]
        _session, entries = issue_session(
            monkeypatch,
            shared_pool=pool,
            unit_items=[make_item("unit", i, knowledge_level=None) for i in range(5)],
        )
        assert all(e["question"].get(FIELD) is None for e in entries), (
            "미분류 문항에 단계가 생겼다 — level_group 역산은 없는 값을 지어내는 것이다"
        )

    def test_스키마_기본값이_None이다(self):
        assert SessionItem.model_fields[FIELD].default is None


# ═══════════════════════════════════════════════════════════════
# 계약 3 · 라벨 명칭표는 단일 소유자를 쓴다 (사본 금지)
# ═══════════════════════════════════════════════════════════════


def _session_module_sources() -> dict[Path, str]:
    assert SESSION_MODULE_DIR.is_dir(), "세션 모듈 경로 변경 시 이 계약을 갱신할 것"
    return {
        path: path.read_text(encoding="utf-8")
        for path in sorted(SESSION_MODULE_DIR.glob("*.jsx"))
    }


def _label_table(resource_src: str) -> list[str]:
    """리소스의 `ability.knowledgeLevel.name` 표시명 목록 — 명칭표의 유일한 소유자.

    파이썬이 JS를 파싱할 수 없으므로 `name: { ... }` 블록의 문자열만 긁는다.
    이 파서가 0건을 돌려주면 그것도 실패다(리소스 구조가 바뀌면 계약이 무력해진다).
    """
    block = re.search(
        r"knowledgeLevel:\s*\{.*?\bname:\s*\{(.*?)\}", resource_src, re.S
    )
    assert block, "ability.knowledgeLevel.name 블록을 못 찾았다 — 명칭표가 이사했나?"
    labels = re.findall(r"\d+\s*:\s*'([^']+)'|\d+\s*:\s*\"([^\"]+)\"", block.group(1))
    flat = [a or b for a, b in labels]
    assert len(flat) >= 10, f"명칭표가 {len(flat)}칸뿐 — 파서나 리소스가 깨졌다"
    return flat


class TestLabelSingleOwner:
    def test_명칭표는_리소스가_소유한다(self):
        ko = _label_table(KO_RESOURCE.read_text(encoding="utf-8"))
        en = _label_table(EN_RESOURCE.read_text(encoding="utf-8"))
        assert len(ko) == len(en), "ko/en 명칭표 칸 수가 다르다"
        assert "중학교 유체 지구" in ko, (
            "/me 화면이 쓰는 명칭이 사라졌다 — 세션 배지가 다른 표를 보게 된다"
        )

    def test_세션_모듈에_명칭_사본이_없다(self):
        """세션 화면이 10단계 이름을 **자기 파일에 다시 적지 않는다**.

        이 저장소에서 가장 잘 기록된 실패 유형이다(콘텐츠 실측 표가 두 판 연속
        낡은 채 코드 독스트링으로 복제됐다). 라벨은 그것보다 더 잘 갈린다 —
        두 화면이 같은 단계를 다른 이름으로 부르면 사용자만 모른다.
        """
        ko_labels = _label_table(KO_RESOURCE.read_text(encoding="utf-8"))
        en_labels = _label_table(EN_RESOURCE.read_text(encoding="utf-8"))
        offenders = []
        for path, src in _session_module_sources().items():
            for label in ko_labels + en_labels:
                if label in src:
                    offenders.append(f"{path.name}: {label!r}")
        assert not offenders, (
            "세션 모듈에 단계 명칭 사본이 있다 — "
            "lib/abilityDisplay.js의 KNOWLEDGE_LEVEL_NAME을 import할 것: "
            + ", ".join(offenders)
        )

    def test_세션_화면이_공용_사전을_import한다(self):
        """사본이 없는 것만으로는 부족하다 — 실제로 소유자를 **쓰고 있어야** 한다."""
        sources = _session_module_sources()
        importers = [
            path.name
            for path, src in sources.items()
            if "KNOWLEDGE_LEVEL_NAME" in src and "abilityDisplay" in src
        ]
        assert importers, (
            "세션 모듈 어디에서도 KNOWLEDGE_LEVEL_NAME을 import하지 않는다 — "
            "학습 수준 배지가 사라졌거나 라벨을 따로 짓고 있다"
        )

    def test_공용_사전이_리소스에서_파생된다(self):
        """소유자 자신이 사본이 아닌가 — 사슬의 마지막 고리."""
        src = ABILITY_DISPLAY.read_text(encoding="utf-8")
        assert "ability.knowledgeLevel.name" in src, (
            "abilityDisplay.js가 리소스 키를 안 본다 — 라벨을 하드코딩했나?"
        )

    def test_배지_문구가_i18n_키로_외부화됐다(self):
        """ko/en 양쪽에 있어야 패리티 스모크가 초록이다."""
        for path in (KO_RESOURCE, EN_RESOURCE):
            src = path.read_text(encoding="utf-8")
            assert "knowledgeLevelAria:" in src, f"{path.name}에 배지 aria 키가 없다"


# ═══════════════════════════════════════════════════════════════
# 계약 4 · 목이 서버와 같은 필드를 낸다
# ═══════════════════════════════════════════════════════════════


class TestMockParity:
    def test_목의_세션_문항이_필드를_낸다(self):
        src = MOCK_PATH.read_text(encoding="utf-8")
        builder = re.search(
            r"function seedToSessionItem\(.*?\n\}", src, re.S
        )
        assert builder, "seedToSessionItem을 못 찾았다 — 목 구조 변경 시 갱신할 것"
        assert FIELD in builder.group(0), (
            "목의 세션 문항에 knowledge_level이 없다 — 목과 서버가 갈리면 "
            "프론트 스모크가 실화면을 검증하지 못한다(R10-07 §2.3)"
        )

    def test_목이_값을_지어내지_않는다(self):
        """시드에 없으면 null — 서버의 '파생 금지'와 같은 규칙."""
        src = MOCK_PATH.read_text(encoding="utf-8")
        assert re.search(
            rf"{FIELD}:\s*seed\.{FIELD}\s*\?\?\s*null", src
        ), "목이 단계를 파생·기본값으로 채우면 '배지 미표시' 경로를 못 만난다"


# ═══════════════════════════════════════════════════════════════
# 계약 5 · 서비스가 컬럼을 실제로 읽는다
# ═══════════════════════════════════════════════════════════════


def test_생성_문항_경로는_신고값을_그대로_쓴다():
    """생성 문항은 컬럼이 아니라 생성기 신고값이 출처다 — 두 경로가 같은 키를 쓴다."""
    entry = ss.generated_item_entry(
        {"question_type": "short_answer", FIELD: 6}, level_group="adult"
    )
    assert entry[FIELD] == 6


def test_뱅크_경로가_컬럼을_읽는다(monkeypatch):
    """서비스가 `item.knowledge_level`을 실제로 읽는지 — 값이 다르면 다르게 나온다."""
    pool = [make_item("bank", i, knowledge_level=(i % 10) + 1) for i in range(20)]
    _session, entries = issue_session(
        monkeypatch,
        shared_pool=pool,
        unit_items=[make_item("unit", i, knowledge_level=10) for i in range(5)],
    )
    seen = {e["question"].get(FIELD) for e in entries}
    assert len(seen) > 1, (
        f"모든 문항이 같은 단계로 나왔다({seen}) — 상수를 박았거나 컬럼을 안 읽는다"
    )
