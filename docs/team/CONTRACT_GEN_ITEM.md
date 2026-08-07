# 생성 문항 계약 — payload 완전성 · 저작 배치 산출물

**확정: 2026-08-03 (PM). 이 문서가 두 담당의 유일한 협상 지점이다** — 아래 계약을
읽고 각자 구현하며, 서로의 파일을 읽거나 고치지 않는다.

## 0. 왜 이 계약이 필요한가 (실측 근거)

### 결함 ① 생성 slider는 범위 없이 API에 도달한다

`ai-worker/app/chains/quiz_gen_chain.py:74`의 `QuizQuestion`은
`question_type`에 `slider`를 **허용하는데** `min`·`max`·`step`·`unit` 필드가 없다.

생성 문항은 `session_service.py:544-552`에서 flat dict 그대로 `entries`에 들어가고,
`session.py`의 `_question_payload`가 `QUESTION_PAYLOAD_FIELDS["slider"] =
("min","max","step","unit")` 중 **존재하는 것만** 담으므로 결과는 `None`이다.
프론트(`QuestionCard.jsx`)는 `?? 0` / `?? 100` / `?? 1` / `?? ''`로 폴백한다.

즉 "초속 몇 m 이상일 때 태풍인가"(정답 17, 시드 범위 0~40) 같은 문항이 생성되면
**0~100 슬라이더**가 나온다. `SLIDER_TOLERANCE=10`이 절대값이라 0~100에서는 사실상
공짜 정답이 된다.

**이것은 R10-07이 시드 저작으로 고친 결함과 같은 부류인데, 생성 경로는 저작으로 막을
수 없다.** 그래서 스키마가 막아야 한다.

### 결함 ② 생성 문항이 저장되지 않는다 — 비용이 누적되지 않는다

`session_service.py:549`가 생성 문항을 `content_item_id=None`으로 담는다. `question_json`은
`quiz_logs`에 남지만 **재사용 가능한 뱅크 항목이 되지 않는다**. 같은 문항을 유저마다·
세션마다 다시 생성하며 아무것도 누적되지 않는다.

키 투입 게이트 G1(ROADMAP §5.3.1)의 목적은 "1회 투입 → 영구 자산"인데, 이 상태로는
비용이 자산이 아니라 트래픽으로 증발한다.

---

## 1. 계약 G — 생성 문항 payload 완전성 (담당: AI-1)

> **생성 문항은 자기 `question_type`이 요구하는 payload 필드를 전부 갖춰야 한다.
> 갖추지 못한 문항은 생성 단계에서 탈락한다 — API까지 보내지 않는다.**

### G-1. 유형별 필수 필드

| question_type | 필수 payload | 비고 |
|---|---|---|
| `multiple_choice` | `options` (2개 이상) | 기존 `_check_options` 유지·강화 |
| `short_answer` | 없음 | |
| `slider` | `min`·`max`·`step`·`unit` | **신규 — 이 계약의 핵심** |

`board`·`match`·`ordering`·`cloze`는 **생성 대상이 아니다**(현행 유지). `board`는
`board_rules.json` 판정 구조가 필요하고 나머지는 저작 영역이다. `Literal`을 넓히지 마라.

### G-2. slider 값 정합 (형식만 갖추면 안 된다)

1. `min` < `max` — 정수 또는 실수
2. `step` > 0, 그리고 `(max - min)`이 `step`으로 나누어떨어져야 한다
3. **`correct_answer`가 숫자로 파싱되고 `min` ≤ 값 ≤ `max`를 만족해야 한다.**
   범위 밖 정답은 도달 불가능한 문항이다
4. `correct_answer`가 `min`에서 `step` 격자에 올라 있어야 한다 —
   `(정답 - min) % step == 0`. 슬라이더로 짚을 수 없는 정답은 무의미하다
5. `unit`은 빈 문자열이 아니다 (UI가 단위를 붙여 읽는다)
6. **범위가 과도하게 넓지 않아야 한다**: `SLIDER_TOLERANCE`가 절대값 10이므로
   `(max - min) <= 200`을 상한으로 둔다. 그보다 넓으면 관용오차가 무의미해진다

위반은 pydantic `ValueError`로 올려 `_parse_output`의 재시도(temperature 0.1) 경로를
타게 하고, 재시도도 실패하면 폴백 뱅크로 떨어지게 한다(현행 실패 의미론 유지).

### G-3. 필드 선언은 langchain 없는 모듈이 소유한다 (2026-08-03 보정)

필수 필드 맵을 **모듈 상수로 노출**하라 — 이름은
`GENERATED_PAYLOAD_FIELDS: dict[str, tuple[str, ...]]`.

**위치: `ai-worker/app/chains/payload_contract.py`(신규).** `import`는 stdlib과
pydantic까지만 — langchain 계열을 끌어오면 안 된다.

> **보정 근거(실측).** 처음 계약은 `quiz_gen_chain.py`에 상수를 두게 했으나, 그
> 모듈은 19행에서 `langchain_core`를 최상단 import하고 이 환경에는 langchain이
> **설치돼 있지 않다**(ai-worker 테스트의 "7 skipped"가 이것, 관례는
> `pytest.importorskip`). 그 상태로 교차 계약 테스트를 쓰면 7건 전부 ERROR가 나고,
> importorskip으로 우회하면 계약이 **조용히 skip**된다 — 이번 스프린트가 CI SKIP
> 방어로 막은 바로 그 패턴(게이트가 있는 척하고 안 도는 상태)이다.

backend의 `QUESTION_PAYLOAD_FIELDS`(단일 소유자, `backend/app/routers/session.py`)와
이 상수가 드리프트하면 안 되지만 **ai-worker는 backend를 import할 수 없다**(별도 빌드
컨텍스트). 그래서 **PM이 교차 계약 테스트를 쓴다**(`test_xp_contract.py`의
sys.modules 스왑 선례). AI-1은 상수를 위 위치에 정확한 이름으로 노출하는 것까지 책임진다.

`QuizQuestion`을 이 모듈로 옮길지는 AI-1 판단이다. 다만 **결과적으로
`payload_contract`만 import해서 상수와 검사 함수에 도달할 수 있어야 한다.**

---

## 2. 계약 P — 저작 배치 산출물 (담당: BE-1)

> **배치 산출물은 시드 항목과 형태가 같아야 한다. flat 생성 결과를 `template_json`으로
> 되접는 변환이 배치의 일부다.**

### P-1. 산출 형태 (시드 실측 — `database/seed/content_items.json`)

```json
{
  "concept_tag": "typhoon",
  "level_group": "middle_high",
  "question_type": "slider",
  "template_json": {
    "question_text": "...",
    "correct_answer": "17",
    "explanation_hint": "...",
    "min": 0, "max": 40, "step": 1, "unit": "m/s"
  },
  "uses_live_slots": false,
  "source": { "kind": "generated", "refs": ["..."] },
  "status": "active"
}
```

- 생성 결과는 flat(`concept_tag`·`question_type`·`question_text`·`options`·
  `correct_answer`)이다. `concept_tag`·`question_type`은 **바깥**에, 나머지는
  `template_json` **안**에 들어간다. 이 방향을 뒤집으면 `session_service.py:490-506`의
  전개와 어긋나 문항이 깨진다.
- `source.kind`는 `"generated"`. `refs`에 모델명·생성 시각·게이트 통과 기록을 남긴다.
  **추적 불가능한 문항을 뱅크에 넣지 않는다** — 나중에 품질 문제가 나면 회수 단위가 된다.
- `uses_live_slots`는 `question_text`에 `{today.` 가 있으면 `true`.
- `status`는 `"active"`.

### P-2. 배치 파이프라인 단계

1. **생성** — `generate_quiz()` N회
2. **1차 게이트** — `run_heuristic_checks()` (LLM 무관·결정적)
3. **2차 게이트** — `validate_quiz()` (LLM. 키 없으면 이 단계는 건너뛰고 그 사실을 리포트에 남긴다)
4. **payload 계약 검사** — 계약 G의 필수 필드를 산출물이 실제로 갖췄는지 **배치가 다시 확인한다.**
   스키마를 믿고 생략하지 마라: 게이트 통과 ≠ 서버 노출 가능(R10-07이 그 반례다)
5. **중복 배제** — 기존 시드 + 이번 배치 내 중복. `question_text` 정규화 비교
   (공백·문장부호 제거 후) 최소, 가능하면 `concept_tag`+정답까지
6. **쓰기** — 시드 파일에 append. **기존 항목을 수정·삭제하지 않는다**(append-only)
7. **리포트** — 생성 N / 1차 탈락 / 2차 탈락 / payload 탈락 / 중복 / 최종 추가.
   **탈락 사유별 건수를 반드시 출력한다** — 조용한 절삭 금지

### P-3. 무키 동작 (지금 개발·테스트하는 방식)

키가 없으면 `generate_quiz()`는 폴백 뱅크를 돌려준다(`quiz_gen_chain.py:228`).
**배치는 키 없이도 전 단계가 끝까지 돌아야 한다** — 그래야 G1에서 키를 넣는 순간
파이프라인이 처음 실행되는 상황을 피할 수 있다.

`--dry-run`을 기본값으로 두고, 시드 파일 쓰기는 명시적 플래그(`--write`)에서만 한다.
저작 배치는 되돌리기 어려운 작업이므로 실수로 시드를 오염시키면 안 된다.

### P-4. 범위 밖 — 런타임 생성분 자동 승격은 하지 않는다

`session_service.py`의 런타임 생성분을 `content_items`로 자동 승격하는 것은 **이번
범위가 아니다.** 검수되지 않은 문항이 뱅크에 들어가는 위험이 있고, R10-07이 보여준
"쓸 수 없는 문항이 뱅크에 있는" 상태를 자동화하는 셈이 된다. `session_service.py`를
수정하지 마라.

---

## 3. 파일 소유 (배타적 — 목록 밖 수정 금지)

| 담당 | 소유 파일 |
|---|---|
| **AI-1** | `ai-worker/app/chains/quiz_gen_chain.py` · `ai-worker/app/chains/payload_contract.py`(신규) · `ai-worker/tests/test_quiz_gen_payload.py`(신규) |
| **BE-1** | `scripts/author_items.py`(신규) · `backend/tests/test_author_batch.py`(신규) |
| **PM** | 이 문서 · `backend/tests/test_gen_payload_contract.py`(신규, 교차 계약) · 커밋 |

**둘 다 수정 금지**: `backend/app/routers/session.py`(`QUESTION_PAYLOAD_FIELDS` 단일
소유자) · `backend/app/services/session_service.py` · `database/seed/content_items.json`
(BE-1은 `--write`로 **실행**만 하고, 커밋은 PM이 판단한다) ·
`ai-worker/app/chains/validate_chain.py`.

## 4. 공통 금지 사항

- **파괴적 git 명령 일절 금지**: `checkout`·`switch`·`merge`·`pull`·`rebase`·`reset`·
  `stash`·`clean`·`restore`·`push`·`commit`. 같은 워킹트리에서 병렬 작업 중이며,
  과거에 `git stash`로 5인 작업분이 전부 날아간 사고가 있다(CLAUDE.md). 커밋은 PM만 한다.
  읽기 전용은 허용: `git status`·`git diff`·`git show`·`git log`.
- `docker` 명령 금지.
- **자기 파일에서 찾은 문제라도 같은 패턴이 다른 파일에 있으면 보고 대상**이다
  (TEAM_PROCESS §2.6.1 규정 3).

## 5. 테스트 명령

- `cd ai-worker && python -m pytest tests -q` (기준: 97 passed, 7 skipped)
- `cd backend && python -m pytest tests -q` (기준: 937 passed, 8 skipped, 1 xfailed)
- 전체: `scripts/ci.sh`
