"""저작 CLI의 **밴드·태그 게이트** — `scripts/author_items.py` (R13 CO-O-5·6·8).

## 무엇을 지키는 테스트인가

`test_author_batch.py`가 산출물의 **형태**(flat→nest·payload 계약·중복·append-only)를
덮는다면, 여기는 배치가 **무엇을 어느 칸에 넣는가**를 덮는다. 세 결함이 근거다.

1. **CO-O-6 — expert 슬라이스를 낼 수 없었다.** `--level-group` 선택지가
   `placement_service.LEVEL_GROUPS`(배치고사 진단용 3종)에서 왔다. 뱅크가 실제로
   적재할 수 있는 밴드는 `seed_content.ALLOWED_LEVEL_GROUPS`(4종)이므로,
   저작 도구가 봐야 하는 것은 후자다.
2. **CO-O-5 — `knowledge_level`과 `level_group`이 모순된 채 적재됐다.** 플랜의
   밴드를 그대로 썼기 때문에 `kl=4`(middle_high)를 신고한 문항이
   `level_group=elementary`로 들어갔다. 같은 파일의 `expand_template`은 처음부터
   파생하고 있었으므로 두 저작 경로가 서로 반대였다.
3. **CO-O-8 — 모델 신고 태그를 대조 없이 수용했다.** 이후 게이트가 자기신고
   태그로 돌아 `concept_match`가 자기충족적으로 통과했고, 배치 플랜의 개념 분포가
   강제되지 않았다.

2·3의 처리는 **탈락이 아니라 재편입 + 집계**다(비용 게이트 G1 — 이미 지불한 LLM
콜을 버리지 않는다). 그래서 이 파일이 지켜야 할 것은 "재편입이 일어난다"와
"**일어난 사실이 리포트에 남는다**" 두 가지다. 후자가 없으면 파생 자체가
조용한 실패로 되돌아간다.

## 실행·의존성

DB·네트워크·LLM 키 불필요. 게이트는 ai-worker `validate_chain` 실임포트,
생성기는 대역 주입(폴백 뱅크 추첨 비의존 — 결정적).

실행: backend에서 `python -m pytest tests/test_author_cli_gates.py -q`
"""
import dataclasses
import importlib.util
import sys
from pathlib import Path

import pytest

from app.scripts.seed_content import ALLOWED_LEVEL_GROUPS
from app.services.placement_service import LEVEL_GROUPS as PLACEMENT_LEVEL_GROUPS
from app.services.weatherbrain_service import LEVEL_GROUP_BANDS

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "author_items.py"
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"


def _load_script():
    """`test_author_batch.py`와 **다른 모듈명**으로 로드한다.

    두 파일이 같은 `sys.modules["author_items"]` 자리를 쓰면 수집 순서에 따라
    한쪽이 다른 쪽의 모듈 객체를 덮는다 — 환경 전역 상태에 의존하는 테스트가 된다.
    """
    spec = importlib.util.spec_from_file_location("author_items_gates", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["author_items_gates"] = module
    spec.loader.exec_module(module)
    return module


author_items = _load_script()


@pytest.fixture(scope="module")
def ai():
    return author_items.load_ai_worker(with_generator=False)


@pytest.fixture(scope="module")
def backend_contract():
    return author_items.load_backend_contract()


def _mc(text: str, *, tag: str = "typhoon", **extra) -> dict:
    """1차 게이트를 통과하는 최소 multiple_choice flat 문항."""
    answer = "따뜻한 바닷물의 수증기"
    flat = {
        "concept_tag": tag,
        "question_type": "multiple_choice",
        "question_text": text,
        "options": [answer, "차가운 육지의 바람", "높은 산의 눈", "사막의 모래바람"],
        "correct_answer": answer,
        "quiz_id": "20260810-001",
    }
    flat.update(extra)
    return flat


def _run_batch(ai, backend_contract, flats, plan=None, existing=()):
    """주입한 생성 대역으로 배치를 돌린다 — 플랜을 명시할 수 있다."""
    queue = list(flats)

    def fake_generate(**kwargs):
        return queue.pop(0)

    return author_items.run_batch(
        plan=plan or [(f.get("concept_tag", "typhoon"), "middle_high") for f in flats],
        weather=author_items.DEFAULT_WEATHER,
        existing=list(existing),
        backend=backend_contract,
        ai=dataclasses.replace(ai, generate=fake_generate),
    )


# ── CO-O-6: 밴드 선택지의 소유자 ──────────────────────────────────────────────
class TestBankLevelGroups:
    def test_저작_밴드는_뱅크_적재_가능_집합에서_온다(self, backend_contract):
        """`placement_service.LEVEL_GROUPS`가 아니라 시드 적재 집합이 소유자다.

        전자는 배치고사 6문항·서로소 계약 때문에 3밴드로 고정된 **진단 도메인**
        상수라 expert가 없다. 그것을 CLI 선택지로 쓰면 expert 슬라이스를 이 도구로
        아예 낼 수 없다 — 그것이 CO-O-6의 결함이었다.
        """
        assert set(backend_contract.bank_level_groups) == set(ALLOWED_LEVEL_GROUPS)
        assert "expert" in backend_contract.bank_level_groups
        assert "expert" not in PLACEMENT_LEVEL_GROUPS

    def test_밴드_순서의_소유자는_LEVEL_GROUP_BANDS다(self, backend_contract):
        """집합(seed_content)과 순서(weatherbrain_service)의 소유자가 다르다.

        `ALLOWED_LEVEL_GROUPS`는 set이라 순서가 없고, seed_content 자신이 "밴드
        순서의 정본은 LEVEL_GROUP_BANDS"라고 적어 뒀다. 정렬을 알파벳순으로 바꾸면
        `--help`가 난이도 오름차순이 아니게 되므로 순서까지 못박는다.
        """
        assert backend_contract.bank_level_groups == tuple(LEVEL_GROUP_BANDS)

    def test_expert가_실제로_인자로_먹힌다(self, backend_contract):
        """argparse choices 회귀 — 여기가 CO-O-6이 사용자에게 드러나던 지점이다."""
        parser = author_items.build_parser(
            backend_contract.concept_tags, backend_contract.bank_level_groups
        )
        args = parser.parse_args(["--level-group", "expert"])
        assert args.level_groups == ["expert"]

    def test_배치고사_3종을_선택지로_쓰면_expert가_거부된다(self, backend_contract):
        """종전 동작의 보존 — 무엇이 고쳐졌는지 이 대조가 증언한다."""
        parser = author_items.build_parser(
            backend_contract.concept_tags, PLACEMENT_LEVEL_GROUPS
        )
        with pytest.raises(SystemExit):
            parser.parse_args(["--level-group", "expert"])


# ── CO-O-5: knowledge_level이 밴드의 권위 ─────────────────────────────────────
class TestLevelGroupDerivation:
    def test_신고_단계에서_밴드를_파생한다(self, backend_contract):
        """`kl=6` → expert. 플랜이 elementary를 요청했어도 신고가 이긴다."""
        band, derived, note = author_items.resolve_level_group(
            _mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=6),
            "elementary",
            level_group_of=backend_contract.level_group_of,
            knowledge_level_range=backend_contract.knowledge_level_range,
        )
        assert (band, derived) == ("expert", True)
        assert "요청 elementary" in note

    @pytest.mark.parametrize("raw", [None, "", "네", 0, 99])
    def test_미신고_범위밖은_파생하지_않고_요청을_유지한다(self, backend_contract, raw):
        """클램프 위장 방지 — `level_group_of`는 범위 밖을 양 끝으로 **클램프**한다.

        `kl=99`를 그대로 파생시키면 expert가 정상 판정처럼 붙어, `lint_seed_items`가
        잡아야 할 잘못된 신고가 유효한 2축 정합으로 위장된다. 미분류는 미분류로
        남아 lint에서 탈락해야 옳다(`to_bank_item` 독스트링과 같은 원칙).
        """
        band, derived, note = author_items.resolve_level_group(
            _mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=raw),
            "adult",
            level_group_of=backend_contract.level_group_of,
            knowledge_level_range=backend_contract.knowledge_level_range,
        )
        assert (band, derived) == ("adult", False)
        assert "요청 adult 유지" in note

    def test_두_저작_경로가_같은_규칙을_쓴다(self, backend_contract):
        """`run_batch`(생성)와 `expand_template`(템플릿)이 같은 파생을 해야 한다.

        R13 3일차까지 두 경로가 **서로 반대**였다 — 템플릿은 파생했고 생성은
        플랜 값을 그대로 적재했다. 같은 knowledge_level이 두 경로에서 다른 밴드로
        떨어지면 뱅크 안에서 2축 정합이 경로별로 갈린다.
        """
        for level in range(*(backend_contract.knowledge_level_range[0],
                             backend_contract.knowledge_level_range[1] + 1)):
            band, derived, _ = author_items.resolve_level_group(
                _mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=level),
                "elementary",
                level_group_of=backend_contract.level_group_of,
                knowledge_level_range=backend_contract.knowledge_level_range,
            )
            assert derived
            assert band == backend_contract.level_group_of(level)

    def test_적재된_항목의_두_축이_모순되지_않는다(self, ai, backend_contract):
        """이것이 CO-O-5의 본체다 — 실측 반례가 `lg=elementary / kl=4`였다."""
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=4)],
            plan=[("typhoon", "elementary")],
        )
        assert result.added == 1
        item = result.items[0]
        assert item["knowledge_level"] == 4
        assert item["level_group"] == backend_contract.level_group_of(4)
        assert item["level_group"] != "elementary"

    def test_재편입_사실이_항목_refs에_남는다(self, ai, backend_contract):
        """집계만으로는 **어느 문항이** 옮겨졌는지 추적이 끊긴다."""
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=6)],
            plan=[("typhoon", "elementary")],
        )
        refs = "\n".join(result.items[0]["source"]["refs"])
        assert "knowledge_level=6 파생 → expert" in refs
        assert "요청 elementary" in refs


# ── CO-O-8: 신고 태그 대조 ────────────────────────────────────────────────────
class TestConceptTagDrift:
    def test_허용_밖_태그는_탈락한다(self, ai, backend_contract):
        """어떤 태그로도 재편입할 수 없으므로 여기만 무조건 탈락이다.

        payload 단계(`validate_entry`)까지 미루면 사유가 "시드 스키마 위반"으로
        기록돼, 운영자가 **모델이 태그를 지어냈다**는 사실을 리포트에서 못 읽는다.
        """
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", tag="made_up_tag")],
            plan=[("typhoon", "middle_high")],
        )
        assert result.added == 0
        assert result.stage_counts["tag_invalid"] == 1
        assert "made_up_tag" in result.rejections[0].reasons[0]

    def test_허용_안이면_실제_태그로_재편입하고_집계한다(self, ai, backend_contract):
        """콜을 버리지 않는다(G1). 대신 어긋난 사실을 반드시 센다."""
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", tag="air_mass")],
            plan=[("typhoon", "middle_high")],
        )
        assert result.added == 1
        assert result.items[0]["concept_tag"] == "air_mass"
        assert result.tag_drift[("typhoon", "air_mass")] == 1

    def test_요청과_같으면_드리프트가_0이다(self, ai, backend_contract):
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", tag="typhoon")],
            plan=[("typhoon", "middle_high")],
        )
        assert result.tag_drift == {}


# ── 파생의 대가: 드리프트 리포트 ──────────────────────────────────────────────
class TestDriftReport:
    """재편입으로 콜을 살리는 선택은 **집계가 보일 때만** 정당하다."""

    def test_요청_대비_산출을_밴드별로_출력한다(self, ai, backend_contract):
        result = _run_batch(
            ai,
            backend_contract,
            [
                _mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=6),
                _mc("태풍의 눈에서는 어떤 날씨가 나타날까요?", knowledge_level=6),
            ],
            plan=[("typhoon", "elementary"), ("typhoon", "elementary")],
        )
        report = author_items.format_report(result, seed_path=SEED_PATH, write=False)
        assert "드리프트" in report
        assert "재편입: elementary→expert 2" in report
        # 요청 2 · 산출 0인 밴드가 **표에서 사라지지 않아야** 한다 — 부족분이
        # 안 보이면 운영자가 추가 배치를 돌릴 근거를 잃는다.
        assert "elementary" in report and "expert" in report

    def test_부족분이_음수로_보인다(self, ai, backend_contract):
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=6)],
            plan=[("typhoon", "elementary")],
        )
        rows = author_items._distribution_rows(
            result.requested_bands, result.produced_bands
        )
        joined = "\n".join(rows)
        assert "-1" in joined and "+1" in joined

    def test_드리프트가_0이어도_절이_사라지지_않는다(self, ai, backend_contract):
        """조용한 절삭 금지 — 0건도 출력한다(P-2 7단계와 같은 규칙)."""
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", knowledge_level=3)],
            plan=[("typhoon", "middle_high")],
        )
        report = author_items.format_report(result, seed_path=SEED_PATH, write=False)
        assert "재편입: 0건" in report
        assert "tag_drift: 0건" in report
        assert "허용 밖 태그 탈락: 0건" in report

    def test_파생_불가_건수를_따로_센다(self, ai, backend_contract):
        """미신고는 재편입이 아니라 **요청 밴드 유지**다 — 섞으면 원인이 지워진다."""
        result = _run_batch(
            ai,
            backend_contract,
            [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?")],  # knowledge_level 없음
            plan=[("typhoon", "middle_high")],
        )
        assert result.band_underived == 1
        assert result.band_drift == {}
        report = author_items.format_report(result, seed_path=SEED_PATH, write=False)
        assert "파생 불가(미신고·범위 밖 → 요청 밴드 유지): 1건" in report
