#!/usr/bin/env python3
# =============================================================================
# WeatherMind 오프라인 문항 저작 배치 — 계약 P (docs/team/CONTRACT_GEN_ITEM.md §2)
#
# 존재 이유: 런타임 생성분(session_service)은 content_item_id=None으로 소비되고
# 사라진다 — 같은 문항을 유저마다 다시 생성하며 아무것도 누적되지 않는다.
# 키 투입 게이트 G1(ROADMAP §5.3.1)의 전제는 "1회 투입 = 영구 자산"이므로,
# 생성 문항을 **시드와 같은 형태로** 뱅크에 append하는 오프라인 경로가 필요하다.
#
# 사용법:
#   python scripts/author_items.py                      # dry-run(기본) — 시드 미변경
#   python scripts/author_items.py --count 30
#   python scripts/author_items.py --concept typhoon --level-group middle_high
#   python scripts/author_items.py --weather-json /tmp/kma_today.json
#   python scripts/author_items.py --random-seed 7      # 무키 폴백 뱅크 추첨 고정
#   python scripts/author_items.py --write              # 시드에 append (되돌리기 어려움)
#
# 단계 (계약 P-2, 7단계):
#   1 생성       generate_quiz() N회. 키 없으면 폴백 뱅크가 나온다(무키에서도 완주)
#   2 1차 게이트  validate_chain.run_heuristic_checks() — LLM 무관·결정적
#   3 2차 게이트  validate_chain.validate_quiz()의 llm_* 체크. 키 없으면 건너뛰며
#                그 사실을 리포트에 명시한다(llm_skipped 건수)
#   4 payload    **게이트 통과 ≠ 서버 노출 가능**. 배치가 독립적으로 다시 본다:
#                ⓐ seed_content.validate_entry — 시드 적재 가능성(중첩 형태)
#                ⓑ QUESTION_PAYLOAD_FIELDS ∪ GENERATED_PAYLOAD_FIELDS — 서버가
#                  유형별로 노출하는 필드가 실제로 채워졌는지. R10-07이 반례다
#                  (시드 53문항 중 6문항이 게이트를 통과한 채 API 미노출이었다)
#   5 중복 배제   기존 시드 + **이번 배치 내** 양쪽. 한쪽만 보면 같은 배치에서 나온
#                쌍둥이가 통과한다. 정규화 question_text / (유형·개념·정답)
#   6 쓰기       --write에서만. append-only — 기존 항목을 수정·삭제하지 않는다
#   7 리포트      단계별 탈락 건수 + 사유 상세. **조용한 절삭 금지** — 0건도 출력
#
# 필드 맵을 이 스크립트에 손으로 베끼지 않는다. QUESTION_PAYLOAD_FIELDS(backend
# 단일 소유자)와 GENERATED_PAYLOAD_FIELDS(계약 G-3, ai-worker)를 **실임포트**한다 —
# 사본을 만들면 이 저장소가 계약 테스트로 막고 있는 드리프트를 새로 만드는 셈이다.
# backend·ai-worker는 최상위 패키지명 `app`을 공유하므로 sys.modules 스왑으로
# 격리 임포트한다(backend/tests/test_xp_contract.py의 교차 컨텍스트 임포트 관례).
#
# 범위 밖(계약 P-4): 런타임 생성분 자동 승격. session_service.py는 건드리지 않는다.
#
# 종료 코드: 0 정상(추가 0건 포함) / 1 인자·시드 오류 / 2 파이프라인 로드 실패
# =============================================================================
"""생성 문항을 시드와 같은 형태로 뱅크에 누적시키는 오프라인 저작 배치 (계약 P)."""

from __future__ import annotations

import argparse
import ast
import importlib
import json
import logging
import random
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
AI_WORKER_DIR = REPO_ROOT / "ai-worker"
DEFAULT_SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"

KST = timezone(timedelta(hours=9))

# 계약 P-1: question_text에 이 마커가 있으면 uses_live_slots=true.
# (session_service.SLOT_RE는 닫는 중괄호까지 요구하는 더 좁은 판정이다 —
#  계약이 "{today. 유무"로 고정했으므로 여기서는 마커 포함 여부만 본다.)
LIVE_SLOT_MARKER = "{today."

# 생성 결과(flat)에서 template_json **바깥**으로 나가는 키 (계약 P-1).
# 이 방향을 뒤집으면 session_service.py:490-506의 전개와 어긋나 문항이 깨진다.
#
# `knowledge_level`은 R13 3일차에 추가됐다 — 본시드 스키마에서 이 키가
# `level_group`·`concept_tag`와 같은 **항목 최상위**에 있기 때문이다
# (`content_items.knowledge_level` 컬럼이고 template_json 안이 아니다).
# 이 키를 template_json 안에 두면 `seed_content.validate_entry`가 읽지 못해
# 미분류(NULL)로 적재되고, 결국 신고값이 다시 버려진다.
OUTER_FIELDS = ("concept_tag", "question_type", "knowledge_level")
# 뱅크 항목에 남기지 않는 생성 부산물 — quiz_id는 source.refs로 추적한다.
NON_TEMPLATE_FIELDS = ("quiz_id",)

# 프롬프트에 넣는 대표 기상 스냅샷. 실제 수집값으로 저작하려면 --weather-json.
# (무키 폴백 경로에서는 사용되지 않는다 — LLM 호출 자체가 생략되므로.)
DEFAULT_WEATHER: dict[str, Any] = {
    "region": "서울",
    "temp_max": 31,
    "temp_min": 24,
    "humidity": 72,
    "rain_prob": 60,
    "sky": "구름많음",
    "pressure": 1006,
    "wind_speed": 5,
}

DEFAULT_COUNT = 12

# 탈락 단계 — 리포트는 항상 이 5종을 0건 포함해 전부 출력한다 (P-2 7단계).
STAGES: tuple[tuple[str, str], ...] = (
    ("gate1", "1차 게이트 탈락 (휴리스틱)"),
    ("gate2", "2차 게이트 탈락 (LLM)"),
    ("payload", "payload 계약 탈락"),
    ("dup_seed", "중복 배제 (기존 시드)"),
    ("dup_batch", "중복 배제 (배치 내)"),
)


# ── 교차 빌드 컨텍스트 임포트 ────────────────────────────────────────────────
def _import_isolated(package_dir: Path, module_names: Sequence[str]) -> dict[str, Any]:
    """`app` 최상위 패키지를 공유하는 두 컨텍스트를 충돌 없이 임포트한다.

    backend/tests/test_xp_contract.py::_import_celery_league와 동일한 sys.modules
    스왑 패턴이다. 반환된 모듈 객체는 sys.modules에서 제거된 뒤에도 자기 globals를
    유지하므로 그대로 쓸 수 있다.
    """
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(package_dir))
    try:
        return {name: importlib.import_module(name) for name in module_names}
    finally:
        sys.path.remove(str(package_dir))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)


def _langchain_available() -> bool:
    """langchain 실 패키지가 설치돼 있는지 — 키가 있을 때만 의미가 있다."""
    try:
        importlib.import_module("langchain_core")
    except ImportError:
        return False
    return True


@dataclass(frozen=True)
class BackendContract:
    """backend에서 실임포트한 계약값 (손으로 베낀 사본 없음)."""

    payload_fields: dict[str, tuple[str, ...]]
    level_groups: tuple[str, ...]
    concept_tags: tuple[str, ...]
    validate_entry: Callable[[dict, int], list[str]]


def load_backend_contract() -> BackendContract:
    """QUESTION_PAYLOAD_FIELDS·LEVEL_GROUPS·validate_entry를 backend에서 가져온다."""
    mods = _import_isolated(
        BACKEND_DIR,
        (
            "app.routers.session",
            "app.services.placement_service",
            "app.scripts.seed_content",
        ),
    )
    seed_content = mods["app.scripts.seed_content"]
    return BackendContract(
        payload_fields=dict(mods["app.routers.session"].QUESTION_PAYLOAD_FIELDS),
        level_groups=tuple(mods["app.services.placement_service"].LEVEL_GROUPS),
        concept_tags=tuple(sorted(seed_content.ALLOWED_CONCEPT_TAGS)),
        validate_entry=seed_content.validate_entry,
    )


@dataclass(frozen=True)
class AiWorkerApi:
    """ai-worker에서 실임포트한 생성·게이트 진입점."""

    gate1: Callable[[dict, str | None], list[dict]]
    gate2: Callable[[dict, str, str], dict]
    generate: Callable[..., dict] | None
    generated_fields: dict[str, tuple[str, ...]]
    check_payload: Callable[[dict], None]
    model_label: str
    llm_enabled: bool


def load_ai_worker(*, with_generator: bool = True) -> AiWorkerApi:
    """게이트(1·2단)·payload 계약·생성기를 ai-worker에서 가져온다.

    ai-worker의 세 모듈 모두 langchain을 **최상단에서 끌어오지 않는다** —
    `validate_chain`은 처음부터 지연 임포트였고, `payload_contract`(계약 G-3)와
    `quiz_gen_chain`(2026-08-03)이 같은 규약으로 맞춰졌다. 따라서 무키 배치는
    가짜 모듈을 심지 않고 그대로 임포트된다(계약 P-3).

    with_generator=False면 quiz_gen_chain을 아예 임포트하지 않는다(테스트에서 유용).
    """
    names = ["app.chains.validate_chain", "app.chains.payload_contract", "app.config"]
    if with_generator:
        names.append("app.chains.quiz_gen_chain")
    mods = _import_isolated(AI_WORKER_DIR, names)
    validate_chain = mods["app.chains.validate_chain"]
    payload_contract = mods["app.chains.payload_contract"]
    config = mods["app.config"]
    llm_enabled = bool(config.llm_configured())
    if with_generator and llm_enabled and not _langchain_available():
        # 키가 있는데 langchain이 없으면 generate_quiz는 LLM 호출에서 예외를 맞고
        # **조용히 폴백 뱅크로 떨어진다**(logger.warning뿐). G1에서 실키로 돌리며
        # "LLM으로 생성했다"고 착각한 결과가 시드에 들어가는 것이 최악이므로,
        # 배치를 시작하기 전에 크게 실패시킨다.
        raise RuntimeError(
            "GEMINI 키가 설정돼 있는데 langchain이 없다 — LLM 생성이 조용히 폴백 "
            "뱅크로 떨어진다. pip install -r ai-worker/requirements.txt"
        )
    quiz_gen = mods.get("app.chains.quiz_gen_chain")
    return AiWorkerApi(
        gate1=validate_chain.run_heuristic_checks,
        gate2=validate_chain.validate_quiz,
        generate=quiz_gen.generate_quiz if quiz_gen else None,
        generated_fields=dict(payload_contract.GENERATED_PAYLOAD_FIELDS),
        check_payload=payload_contract.check_payload,
        model_label=(
            config.settings.GEMINI_MODEL if llm_enabled else "fallback_bank (키 미설정)"
        ),
        llm_enabled=llm_enabled,
    )


# ── 순수 변환·검사 ───────────────────────────────────────────────────────────
_NON_WORD_RE = re.compile(r"[\s\W_]+", re.UNICODE)


def normalize_text(value: Any) -> str:
    """공백·문장부호를 제거한 비교용 정규화 문자열 (계약 P-2 5단계)."""
    return _NON_WORD_RE.sub("", str(value if value is not None else "")).lower()


def dedupe_keys(item: dict) -> tuple[str, str]:
    """(정규화 question_text, 유형|개념|정규화 정답) — 어느 쪽이 겹치면 중복."""
    template = item.get("template_json") or {}
    text_key = normalize_text(template.get("question_text"))
    answer_key = "|".join(
        (
            str(item.get("question_type") or ""),
            str(item.get("concept_tag") or ""),
            normalize_text(template.get("correct_answer")),
        )
    )
    return text_key, answer_key


def to_bank_item(
    flat: dict, level_group: str, refs: Iterable[str] = ()
) -> dict[str, Any]:
    """flat 생성 결과 → 시드와 같은 중첩 형태 (계약 P-1).

    concept_tag·question_type·knowledge_level은 **바깥**, 나머지는 template_json **안**.
    값이 None인 키는 버린다 — QuizQuestion의 선택 payload(min·max·step·unit)가
    비-slider 유형에서 None으로 model_dump되므로, 그대로 두면 시드에 없는
    "min": null 같은 필드가 뱅크에 섞인다.

    **`knowledge_level`이 없으면 그 키를 만들지 않는다** (미분류로 적재 — 0012 폴백).
    조용히 채워 넣지 않는 것이 중요하다: `level_group`에서 복원하는 것은
    `docs/specs/12` §5.3이 금지하고, 임의 기본값을 박으면 `lint_seed_items` 검사 ⑤가
    잡아야 할 미신고가 **정상값으로 위장**된다. 미분류는 lint에서 탈락해야 옳다.
    """
    template = {
        key: value
        for key, value in flat.items()
        if key not in OUTER_FIELDS
        and key not in NON_TEMPLATE_FIELDS
        and value is not None
    }
    question_text = str(template.get("question_text") or "")
    item = {
        "concept_tag": flat.get("concept_tag"),
        "level_group": level_group,
        "question_type": flat.get("question_type"),
        "template_json": template,
        "uses_live_slots": LIVE_SLOT_MARKER in question_text,
        "source": {"kind": "generated", "refs": list(refs)},
        "status": "active",
    }
    knowledge_level = flat.get("knowledge_level")
    if knowledge_level is not None:
        # 시드 실측 키 순서(concept_tag → level_group → knowledge_level →
        # question_type …)를 그대로 재현한다 — append된 항목이 기존 시드와 같은
        # 모양이어야 사람이 diff를 읽을 수 있다.
        item = {
            "concept_tag": item["concept_tag"],
            "level_group": item["level_group"],
            "knowledge_level": knowledge_level,
            **{k: v for k, v in item.items() if k not in ("concept_tag", "level_group")},
        }
    return item


def expand_like_server(item: dict) -> dict:
    """뱅크 항목을 서버와 **같은 방식으로** 런타임 question dict로 전개한다.

    session_service.py:502-506이 하는 그대로 — {**template_json, concept_tag,
    question_type}. 저작 산출물을 이 전개를 통과시켜 검사하면 flat↔nest 방향이
    뒤집힌 항목이 여기서 드러난다(template_json 밖으로 나간 question_text 등).
    """
    return {
        **(item.get("template_json") or {}),
        "concept_tag": item.get("concept_tag"),
        "question_type": item.get("question_type"),
    }


def payload_contract_errors(
    item: dict,
    *,
    payload_fields: dict[str, tuple[str, ...]],
    generated_fields: dict[str, tuple[str, ...]],
    validate_entry: Callable[[dict, int], list[str]],
    check_payload: Callable[[dict], None] | None = None,
    index: int = 0,
) -> list[str]:
    """계약 P-2 4단계 — 게이트와 **독립적으로** 산출물을 다시 본다.

    ⓐ validate_entry(backend): 중첩 형태가 시드 스키마로 적재 가능한가
    ⓑ QUESTION_PAYLOAD_FIELDS(backend) ∪ GENERATED_PAYLOAD_FIELDS(ai-worker):
      서버가 이 유형에서 노출하는 필드가 **실제로 채워졌는가**
    ⓒ check_payload(ai-worker): 서버 전개형에 계약 G 전체(G-1·G-2)를 다시 적용
    세 검사 모두 **실임포트한 소유자 코드**로 한다 — 사본을 만들지 않는다.
    """
    errors = list(validate_entry(item, index))
    question_type = item.get("question_type")
    if generated_fields and question_type not in generated_fields:
        errors.append(
            f"[{index}] 생성 대상 유형이 아님(계약 G-1): {question_type!r}"
        )
    else:
        required = tuple(
            dict.fromkeys(
                (
                    *payload_fields.get(question_type, ()),
                    *generated_fields.get(question_type, ()),
                )
            )
        )
        template = item.get("template_json") or {}
        missing = [name for name in required if template.get(name) is None]
        if missing:
            errors.append(
                f"[{index}] {question_type} payload 필드 누락 — 서버 미노출: "
                f"{', '.join(missing)}"
            )
    if check_payload is not None:
        try:
            check_payload(expand_like_server(item))
        except Exception as exc:
            errors.append(f"[{index}] 계약 G 위반(서버 전개형): {exc}")
    return errors


# ═════════════════════════════════════════════════════════════════════════════
# 템플릿 확장 (R13 3일차 — 클라이언트 결정 2026-08-07: G1을 완성품이 아니라
# **생성기**에 쓴다). **설계 실증 범위다** — 전면 구현이 아니다.
#
# 한 줄 요약: 템플릿 = (텍스트 골격 + 파라미터 표 + **정답 도출 규칙**).
# 인스턴스는 파라미터 표의 한 행에서 **결정적으로** 만들어지고, 정답은 사람이
# 행마다 적는 것이 아니라 규칙이 도출한다. 정답을 사람이 검수하지 못하는 규모가
# 되므로, 도출이 결정적이지 않으면 이 설계 전체가 성립하지 않는다.
#
# 정의 파일: database/seed/staging/r13_item_templates.json (스키마는 그 파일 머리)
# 산출물   : 시드와 같은 형태 → lint_seed_items가 그대로 검사한다(새 게이트 없음).
# ═════════════════════════════════════════════════════════════════════════════

# `{name}` 치환 — `{today.temp_max}` 같은 실황 슬롯은 **점을 포함**하므로 이 패턴에
# 걸리지 않는다. 두 치환 축을 섞지 않는 것이 의도다(실황 슬롯은 런타임·서버 소유,
# 템플릿 파라미터는 저작 시점·오프라인 소유).
TEMPLATE_PARAM_RE = re.compile(r"\{([a-z_][a-z0-9_]*)\}")

BOARD_RULES_PATH = REPO_ROOT / "database" / "seed" / "board_rules.json"

# slider 정답 도출 시 요구하는 최소 범위. 채점 관용오차(answer_service.SLIDER_TOLERANCE)가
# **절대값 10**이라 범위가 좁으면 아무 값이나 정답이 된다. 관용오차의 4배를 하한으로 둔다.
SLIDER_MIN_SPAN = 40


def load_level_group_deriver() -> Callable[[int], str]:
    """knowledge_level → level_group 파생 함수를 backend에서 실임포트한다.

    docs/specs/12 §5.3의 파생표는 `weatherbrain_service.KNOWLEDGE_LEVEL_BANDS`가
    단독 소유한다 — 여기 사본을 만들면 6→7 분할 때 두 곳이 갈린다.
    """
    mods = _import_isolated(BACKEND_DIR, ("app.services.weatherbrain_service",))
    return mods["app.services.weatherbrain_service"].level_group_of_knowledge_level


def load_board_zones() -> list[str]:
    """보드 4존의 이름을 backend `board_engine.ZONES`에서 실임포트한다.

    `database/seed/board_regions.json`의 이름("서해상"·"영서·태백")은 **SVG 지도용**이라
    판정 엔진의 존 이름("서해"·"태백산맥")과 다르다. 본시드 board 13건이 전부
    엔진 쪽 이름을 쓰므로 그쪽이 문항의 정본이다.
    """
    mods = _import_isolated(BACKEND_DIR, ("app.services.board_engine",))
    return list(mods["app.services.board_engine"].ZONES)


def render_params(value: Any, row: dict) -> Any:
    """문자열 안의 `{param}`을 행 값으로 치환한다 (중첩 구조 재귀).

    미정의 파라미터는 **조용히 남기지 않고 예외**를 낸다. 남기면
    "{front}이 지나갈 때…"가 그대로 유저에게 노출된다 — 실황 슬롯 미치환이
    `session_service`에서 폴백을 부르는 것과 같은 종류의 사고다.
    """
    if isinstance(value, str):
        def repl(match: re.Match) -> str:
            key = match.group(1)
            if key not in row:
                raise KeyError(f"템플릿 파라미터 '{key}'가 행에 없다: {sorted(row)}")
            return str(row[key])

        return TEMPLATE_PARAM_RE.sub(repl, value)
    if isinstance(value, list):
        return [render_params(v, row) for v in value]
    if isinstance(value, dict):
        return {k: render_params(v, row) for k, v in value.items()}
    return value


_ALLOWED_EXPR_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Name, ast.Load,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.Constant,
)


def eval_formula(expr: str, row: dict) -> float:
    """파라미터에 대한 산술식을 평가한다 — 정답 도출의 급소.

    `eval`에 통째로 맡기지 않는다. 저작 데이터는 사람이 손으로 쓰는 JSON이고,
    거기에 임의 파이썬이 들어갈 수 있는 통로를 만들 이유가 없다. 허용은
    **이름 참조 + 사칙연산 + 숫자**뿐이고 함수 호출·속성 접근·인덱싱은 전부 거부한다.
    """
    tree = ast.parse(expr, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_EXPR_NODES):
            raise ValueError(f"수식에 허용되지 않은 문법: {type(node).__name__} ({expr})")
        if isinstance(node, ast.Name) and node.id not in row:
            raise KeyError(f"수식의 '{node.id}'가 행에 없다: {sorted(row)}")
    return eval(compile(tree, "<formula>", "eval"), {"__builtins__": {}}, dict(row))


def build_options(rows: Sequence[dict], index: int, field: str) -> list[str]:
    """오답을 **같은 표의 다른 행**에서 가져온다 (distractor kind = siblings).

    이것이 이 설계의 이득이다: 파라미터 표가 "키 하나 → 정답 하나"의 함수이면
    정답과 오답이 **같은 표에서 동시에** 나온다 — 오답을 따로 저작하지 않는다.

    그 전제를 여기서 강제한다. `field` 값이 행 사이에 중복이면 오답 하나가 실제로는
    정답이 되므로 **예외를 낸다**(1차 게이트의 options_unique·answer_in_options는
    "보기가 서로 다른가"만 보지 정답성을 못 본다).

    정답 위치는 `index % len(rows)`로 결정적으로 돌린다 — 항상 첫 칸이면 학습자가
    내용을 안 보고 찍는다. 셔플(무작위)이 아니라 회전(결정적)인 것이 요점이다.
    """
    values = [str(r[field]) for r in rows]
    dupes = sorted({v for v in values if values.count(v) > 1})
    if dupes:
        raise ValueError(
            f"'{field}' 값이 행 사이에 중복이다 — siblings 오답이 정답이 된다: {dupes}"
        )
    others = [values[(index + k) % len(values)] for k in range(1, len(values))]
    answer = values[index]
    slot = index % len(values)
    return others[:slot] + [answer] + others[slot:]


def _board_payload(rule: dict, row: dict, zones: list[str]) -> dict:
    """board_rules.json의 규칙 1건 → 퍼즐 payload (정답은 만들지 않는다).

    **정답이 공짜인 이유**: 서버가 같은 `board_rules.json`으로 판정을 재계산하므로
    (`board.py` — 클라이언트가 결과를 주입할 통로가 없다), 템플릿은 목표 현상만
    적으면 된다. `correct_answer`는 빈 문자열이고 채점은 배치 결과가 규칙을
    만족하는가로 이뤄진다. 저작이 만들어야 하는 것은 **문제**뿐이다.

    ⚠️ **`explain`은 힌트로 쓰지 않는다.** 규칙의 해설문에는 6단계 어휘가 들어 있다
    (예: `warm_front_steady_rain`의 "난층운" — `introduced_at` 6). 그대로 힌트에
    실으면 4단계 퍼즐이 어휘 게이트에 걸린다. `explain`은 **푼 뒤에** 서버가 보여주는
    문자열이라 문항 텍스트가 아니고, 힌트로 복사하는 순간 문항 텍스트가 된다.
    (`hint_needs`는 전선 계열·습기처럼 단계 안 어휘만 쓴다 — 실측 확인)
    """
    palette: list[str] = []
    for cond in rule["when"]:
        if ":" in cond:
            palette.append(cond)  # "front:cold" · "air_mass:siberian"
        else:
            # "moisture>=60" · "sun<=30" → 조절값 이름만 남긴다
            palette.append(re.split(r"[<>=]", cond, maxsplit=1)[0])
    return {
        "mode": "goal_only",
        "initial_state": {"zones": zones, "elements": []},
        "palette": palette,
        "goal_conditions": [
            {"zone": int(row["zone"]), "phenomenon": rule["then"]["phenomenon"]}
        ],
        "hints": [rule["hint_needs"]],
        "correct_answer": "",
    }


def expand_template(
    template: dict, level_group_of: Callable[[int], str]
) -> list[dict]:
    """템플릿 1건 → 인스턴스 목록 (시드와 같은 중첩 형태).

    파라미터 표의 행 순서가 곧 인스턴스 순서다 — 무작위가 없으므로 같은 입력에서
    항상 같은 파일이 나온다(재현 가능한 저작 산출물).
    """
    rows: list[dict] = template["params"]
    answer_spec: dict = template["answer"]
    kind = answer_spec["kind"]
    knowledge_level = int(template["knowledge_level"])
    question_type = template["question_type"]

    board_rules: dict[str, dict] = {}
    zones: list[str] = []
    if kind == "board_rule":
        board_rules = {
            r["id"]: r for r in json.loads(BOARD_RULES_PATH.read_text(encoding="utf-8"))
        }
        zones = load_board_zones()

    items: list[dict] = []
    for index, row in enumerate(rows):
        template_json: dict[str, Any] = {
            "question_text": render_params(template["text"], row)
        }
        derivation: str

        if kind == "field":
            answer = str(row[answer_spec["field"]])
            template_json["correct_answer"] = answer
            derivation = f"answer.kind=field → params[{index}].{answer_spec['field']}"
            if question_type == "multiple_choice":
                template_json["options"] = build_options(
                    rows, index, answer_spec["field"]
                )
                derivation += (
                    f" · 오답=siblings({answer_spec['field']}), 정답 위치 "
                    f"{index % len(rows)}"
                )
        elif kind == "formula":
            value = eval_formula(answer_spec["expr"], row)
            value = int(value) if float(value).is_integer() else value
            template_json["correct_answer"] = str(value)
            slider = {k: render_params(v, row) for k, v in answer_spec["slider"].items()}
            span = float(slider["max"]) - float(slider["min"])
            if span < SLIDER_MIN_SPAN:
                raise ValueError(
                    f"slider 범위 {span:g}가 하한 {SLIDER_MIN_SPAN} 미만 — "
                    "관용오차 ±10이 사실상 공짜 정답이 된다"
                )
            template_json.update(slider)
            derivation = f"answer.kind=formula → {answer_spec['expr']} = {value}"
        elif kind == "board_rule":
            rule = board_rules[row[answer_spec["rule_field"]]]
            template_json.update(_board_payload(rule, row, zones))
            derivation = (
                f"answer.kind=board_rule → board_rules.json[{rule['id']}] "
                "(서버가 같은 파일로 판정을 재계산 — 템플릿은 정답을 갖지 않는다)"
            )
        else:
            raise ValueError(f"알 수 없는 answer.kind: {kind!r}")

        for key, value in (template.get("extra_template") or {}).items():
            template_json[key] = render_params(value, row)

        items.append(
            {
                "concept_tag": template["concept_tag"],
                "level_group": level_group_of(knowledge_level),
                "knowledge_level": knowledge_level,
                "question_type": question_type,
                "template_json": template_json,
                "uses_live_slots": LIVE_SLOT_MARKER
                in str(template_json["question_text"]),
                "source": {
                    "kind": "template",
                    "refs": [
                        f"template: {template['id']} (r13_item_templates.json)",
                        f"params[{index}]: "
                        + json.dumps(row, ensure_ascii=False, sort_keys=True),
                        f"정답 도출: {derivation}",
                        f"knowledge_level={knowledge_level} · 근거: {template['level_basis']}",
                    ],
                },
                "status": "active",
            }
        )
    return items


def expand_template_file(
    path: Path, level_group_of: Callable[[int], str]
) -> list[dict]:
    """템플릿 정의 파일 전체를 인스턴스 목록으로 확장한다."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("version") != 1:
        raise ValueError(f"템플릿 정의 version이 1이 아니다: {doc.get('version')!r}")
    return [
        item
        for template in doc["templates"]
        for item in expand_template(template, level_group_of)
    ]


def build_plan(
    count: int, concepts: Sequence[str], level_groups: Sequence[str]
) -> list[tuple[str, str]]:
    """(concept_tag, level_group) N쌍을 결정적으로 순환 배정한다."""
    if count < 0:
        raise ValueError("count는 0 이상이어야 한다")
    if not concepts or not level_groups:
        raise ValueError("concepts·level_groups가 비어 있다")
    return [
        (concepts[i % len(concepts)], level_groups[i % len(level_groups)])
        for i in range(count)
    ]


# ── 배치 실행 ────────────────────────────────────────────────────────────────
@dataclass
class Rejection:
    stage: str
    concept_tag: str
    question_text: str
    reasons: list[str]


@dataclass
class BatchResult:
    attempted: int = 0
    items: list[dict] = field(default_factory=list)
    rejections: list[Rejection] = field(default_factory=list)
    llm_skipped: int = 0
    generate_errors: list[str] = field(default_factory=list)
    existing_count: int = 0
    model_label: str = ""
    llm_enabled: bool = False

    @property
    def stage_counts(self) -> Counter:
        return Counter(r.stage for r in self.rejections)

    @property
    def added(self) -> int:
        return len(self.items)


def _failed_names(checks: Sequence[dict], prefix: str | None = None) -> list[str]:
    return [
        f"{c.get('name')}: {c.get('reason')}"
        for c in checks
        if not c.get("passed")
        and (prefix is None or str(c.get("name", "")).startswith(prefix))
    ]


def run_batch(
    *,
    plan: Sequence[tuple[str, str]],
    weather: dict,
    existing: Sequence[dict],
    backend: BackendContract,
    ai: AiWorkerApi,
    now: datetime | None = None,
    knowledge_level: int | None = None,
) -> BatchResult:
    """계약 P-2의 1~5단계를 돌리고 추가 후보와 탈락 내역을 반환한다 (쓰기 없음)."""
    if ai.generate is None:
        raise RuntimeError("생성기가 로드되지 않았다 (load_ai_worker(with_generator=True))")

    stamp = (now or datetime.now(KST)).isoformat(timespec="seconds")
    result = BatchResult(
        existing_count=len(existing),
        model_label=ai.model_label,
        llm_enabled=ai.llm_enabled,
    )

    seen_text = {dedupe_keys(item)[0] for item in existing}
    seen_answer = {dedupe_keys(item)[1] for item in existing}
    batch_text: set[str] = set()
    batch_answer: set[str] = set()

    for concept_tag, level_group in plan:
        result.attempted += 1
        # ── 1단계: 생성 (키 없으면 폴백 뱅크 — 무키에서도 완주한다)
        try:
            # 목표 단계는 **주어졌을 때만** 넘긴다 — generate_quiz의 기본값(None)이
            # "모델이 스스로 판정해 신고한다" 분기다(스펙 03 §2 규칙 3).
            generate_kwargs: dict[str, Any] = {}
            if knowledge_level is not None:
                generate_kwargs["knowledge_level"] = knowledge_level
            flat = ai.generate(
                weather_data=weather,
                level_group=level_group,
                route="general",
                target_concept_tag=concept_tag,
                **generate_kwargs,
            )
        except Exception as exc:  # 생성 실패는 탈락이 아니라 시도 실패로 따로 센다
            result.generate_errors.append(f"{concept_tag}/{level_group}: {exc}")
            continue

        actual_tag = str(flat.get("concept_tag") or concept_tag)
        text = str(flat.get("question_text") or "")

        def reject(stage: str, reasons: list[str]) -> None:
            result.rejections.append(Rejection(stage, actual_tag, text, reasons))

        # ── 2단계: 1차 게이트 (결정적)
        failed = _failed_names(ai.gate1(flat, actual_tag))
        if failed:
            reject("gate1", failed)
            continue

        # ── 3단계: 2차 게이트 (LLM. 키 없으면 llm_skipped)
        verdict = ai.gate2(flat, actual_tag, level_group)
        checks = verdict.get("checks", [])
        skipped = next((c for c in checks if c.get("name") == "llm_skipped"), None)
        if skipped is not None:
            result.llm_skipped += 1
            gate2_note = f"llm_skipped — {skipped.get('reason')}"
        else:
            llm_failed = _failed_names(checks, prefix="llm_")
            if llm_failed:
                reject("gate2", llm_failed)
                continue
            gate2_note = "llm 3항목 통과"

        # ── 4단계: payload 계약 검사 (게이트 통과 ≠ 서버 노출 가능)
        item = to_bank_item(
            flat,
            level_group,
            refs=[
                f"generated: quiz_gen_chain.generate_quiz (model={ai.model_label})",
                f"quiz_id: {flat.get('quiz_id')}",
                f"generated_at: {stamp}",
                "gate1: run_heuristic_checks 전건 통과",
                f"knowledge_level: {flat.get('knowledge_level')} 신고"
                + (f" (목표 {knowledge_level} 지정)" if knowledge_level is not None else " (모델 자기 판정)")
                + " · gate1 knowledge_level_vocabulary 통과 (docs/specs/12 §7.4)",
                f"gate2: {gate2_note}",
                "payload: QUESTION_PAYLOAD_FIELDS∪GENERATED_PAYLOAD_FIELDS 검사 통과",
            ],
        )
        errors = payload_contract_errors(
            item,
            payload_fields=backend.payload_fields,
            generated_fields=ai.generated_fields,
            validate_entry=backend.validate_entry,
            check_payload=ai.check_payload,
            index=result.attempted - 1,
        )
        if errors:
            reject("payload", errors)
            continue

        # ── 5단계: 중복 배제 (기존 시드 + 이번 배치 내 양쪽)
        text_key, answer_key = dedupe_keys(item)
        if text_key in seen_text:
            reject("dup_seed", ["기존 시드에 동일 question_text"])
            continue
        if answer_key in seen_answer:
            reject("dup_seed", ["기존 시드에 동일 (유형·개념·정답)"])
            continue
        if text_key in batch_text:
            reject("dup_batch", ["이번 배치에 동일 question_text"])
            continue
        if answer_key in batch_answer:
            reject("dup_batch", ["이번 배치에 동일 (유형·개념·정답)"])
            continue

        batch_text.add(text_key)
        batch_answer.add(answer_key)
        result.items.append(item)

    return result


# ── 시드 입출력 ──────────────────────────────────────────────────────────────
def load_seed(path: Path) -> list[dict]:
    """시드 파일을 읽는다. 없으면 빈 목록(첫 배치)."""
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"시드 최상위는 배열이어야 한다: {path}")
    return raw


def append_items(path: Path, items: Sequence[dict]) -> int:
    """시드에 append한다 (append-only — 기존 항목을 수정·삭제하지 않는다).

    직렬화 결과를 다시 파싱해 앞부분이 기존 항목과 **완전히 같은지** 확인한 뒤에만
    쓴다. 저작 배치는 되돌리기 어려운 작업이므로 검증을 쓰기 뒤로 미루지 않는다.
    """
    existing = load_seed(path)
    serialized = json.dumps(existing + list(items), ensure_ascii=False, indent=2) + "\n"
    if json.loads(serialized)[: len(existing)] != existing:
        raise RuntimeError("append-only 위반 — 기존 항목이 변형됐다. 쓰지 않았다.")
    path.write_text(serialized, encoding="utf-8")
    return len(items)


# ── 리포트 (P-2 7단계) ───────────────────────────────────────────────────────
def _pad(text: str, width: int) -> str:
    """한글(전각) 폭을 2로 세어 오른쪽 공백을 채운다 — 표 정렬용."""
    display = sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)
    return text + " " * max(0, width - display)


def format_report(result: BatchResult, *, seed_path: Path, write: bool) -> str:
    counts = result.stage_counts
    lines = [
        "── author_items 리포트 ────────────────────────────────────────",
        f"모드        : {'write (시드 append)' if write else 'dry-run (시드 미변경)'}",
        f"시드        : {seed_path} (기존 {result.existing_count}건)",
        f"모델        : {result.model_label}",
        f"2단 LLM     : {'사용' if result.llm_enabled else '미사용 — 키 미설정'}",
    ]
    lines += [
        "",
        f"생성 시도   : {result.attempted}",
    ]
    if result.generate_errors:
        lines.append(f"  생성 실패     : {len(result.generate_errors)}")
        lines += [f"    - {e}" for e in result.generate_errors]
    for stage, label in STAGES:
        lines.append(f"  {_pad(label, 26)}: {counts.get(stage, 0)}")
    lines.append(f"  {_pad('2차 게이트 건너뜀', 26)}: {result.llm_skipped}")
    lines.append(f"  {_pad('최종 추가', 26)}: {result.added}")

    lines += ["", "탈락 상세:"]
    if not result.rejections:
        lines.append("  (없음)")
    for stage, label in STAGES:
        rejected = [r for r in result.rejections if r.stage == stage]
        if not rejected:
            continue
        lines.append(f"  [{label}] {len(rejected)}건")
        for r in rejected:
            head = r.question_text[:48] + ("…" if len(r.question_text) > 48 else "")
            lines.append(f"    - ({r.concept_tag}) {head}")
            lines += [f"        · {reason}" for reason in r.reasons]

    lines += ["", "추가 항목:"]
    if not result.items:
        lines.append("  (없음)")
    for item in result.items:
        head = str(item["template_json"].get("question_text", ""))[:48]
        lines.append(
            f"  + {item['concept_tag']}/{item['level_group']}/"
            f"{item['question_type']} — {head}…"
        )
    lines.append("─────────────────────────────────────────────────────────────")
    return "\n".join(lines)


# ── CLI ──────────────────────────────────────────────────────────────────────
def build_parser(concepts: Sequence[str], level_groups: Sequence[str]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="author_items.py",
        description="생성 문항을 시드 형태로 뱅크에 누적시키는 오프라인 저작 배치 (계약 P)",
    )
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="생성 시도 횟수")
    parser.add_argument(
        "--concept",
        action="append",
        dest="concepts",
        choices=list(concepts),
        help="대상 concept_tag (반복 지정 가능, 기본 6종 전부)",
    )
    parser.add_argument(
        "--level-group",
        action="append",
        dest="level_groups",
        choices=list(level_groups),
        help="대상 level_group (반복 지정 가능, 기본 3종 전부)",
    )
    parser.add_argument(
        "--knowledge-level",
        type=int,
        help="목표 지식 수준(1~N, docs/specs/12 §2). 생략하면 모델이 스스로 판정해 "
        "신고한다. G1 저작 우선순위(§8.2: 6단계 → 1단계 → 3단계)를 태울 때 쓴다",
    )
    parser.add_argument(
        "--expand-templates",
        type=Path,
        metavar="TEMPLATES_JSON",
        help="LLM을 호출하지 않고 템플릿 정의 파일을 인스턴스로 확장한다 "
        "(R13 3일차 실증 — --out으로 산출 경로 지정)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="--expand-templates 산출 경로 (생략 시 표준출력)",
    )
    parser.add_argument("--seed-path", type=Path, default=DEFAULT_SEED_PATH)
    parser.add_argument("--weather-json", type=Path, help="프롬프트에 넣을 기상 JSON 경로")
    parser.add_argument("--random-seed", type=int, help="폴백 뱅크 추첨을 고정한다")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="(기본) 시드에 쓰지 않고 리포트만 낸다",
    )
    mode.add_argument(
        "--write",
        action="store_true",
        help="검증 통과분을 시드에 append한다 (되돌리기 어려운 작업)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    # 체인의 경고(무키 폴백 등)가 어디서 나온 것인지 보이게 한다 — 조용히 삼키지 않는다.
    logging.basicConfig(level=logging.WARNING, format="[%(name)s] %(message)s")
    try:
        backend = load_backend_contract()
        ai = load_ai_worker()
    except Exception as exc:
        print(f"[author_items] 파이프라인 로드 실패: {exc}", file=sys.stderr)
        return 2

    args = build_parser(backend.concept_tags, backend.level_groups).parse_args(argv)
    if args.random_seed is not None:
        random.seed(args.random_seed)

    # 템플릿 확장은 **생성 경로와 완전히 분리**된 모드다 — LLM을 부르지 않고
    # 시드에도 쓰지 않는다(산출물은 staging 파일로 나가고 lint가 그것을 검사한다).
    if args.expand_templates:
        try:
            items = expand_template_file(
                args.expand_templates, load_level_group_deriver()
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
            print(f"[author_items] 템플릿 확장 실패: {exc}", file=sys.stderr)
            return 1
        payload = json.dumps(items, ensure_ascii=False, indent=2) + "\n"
        if args.out:
            args.out.write_text(payload, encoding="utf-8")
            print(f"[author_items] 템플릿 {args.expand_templates} → {args.out} "
                  f"{len(items)}건 (LLM 미호출)")
        else:
            print(payload)
        return 0

    weather = DEFAULT_WEATHER
    try:
        if args.weather_json:
            weather = json.loads(args.weather_json.read_text(encoding="utf-8"))
        existing = load_seed(args.seed_path)
        plan = build_plan(
            args.count,
            args.concepts or backend.concept_tags,
            args.level_groups or backend.level_groups,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[author_items] 입력 오류: {exc}", file=sys.stderr)
        return 1

    result = run_batch(
        plan=plan,
        weather=weather,
        existing=existing,
        backend=backend,
        ai=ai,
        knowledge_level=args.knowledge_level,
    )
    print(format_report(result, seed_path=args.seed_path, write=args.write))

    if not args.write:
        print("[author_items] dry-run — 시드를 건드리지 않았다. 반영은 --write.")
        return 0
    if not result.items:
        print("[author_items] 추가할 항목이 없어 시드를 건드리지 않았다.")
        return 0
    try:
        added = append_items(args.seed_path, result.items)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"[author_items] 쓰기 실패: {exc}", file=sys.stderr)
        return 1
    print(f"[author_items] {args.seed_path}에 {added}건 append 완료 (기존 항목 무변경).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
