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
#   ⑤ vocab    학령 금칙 어휘 (R13-01 §2.3) — level_group이 elementary·middle_high인
#              문항의 template_json **전체 문자열**(질문·선지·정답·items·pairs·해설·
#              힌트·guide_steps)에 학령 금칙 어휘가 있으면 탈락. adult·expert는 면제.
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

def load_vocabulary(path: Path = VOCABULARY_PATH) -> list[dict]:
    """학령 금칙 어휘 목록을 JSON에서 읽는다 (코드에 어휘를 박지 않는다 — §2.3).

    파일이 없거나 형태가 어긋나면 예외를 올린다 — 검사가 조용히 꺼지면 규칙이
    없는 것과 같기 때문이다(호출부가 파이프라인 로드 실패로 종료 코드 2 처리).
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    banned = data["banned"]
    for entry in banned:
        if not entry.get("term") or not entry.get("banned_levels"):
            raise ValueError(f"금칙 어휘 항목에 term/banned_levels 누락: {entry}")
        if not entry.get("basis"):
            raise ValueError(f"금칙 어휘 '{entry['term']}'에 교육과정 근거(basis) 없음")
    return list(banned)


def _all_strings(node) -> list[str]:
    """중첩 구조(dict·list) 안의 모든 문자열을 평탄화한다 — 키는 보지 않는다.

    template_json 전체가 대상이라 유형별 필드(options·items·pairs·hints·
    guide_steps·explanation_hint…)를 열거하지 않는다. 열거하면 새 유형이 붙을 때
    조용히 검사에서 빠진다.
    """
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        return [s for v in node.values() for s in _all_strings(v)]
    if isinstance(node, list):
        return [s for v in node for s in _all_strings(v)]
    return []


def vocabulary_errors(item: dict, vocabulary: list[dict]) -> list[str]:
    """문항의 학령에서 금칙인 어휘가 template_json 어디든 있으면 사유를 만든다."""
    level = str(item.get("level_group") or "")
    blob = " ".join(_all_strings(item.get("template_json") or {}))
    hits = [
        entry
        for entry in vocabulary
        if level in entry["banned_levels"] and entry["term"] in blob
    ]
    # 더 긴 금칙어에 포함되는 짧은 금칙어는 중복 보고하지 않는다
    # (예: '권층운' 적발 시 '층운'까지 두 줄로 나오는 소음 방지).
    terms = {e["term"] for e in hits}
    hits = [e for e in hits if not any(e["term"] != t and e["term"] in t for t in terms)]
    return [
        f"'{entry['term']}' — {level} 금칙 어휘. 근거: {entry['basis']}"
        + (f" / 대안 표현: {entry['suggest']}" if entry.get("suggest") else "")
        for entry in hits
    ]


# 탈락 사유 카테고리 — 리포트는 항상 이 6종을 0건 포함해 전부 출력한다.
STAGES: tuple[tuple[str, str], ...] = (
    ("gate1", "① 1차 게이트 탈락 (휴리스틱)"),
    ("payload", "② payload 계약 탈락"),
    ("schema", "③ 스키마 탈락 (validate_entry)"),
    ("dup_file", "④ 중복 (파일 내)"),
    ("dup_base", "④ 중복 (본시드 대조)"),
    ("vocab", "⑤ 학령 금칙 어휘"),
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
    vocabulary: list[dict],
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

        # ⑤ 학령 금칙 어휘 — elementary·middle_high만 대상(목록이 학령을 들고 있다)
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
