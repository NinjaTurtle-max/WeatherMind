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
#   python scripts/lint_seed_items.py --staging                        # staging 전건(제외 목록 밖)
#   python scripts/lint_seed_items.py database/seed/staging/au1_weather_items.json
#   python scripts/lint_seed_items.py <파일> --base database/seed/content_items.json
#
# 검사 6종 (문항마다 전부 실행 — 첫 탈락에서 멈추지 않는다):
#   ① gate1    validate_chain.run_heuristic_checks — LLM 무관·결정적 1차 게이트.
#              서버 전개형(expand_like_server)에 적용한다.
#   ② payload  ⓐ 프론트 렌더 필수 필드(REQUIRED_FIELDS — 아래 소유자 주석)가
#                실제로 채워졌는가(R10-07 반례 재발 방지). QUESTION_PAYLOAD_FIELDS
#                전체를 필수로 쓰지 않는다 — 그것은 "노출 가능" 화이트리스트라
#                board의 선택 필드(guide_steps·time_limit_sec·based_on)를 포함하고,
#                필수 판정에 그대로 쓰면 선택 필드 미저작이 오탈락한다(2026-08-05
#                본시드 실측에서 board 12건 과탐 — 이 하네스 최초 실행의 발견).
#                ⓑ check_payload(ai-worker 계약 G) — 서버 전개형에. **생성 대상
#                유형에만** 적용하고 그 밖은 건너뛴다(계약 G 밖 = 저작 영역).
#                ⚠️ **대상 유형을 여기 나열하지 않는다** — 소유자는 ai-worker의
#                `GENERATED_PAYLOAD_FIELDS` 하나다. 종전 이 자리에 "3종 — board·
#                match·ordering·cloze는 밖"이라고 적혀 있었으나 2026-08-10
#                (커밋 01a81aa, CO-O-13)에 대상이 넓어져 거짓이 됐다. 목록을
#                복사하면 다음 확장에서 또 어긋난다.
#   ③ schema   seed_content.validate_entry — 시드 적재 스키마(중첩 형태).
#   ④ dup      정규화 중복 배제 — 파일 내 + (--base가 대상과 다르면) 본시드 대조.
#              **--staging 모드에서 본시드 중복은 탈락이 아니라 「승격 현황」 정보로
#              집계한다** — staging은 승격 후에도 원본이 남는 디렉터리라 중복이
#              정상 상태다(2026-08-10 실측: board_puzzles 7/7이 이미 본시드에 있다).
#              탈락으로 세면 첫날부터 구조적 red가 되고, 그 압력이 게이트를 약화시킨다.
#              파일 내 중복은 --staging에서도 그대로 탈락이다.
#              정규화 키 set 비교라 O(n) — ~1,500 규모(G1 배치)도 감당한다.
#              (유형·개념·정답) 키는 정규화 정답이 **비어 있지 않을 때만** 본다 —
#              board·match·ordering은 correct_answer 없이 채점(goal_conditions·
#              pairs·items)하므로 빈 정답 키로 비교하면 같은 개념의 전 퍼즐이
#              서로 중복으로 오탈락한다(2026-08-05 본시드 실측 9건 과탐).
#   ⑦ revert   **승격 되돌림 감시** (--staging 전용, 2026-08-21) — 본시드와 멱등 키가
#              같은데 선지·정답이 다른 staging 항목을 탈락시킨다. seed_content가
#              template_json을 통째로 덮으므로 그 항목은 재승격 시 본시드 교정을
#              조용히 되돌리는 탄환이다. 상세 근거는 `promotion_option_drift` 머리.
#              ④와 달리 **원시 키**(정규화 없음)를 쓴다 — 재는 대상이 저작 중복이
#              아니라 SQL UPDATE의 실제 사정거리이기 때문이다.
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
#              knowledge_level이 없는(미분류) 문항은 **무조건 탈락**이다 — 단계가
#              곧 문항의 절반이라 없으면 판정 자체가 성립하지 않는다.
#              ⚠️ 종전 이 자리에 "미분류는 v1 학령 규칙(adult·expert 면제)으로
#              폴백한다"고 적혀 있었으나 **본문(vocabulary_errors)과 자기모순**이었다:
#              폴백은 본시드 전수 재분류가 착지한 R13 2일차에 걷혔다(2026-08-10 정정).
#              목록은 database/seed/level_vocabulary.json이 단독 소유한다 — 코드에
#              어휘를 박지 않는다(교육과정 근거가 데이터와 같은 곳에 있어야 개정된다).
#              발단: 본시드 [86] middle_high ordering의 정답 항목이 권운·권층운·
#              고층운·난층운이었다(중학 교육과정 밖 십운형 명칭).
#   ⛔ **⑥ⓐ(해설–정답 위치 모순)는 없다 — 2026-08-19에 절제했다.**
#              그 검사는 서수 주변의 낱말로 「이 자리는 틀렸다/맞다」를 **기계가
#              판정**하려 했고, 세 라운드 내내 **매번 다른 언어적 이음매에서 새
#              오탐**이 났다(창 → 문맥어 → 부정 범위 → 대조절 → 수량 토큰).
#              실현된 결과가 판정 근거다: **실제 적발 0건 · 실제 오탐 3라운드.**
#              같은 부류의 실사례 2건은 **둘 다 사람이** 잡았다(쌍둥이 유사도 +
#              읽기 · 인구 세기 + 읽기). 재현율은 어휘에서 왔고 실패는 판정에서 왔다.
#              ⇒ 경계를 이렇게 긋는다:
#              **스캔 층(서수+명사 참조 탐지)은 남고, 판정 층(극성 휴리스틱)이
#              나간다 — 판정 층은 사람이다.**
#              자리 참조 문항의 **열거는 ⑥ⓑ 래칫이 이미 한다**(명사 있는 서수) —
#              명사 없는 것까지 합쳐 십여 건이라 사람이 한 번에 읽는다(소유 = 표본
#              검수). 기계로 강제할 수 있는 더 강한 규칙은 **자리 참조 자체를
#              금지하고 극성은 판정하지 않는 것**이고, 그것이 곧 ⑥ⓑ다.
#              재개봉 조건은 **생성 규모 저작** — 그때는 축이 낱말표가 아니라 LLM
#              게이트다. 경위·이월 행은 docs/team/CARRYOVER_R13.md.
#
# 검사 로직은 전부 author_items.py에서 **import 재사용**한다(사본 금지 —
# expand_like_server·payload_contract_errors·dedupe_keys·_failed_names,
# 그리고 load_backend_contract/load_ai_worker의 실임포트 계약값).
#
# 리포트: 탈락 사유별 건수(0건 포함 전부 출력 — 조용한 절삭 금지) + 문항별 상세.
# 종료 코드: 0 전건 통과 / 1 탈락 존재 또는 입력 오류 / 2 파이프라인 로드 실패
#
# ci.sh 편입 완료 — `ci.sh seed` 단계가 **본시드 전건 + `--staging` 전건** 두 번
# 호출한다(CO-SN2, 2026-08-10). 종전 "편입은 PM 몫 — 단독 실행만 책임진다"는
# 낡은 기술이다. **단계를 새로 만들지 않았다**: ci.sh 단계 수 ↔ ci.yml 잡 수 패리티를
# backend/tests/test_ci_workflow_contract.py가 감시하므로 기존 seed 단계를 넓혔다.
# =============================================================================
"""시드/저작 staging 파일 전 문항에 게이트·계약·스키마·중복 검사를 돌리는 lint."""

from __future__ import annotations

import argparse
import importlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import author_items  # noqa: E402  (검사 로직 단일 소유자 — 사본 금지)
import shuffle_answer_positions as shuffle_tool  # noqa: E402  (서수 판정 단일 소유자)

DEFAULT_SEED_PATH = author_items.DEFAULT_SEED_PATH
VOCABULARY_PATH = author_items.REPO_ROOT / "database" / "seed" / "level_vocabulary.json"
STAGING_DIR = author_items.REPO_ROOT / "database" / "seed" / "staging"

# ── --staging 루프의 제외 목록 (CO-SN2) ──────────────────────────────────────
# 이 두 dict와 실제 디렉터리의 정합은 backend/tests/test_level_vocabulary.py §5가
# 감시한다: 분류되지 않은 새 파일이 생겨도, 지워진 파일이 목록에 남아도 붉어진다.
# 사유 문자열은 비어 있으면 안 된다 — ci.sh의 OPT_IN_STEPS 선례와 같은 규약
# (test_ci_workflow_contract.OPT_IN_STEPS: "의도적 예외는 사유와 함께 적는다").

# ⓐ 영구 제외 — **문항 파일이 아니다**(파일 성격이라 해제 조건이 없다).
STAGING_NOT_ITEMS: dict[str, str] = {
    "r13_item_templates.json": (
        "문항 배열이 아니라 템플릿 명세 dict(version·owner·schema…) — "
        "author_items.py:398이 이 파일을 정의 파일로 읽는다."
    ),
    "r13_detective_cases.json": (
        "content_items가 아니라 탐정 사건 문서(case_id·intro·series·clues)라 "
        "question_text·question_type이 애초에 없다. 본시드 승격 경로도 별개이고 "
        "그쪽은 backend/tests/test_detective_router.py:73이 지킨다."
    ),
}

# ⓑ **한시 제외** — 문항 파일은 맞는데 knowledge_level이 0건이라 ⑤에서 전건 탈락한다.
#    지금 게이트에 넣으면 CI가 즉시 붉어지고, 그렇다고 여기서 단계를 임의로 채우면
#    2축 정합(학령 밴드 × 지식 단계)이 깨진다 — 부여는 데이터 트랙(CO-C2·E-8) 소유다.
#    ⚠️ **해제 조건: 해당 파일에 knowledge_level이 하나라도 부여되는 순간 이 항목을
#    지우고 게이트에 넣는다.** 잊어도 되게 만들어 뒀다 — 위 §5 테스트가 "kl 0건"을
#    단정하므로, 부여가 시작되면 그 테스트가 먼저 붉어지며 이 줄을 가리킨다.
#    (2026-08-10 실측: 두 파일 모두 탈락 사유가 ⑤ 하나뿐 — 단계만 붙으면 바로 통과한다.)
STAGING_PENDING_LEVEL: dict[str, str] = {
    "au1_weather_items.json": "knowledge_level 0/47 — 부여 완료 시 해제(CO-C2·E-8).",
    "au2_basic_science_items.json": "knowledge_level 0/40 — 부여 완료 시 해제(CO-C2·E-8).",
}

STAGING_EXCLUDED: dict[str, str] = {**STAGING_NOT_ITEMS, **STAGING_PENDING_LEVEL}


def staging_targets(staging_dir: Path = STAGING_DIR) -> list[Path]:
    """--staging 루프가 검사할 파일 — 제외 목록 밖의 staging JSON 전부.

    **소유자는 이 함수 하나다.** ci.sh도 테스트도 여기서 목록을 받아 간다 —
    bash 글롭과 파이썬 상수로 목록이 두 벌 생기면 한쪽만 갱신되는 날이 온다.
    """
    return sorted(
        p for p in staging_dir.glob("*.json") if p.name not in STAGING_EXCLUDED
    )


def staging_item_files(staging_dir: Path = STAGING_DIR) -> list[Path]:
    """문항 배열인 staging 파일 전부 — lint 대상 + 한시 제외분.

    「승격 현황」 집계는 lint 통과 여부와 무관하므로 한시 제외분(au1·au2)도 센다.
    저작 배치를 짜는 쪽이 알아야 하는 것은 "아직 본시드에 없는 잔여가 몇 건인가"이고,
    그 숫자는 knowledge_level 부여 여부와 독립이다.
    """
    return sorted(
        p for p in staging_dir.glob("*.json") if p.name not in STAGING_NOT_ITEMS
    )


def promoted_indexes(items: list[dict], base_items: list[dict]) -> list[int]:
    """본시드에 이미 있는(=승격된) 문항의 인덱스.

    키는 lint_items ④와 같은 author_items.dedupe_keys를 쓴다 — 판정이 두 벌이
    되지 않게 키 생성기를 공유한다. 정답 키는 정규화 정답이 비어 있지 않을 때만
    참여한다(모듈 머리 ④ 주석: board·match·ordering은 빈 정답이라 오탐이 난다).
    """
    base_text: set[str] = set()
    base_answer: set[str] = set()
    for it in base_items:
        text_key, answer_key = author_items.dedupe_keys(it)
        base_text.add(text_key)
        if author_items.normalize_text(
            (it.get("template_json") or {}).get("correct_answer")
        ):
            base_answer.add(answer_key)

    hits = []
    for i, item in enumerate(items):
        text_key, answer_key = author_items.dedupe_keys(item)
        has_answer = bool(
            author_items.normalize_text(
                (item.get("template_json") or {}).get("correct_answer")
            )
        )
        if text_key in base_text or (has_answer and answer_key in base_answer):
            hits.append(i)
    return hits


# ── ⑦ 승격 되돌림 감시 (2026-08-21) ──────────────────────────────────────────
# **막는 것**: staging 재승격이 본시드의 채점면(선지·정답)을 조용히 옛 값으로
# 되돌리는 것.
#
# 왜 가능한가 — `backend/app/scripts/seed_content.py`는 인자로 받은 **아무 파일이나**
# 적재할 수 있고(`sys.argv[1]`), 멱등 키가 `(concept_tag, template_json->>
# 'question_text')`이며, 키가 맞으면 `existing.template_json = entry["template_json"]`로
# **template_json을 통째로 덮는다**(같은 파일 249~260줄). 그래서 지문을 그대로 두고
# 선지만 고친 교정은 **키가 안 바뀌어** staging 원본이 그대로 UPDATE 탄환이 된다.
# 실물 사례: 최장-선지 편향 교정(120문항·선지 360줄, 커밋 ba14f6b..afdab80)은
# `correct_answer` 전건 바이트 동일 · `question_text` 무접촉이라, 겹치는 staging
# 108건을 재승격하면 선지 324줄이 경고 한 줄 없이 옛 값으로 돌아간다.
#
# ⚠️ **키는 seed_content와 같은 원시 키여야 한다** — ④의 `author_items.dedupe_keys`
# (정규화 지문 + 정답 서명 폴백)를 쓰면 안 된다. 저 키는 저작 중복을 찾는 다른
# 술어이고, 여기서 재야 하는 것은 **SQL UPDATE가 실제로 무엇을 집는가**다. 감시가
# 지키려는 문장과 다른 키로 재면 감시는 다른 것을 재게 된다.
#
# ⚠️ **비교면을 template_json 전체로 넓히지 말 것** — 2026-08-21 실측으로 원시키
# 일치 895건 중 template_json 전체 상이가 67건이다(승격 뒤 본시드에서만 손본
# explanation_hint·refs 등 — 정상 상태). 넓히면 첫날부터 구조적 red가 되고 그
# 압력이 게이트를 약화시킨다(④가 같은 이유로 같은 선택을 했다). 채점면인
# options·correct_answer만 보면 같은 실측에서 **0건**이다.
DRIFT_FIELDS = ("options", "correct_answer")


def promotion_key(item: dict) -> tuple[str, str]:
    """seed_content 멱등 키와 **같은** 원시 키 — (concept_tag, question_text).

    정규화하지 않는다. UPDATE 대상 판정이 `.astext ==` 정확 일치이므로, 정규화하면
    감시가 실제 UPDATE보다 넓게 잡아 오탐이 난다.
    """
    template = item.get("template_json") or {}
    return (str(item.get("concept_tag") or ""), str(template.get("question_text") or ""))


def promotion_option_drift(
    items: list[dict], base_items: list[dict]
) -> list[tuple[int, str, str, str]]:
    """재승격이 본시드 채점면을 덮어쓸 자리. 반환: (인덱스, 개념, 지문, 필드).

    순수 함수. staging 항목이 본시드와 **같은 멱등 키**를 가지면서 선지나 정답이
    다르면 한 줄씩 낸다. 키가 없는(=미승격) 항목은 UPDATE가 아니라 INSERT라
    되돌릴 것이 없으므로 보지 않는다.
    """
    base_by_key: dict[tuple[str, str], dict] = {}
    for item in base_items:
        base_by_key.setdefault(promotion_key(item), item)

    drifted: list[tuple[int, str, str, str]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        key = promotion_key(item)
        base = base_by_key.get(key)
        if base is None:
            continue
        template = item.get("template_json") or {}
        base_template = base.get("template_json") or {}
        for field in DRIFT_FIELDS:
            if template.get(field) != base_template.get(field):
                drifted.append((index, key[0], key[1], field))
    return drifted


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
        # 전환기 폴백(v1 학령 규칙 재현)은 **만료됐다** — 본시드 141건 전수 재분류가
        # 착지해 미분류 문항이 0이 된 시점(R13 2일차)에 함께 걷었다. 이제 단계 없는
        # 문항은 판정할 수 없는 것이 아니라 **저작이 덜 된 것**이다: 어느 단계에
        # 놓을지가 곧 문항의 절반이고, 그것 없이 적재하면 6단계 체계 밖에서 서빙된다.
        return [
            "knowledge_level 미부여 — 단계를 판정할 수 없다"
            " (docs/specs/12 §4의 R0~R7로 부여할 것)"
        ]
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


# ── ⑥ⓐ 해설–정답 위치 모순 — **절제됨 (2026-08-19)** ────────────────────────
# 이 자리에 `claim_polarity`·`GATE_WRONG_CONTEXT`·`GATE_RIGHT_CONTEXT`·
# `_NEGATORS`·`hint_position_errors`가 있었다. **되살리지 말 것** — 세 라운드가
# 전부 이 판정을 고쳤고 매번 다른 언어적 이음매에서 새 오탐이 났다. 3차 리뷰의
# 결정적 증거는 **같은 문형이 한 방향에서 오탐, 반대 방향에서 미탐**이었다:
#   · 「네 번째 선지가 정답처럼 보이기 쉽다」  → 오탐(맞는 해설을 규탄)
#   · 「세 번째 선지는 오답이고 나머지가 정답이다」 → **미탐인데 이것이 잡으려던 결함**
# 그리고 「`반대`·`어긋`은 wrong 방향이라 오탐을 만들 수 없다」던 단정도 거짓이었다:
#   · 「두 번째 선지처럼 북반구와 남반구는 회전 방향이 반대다」(정답 2번) → 오탐
#     — **`반대`는 판정어가 아니라 기상 일반 어휘**다.
# 실현된 결과: **실제 적발 0건 · 실제 오탐 3라운드.** 실사례 2건은 둘 다 사람이 잡았다.
# ⇒ **스캔 층(서수+명사 참조 탐지)은 남고, 판정 층(극성 휴리스틱)이 나간다 —
#    판정 층은 사람이다.** 표적 결함은 사라지지 않았고 **⑥ⓑ가 자리 참조 자체를**
#    막는다(극성을 묻지 않는 더 강한 규칙). 열거는 ⑥ⓑ 래칫 + 명사 없는 서수 목록이
#    하고, 읽는 것은 표본 검수(사람)다. 재개봉 조건은 생성 규모 저작이며 그때의 축은
#    낱말표가 아니라 LLM 게이트다. 이월 행: docs/team/CARRYOVER_R13.md.

# ── ⑥ⓑ 해설의 선지 위치 참조 (MT-15 재발 방지) ──────────────────────────────
def hint_ordinal_errors(item: dict) -> list[tuple[str, str]]:
    """객관식 해설이 선지를 **자리로** 가리키는가 (정오가 맞아도 탈락).

    ⓐ와 사유가 다르다: 이쪽은 **지금 틀린 것이 아니라 셔플하면 틀려지는 것**이다.
    그래서 처방도 다르다 — ⓐ는 정오를 고치고, ⓑ는 자리 대신 **내용**으로 가리킨다.

    왜 정오가 맞아도 거는가:
      · `shuffle_answer_positions`가 이런 문항을 **셔플 대상에서 뺀다**(--remap-hints
        없이는 건너뛰고, 명사 없는 서수는 옵션과 무관하게 건너뛴다). 곧 MT-15가
        고치려던 정답 위치 쏠림에서 **이 문항들만 영구히 남는다**.
      · 손으로 선지 순서를 만지는 순간 ⓐ가 된다. 그 도구의 전신이 실제로 9건을
        깨뜨렸고 3건이 정답을 오독이라 말했다.
      · 저작이 이 결함을 고치는 게 아니라 **증폭시킨다** — MT-15 실측 84 → 311건.

    판정은 `hint_uses_ordinals`(명사 가드 있음)만 쓴다. 명사 없는 서수
    (`hint_has_bare_ordinal`)까지 걸면 「두 번째 **몫**」 같은 정상 서술이 걸린다.

    ⚠️ **여기 적혀 있던 「본시드 실측 4건」은 시드가 272건이던 때의 값이었다**
    (2026-08-18 정정). 재실측: **시드 1,018건 · mc 310건 기준 3건**(문항 수이고 서수
    출현 수가 아니다). 3건 중 **1건**(「두 번째 몫」)이 선지와 무관한 정상 서술이고
    **2건**은 실제 선지 참조라 **의도된 미탐**이다(그 맞바꿈은
    `test_명사_없는_자리_참조는_파이프라인이_그냥_지나친다`가 소유한다).
    ⚠️ 인용할 때는 **잰 날과 시드 건수를 함께** 적을 것 — 그러지 않아서 낡았다.
    """
    if item.get("question_type") != "multiple_choice":
        return []
    hint = str((item.get("template_json") or {}).get("explanation_hint") or "")
    if not shuffle_tool.hint_uses_ordinals(hint):
        return []
    match = shuffle_tool.ORDINAL_WITH_NOUN_RE.search(hint)
    return [
        (
            "ordinal_ref",
            f"해설이 선지를 자리로 가리킨다(「{match.group(0)}」) — 순서를 섞으면"
            " 다른 선지를 가리키게 되고, 그때까지 셔플 대상에서 빠진다."
            " 선지 **내용**으로 가리켜 저작할 것",
        )
    ]


# ── ⑥ⓒ 채점 정합 (MT-14 「오독이 정답 처리 · 맞는 답이 오답 처리」) ──────────
@dataclass(frozen=True)
class GradingContract:
    """채점기 상수 — backend `answer_service`에서 실임포트한 값 (사본 금지).

    ⚠️ `author_items.SLIDER_MIN_SPAN`(=40)은 **저작·생성 시점의 권고**를 손으로
    적어 둔 수치이지 채점기가 쓰는 값이 아니다. 여기서 그것을 재사용하면 관용오차가
    바뀌는 날 두 숫자가 갈린다 — 판정은 **실제로 채점하는 상수**로 한다.
    """

    slider_tolerance: float


def load_grading_contract() -> GradingContract:
    """`answer_service.SLIDER_TOLERANCE`를 backend에서 실임포트한다.

    load_render_required와 같은 관례(사본 금지). 실패하면 예외를 올린다 —
    검사가 조용히 꺼지면 규칙이 없는 것과 같다(load_vocabulary 주석과 같은 판단).
    """
    mods = author_items._import_isolated(
        author_items.BACKEND_DIR, ("app.services.answer_service",)
    )
    return GradingContract(
        slider_tolerance=float(mods["app.services.answer_service"].SLIDER_TOLERANCE)
    )


# 정답이 「숫자+단위」로 붙어 있는 형태 — 소수점·자릿수 쉼표는 단위로 읽지 않는다.
# ⚠️ **자릿수 콤마를 반드시 뚫어야 한다**(2026-08-14 코드 리뷰 실행 재현).
# 초판은 `^-?\d+(?:\.\d+)?\s*(...)$`라 **`'1,000mm'`가 None**이 됐다 — 이 검사가
# 잡으라는 바로 그 결함(숫자+단위 결합 정답)이 **네 자리부터 통째로 빠져나갔다.**
# 기상 수치는 네 자리가 흔하다(강수량·고도·기압). 콤마 그룹을 명시로 받는다.
# ⚠️ 캡처는 **하나뿐**이어야 한다 — 소비처가 `match.group(1)`으로 단위를 빼서
# 「맨 숫자」를 만들어 메시지에 넣는다. 콤마형을 별도 대안으로 병기하면 한쪽이
# None이 되어 그 자리에서 죽는다. 그래서 숫자부만 갈라 하나의 그룹을 유지한다.
# ⚠️ **세 형태를 더 뚫는다**(2026-08-18 리뷰 5번 실행 재현):
#   · `30m3`·`5km2` — **단위 안에 숫자**가 있어 종전 `[^\d\s.,]+`가 못 받았다
#     (면적·부피 단위는 기상 문항에 흔하다)
#   · `1 000mm` — **공백 자릿수 구분**(유럽식·조판 관례)
# 숫자부와 단위부를 각각 넓히되 **캡처는 하나로 유지**한다 — 소비처가
# `match.group(1)`으로 단위를 떼서 「맨 숫자」를 만든다.
_ANSWER_WITH_UNIT_RE = re.compile(
    r"^-?(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d+)?\s*"
    r"([^\d\s.,][^\s.,]*)$"
)

# ⚠️ **정규식만으로는 「수치+단위」와 「숫자로 시작하는 낱말」을 못 가른다**
# (2026-08-18 리뷰 결함 5 실행 재현): 「2차전지」·「1등성」·「3중수소」·「4계절」이
# 전부 탈락하면서 **틀린 조치를 지시했다** — 「정답을 맨 숫자로」는 정답을 「2」로
# 만들라는 뜻이다. 지문을 파싱해 단위를 찾는 대안보다 **화이트리스트**가 낫다.
#
# 목록은 **추측이 아니라 실측**이다(2026-08-18 · 시드 1,018건):
#   · slider `template_json.unit` 필드 전건(67건 25종) — 이 저장소가 「단위」라고
#     부르는 것의 소유자다. 지문의 「(단위: X)」 26건은 그 부분집합이라 겹친다.
#   · `년` — typed 정답에서 관측됐던 유일한 단위 결합(「30년」). ⚠️ 그 문항은
#     수리돼 지금 시드에는 **0건**이고 `answer_unit_suffix` 래칫 항이 낡았다.
#     어휘는 남긴다 — 2026-08-14 계약 픽스처가 이 형태를 못박고 있다.
#   · `m2`·`m3`·`km2` — 관측된 상첨자 족(`W/m²`·`㎍/㎥`·`만 m³`)의 ASCII 표기이고,
#     2026-08-18 리뷰 5번이 계약 픽스처로 못박은 형태다(`30m3`·`5km2`).
# **관측 안 된 단위는 넣지 않는다.** 그 대가로 받아들이는 미탐: 목록 밖 단위가
# 붙은 정답(예: 맨 `m`) · 공백이 든 단위(`만 m³` — 정규식이 애초에 공백을 못 받는다).
MEASURED_UNITS: frozenset[str] = frozenset({
    "℃", "℃/km", "K", "%", "m/s", "kt", "노트", "hPa", "mm", "cm", "㎍/㎥",
    "W/m²", "cal", "kcal", "kg", "mL", "ppm", "도", "월", "시간", "년",
    "가지", "등분", "개", "배", "m2", "m3", "km2",
})

# 문자열 일치로 채점하는 유형 (`answer_service.GRADERS`의 `_grade_text` 대상 중
# **학습자가 직접 입력하는** 둘). multiple_choice도 같은 채점기를 쓰지만 학습자는
# 선지를 고를 뿐이라 표기 문제가 생기지 않는다.
_TYPED_ANSWER_TYPES: tuple[str, ...] = ("short_answer", "cloze")


def grading_errors(item: dict, *, grading: GradingContract) -> list[tuple[str, str]]:
    """채점기에 걸어 보면 **문항이 성립하지 않는** 것 (MT-14의 채점 결함 2종).

    ⑴ **오독이 정답 처리** — slider의 눈금 전 구간이 채점 관용오차 안에 들어가면
       학습자가 무엇을 짚어도 정답이다. `_grade_slider`의 오차는 **절대값**
       (`SLIDER_TOLERANCE`)이라 범위가 좁을수록 판정이 무의미해진다. 정답률이
       1.0으로 고정되므로 **θ·BKT가 그것을 능력으로 읽는다** — 배치고사·적응
       출제·숙련도 표시가 전부 그 위에 얹혀 있다.
       ⚠️ 범위·숫자 여부는 여기서 보지 않는다 — 게이트 ①의 `slider_range`가
       이미 본다. 같은 결함을 두 번 보고하면 리포트가 시끄러워진다.
    ⑵ **맞는 답이 오답 처리** — short_answer·cloze는 공백·대소문자만 무시하는
       **완전 일치**로 채점한다(`_grade_text`). 정답이 「30년」이면 「30」이라고
       쓴 학습자가 틀린 것이 되는데, 그 학습자는 자기가 왜 틀렸는지 알 수 없다.
       본시드의 관례는 **맨 숫자**이고(단위는 지문·빈칸 뒤에 둔다), 이 검사는
       그 관례를 게이트로 세운다.

    board는 대상이 아니다 — 규칙 엔진이 재판정하므로 정답 문자열이 채점에 쓰이지
    않는다(`_grade_board`).
    """
    template = item.get("template_json") or {}
    question_type = item.get("question_type")
    answer = template.get("correct_answer")
    errors: list[tuple[str, str]] = []

    if question_type == "slider":
        low, high = template.get("min"), template.get("max")
        try:
            value, low, high = float(answer), float(low), float(high)
        except (TypeError, ValueError):
            return errors  # 숫자·범위 결손은 ①(slider_range)의 몫
        tol = grading.slider_tolerance
        if abs(low - value) <= tol and abs(high - value) <= tol:
            errors.append(
                (
                    "slider_indiscriminate",
                    f"슬라이더 전 구간[{low:g}, {high:g}]이 채점 관용오차"
                    f" ±{tol:g} 안이라 **어떤 값을 짚어도 정답**이다"
                    f" (정답 {value:g}). 범위를 넓히거나 다른 유형으로 낼 것",
                )
            )

    if question_type in _TYPED_ANSWER_TYPES:
        match = _ANSWER_WITH_UNIT_RE.match(str(answer or "").strip())
        # 접미가 **관측된 단위**일 때만 조치를 지시한다 — 아니면 「2차전지」 같은
        # 일반 낱말이고, 그것을 맨 숫자로 만들라는 안내는 정답을 망가뜨린다.
        if match and match.group(1) in MEASURED_UNITS:
            errors.append(
                (
                    "answer_unit_suffix",
                    f"정답이 숫자+단위 결합('{answer}')이라 완전 일치 채점에서"
                    f" 「{str(answer).replace(match.group(1), '').strip()}」이"
                    " 오답 처리된다. 단위는 지문·빈칸 뒤에 두고 정답은 맨 숫자로",
                )
            )

    return errors


# ── 기지 잔여 (래칫) ─────────────────────────────────────────────────────────
# ⑥ 계열은 **이미 저작된 1,012건에 잔여가 있다.** 셋 중 하나를 골라야 했다:
#   ⓐ 탈락으로 센다 → 게이트가 첫날부터 붉고, 그 압력이 게이트를 약화시킨다
#     (모듈 머리 ④의 `--staging` 중복 판단이 같은 이유로 같은 선택을 했다).
#   ⓑ 경고로만 낸다 → 저작 배치가 도는 바로 그 주에 아무것도 못 막는다.
#   ⓒ **래칫** — 아래 목록에 있는 것만 통과하고 **새로 생기면 탈락한다.**
# ⓒ를 골랐다. 이 결함군이 위험한 이유가 "지금 몇 건인가"가 아니라 **"저작이
# 진행되면 늘어난다"**이기 때문이다(MT-15 실측 84 → 311건, 3.7배).
#
# 의미는 **부분집합**이다(같음이 아니다): 저작 담당이 문항을 고치면 항목이 낡을
# 뿐 CI는 붉어지지 않는다 — 파일 소유가 갈린 사람에게 남의 파일을 고치게 만들지
# 않는다. 낡은 항목의 청소는 선택이다.
#
# 키는 **question_text 원문**이다. 인덱스는 저작 한 건에 밀리고(실측 207건 재배치),
# 해설 문자열은 --remap-hints가 바꾼다. 대조는 author_items.dedupe_keys와 같은
# 정규화(normalize_text)를 쓴다 — 중복 판정과 키 규칙이 두 벌이 되지 않게.
#
# ⚠️ **이 목록이 곧 「사람이 읽을 자리 참조 문항 열거」다**(2026-08-19). ⑥ⓐ 절제로
# 극성을 기계가 판정하지 않게 됐으므로, 「이 해설이 실제로 정오를 뒤집어 말하는가」의
# 판정은 표본 검수(사람)가 이 열거를 읽어서 한다. 명사 **없는** 서수는 여기 안 잡히니
# 함께 읽어야 하고, 그 목록·인구는 test_factuality_gate의 미탐 픽스처가 날짜와 함께
# 들고 있다(휘발성이라 인용할 때 날짜를 볼 것).
FACTUAL_BASELINE: dict[str, dict[str, str]] = {
    # 자리 참조 7건 — 전부 **가리키는 정오는 맞다**(2026-08-14 전건 확인). 지금
    # 틀린 것이 아니라 셔플에서 빠져 있고, 손으로 순서를 만지는 순간 틀려지는 잠복분이다.
    # 해소: 해설을 선지 내용 참조로 고쳐 저작(그러면 다음 셔플에서 자동으로 풀린다).
    "ordinal_ref": {
        "라니냐가 발달한 해에 적도 태평양에서 나타나는 상태로 가장 알맞은 것은 무엇인가?": (
            "「두 번째 선지」 — 정오는 맞다(2번은 엘니뇨 설명). 셔플 제외분."
        ),
        (
            "같은 크기의 기압 경도가 걸린 두 지점이 있다. 한 곳은 위도 20도, 다른 곳은 위도 60도이고"
            " 둘 다 마찰이 거의 없는 상공이다. 전향력 인자는 위도가 높을수록 커진다."
            " 두 곳 지균풍의 풍속을 비교한 것으로 옳은 것은?"
        ): "「네 번째 선지」+「세 번째」 — 정오는 맞다. 셔플 제외분.",
        (
            "겨울 눈이 두껍게 덮인 벌판에서는 낮에도 기온이 잘 오르지 않고 밤에는 유난히 강한"
            " 역전층이 생긴다. 낮과 밤을 함께 설명한 것으로 옳은 것은?"
        ): "「두 번째 선지」 — 정오는 맞다. 셔플 제외분.",
        (
            "같은 햇빛을 받는 도심 아스팔트 광장과 교외 잔디밭에서 낮 기온을 재니 광장 쪽이 훨씬"
            " 높았다. 두 지면이 받은 태양 에너지가 쓰이는 방식을 비교한 것으로 옳은 것은?"
        ): "「세 번째 선지」 — 정오는 맞다. 셔플 제외분.",
        (
            "온난화로 극지방이 중위도보다 더 크게 데워지면 남북 기온 차가 줄어든다. 상층 서풍의"
            " 세기가 남북 기온 차에 좌우된다고 볼 때 중위도 날씨에 기대되는 변화로 옳은 것은?"
        ): "「네 번째 선지」 — 정오는 맞다. 셔플 제외분.",
        (
            "같은 세기의 습한 남서풍이 완만한 구릉과 급한 산 사면에 각각 부딪힌다. 지형이 공기를"
            " 밀어 올리는 속도는 풍속과 사면 기울기의 곱으로 어림한다. 두 곳의 비를 비교한 것으로"
            " 옳은 것은?"
        ): "「첫 번째 선지」 — 정오는 맞다. 셔플 제외분.",
        (
            "봄철 오후 산불 현장에서 상대습도가 급격히 떨어지고 바람이 돌풍성으로 바뀌었다. 같은"
            " 시각 혼합층은 3km까지 깊어져 있었다. 이 변화를 설명한 것으로 옳은 것은?"
        ): "「마지막 선지」 — 정오는 맞다. 셔플 제외분.",
    },
    # ⛔ **`slider_indiscriminate` 항은 없다 — 2026-08-20에 6건 전건 갚고 지웠다.**
    #    그 여섯은 눈금 폭이 관용오차 ±10(**절대값**)보다 좁아 **무엇을 짚어도 정답**이었고,
    #    정답률이 1.0으로 고정돼 θ·BKT가 그것을 능력으로 읽었다. 해소는 범위 확대가 아니라
    #    **multiple_choice 재저작**이다 — `numeric` 채점기는 신설이 필요하고 객관식은
    #    `_grade_text` 경로가 이미 있어 시드 문자열만으로 끝난다.
    #    지문은 한 글자도 바꾸지 않았다: 시드 멱등 키가 `(concept_tag, question_text)`라
    #    (`seed_content.py` upsert_entries) 지문을 바꾸면 제자리 갱신이 아니라 **삽입**이고
    #    구 슬라이더 행이 실DB에 active로 남는다(§5.17 · 커밋 caf3135).
    #    ⚠️ **되살리지 마라.** 새 slider가 이 검사에 걸리면 저작이 갚을 몫이지 래칫이 받을
    #    몫이 아니다 — 래칫은 **기지 잔여**를 위한 것이고 이 코드의 잔여는 이제 0이다.
    # 단위 결합 정답 1건 — 본시드 관례(맨 숫자)의 유일한 예외다.
    "answer_unit_suffix": {
        (
            "어떤 지역의 기후를 말할 때 기준으로 삼는, 세계기상기구가 정한"
            " 평년값의 산출 기간은 몇 년인가?"
        ): "정답 '30년' — 「30」이 오답 처리된다. 지문이 이미 「몇 년」이라 단위 중복.",
    },
}


# ── ⑥ⓑ′ 자리 참조 **감시** (명사 없는 서수 — 판별이 아니라 열거) ────────────
# 🔴 **왜 자동 판별이 불가능한가**: 서수가 가리키는 번호와 그 번호의 선지가 **뜻으로**
# 맞는지는 문장을 읽어야 안다(「전향력」인 선지를 「열저기압」이라 부르는지). 기계가
# 그 판정을 하려던 자리가 ⑥ⓐ이고, 세 라운드 전부 오탐으로 끝나 2026-08-19에
# 절제됐다(모듈 머리 ⛔ — 「반대」가 판정어가 아니라 기상 어휘였다). **여기서 다시
# 시도하지 말 것.** 이 층은 **열거만** 한다.
#
# 왜 그럼에도 게이트가 이것을 내는가 — 2026-08-21에 이 클래스의 실제 결함이 하나
# 나왔다: 시드 [881](온대저기압 에너지원)의 해설이 「세 번째는 여름 내륙의
# 열저기압이며」라고 했는데 그 내용은 **4번 선지**였다(3번은 전향력). ⑥ⓑ는 명사
# 가드(「~ 선지」)를 요구하므로 이것을 **못 봤고**, 셔플도 명사 없는 서수를 그냥
# 건너뛴다(test_명사_없는_자리_참조는_파이프라인이_그냥_지나친다). 곧 **아무 층도
# 보지 않는 클래스**였다. 결함의 모양이 ⑥ⓐ와 다르다는 점이 중요하다 — 정오를
# 뒤집어 말하는 것이 아니라 **오답 라벨이 한 칸 밀린 것**이라, 학습자는 3번이 왜
# 틀렸는지 읽으면서 4번 설명을 읽는다.
#
# 그래서 ⑥ 래칫과 **같은 규칙**을 쓴다(부분집합·question_text 키·새로 생기면 탈락).
# 탈락 사유 STAGES에는 넣지 않는다 — 이것은 「이 문항이 틀렸다」가 아니라 「사람이
# 읽어야 한다」이고, 둘을 같은 칸에 세면 다음 사람이 판별로 착각한다.
#
# **세는 규칙과 잰 날**을 함께 적는다(이 파일이 낡은 수치로 두 번 데었다):
# *mc 해설 중 `hint_has_bare_ordinal`이 참인 **문항 수**(서수 출현 수가 아니다)*
#   · **시드 1,034건 · mc 310건**(2026-08-21 실측): **3건**. [881] 수리 전에는 4건이었다.
#   · 명사 **있는** 서수 7건은 위 FACTUAL_BASELINE["ordinal_ref"]가 든다 —
#     **사람이 읽을 자리 참조 목록은 그 7건 + 이 3건 = 10건**이고, 리포트는 둘을
#     나란히 낸다. 한쪽만 읽으면 [881]류를 또 놓친다.
ORDINAL_WATCH_BASELINE: dict[str, str] = {
    "2026년에 새로 만들어진 폭염중대경보의 발표 기준으로 옳은 것은 무엇인가?": (
        "「두 번째와 세 번째는 각각 …, 네 번째는 …」 — 2·3·4번과 내용이 맞는다"
        "(2026-08-21 사람 확인)."
    ),
    (
        "같은 크기의 기압 경도가 걸린 두 지점이 있다. 한 곳은 위도 20도, 다른 곳은 위도 60도이고"
        " 둘 다 마찰이 거의 없는 상공이다. 전향력 인자는 위도가 높을수록 커진다."
        " 두 곳 지균풍의 풍속을 비교한 것으로 옳은 것은?"
    ): (
        "「네 번째 선지 … 세 번째는」 — 3·4번과 내용이 맞는다(2026-08-21 사람 확인)."
        " 명사 있는 쪽은 ordinal_ref 래칫에도 있다."
    ),
    (
        "중심 기압 940hPa인 태풍이 만조 시각에 얕고 좁은 만으로 들어온다. 바람은 만 안쪽을 향해"
        " 강하게 분다. 해면 상승에 대한 판단으로 옳은 것은?"
    ): (
        "「두 번째 몫」 — **선지가 아니라 앞 문장이 든 물리적 기여분**이다."
        " 이 항이 곧 「기계가 판별하면 안 되는 이유」의 실물이다."
    ),
}


def hint_bare_ordinal_watch(item: dict) -> str | None:
    """객관식 해설이 **명사 없는 서수**로 선지를 가리킬 수 있는가 (판정 아님·열거).

    ⑥ⓑ(`hint_ordinal_errors`)와 배타적이지 않다 — 한 해설에 「네 번째 선지」와
    「세 번째」가 함께 있으면 양쪽에 다 잡힌다([880]이 그렇다). 겹치는 것을 굳이
    지우지 않는다: ⑥ⓑ는 **셔플에서 깨진다**를 말하고 이쪽은 **사람이 읽어야 한다**를
    말한다. 사유가 다르므로 한쪽이 사라져도 다른 쪽은 남아야 한다.
    """
    if item.get("question_type") != "multiple_choice":
        return None
    hint = str((item.get("template_json") or {}).get("explanation_hint") or "")
    if not shuffle_tool.hint_has_bare_ordinal(hint):
        return None
    return (
        "해설이 명사 없는 서수로 무언가를 가리킨다 — 그것이 **선지 번호**라면"
        " 가리킨 번호와 그 선지의 내용이 맞는지 **사람이 읽어서** 확인할 것"
        " (기계는 판정하지 않는다 — ⑥ⓐ 절제 사유)"
    )


def watch_index() -> set[str]:
    """감시 래칫을 대조용 정규화 키로 편다 — 키 규칙은 baseline_index와 같다."""
    return {author_items.normalize_text(text) for text in ORDINAL_WATCH_BASELINE}


def baseline_index() -> dict[str, set[str]]:
    """래칫 목록을 대조용 정규화 키로 편다 — 키 규칙은 dedupe_keys와 같다."""
    return {
        code: {author_items.normalize_text(text) for text in texts}
        for code, texts in FACTUAL_BASELINE.items()
    }


# 탈락 사유 카테고리 — 리포트는 항상 이 8종을 0건 포함해 전부 출력한다.
# ⚠️ 종전 9종이었다. `fact_hint`(⑥ⓐ)는 2026-08-19에 절제됐고 **생산자가 없는 단계를
# 리포트에 남기지 않는다** — 영구 0건은 「검사하고 있다」는 거짓 신호가 된다.
STAGES: tuple[tuple[str, str], ...] = (
    ("gate1", "① 1차 게이트 탈락 (휴리스틱)"),
    ("payload", "② payload 계약 탈락"),
    ("schema", "③ 스키마 탈락 (validate_entry)"),
    ("dup_file", "④ 중복 (파일 내)"),
    ("dup_base", "④ 중복 (본시드 대조)"),
    ("vocab", "⑤ 단계 금칙 어휘"),
    ("fact_ordinal", "⑥ⓑ 해설의 선지 위치 참조"),
    ("fact_grading", "⑥ⓒ 채점 정합 (관용오차·정답 표기)"),
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
    # 래칫 목록에 있어 탈락시키지 않은 ⑥ 계열 적발 — **숨기지 않고 따로 센다.**
    # 조용히 빼면 목록이 잊히고, 잊힌 예외는 규칙이 없는 것과 같다.
    baseline: list[Finding] = field(default_factory=list)
    # ⑥ⓑ′ 자리 참조 감시 — **탈락 목록이 아니다**(findings에 넣지 않는다).
    # 「사람이 읽어야 하는 문항」의 열거이고, 래칫 밖의 새 것만 탈락시킨다.
    watch: list[Finding] = field(default_factory=list)

    @property
    def watch_new(self) -> list[Finding]:
        """감시 래칫 **밖**의 새 자리 참조 — 이것만 게이트를 붉힌다."""
        known = watch_index()
        return [
            f for f in self.watch
            if author_items.normalize_text(f.question_text) not in known
        ]

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
    grading: GradingContract,
    base_items: list[dict] | None = None,
) -> LintResult:
    """전 문항에 **6종** 검사를 실행한다 (순수 함수 — 출력·exit 없음).

    ⚠️ 종전 「5종」은 ⑥(사실성·채점 정합)을 더하면서 안 고친 자리다 — 같은 파일
    머리 주석이 이미 「검사 6종」이었으므로 **한 파일 안에서 갈려 있었다**.
    개수를 두 곳에 적으면 한쪽만 갱신된다.

    base_items가 주어지면(=staging lint) 본시드 대조 중복까지 본다.
    중복 비교는 정규화 키 set(O(n)) — dedupe_keys의 두 키(정규화 question_text /
    유형·개념·정규화 정답) 어느 쪽이 겹쳐도 중복이다(author_items §5단계와 동일).
    단, 정답 키는 정규화 정답이 비어 있지 않은 문항만 참여한다(모듈 머리 ④ 주석).
    """
    result = LintResult(total=len(items))
    baseline = baseline_index()

    def answer_key_active(item: dict) -> bool:
        template = item.get("template_json") or {}
        return author_items.normalize_text(template.get("correct_answer")) != ""

    # 생성 대상 유형에만 계약 G(check_payload)를 적용하는 어댑터 — 대상 밖 유형에
    # 그대로 적용하면 "생성 대상이 아닌 question_type" ValueError가 전 저작 유형을
    # 오탈락시킨다. 2026-08-10에 대상이 3종 → **board를 뺀 6종**으로 넓어졌으므로
    # 이 어댑터가 통과시키는 범위도 함께 넓어졌다(match·ordering·cloze가 이제
    # 값 정합까지 검사받는다 — 본시드 284건 실측 위반 0건). **유형 목록을 여기
    # 적지 않는다** — 소유자는 ai-worker의 `GENERATED_PAYLOAD_FIELDS` 하나다.
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

        def found_factual(stage: str, coded: list[tuple[str, str]]) -> None:
            """⑥ 계열 — 래칫(FACTUAL_BASELINE)에 있는 코드·문항이면 탈락시키지 않는다.

            판정은 **코드별**이다. 같은 문항이 다른 사유로 새로 걸리면 그때는
            탈락한다 — 한 번 목록에 오른 문항이 이후 무엇을 해도 통과하는
            「영구 면제」가 되지 않게.
            """
            text_key = author_items.normalize_text(text)
            excused = [c for c in coded if text_key in baseline.get(c[0], set())]
            live = [c for c in coded if c not in excused]
            if excused:
                result.baseline.append(
                    Finding(i, stage, concept_tag, text, [r for _, r in excused])
                )
            if live:
                found(stage, [r for _, r in live])

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

        # ⑥ⓐ는 없다 — 2026-08-19 절제(모듈 머리 ⛔). 극성을 기계가 판정하려던
        #     자리이고, 표적 결함은 아래 ⑥ⓑ가 **자리 참조 자체를 금지**해 막는다.

        # ⑥ⓑ 해설의 선지 위치 참조 — 정오가 맞아도 셔플에서 깨지므로 건다(래칫).
        ordinal_errors = hint_ordinal_errors(item)
        if ordinal_errors:
            found_factual("fact_ordinal", ordinal_errors)

        # ⑥ⓑ′ 자리 참조 감시 — **탈락 사유가 아니라 열거**다. STAGES에 넣지 않는다.
        watch_reason = hint_bare_ordinal_watch(item)
        if watch_reason:
            result.watch.append(
                Finding(i, "ordinal_watch", concept_tag, text, [watch_reason])
            )

        # ⑥ⓒ 채점 정합 — 채점기에 걸어 보면 문항이 성립하지 않는 것(래칫).
        grade_errors = grading_errors(item, grading=grading)
        if grade_errors:
            found_factual("fact_grading", grade_errors)

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

    if result.baseline:
        # 래칫 잔여는 **탈락이 아니지만 숨기지도 않는다** — 모듈 머리 「기지 잔여」
        # 참조. 건수가 줄면 저작이 갚은 것이고, 늘면 목록을 늘린 사람이 있는 것이다.
        lines += [
            "",
            f"기지 잔여 (⑥ 래칫 — 탈락 아님, 저작이 갚을 몫): {len(result.baseline)}건",
        ]
        for f in result.baseline:
            head = f.question_text[:48] + ("…" if len(f.question_text) > 48 else "")
            lines.append(f"    - [{f.index}] ({f.concept_tag}) {head}")

    # ⑥ⓑ′ 자리 참조 감시 — **판별이 아니라 열거**다. 0건이어도 낸다: 이 목록이
    # 비어 있다는 사실 자체가 사람이 확인해야 할 상태다(⑥ⓑ 래칫 7건과 함께 읽을 것).
    ordinal_ratchet = [f for f in result.baseline if f.stage == "fact_ordinal"]
    lines += [
        "",
        f"자리 참조 감시 (⑥ⓑ′ 명사 없는 서수 — 탈락 아님, **사람이 읽을 목록**):"
        f" {len(result.watch)}건"
        f" / ⑥ⓑ 래칫(명사 있는 서수) {len(ordinal_ratchet)}건"
        f" = 읽을 문항 {len(result.watch) + len(ordinal_ratchet)}건",
        "  🔴 자동 판별은 불가능하다 — 서수가 가리킨 번호와 그 선지의 **뜻**이 맞는지는"
        " 읽어야 알고, 기계 판정은 ⑥ⓐ에서 세 라운드 전부 오탐으로 끝나 절제됐다"
        " (모듈 머리 ⛔). 여기 있는 것을 「결함」으로 세지 말고, 여기 **없는데** 서수를"
        " 쓴 새 문항이 없는지를 볼 것.",
        "  세는 규칙: mc 해설 중 명사 없는 서수를 품은 **문항 수**(서수 출현 수 아님).",
    ]
    notes = {
        author_items.normalize_text(text): note
        for text, note in ORDINAL_WATCH_BASELINE.items()
    }
    for f in result.watch:
        head = f.question_text[:48] + ("…" if len(f.question_text) > 48 else "")
        note = notes.get(author_items.normalize_text(f.question_text))
        mark = "" if note else "  🔴 신규 — 래칫 밖"
        lines.append(f"    - [{f.index}] ({f.concept_tag}) {head}{mark}")
        lines += [f"        · {note}"] if note else [
            f"        · {reason}" for reason in f.reasons
        ]

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


def run_staging(*, pipeline: dict, staging_dir: Path = STAGING_DIR) -> int:
    """staging 전건 lint (CO-SN2) — 제외 목록 밖 파일을 한 번의 파이프라인 로드로 돈다.

    본시드 대조는 **탈락이 아니라 승격 현황**으로 집계한다(모듈 머리 ④ 주석).
    """
    targets = staging_targets(staging_dir)
    if not targets:
        print(f"[lint_seed_items] staging 대상 0건: {staging_dir}", file=sys.stderr)
        return 1

    base_items = author_items.load_seed(DEFAULT_SEED_PATH)

    failed_files: list[str] = []
    checked = 0
    for path in targets:
        items = author_items.load_seed(path)
        checked += len(items)
        result = lint_items(items, base_items=None, **pipeline)
        print(format_report(result, target=path, base=None))
        # 감시 래칫 밖의 새 자리 참조도 파일을 탈락시킨다 — **저작이 들어오는 문이
        # 여기**이고, 본시드에서만 막으면 이미 승격된 뒤에 잡는 셈이 된다.
        if result.findings or result.watch_new:
            failed_files.append(path.name)

    print("")
    print("── staging 승격 현황 (정보 — 탈락 사유 아님) ────────────────")
    print(f"본시드: {DEFAULT_SEED_PATH.name} ({len(base_items)}문항)")
    remaining_total = 0
    # ⑦ 승격 되돌림 감시는 **문항 파일 전부**를 돈다 — lint 한시 제외분(au1·au2)도
    # 포함한다. DB 적재 경로는 lint 제외 목록을 읽지 않으므로, 제외분을 빼면
    # 「lint가 안 보는 파일로 되돌리기」라는 구멍이 그대로 남는다.
    drift_rows: list[tuple[str, int, str, str, str]] = []
    for path in staging_item_files(staging_dir):
        items = author_items.load_seed(path)
        promoted = len(promoted_indexes(items, base_items))
        remaining = len(items) - promoted
        remaining_total += remaining
        flag = " [lint 한시 제외]" if path.name in STAGING_PENDING_LEVEL else ""
        drift = promotion_option_drift(items, base_items)
        drift_rows.extend((path.name, *row) for row in drift)
        mark = f" · 🔴 되돌림 {len(drift)}" if drift else ""
        print(
            f"  {author_items._pad(path.name, 34)}: "
            f"{len(items):3d}문항 중 승격 {promoted:3d} · 미승격 {remaining:3d}{flag}{mark}"
        )
    print(f"  → 미승격 잔여 합계: {remaining_total}문항")

    print("")
    print("── ⑦ 승격 되돌림 감시 (선지·정답) ──────────────────────────")
    if not drift_rows:
        print(
            f"  갈린 곳 없음 — 승격된 staging 항목의 {'·'.join(DRIFT_FIELDS)}가 "
            "본시드와 전건 일치한다. 재승격이 채점면을 되돌리지 않는다."
        )
    else:
        drift_files = sorted({name for name, *_ in drift_rows})
        print(
            f"  🔴 {len(drift_rows)}곳 / {len(drift_files)}파일 — 이 staging 항목들은 "
            "본시드와 **멱등 키가 같은데 채점면이 다르다.**"
        )
        print(
            "  seed_content가 template_json을 통째로 덮으므로, 이 파일을 재승격하면 "
            "본시드의 선지·정답이 staging 값으로 되돌아간다(경고 없음)."
        )
        print(
            "  고치는 법: **본시드가 정본이다.** staging의 해당 항목을 본시드 현재 "
            "값으로 갱신하라 — 본시드를 staging에 맞추지 말 것."
        )
        for name, index, tag, text, field in drift_rows[:40]:
            head = text[:52] + ("…" if len(text) > 52 else "")
            print(f"    - {name}[{index}] ({tag}) {field} 상이 — {head}")
        if len(drift_rows) > 40:
            print(f"    … 그리고 {len(drift_rows) - 40}곳 더")

    print("")
    for name, reason in STAGING_NOT_ITEMS.items():
        print(f"[lint_seed_items] 제외(문항 파일 아님) {name} — {reason}")
    for name, reason in STAGING_PENDING_LEVEL.items():
        print(f"[lint_seed_items] 제외(한시) {name} — {reason}")

    if failed_files:
        print(
            f"[lint_seed_items] FAIL — staging {len(failed_files)}파일 탈락: "
            f"{', '.join(failed_files)}",
            file=sys.stderr,
        )
        return 1
    if drift_rows:
        # ⑦은 파일 lint와 별개의 탈락 사유다 — 항목 자체는 스키마·게이트를 다 통과해도
        # (교정 전 선지는 어제까지 본시드에 있던 정상 문항이다) 재승격이 되돌림이 된다.
        print(
            f"[lint_seed_items] FAIL — 승격 되돌림 {len(drift_rows)}곳: "
            f"{', '.join(sorted({name for name, *_ in drift_rows}))} "
            "(위 ⑦ 절 참조 — staging을 본시드 현재 값으로 갱신하라)",
            file=sys.stderr,
        )
        return 1
    print(
        f"[lint_seed_items] OK — staging {len(targets)}파일 {checked}문항 전건 통과 "
        f"(제외 {len(STAGING_EXCLUDED)}파일: "
        f"{', '.join(sorted(STAGING_EXCLUDED))})."
    )
    return 0


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
    parser.add_argument(
        "--staging",
        action="store_true",
        help=(
            "database/seed/staging/ 전건 lint (제외 목록 밖). path·--base는 무시된다 —"
            " 본시드 중복은 탈락이 아니라 승격 현황으로 집계한다"
        ),
    )
    args = parser.parse_args(argv)

    try:
        backend = author_items.load_backend_contract()
        ai = author_items.load_ai_worker(with_generator=False)
        render_required = load_render_required()
        vocabulary = load_vocabulary()
        grading = load_grading_contract()
    except Exception as exc:
        print(f"[lint_seed_items] 파이프라인 로드 실패: {exc}", file=sys.stderr)
        return 2

    pipeline = {
        "backend": backend,
        "ai": ai,
        "render_required": render_required,
        "vocabulary": vocabulary,
        "grading": grading,
    }

    if args.staging:
        try:
            return run_staging(pipeline=pipeline)
        except Exception as exc:
            print(f"[lint_seed_items] staging 입력 오류: {exc}", file=sys.stderr)
            return 1

    try:
        items = author_items.load_seed(args.path)
        if not args.path.exists():
            raise ValueError(f"대상 파일이 없다: {args.path}")
        same_as_base = args.path.resolve() == args.base.resolve()
        base_items = None if same_as_base else author_items.load_seed(args.base)
    except Exception as exc:
        print(f"[lint_seed_items] 입력 오류: {exc}", file=sys.stderr)
        return 1

    result = lint_items(items, base_items=base_items, **pipeline)
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
    if result.watch_new:
        # 붉히는 것은 「틀렸다」가 아니라 「아무도 안 읽었다」이다 — 해소는 둘 중 하나:
        # 해설을 선지 **내용** 참조로 고치거나, 사람이 읽고 ORDINAL_WATCH_BASELINE에
        # 판정 메모와 함께 올리거나.
        print(
            f"[lint_seed_items] FAIL — 감시 래칫 밖의 새 자리 참조 "
            f"{len(result.watch_new)}건: "
            + ", ".join(f"[{f.index}] {f.question_text[:32]}" for f in result.watch_new)
            + ". 해설을 선지 **내용** 참조로 고치거나, 읽고 ORDINAL_WATCH_BASELINE에"
            " 판정을 적을 것.",
            file=sys.stderr,
        )
        return 1
    print(f"[lint_seed_items] OK — {result.total}문항 전건 통과.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
