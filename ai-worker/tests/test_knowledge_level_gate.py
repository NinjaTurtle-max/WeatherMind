"""신고된 `knowledge_level`을 검증하는 결정적 1차 게이트 (스펙 03 §2.1).

## 이 스위트가 지키는 것

R13 2일차에 전환기 폴백이 만료되면서 `knowledge_level` 없는 문항은 lint에서 그 자체로
탈락하게 됐다. 3일차에 생성 프롬프트가 단계를 **신고**하도록 스펙 03을 개정했는데,
신고를 그대로 믿으면 "6단계 용어를 쓴 2단계 문항"이 뱅크에 들어간다 —
`docs/specs/12` §8.2가 실측한 사고(`adult` 36건 무검사 → 실무 수치 유입)의 생성판이다.

그래서 검증이 필요하고, 그 검증은 **키 없이 도는 1차 게이트**여야 한다(비용 게이트가
기본 상태이므로 2차 LLM 게이트에 두면 지금 아무것도 검증하지 못한다).

## 특히 동치성 테스트

같은 판정식이 `scripts/lint_seed_items.vocabulary_errors`에도 있다. 합칠 수 없고
(빌드 컨텍스트가 다르다 — `knowledge_level` 모듈 독스트링), 대조 대상도 다르다
(생성 flat ↔ 뱅크 중첩). 그래서 **드리프트 감시를 테스트로 세운다**: 같은 문항에
두 구현이 같은 메시지를 내야 한다. 한쪽만 고치면 여기서 깨진다.

DB·네트워크·LLM 키 불필요. 실행: `cd ai-worker && python -m pytest tests -q`.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

from app.chains import knowledge_level as kl
from app.chains import validate_chain
from app.chains.payload_contract import QuizQuestion
from app.chains.quiz_gen_chain import FALLBACK_QUESTIONS

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"


@pytest.fixture(scope="module")
def vocabulary() -> dict:
    return kl.load_vocabulary()


def _check(question: dict) -> dict:
    """gate1에서 단계 체크 1건만 꺼낸다."""
    checks = validate_chain.run_heuristic_checks(question, question.get("concept_tag"))
    by_name = {c["name"]: c for c in checks}
    assert "knowledge_level_vocabulary" in by_name, "체크가 배열에서 사라졌다"
    return by_name["knowledge_level_vocabulary"]


def _mc(**overrides) -> dict:
    question = {
        "concept_tag": "pressure_front",
        "knowledge_level": 4,
        "question_type": "multiple_choice",
        "question_text": "한랭전선이 지나간 뒤 기온은 어떻게 되는가?",
        "options": ["내려간다", "올라간다", "그대로다", "밤에만 오른다"],
        "correct_answer": "내려간다",
    }
    question.update(overrides)
    return question


# ── 어휘표 로딩 ─────────────────────────────────────────────────────────────
class TestVocabularyLoading:
    def test_v3_스키마를_읽는다(self, vocabulary):
        assert vocabulary["version"] == 3
        assert vocabulary["terms"] and vocabulary["mechanism_markers"]

    def test_단계_수_N은_코드가_아니라_anchor가_정한다(self, vocabulary):
        """N을 코드에 박으면 6→7 분할(docs/specs/12 §3.1) 때 여기부터 거짓말이 된다."""
        assert kl.max_knowledge_level(vocabulary) == len(vocabulary["anchor"])
        assert not hasattr(kl, "KNOWLEDGE_LEVEL_MAX"), (
            "상한을 모듈 상수로 박았다 — N은 어휘표 anchor가 소유한다"
            "(마이그레이션 0012가 상한 CHECK를 걸지 않은 것과 같은 이유)"
        )

    def test_v1_스키마는_거부한다(self, tmp_path):
        bad = tmp_path / "v1.json"
        bad.write_text('{"banned": [], "reviewed_allowed": []}', encoding="utf-8")
        with pytest.raises(ValueError, match="v1 스키마"):
            kl.load_vocabulary(bad)

    def test_환경변수로_경로를_지정할_수_있다(self, monkeypatch, vocabulary):
        """컨테이너에 database/seed 마운트가 없을 때의 탈출구."""
        monkeypatch.setenv(kl.VOCABULARY_PATH_ENV, str(kl.resolve_vocabulary_path()))
        assert kl.resolve_vocabulary_path().name == kl.VOCABULARY_FILENAME

    def test_없는_경로를_지정하면_예외다(self, monkeypatch):
        """조용히 폴백하면 게이트가 꺼진 줄 모른다."""
        monkeypatch.setenv(kl.VOCABULARY_PATH_ENV, "/nonexistent/level_vocabulary.json")
        with pytest.raises(FileNotFoundError):
            kl.resolve_vocabulary_path()


# ── 게이트 판정 ─────────────────────────────────────────────────────────────
class TestGateVerdict:
    def test_미신고는_해당_없음_통과(self):
        """저작 시드의 서버 전개형에는 이 키가 없다 — lint 검사 ⑤ 소관."""
        question = _mc()
        question.pop("knowledge_level")
        check = _check(question)
        assert check["passed"] is True
        assert "해당 없음" in check["reason"]

    def test_신고가_맞으면_통과(self):
        check = _check(_mc(knowledge_level=4))
        assert check["passed"] is True, check["reason"]

    def test_낮게_신고하면_탈락한다(self):
        """정답에 '한랭전선'(introduced_at 4)이 있는데 2단계로 신고한 경우."""
        check = _check(
            _mc(
                knowledge_level=2,
                question_text="찬 공기가 따뜻한 공기를 파고드는 전선은 무엇인가?",
                options=["한랭전선", "온난전선", "정체전선", "폐색전선"],
                correct_answer="한랭전선",
            )
        )
        assert check["passed"] is False
        assert "한랭전선" in check["reason"] and "도입 단계 4" in check["reason"]

    def test_선지에만_있어도_잡는다(self):
        """R0: 판정 대상은 질문뿐 아니라 template_json 전체 문자열이다."""
        check = _check(
            _mc(
                knowledge_level=2,
                question_text="다음 중 하늘 높이 뜨는 구름은 무엇인가?",
                options=["권층운", "안개", "이슬", "서리"],
                correct_answer="안개",
            )
        )
        assert check["passed"] is False and "권층운" in check["reason"]

    def test_생활_상용어_예외가_산다(self, vocabulary):
        """`name_ok_from`이 없으면 태풍 **대처 행동** 문항이 5단계로 튄다.

        docs/specs/12 §7.1이 이 필드 하나로 오탈락 6건을 막았다고 적은 그 자리다.
        """
        엘니뇨 = next(t for t in vocabulary["terms"] if t["term"] == "엘니뇨")
        assert (엘니뇨["introduced_at"], 엘니뇨["name_ok_from"]) == (5, 1)
        # 배경 어휘로만 등장 + 메커니즘 표지 없음 → name_ok_from(1) 적용
        background = _mc(
            knowledge_level=1,
            concept_tag="anomaly",
            question_text="엘니뇨 소식이 뉴스에 나왔다. 우리가 매일 할 수 있는 일은?",
            options=["물을 아껴 쓴다", "창문을 깬다", "불을 지른다", "쓰레기를 버린다"],
            correct_answer="물을 아껴 쓴다",
        )
        assert _check(background)["passed"] is True
        # 같은 용어라도 메커니즘을 물으면 introduced_at(5)이 임계다
        mechanism = dict(
            background,
            question_text="엘니뇨가 나타나는 까닭은 무엇인가?",
        )
        assert _check(mechanism)["passed"] is False

    @pytest.mark.parametrize("bad", [0, -1, "4", 4.0, True, None])
    def test_정수_1_이상이_아니면_탈락(self, bad):
        question = _mc(knowledge_level=bad)
        if bad is None:
            # None은 "미신고"와 같게 취급한다(선택 필드 관례)
            assert _check(question)["passed"] is True
            return
        assert _check(question)["passed"] is False

    def test_상한을_넘는_신고는_탈락(self, vocabulary):
        over = kl.max_knowledge_level(vocabulary) + 1
        check = _check(_mc(knowledge_level=over))
        assert check["passed"] is False and str(over) in check["reason"]

    def test_어휘표를_못_읽으면_통과시키지_않는다(self, monkeypatch):
        """게이트가 조용히 꺼지는 것은 게이트가 없는 것과 같다."""
        monkeypatch.setattr(
            kl, "load_vocabulary", lambda *a, **k: (_ for _ in ()).throw(OSError("없음"))
        )
        check = _check(_mc())
        assert check["passed"] is False
        assert "어휘표를 읽을 수 없어" in check["reason"]


# ── 생성 경로와의 접점 ───────────────────────────────────────────────────────
class TestGenerationPath:
    def test_신고는_스키마가_필수로_막는다(self):
        """선택으로 두면 모델이 빠뜨리고, 빠뜨린 문항은 lint에서 전건 탈락한다."""
        bare = {k: v for k, v in _mc().items() if k != "knowledge_level"}
        with pytest.raises(ValueError, match="knowledge_level"):
            QuizQuestion(**bare)

    def test_폴백_뱅크가_어휘_게이트를_통과한다(self):
        """무키 환경의 전 세션이 이 뱅크로 돈다 — 여기가 걸리면 서비스가 멈춘다."""
        for raw in FALLBACK_QUESTIONS:
            check = _check(dict(raw))
            assert check["passed"] is True, f"{raw['question_text']}: {check['reason']}"

    def test_폴백_뱅크_전건이_단계를_신고한다(self, vocabulary):
        max_level = kl.max_knowledge_level(vocabulary)
        for raw in FALLBACK_QUESTIONS:
            level = raw.get("knowledge_level")
            assert isinstance(level, int) and 1 <= level <= max_level, raw


# ── lint와의 동치성 (드리프트 감시) ──────────────────────────────────────────
@pytest.fixture(scope="module")
def lint_module():
    """`scripts/lint_seed_items`를 실임포트한다 (모듈 최상단은 stdlib뿐이라 가볍다)."""
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        return importlib.import_module("lint_seed_items")
    finally:
        sys.path.remove(str(SCRIPTS_DIR))


class TestParityWithLint:
    """두 구현이 같은 문항에 **같은 말**을 해야 한다.

    합칠 수 없는 중복이라(빌드 컨텍스트가 다르다) 감시로 대신한다 — 이 저장소가
    XP 상수·board 벡터·목 배합에 쓰는 것과 같은 처방이다.
    """

    def test_판정_상수가_같다(self, lint_module):
        assert kl.ANSWER_FIELDS == lint_module.ANSWER_FIELDS

    @pytest.mark.parametrize(
        "level,template",
        [
            # 통과
            (4, {"question_text": "한랭전선이 지나간 뒤 기온은 어떻게 되는가?",
                 "correct_answer": "내려간다"}),
            # 정답에 상위 용어
            (2, {"question_text": "찬 공기가 파고드는 전선은?",
                 "correct_answer": "한랭전선"}),
            # 선지에만 상위 용어 (배경 어휘)
            (3, {"question_text": "다음 중 높은 구름은?",
                 "options": ["권층운", "안개"], "correct_answer": "안개"}),
            # 6단계 용어 다발
            (1, {"question_text": "지균풍과 전향력의 관계를 고르시오.",
                 "options": ["평형이다", "무관하다"], "correct_answer": "평형이다"}),
            # 생활 상용어 예외
            (1, {"question_text": "엘니뇨 소식을 들었을 때 할 일은?",
                 "correct_answer": "물을 아껴 쓴다"}),
            # 메커니즘 표지 + 배경 어휘
            (1, {"question_text": "엘니뇨가 생기는 까닭은?",
                 "correct_answer": "바람이 약해진다"}),
            # ordering — items가 정답 자리
            (2, {"question_text": "순서대로 배열하라.",
                 "items": ["권운", "권층운", "난층운"], "correct_answer": "0,1,2"}),
        ],
    )
    def test_같은_문항에_같은_메시지를_낸다(self, lint_module, vocabulary, level, template):
        nested = {
            "concept_tag": "pressure_front",
            "level_group": "middle_high",
            "knowledge_level": level,
            "question_type": "multiple_choice",
            "template_json": dict(template),
        }
        flat = {
            **template,
            "concept_tag": "pressure_front",
            "question_type": "multiple_choice",
            "knowledge_level": level,
        }
        assert kl.vocabulary_violations(
            flat, level, vocabulary
        ) == lint_module.vocabulary_errors(nested, vocabulary)

    def test_본시드_전건에_대해_두_구현이_일치한다(self, lint_module, vocabulary):
        """합성 벡터가 아니라 **실물 154건**으로 대조한다.

        (본시드는 lint 전건 통과 상태이므로 양쪽 다 빈 목록이어야 정상이지만, 이
        테스트가 지키는 것은 "0건"이 아니라 "두 구현이 같다"이다.)
        """
        import json

        seed = json.loads(
            (REPO_ROOT / "database" / "seed" / "content_items.json").read_text(
                encoding="utf-8"
            )
        )
        for item in seed:
            level = item.get("knowledge_level")
            if level is None:
                continue
            flat = {
                **item["template_json"],
                "concept_tag": item["concept_tag"],
                "question_type": item["question_type"],
                "knowledge_level": level,
            }
            assert kl.vocabulary_violations(
                flat, int(level), vocabulary
            ) == lint_module.vocabulary_errors(item, vocabulary), item["template_json"][
                "question_text"
            ]
