"""보상 획득 알림 스키마 — 퀘스트 완료·배지 획득 (R13 CO-T-4).

**왜 별도 모듈인가**: 같은 이벤트가 세션 완료(`SessionCompleteResult`)와 보드
attempt(`BoardAttemptResult`) 두 응답에 동시에 실린다. `CrownAward`가
`schemas/curriculum.py`에 살면서 두 곳이 import하는 것과 같은 구조다 —
한쪽 스키마 파일에 두면 다른 쪽이 도메인을 가로질러 import하게 된다.

**계약**: 두 리스트 모두 *이번 호출에서 새로 일어난 것만* 담는다. 재요청(멱등
재계산·이미 완료한 세션 재-complete)에서는 빈 리스트다 — 화면이 "방금 받았다"고
말해야 하는 자리이므로 보유 목록을 다시 보내면 안 된다. 보유 전체는
`GET /progress/quests`·`GET /progress/badges`가 소유한다.
"""
from pydantic import BaseModel


class QuestReward(BaseModel):
    """이번 호출에서 미완료→완료로 전환된 퀘스트 1건 (CO-T-4).

    `quest_service.recalculate_quests`가 반환하는 `QuestTransition` 중
    `newly_done=True`인 것만 실린다. `reward_xp`는 그 전환으로 **실제 지급된**
    XP다(전환이 아니면 0이므로, 여기 실리는 건은 항상 > 0).

    title은 서버 원문(한국어)이다 — 프론트는 `code`로 리소스를 먼저 찾고
    없을 때만 이 값을 쓴다(i18n S-5: 서버 원문은 아직 번역 대상 밖).
    """

    code: str
    title: str
    reward_xp: int


class BadgeAward(BaseModel):
    """이번 호출에서 **신규 획득**한 배지 1건 (CO-T-4).

    `badge_service.award_badge`가 True(신규 INSERT)를 반환했을 때만 실린다.
    이미 보유 중이면 ON CONFLICT DO NOTHING으로 False라 여기 실리지 않는다.
    """

    code: str
    title: str
    description: str | None = None
