"""피드백 체인 — 03_ai_chains_spec.md 섹션 3.

단계:
1. `concept_tag`로 `database/seed/climate_concepts.json`에서 그 개념의 문서를 **직접 조회**
2. 문서가 있으면 참고 지식 블록으로, 없으면 그 항목 자체를 프롬프트에서 제거
3. System Prompt(스펙 원문)로 Gemini 호출 → 순수 텍스트(피드백 문자열) 반환

Context Injection 포맷은 03번 스펙 섹션 4를 따른다.
시드 로드 / Gemini 장애 시 기본 격려 피드백으로 폴백한다.

## 왜 벡터 검색이 아니라 직접 조회인가 (R13 3일차, 2026-08-07)

이 체인은 원래 Chroma에 `f"{concept_tag} {question_text}"`를 던져 top_k=3 ·
threshold 0.7로 검색했다. 철거한 이유는 성능 튜닝이 아니라 **검색이 성립하지
않는 문제였다는 실측**이다:

1. **찾을 것이 이미 확정돼 있었다.** 쿼리의 `concept_tag`는 호출부(`/answer`)가
   문항에서 그대로 넘겨준 값이다. 어느 문서를 넣을지 아는 상태에서 유사도로
   그 문서를 다시 찾고 있었다.
2. **코퍼스가 한 자릿수 KB다.** `climate_concepts.json` = 41항목 · 14개 태그
   (2026-08-09 실측. 철거 당시 표기는 35항목·12태그였고 그 뒤 2태그가 증보됐다).
   태그당 2~6항목이라 그 태그 전부를 넣어도 top_k=3보다 크지 않다.
   색인·근사이웃탐색이 푸는 문제(후보가 너무 많다)가 여기엔 없다.
3. **임베딩만 세 번째 제공자였다.** 생성은 Gemini인데 검색은 OpenAI
   `text-embedding-3-small`(`EMBEDDING_API_KEY`)을 요구했다 — 발급 계획에 없는 키다.
4. **그래서 무키에서 이미 죽어 있었고, 그 죽는 방식이 나빴다.** 임베딩 실패 →
   검색 전건 실패 → 컨텍스트 `"(검색된 참고 지식 없음)"`. 그런데 프롬프트 원칙은
   "제공된 참고 지식에 있는 사실만 사용, 지어내지 말 것"이다. **"사실만 써라,
   그런데 사실은 없다"**를 모델에게 주는 자기모순이었다.

교체 후 품질은 내려가지 않고 올라간다 — 검색 실패라는 실패 양식이 소멸하고,
항상 정확히 그 개념의 문서가 들어간다. 대신 새 실패 양식 하나가 생긴다:
**태그에 해당하는 개념 문서가 아예 없는 경우**. 이때는 빈 컨텍스트를 넣지 않고
`SYSTEM_PROMPT_NO_CONTEXT`로 갈아탄다 — 위 4번의 자기모순을 되살리지 않기 위해
"참고 지식" 줄 자체를 프롬프트에서 뺀다.

⚠️ **2026-08-09 정정 — 그 실패 양식은 현재 시드에서 도달하지 않는다.** 이 자리에
"본시드 237문항 중 15건(`flood_response`·`wildfire_weather`)이 문서 없는 태그"라고
적혀 있었으나 거짓이다: `climate_concepts.json`에 두 태그가 **각 3항목 실재**하고,
본시드 태그 집합(14종)과 개념 문서 태그 집합(14종)이 **완전 일치**한다(차집합 양방향
0). 즉 문서 없는 태그는 **0종**이다. 그럼에도 `SYSTEM_PROMPT_NO_CONTEXT` 분기를
남겨 두는 이유는 이 코드가 **시드 커버리지를 전제하지 않기 때문**이다 — 신규 태그
저작·마운트 누락(`CLIMATE_CONCEPTS_PATH` 미설정)이면 즉시 되살아나는 경로다.
분기를 지우지 말 것. 태그 커버리지는 문서가 아니라 시드가 소유한다.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from app.chains.seed_paths import resolve_seed_path
# ⚠️ **최상위 import여야 한다.** author_items.py가 sys.modules 스왑으로 ai-worker를
# 격리 임포트하는데(backend와 `app` 패키지명 공유), 함수 안에서 지연 import하면
# **스왑이 끝난 뒤** 실행돼 backend의 `app`을 뒤져 ModuleNotFoundError가 난다.
# llm_provider 자체는 langchain을 최상단에서 안 끌므로 여기 둬도 안전하다.
from app.llm_provider import PURPOSE_RUNTIME, build_chat_model, effective_spec, spec_is_usable


def _llm_available() -> bool:
    """이 용도의 LLM을 부를 수 있는가 (CO-B7).

    ⚠️ **`llm_configured()`만 보면 안 된다.** 그건 `GEMINI_API_KEY`만 확인하므로,
    이 용도를 gpt-oss(OpenAI 호환)로 라우팅해도 "키 없음"으로 판정돼 **LLM 경로가
    영영 안 열린다** — 프로바이더 통로를 뚫어 놓고 문을 잠가 두는 셈이다.
    Gemini로 해석되면 종전과 똑같이 `llm_configured()`가 답한다(하위호환).
    """
    # **effective_spec**을 본다 — 서빙 모드·예산 강등이 반영된 실제 스펙이다.
    # resolve_spec(설정값)만 보면 예산이 소진돼도 "호출 가능"이라 답해서,
    # 체인이 LLM을 부르러 갔다가 빈 스펙으로 실패하고 예외 경로로 떨어진다.
    return spec_is_usable(effective_spec(PURPOSE_RUNTIME)[0])

logger = logging.getLogger(__name__)

CONCEPTS_FILENAME = "climate_concepts.json"
CONCEPTS_PATH_ENV = "CLIMATE_CONCEPTS_PATH"

# ── System Prompt (03번 스펙 원문 그대로) ──────────────────────────────────
SYSTEM_PROMPT = """당신은 기상교육 전문 AI입니다. 학습자가 방금 푼 문제에 대해 피드백을 작성하세요.

원칙:
- 정답 여부와 무관하게 격려하는 톤 유지
- 아래 제공된 참고 지식(context)에 있는 사실만 사용, 지어내지 말 것
- 3~4문장, 초등학생도 이해할 수 있는 문장 길이
- 마지막 문장은 오늘 실제 날씨와 연결지어 설명

입력:
- 문제: {question_text}
- 학습자 답: {user_answer}
- 정답 여부: {is_correct}
- 참고 지식(context): {concept_documents}
- 오늘 실제 기상 데이터: {today_weather_json}"""

# 개념 문서가 없을 때 쓰는 변형 — "참고 지식" 관련 두 줄이 **통째로 빠진다**.
# 빈 블록("(참고 지식 없음)")을 넣으면 "제공된 사실만 써라"가 가리킬 대상이
# 없는 자기모순이 되고, 모델은 그 지시를 무시하거나 침묵한다. 없는 것은 없다고
# 말하는 대신 **묻지 않는 것**이 정직하다.
SYSTEM_PROMPT_NO_CONTEXT = """당신은 기상교육 전문 AI입니다. 학습자가 방금 푼 문제에 대해 피드백을 작성하세요.

원칙:
- 정답 여부와 무관하게 격려하는 톤 유지
- 이 개념은 참고 지식이 준비되지 않았다. 문제와 학습자 답에서 읽히는 것만 말하고, 확실하지 않은 사실은 쓰지 말 것
- 3~4문장, 초등학생도 이해할 수 있는 문장 길이
- 마지막 문장은 오늘 실제 날씨와 연결지어 설명

입력:
- 문제: {question_text}
- 학습자 답: {user_answer}
- 정답 여부: {is_correct}
- 오늘 실제 기상 데이터: {today_weather_json}"""

# 시드 로드·Gemini 장애 시 기본 격려 피드백
DEFAULT_FEEDBACK_CORRECT = (
    "정답이에요, 정말 잘했어요! 문제를 차근차근 읽고 답을 찾아낸 점이 훌륭해요. "
    "오늘 배운 개념을 실제 하늘을 보면서 한 번 더 떠올려 보세요. "
    "내일도 오늘의 날씨 퀴즈로 만나요!"
)
DEFAULT_FEEDBACK_INCORRECT = (
    "아쉽지만 괜찮아요, 틀리면서 배우는 게 진짜 공부예요! "
    "정답 해설을 다시 읽어 보면 금방 이해할 수 있을 거예요. "
    "오늘 바깥 날씨를 관찰하면서 배운 개념을 한 번 더 떠올려 보세요. "
    "내일 퀴즈에서는 분명 더 잘할 수 있을 거예요!"
)


def resolve_concepts_path() -> Path:
    """`climate_concepts.json` 경로 (`chains.seed_paths` 관례 — env 탈출구 포함)."""
    return resolve_seed_path(CONCEPTS_FILENAME, CONCEPTS_PATH_ENV)


@lru_cache(maxsize=2)
def _concepts_by_tag(path_str: str | None = None) -> dict[str, tuple[dict, ...]]:
    """개념 문서를 `concept_tag` → 문서 튜플로 색인한다 (프로세스 수명 캐시).

    8KB 파일이라 통째로 메모리에 둔다 — 부분 로드가 풀 문제가 없다.
    캐시 값을 튜플로 굳혀 호출부가 색인을 훼손하지 못하게 한다.
    """
    path = Path(path_str) if path_str else resolve_concepts_path()
    chunks = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(chunks, list) or not chunks:
        raise ValueError(f"개념 시드가 비어 있거나 리스트가 아니다: {path}")

    index: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        tag = chunk.get("concept_tag")
        text = chunk.get("text")
        if not tag or not text:
            continue
        index[tag].append(chunk)
    return {tag: tuple(docs) for tag, docs in index.items()}


def lookup_concept_documents(concept_tag: str) -> list[dict]:
    """`concept_tag`에 해당하는 개념 문서 전부. 없으면 빈 리스트.

    파일을 못 읽는 것과 태그가 없는 것은 **다른 사건**이다. 전자는 배포 결함이라
    경고를 남기고, 후자는 정상 상태다(본시드에 개념 문서가 없는 태그가 실제로 있다).
    둘 다 호출부에서는 "문서 없음"으로 수렴하지만 로그가 갈린다.
    """
    try:
        index = _concepts_by_tag()
    except Exception as exc:
        logger.warning("climate_concepts 로드 실패: %s", exc)
        return []
    return list(index.get(concept_tag, ()))


def _format_context(documents: list[dict]) -> str:
    """Context Injection 포맷 (03번 스펙 섹션 4).

    관련도 점수는 뺐다 — 유사도 검색이 사라졌으므로 모든 문서가 그 개념의 정본이고,
    "관련도 0.84" 같은 수치는 이제 무엇도 가리키지 않는다. 출처 자리에는
    컬렉션명 대신 개념 태그와 수준을 적는다(모델이 문장 난이도를 맞추는 데 쓴다).
    """
    return "\n\n".join(
        f"[참고 지식 {i}] (개념: {doc.get('concept_tag', '?')},"
        f" 수준: {doc.get('grade_level', '?')})\n{doc['text']}"
        for i, doc in enumerate(documents, start=1)
    )


@lru_cache(maxsize=8)
def _cached_chain(
    provider: str, model: str, api_key: str, base_url: str | None, with_context: bool = True
):
    """(**실효 스펙**, 프롬프트 변형)별 LCEL 체인 캐시.

    LLM 클라이언트 생성 비용이 피드백 호출마다 반복되지 않도록
    모듈 수명 동안 재사용한다(R7-02 S7 지연 완화). 지연 초기화이므로 LLM 키 부재
    환경에서도 임포트는 깨지지 않고, 생성 실패 예외는 lru_cache에 캐시되지 않아
    호출부의 기본 피드백 폴백 동작이 그대로 유지된다.

    ⚠️ **키에 provider·base_url이 들어가야 한다.** 종전에는 (model, api_key)만
    실어서, OpenRouter → 로컬 Ollama처럼 **모델명이 같고 엔드포인트만 다른** 전환이
    조용히 옛 클라이언트를 재사용했다(`validate_chain`은 이미 둘 다 싣고 있었다).
    """
    prompt = ChatPromptTemplate.from_messages(
        [("system", SYSTEM_PROMPT if with_context else SYSTEM_PROMPT_NO_CONTEXT)]
    )
    # 런타임은 CO-B7이 "전건 유료 Gemini"로 정한 구간이지만, 통로는 열어 둔다 —
    # 결정이 바뀌어도 코드를 안 고치게 하는 것이 이 층의 목적이다.
    llm = build_chat_model(0.5, purpose=PURPOSE_RUNTIME)
    return prompt | llm | StrOutputParser()


def _build_chain(with_context: bool = True):
    """LCEL: 프롬프트 → LLM → 순수 텍스트 (**실효 스펙** 기준 캐시 조회).

    ⚠️ **`resolve_spec`이 아니라 `effective_spec`으로 키를 만든다.** 이 한 줄이
    예산 사다리의 성패를 가른다: 캐시를 설정값으로 키잉하면 한도를 넘겨 강등된
    뒤에도 **키가 그대로**라 `_cached_chain`이 예산 소진 전에 만든 Gemini 체인을
    돌려준다. 클라이언트를 만든 것은 `build_chat_model`(강등 반영)인데 **찾는
    열쇠가 그 사실을 모르는 것**이라, 프로세스가 사는 동안 상한을 넘겨 계속 과금된다
    — 이 모듈이 존재하는 이유("최대 $5"가 곧이곧대로 참이어야 한다)가 무너진다.
    저작·검증은 `effective == resolve`(batch)라 영향이 없고, 런타임만 갈린다.
    """
    spec, _why = effective_spec(PURPOSE_RUNTIME)
    return _cached_chain(spec.provider, spec.model, spec.api_key, spec.base_url, with_context)


def generate_feedback(
    question_text: str,
    user_answer: str | None,
    is_correct: bool,
    concept_tag: str,
    today_weather: dict | None = None,
) -> str:
    """문제 풀이 직후 학습자에게 줄 피드백(순수 텍스트)을 생성한다."""
    if not _llm_available():
        # 키 미설정 시 조회·LLM 시도 없이 즉시 기본 피드백 (실패 대기 방지).
        return DEFAULT_FEEDBACK_CORRECT if is_correct else DEFAULT_FEEDBACK_INCORRECT

    documents = lookup_concept_documents(concept_tag)

    inputs = {
        "question_text": question_text,
        "user_answer": user_answer if user_answer is not None else "(무응답)",
        "is_correct": "정답" if is_correct else "오답",
        "today_weather_json": json.dumps(today_weather or {}, ensure_ascii=False),
    }
    if documents:
        inputs["concept_documents"] = _format_context(documents)

    try:
        feedback = _build_chain(bool(documents)).invoke(inputs)
        feedback = feedback.strip()
        if feedback:
            return feedback
        raise ValueError("empty feedback from LLM")
    except Exception as exc:
        logger.warning("rag feedback generation failed, using default: %s", exc)
        return DEFAULT_FEEDBACK_CORRECT if is_correct else DEFAULT_FEEDBACK_INCORRECT
