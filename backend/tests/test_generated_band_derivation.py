"""생성 문항 적재 밴드는 `knowledge_level`이 권위다 — CO-O-5의 **런타임 짝**.

## 왜 이 파일이 따로 있나

CO-O-5는 저작 CLI(`scripts/author_items.resolve_level_group`)에서 2026-08-10에
고쳤고 `test_author_cli_gates`가 지킨다. 그런데 **런타임 영속화 경로에 같은 결함이
남아 있었다** — 코드 리뷰가 잡았다.

`generated_item_entry`가 `question.get("level_group") or level_group`을 썼는데
**생성기는 `level_group`을 내지 않는다**(`QuizQuestion` 필드에 없음). 그래서 폴백이
항상 이겼고, 호출부 주석이 약속한 "신고하면 그쪽이 우선"은 구현된 적이 없다.

## 깨지던 경로 (아래 test_콜드스타트_초등에_전문가_문항이_적재되지_않는다)

콜드스타트 `elementary` 학습자는 θ가 없어 목표 단계를 안 보내므로 **모델이 스스로
판정**한다. 거기서 `knowledge_level=9`가 나오면 문항이 `level_group="elementary"` ·
`status=active`로 뱅크에 들어가고, 이후 `pool_level_groups`의 밴드 필터가 그
전문가 문항을 **모든 초등 학습자에게** 다시 서빙한다. `validate_entry`는 두 축의
모순을 보지 않으므로 아무도 막지 않는다.

DB 없이 순수 함수만 검증한다(test_session_mix 관례).
"""
import pytest

from app.services import session_service as ss
from app.services import weatherbrain_service as wb


def _question(**extra) -> dict:
    """생성기가 실제로 내는 모양 — `level_group` 키가 **없다**(계약)."""
    q = {
        "concept_tag": "typhoon",
        "question_type": "multiple_choice",
        "question_text": "태풍이 에너지를 얻는 주된 원천은 무엇인가?",
        "options": ["따뜻한 바닷물", "찬 육풍", "산악 지형", "극지 해류"],
        "correct_answer": "따뜻한 바닷물",
    }
    q.update(extra)
    return q


class TestBandFollowsReportedLevel:
    """신고 단계가 밴드를 정한다 — 요청 밴드는 폴백일 뿐이다."""

    @pytest.mark.parametrize(
        "level", range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
    )
    def test_전_단계에서_파생_밴드를_쓴다(self, level):
        """단계 전건 스윕 — 한 칸이라도 요청 밴드가 이기면 2축 정합이 깨진다."""
        entry = ss.generated_item_entry(
            _question(knowledge_level=level), level_group="elementary"
        )
        assert entry["level_group"] == wb.level_group_of_knowledge_level(level)
        assert entry["knowledge_level"] == level

    def test_콜드스타트_초등에_전문가_문항이_적재되지_않는다(self):
        """리뷰가 짚은 그 시나리오 — 이 단정이 없어서 결함이 남아 있었다.

        θ 없는 초등 학습자에게 모델이 kl=9를 신고해도, 적재 밴드는 expert여야
        한다. elementary로 들어가면 밴드 필터가 그것을 초등 전체에 다시 서빙한다.
        """
        entry = ss.generated_item_entry(
            _question(knowledge_level=9), level_group="elementary"
        )
        assert entry["level_group"] == "expert"

    def test_두_축이_서로를_부정하지_않는다(self):
        """적재 엔트리 안에서 knowledge_level ↔ level_group 왕복이 성립한다."""
        for level in range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1):
            entry = ss.generated_item_entry(
                _question(knowledge_level=level), level_group="adult"
            )
            assert (
                wb.level_group_of_knowledge_level(entry["knowledge_level"])
                == entry["level_group"]
            )


class TestUnreportedKeepsRequested:
    """미신고·범위 밖은 **파생하지 않는다** — 저작 쪽(resolve_level_group)과 같은 판단.

    범위 밖을 파생시키면 `level_group_of_knowledge_level`의 클램프가 엉뚱한 밴드를
    정상값처럼 만들어, lint가 잡아야 할 미분류를 위장한다.
    """

    @pytest.mark.parametrize("raw", [None, "", "네", 0, -1, 99, 3.5, [], {}])
    def test_요청_밴드를_유지한다(self, raw):
        entry = ss.generated_item_entry(
            _question(knowledge_level=raw), level_group="middle_high"
        )
        assert entry["level_group"] == "middle_high"

    def test_키_자체가_없어도_죽지_않는다(self):
        entry = ss.generated_item_entry(_question(), level_group="adult")
        assert entry["level_group"] == "adult"
        assert entry["knowledge_level"] is None


class TestGeneratorContract:
    """전제 고정 — 생성기가 `level_group`을 내기 시작하면 이 설계를 다시 봐야 한다."""

    def test_생성_스키마에_level_group이_없다(self):
        """이 전제가 깨지면 "신고가 권위"의 의미가 달라진다.

        종전 코드가 `question.get("level_group")`을 읽은 것은 생성기가 그 키를
        낸다고 **가정**했기 때문인데, 실제로는 내지 않아 그 분기가 죽은 코드였다.
        가정이 바뀌면 파생과 신고 중 무엇이 이길지 판정이 필요하다.
        """
        payload_contract = pytest.importorskip(
            "app.chains.payload_contract",
            reason="ai-worker 의존 미설치 — CI는 설치하므로 거기서 돈다",
        )
        assert "level_group" not in payload_contract.QuizQuestion.model_fields
        assert "knowledge_level" in payload_contract.QuizQuestion.model_fields
