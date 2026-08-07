"""세션 배합 로직(R2-01 §3.2 → R11-01 §9.2 10문항 → R13-01 §2.10 15문항) 단위 테스트.

순수 함수만 — DB 불필요.
plan_bank_picks: new 5 + review 4 + live 1 + unit 5, review·unit 부족 시 new 대체,
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
    def test_뱅크_충분시_5_4_1_5_배합_폴백_없음(self):
        picks, generate_count = plan_bank_picks(
            make_items(8, "new"),
            make_items(8, "rev"),
            make_items(3, "live"),
            unit_pool=make_items(8, "unit"),
        )
        assert len(picks) == SESSION_SIZE
        assert generate_count == 0
        assert kinds_of(picks) == (
            ["new"] * 5 + ["review"] * 4 + ["live"] + ["unit"] * 5
        )

    def test_진도_블록이_항상_마지막(self):
        """§2.10 "마지막 5문항 = 내 진도" — 배합 순서가 곧 발급 순서다."""
        picks, _ = plan_bank_picks(
            make_items(20, "new"),
            make_items(8, "rev"),
            make_items(3, "live"),
            unit_pool=make_items(8, "unit"),
        )
        assert kinds_of(picks)[-5:] == ["unit"] * 5

    def test_review_없으면_new로_대체(self):
        picks, generate_count = plan_bank_picks(
            make_items(20, "new"), [], make_items(1, "live"),
            unit_pool=make_items(5, "unit"),
        )
        assert generate_count == 0
        assert kinds_of(picks) == ["new"] * 9 + ["live"] + ["unit"] * 5

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

    def test_유닛_풀_부족분은_new로_대체_총합_유지(self):
        """§2.10 풀 고갈 처리 — 유닛 잔여 2건이면 나머지 3건은 신규가 메운다."""
        picks, generate_count = plan_bank_picks(
            make_items(20, "new"),
            make_items(8, "rev"),
            make_items(3, "live"),
            unit_pool=make_items(2, "unit"),
        )
        assert generate_count == 0
        assert len(picks) == SESSION_SIZE
        assert kinds_of(picks)[-5:] == ["unit"] * 2 + ["new"] * 3

    def test_열린_유닛_없으면_진도_0이어도_총합_유지(self):
        """신규 유저(열린 유닛 0) — 진도 블록 0 + 부족분 new 대체로 여전히 15문항."""
        picks, generate_count = plan_bank_picks(
            make_items(20, "new"), make_items(8, "rev"), make_items(3, "live")
        )
        assert generate_count == 0
        assert len(picks) == SESSION_SIZE
        assert "unit" not in kinds_of(picks)

    def test_블록_간_중복_없음(self):
        """신규·복습·진도가 같은 뱅크에서 뽑혀도 같은 문항이 두 번 나오지 않는다."""
        shared = make_items(20, "shared")
        picks, generate_count = plan_bank_picks(
            shared, shared, make_items(1, "live"), unit_pool=shared
        )
        picked_ids = [p["item"]["id"] for p in picks]
        assert len(picked_ids) == len(set(picked_ids))
        assert len(picks) + generate_count == SESSION_SIZE

    def test_recipe_합계는_세션_크기(self):
        """계약값 15 고정 (R13-01 §2.10 — 신규5·복습4·실황1·진도5).

        env 기본값 = 계약값 유지(CLAUDE.md 드리프트 감시 관례). 에너지와의 관계:
        오답 최대 15 > 구름 만렙 5이지만 "진행 중 세션은 잔량 0에도 완주 보장"
        계약(R10 에너지 전환)이 이미 흡수한다 — daily-goal(3·5·9)·CLOUD_* 불변.
        """
        assert DEFAULT_RECIPE == {"new": 5, "review": 4, "live": 1, "unit": 5}
        assert sum(DEFAULT_RECIPE.values()) == SESSION_SIZE == 15


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
