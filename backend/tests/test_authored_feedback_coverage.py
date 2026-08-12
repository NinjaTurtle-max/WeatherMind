"""저작 피드백 커버리지 — 「해설 없는 문항 = 매 답안 LLM 1콜」을 0으로 묶는다.

왜 이 파일이 필요한가
---------------------
`answer_service.build_feedback`(:209)는 **board 판정 → 사람 저작 해설 →
RAG(LLM)** 3단으로 피드백을 고른다. 그래서 `template_json.explanation_hint`가
비어 있는 비board 문항만 **답안이 들어올 때마다** 유료 호출을 낸다. CO-I-1
배선 시점에 그 잔여가 45건이었고, 2026-08-13에 45건을 저작해 **0건**이 됐다.

0이 된 것을 지키는 장치가 없으면 다음 저작 배치가 해설 없는 문항을 도로
넣는다 — 그때 붉어지는 곳이 여기다. `lint_seed_items`는 해설의 **존재**를
필수로 보지 않는다(REQUIRED_FIELDS 밖). 이 계약은 그 빈틈만 문다.

⚠️ 이 파일은 해설의 **참·거짓을 보지 않는다.** 게이트가 초록인 채로 채점 결함
2건이 발견된 전례가 있으므로(CARRYOVER_R13 §1.1e), 내용 검수는 사람 몫이고
여기서 지키는 것은 커버리지와 형식뿐이다.

탐정 케이스 쪽은 `test_detective_router.py`가 정답 가설·supporting_clues·
min_clues를 이미 문다. 여기서는 **그쪽이 안 보는 두 가지** — 단서가 가리키는
시계열 좌표(metric_id·x)가 실재하는지와 가상 사건 고지(fictional·data_note)가
붙어 있는지 — 만 덧댄다. 좌표가 어긋나면 차트에 기준선이 그려지지 않아
「조사한 것이 그림에 남는다」는 화면 계약이 조용히 깨진다.

실행: backend 디렉토리에서
      `python -m pytest tests/test_authored_feedback_coverage.py -q`
"""
import json
from pathlib import Path

import pytest

SEED_DIR = Path(__file__).resolve().parents[2] / "database" / "seed"
CONTENT_PATH = SEED_DIR / "content_items.json"
CASES_PATH = SEED_DIR / "detective_cases.json"

# 해설이라고 부를 수 있는 최소 길이. 정답을 한 번 되풀이한 것(대개 20자 미만)을
# 해설로 세지 않기 위한 하한이지 품질 기준이 아니다 — 본시드 실측 최단 30자.
MIN_HINT_LEN = 25


@pytest.fixture(scope="module")
def items() -> list[dict]:
    return json.loads(CONTENT_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cases() -> list[dict]:
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


def _hint(item: dict) -> str:
    return str((item.get("template_json") or {}).get("explanation_hint") or "").strip()


class TestExplanationHintCoverage:
    """비board 전건에 사람 저작 해설이 있다 = 상시 LLM 과금 지점 0."""

    def test_비board_문항은_전부_해설을_갖는다(self, items):
        missing = [
            (i["concept_tag"], (i["template_json"].get("question_text") or "")[:34])
            for i in items
            if i.get("question_type") != "board" and not _hint(i)
        ]
        assert not missing, (
            f"해설 없는 비board 문항 {len(missing)}건 — 이 문항들은 답안이 들어올 "
            f"때마다 rag_feedback(LLM)을 부른다(answer_service.build_feedback): {missing[:10]}"
        )

    def test_해설은_정답_한_줄_되풀이보다_길다(self, items):
        """길이 하한 — 한 낱말 해설이 '있음'으로 세어져 계약을 통과하면 안 된다."""
        short = [
            (i["concept_tag"], _hint(i))
            for i in items
            if i.get("question_type") != "board" and 0 < len(_hint(i)) < MIN_HINT_LEN
        ]
        assert not short, f"{MIN_HINT_LEN}자 미만 해설: {short}"

    def test_해설은_문항_페이로드가_아니라_피드백에만_실린다(self):
        """풀기 전 노출 금지 계약이 여전히 살아 있는지 이 파일에서도 확인한다.

        커버리지를 100%로 올리는 순간 '해설을 갖는 문항'이 전건이 되므로,
        노출 화이트리스트가 흔들리면 전건이 한꺼번에 새어 나간다.
        """
        from app.routers.session import QUESTION_PAYLOAD_FIELDS

        assert "explanation_hint" not in QUESTION_PAYLOAD_FIELDS


class TestDetectiveClueAnchors:
    """단서가 가리키는 차트 좌표가 실재한다 — 어긋나면 기준선이 사라진다."""

    def test_단서의_metric_id와_x가_시계열에_실재한다(self, cases):
        broken = []
        for case in cases:
            points = {
                s["metric_id"]: {p["x"] for p in s["points"]} for s in case["series"]
            }
            for clue in case["clues"]:
                mid = clue.get("metric_id")
                if mid is None:
                    continue  # metric_id는 선택 필드(schemas/detective.py)
                if mid not in points:
                    broken.append((case["case_id"], clue["clue_id"], f"없는 계열 {mid}"))
                elif clue.get("x") is not None and clue["x"] not in points[mid]:
                    broken.append(
                        (case["case_id"], clue["clue_id"], f"{mid}에 없는 시점 {clue['x']}")
                    )
        assert not broken, f"차트에 표시할 수 없는 단서: {broken}"

    def test_케이스마다_가상_사건_고지가_붙어_있다(self, cases):
        """실존 재해를 실화처럼 읽히게 두지 않는다 — 화면이 이 두 필드를 쓴다."""
        bad = [
            c["case_id"]
            for c in cases
            if c["intro"].get("fictional") is not True
            or not str(c["intro"].get("data_note") or "").strip()
        ]
        assert not bad, f"fictional·data_note가 빠진 케이스: {bad}"

    def test_case_id와_제목이_서로_다르다(self, cases):
        ids = [c["case_id"] for c in cases]
        titles = [c["title"] for c in cases]
        assert len(set(ids)) == len(ids), f"case_id 중복: {ids}"
        assert len(set(titles)) == len(titles), f"제목 중복: {titles}"

    def test_tone은_users_tone_체크제약_안의_값이다(self, cases):
        """models/user.py의 ck_users_tone과 같은 집합 — 밖의 값은 표시 폴백을 깬다."""
        allowed = {"child", "teen", "adult"}
        bad = [(c["case_id"], c.get("tone")) for c in cases if c.get("tone") not in allowed]
        assert not bad, f"허용 밖 tone: {bad}"
