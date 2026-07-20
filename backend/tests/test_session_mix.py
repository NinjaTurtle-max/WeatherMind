"""세션 배합 로직(R2-01 §3.2) 단위 테스트 — 순수 함수만, DB 불필요.

plan_bank_picks: new 2 + review 2 + live 1, review 부족 시 new 대체,
뱅크 부족분은 generate_count(폴백 생성 수)로 반환.
enforce_type_variety: 같은 question_type 3연속 금지.
"""
from app.services.session_service import (
    DEFAULT_RECIPE,
    SESSION_SIZE,
    enforce_type_variety,
    plan_bank_picks,
)


def make_items(count: int, prefix: str, question_type: str = "multiple_choice"):
    return [
        {"id": f"{prefix}-{i}", "question_type": question_type} for i in range(count)
    ]


def kinds_of(picks):
    return [p["kind"] for p in picks]


class TestPlanBankPicks:
    def test_뱅크_충분시_2_2_1_배합_폴백_없음(self):
        picks, generate_count = plan_bank_picks(
            make_items(5, "new"), make_items(5, "rev"), make_items(3, "live")
        )
        assert len(picks) == SESSION_SIZE
        assert generate_count == 0
        assert kinds_of(picks) == ["new", "new", "review", "review", "live"]

    def test_review_없으면_new로_대체(self):
        picks, generate_count = plan_bank_picks(
            make_items(5, "new"), [], make_items(1, "live")
        )
        assert generate_count == 0
        assert kinds_of(picks) == ["new", "new", "new", "new", "live"]

    def test_뱅크_부족시_부족분만큼_생성_폴백(self):
        picks, generate_count = plan_bank_picks(make_items(1, "new"), [], [])
        assert len(picks) == 1
        assert generate_count == SESSION_SIZE - 1

    def test_뱅크_0건이면_전량_생성_폴백(self):
        picks, generate_count = plan_bank_picks([], [], [])
        assert picks == []
        assert generate_count == SESSION_SIZE  # S2 AC: 0건이어도 세션 발급 성공

    def test_같은_문항_중복_선택_금지(self):
        shared = make_items(3, "shared")  # new·review 풀에 동일 문항
        picks, generate_count = plan_bank_picks(shared, shared, [])
        picked_ids = [p["item"]["id"] for p in picks]
        assert len(picked_ids) == len(set(picked_ids))
        assert len(picks) + generate_count == SESSION_SIZE

    def test_recipe_합계는_세션_크기(self):
        assert sum(DEFAULT_RECIPE.values()) == SESSION_SIZE == 5


class TestEnforceTypeVariety:
    @staticmethod
    def _no_triple(items) -> bool:
        types = [q["question_type"] for q in items]
        return all(
            not (types[i] == types[i - 1] == types[i - 2])
            for i in range(2, len(types))
        )

    def test_3연속_동일_유형_해소(self):
        items = (
            make_items(3, "mc", "multiple_choice")
            + make_items(1, "sa", "short_answer")
            + make_items(1, "sl", "slider")
        )
        result = enforce_type_variety(items)
        assert self._no_triple(result)
        assert sorted(q["id"] for q in result) == sorted(q["id"] for q in items)

    def test_이미_섞여_있으면_순서_유지(self):
        items = [
            {"id": 1, "question_type": "multiple_choice"},
            {"id": 2, "question_type": "short_answer"},
            {"id": 3, "question_type": "multiple_choice"},
            {"id": 4, "question_type": "slider"},
            {"id": 5, "question_type": "multiple_choice"},
        ]
        assert enforce_type_variety(items) == items

    def test_전량_동일_유형이면_원_순서_유지(self):
        items = make_items(5, "mc", "multiple_choice")
        assert enforce_type_variety(items) == items  # 구성상 회피 불가

    def test_4연속도_해소(self):
        items = make_items(4, "mc", "multiple_choice") + make_items(
            1, "sa", "short_answer"
        )
        result = enforce_type_variety(items)
        assert self._no_triple(result)
