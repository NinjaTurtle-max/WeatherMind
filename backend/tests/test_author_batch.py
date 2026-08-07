"""저작 배치 산출물 계약 — `scripts/author_items.py` (계약 P, CONTRACT_GEN_ITEM §2).

## 무엇을 지키는 테스트인가

배치의 산출물은 **시드 항목과 형태가 같아야** 한다(P-1). flat 생성 결과
(`concept_tag`·`question_type`·`question_text`·`options`·`correct_answer`)를
`template_json`으로 되접는 변환이 배치의 일부이고, 이 방향이 뒤집히면
`session_service.py:502-506`의 전개(`{**template_json, concept_tag, question_type}`)와
어긋나 문항이 조용히 깨진다 — API는 200을 주고 프론트만 빈 문항을 그린다.

그리고 **게이트 통과 ≠ 서버 노출 가능**이다. R10-07이 그 반례다: 시드 53문항 중
6문항이 품질 게이트를 전부 통과한 상태로 API에 노출되지 않아 풀 수 없었다. 그래서
배치는 게이트와 별개로 `QUESTION_PAYLOAD_FIELDS`(backend 단일 소유자) ∪
`GENERATED_PAYLOAD_FIELDS`(ai-worker, 계약 G-3) 기준으로 산출물을 **다시** 본다.
여기서는 그 검사가 실제로 불완전 문항을 떨어뜨리는지 확인한다.

마지막으로 저작 배치는 **되돌리기 어려운 작업**이다. `--dry-run`이 기본값이고
`--write`만 시드에 쓴다는 것을 실제 파일 바이트로 대조한다(P-3).

## 실행·의존성

DB·네트워크·LLM 키 불필요. 게이트는 ai-worker `validate_chain`을 실임포트해 쓰고
(langchain 지연 임포트라 미설치 환경에서도 동작), 생성기는 이 파일에서 대역으로
주입한다 — 폴백 뱅크 추첨에 의존하지 않아 결정적이다.
CLI 경로(dry-run/write)만 서브프로세스로 실기동한다(`GEMINI_API_KEY=""` 강제).

실행: backend에서 `python -m pytest tests -q`
"""
import dataclasses
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.routers.session import QUESTION_PAYLOAD_FIELDS
from app.services.placement_service import LEVEL_GROUPS

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "author_items.py"
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"


def _load_script():
    """scripts/author_items.py를 모듈로 로드한다 (scripts는 패키지가 아니다)."""
    spec = importlib.util.spec_from_file_location("author_items", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    # dataclasses가 실행 중 sys.modules[__module__]을 조회하므로 먼저 등록한다.
    sys.modules["author_items"] = module
    spec.loader.exec_module(module)
    return module


author_items = _load_script()


# ── 픽스처 ────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def ai():
    """실 게이트 + 실 payload 계약 (생성기는 주입하므로 langchain 불필요)."""
    return author_items.load_ai_worker(with_generator=False)


@pytest.fixture(scope="module")
def backend_contract():
    return author_items.load_backend_contract()


def _mc(text: str, *, tag: str = "typhoon", answer: str = "따뜻한 바닷물의 수증기") -> dict:
    """1차 게이트를 통과하는 최소 multiple_choice flat 문항."""
    return {
        "concept_tag": tag,
        "question_type": "multiple_choice",
        "question_text": text,
        "options": [answer, "차가운 육지의 바람", "높은 산의 눈", "사막의 모래바람"],
        "correct_answer": answer,
        "quiz_id": "20260803-001",
    }


def _slider(**overrides) -> dict:
    flat = {
        "concept_tag": "typhoon",
        "question_type": "slider",
        "question_text": "열대 저기압이 태풍으로 분류되는 최대 풍속 하한은 초속 몇 m인가?",
        "correct_answer": "17",
        "min": 0,
        "max": 40,
        "step": 1,
        "unit": "m/s",
        "quiz_id": "20260803-002",
    }
    flat.update(overrides)
    return flat


def _run_batch(ai, backend_contract, flats, level_group="middle_high", existing=()):
    """주입한 생성 대역으로 배치를 돌린다 (폴백 뱅크 추첨 비의존 — 결정적)."""
    queue = list(flats)

    def fake_generate(**kwargs):
        return queue.pop(0)

    return author_items.run_batch(
        plan=[(f.get("concept_tag", "typhoon"), level_group) for f in flats],
        weather=author_items.DEFAULT_WEATHER,
        existing=list(existing),
        backend=backend_contract,
        ai=dataclasses.replace(ai, generate=fake_generate),
    )


# ── P-1: flat → nest 변환 ─────────────────────────────────────────────────────
class TestFlatToNest:
    """생성 결과(flat) → 시드 형태(nest). 방향이 뒤집히면 문항이 깨진다."""

    def test_concept_tag와_question_type만_template_json_바깥에_있다(self):
        item = author_items.to_bank_item(_slider(), "middle_high")
        assert item["concept_tag"] == "typhoon"
        assert item["question_type"] == "slider"
        assert item["level_group"] == "middle_high"
        assert set(item) == {
            "concept_tag",
            "level_group",
            "question_type",
            "template_json",
            "uses_live_slots",
            "source",
            "status",
        }
        # 나머지는 전부 template_json 안 — 시드 실측 형태와 같은 키 집합
        assert set(item["template_json"]) == {
            "question_text",
            "correct_answer",
            "min",
            "max",
            "step",
            "unit",
        }
        assert item["status"] == "active"

    def test_시드_slider_항목과_같은_형태를_만든다(self):
        """database/seed/content_items.json의 slider 항목이 산출 형태의 근거다.

        **동일 집합이 아니라 부분집합을 본다**(R13 2일차 정정): 시드에 전수 재분류로
        `knowledge_level`이 붙었는데 생성 산출물은 그 값을 못 낸다 — 단계 판정은
        docs/specs/12 §4의 R0~R7이고, 그중 R2~R6은 사람 몫이라 생성 체인이 흉내낼 수
        없다. `level_group`에서 기계로 복원하는 것도 §5.3이 금지한다(파생은 단방향).

        따라서 생성 문항은 **미분류로 나오고, 그 상태로는 lint를 통과하지 못한다**
        (전환기 폴백 만료 후 미분류는 탈락이다). G1 배치 전에 생성 프롬프트가 단계를
        직접 신고하도록 스펙 03을 개정해야 한다 — R13-0 §3.1-5의 미완 항목이고,
        이 테스트가 그 부채를 가리키는 자리다.
        """
        seed_slider = next(
            item
            for item in json.loads(SEED_PATH.read_text(encoding="utf-8"))
            if item["question_type"] == "slider"
        )
        item = author_items.to_bank_item(_slider(), "middle_high")
        assert set(item) <= set(seed_slider)
        assert set(seed_slider) - set(item) == {"knowledge_level"}
        assert set(item["template_json"]) <= set(seed_slider["template_json"])
        assert set(item["source"]) == set(seed_slider["source"])

    def test_값이_None인_payload_필드는_버린다(self):
        """QuizQuestion.model_dump()는 비-slider에서 min·max·step·unit을 None으로 낸다.

        그대로 두면 시드에 없는 "min": null이 뱅크에 섞인다.
        """
        flat = _mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?")
        flat.update({"min": None, "max": None, "step": None, "unit": None})
        template = author_items.to_bank_item(flat, "elementary")["template_json"]
        assert "min" not in template
        assert set(template) == {"question_text", "options", "correct_answer"}

    def test_quiz_id는_template_json에_남지_않고_refs로_추적한다(self):
        item = author_items.to_bank_item(
            _slider(), "adult", refs=["quiz_id: 20260803-002"]
        )
        assert "quiz_id" not in item["template_json"]
        assert "quiz_id: 20260803-002" in item["source"]["refs"]

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("오늘 서울의 최고기온은 {today.temp_max}도입니다. 무엇을 뜻할까요?", True),
            ("강수확률이 {today.rain_prob}%일 때 우산을 챙겨야 할까요?", True),
            ("태풍이 에너지를 얻는 주된 원천은 무엇일까요?", False),
            ("today.temp_max 라는 값은 무엇을 뜻할까요? 중괄호가 없습니다", False),
        ],
    )
    def test_uses_live_slots는_today_슬롯_유무로_정해진다(self, text, expected):
        flat = _mc(text)
        assert author_items.to_bank_item(flat, "elementary")["uses_live_slots"] is expected

    def test_source_kind는_generated이고_추적_정보가_남는다(self, ai, backend_contract):
        """추적 불가능한 문항을 뱅크에 넣지 않는다 — 회수 단위가 된다 (P-1)."""
        result = _run_batch(
            ai, backend_contract, [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?")]
        )
        assert result.added == 1
        source = result.items[0]["source"]
        assert source["kind"] == "generated"
        joined = "\n".join(source["refs"])
        for expected in ("model=", "quiz_id: ", "generated_at: ", "gate1: ", "gate2: "):
            assert expected in joined, joined


# ── P-2 4단계: payload 계약 검사 ──────────────────────────────────────────────
class TestPayloadContract:
    """게이트 통과 ≠ 서버 노출 가능. 배치가 독립적으로 다시 확인한다."""

    def _errors(self, ai, backend_contract, item):
        return author_items.payload_contract_errors(
            item,
            payload_fields=backend_contract.payload_fields,
            generated_fields=ai.generated_fields,
            validate_entry=backend_contract.validate_entry,
            check_payload=ai.check_payload,
        )

    def test_완전한_slider는_통과한다(self, ai, backend_contract):
        item = author_items.to_bank_item(_slider(), "middle_high")
        assert self._errors(ai, backend_contract, item) == []

    @pytest.mark.parametrize("missing", ["min", "max", "step", "unit"])
    def test_payload_필드가_빠진_slider는_탈락한다(self, ai, backend_contract, missing):
        """min/max 없는 slider는 프론트가 0~100으로 폴백해 공짜 정답이 된다."""
        item = author_items.to_bank_item(_slider(**{missing: None}), "middle_high")
        errors = self._errors(ai, backend_contract, item)
        assert errors, f"{missing} 없는 slider가 통과했다"
        assert any(missing in e for e in errors), errors

    def test_형태가_역전된_항목은_탈락한다(self, ai, backend_contract):
        """flat을 그대로 넣는 실수(template_json 바깥에 question_text)를 잡는다."""
        broken = dict(_slider())
        broken["level_group"] = "middle_high"
        broken["template_json"] = {}
        broken["status"] = "active"
        assert self._errors(ai, backend_contract, broken)

    def test_생성_대상이_아닌_유형은_탈락한다(self, ai, backend_contract):
        """board·match·ordering·cloze는 생성 대상이 아니다 (계약 G-1)."""
        item = author_items.to_bank_item(
            {
                "concept_tag": "air_mass",
                "question_type": "board",
                "question_text": "기단을 배치해 장마전선을 만들어 보세요 (연습)",
                "correct_answer": "",
            },
            "middle_high",
        )
        assert self._errors(ai, backend_contract, item)

    def test_필드_맵은_backend_ai_worker_원본을_실임포트한다(self, ai, backend_contract):
        """손으로 베낀 사본이면 이 저장소가 계약 테스트로 막는 드리프트가 생긴다."""
        assert backend_contract.payload_fields == dict(QUESTION_PAYLOAD_FIELDS)
        assert backend_contract.level_groups == tuple(LEVEL_GROUPS)
        assert set(ai.generated_fields) == {"multiple_choice", "short_answer", "slider"}
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        assert '"min", "max", "step", "unit"' not in source, "필드 맵 사본이 생겼다"


# ── P-2 5단계: 중복 배제 ──────────────────────────────────────────────────────
class TestDedupe:
    """기존 시드 + 이번 배치 내 **양쪽**. 한쪽만 보면 쌍둥이가 통과한다."""

    def test_정규화는_공백과_문장부호를_무시한다(self):
        a = author_items.normalize_text("태풍이 에너지를 얻는 원천은?")
        b = author_items.normalize_text("  태풍이  에너지를 얻는 원천은 ??  ")
        assert a == b

    def test_기존_시드와_같은_문항은_탈락한다(self, ai, backend_contract):
        text = "태풍이 에너지를 얻는 주된 원천은 무엇일까요?"
        existing = [author_items.to_bank_item(_mc(text), "elementary")]
        result = _run_batch(
            ai, backend_contract, [_mc("태풍이 에너지를 얻는 주된 원천은  무엇일까요?")],
            existing=existing,
        )
        assert result.added == 0
        assert result.stage_counts["dup_seed"] == 1

    def test_배치_내_쌍둥이는_탈락한다(self, ai, backend_contract):
        text = "태풍이 에너지를 얻는 주된 원천은 무엇일까요?"
        result = _run_batch(ai, backend_contract, [_mc(text), _mc(text + " ")])
        assert result.added == 1
        assert result.stage_counts["dup_batch"] == 1

    def test_같은_개념_같은_정답도_중복으로_본다(self, ai, backend_contract):
        """문장만 바꾼 같은 사실 문항이 뱅크에 쌓이는 것을 막는다."""
        result = _run_batch(
            ai,
            backend_contract,
            [
                _mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?"),
                _mc("태풍의 에너지원으로 가장 알맞은 것은 무엇일까요?"),
            ],
        )
        assert result.added == 1
        assert result.stage_counts["dup_batch"] == 1

    def test_실제_시드를_기준으로도_동작한다(self, ai, backend_contract):
        """기존 53건과 대조 — 시드 항목 하나를 그대로 재생성하면 탈락한다."""
        seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        target = next(s for s in seed if s["question_type"] == "multiple_choice")
        flat = {
            **target["template_json"],
            "concept_tag": target["concept_tag"],
            "question_type": target["question_type"],
        }
        result = _run_batch(ai, backend_contract, [flat], existing=seed)
        assert result.added == 0
        assert result.stage_counts["dup_seed"] == 1


# ── P-2 7단계: 리포트 ─────────────────────────────────────────────────────────
class TestReport:
    """조용한 절삭 금지 — 탈락 사유별 건수를 0건까지 전부 출력한다."""

    def test_모든_탈락_단계를_0건까지_출력한다(self, ai, backend_contract):
        result = _run_batch(
            ai, backend_contract, [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?")]
        )
        report = author_items.format_report(
            result, seed_path=SEED_PATH, write=False
        )
        for _, label in author_items.STAGES:
            assert label in report, label
        assert "생성 시도   : 1" in report
        assert "dry-run" in report

    def test_2단_LLM_건너뜀을_명시한다(self, ai, backend_contract):
        """무키에서 2차 게이트를 건너뛴 사실이 리포트에 남아야 한다 (P-2 3단계)."""
        result = _run_batch(
            ai, backend_contract, [_mc("태풍이 에너지를 얻는 주된 원천은 무엇일까요?")]
        )
        assert result.llm_skipped == 1
        report = author_items.format_report(result, seed_path=SEED_PATH, write=False)
        assert "2차 게이트 건너뜀" in report
        assert "llm_skipped" in "\n".join(result.items[0]["source"]["refs"])

    def test_1차_게이트_탈락은_사유와_함께_보고된다(self, ai, backend_contract):
        result = _run_batch(ai, backend_contract, [_mc("짧다")])  # 10자 미만
        assert result.added == 0
        assert result.stage_counts["gate1"] == 1
        report = author_items.format_report(result, seed_path=SEED_PATH, write=False)
        assert "question_length" in report


class TestBuildPlan:
    def test_개념과_학령을_순환_배정한다(self):
        plan = author_items.build_plan(4, ("typhoon", "air_mass"), ("elementary", "adult"))
        assert plan == [
            ("typhoon", "elementary"),
            ("air_mass", "adult"),
            ("typhoon", "elementary"),
            ("air_mass", "adult"),
        ]

    def test_대상이_비면_거부한다(self):
        with pytest.raises(ValueError):
            author_items.build_plan(1, (), ("adult",))


# ── P-3·P-2 6단계: dry-run 기본값 · append-only ────────────────────────────────
def _run_cli(*args, cwd=REPO_ROOT):
    """무키 환경을 강제해 스크립트를 실기동한다."""
    env = {**os.environ, "GEMINI_API_KEY": ""}
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH), *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )


@pytest.fixture
def seed_copy(tmp_path):
    """실 시드 사본 — 원본은 절대 건드리지 않는다."""
    path = tmp_path / "content_items.json"
    path.write_bytes(SEED_PATH.read_bytes())
    return path


class TestWriteGuard:
    def test_dry_run은_시드를_건드리지_않는다(self, seed_copy):
        before = seed_copy.read_bytes()
        before_stat = seed_copy.stat()
        proc = _run_cli("--seed-path", str(seed_copy), "--count", "4", "--random-seed", "3")
        assert proc.returncode == 0, proc.stderr
        assert "dry-run" in proc.stdout
        after = seed_copy.read_bytes()
        assert hashlib.sha256(after).hexdigest() == hashlib.sha256(before).hexdigest()
        assert seed_copy.stat().st_mtime_ns == before_stat.st_mtime_ns
        assert len(json.loads(after)) == len(json.loads(before))

    def test_dry_run이_기본값이다(self, seed_copy):
        """--dry-run을 주지 않아도 쓰지 않는다 (P-3)."""
        before = seed_copy.read_bytes()
        proc = _run_cli("--seed-path", str(seed_copy), "--count", "2", "--random-seed", "3")
        assert proc.returncode == 0, proc.stderr
        assert seed_copy.read_bytes() == before

    def test_write는_기존_항목_뒤에_append만_한다(self, seed_copy):
        before = json.loads(seed_copy.read_text(encoding="utf-8"))
        proc = _run_cli(
            "--seed-path", str(seed_copy), "--count", "4", "--random-seed", "3", "--write"
        )
        assert proc.returncode == 0, proc.stderr
        after = json.loads(seed_copy.read_text(encoding="utf-8"))
        assert after[: len(before)] == before, "기존 항목이 변형됐다 (append-only 위반)"
        assert len(after) > len(before)
        for item in after[len(before):]:
            assert item["source"]["kind"] == "generated"
            assert item["status"] == "active"

    def test_write와_dry_run은_동시에_줄_수_없다(self, seed_copy):
        proc = _run_cli("--seed-path", str(seed_copy), "--write", "--dry-run")
        assert proc.returncode != 0


class TestAppendItems:
    def test_기존_항목을_보존한다(self, tmp_path):
        path = tmp_path / "seed.json"
        existing = [{"concept_tag": "typhoon", "template_json": {"question_text": "가"}}]
        path.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")
        added = author_items.append_items(
            path, [author_items.to_bank_item(_slider(), "adult")]
        )
        assert added == 1
        written = json.loads(path.read_text(encoding="utf-8"))
        assert written[0] == existing[0]
        assert written[1]["source"]["kind"] == "generated"

    def test_파일이_없으면_새로_만든다(self, tmp_path):
        path = tmp_path / "new.json"
        author_items.append_items(path, [author_items.to_bank_item(_slider(), "adult")])
        assert len(json.loads(path.read_text(encoding="utf-8"))) == 1
