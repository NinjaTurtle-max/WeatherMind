"""backend가 quiz-generate로 **무엇을 실어 보내는가** — R13 CO-E-4 / CO-O-9 (backend 반).

## 결함의 형태

θ 파생 난이도가 `level_group` 자리에 실려 나갔다. 그런데 스펙 03 §2 규칙 2와
`quiz_gen_chain`의 SYSTEM_PROMPT 원문이 `level_group`을 "난이도가 아니라 **표현 톤**
이며 어휘 단계를 한 칸도 움직이지 못한다"고 못박고 있어서, 모델은 θ를 난이도가
아니라 **말투**로 읽었다 — θ가 낮은 성인이 어린이 말투 문항을 받는 셈이다.
난이도를 나를 필드(`knowledge_level`)는 페이로드에 아예 없었다.

이 파일은 **HTTP 페이로드 자체**를 붙든다(`ai_client._post` 가로채기). 서비스 함수의
kwargs를 보는 테스트(`test_theta_difficulty::TestSessionWiring`)와 한 홉 다르다:
`quiz_generate`가 받은 값을 payload에 안 실으면 그쪽은 초록이고 이쪽만 빨개진다.
그 홉이 실제로 값을 잃던 곳이라 따로 단정한다.

ai-worker 반(입구가 그 키를 받아 체인까지 넘기는가)은
`ai-worker/tests/test_runtime_kl_plumbing.py`가 소유한다. 두 파일의 이음매는
**필드명 문자열**이라 양쪽 모두 `knowledge_level`·`question_type`을 리터럴로 적는다
(backend는 ai-worker의 app 패키지를 in-process import할 수 없다 — 두 빌드 컨텍스트가
`app`이라는 같은 최상위 이름을 쓰기 때문. `test_gen_payload_contract`가 소스 AST를
읽는 것과 같은 제약이다).

실행: backend 디렉토리에서 `python -m pytest tests/test_runtime_kl_plumbing.py -q`.
"""

from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import date

import pytest

from app.services import ai_client, session_service
from app.services import weatherbrain_service as wb

from tests.test_theta_difficulty import FakeDB


class _User:
    """세션 발급이 읽는 최소 필드만 가진 유저 스텁."""

    def __init__(self, level_group: str = "adult"):
        self.id = uuid.uuid4()
        self.level_group = level_group


@pytest.fixture()
def payloads(monkeypatch):
    """`ai_client._post`를 가로채 quiz-generate 페이로드만 모은다.

    `quiz_generate`를 통째로 목킹하지 않는 것이 요점이다 — 그러면 시그니처는
    보이지만 **페이로드에 실렸는지**는 안 보인다.
    """
    seen: list[dict] = []

    async def fake_post(path, payload, timeout=60.0):
        if path == "/internal/quiz-generate":
            seen.append(payload)
            return {"question_type": "multiple_choice", "concept_tag": "typhoon"}
        if path == "/internal/router-decide":
            return {"route": "general", "target_concept_tag": None}
        raise AssertionError(f"예상 밖 ai-worker 호출: {path}")

    monkeypatch.setattr(ai_client, "_post", fake_post)
    return seen


@pytest.fixture()
def issue(monkeypatch, payloads):
    """뱅크 0건 상태로 일일 세션을 발급하고 페이로드 목록을 돌려준다."""

    async def fake_weather(*args, **kwargs):
        return {"region": "서울", "forecasts": []}

    monkeypatch.setattr(session_service, "get_today_weather", fake_weather)

    def _issue(user, abilities):
        async def fake_refresh(db, user_):
            return abilities

        monkeypatch.setattr(wb, "refresh_abilities", fake_refresh)
        payloads.clear()
        session_service_result = asyncio.run(
            session_service.create_daily_session(FakeDB(), user, date(2026, 7, 23))
        )
        assert payloads, "뱅크 0건인데 생성 폴백이 한 번도 안 불렸다"
        return payloads, session_service_result

    return _issue


def _abilities(theta: float) -> list[dict]:
    return [{"concept_tag": "typhoon", "theta": theta, "se": 0.4, "n": 4}]


class TestClientSignature:
    def test_두_인자가_시그니처에_있다(self):
        params = inspect.signature(ai_client.quiz_generate).parameters
        assert params["knowledge_level"].default is None
        assert params["question_type"].default is None

    def test_키는_항상_실린다(self):
        """None이어도 키를 빼지 않는다 — router_decide와 같은 관례.

        키 유무가 갈리면 수신측 계약 대조가 '값이 None' / '키가 없음' 두 상태를
        구분해야 하고, 그 구분이 정확히 이 항목에서 값을 잃던 지점이다.
        """
        captured: dict = {}

        async def fake_post(path, payload, timeout=60.0):
            captured.update(payload)
            return {}

        original = ai_client._post
        ai_client._post = fake_post
        try:
            asyncio.run(ai_client.quiz_generate(weather_data={}, level_group="adult"))
        finally:
            ai_client._post = original
        assert captured["knowledge_level"] is None
        assert captured["question_type"] is None


class TestDailySessionPayload:
    def test_난이도는_θ_파생_knowledge_level로_간다(self, issue):
        theta = 1.0
        sent, _ = issue(_User("adult"), _abilities(theta))
        # 기대값을 상수로 박지 않는다 — θ 경계는 b 재보정(CO-U-13)에서 움직인다.
        expected = wb.theta_to_knowledge_level(theta)
        assert {p["knowledge_level"] for p in sent} == {expected}

    def test_톤은_θ가_아니라_유저_신고_학령이다(self, issue):
        """스펙 03 §2 규칙 2 · 스펙 12 §5.1 — level_group은 톤 축이다."""
        theta = -2.0  # 파생 밴드 elementary. 유저는 성인이다.
        user = _User("adult")
        sent, _ = issue(user, _abilities(theta))
        assert wb.theta_to_level_group(theta) != user.level_group  # 축이 갈리는 상황
        assert {p["level_group"] for p in sent} == {"adult"}
        # 같은 호출에서 난이도는 θ를 따라 내려간다 — 톤을 고정한 대가로 난이도가
        # 사라지면 이 항목이 고친 것이 없다.
        assert {p["knowledge_level"] for p in sent} == {
            wb.theta_to_knowledge_level(theta)
        }

    def test_콜드스타트는_난이도를_지어내지_않는다(self, issue):
        """θ 없음 → None. 모델이 스스로 판정해 신고한다(스펙 03 §2 규칙 3)."""
        sent, _ = issue(_User("middle_high"), [])
        assert {p["knowledge_level"] for p in sent} == {None}
        assert {p["level_group"] for p in sent} == {"middle_high"}

    def test_expert_유저는_성인_톤으로_접힌다(self, issue):
        """`expert`는 가입 신고 축에 없지만 users 체크 제약은 허용한다.

        스펙 12 §5.1 "문항 쪽 밴드로 존재하는 값이라 폴백에서는 adult로 접는다".
        접지 않으면 프롬프트가 모르는 톤 값이 그대로 모델에 간다.
        """
        sent, _ = issue(_User("expert"), _abilities(2.0))
        assert {p["level_group"] for p in sent} == {"adult"}

    def test_question_type은_아직_None으로_통과한다(self, issue):
        """이번 라운드 범위는 배관까지다.

        무슨 유형을 요청할지 정하는 로직은 세션 배합 담당 몫이라 여기서 값을
        채우지 않는다. 키가 사라지는 것과 값이 None인 것은 다르므로 키를 단정한다.
        """
        sent, _ = issue(_User("adult"), _abilities(0.0))
        assert all("question_type" in p for p in sent)
        assert {p["question_type"] for p in sent} == {None}


class TestGenerationTone:
    """톤 파생 규칙 자체 — 순수 함수라 세션 발급 없이 본다.

    미설정 분기는 세션 경로로 못 몬다(`pool_level_groups`가 그 앞에서 None을
    정렬하다 TypeError로 죽는다 — users.level_group이 NOT NULL이라 실경로에서는
    도달 불가한 방어다). 규칙을 함수로 뽑아 둔 이유가 여기 있다.
    """

    def test_신고_학령_3종은_그대로다(self):
        for group in ("elementary", "middle_high", "adult"):
            assert session_service.generation_tone(group) == group

    def test_expert는_성인_톤으로_접힌다(self):
        assert session_service.generation_tone("expert") == "adult"

    def test_미설정은_중립_기본값이지_θ_파생이_아니다(self):
        """되돌림 방어 — 폴백을 θ 파생으로 되돌리면 고친 결함이 그대로 돌아온다."""
        assert session_service.generation_tone(None) == wb.NEUTRAL_LEVEL_GROUP
        # 중립값은 게스트 기본값과 같은 자리여야 한다(미지 유저 = 게스트 취급).
        from app.routers.auth import GUEST_LEVEL_GROUP

        assert wb.NEUTRAL_LEVEL_GROUP == GUEST_LEVEL_GROUP

    def test_question_type은_아직_None으로_통과한다(self, issue):
        """이번 라운드 범위는 배관까지다.

        무슨 유형을 요청할지 정하는 로직은 세션 배합 담당 몫이라 여기서 값을
        채우지 않는다. 키가 사라지는 것과 값이 None인 것은 다르므로 키를 단정한다.
        """
        sent, _ = issue(_User("adult"), _abilities(0.0))
        assert all("question_type" in p for p in sent)
        assert {p["question_type"] for p in sent} == {None}
