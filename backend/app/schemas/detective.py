"""기후 탐정 API 스키마 (/api/v1/detective) — R13, 계획서 [그림1] 4모듈 중 하나.

케이스는 `database/seed/detective_cases.json`이 단일 진실원이다(board_rules·
board_regions 선례 — DB 모델·마이그레이션 없음. 케이스는 유저별 상태가 없는
정적 콘텐츠라 테이블을 만들 이유가 없다).

**비밀 유지가 이 스키마의 존재 이유다.** 상세 응답(`DetectiveCaseDetail`)은
가설의 `text`만 담고 `verdict`·`feedback`·`supporting_clues`를 담지 않으며,
`solution`은 아예 없다 — 세션의 `QUESTION_PAYLOAD_FIELDS` 화이트리스트 관례와
같은 **구조적 제외**다(필드를 지우는 게 아니라 애초에 모델에 없다).
판정은 서버가 `POST /solve`에서 내린다.
"""
from typing import Any, Literal

from pydantic import BaseModel

# 가설 판정 3값 — 데이터가 `partial`을 저작한다(부분적으로 맞는 추리).
# 정오 2분기로 접으면 저작된 교육적 피드백의 3분의 1이 버려진다.
Verdict = Literal["correct", "partial", "incorrect"]


class DetectiveSeries(BaseModel):
    """시계열 1종 — 차트 1개의 원천. unit이 다르면 차트를 갈라야 한다(이중 축 금지)."""

    metric_id: str
    metric_label: str
    unit: str
    points: list[dict[str, Any]]  # [{x: "18시", y: 31.5}, ...]


class DetectiveClue(BaseModel):
    """단서 카드 — 조사 과정의 단위. 증거이지 정답이 아니므로 전문을 내려보낸다.

    metric_id·x는 이 단서가 어느 시계열의 어느 시점을 가리키는지다(차트 강조용).
    """

    clue_id: str
    metric_id: str | None = None
    x: str | None = None
    label: str
    text: str


class DetectiveHypothesisPublic(BaseModel):
    """플레이 중 보이는 가설 — **판정과 근거가 구조적으로 없다.**"""

    hypothesis_id: str
    text: str


class DetectiveCaseSummary(BaseModel):
    """GET /cases 항목 — 목록 카드에 필요한 만큼만."""

    case_id: str
    title: str
    concept_tag: str
    knowledge_level: int | None = None
    level_group: str | None = None
    xp_reward: int = 0
    min_clues: int = 0
    headline: str = ""
    clue_count: int = 0
    hypothesis_count: int = 0


class DetectiveCaseDetail(BaseModel):
    """GET /cases/{case_id} — 플레이에 필요한 전부이고 정답은 하나도 없다."""

    case_id: str
    title: str
    concept_tag: str
    knowledge_level: int | None = None
    level_group: str | None = None
    xp_reward: int = 0
    min_clues: int = 0
    intro: dict[str, Any]
    series: list[DetectiveSeries]
    clues: list[DetectiveClue]
    hypotheses: list[DetectiveHypothesisPublic]


class DetectiveSolveRequest(BaseModel):
    """제출 — 고른 가설 + **연 단서 목록**.

    opened_clue_ids가 계약의 핵심이다. 서버가 `min_clues` 미만이면 422로 막으므로
    「단서를 조사하는 과정」이 UI 권고가 아니라 서버 계약이 된다(배점 ② 대응).
    """

    hypothesis_id: str
    opened_clue_ids: list[str] = []


class DetectiveSolution(BaseModel):
    """정답 가설을 맞혔을 때만 동봉되는 해설."""

    title: str = ""
    explanation: str = ""
    takeaway: str = ""
    next_step_hint: str = ""


class DetectiveSolveResult(BaseModel):
    """제출 결과 — 판정·피드백은 항상, 해설은 정답일 때만.

    xp_earned는 **한때 항상 0이었다.** 케이스 진행을 서버가 보존하지 않기로 했고
    (quiz_logs에 content_item_id NULL 행을 새로 만들면 복습 큐·약점 태그·BKT가
    가리킬 문항 없는 태그를 받는다), 영속 없이 XP를 주면 재제출로 무한 적립된다.
    데이터의 xp_reward는 표시용으로만 내려보냈다 — 실제 적립은 PM 판정 대기였다.

    ⤷ **2026-08-20에 이렇게 닫았다 (PM 판정: 적립한다 · 새 마이그레이션 없이).**
    위 두 사유는 지금도 유효한 제약이고, 둘 다 **비켜 간 것이지 뒤집힌 게 아니다.**

    · 무한 적립 — `quiz_logs`에 케이스당 마커 1행(`quiz_id="detective-{case_id}"`)
      을 남기고, **최초 정답**일 때만 `xp_reward`를 준다. 재제출은 0이다.
      멱등 키는 (user_id, quiz_id)이고 존재 조회가 곧 「이미 받았다」다.
    · 문항 없는 태그 — 마커의 `is_correct`를 **NULL로 둔다.** 그 계열이 전부
      `is_correct IS NOT NULL`로 거르기 때문에 이 행은 복습 큐
      (`review_schedule_service.history_stmt`)·일일 퀘스트(`quest_service`)·
      일일 목표 카운트(`progress._count_answered_today`) 어디에도 안 들어간다.
      보드 클리어 집합은 `question_type='board'`로, 세션 계열은 `session_id`·
      `content_item_id IS NOT NULL`로 이미 걸러 낸다. BKT/θ는 로그를 훑지 않고
      `answer_service`가 응답 시점에 쓰므로 애초에 무관하다.
    · 남은 것 — 유니크 제약이 없어(=DDL 금지) 같은 케이스 동시 제출이 겹치면
      이중 적립 창이 있다. 보드의 read-then-insert와 동일한 창이다.

    따라서 xp_earned는 **실제 적립액**이다: 최초 정답이면 그 케이스의 xp_reward,
    그 밖(재제출·오답·부분정답)은 0. 오답은 마커를 남기지 않으므로 다시 도전해
    받을 수 있다.
    """

    verdict: Verdict
    correct: bool
    feedback: str
    supporting_clues: list[str] = []
    solution: DetectiveSolution | None = None
    xp_earned: int = 0
    opened_clue_count: int = 0
    min_clues: int = 0
