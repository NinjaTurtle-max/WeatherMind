"""템플릿 확장기 회귀 — `scripts/author_items.py::expand_template` (CO-D3).

## 왜 이 파일이 필요한가

템플릿 확장은 **LLM 콜 없이 결정적으로 문항을 불리는 경로**다(1,000건 대량 생산의 주
경로 중 하나). 그런데 2026-08-10 실측으로 이 함수를 참조하는 곳이 `author_items.py`
하나뿐이었고, `backend/tests`·`ai-worker/tests` 어디에도 참조가 **0건**이었다.
`test_author_batch.py`는 같은 파일의 `to_bank_item`·`run_batch`·`dedupe_keys`를 덮지만
확장기는 한 줄도 덮지 않고, `scripts/ci.sh`의 authoring 단계는 `--dry-run --count 3`
= `run_batch` 경로만 돌린다. 즉 **`--expand-templates`는 CI에서 한 번도 실행된 적이
없었다** — 여기가 조용히 깨져도 게이트가 초록이었다.

`ci.sh`를 고칠 필요는 없다. `run_pytest_in "backend"`가 `backend/tests`를 통째로
돌리므로 이 파일을 놓는 것만으로 게이트에 들어간다.

## 무엇을 지키는가 — 확장기가 **보장해야 하는** 성질

1. **2축 정합**: 산출물의 `level_group`은 `knowledge_level`에서 파생된 값이어야 한다.
   확장기는 처음부터 `level_group_of(knowledge_level)`로 파생했고(같은 파일의
   `run_batch`가 이걸 안 해서 CO-O-5가 열렸다), 그 규칙이 유지되는지 본다.
2. **저작 게이트 통과**: 산출물이 `seed_content.validate_entry`(적재 가능성)와
   ai-worker `check_payload`(계약 G)를 실제로 통과한다. 사본이 아니라 소유자 코드를
   실임포트해 태운다.
3. **자기 중복 금지**: 한 번의 확장이 `dedupe_keys` 기준 쌍둥이를 만들지 않는다.
4. **불량 입력에 조용히 통과하지 않는다**: 미정의 파라미터·중복 오답·좁은 slider 범위·
   알 수 없는 answer.kind·필수 키 부재가 전부 예외가 된다.
5. **결정성·재현성**: 같은 입력에서 항상 같은 파일이 나온다(골든 회귀).

## 골든 파일

`database/seed/staging/r13_template_proof.json`(21건)이
`r13_item_templates.json`의 확장 산출물과 **바이트까지 동일**함을 2026-08-10에 실측
확인하고 골든으로 채택했다(추정이 아니라 대조 결과다 — 21/21, 18,599바이트 일치).
템플릿 정의 파일을 의도적으로 고쳤다면 골든도 함께 갱신해야 한다:
`python scripts/author_items.py --expand-templates database/seed/staging/r13_item_templates.json \
    --out database/seed/staging/r13_template_proof.json`

## 실행·의존성

DB·네트워크·LLM 키 불필요. 게이트는 실임포트(langchain 지연 임포트라 미설치에서도 동작).
CLI 경로만 서브프로세스로 실기동한다(`GEMINI_API_KEY=""` 강제 — `test_author_batch`의
`_run_cli` 선례와 같은 방식).

실행: backend에서 `python -m pytest tests/test_expand_template.py -q`
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "author_items.py"
STAGING_DIR = REPO_ROOT / "database" / "seed" / "staging"
TEMPLATES_PATH = STAGING_DIR / "r13_item_templates.json"
GOLDEN_PATH = STAGING_DIR / "r13_template_proof.json"
BOARD_RULES_PATH = REPO_ROOT / "database" / "seed" / "board_rules.json"


def _load_script():
    """scripts/author_items.py를 모듈로 로드한다 (scripts는 패키지가 아니다).

    `test_author_batch.py::_load_script`와 **같은 관례**다 — 새 방식을 만들지 않는다.
    """
    spec = importlib.util.spec_from_file_location("author_items", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    # dataclasses가 실행 중 sys.modules[__module__]을 조회하므로 먼저 등록한다.
    sys.modules["author_items"] = module
    spec.loader.exec_module(module)
    return module


author_items = _load_script()


# ── 픽스처 (전부 module scope — 교차 컨텍스트 임포트가 비싸다) ────────────────
@pytest.fixture(scope="module")
def level_group_of():
    """knowledge_level → level_group 파생 함수 (backend가 단독 소유)."""
    return author_items.load_level_group_deriver()


@pytest.fixture(scope="module")
def backend_contract():
    return author_items.load_backend_contract()


@pytest.fixture(scope="module")
def ai():
    """실 게이트 + 실 payload 계약 (생성기 미임포트 — langchain 불필요)."""
    return author_items.load_ai_worker(with_generator=False)


@pytest.fixture(scope="module")
def expanded(level_group_of):
    """실 템플릿 정의 파일의 확장 산출물."""
    return author_items.expand_template_file(TEMPLATES_PATH, level_group_of)


@pytest.fixture(scope="module")
def golden():
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def _template(**overrides) -> dict:
    """1차 게이트 무관·확장만 보는 최소 템플릿 (기본은 multiple_choice/field)."""
    base = {
        "id": "t_synth",
        "concept_tag": "pressure_front",
        "knowledge_level": 4,
        "question_type": "multiple_choice",
        "level_basis": "테스트 픽스처",
        "text": "{front}이 지나갈 때의 날씨는?",
        "params": [
            {"front": "한랭전선", "weather": "강한 비가 짧게"},
            {"front": "온난전선", "weather": "약한 비가 길게"},
            {"front": "정체전선", "weather": "여러 날 비가 계속"},
            {"front": "폐색전선", "weather": "비 구역이 넓게 남음"},
        ],
        "answer": {"kind": "field", "field": "weather"},
    }
    base.update(overrides)
    return base


def _expand(level_group_of, **overrides) -> list[dict]:
    return author_items.expand_template(_template(**overrides), level_group_of)


# ═════════════════════════════════════════════════════════════════════════════
# 1. 골든 회귀 · 결정성
# ═════════════════════════════════════════════════════════════════════════════
class TestGoldenRegression:
    """조용한 실패: 확장 규칙이 바뀌었는데 아무도 모른 채 1,000건이 새 규칙으로 나온다.

    확장기는 **정답까지 기계가 도출**한다(사람이 행마다 적지 않는다). 규모가 커지면
    사람이 정답을 검수할 수 없으므로, 도출 규칙의 변화는 산출물 대조로만 잡을 수 있다.
    """

    def test_실_템플릿_확장이_골든_산출물과_같다(self, expanded, golden):
        assert len(expanded) == len(golden) == 21
        assert expanded == golden

    def test_골든이_CLI_직렬화와_바이트까지_같다(self, expanded):
        """골든 파일이 실제로 `--expand-templates --out`의 산출물 형식이라는 근거.

        형식(들여쓰기·ensure_ascii·끝 개행)이 갈리면 골든 갱신 diff가 전 행 변경으로
        나와 내용 변화가 묻힌다.
        """
        payload = json.dumps(expanded, ensure_ascii=False, indent=2) + "\n"
        assert payload == GOLDEN_PATH.read_text(encoding="utf-8")

    def test_확장은_결정적이다(self, level_group_of):
        """무작위가 섞이면 같은 템플릿이 실행마다 다른 뱅크를 만든다 — 재현 불가."""
        first = author_items.expand_template_file(TEMPLATES_PATH, level_group_of)
        second = author_items.expand_template_file(TEMPLATES_PATH, level_group_of)
        assert first == second

    def test_인스턴스_순서가_파라미터_표_순서다(self, level_group_of):
        """행 순서 = 인스턴스 순서. 뒤섞이면 골든·source.refs 추적이 전부 어긋난다."""
        items = _expand(level_group_of)
        assert [i["template_json"]["correct_answer"] for i in items] == [
            "강한 비가 짧게",
            "약한 비가 길게",
            "여러 날 비가 계속",
            "비 구역이 넓게 남음",
        ]


# ═════════════════════════════════════════════════════════════════════════════
# 2. 2축 정합 — 이 함수의 올바름의 핵심
# ═════════════════════════════════════════════════════════════════════════════
class TestTwoAxisConsistency:
    """조용한 실패: `level_group`과 `knowledge_level`이 한 항목 안에서 서로를 부정한다.

    `knowledge_level=4`(중학 유체지구)인 문항이 `level_group="elementary"`로 적재되면
    적재는 성공하고(둘 다 개별로는 허용값) 세션 배합만 조용히 틀린다 — 초등 학습자에게
    중학 문항이 나간다. 시드의 "2축 정합 위반 0건"이 저작 경로로 깨지는 통로가 이것이고,
    같은 파일의 `run_batch`가 실제로 그랬다(CO-O-5).
    """

    def test_모든_산출물의_밴드가_지식수준에서_파생된다(self, expanded, level_group_of):
        violations = [
            (i["knowledge_level"], i["level_group"])
            for i in expanded
            if i["level_group"] != level_group_of(i["knowledge_level"])
        ]
        assert violations == []

    @pytest.mark.parametrize("knowledge_level", [1, 2, 3, 4, 5, 6])
    def test_전_단계에서_밴드를_파생한다(self, level_group_of, knowledge_level):
        """밴드 경계 전건. 파생표를 상수로 베껴 두면 6→7 분할 때 여기가 먼저 운다."""
        items = _expand(level_group_of, knowledge_level=knowledge_level)
        expected = level_group_of(knowledge_level)
        assert {i["level_group"] for i in items} == {expected}
        assert {i["knowledge_level"] for i in items} == {knowledge_level}

    def test_템플릿이_밴드를_직접_적어도_무시하고_파생한다(self, level_group_of):
        """조용한 실패: 저작자가 손으로 적은 밴드가 파생을 이기면 2축이 다시 갈린다.

        파생은 "규칙이 하나"일 때만 보장이다. 템플릿에 `level_group`을 넣어도
        산출물은 `knowledge_level`이 정한 밴드여야 한다.
        """
        items = _expand(level_group_of, knowledge_level=4, level_group="expert")
        assert {i["level_group"] for i in items} == {level_group_of(4)} != {"expert"}

    def test_밴드가_적재_허용_집합_안이다(self, expanded, backend_contract):
        """파생 결과가 `validate_entry`의 허용 밴드 밖이면 뱅크에 못 들어간다."""
        allowed = set(backend_contract.bank_level_groups) | set(
            backend_contract.level_groups
        )
        assert {i["level_group"] for i in expanded} <= allowed


# ═════════════════════════════════════════════════════════════════════════════
# 3. 저작 게이트 — 산출물이 실제로 적재·노출 가능한가
# ═════════════════════════════════════════════════════════════════════════════
class TestAuthoringGates:
    """조용한 실패: 확장 산출물이 게이트를 못 통과하는데 CLI가 exit 0으로 끝난다.

    `--expand-templates`는 `run_batch`와 달리 **payload 계약을 스스로 돌리지 않는다**
    (`author_items.main`의 확장 분기는 `expand_template_file` → 파일 쓰기가 전부다).
    그 검사는 `lint_seed_items`가 나중에 하는데, 확장과 lint 사이에 사람 손이 끼면
    "게이트를 통과하지 못하는 산출물 N건"이 조용히 staging에 쌓인다. 여기서 먼저 본다.
    """

    def test_전건이_시드_스키마_검증을_통과한다(self, expanded, backend_contract):
        """`seed_content.validate_entry` — 적재 가능성(board 포함 전 유형)."""
        errors = [
            e
            for index, item in enumerate(expanded)
            for e in backend_contract.validate_entry(item, index)
        ]
        assert errors == []

    def test_board_아닌_산출물이_payload_계약을_통과한다(
        self, expanded, backend_contract, ai
    ):
        """`QUESTION_PAYLOAD_FIELDS` ∪ `GENERATED_PAYLOAD_FIELDS` + 계약 G 전체.

        cloze `___` 마커 · match pairs 정합 · ordering 항등 순열 · `shuffled is True` ·
        slider 값 6규칙까지 `check_payload`가 서버 전개형에 실제로 적용된다.
        """
        errors = [
            e
            for index, item in enumerate(expanded)
            if item["question_type"] != "board"
            for e in author_items.payload_contract_errors(
                item,
                payload_fields=backend_contract.payload_fields,
                generated_fields=ai.generated_fields,
                validate_entry=backend_contract.validate_entry,
                check_payload=ai.check_payload,
                index=index,
            )
        ]
        assert errors == []

    def test_board는_계약_G_대상이_아니다(self, ai):
        """board를 계약 G에 넣으면 안 된다는 판단이 살아 있는지 확인한다.

        board 채점은 문항 안에서 닫히지 않는다 — `board_rules.json`을 읽어 재판정해야
        하는데 `payload_contract`는 stdlib+pydantic까지로 의존이 못박혀 있어 판정할 수
        없다(모듈 독스트링). 판정 못 하면 막을 수도 없으므로 제외가 정답이다.
        **이 테스트가 깨진다 = 누군가 board를 계약 G에 넣었다** → 그 순간 위
        `test_board_아닌_...`의 board 제외도 함께 재검토해야 한다.
        """
        assert "board" not in ai.generated_fields
        with pytest.raises(ValueError, match="생성 대상이 아닌"):
            ai.check_payload({"question_type": "board"})

    def test_board_산출물이_서버가_재판정할_수_있는_형태다(self, expanded):
        """board는 계약 G가 안 보므로 **여기서만** 형태를 본다.

        조용한 실패: goal_conditions의 존 인덱스나 현상 이름이 어긋난 퍼즐은 적재도
        되고 화면에도 뜨지만 **아무리 배치해도 통과되지 않는다**. 서버가 같은
        `board_rules.json`으로 재판정하므로 정답이 비어 있는 것은 정상이지만,
        목표 조건이 규칙 파일과 맞지 않으면 도달 불가능한 문항이 된다.
        """
        rules = json.loads(BOARD_RULES_PATH.read_text(encoding="utf-8"))
        phenomena = {r["then"]["phenomenon"] for r in rules}
        zones = author_items.load_board_zones()
        boards = [i for i in expanded if i["question_type"] == "board"]
        assert boards, "board 산출물이 사라졌다 — 이 검사가 빈 루프가 됐다"
        for item in boards:
            template = item["template_json"]
            # 정답은 서버 소유 — 템플릿이 만들지 않는다.
            assert template["correct_answer"] == ""
            assert template["initial_state"]["zones"] == zones
            assert template["palette"], "palette가 비면 배치할 조각이 없다"
            assert template["hints"], "hints가 비면 목표를 읽을 단서가 없다"
            for goal in template["goal_conditions"]:
                assert goal["phenomenon"] in phenomena
                assert 0 <= goal["zone"] < len(zones)

    def test_실황_슬롯과_템플릿_파라미터가_섞이지_않는다(self, level_group_of):
        """조용한 실패: `{today.temp_max}`가 저작 시점에 치환돼 실황이 얼어붙는다.

        치환 축이 둘이다 — 실황 슬롯(런타임·서버 소유)과 템플릿 파라미터(저작 시점).
        `TEMPLATE_PARAM_RE`가 점을 포함하지 않는 이유가 이것이고, 뒤집히면 "오늘 기온"
        문항이 저작한 날의 기온으로 고정된 채 매일 나간다.
        """
        items = _expand(
            level_group_of, text="{front} 통과 시 기온 {today.temp_max}℃는?"
        )
        assert items[0]["template_json"]["question_text"].endswith(
            "기온 {today.temp_max}℃는?"
        )
        assert items[0]["template_json"]["question_text"].startswith("한랭전선")
        assert all(i["uses_live_slots"] is True for i in items)

    def test_실황_슬롯이_없으면_uses_live_slots가_거짓이다(self, expanded):
        """실 템플릿 21건은 실황을 안 쓴다 — True로 오표기되면 세션이 헛되이 주입한다."""
        assert all(i["uses_live_slots"] is False for i in expanded)

    def test_산출물이_정답_도출_근거를_남긴다(self, expanded):
        """조용한 실패: 기계가 도출한 정답의 출처가 사라지면 사후 검수가 불가능하다.

        1,000건 규모에서 사람은 정답을 다시 못 푼다 — refs의 (템플릿 id · 파라미터 행 ·
        도출식 · 단계 근거) 4행이 유일한 감사 경로다.
        """
        for item in expanded:
            refs = item["source"]["refs"]
            assert item["source"]["kind"] == "template"
            assert len(refs) == 4
            assert refs[0].startswith("template: ")
            assert refs[1].startswith("params[")
            assert refs[2].startswith("정답 도출: ")
            assert refs[3].startswith("knowledge_level=")


# ═════════════════════════════════════════════════════════════════════════════
# 4. 자기 중복 — 확장이 쌍둥이를 만들지 않는가
# ═════════════════════════════════════════════════════════════════════════════
class TestSelfDuplication:
    """조용한 실패: 파라미터 표를 늘렸는데 실제로는 같은 문항이 N개 나온다.

    확장기는 "행 하나 = 문항 하나"를 전제로 규모를 약속한다. 그 전제가 깨지면
    `run_batch`의 배치 내 중복 배제(dup_batch)가 뒤늦게 잘라내거나, 확장 경로에는
    그 배제가 아예 없으므로 그대로 staging에 쌓인다.

    ⚠️ 기존 시드(`content_items.json`)와의 비충돌은 **단정하지 않는다** — staging
    206항목 중 183건이 이미 본시드에 들어가 있어(2026-08-09 실측) 거짓 실패가 된다.
    여기서 보는 것은 "한 번의 확장이 자기 안에서 쌍둥이를 만드는가"뿐이다.
    """

    def test_텍스트_키가_서로_다르다(self, expanded):
        keys = [author_items.dedupe_keys(i)[0] for i in expanded]
        assert len(set(keys)) == len(keys)

    def test_정답_지문이_있는_산출물의_정답_키가_서로_다르다(self, expanded):
        """board는 정답이 비어 있어 제외 — `lint_seed_items.answer_key_active`와 같은 규칙.

        board 3건의 정답 키는 전부 `board|pressure_front|`로 겹치지만, 호출측이 정답
        지문이 없는 문항을 아예 키에서 빼므로 결함이 아니다. 그 규칙을 여기서 재현한다.
        """
        keys = [
            author_items.dedupe_keys(i)[1]
            for i in expanded
            if author_items.answer_signature(i)
        ]
        assert len(set(keys)) == len(keys)
        assert len(keys) == 18  # 21 - board 3

    def test_ordering_정답_지문이_항목_내용을_포함한다(self, level_group_of):
        """조용한 실패(CO-C5·W-3): ordering 정답이 위치 나열이라 내용이 달라도 키가 같다.

        `"0,1,2"`는 무엇을 늘어놓든 같은 문자열이다. 정답 키가 내용을 안 보면 태그당
        3~4건이 상한이 되고, 저작을 늘려도 전부 dup으로 탈락한다(커밋 f2ddb38).
        """
        items = author_items.expand_template(
            _template(
                question_type="ordering",
                text="{topic}의 순서를 맞춰라",
                params=[
                    {"topic": "구름 생성", "seq": "0,1,2", "a": "상승", "b": "냉각", "c": "응결"},
                    {"topic": "강수 과정", "seq": "0,1,2", "a": "병합", "b": "성장", "c": "낙하"},
                ],
                answer={"kind": "field", "field": "seq"},
                extra_template={"items": ["{a}", "{b}", "{c}"], "shuffled": True},
            ),
            level_group_of,
        )
        assert items[0]["template_json"]["correct_answer"] == "0,1,2"
        assert items[1]["template_json"]["correct_answer"] == "0,1,2"
        signatures = {author_items.answer_signature(i) for i in items}
        assert len(signatures) == 2, "정답이 같아도 항목 내용이 다르면 키가 갈려야 한다"
        keys = {author_items.dedupe_keys(i)[1] for i in items}
        assert len(keys) == 2

    def test_slider_정답_지문이_측정축을_포함한다(self, level_group_of):
        """조용한 실패: "17 m/s"와 "17 ℃"가 같은 키가 되어 한쪽이 dup으로 탈락한다."""
        base = {
            "question_type": "slider",
            "knowledge_level": 3,
            "text": "{label} 값은?",
            "answer": {
                "kind": "formula",
                "expr": "v",
                "slider": {"min": 0, "max": 100, "step": 1, "unit": "{unit}"},
            },
            "params": [{"label": "풍속", "v": 17, "unit": "m/s"}],
        }
        first = author_items.expand_template(_template(**base), level_group_of)
        second_params = {"label": "기온", "v": 17, "unit": "℃"}
        second = author_items.expand_template(
            _template(**{**base, "params": [second_params]}), level_group_of
        )
        assert first[0]["template_json"]["correct_answer"] == "17"
        assert second[0]["template_json"]["correct_answer"] == "17"
        assert author_items.answer_signature(first[0]) != author_items.answer_signature(
            second[0]
        )


# ═════════════════════════════════════════════════════════════════════════════
# 5. 불량 입력 — 조용히 통과하지 않는가
# ═════════════════════════════════════════════════════════════════════════════
class TestMalformedInput:
    """조용한 실패: 잘못된 템플릿이 예외 없이 '그럴듯한' 문항을 낸다.

    확장은 사람이 손으로 쓴 JSON을 입력으로 받고 산출물은 검수 없이 규모로 쌓인다 —
    입력 결함은 **확장 시점에 크게 실패**하지 않으면 뱅크에 들어간 뒤에 발견된다.
    """

    def test_미정의_파라미터는_그대로_노출되지_않고_예외다(self, level_group_of):
        """치환 실패를 남기면 "{front}이 지나갈 때…"가 그대로 유저에게 보인다."""
        with pytest.raises(KeyError, match="템플릿 파라미터"):
            _expand(level_group_of, text="{nonexistent}은 무엇인가?")

    def test_오답이_정답과_겹치면_예외다(self, level_group_of):
        """siblings 오답이 정답이 되는 표. 1차 게이트는 이걸 못 본다.

        `options_unique`·`answer_in_options`는 "보기가 서로 다른가"만 보지 어느 보기가
        참인지는 모른다 — 정답이 둘인 문항이 게이트를 통과해 뱅크에 들어간다.
        """
        with pytest.raises(ValueError, match="siblings 오답이 정답"):
            _expand(
                level_group_of,
                params=[
                    {"front": "한랭전선", "weather": "비"},
                    {"front": "온난전선", "weather": "비"},
                ],
            )

    def test_slider_범위가_좁으면_예외다(self, level_group_of):
        """채점 관용오차가 절대값 10이라 좁은 범위는 아무 값이나 정답이 된다."""
        with pytest.raises(ValueError, match="하한"):
            _expand(
                level_group_of,
                question_type="slider",
                text="{label} 값은?",
                params=[{"label": "풍속", "v": 5}],
                answer={
                    "kind": "formula",
                    "expr": "v",
                    "slider": {"min": 0, "max": 10, "step": 1, "unit": "m/s"},
                },
            )

    def test_수식에_임의_파이썬을_넣을_수_없다(self):
        """저작 JSON은 사람이 쓰는 데이터다 — 코드 실행 통로를 만들지 않는다."""
        with pytest.raises(ValueError, match="허용되지 않은 문법"):
            author_items.eval_formula("__import__('os').getcwd()", {})
        with pytest.raises(ValueError, match="허용되지 않은 문법"):
            author_items.eval_formula("v.__class__", {"v": 1})

    def test_수식의_미정의_이름은_예외다(self):
        with pytest.raises(KeyError):
            author_items.eval_formula("mass * delta", {"mass": 2})

    def test_알_수_없는_answer_kind는_예외다(self, level_group_of):
        """새 kind를 추가하다 오타를 내면 조용히 정답 없는 문항이 나오면 안 된다."""
        with pytest.raises(ValueError, match="알 수 없는 answer.kind"):
            _expand(level_group_of, answer={"kind": "typo_kind"})

    @pytest.mark.parametrize(
        "missing", ["params", "answer", "knowledge_level", "question_type", "text"]
    )
    def test_필수_키가_없으면_예외다(self, level_group_of, missing):
        template = _template()
        del template[missing]
        with pytest.raises(KeyError):
            author_items.expand_template(template, level_group_of)

    def test_정의_파일_version이_1이_아니면_예외다(self, level_group_of, tmp_path):
        """스키마가 바뀌었는데 낡은 확장기로 돌리면 산출물이 조용히 어긋난다."""
        path = tmp_path / "t.json"
        path.write_text(json.dumps({"version": 2, "templates": []}), encoding="utf-8")
        with pytest.raises(ValueError, match="version"):
            author_items.expand_template_file(path, level_group_of)

    def test_빈_파라미터_표는_예외다(self, level_group_of):
        """조용한 실패: 파라미터 표를 실수로 비우면 그 템플릿만 산출 0건이 된다.

        확장 CLI는 총 건수만 출력하므로(21 → 18) 템플릿 하나가 통째로 증발한 것을
        사람이 알아채기 어렵다. "행 하나 = 문항 하나"가 이 설계의 약속이면 행이 0인
        표는 저작 실수이지 정상 입력이 아니다.
        """
        with pytest.raises((ValueError, KeyError)):
            _expand(level_group_of, params=[])

    def test_템플릿이_하나도_없는_정의_파일은_예외다(self, level_group_of, tmp_path):
        """조용한 실패: 확장이 아무것도 안 했는데 성공으로 보고된다.

        `--out` 경로에 `[]`가 쓰이고 종료 코드 0이라, 이어지는 lint·적재 단계도
        "0건 통과"로 초록이 된다 — 파이프라인 전체가 헛돈다.
        """
        path = tmp_path / "t.json"
        path.write_text(json.dumps({"version": 1, "templates": []}), encoding="utf-8")
        with pytest.raises((ValueError, KeyError)):
            author_items.expand_template_file(path, level_group_of)


# ═════════════════════════════════════════════════════════════════════════════
# 6. CLI 실기동 — `--expand-templates`가 CI에서 한 번도 안 돌던 경로 (CO-D3 본체)
# ═════════════════════════════════════════════════════════════════════════════
def _run_cli(*args):
    """무키 환경을 강제해 스크립트를 실기동한다 (`test_author_batch._run_cli` 선례)."""
    env = {**os.environ, "GEMINI_API_KEY": ""}
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH), *args],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )


class TestExpandCli:
    """조용한 실패: 라이브러리 함수는 멀쩡한데 CLI 분기가 깨져 있다.

    `main()`의 확장 분기(인자 파싱 → `load_level_group_deriver` → 직렬화 → `--out`
    쓰기 → 종료 코드)는 `run_batch` 경로와 공유하는 코드가 거의 없다. `ci.sh`의
    authoring 단계가 `--dry-run --count 3`만 돌리므로 이 분기는 CI에서 **한 번도**
    실행된 적이 없었다 — CO-D3가 가리키는 구멍이 정확히 여기다.
    """

    def test_out으로_확장하면_골든과_바이트까지_같다(self, tmp_path):
        out = tmp_path / "expanded.json"
        proc = _run_cli(
            "--expand-templates", str(TEMPLATES_PATH), "--out", str(out)
        )
        assert proc.returncode == 0, proc.stderr
        assert out.read_text(encoding="utf-8") == GOLDEN_PATH.read_text(
            encoding="utf-8"
        )
        assert "21건" in proc.stdout

    def test_out_없이_돌리면_표준출력으로_낸다(self):
        proc = _run_cli("--expand-templates", str(TEMPLATES_PATH))
        assert proc.returncode == 0, proc.stderr
        assert len(json.loads(proc.stdout)) == 21

    def test_확장은_시드를_건드리지_않는다(self):
        """조용한 실패: 확장 모드가 본시드에 쓰면 되돌리기 어려운 작업이 된다.

        확장은 생성 경로와 완전히 분리된 모드다 — LLM을 부르지 않고 시드에도 쓰지
        않는다(산출물은 staging 파일로 나가고 lint가 검사한다).
        """
        seed = REPO_ROOT / "database" / "seed" / "content_items.json"
        before = seed.read_bytes()
        proc = _run_cli("--expand-templates", str(TEMPLATES_PATH))
        assert proc.returncode == 0, proc.stderr
        assert seed.read_bytes() == before

    def test_없는_파일을_주면_1로_실패한다(self, tmp_path):
        """조용한 실패: 경로 오타가 exit 0 + 빈 산출물이 되면 배치가 헛돈다."""
        proc = _run_cli("--expand-templates", str(tmp_path / "nope.json"))
        assert proc.returncode == 1
        assert "템플릿 확장 실패" in proc.stderr

    def test_불량_정의_파일은_1로_실패한다(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text(json.dumps({"version": 9, "templates": []}), encoding="utf-8")
        proc = _run_cli("--expand-templates", str(bad))
        assert proc.returncode == 1
        assert "템플릿 확장 실패" in proc.stderr
