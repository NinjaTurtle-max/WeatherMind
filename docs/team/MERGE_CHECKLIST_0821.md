# 병합 체크리스트 — 2026-08-21 동결분

실병합에서 **반드시 손으로 해야 하는 것**만 적는다. 자동으로 되는 것은 안 적는다.

## 🔴 ① 충돌 목록에 **안 뜨는데** 반드시 지워야 하는 파일

```
frontend/tests/hindcast.smoke.test.mjs      ← git rm
scripts/ci.sh 의 FRONT_TESTS 에서  hindcast  ← 한 줄 제거
```

**왜 안 뜨나**: 이 테스트는 A조가 `70d9c57`에서 **새로 추가**했다. 병합기준에도 통합에도
없으므로 git이 「한쪽에만 추가」로 읽어 **조용히 스테이지-0으로 살린다.** 충돌이 아니니
목록에 안 나온다.

**안 지우면**: 로드 시점에 지워진 파일 셋을 읽고 죽는다 — 실측
`ENOENT: .../src/modules/hindcast/CasePlayPage.jsx` (`:52`·`:53`·`:54`).
`ci.sh`는 UU라 해소자가 보지만 **테스트 파일 자체는 아무 신호도 안 낸다.**

🔴 **이 건의 형태를 기억할 것 — 「충돌 목록에 없다」는 「문제 없다」가 아니다.**
git이 충돌로 세우는 것은 **양쪽이 같은 파일을 만졌을 때**뿐이다. 한쪽만 추가한 파일은
조용히 통과한다. 오늘 하루 종일 쫓은 형태와 같다 — **안 울었다는 것이 맞다는 뜻이 아니다.**

## ② hindcast DU 5건 — 철거가 이긴다

```
frontend/src/i18n/resources/hindcast.{ko,en}.js
frontend/src/modules/hindcast/{CaseListPage,CasePlayPage,DemoDataNotice}.jsx
```
근거: 삭제는 **클라이언트 직접 지시**(`83c28da`)이고 A조 수정은 그보다 앞선 작업이다.

**전용임을 확인했다**(B조 실측) — 세 커밋(`f8c3918`·`70d9c57`·`a5fd1aa`)이 전부 hindcast
밖에도 손댔지만 **그 패턴은 다른 파일로 살아남는다**. 지워서 잃는 것은 hindcast 인스턴스뿐.

A조가 든 hindcast 파일 15개 중 **손대지 않은 10개는 자동으로 삭제 쪽에 붙는다.**
문제는 **새로 추가된 1개**(①)뿐이다.

## ③ 남기는 것

```
backend/alembic/versions/20260818_0016_hindcast_attempts.py
```
이미 실DB에 적용됐고 `0017`이 `down_revision="0016_hindcast_attempts"`로 그 위에 서 있다.
마이그레이션은 append-only. 테이블은 빈 채로 남고 쓰는 코드는 0건이다.
**되살릴 때는 테이블이 이미 있다는 것부터 확인할 것.**

`backend/tests/test_rls_role_contract.py`의 hindcast 3자리와 `app/scripts/rls_app_role.sql`
2자리도 남긴다 — 테이블이 남으니 격리 계약도 남는다.

## ④ UU 8건 — 해소자 주의

```
frontend/src/i18n/resources/board.{ko,en}.js
frontend/src/modules/explore/{ClimateSimPage,TyphoonSimPage}.jsx
frontend/src/modules/progress/ProgressPage.jsx
frontend/tests/exploreSims.render.test.mjs
frontend/tests/uiCopy.contract.test.mjs
scripts/ci.sh
```
🔴 `ci.sh`는 **양쪽 `FRONT_TESTS`의 합집합**으로 해소한다(`hindcast`만 뺀다).
**종목이 한쪽에만 있으면 병합에서 사라지고, 사라지면 그 계약은 영구히 안 돌고 실패도 안 남는다.**

`database/seed/`·`backend/`는 충돌 **0건** — 통합의 board +9와 A조의 slider 6건 전환이
겹치지 않아 자동 병합된다.

## ⑤ 🔴 `origin/main`이 36커밋 앞서 있다

다른 작업자의 PR #169·#170. **과거 예보를 우리는 지웠는데 main은 더 만들었다**
(`70d9c57`·`a5fd1aa`). 별도 조사 문서 `MAIN_MERGE_SURVEY_0821.md` 참조.

## ⑥ 기준선 (병합 후 이 값과 대조)

| | 값 | 세는 법 |
|---|---|---|
| 시드 전건 | **1,030** | `content_items.json` 길이 |
| board | **64** | `question_type == "board"` |
| `explanation_hint` 빈칸 | **0** | board 64/64 · 전체 1,030/1,030 |
| 백엔드 | **6,500 / 0 failed** | A조 트리 실측(계약이 계속 는다 — 하한으로 읽을 것) |

⚠️ 백엔드 수는 세션마다 다르다. **어느 커밋에서 쟀는지 없는 수는 대조에 쓰지 말 것.**
오늘 그 형태로 두 번 어긋났다(1021 vs 1030은 세는 법이 아니라 **트리 차이**였다).

---

# ⑦ 🔴 병합 원칙 — 한쪽을 통째로 받으면 반드시 무언가를 잃는다

`origin/main`의 `f8c3918 fix(ui): 화면 사이에서 어긋나던 셋`이 **9개 파일**을 고쳤고
그중 **7자리가 우리 트리에 안 들어와 있다**(A조 읽기 전용 실측, `git show origin/main:`).

## 원칙 두 줄

> **코드 파일 — 「우리 로직 + main 표현」.**
> 슬라이더 3개·`resetAll`은 우리 것, 여백·링크·주석 위치는 main 것.
>
> **계약 파일 — 「우리 재작성 + main 신규 단정」.**
> 한쪽을 통째로 받으면 **계약이 사라지고, 사라진 계약은 실패도 안 남긴다.**

## 표현을 main에서 받을 자리 (전건 우리가 옛 값)

| 파일 · 줄 | 우리 (옛) | main (고침) |
|---|---|---|
| `explore/ClimateSimPage.jsx:236` | `space-y-4 py-4` | `space-y-4 pt-2` |
| `explore/ClimateSimPage.jsx:239` | `text-xs font-medium text-sky-600 hover:text-sky-700` | `shrink-0 text-xs font-bold text-slate-500 hover:text-sky-600` |
| `explore/TyphoonSimPage.jsx:216` | `space-y-4 py-4` | `space-y-4 pt-2` |
| `explore/TyphoonSimPage.jsx:219` | `text-xs font-medium text-sky-600 hover:text-sky-700` | `shrink-0 text-xs font-bold text-slate-500 hover:text-sky-600` |
| `explore/SandboxPage.jsx:63` | `text-sm font-medium … hover:text-slate-700` | `text-xs font-bold … hover:text-sky-600` |
| `board/BoardPage.jsx:357` | `text-sm font-medium … hover:text-slate-700` | `text-xs font-bold … hover:text-sky-600` |
| `progress/ProgressPage.jsx:622` | `mb-3 text-sm font-extrabold` | `mb-3 text-base font-extrabold` + 주석 |

🔴 **`shrink-0`은 우리 쪽 두 파일에 0건이다.** 클래스 문자열을 **통째로** 받아야 그것까지 온다.
부분만 받으면 또 갈린다.

⚠️ **`ProgressPage`의 것은 여백이 아니라 위계다** — 「🎯 다음 목표」 카드만 14px이라 형제 넷
(배지·일일 퀘스트·지식 단계·능력 분석)이 전부 16px인 사이에서 혼자 작았다. 다른 여섯과
**성질이 달라 같은 규칙으로 뭉뚱그리면 안 된다.**

## 🔴 우리 것을 지킬 자리

- `ClimateSimPage` **`type="range"` 3개**(co2 · sensitivity · seaLevelPerDeg) — main은 **1개**뿐.
- `ClimateSimPage` **`resetAll`** — main은 `setCo2` 인라인. **배타가 아니라 우리가 진상위집합**이고,
  main 것을 받으면 「초기화」가 **3개 중 1개만** 되돌린다. 버튼이 초기화라고 말하는데
  감도·해수면이 남는다 — **못 지킬 약속**이고, 클라이언트가 *「왜 너가 판단해서 잘라」*로
  되살린 ⑬ 조작 변수 2건이 **동작에서** 죽는다.
- 초기화 버튼 높이 `py-1.5`(우리) ↔ `py-2`(main) — **의도적으로 우리 값 유지 · 근거 미확인.**
  `f8c3918` diff에 없어 그 커밋 주제에 속하지 않는다. 근거가 나오면 그때 바꾼다.

## 🔴 계약 파일 둘 — 제일 위험하다

```
frontend/tests/home.smoke.test.mjs        main +27줄   ← 우리가 오늘 다시 씀(d6d6c99, 하루 목표 계약 이동)
frontend/tests/uiCopy.contract.test.mjs   main +56줄   ← 우리가 오늘 절 ⑹⑺ 신설
```
**단정 단위로 갈라라.** 「main이 새로 세운 단정」과 「main이 옛 설계를 물고 있는 단정」은 다르다.

⚠️ `uiCopy.contract`는 **클라이언트 판정으로 문구 셋을 걷은 뒤** 세운 파일이다
(「바꿀 수 있다」·「언제든」·「나중에」 금지). **main의 +56줄이 걷힌 문구를 되살리는 단정이면
받으면 안 되고, 왜 안 받는지를 그 자리에 남겨야 한다.**

## `BoardPage.jsx` — 양쪽이 만난다

main 몫은 `:357`(뒤로가기 링크), 우리 몫은 `:560`대(CTA, `6b7cfb5`). **자리가 달라 충돌은
안 나지만 한쪽을 통째로 받으면 다른 쪽이 죽는다.**

## ⚠️ 이 결함의 성질 — 왜 우리가 못 잡았나

**한 화면만 보면 안 보이고 화면을 오갈 때만 드러난다**(본문이 8~13px 내려앉는다).
⇒ **화면 단위 스모크가 원리적으로 못 잡는 부류**다. 그리고 **2026-08-17 사용자 제보 계열**이라
잃으면 같은 제보를 다시 받는다.

---

# ⑧ 🔴 충돌 목록은 **줄의 겹침**을 보지 **뜻의 의존**을 안 본다

오늘 **세 번** 같은 형태가 나왔다. 전부 **충돌 0으로 끝나는데 깨진다.**

| # | 자리 | 어떻게 조용한가 |
|---|---|---|
| 1 | `frontend/tests/hindcast.smoke.test.mjs` | **한쪽만 추가**한 파일이라 그냥 살아남고, 지워진 파일 셋을 읽어 `ENOENT` |
| 2 | `git cat-file -e`가 「없음」 | 명령이 **거짓 음성**을 냈다(`ls-tree`가 참) |
| 3 | `uiCopy.contract.test.mjs`의 `readdirSync` | **한쪽이 지운 import를 다른 쪽이 여전히 쓴다** → `ReferenceError` |

## ③의 실측 (B조)

```
c697913  import { readFileSync, readdirSync } from 'node:fs';   (공통 베이스)
92e146e  import { readFileSync, readdirSync } from 'node:fs';   (표기 통일 — 안 건드림)
8020b71  import { readFileSync } from 'node:fs';                🔴 통합이 뺌
```
통합이 `walk()`를 쓰던 「바깥 여백 pt-2」 검사를 들어내면서 **유일한 사용처가 사라져 import도
같이 걷었다.** 정당한 정리다. 그런데 표기 통일이 더한 83줄이 **`readdirSync`를 쓴다**
(하드코딩 `°C` 검사가 `frontend/src`를 순회한다).

⇒ 병합하면 import 줄은 **「한쪽이 안 건드렸고 다른 쪽이 지웠으니」 자동으로 지운 판으로 접힌다.**
**충돌 표시가 안 난다.** 실측: `import 목록 = readFileSync` / `본문 readdirSync 호출 1회` → 정의 안 됨.

🔴 **해소할 때 import 줄에 `readdirSync`를 되살릴 것. 한 낱말이다.**

## ⇒ 규칙

> **병합이 충돌 0으로 끝나도 그것은 「합쳐졌다」이지 「돈다」가 아니다.**
> 병합 직후 **반드시 실제로 돌려라** — 최소한 `node tests/uiCopy.contract.test.mjs`와
> `FRONT_TESTS` 전 종목. 충돌 목록만 보고 넘기면 이 부류는 **하나도 안 잡힌다.**

# ⑨ 정정 — `uiCopy.contract`는 **세 갈래가 아니라 두 갈래**다

앞서 ⑦에 「main +56줄」이라 적었으나 **참이 아니다.** B조 실측:

```
c697913 (공통 베이스)   230줄
e3d2a24 (A조)           230줄   ← 베이스와 diff 0
6a81a71 (main)          230줄   ← 베이스와 diff 0
8020b71 (통합)          261줄   ← 168~225 구간을 들어내고 다시 씀
92e146e (표기 통일)     313줄   ← 파일 끝에 +83, 삭제 0 (순수 추가)
```
`f8c3918`은 **A조 커밋**이고 이미 `c697913`(PR #170 머지)에 들어 있다.
⇒ **갈래는 「통합 vs 표기 통일」 둘뿐이고, 표기 통일은 순수 추가라 기존 단정과 안 겹친다.**
남는 위험은 위 ⑧의 import 한 줄이다.

⚠️ 이 정정 자체가 교훈이다 — **A조 보고를 PM이 재지 않고 체크리스트에 옮겨 적었고,
B조가 재서 갈랐다.** 옮겨 적기 전에 한 번 세는 것이 비용이 훨씬 싸다.

# ⑩ 브랜치 팁 (병합 대상)

```
origin/fix/hint-contradicts-falsepos      7bdd738
origin/fix/nickname-uniqueness-writers    5cf90bd
origin/fix/notation-unify                 92e146e
origin/fix/mock-copy-parity-rest2         a6985d6
origin/docs/carryover-422-424             68821e5
```
A조 계열은 `origin/feat/expert-boards-atmos` 및 파생 — 착지 보고 시점의 팁으로 확정할 것.

⚠️ `a6985d6`의 `apiMockPlugin.js` **+266/−45**는 A조가 병합한 `fb7da06`에 **없다**.
`merge-tree` 실측 충돌 **2건**: `frontend/mock/apiMockPlugin.js` · `backend/tests/test_r13_mock_policy_parity.py`.
**「우리 것 + B조 266줄」로 손으로 합칠 것.**

---

# ⑪ 🔴 병합 필수 단계 — `ci.sh seed`가 **설계대로** 붉어진다

**`4a697cd`이 승격 되돌림 감시(lint ⑦)를 심어 놨고, 선지 편향 교정(`afdab80`, A조 계열)이
병합되는 순간 그 감시가 스스로 무장한다.**

## 왜 붉어지나

승격 스크립트 `backend/app/scripts/seed_content.py`의 멱등 키는
`(concept_tag, template_json->>'question_text')` **정확 일치**이고, UPDATE는
`existing.template_json = entry["template_json"]`로 **template_json을 통째로 덮는다** — **선지까지.**

선지 편향 교정은 **지문을 안 바꿨다**(선지만 고쳤다). ⇒ 키가 그대로라서 **staging을 다시
승격하면 옛 선지로 UPDATE된다.**

실측(워커): 겹침 **108건 / 18파일 / 선지 324줄**, 그 108건의 선지가 **108/108 전건 옛 값**
(정답 갈림 0건).

## ⇒ 병합자가 할 일 (순서 고정)

1. 병합 후 `python3 scripts/lint_seed_items.py --staging`을 돌린다.
2. **⑦이 「되돌림 108곳/18파일」로 붉어지면 그것이 정상**이다. 감시가 제 일을 한 것이다.
3. **⑦ 출력이 18파일 목록을 낸다.** 그 목록대로 `database/seed/staging/`의 해당 108건 선지를
   **본시드 값으로 갱신**한다.
4. 🔴 **방향을 절대 반대로 하지 마라 — 본시드가 정본이다.** staging 쪽을 정본으로 삼으면
   **교정이 사라진다.** 실패 메시지와 단정문에 그 방향이 자립형으로 박혀 있다.
5. 갱신 후 `measure_option_length_bias.py`가 **24~25% 대**를 유지하는지 재확인한다.

⚠️ **워커가 1번(staging 갱신)을 일부러 안 했다.** 그 브랜치에는 교정이 없어서
「지금 값 = 옛 값」이었고, 교정본 선지를 앞질러 써 넣는 것은 지시 없는 병합이라 멈췄다.
**옳은 판단이다** — 그 시점이 곧 이 병합이다.

⚠️ `seed_content.py`의 경고는 **멈추지 않는다**(정상 승격도 같은 120행을 바꾸므로).
경고 전용 층이고 실DB 실행 검증은 안 됐다 — **무른 층으로 알고 있을 것.**

## 곁가지 — 게이트 밖에 있는 두 파일

`au1_weather_items.json`·`au2_basic_science_items.json`이 `knowledge_level` 0건으로 **한시
제외** 중이라 ⑦ 외의 게이트에서 빠져 있다. 108건 중 **11건이 `au2`에** 있다 — ⑦은 그 둘까지
순회하도록 만들어져 있어서 잡히지만, **다른 게이트는 못 본다.**
