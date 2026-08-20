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
