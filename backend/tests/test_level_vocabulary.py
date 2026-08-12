"""용어 도입 단계 표 계약 — `database/seed/level_vocabulary.json` v2 (CT-1, R13 2일차).

소유 스펙: `docs/specs/12_curriculum_levels.md` §7(§7.1 스키마 · §7.3 정정 5건 ·
§7.4 판정식). 이 파일은 **어휘 데이터와 검사 규칙이 스펙에서 미끄러지지 않게**
감시한다 — 표가 데이터라서 조용히 바뀌기 쉽고, 바뀌면 저작 게이트가 소리 없이
느슨해진다(R13 1일차의 발단이 정확히 그것이었다: 검사 자체가 없어 권층운이
middle_high 정답에 들어가 있었다).

감시 대상 5가지
1. 스키마 — v1 잔재(banned_levels·reviewed_allowed) 부재 · 필수 필드 · 값 범위.
2. §7.3 정정 5건 + 잠열 확정 — 조사로 뒤집힌 판정이 되돌아가지 않는지.
3. §7.4 판정식 — 경계(같으면 통과·한 칸 아래면 탈락) · name_ok_from 분기 ·
   면제 부재(6단계에서만 전 용어 통과).
4. 전환기 폴백이 **걷힌 상태로 유지되는지** — 미분류 문항이 탈락하는지, v1의
   adult·expert 통째 면제가 되살아나지 않았는지, 본시드가 전건 분류·전건 통과인지.
5. **staging 커버리지**(CO-SN2) — `ci.sh seed`가 도는 staging 파일 목록이 실제
   디렉터리와 일치하는지, 그리고 그 문항들이 어휘 게이트를 통과하는지.

⚠️ 4번 머리에 종전 "**만료 예정** — 미분류 문항이 v1 규칙 그대로 검사되는지"라고
적혀 있었으나 폴백은 R13 2일차에 이미 걷혔고, 본문 §4는 그때부터 "걷힌 상태의 계약"을
검사하고 있었다. 독스트링만 만료 전 세계를 기술하고 있었다(2026-08-10 정정).
같은 줄이 "본시드·**staging** 전건에서"라고 적어 STAGING_DIR 상수의 존재 이유처럼
보였으나 그 상수는 어디서도 쓰이지 않는 고아였다 — §5가 그 약속을 실제로 이행한다.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from app.services import weatherbrain_service as wb  # 단계 수 N의 단일 소유자

REPO_ROOT = Path(__file__).resolve().parents[2]
VOCAB_PATH = REPO_ROOT / "database" / "seed" / "level_vocabulary.json"
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"
STAGING_DIR = REPO_ROOT / "database" / "seed" / "staging"
LINT_SOURCE = (REPO_ROOT / "scripts" / "lint_seed_items.py").read_text(encoding="utf-8")


def _load_lint():
    """scripts/lint_seed_items.py를 모듈로 로드한다 (scripts는 패키지가 아니다).

    test_author_batch._load_script와 같은 관례. lint 모듈이 author_items를 임포트
    하므로 scripts 디렉터리를 sys.path에 올려 둔다(모듈 자신이 하는 일과 동일).
    """
    scripts_dir = REPO_ROOT / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    spec = importlib.util.spec_from_file_location(
        "lint_seed_items", scripts_dir / "lint_seed_items.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["lint_seed_items"] = module
    spec.loader.exec_module(module)
    return module


lint = _load_lint()

LEVEL_GROUPS_V1 = ("elementary", "middle_high", "adult", "expert")


@pytest.fixture(scope="module")
def vocabulary() -> dict:
    return lint.load_vocabulary()


@pytest.fixture(scope="module")
def by_term(vocabulary) -> dict[str, dict]:
    return {entry["term"]: entry for entry in vocabulary["terms"]}


def _item(text: str, *, level=None, correct=None, level_group="middle_high") -> dict:
    """검사용 최소 문항. knowledge_level=None이면 전환기 폴백 경로로 떨어진다."""
    template = {"question_text": text}
    if correct is not None:
        template["correct_answer"] = correct
    item = {"level_group": level_group, "template_json": template}
    if level is not None:
        item["knowledge_level"] = level
    return item


# ── 1. 스키마 (§7.1) ──────────────────────────────────────────────────────────
def test_v1_스키마_잔재가_없다(vocabulary):
    """banned_levels·reviewed_allowed는 §7.1에서 사라진 2분법이다.

    부분 되돌림을 막는다 — 한 항목만 v1 형태로 남아도 그 용어는 새 판정식에서
    빠지는데, 검사가 조용히 통과하므로 눈에 띄지 않는다.
    """
    raw = json.loads(VOCAB_PATH.read_text(encoding="utf-8"))
    assert "banned" not in raw and "reviewed_allowed" not in raw
    for entry in vocabulary["terms"]:
        assert "banned_levels" not in entry, entry["term"]


def test_모든_항목이_필수_필드를_갖는다(vocabulary):
    for entry in vocabulary["terms"]:
        assert entry["term"].strip()
        assert entry["basis"].strip(), entry["term"]
        # standard는 값이 null일 수 있지만 **키는 있어야 한다** — 비어 있는 것이
        # "교육과정 밖" 신호가 되려면 그것이 판정 결과여야 하고, 누락과 구분돼야 한다.
        assert "standard" in entry, entry["term"]


def test_introduced_at은_1부터_6까지다(vocabulary):
    """단계 수 6은 docs/specs/12 §2의 정의표에서 온다.

    코드가 아니라 파일의 anchor 블록이 N을 소유한다(load_vocabulary가 거기서 읽는다).
    """
    # 단계 수 N을 여기 박지 않는다 — 소유자는 weatherbrain_service의 밴드 튜플
    # 하나다. 종전에는 [1..6]을 박아 놓아 10단계 확장에서 **어휘표가 옳게 늘어난
    # 것을 결함으로 신고**했다(2026-08-10 정정).
    levels = sorted(int(k) for k in vocabulary["anchor"])
    assert levels == list(range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1))
    for entry in vocabulary["terms"]:
        assert wb.KNOWLEDGE_LEVEL_MIN <= entry["introduced_at"] <= wb.KNOWLEDGE_LEVEL_MAX, (
            entry["term"]
        )


def test_name_ok_from은_introduced_at을_넘지_않는다(vocabulary):
    """이름만 쓰는 쪽이 메커니즘을 묻는 쪽보다 늦게 열릴 수는 없다."""
    for entry in vocabulary["terms"]:
        if "name_ok_from" in entry:
            assert entry["name_ok_from"] <= entry["introduced_at"], entry["term"]


def test_용어가_중복되지_않는다(vocabulary):
    terms = [entry["term"] for entry in vocabulary["terms"]]
    assert len(terms) == len(set(terms))


def test_교육과정_밖_항목은_standard가_null이다(by_term):
    """전문 검색 0건으로 확인된 것들 — 억지로 코드를 채우면 근거가 썩는다(§7.2)."""
    for term in ("알베도", "온위", "가강수량", "푄", "십운형", "온도풍"):
        assert by_term[term]["standard"] is None, term


# ── 2. §7.3 정정 5건 + 잠열 ───────────────────────────────────────────────────
@pytest.mark.parametrize(
    "term, introduced_at, standard",
    [
        # ① 2015 [6과06-04] 삭제로 초등 근거가 사라졌다 — 전 학령 허용 → 4단계.
        ("기단", 4, "[9과17-04]"),
        # ② 별책 9·20 전문 0건 — '고등 지구과학Ⅰ'은 없는 과목이다.
        #    10단계에서 **8**(학부·교육과정 밖) — standard가 null인 것이 곧 근거다.
        ("알베도", 8, None),
        # ③ 결론은 같고 근거 과목이 다르다 — 지구과학Ⅱ가 아니라 지구시스템과학.
        #    고시 근거가 진로선택이므로 10단계에서 **7**(교육과정 안의 상한)이다.
        ("지균풍", 7, "[12지시03-05]"),
        ("경도풍", 7, "[12지시03-05]"),
        # ④ '우리나라 날씨' 단원이 2022에 없다 — 확인 필요, R6으로 낮은 쪽.
        ("편서풍", 4, "[9과17-02]"),
        # ⑤ 푄은 전문 0건 / 높새바람은 사회과 추정.
        ("푄", 8, None),
        ("높새바람", 5, None),
        # 추가로 근거가 생긴 것 — [9과04-04] + [12지시03-02] 해설.
        ("잠열", 3, "[9과04-04]"),
    ],
)
def test_정정_판정이_고정된다(by_term, term, introduced_at, standard):
    """⚠️ 위 표의 **숫자는 2026-08-10에 6 → 10단계로 척도가 늘면서 옮겨졌다.**

    판정이 뒤집힌 것이 아니다 — 종전 6단계가 '진로선택 + 학부 + 실무'를 한 칸에
    담고 있었고, 그 칸을 7~10으로 펴면서 각 용어가 자기 근거에 맞는 칸으로 간
    것뿐이다. 고시 근거가 있으면 7(교육과정 안), 근거가 null이면 8(밖).
    **`standard` 열은 한 건도 안 바뀌었다** — 그것이 판정이 그대로라는 증거다.
    """
    entry = by_term[term]
    assert entry["introduced_at"] == introduced_at
    assert entry["standard"] == standard


def test_확인_필요_항목이_표시된다(by_term):
    """§9-②·④는 미확정이다 — 확정된 판정과 섞이면 다음 담당이 근거를 다시 못 판다."""
    for term in ("편서풍", "높새바람"):
        assert by_term[term].get("unconfirmed") is True, term


def test_신설_항목이_전부_힘_정량_구간이다(by_term):
    """§7.3 하단 신설 목록 — **힘·정량 구간**에 정박한다.

    종전 이름은 `test_신설_항목이_전부_6단계다`였고 `== 6`을 단정했다. 10단계
    확장에서 이 12개가 7·8로 갈렸는데 **판정이 갈린 게 아니라 구간이 갈린 것**
    이다(정역학·행성파는 진로선택 고시 근거가 있어 7, 단열선도·LCL·에크만처럼
    근거가 없는 것은 8). 그래서 단정을 **구간 하한**으로 바꾼다 — 한 칸을 못박으면
    다음 확장 때 또 같은 이유로 빨개진다.
    """
    floor = wb.KNOWLEDGE_LEVEL_BANDS.index("expert") + wb.KNOWLEDGE_LEVEL_MIN
    for term in (
        "온대저기압",
        "정역학",
        "단열선도",
        "행성파",
        "제트류",
        "에크만",
        "지형류",
        "서안강화",
        "LCL",
        "CCL",
        "LFC",
        "평형고도",
    ):
        assert by_term[term]["introduced_at"] >= floor, term


def test_온대저기압은_정본_표기를_대안으로_제시한다(by_term):
    """`[12지구01-03]` 해설이 지정한 표기다 — 난이도가 아니라 표기 규정이라

    suggest가 비면 저작자가 무엇으로 바꿔야 하는지 알 수 없다.
    """
    for term in ("온대저기압", "온대 저기압"):
        assert by_term[term]["suggest"] == "중위도 저기압", term


def test_편서풍과_편서풍_파동은_단계가_다르다(by_term):
    """한 성취기준 안에서 경계가 지나가는 사례 — 판정이 용어 단위여야 하는 이유(§3.3-②)."""
    assert by_term["편서풍"]["introduced_at"] < by_term["편서풍 파동"]["introduced_at"]


def test_anchor가_학령이_아니라_단계로_쓰여_있다(vocabulary):
    """§7.5 — 이 파일은 지식 단계만 본다. 톤(child·teen·adult)은 판정을 못 바꾼다."""
    blob = json.dumps(vocabulary["anchor"], ensure_ascii=False)
    for tone_word in ("child", "teen", "초등학생", "중·고등학생", "성인"):
        assert tone_word not in blob, tone_word


# ── 3. §7.4 판정식 ────────────────────────────────────────────────────────────
def test_같은_단계는_통과하고_한_칸_아래는_탈락한다(vocabulary):
    """경계: 탈락 조건은 `<`이지 `<=`가 아니다 — 도입 단계 문항이 그 용어를

    처음 가르치는 문항이므로 통과해야 한다.
    """
    ok = _item("기단이란 무엇인가?", level=4, correct="큰 공기 덩어리")
    assert lint.vocabulary_errors(ok, vocabulary) == []

    low = _item("기단이란 무엇인가?", level=3, correct="큰 공기 덩어리")
    reasons = lint.vocabulary_errors(low, vocabulary)
    assert len(reasons) == 1 and "기단" in reasons[0]


def test_정답에_쓰이면_introduced_at이_임계다(vocabulary):
    """R4 남용 방지 조건 2와 같은 판단 — 정답 문자열에 있으면 예외가 없다."""
    item = _item("동태평양이 따뜻해지는 현상은?", level=2, correct="엘니뇨")
    assert lint.vocabulary_errors(item, vocabulary), "정답의 엘니뇨(5)가 2단계에서 통과"


def test_배경_어휘면_name_ok_from이_임계다(vocabulary):
    """§7.1이 이 필드를 둔 이유 — '태풍이 온다는 예보를 들었을 때 할 일'이

    메커니즘을 묻지 않는데 5단계로 튀면 최하위 진입로가 사라진다.
    """
    entry = next(e for e in vocabulary["terms"] if e["term"] == "엘니뇨")
    assert entry["name_ok_from"] == 1 < entry["introduced_at"]
    item = _item("엘니뇨 소식을 들었을 때 할 일은?", level=1, correct="예보를 확인한다")
    assert lint.vocabulary_errors(item, vocabulary) == []


def test_메커니즘_질문이면_배경_어휘_예외가_풀린다(vocabulary):
    """같은 용어·같은 단계인데 '왜'가 붙으면 임계가 introduced_at으로 올라간다.

    기계 1차 패스는 보수적으로 상향한다(§8.1) — 사람이 내리는 편이 안전하다.
    """
    item = _item("엘니뇨는 왜 생기나요?", level=1, correct="바닷물이 따뜻해져서")
    assert lint.vocabulary_errors(item, vocabulary)


def test_최상위_단계_문항은_전_용어가_통과한다(vocabulary):
    """§7.4 '면제를 없앤다'의 뒷면 — 통째 면제는 사라졌지만 최상위는 다 열린다.

    단계 수를 여기 박지 않는다(종전 `level=6` 하드코딩 → 10단계 확장에서 빨개졌다).
    "최상위에서는 전부 통과"는 척도 길이와 무관한 성질이다.
    """
    blob = " ".join(entry["term"] for entry in vocabulary["terms"])
    item = _item(blob, level=wb.KNOWLEDGE_LEVEL_MAX, correct=blob)
    assert lint.vocabulary_errors(item, vocabulary) == []


def test_adult_expert_통째_면제가_사라졌다(vocabulary):
    """v1은 level_group으로 면제했다 — adult 36건이 무검사라 [58]·[98]이 통과했다.

    새 규칙은 level_group을 보지 않는다: 단계가 낮으면 어떤 밴드든 걸린다.
    """
    item = _item(
        "건조 단열 감률은 얼마인가?",
        level=5,
        correct="10℃/km",
        level_group="adult",
    )
    assert lint.vocabulary_errors(item, vocabulary)


def test_긴_용어에_포함되는_짧은_용어는_중복_보고하지_않는다(vocabulary):
    """'권층운' 적발 시 '층운'까지 두 줄로 나오면 리포트가 소음이 된다."""
    item = _item("권층운이 하늘을 덮는다", level=1, correct="권층운")
    reasons = lint.vocabulary_errors(item, vocabulary)
    assert len(reasons) == 1 and "권층운" in reasons[0]


def test_판정_대상_범위가_R0과_같다(vocabulary):
    """§4 R0: 판정 대상은 template_json **전체 문자열**이고 `_all_strings`가 그 범위다.

    검사 범위와 판정 범위가 어긋나면 통과한 문항이 오분류된다 — 해설·힌트·정답
    구조(items·pairs·goal_conditions) 어디에 숨어도 잡혀야 한다.
    """
    for field, value in (
        ("explanation_hint", "지균풍은 등압선과 나란하다"),
        ("hints", ["지균풍을 떠올려 보자"]),
        ("items", ["지균풍"]),
        ("pairs", [{"left": "지균풍", "right": "균형"}]),
        ("guide_steps", [{"text": "지균풍을 배치한다"}]),
        ("goal_conditions", {"note": "지균풍"}),
    ):
        item = {
            "level_group": "adult",
            "knowledge_level": 5,
            "template_json": {"question_text": "무엇인가?", field: value},
        }
        assert lint.vocabulary_errors(item, vocabulary), field


# ── 4. 전환기 폴백 만료 후의 계약 (R13 2일차) ────────────────────────────────
# 폴백(v1 학령 규칙 재현)은 본시드 141건 전수 재분류가 착지한 시점에 걷었다.
# 여기 있는 것은 "걷힌 상태가 유지되는가"를 지키는 계약이다 — 폴백이 되살아나면
# adult·expert 면제가 함께 돌아와 [58] 건조 단열 감률 같은 6단계 용어가 다시 샌다.


def test_미분류_문항은_탈락한다(vocabulary):
    """단계 없는 문항은 "판정 불가"가 아니라 **저작이 덜 된 것**이다.

    폴백 시절에는 미분류가 v1 규칙으로 흘러갔다. 지금은 어느 단계에 놓을지가 곧
    문항의 절반이라, 그것 없이 적재하면 6단계 체계 밖에서 서빙된다.
    """
    errors = lint.vocabulary_errors(_item("기단", level_group="elementary"), vocabulary)
    assert errors and "knowledge_level" in errors[0]


def test_폴백_흔적이_남아_있지_않다(vocabulary):
    """어휘표·코드 양쪽에서 함께 걷혔는가 — 한쪽만 남으면 조용히 되살아난다."""
    assert "transitional" not in vocabulary
    assert "legacy_banned_levels" not in vocabulary["schema"]
    assert not [t for t in vocabulary["terms"] if "legacy_banned_levels" in t]
    assert "_legacy_vocabulary_errors" not in LINT_SOURCE


def test_본시드는_전건_분류됐고_전건_통과한다(vocabulary):
    """만료 조건 그 자체 — 미분류 0건이고, 새 판정식에서 탈락도 0건이다.

    후자가 앞의 것보다 세다: 재분류가 단계만 붙이고 §7.4를 통과 못 하면 ci.sh의
    seed 단계가 붉어진다. 여기가 초록이라는 것은 141건의 단계 판정과 어휘표의
    도입 단계가 **서로 정합**하다는 뜻이다.
    """
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    assert seed, "본시드가 비었다"
    unclassified = [i for i, it in enumerate(seed) if it.get("knowledge_level") is None]
    assert not unclassified, f"미분류 {len(unclassified)}건: {unclassified[:10]}"
    for i, item in enumerate(seed):
        assert lint.vocabulary_errors(item, vocabulary) == [], f"[{i}]"


def test_새_판정식은_여전히_문다(vocabulary):
    """§7.4: '0건이 유지되면 규칙이 느슨하게 옮겨진 것이니 변환을 의심하라.'

    본시드가 전건 통과하게 된 지금, 규칙이 살아 있는지는 **단계를 한 칸 내려 보면**
    드러난다. 재분류 결과를 한 칸씩 낮춘 가상 시드에서는 탈락이 나와야 한다 —
    안 나오면 판정식이 아니라 통과 스탬프다.
    """
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    lowered = [
        dict(it, knowledge_level=max(1, int(it["knowledge_level"]) - 1)) for it in seed
    ]
    failed = [i for i, it in enumerate(lowered) if lint.vocabulary_errors(it, vocabulary)]
    assert failed, "단계를 낮춰도 아무것도 안 걸린다 — 판정식이 죽어 있다"


# ── 5. staging 커버리지 (CO-SN2, R13 5일차) ──────────────────────────────────
# `ci.sh seed`가 `lint_seed_items.py --staging`을 돌리고, 그 대상 목록의 소유자는
# `lint.staging_targets()` 하나다. 여기서 지키는 것은 **목록이 현실과 어긋나지 않는
# 것**이다 — 이 프로젝트의 반복된 실패 양식이 "예외가 이월 없이 영구화되는 것"이라
# 사람의 기억이 아니라 테스트가 만료를 통지해야 한다.
# 검사는 ⑤ 어휘 게이트로 한정한다. 5종 전 검사는 ci.sh가 소유하고, 여기서 되풀이하면
# 같은 게이트를 두 곳이 소유하게 된다.


def _staging_files() -> list[Path]:
    return sorted(STAGING_DIR.glob("*.json"))


def test_staging_파일이_전부_분류돼_있다():
    """새 staging 파일은 lint 대상이거나 **사유가 적힌 예외**여야 한다.

    빠지는 쪽으로 기울면 게이트가 조용히 좁아진다(CO-SN2의 발단 자체가 그것이다:
    ci.sh가 인자 없이 lint를 불러 staging 206항목을 아무도 안 보고 있었다).
    반대로 지워진 파일이 예외 목록에 남아 있어도 여기서 걸린다 — 유령 예외가
    "왜 있는지 모르지만 무서워서 못 지우는 줄"로 굳는 것을 막는다.
    """
    actual = {p.name for p in _staging_files()}
    classified = {p.name for p in lint.staging_targets()} | set(lint.STAGING_EXCLUDED)
    assert classified == actual, (
        f"미분류 {sorted(actual - classified)} · "
        f"유령 예외 {sorted(classified - actual)} — "
        "lint_seed_items.STAGING_TARGETS/EXCLUDED를 실제 디렉터리에 맞출 것"
    )


def test_예외에는_사유가_적혀_있다():
    """ci.sh의 OPT_IN_STEPS 선례와 같은 규약(test_ci_workflow_contract).

    사유 없는 예외는 다음 담당이 판단을 다시 못 판다 — 지워도 되는지, 남겨야 하는지.
    """
    assert lint.STAGING_EXCLUDED, "예외 목록이 비었다 — 상수 이름이 바뀌었는지 확인"
    for name, reason in lint.STAGING_EXCLUDED.items():
        assert reason.strip(), name


def test_한시_예외는_kl이_부여되면_만료된다():
    """**해제 조건을 사람이 아니라 테스트가 통지한다.**

    au1·au2가 게이트 밖인 유일한 이유는 knowledge_level이 0건이라 ⑤에서 전건
    탈락하기 때문이다(2026-08-10 실측: 두 파일 모두 탈락 사유가 ⑤ 하나뿐 — 단계만
    붙으면 나머지 4종은 이미 통과한다). 그러니 단계가 하나라도 부여되는 순간
    예외의 근거가 사라진다. 그때 이 테스트가 먼저 붉어져 목록을 가리킨다.

    ⚠️ 여기가 붉으면 **staging 데이터를 되돌리지 말고** STAGING_PENDING_LEVEL에서
    그 파일을 지워 `--staging` 게이트에 넣을 것.
    """
    for name in lint.STAGING_PENDING_LEVEL:
        items = json.loads((STAGING_DIR / name).read_text(encoding="utf-8"))
        classified = [i for i, it in enumerate(items) if it.get("knowledge_level")]
        assert not classified, (
            f"{name}에 knowledge_level이 {len(classified)}건 부여됐다 — 한시 예외의 "
            "근거가 사라졌으니 STAGING_PENDING_LEVEL에서 지우고 게이트에 넣을 것"
        )


def test_문항_파일이_아닌_예외는_실제로_문항_파일이_아니다():
    """영구 예외(파일 성격)가 "귀찮아서 뺀 문항 파일"로 변질되지 않게 한다.

    판정 기준은 파일 이름이 아니라 내용이다: 문항 배열이라면 원소가
    template_json을 가진다. r13_detective_cases.json은 배열이지만 원소가 사건
    문서(case_id·series·clues)라 여기서 걸리지 않는다 — 확장자·형태만 보고
    루프를 돌리면 깨지는 지점이 정확히 그것이었다.
    """
    for name in lint.STAGING_NOT_ITEMS:
        data = json.loads((STAGING_DIR / name).read_text(encoding="utf-8"))
        if isinstance(data, list):
            assert not any(it.get("template_json") for it in data), (
                f"{name}이 문항 배열이다 — 영구 예외에서 빼고 게이트에 넣을 것"
            )


@pytest.mark.parametrize("path", lint.staging_targets(), ids=lambda p: p.name)
def test_staging_lint_대상은_어휘_게이트를_통과한다(path, vocabulary):
    """ci.sh seed의 ⑤가 초록이라는 것의 pytest 쪽 실증.

    파일별로 파라미터화하는 이유: 어느 파일이 문 것인지가 실패 이름에 나와야
    저작 담당에게 바로 넘길 수 있다.
    """
    items = json.loads(path.read_text(encoding="utf-8"))
    assert items, f"{path.name}이 비었다"
    for i, item in enumerate(items):
        assert lint.vocabulary_errors(item, vocabulary) == [], f"{path.name}[{i}]"
