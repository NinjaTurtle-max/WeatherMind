"""신고된 `knowledge_level`을 어휘 도입 단계와 대조하는 결정적 판정 (docs/specs/12 §7.4).

## 왜 이 모듈이 생겼는가

R13 2일차에 본시드 141건 전수 재분류가 착지하면서 `lint_seed_items` 검사 ⑤의
**전환기 폴백이 만료**됐다 — 이제 `knowledge_level`이 없는 문항은 그 자체로 탈락한다
("미부여 — 단계를 판정할 수 없다"). 그런데 생성 경로는 그 값을 내지 못했다:
`level_group`에서 기계로 복원하는 것은 docs/specs/12 §5.3이 **금지**하고(파생은
단방향), R2~R6은 원리적으로 사람 몫이다. 그래서 남은 길은 하나뿐이다 —
**생성 프롬프트가 단계를 직접 신고하고, 결정적 게이트가 그 신고를 검증한다.**

이 모듈은 그 "검증" 쪽이다. 신고 쪽은 `quiz_gen_chain.SYSTEM_PROMPT`(스펙 03 §2)와
`payload_contract.QuizQuestion.knowledge_level`이 담당한다.

## 왜 1차(휴리스틱) 게이트인가 — 2차 LLM 게이트가 아니라

키가 없는 환경이 이 저장소의 기본 상태다(비용 게이트 — CLAUDE.md). 2차 LLM 게이트에
어휘 검증을 얹으면 무키에서 **조용히 안 도는 게이트**가 된다. 어휘 대조는 문자열
포함 판정이라 LLM이 필요 없고, 오히려 LLM보다 결정적이다.

## 왜 어휘를 코드에 박지 않는가

`database/seed/level_vocabulary.json`이 단독 소유자다(그 파일 `purpose` 필드).
교육과정 근거(`basis`)가 데이터와 같은 곳에 있어야 개정된다. 단계 수 N도 코드에
박지 않는다 — `anchor` 블록의 키에서 나온다(`lint_seed_items.load_vocabulary`,
`weatherbrain_service.KNOWLEDGE_LEVEL_BANDS`와 같은 관례).

## 판정식이 두 곳에 있는 이유와 그 대책

같은 판정식을 `scripts/lint_seed_items.vocabulary_errors`도 갖고 있다. 합칠 수 없다 —
`scripts/`는 backend·ai-worker를 격리 임포트하는 상위 컨텍스트이고, ai-worker
컨테이너에는 `scripts/`가 들어가지 않는다(Dockerfile은 `app`만 COPY한다). 대신
**대조 대상이 갈리므로 둘 다 필요하다**:

| | 대상 | 신고값의 자리 |
|---|---|---|
| 이 모듈 (gate1) | 생성 산출물 flat dict | flat 최상위 `knowledge_level` |
| `lint_seed_items` ⑤ | 뱅크 항목(중첩) | 항목 최상위 `knowledge_level` |

`expand_like_server`(= `session_service`의 런타임 전개)는 `knowledge_level`을
**flat에 싣지 않으므로**, lint가 gate1을 통해 이 검사를 이중으로 돌리는 일은 없다.
드리프트는 `ai-worker/tests/test_knowledge_level_gate.py`의 동치성 테스트가 감시한다
(같은 문항에 두 구현이 **같은 메시지**를 내야 한다).

의존은 stdlib까지다 — `payload_contract`와 같은 규약(무키 경로에 필요한 것을
langchain 뒤에 두지 않는다).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.chains.seed_paths import resolve_seed_path

# 단계 하한. 상한은 코드가 아니라 어휘표 `anchor`가 정한다(N이 6→7로 늘어도
# 이 파일을 열지 않는다 — 마이그레이션 0012가 상한 CHECK를 걸지 않은 것과 같은 이유).
KNOWLEDGE_LEVEL_MIN = 1

VOCABULARY_FILENAME = "level_vocabulary.json"
VOCABULARY_RELATIVE_PATH = Path("database") / "seed" / VOCABULARY_FILENAME
VOCABULARY_PATH_ENV = "LEVEL_VOCABULARY_PATH"

# 정답이 담기는 필드 — 여기 등장한 용어는 "정답에 쓰였다"로 보고 introduced_at을
# 임계로 쓴다(docs/specs/12 §4 R4 남용 방지 조건 2와 같은 판단).
# `lint_seed_items.ANSWER_FIELDS`와 값이 같아야 한다(동치성 테스트가 감시).
ANSWER_FIELDS: tuple[str, ...] = (
    "correct_answer",
    "items",
    "pairs",
    "goal_conditions",
)

# flat 문항 dict에서 **문항 텍스트가 아닌** 키 — 판정 대상 문자열에서 뺀다.
# 이것을 빼야 flat(생성 산출물)과 template_json(뱅크 항목)의 판정 범위가 같아진다
# (docs/specs/12 §4 R0: 판정 범위는 `lint_seed_items._all_strings`와 같아야 한다).
NON_TEMPLATE_KEYS: frozenset[str] = frozenset(
    {"concept_tag", "question_type", "knowledge_level", "level_group", "quiz_id"}
)


def resolve_vocabulary_path() -> Path:
    """어휘표 경로를 결정한다 (관례 본체는 `chains.seed_paths.resolve_seed_path`).

    R13 3일차에 `rag_chain`이 `climate_concepts.json`의 두 번째 소비자가 되면서
    이 함수가 갖고 있던 탐색 순서를 `seed_paths`로 옮겼다 — 컨테이너 마운트 규약이
    바뀌면 고칠 곳이 하나여야 한다. 이름·예외 형태는 그대로다.
    """
    return resolve_seed_path(VOCABULARY_FILENAME, VOCABULARY_PATH_ENV)


def load_vocabulary(path: Path | None = None) -> dict:
    """어휘표를 읽고 최소 형태를 확인한다. 위반이면 예외 — 조용히 꺼지지 않는다.

    검사가 조용히 꺼지면 규칙이 없는 것과 같다(`lint_seed_items.load_vocabulary`와
    같은 판단). 호출부(`validate_chain`)가 예외를 잡아 **탈락 사유**로 바꾼다.
    """
    return _load_vocabulary_cached(str(path) if path else None)


@lru_cache(maxsize=4)
def _load_vocabulary_cached(path_str: str | None) -> dict:
    path = Path(path_str) if path_str else resolve_vocabulary_path()
    data = json.loads(path.read_text(encoding="utf-8"))
    if "banned" in data or "reviewed_allowed" in data:
        raise ValueError(
            f"{path}가 v1 스키마(banned/reviewed_allowed)다 — "
            "docs/specs/12 §7.1 개정안(terms + introduced_at)이어야 한다"
        )
    anchor = data["anchor"]
    levels = sorted(int(k) for k in anchor)
    if levels != list(range(KNOWLEDGE_LEVEL_MIN, KNOWLEDGE_LEVEL_MIN + len(levels))):
        raise ValueError(f"anchor 단계 키가 1..N 연속이 아니다: {sorted(anchor)}")
    if not data.get("mechanism_markers"):
        raise ValueError("mechanism_markers 누락 — 판정식의 '메커니즘 질문'을 못 본다")
    if not data.get("terms"):
        raise ValueError("terms가 비었다")
    return data


def max_knowledge_level(vocabulary: dict) -> int:
    """단계 수 N — 어휘표 `anchor` 키에서 나온다(코드에 박지 않는다)."""
    return max(int(k) for k in vocabulary["anchor"])


def _all_strings(node: Any) -> list[str]:
    """중첩 구조 안의 모든 문자열을 평탄화한다 — 키는 보지 않는다.

    `lint_seed_items._all_strings`와 **같은 범위**여야 한다(docs/specs/12 §4 R0).
    """
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        return [s for v in node.values() for s in _all_strings(v)]
    if isinstance(node, list):
        return [s for v in node for s in _all_strings(v)]
    return []


def _term_threshold(entry: dict, *, decisive: bool) -> int:
    """이 용어가 이 문항에서 요구하는 최소 단계 (§7.4 판정식의 괄호 안)."""
    if decisive:
        return int(entry["introduced_at"])
    return int(entry.get("name_ok_from", entry["introduced_at"]))


def _drop_contained(hits: list[dict]) -> list[dict]:
    """더 긴 적발어에 포함되는 짧은 적발어는 중복 보고하지 않는다."""
    terms = {h["entry"]["term"] for h in hits}
    return [
        h
        for h in hits
        if not any(h["entry"]["term"] != t and h["entry"]["term"] in t for t in terms)
    ]


def template_strings(question: dict) -> list[str]:
    """flat 문항 dict에서 **문항 텍스트에 해당하는** 문자열만 뽑는다."""
    return _all_strings(
        {k: v for k, v in question.items() if k not in NON_TEMPLATE_KEYS}
    )


def vocabulary_violations(question: dict, level: int, vocabulary: dict) -> list[str]:
    """신고 단계보다 늦게 도입되는 용어가 문항 어디든 있으면 사유를 만든다.

    판정식(docs/specs/12 §7.4):
        탈락 = knowledge_level < (그 용어가 정답·메커니즘 질문에 쓰이면 introduced_at,
                                  아니면 name_ok_from)

    "정답·메커니즘 질문에 쓰였는가"의 기계 판별은 ⓐ 정답 필드(ANSWER_FIELDS)에
    등장하거나 ⓑ 질문 본문에 메커니즘 표지(왜·까닭·원리…)가 있고 그 본문에 용어가
    있으면 참이다. 나머지(R2~R6 · 문항 내 정의 R4)는 사람 몫이고, 기계 1차 패스는
    **보수적으로 상향**한다(docs/specs/12 §8.1).

    메시지 문자열은 `lint_seed_items.vocabulary_errors`와 **같아야 한다** —
    같은 문항을 두 경로로 봤을 때 저작자가 다른 말을 듣지 않게 하기 위함이고,
    동치성 테스트가 이것을 감시한다.
    """
    blob = " ".join(template_strings(question))
    answer_blob = " ".join(
        _all_strings({k: question.get(k) for k in ANSWER_FIELDS})
    )
    text = str(question.get("question_text") or "")
    asks_mechanism = any(m in text for m in vocabulary["mechanism_markers"])

    hits: list[dict] = []
    for entry in vocabulary["terms"]:
        term = entry["term"]
        if term not in blob:
            continue
        decisive = term in answer_blob or (asks_mechanism and term in text)
        threshold = _term_threshold(entry, decisive=decisive)
        if level < threshold:
            hits.append({"entry": entry, "threshold": threshold, "decisive": decisive})

    return [
        f"'{h['entry']['term']}' — {level}단계 문항인데 도입 단계 {h['threshold']}"
        f" ({'정답·메커니즘 사용' if h['decisive'] else '배경 어휘'} 기준"
        + (
            f", 성취기준 {h['entry']['standard']}"
            if h["entry"].get("standard")
            else ", 교육과정 밖"
        )
        + f"). 근거: {h['entry']['basis']}"
        + (f" / 대안 표현: {h['entry']['suggest']}" if h["entry"].get("suggest") else "")
        for h in _drop_contained(hits)
    ]
