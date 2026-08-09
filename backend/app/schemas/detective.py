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

    xp_earned는 지금 항상 0이다. 케이스 진행을 서버가 보존하지 않기로 했고
    (quiz_logs에 content_item_id NULL 행을 새로 만들면 복습 큐·약점 태그·BKT가
    가리킬 문항 없는 태그를 받는다), 영속 없이 XP를 주면 재제출로 무한 적립된다.
    데이터의 xp_reward는 표시용으로만 내려보낸다 — 실제 적립은 PM 판정 대기.
    """

    verdict: Verdict
    correct: bool
    feedback: str
    supporting_clues: list[str] = []
    solution: DetectiveSolution | None = None
    xp_earned: int = 0
    opened_clue_count: int = 0
    min_clues: int = 0
