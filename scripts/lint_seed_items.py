#!/usr/bin/env python3
# =============================================================================
# WeatherMind 시드 문항 lint 하네스 — R11-01 §9.1 (BE-S)
#
# 존재 이유: 뱅크 확장(§9 — 본시드 53 → 저작 staging → 최종 ~1,500)에서 병합
# 게이트(PM)가 파일 단위로 돌릴 수 있는 **전건 검사**가 필요하다. author_items.py의
# 검사는 "생성 배치 산출물"에만 걸리고, 손으로 저작한 staging 파일·기존 본시드는
# 아무 게이트도 거치지 않는다(R10-07: 시드 6문항이 게이트 없이 API 미노출 상태로
# 들어가 있었다).
#
# 사용법:
#   python scripts/lint_seed_items.py                                  # 본시드 전건
#   python scripts/lint_seed_items.py database/seed/staging/au1_weather_items.json
#   python scripts/lint_seed_items.py <파일> --base database/seed/content_items.json
#
# 검사 5종 (문항마다 전부 실행 — 첫 탈락에서 멈추지 않는다):
#   ① gate1    validate_chain.run_heuristic_checks — LLM 무관·결정적 1차 게이트.
#              서버 전개형(expand_like_server)에 적용한다.
#   ② payload  ⓐ 프론트 렌더 필수 필드(REQUIRED_FIELDS — 아래 소유자 주석)가
#                실제로 채워졌는가(R10-07 반례 재발 방지). QUESTION_PAYLOAD_FIELDS
#                전체를 필수로 쓰지 않는다 — 그것은 "노출 가능" 화이트리스트라
#                board의 선택 필드(guide_steps·time_limit_sec·based_on)를 포함하고,
#                필수 판정에 그대로 쓰면 선택 필드 미저작이 오탈락한다(2026-08-05
#                본시드 실측에서 board 12건 과탐 — 이 하네스 최초 실행의 발견).
#              ⓑ check_payload(ai-worker 계약 G) — 서버 전개형에. 생성 대상 유형
#                (GENERATED_PAYLOAD_FIELDS 3종)에만 적용한다 — board·match·
#                ordering·cloze는 계약 G 밖(저작 영역)이므로 건너뛴다.
#   ③ schema   seed_content.validate_entry — 시드 적재 스키마(중첩 형태).
#   ④ dup      정규화 중복 배제 — 파일 내 + (staging이면) 본시드 대조 양쪽.
#              정규화 키 set 비교라 O(n) — ~1,500 규모(G1 배치)도 감당한다.
#              (유형·개념·정답) 키는 정규화 정답이 **비어 있지 않을 때만** 본다 —
#              board·match·ordering은 correct_answer 없이 채점(goal_conditions·
#              pairs·items)하므로 빈 정답 키로 비교하면 같은 개념의 전 퍼즐이
#              서로 중복으로 오탈락한다(2026-08-05 본시드 실측 9건 과탐).
#   ⑤ vocab    단계 금칙 어휘 (R13-01 §2.3 → docs/specs/12 §7.4로 개정) —
#              문항의 template_json **전체 문자열**(질문·선지·정답·items·pairs·해설·
#              힌트·guide_steps)에 등장하는 용어의 도입 단계가 문항의
#              knowledge_level보다 높으면 탈락:
#                  탈락 = knowledge_level < (그 용어가 정답·메커니즘 질문에 쓰이면
#                                            introduced_at, 아니면 name_ok_from)
#              **면제가 없다** — 6단계 문항에서만 전 용어가 통과하고 그 아래는 전부
#              걸린다. v1의 adult·expert 통째 면제가 실무 수치 유입 통로였다
#              (docs/specs/12 §8.2: adult 36건 무검사 → [58] 건조 단열 감률 ·
#              [98] 위험반원이 게이트 없이 통과).
#              ⚠️ **전환기 폴백**: knowledge_level이 없는(미분류) 문항은 v1의 학령
#              규칙(elementary·middle_high만 검사, adult·expert 면제)을 그대로 쓴다 —
#              vocabulary_errors 아래 주석에 만료 조건이 있다.
#              목록은 database/seed/level_vocabulary.json이 단독 소유한다 — 코드에
#              어휘를 박지 않는다(교육과정 근거가 데이터와 같은 곳에 있어야 개정된다).
#              발단: 본시드 [86] middle_high ordering의 정답 항목이 권운·권층운·
#              고층운·난층운이었다(중학 교육과정 밖 십운형 명칭).
#
# 검사 로직은 전부 author_items.py에서 **import 재사용**한다(사본 금지 —
# expand_like_server·payload_contract_errors·dedupe_keys·_failed_names,
# 그리고 load_backend_contract/load_ai_worker의 실임포트 계약값).
#
# 리포트: 탈락 사유별 건수(0건 포함 전부 출력 — 조용한 절삭 금지) + 문항별 상세.
# 종료 코드: 0 전건 통과 / 1 탈락 존재 또는 입력 오류 / 2 파이프라인 로드 실패
#
# ci.sh 편입은 PM 몫(§9.1) — 이 스크립트는 단독 실행만 책임진다.
# =============================================================================
"""시드/저작 staging 파일 전 문항에 게이트·계약·스키마·중복 검사를 돌리는 lint."""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import author_items  # noqa: E402  (검사 로직 단일 소유자 — 사본 금지)

DEFAULT_SEED_PATH = author_items.DEFAULT_SEED_PATH
VOCABULARY_PATH = author_items.REPO_ROOT / "database" / "seed" / "level_vocabulary.json"


def load_render_required() -> dict[str, tuple[str, ...]]:
    """프론트 렌더 필수 필드 표 — 단일 소유자에서 실임포트한다(사본 금지).

    소유자: backend/tests/test_r10_question_payload_contract.py의 REQUIRED_FIELDS
    (QuestionCard.jsx 유형별 렌더 분기 근거, board 집합은
    test_session_board_item.RENDER_REQUIRED와 동일 — 그 파일 자체 주석).
    앱 코드에는 이 표가 없다 — QUESTION_PAYLOAD_FIELDS는 노출 화이트리스트지
    필수 목록이 아니다(모듈 머리 ②ⓐ 주석).

    author_items._import_isolated과 같은 sys.modules 스왑 패턴이되, 테스트 모듈이
    `app.*`를 임포트하므로 backend와 backend/tests 두 경로를 함께 얹는다.
    """
    module_name = "test_r10_question_payload_contract"
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    paths = [str(author_items.BACKEND_DIR), str(author_items.BACKEND_DIR / "tests")]
    for p in paths:
        sys.path.insert(0, p)
    try:
        return dict(importlib.import_module(module_name).REQUIRED_FIELDS)
    finally:
        for p in paths:
            sys.path.remove(p)
        sys.modules.pop(module_name, None)
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)

def load_vocabulary(path: Path = VOCABULARY_PATH) -> dict:
    """용어별 도입 단계 표를 JSON에서 읽는다 (코드에 어휘를 박지 않는다 — §2.3).

    파일이 없거나 형태가 어긋나면 예외를 올린다 — 검사가 조용히 꺼지면 규칙이
    없는 것과 같기 때문이다(호출부가 파이프라인 로드 실패로 종료 코드 2 처리).

    **단계 수 N을 코드에 박지 않는다** — N은 파일의 anchor 블록 키에서 나온다
    (weatherbrain_service가 KNOWLEDGE_LEVEL_BANDS 길이로 N을 정하는 것과 같은 관례).
    """
    data = json.loads(path.read_text(encoding="utf-8"))

    if "banned" in data or "reviewed_allowed" in data:
        raise ValueError(
            "level_vocabulary.json이 v1 스키마(banned/reviewed_allowed)다 — "
            "docs/specs/12 §7.1 개정안(terms + introduced_at)이어야 한다"
        )

    anchor = data["anchor"]
    levels = sorted(int(k) for k in anchor)
    if levels != list(range(1, len(levels) + 1)):
        raise ValueError(f"anchor 단계 키가 1..N 연속이 아니다: {sorted(anchor)}")
    max_level = levels[-1]

    if not data.get("mechanism_markers"):
        raise ValueError("mechanism_markers 누락 — 판정식의 '메커니즘 질문'을 못 본다")

    entries = data["terms"]
    if not entries:
        raise ValueError("terms가 비었다")
    for entry in entries:
        term = entry.get("term")
        if not term:
            raise ValueError(f"어휘 항목에 term 누락: {entry}")
        if not entry.get("basis"):
            raise ValueError(f"어휘 '{term}'에 교육과정 근거(basis) 없음")
        if "standard" not in entry:
            # 값이 null인 것은 정상(교육과정 밖 신호)이지만 **키 자체가 없는 것**은
            # 판정을 빠뜨린 것이다 — §7.2가 "비는 항목은 그 자체가 신호"라고 한 것은
            # 의도적으로 비운 경우를 말한다.
            raise ValueError(f"어휘 '{term}'에 standard 키 없음(교육과정 밖이면 null)")
        introduced = entry.get("introduced_at")
        if not isinstance(introduced, int) or not 1 <= introduced <= max_level:
            raise ValueError(f"어휘 '{term}'의 introduced_at이 1~{max_level} 밖: {introduced!r}")
        name_ok = entry.get("name_ok_from")
        if name_ok is not None and (
            not isinstance(name_ok, int) or not 1 <= name_ok <= introduced
        ):
            raise ValueError(
                f"어휘 '{term}'의 name_ok_from이 1~introduced_at({introduced}) 밖: {name_ok!r}"
            )
        legacy = entry.get("legacy_banned_levels")
        if legacy is not None and not legacy:
            raise ValueError(f"어휘 '{term}'의 legacy_banned_levels가 빈 배열이다(생략할 것)")
    return data


def _all_strings(node) -> list[str]:
    """중첩 구조(dict·list) 안의 모든 문자열을 평탄화한다 — 키는 보지 않는다.

    template_json 전체가 대상이라 유형별 필드(options·items·pairs·hints·
    guide_steps·explanation_hint…)를 열거하지 않는다. 열거하면 새 유형이 붙을 때
    조용히 검사에서 빠진다.

    **이 범위가 docs/specs/12 §4 R0(판정 대상 텍스트)의 범위와 같다** — R0이
    "`lint_seed_items._all_strings`와 같은 범위여야 한다"고 이 함수를 지목한다.
    검사 범위와 판정 범위가 어긋나면 통과한 문항이 오분류되므로, 여기를 좁히거나
    넓히면 R0도 함께 고쳐야 한다(둘 중 하나만 바뀌면 계약 위반).
    """
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        return [s for v in node.values() for s in _all_strings(v)]
    if isinstance(node, list):
        return [s for v in node for s in _all_strings(v)]
    return []


# 정답이 담기는 필드 — 여기 등장한 용어는 "정답에 쓰였다"로 보고 introduced_at을
# 임계로 쓴다(R4 남용 방지 조건 2와 같은 판단: 정답 문자열에 있으면 예외 불가).
# 유형별로 정답의 자리가 다르다: multiple_choice·short_answer·slider·cloze는
# correct_answer, ordering은 items, match는 pairs, board는 goal_conditions.
ANSWER_FIELDS: tuple[str, ...] = (
    "correct_answer",
    "items",
    "pairs",
    "goal_conditions",
)


def _term_threshold(entry: dict, *, decisive: bool) -> int:
    """이 용어가 이 문항에서 요구하는 최소 단계 (§7.4 판정식의 괄호 안)."""
    if decisive:
        return int(entry["introduced_at"])
    return int(entry.get("name_ok_from", entry["introduced_at"]))


def _drop_contained(hits: list[dict]) -> list[dict]:
    """더 긴 적발어에 포함되는 짧은 적발어는 중복 보고하지 않는다.

    (예: '권층운' 적발 시 '층운'까지 두 줄로 나오는 소음 방지)
    """
    terms = {h["entry"]["term"] for h in hits}
    return [
        h
        for h in hits
        if not any(h["entry"]["term"] != t and h["entry"]["term"] in t for t in terms)
    ]


def _legacy_vocabulary_errors(item: dict, entries: list[dict], blob: str) -> list[str]:
    """⚠️ 전환기 폴백 — knowledge_level이 없는(미분류) 문항용 v1 규칙.

    v1(R13 1일차)의 학령 금칙 판정을 **한 글자도 바꾸지 않고** 재현한다:
    level_group이 elementary·middle_high인 문항만 검사하고 adult·expert는 면제,
    금칙 여부는 각 항목의 legacy_banned_levels가 소유한다.

    **왜 필요한가**: 본시드 141건의 knowledge_level 부여(전수 재분류)가 별건으로
    진행 중이라, 미분류 문항에 새 판정식을 걸면 재분류가 착지하기 전에 ci.sh의
    seed 단계가 붉어진다. 실제로 기단(초등 3건)·엘니뇨·라니냐·푄·높새바람이 새
    판정식에서 탈락하고, 그 해소는 재분류·재저작의 몫이다(docs/specs/12 §3.3).

    **만료 조건**: 본시드 전건에 knowledge_level이 부여되면 이 함수와 모든
    legacy_banned_levels 필드, level_vocabulary.json의 transitional 블록을 **함께**
    제거한다. 그때부터 미분류 문항은 존재하지 않아야 한다.
    """
    level_group = str(item.get("level_group") or "")
    hits = [
        {"entry": entry}
        for entry in entries
        if level_group in (entry.get("legacy_banned_levels") or ())
        and entry["term"] in blob
    ]
    return [
        f"'{h['entry']['term']}' — {level_group} 금칙 어휘. 근거: {h['entry']['basis']}"
        + (
            f" / 대안 표현: {h['entry']['suggest']}"
            if h["entry"].get("suggest")
            else ""
        )
        for h in _drop_contained(hits)
    ]


def vocabulary_errors(item: dict, vocabulary: dict) -> list[str]:
    """문항 단계보다 늦게 도입되는 용어가 template_json 어디든 있으면 사유를 만든다.

    판정식(docs/specs/12 §7.4):
        탈락 = knowledge_level < (그 용어가 정답·메커니즘 질문에 쓰이면 introduced_at,
                                  아니면 name_ok_from)

    "정답·메커니즘 질문에 쓰였는가"의 기계 판별은 ⓐ 정답 필드(ANSWER_FIELDS)에
    등장하거나 ⓑ 질문 본문에 메커니즘 표지(왜·까닭·원리…)가 있고 그 본문에 용어가
    있으면 참이다. 판별할 수 없는 나머지(R2~R6 · 문항 내 정의 R4)는 사람 몫이고,
    기계 1차 패스는 **보수적으로 상향**한다(§8.1 — 사람이 내리는 편이 안전하다).
    """
    template = item.get("template_json") or {}
    blob = " ".join(_all_strings(template))
    entries = vocabulary["terms"]

    level = item.get("knowledge_level")
    if level is None:
        return _legacy_vocabulary_errors(item, entries, blob)
    level = int(level)

    answer_blob = " ".join(
        _all_strings({k: template.get(k) for k in ANSWER_FIELDS})
    )
    question = str(template.get("question_text") or "")
    asks_mechanism = any(m in question for m in vocabulary["mechanism_markers"])

    hits: list[dict] = []
    for entry in entries:
        term = entry["term"]
        if term not in blob:
            continue
        decisive = term in answer_blob or (asks_mechanism and term in question)
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


# 탈락 사유 카테고리 — 리포트는 항상 이 6종을 0건 포함해 전부 출력한다.
STAGES: tuple[tuple[str, str], ...] = (
    ("gate1", "① 1차 게이트 탈락 (휴리스틱)"),
    ("payload", "② payload 계약 탈락"),
    ("schema", "③ 스키마 탈락 (validate_entry)"),
    ("dup_file", "④ 중복 (파일 내)"),
    ("dup_base", "④ 중복 (본시드 대조)"),
    ("vocab", "⑤ 단계 금칙 어휘"),
)


@dataclass
class Finding:
    index: int
    stage: str
    concept_tag: str
    question_text: str
    reasons: list[str]


@dataclass
class LintResult:
    total: int = 0
    findings: list[Finding] = field(default_factory=list)

    @property
    def stage_counts(self) -> Counter:
        return Counter(f.stage for f in self.findings)

    @property
    def failed_indexes(self) -> set[int]:
        return {f.index for f in self.findings}


def lint_items(
    items: list[dict],
    *,
    backend: "author_items.BackendContract",
    ai: "author_items.AiWorkerApi",
    render_required: dict[str, tuple[str, ...]],
    vocabulary: dict,
    base_items: list[dict] | None = None,
) -> LintResult:
    """전 문항에 5종 검사를 실행한다 (순수 함수 — 출력·exit 없음).

    base_items가 주어지면(=staging lint) 본시드 대조 중복까지 본다.
    중복 비교는 정규화 키 set(O(n)) — dedupe_keys의 두 키(정규화 question_text /
    유형·개념·정규화 정답) 어느 쪽이 겹쳐도 중복이다(author_items §5단계와 동일).
    단, 정답 키는 정규화 정답이 비어 있지 않은 문항만 참여한다(모듈 머리 ④ 주석).
    """
    result = LintResult(total=len(items))

    def answer_key_active(item: dict) -> bool:
        template = item.get("template_json") or {}
        return author_items.normalize_text(template.get("correct_answer")) != ""

    # 생성 대상 유형에만 계약 G(check_payload)를 적용하는 어댑터 — board·match·
    # ordering·cloze에 그대로 적용하면 "생성 대상이 아닌 question_type" ValueError가
    # 전 저작 유형을 오탈락시킨다(계약 G-1은 생성 3유형만 규정한다).
    def check_payload_generated_only(flat: dict) -> None:
        if flat.get("question_type") in ai.generated_fields:
            ai.check_payload(flat)

    base_text: set[str] = set()
    base_answer: set[str] = set()
    for it in base_items or ():
        text_key, answer_key = author_items.dedupe_keys(it)
        base_text.add(text_key)
        if answer_key_active(it):
            base_answer.add(answer_key)

    seen_text: dict[str, int] = {}
    seen_answer: dict[str, int] = {}

    for i, item in enumerate(items):
        concept_tag = str(item.get("concept_tag") or "")
        template = item.get("template_json") or {}
        text = str(template.get("question_text") or "")

        def found(stage: str, reasons: list[str]) -> None:
            result.findings.append(Finding(i, stage, concept_tag, text, reasons))

        # ① 1차 게이트 — 서버 전개형(flat)에 적용
        flat = author_items.expand_like_server(item)
        gate1_failed = author_items._failed_names(ai.gate1(flat, concept_tag or None))
        if gate1_failed:
            found("gate1", gate1_failed)

        # ② payload 계약 — 렌더 필수 필드 충족 + 계약 G(전개 후).
        #    payload_fields에 render_required를 준다(노출 화이트리스트가 아니라
        #    필수 표 — 모듈 머리 ②ⓐ 주석). generated_fields={}: "생성 대상
        #    유형인가"(G-1) 검사는 저작 시드에 해당 없음. validate_entry는 ③에서
        #    따로 돌리므로 여기서는 빈 함수로 뗀다(같은 오류의 이중 보고 방지).
        payload_errors = author_items.payload_contract_errors(
            item,
            payload_fields=render_required,
            generated_fields={},
            validate_entry=lambda *_: [],
            check_payload=check_payload_generated_only,
            index=i,
        )
        if payload_errors:
            found("payload", payload_errors)

        # ③ 스키마 — 시드 적재 가능성(중첩 형태)
        schema_errors = list(backend.validate_entry(item, i))
        if schema_errors:
            found("schema", schema_errors)

        # ⑤ 단계 금칙 어휘 — knowledge_level이 있으면 §7.4 판정식, 없으면 전환기 폴백
        vocab_errors = vocabulary_errors(item, vocabulary)
        if vocab_errors:
            found("vocab", vocab_errors)

        # ④ 중복 배제 — 본시드 대조(있으면) + 파일 내. 어느 키가 겹쳐도 중복
        #    (정답 키는 정규화 정답이 있는 문항만 — answer_key_active).
        text_key, answer_key = author_items.dedupe_keys(item)
        has_answer = answer_key_active(item)
        if text_key in base_text:
            found("dup_base", ["본시드에 동일 question_text"])
        elif has_answer and answer_key in base_answer:
            found("dup_base", ["본시드에 동일 (유형·개념·정답)"])
        if text_key in seen_text:
            found("dup_file", [f"파일 내 [{seen_text[text_key]}]과 동일 question_text"])
        elif has_answer and answer_key in seen_answer:
            found(
                "dup_file",
                [f"파일 내 [{seen_answer[answer_key]}]과 동일 (유형·개념·정답)"],
            )
        else:
            seen_text[text_key] = i
            if has_answer:
                seen_answer[answer_key] = i

    return result


def format_report(
    result: LintResult, *, target: Path, base: Path | None
) -> str:
    counts = result.stage_counts
    passed = result.total - len(result.failed_indexes)
    lines = [
        "── lint_seed_items 리포트 ─────────────────────────────────────",
        f"대상        : {target} ({result.total}문항)",
        f"본시드 대조 : {base if base else '(대상=본시드 — 파일 내 중복만 검사)'}",
        "",
        f"검사 문항   : {result.total}",
    ]
    for stage, label in STAGES:
        lines.append(f"  {author_items._pad(label, 34)}: {counts.get(stage, 0)}")
    lines.append(f"  {author_items._pad('통과(전 검사)', 34)}: {passed}")

    lines += ["", "탈락 상세:"]
    if not result.findings:
        lines.append("  (없음 — 전건 통과)")
    for stage, label in STAGES:
        staged = [f for f in result.findings if f.stage == stage]
        if not staged:
            continue
        lines.append(f"  [{label}] {len(staged)}건")
        for f in staged:
            head = f.question_text[:48] + ("…" if len(f.question_text) > 48 else "")
            lines.append(f"    - [{f.index}] ({f.concept_tag}) {head}")
            lines += [f"        · {reason}" for reason in f.reasons]
    lines.append("─────────────────────────────────────────────────────────────")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="lint_seed_items.py",
        description="시드/저작 staging 파일 전 문항 lint (게이트·payload·스키마·중복)",
    )
    parser.add_argument(
        "path",
        nargs="?",
        type=Path,
        default=DEFAULT_SEED_PATH,
        help=f"검사할 문항 JSON (기본: {DEFAULT_SEED_PATH.relative_to(author_items.REPO_ROOT)})",
    )
    parser.add_argument(
        "--base",
        type=Path,
        default=DEFAULT_SEED_PATH,
        help="본시드 대조 파일 (기본: content_items.json — 대상과 같으면 대조 생략)",
    )
    args = parser.parse_args(argv)

    try:
        backend = author_items.load_backend_contract()
        ai = author_items.load_ai_worker(with_generator=False)
        render_required = load_render_required()
        vocabulary = load_vocabulary()
    except Exception as exc:
        print(f"[lint_seed_items] 파이프라인 로드 실패: {exc}", file=sys.stderr)
        return 2

    try:
        items = author_items.load_seed(args.path)
        if not args.path.exists():
            raise ValueError(f"대상 파일이 없다: {args.path}")
        same_as_base = args.path.resolve() == args.base.resolve()
        base_items = None if same_as_base else author_items.load_seed(args.base)
    except Exception as exc:
        print(f"[lint_seed_items] 입력 오류: {exc}", file=sys.stderr)
        return 1

    result = lint_items(
        items,
        backend=backend,
        ai=ai,
        render_required=render_required,
        vocabulary=vocabulary,
        base_items=base_items,
    )
    print(
        format_report(
            result, target=args.path, base=None if same_as_base else args.base
        )
    )

    if result.findings:
        print(
            f"[lint_seed_items] FAIL — {len(result.failed_indexes)}문항 탈락 "
            f"(사유 {len(result.findings)}건). 위 상세를 해소할 것.",
            file=sys.stderr,
        )
        return 1
    print(f"[lint_seed_items] OK — {result.total}문항 전건 통과.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
