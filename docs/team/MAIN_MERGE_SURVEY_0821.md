# main ↔ integ/rolling-0820 병합 실측 조사 — 2026-08-21

> 🔴 **이 문서는 조사 결과만이다. 병합·수정을 하지 않았고, 판정도 하지 않았다.**
> 판정이 필요한 자리는 **「판정 필요」**로 표시했다. 세션이 정하지 않는다.

---

## §0. 측정 기준 — 먼저 읽을 것

### 0.1 재는 명령 (전부 읽기 전용)

```sh
B=$(git merge-base origin/main origin/integ/rolling-0820)   # a88d63a
git rev-list --count origin/main..origin/integ/rolling-0820
git rev-list --count origin/integ/rolling-0820..origin/main
git merge-tree --write-tree --name-only origin/integ/rolling-0820 origin/main
git merge-tree --write-tree --name-only HEAD origin/main     # 로컬 미푸시분 포함
```

### 0.2 지시문의 수치는 낡았다 — 실측이 다르다

| 항목 | 지시문 | 실측(2026-08-21) | 재는 명령 |
|---|---|---|---|
| main → integ 앞선 커밋 | 206 | **213** (로컬 HEAD 기준 **216**) | `git rev-list --count origin/main..origin/integ/rolling-0820` |
| integ → main 앞선 커밋 | 36 | **38** (병합 16 + 비병합 22) | `git rev-list --count origin/integ/rolling-0820..origin/main` |
| 겹치는 파일 | 37 | **25** (양쪽이 **둘 다** 만진 파일) / main이 만진 파일 총계가 **37** | `comm -12 <(git diff --name-only $B origin/main\|sort) <(git diff --name-only $B origin/integ/rolling-0820\|sort)` |
| main 쪽 줄 수 | 1,818 추가 | **1,920 추가 · 370 삭제 · 37파일** | `git diff --shortstat $B origin/main` |
| integ 쪽 줄 수 | — | **19,930 추가 · 3,036 삭제 · 156파일** | `git diff --shortstat $B HEAD` |

「겹치는 파일 37개」는 **main이 만진 파일 총수**(37)와 **양쪽이 겹친 파일 수**(25)가 섞인 값으로 보인다.

### 0.3 🔴 기준점이 셋이다 — 어느 것으로 재느냐에 따라 충돌이 달라진다

| 기준 | 충돌 파일 | 비고 |
|---|---|---|
| `origin/integ/rolling-0820` × `origin/main` | **13** | 지시문이 전제한 기준 |
| **로컬 `HEAD`** × `origin/main` | **14** | `frontend/package.json`이 **추가로 충돌**한다 |
| 워킹트리(미커밋 4인분 포함) | **측정 불가** | 아래 0.4 |

로컬 `HEAD`(`0bc46db`)는 `origin/integ/rolling-0820`(`8020b71`)보다 **3커밋 앞서 있고 아직 푸시되지 않았다**:

```
0bc46db feat(detective): 서버가 주는 XP를 화면이 말하게 한다 — 0은 그리지 않는다
04b24b7 i18n(MT-22): 모식도 3종의 화면 문자열을 리소스로 — 값은 한 글자도 안 바꿨다
4adf7d1 docs(proposal): 제안서 조항 4건 대응표
```

### 0.4 🔴 미커밋 4인분이 main이 만진 파일과 **4개 겹친다**

```sh
comm -12 <(git status --porcelain | awk '{print $NF}' | sort) <(git diff --name-only $B origin/main | sort)
```

| 겹친 파일 | 상태 | 왜 위험한가 |
|---|---|---|
| `frontend/package.json` | `MM`(스테이지+워킹) | main도 `test:hindcast` 한 줄을 **같은 자리**에 넣는다 → §1 표의 충돌 1건이 여기서 더 커진다 |
| `frontend/src/i18n/resources/board.en.js` | ` M` | main이 `heroTitle` 추가 · integ가 `disclaimer` 매개변수화 → **이미 충돌 자리** |
| `frontend/src/i18n/resources/board.ko.js` | ` M` | 동상 |
| `scripts/ci.sh` | `M ` | `FRONT_TESTS` 배열 — §5 |

⇒ **병합 시점에 수치는 또 달라진다.** 이 문서의 표는 **2026-08-21 측정 시점의 스냅샷**이고,
**작업자 넷이 커밋·푸시한 뒤 §0.1의 명령을 다시 돌려야** 한다.

---

## §1. 충돌 실측 — `git merge-tree` 3-way 결과

기준: `git merge-tree --write-tree --name-only HEAD origin/main` → 트리 `2cb266f`
(참고: `origin/integ` 기준은 트리 `4f9059d`, package.json 1건만 빠진다)

| # | 파일 | 충돌 종류 | 헝크 | integ 쪽이 한 것 | main 쪽이 한 것 | 해소 계급 |
|---|---|---|---|---|---|---|
| 1 | `frontend/package.json:43-47` | 내용 | **1** | `test:detective-xp` 추가 | `test:hindcast` 추가 | **기계적 합집합**(§2 판정에 따라 후자 제외) |
| 2 | `frontend/src/i18n/resources/board.en.js:700-707` | 내용 | **1** | `disclaimer`에 `{sens}` 보간 | `heroTitle` 신규 키 + `disclaimer`에 `3.0` 상수 | **기계적 합집합**(integ의 disclaimer + main의 heroTitle) |
| 3 | `frontend/src/i18n/resources/board.ko.js:704-711` | 내용 | **1** | 동상 | 동상 | 동상 |
| 4 | `frontend/src/i18n/resources/hindcast.en.js` | **modify/delete** | 0 | **파일 삭제**(74줄) | +3줄 | **판정 필요 §2** |
| 5 | `frontend/src/i18n/resources/hindcast.ko.js` | **modify/delete** | 0 | **파일 삭제**(86줄) | +5줄 | **판정 필요 §2** |
| 6 | `frontend/src/modules/explore/ClimateSimPage.jsx` | 내용 | **4** | 모식도 배선 + 조작 변수 3 + `{sens}` | 2열/3판 레이아웃 + HeroBanner + 고지 이동 | 🔴 **손 병합** §6 |
| 7 | `frontend/src/modules/explore/TyphoonSimPage.jsx` | 내용 | **1** | `SchematicPanel` 2종 삽입 | 위성도식↔해설 1.9:1 2열 | 🔴 **손 병합** §6 |
| 8 | `frontend/src/modules/hindcast/CaseListPage.jsx` | **modify/delete** | 0 | **파일 삭제**(114줄) | +32/-8 | **판정 필요 §2** |
| 9 | `frontend/src/modules/hindcast/CasePlayPage.jsx` | **modify/delete** | 0 | **파일 삭제**(177줄) | +107/-46 | **판정 필요 §2** |
| 10 | `frontend/src/modules/hindcast/DemoDataNotice.jsx` | **modify/delete** | 0 | **파일 삭제**(30줄) | +20/-1 | **판정 필요 §2** |
| 11 | `frontend/src/modules/progress/ProgressPage.jsx` | 내용 | **2** | 수준·목표 피커 **삭제**(클라이언트 지시) | 그 둘을 **감싸는 꼬리 2열** 신설 | 🔴 **판정 필요 §4** |
| 12 | `frontend/tests/exploreSims.render.test.mjs` | 내용 | **1** | ⑬ 계약 77줄 말미 추가 | 2열 레이아웃 계약 176줄 말미 추가 | **기계적 합집합**(단 §6이 먼저 서야 통과) |
| 13 | `frontend/tests/uiCopy.contract.test.mjs` | 내용 | **1** | 거짓 약속 제거 계약 84줄 말미 | 화면 간 어긋남 계약 53줄 말미 | **기계적 합집합** |
| 14 | `scripts/ci.sh:228-234` | 내용 | **1** | 종목 4종 추가 + FU-18 갈래 판별 | 종목 `hindcast` 1종 추가 | **합집합 §5** |

**합계: 충돌 파일 14 · 내용 충돌 헝크 14 · modify/delete 5.**

헝크 수를 재는 명령:
```sh
T2=2cb266fe79bbb12190be8424270555b59e45700a
for f in $(sed -n '2,15p' /tmp/mt2.txt); do echo "$(git show "$T2:$f" | grep -c '^<<<<<<<')  $f"; done
```

### 1.1 자동 병합되는 겹침 11건 (충돌 없음 — 그러나 §3을 읽을 것)

`frontend/src/i18n/resources/{detective.en,detective.ko,en,ko}.js` ·
`frontend/src/modules/curriculum/LearnHeroCard.jsx` ·
`frontend/src/modules/explore/SatelliteView.jsx` ·
`frontend/src/modules/progress/{AbilityRadar,WeatherBrainPanel}.jsx` ·
`frontend/tests/{detective.smoke,home.smoke,mascotAssets.contract}.test.mjs`

- `LearnHeroCard.jsx` — **양쪽이 다 산다**(실측): 병합 결과 `:79`에 main의 `py-7`, `:125`에 integ의 `to="/onboarding/placement"`. 서로 다른 줄이라 충돌 없음.
- 나머지는 §3의 지뢰 3건을 포함한다.

### 1.2 main이 새로 만든 파일 2건 (integ에 없어 그대로 들어온다)

| 파일 | 줄 | 성격 |
|---|---|---|
| `frontend/tests/helpers/sourceScan.mjs` | 25 | **테스트 아님**(`*.test.mjs`가 아니라 `FRONT_TESTS`가 안 집는다). 주석을 걷고 소스를 훑는 공용 도구 — hindcast와 무관하게 유용 |
| `frontend/tests/hindcast.smoke.test.mjs` | 170 | **hindcast 전용** — §2·§3 |

---

## §2. 🔴 ⓐ hindcast(과거 예보) — 양쪽 장부

### 2.1 우리가 지운 것

`83c28da revert(hindcast): 과거 예보(MT-30) 전면 삭제 — 클라이언트 지시 집행`
**21파일 · 66 삽입 · 2,256 삭제** (`git show --shortstat --format= 83c28da`)

프런트 8파일(`modules/hindcast/*` 5 · `api/hindcast.js` · i18n 2) +
백엔드 6파일(`routers/hindcast.py` 231 · `services/hindcast_service.py` 253 · `schemas` 107 · `models` 67 · 테스트 2본 800) +
참조 6자리(`App.jsx` · `main.py` · `models/__init__.py` · `i18n/core.js` · `ExploreHome.jsx` · `mock/apiMockPlugin.js`)

### 2.2 main이 hindcast에 **추가한 것 전건**

```sh
git diff --numstat $B origin/main -- 'frontend/src/modules/hindcast/*' 'frontend/src/i18n/resources/hindcast*' frontend/tests/hindcast.smoke.test.mjs
```

| 파일 | +/− | 무엇 |
|---|---|---|
| `frontend/src/modules/hindcast/CasePlayPage.jsx` | **+107 / −46** | 회차 카드 **2열** · **판정 뒤 입력 잠금** |
| `frontend/src/modules/hindcast/CaseListPage.jsx` | **+32 / −8** | 목록 **3열** + 상단 튜터 카드(HeroBanner) |
| `frontend/src/modules/hindcast/DemoDataNotice.jsx` | **+20 / −1** | 데모 데이터 고지 개편 |
| `frontend/src/i18n/resources/hindcast.ko.js` | +5 / 0 | 잠금·2열 문안 + 배너 키 |
| `frontend/src/i18n/resources/hindcast.en.js` | +3 / 0 | 동상 |
| `frontend/tests/hindcast.smoke.test.mjs` | **+170 / 0**(신규) | 위 셋의 계약 |
| `frontend/package.json:39` | +1 | `"test:hindcast": "node tests/hindcast.smoke.test.mjs"` |
| `scripts/ci.sh:220` | +1 | `FRONT_TESTS`에 `hindcast` |

**hindcast 소계: 신규·수정 337줄 + 테스트 170줄 + 배선 2줄.**
커밋은 **`70d9c57` 1건 전체 + `a5fd1aa` 일부**.

### 2.3 🔴 `a5fd1aa`를 가른다 — hindcast만 버리고 나머지를 살릴 수 있는가

`a5fd1aa feat(explore,detective,hindcast): 실험실 5종에 상단 튜터 카드` — **13파일 161+/35−**

| hindcast인가 | 파일 | +/− |
|---|---|---|
| ❌ 아니다 | `frontend/src/components/SideNav.jsx` | +18 |
| ❌ 아니다 | `frontend/src/components/Layout.jsx` | +7 |
| ❌ 아니다 | `frontend/tests/mascotAssets.contract.test.mjs` | +40 / −1 |
| ❌ 아니다 | `frontend/src/modules/explore/ClimateSimPage.jsx` | +26 / −11 |
| ❌ 아니다 | `frontend/src/modules/explore/TyphoonSimPage.jsx` | +22 / −9 |
| ❌ 아니다 | `frontend/src/modules/detective/CaseListPage.jsx` | +19 / −7 |
| ❌ 아니다 | `frontend/src/i18n/resources/board.{en,ko}.js` | +2 / +5 |
| ❌ 아니다 | `frontend/src/i18n/resources/detective.{en,ko}.js` | +1 / +1 |
| ✅ **hindcast** | `frontend/src/modules/hindcast/CaseListPage.jsx` | +18 / −7 |
| ✅ **hindcast** | `frontend/src/i18n/resources/hindcast.{en,ko}.js` | +1 / +1 |

**답: 가른다.** hindcast 몫은 **20줄(전체 161줄의 12%)**뿐이고, 그 20줄은 전부
hindcast 자기 파일 안에 있다. **나머지 141줄은 hindcast 파일을 하나도 건드리지 않는다.**

단, **`a5fd1aa`가 hindcast를 "밖에서" 언급한 자리가 3곳** 있고 이것들은 hindcast 파일이 아니라서
**충돌 없이 자동으로 들어온다** — §3의 지뢰다:

| 좌표 | 내용 |
|---|---|
| `frontend/src/components/Layout.jsx:80` | `\|\| pathname.startsWith('/hindcast')` — 넓은 셸 판정 |
| `frontend/src/components/SideNav.jsx:57` | `{ match: (p) => p === '/hindcast' \|\| p.startsWith('/hindcast/'), name: 'rainbow', key: 'hindcast' }` |
| `frontend/tests/mascotAssets.contract.test.mjs:350` | `['/hindcast', 'src/modules/hindcast/CaseListPage.jsx']` — **`readFileSync`한다** |

`70d9c57`은 반대다: 8파일 중 6이 hindcast 자기 파일이고, 나머지 둘(`package.json` +1 · `ci.sh` +1)도
hindcast를 배선하는 줄뿐이다 ⇒ **`70d9c57`은 통째로 뗄 수 있다.**

### 2.4 🔴 양쪽 장부 — **판정 필요**

#### ⓐ-1 삭제를 유지하면 잃는 것

| 잃는 것 | 실측 |
|---|---|
| main이 하루 동안 만든 hindcast 개선 | **337줄**(2열·잠금·3열·고지) + 계약 **170줄** |
| main 작업자의 그날치 결과물 1건 | `70d9c57` 커밋 전체가 무효가 된다 |
| `a5fd1aa`의 hindcast 몫 | **20줄** |
| — | **`a5fd1aa`의 나머지 141줄은 잃지 않는다**(§2.3) |
| 추가로 **손으로 걷어야 할 자리 6곳** | Layout.jsx:80 · SideNav.jsx:57 · mascotAssets:350 · package.json:39 · ci.sh:220 · `tests/hindcast.smoke.test.mjs`(파일) — **걷지 않으면 §3의 3건이 CI를 붉힌다** |
| `git rm` 해야 할 modify/delete 5건 | `hindcast.{en,ko}.js` · `modules/hindcast/{CaseListPage,CasePlayPage,DemoDataNotice}.jsx` |

#### ⓐ-2 되살리면 되돌리는 것

| 되돌리는 것 | 실측 |
|---|---|
| **클라이언트 지시의 집행 그 자체** | `83c28da`가 "클라이언트 지시 집행"으로 커밋돼 있다 — 되살림 = **지시 불이행** |
| 되살릴 코드 총량 | **21파일 · 2,256줄** (백엔드 라우터·서비스·스키마·모델·테스트 1,458줄 포함) |
| 다시 배선할 참조 | `App.jsx` 라우트 3줄 · `main.py` 2줄 · `models/__init__.py` 2줄 · `i18n/core.js` 7줄 · `ExploreHome.jsx` 19줄 · `mock/apiMockPlugin.js` 123줄 |
| 되돌아오는 CI 부담 | 백엔드 테스트 2본(`test_hindcast_router.py` 619 · `test_hindcast_mock_parity.py` 181) |
| 문서 되돌림 | `docs/team/CARRYOVER_R13.md`에 `83c28da`가 남긴 58줄의 삭제 기록 |

> 🔴 **판정 필요 ①: hindcast 존폐.** 세션은 정하지 않는다.
> 부분해(예: 프런트만 되살리기)는 **불가능**하다 — `CasePlayPage.jsx`가 `api/hindcast.js`를 거쳐
> 삭제된 `routers/hindcast.py`를 부른다. 되살리면 백엔드까지 한 덩어리다.

---

## §3. 🔴 조용한 지뢰 — merge-tree가 **깨끗하다고 보고하는데 CI가 붉어지는 것**

이 절이 이 문서에서 가장 값이 나가는 자리다. 아래 넷은 **충돌로 잡히지 않는다.**

### 3.1 `mascotAssets.contract.test.mjs` — 없는 파일을 `readFileSync` 한다

좌표: 병합 결과 `frontend/tests/mascotAssets.contract.test.mjs:350`

```js
['/hindcast', 'src/modules/hindcast/CaseListPage.jsx'],
...
const src = readFileSync(join(ROOT, file), 'utf8');   // ← 삭제된 파일 → throw
```

`test:mascot`은 **양쪽 `FRONT_TESTS`에 다 있다**. hindcast 삭제를 유지하면 이 종목은 **단정 실패가 아니라 죽는다**
(integ의 FU-18 갈래 판별에서 `nostart`/죽음으로 뜬다).
같은 블록 `:376+`의 ⓔ(Layout.isWide 검사)도 `banners` 목록을 그대로 돈다.

### 3.2 `home.smoke.test.mjs` — main이 덧붙인 227줄이 **integ가 지운 컴포넌트를 문다**

좌표: 병합 결과 `frontend/tests/home.smoke.test.mjs`의 말미 블록
`// ── /me 꼬리 설정 묶음도 **2열**이다 (2026-08-20)`

```js
const inside = ['<SaveProgressCard />', '<LevelGroupCard />', '<DailyGoalPicker'].filter(...)
ok(inside.length === 3, `ⓕ 꼬리 설정 셋이 모두 2열 격자 안에 있다 — 실제 ${inside.length}/3`);
```

`<LevelGroupCard />`와 `<DailyGoalPicker`는 **integ가 `ac539e2`에서 클라이언트 지시로 지운 것**이다
(`ProgressPage.jsx` HEAD `:299` — *"`LevelGroupCard`와 `LEVEL_GROUPS`를 2026-08-19에 **통째로 지웠다**"*).
main 추가분 중 이 계열 단정이 **21줄**이다(`git diff $B origin/main -- frontend/tests/home.smoke.test.mjs | grep -E '^\+' | grep -cE '학습 수준|LevelGroup|daily-goal|하루 목표|꼬리'`).
**이 파일은 충돌하지 않는다** — main은 `:35`·`:524`·`:559`·`:601+`, integ는 `:161`·`:420` 자리라 3-way가 깨끗이 합친다.
⇒ **병합 직후 `test:home`이 붉어진다.** §4의 판정 없이는 못 고친다.

### 3.3 `package.json` + `ci.sh`가 **없는 테스트 파일을 가리킨다**

`test:hindcast` → `tests/hindcast.smoke.test.mjs`. 파일 자체는 main이 신규로 들여오므로 **존재는 한다.**
그러나 그 170줄이 읽는 `src/modules/hindcast/*`가 없으면 **역시 죽는다**.
`ci.sh`의 `hindcast` 종목을 합집합에 남기면 **확실히 붉다**(§5).

### 3.4 미커밋 파일을 소스 스캔하는 계약 — `detective.smoke.test.mjs`

main이 `detective.smoke.test.mjs`에 **+130줄**을 덧붙였고(`e77ab2d`·`bea4187`·`7c4dacd`·`472fb91`),
그중 일부가 `frontend/src/modules/detective/CasePlayPage.jsx`를 소스로 훑는다
(예: `play.split('\n').find((l) => l.includes('aria-labelledby="detective-hypotheses"') && l.includes('<section'))`).
그 파일은 **지금 워킹트리에서 미커밋 수정 중**(탐정 XP)이다.
main의 단정은 **문구가 아니라 레이아웃 구조**를 물므로 integ의 `58fff95`(문구 「재구성」)와는 **직교한다** — 그쪽은 안전.
다만 **탐정 XP 미커밋분이 그 `<section>` 구조를 건드렸다면** 붉어진다. ⇒ 커밋 후 재확인 대상.

---

## §4. 🔴 ⓑ `home.smoke.test.mjs` / ProgressPage — 같은 자리인가

### 4.1 `home.smoke.test.mjs` — **같은 자리를 고치지 않았다**

```sh
git diff $B origin/main -- frontend/tests/home.smoke.test.mjs   # 4 헝크: @@35 @@524 @@559 @@601(+227)
git diff $B origin/integ/rolling-0820 -- frontend/tests/home.smoke.test.mjs  # 2 헝크: @@161 @@420
```

| 쪽 | 자리 | 무엇 |
|---|---|---|
| integ | `:161-186` | ⑫-b 복귀 화면 경유로 계약 수정(`96e72c7`) |
| integ | `:420-445` | 하루 목표 기대값을 `DAILY_GOAL_CHOICES`에서 읽음 — 「9→10」 하드코딩 제거(`157534e`) |
| main | `:35` · `:524-539` · `:559-584` | import + /me 열 카드 |
| main | `:601-828` (**+227**) | 학습 튜터 py-7 · /me 열 제목 · /me 두 열 바닥 정렬 · **/me 꼬리 2열** |

**⇒ 충돌 0. 자동 병합된다.** 지시문이 우려한 「하루 목표 앵커 3건 → `/onboarding/placement`」와
main의 변경은 **다른 줄**이고, `LearnHeroCard.jsx`도 §1.1대로 양쪽이 다 산다.
**진짜 문제는 텍스트 충돌이 아니라 §3.2의 의미 충돌**이다.

### 4.2 `ProgressPage.jsx` — 클라이언트 지시 둘이 서로를 지운다 (**판정 필요**)

충돌 2헝크: `:314-389` · `:558-632`(병합 트리 좌표)

**integ 쪽** — `HEAD:frontend/src/modules/progress/ProgressPage.jsx:277-296` (커밋 `ac539e2`):
> 🔴 **학습 수준 카드와 하루 목표 피커를 여기서 걷었다**(2026-08-19 · 클라이언트 지시).
> 원문: *"시작 시점에서 목표량과 수준을 물어야 하는데 그것도 없어, 즉 내정보란에는
> 목표선정과 수준 선택이 필요없어 첫 배치고사 시점 제외"*

`HEAD:...:299` — *"`LevelGroupCard`와 `LEVEL_GROUPS`를 2026-08-19에 **통째로 지웠다**"* (252줄 개작)

**main 쪽** — `origin/main:frontend/src/modules/progress/ProgressPage.jsx:334-352` (커밋 `ba21e53`·`ea28b5a`):
> 오른쪽 열 — 설정 둘. … 그 차이를 **학습 수준 카드가 먹는다**(`LevelGroupCard`의 `flex-1`).
> 하루 목표는 그대로 둔다(**2026-08-20 사용자 지시**)
> … 이 화면이 목표를 정하는 **유일한 통로**다.

**결정자에게 넘길 사실 3건(판정 아님):**

1. main의 근거 *"유일한 통로"*는 **integ에서 이미 성립하지 않는다** — `LearnHeroCard.jsx:125`의
   「목표 미설정」 링크가 `to="/onboarding/placement"`로 옮겨졌다(integ). main은 그 링크가 아직
   `/me#daily-goal`이던 시점의 화면을 다듬었다.
2. integ의 삭제 주석 스스로가 **잃는 것 둘을 명시**해 뒀다(`HEAD:...:286-291`):
   ⑴ 배치고사를 건너뛴 사람은 하루 목표를 정할 데가 없다 ⑵ 「목표 미설정」 링크의 앵커가 사라진다.
   ⑵는 그 뒤 `/onboarding/placement`로 해소됐고, **⑴은 열려 있다**.
3. integ 쪽에 이 삭제를 **계약으로 고정한 테스트**가 있다 — `uiCopy.contract.test.mjs`의
   `⑸ 진입 안내가 「내 정보에서 바꿀 수 있다」고 말하지 않는다`(2026-08-20 클라이언트 판정,
   *"진입에서 한 번 고르면 고정이야" ⇒ `/me`의 학습 수준 카드는 되살리지 않는다"*).
   **main의 ProgressPage를 채택하면 이 계약과 정면으로 부딪친다.**

| 선택 | 잃는 것 |
|---|---|
| **integ 쪽 유지** | main의 `ba21e53`·`ea28b5a`·`44b6e8c` 3커밋(190줄) 사장 · §3.2로 `test:home`이 붉음(main 단정 21줄을 걷어야 함) |
| **main 쪽 채택** | 2026-08-19·08-20 클라이언트 삭제 지시 되돌림 · `uiCopy` ⑸ 계약 위반 · `ac539e2` 252줄 개작 되돌림 |
| **혼합**(꼬리 2열 골격만 살리고 카드 둘은 제외) | 격자가 `SaveProgressCard` 하나만 담는 1열이 된다 — main의 `ⓕ …3/3` 단정은 어차피 못 지킨다 |

> 🔴 **판정 필요 ②: `/me` 꼬리 — 학습 수준 카드·하루 목표 피커의 존폐.**

---

## §5. 🔴 ⓒ `scripts/ci.sh` — `FRONT_TESTS` 종목 대조

충돌 1헝크 (`:228-234`). 재는 명령:
```sh
for r in origin/main origin/integ/rolling-0820; do git show "$r:scripts/ci.sh" | grep -n '^FRONT_TESTS='; done
```

### 5.1 양쪽 종목

**main(`:220`)** — 33종. 베이스에서 **`hindcast` 1종만 추가**.

**integ(`:228-231`)** — 36종. 베이스에서 **4종 추가**: `load-progress` · `placement-skip` · `schematic` · `error-boundary`.
추가로 `step_frontend()`를 **FU-18 갈래 판별**(`scripts/lib/test_outcome.sh`)로 개작 —
「단정이 틀렸다 / 안 돌았다 / 죽었다」를 갈라 적는다. 이 개작은 **충돌 밖**(별도 헝크, 자동 병합)이다.

### 5.2 🔴 합집합 — **37종** (사라지면 안 되는 목록)

```
explore explore-goals session session-blocks entry-flow load-progress placement placement-skip
visual gating board-entry assist webgl schematic overlay display-parity i18n ui-copy course-select
guest-convert review-queue region learn-path home home-entry mascot duel hint-character
session-retry detective hindcast knowledge-level onboarding-save guide-bot guide-bot-3d
session-expiry error-boundary
```

| 종목 | 한쪽에만 | 사라지면 |
|---|---|---|
| `load-progress` | integ만 | 진도 불러오기 진입점 계약이 영구히 안 돎 |
| `placement-skip` | integ만 | 「모르겠어요」 센티널·전건 스킵 계약이 안 돎 |
| `schematic` | integ만 | MT-22 모식도 계약이 안 돎 |
| `error-boundary` | integ만 | §4.31 백지 화면 방지 계약이 안 돎 |
| **`hindcast`** | main만 | — **§2 판정에 종속** |

> ⚠️ **`hindcast`를 합집합에 그냥 넣으면 안 된다.** hindcast 삭제를 유지한 채 종목을 남기면
> `test:hindcast`가 **확실히 죽는다**(§3.3). ⇒ **판정 필요 ③: `ci.sh`의 `hindcast` 종목 —
> §2 판정이 「삭제 유지」면 이 줄과 `package.json:39`도 함께 걷어야 한다.**

### 5.3 미커밋분

`scripts/ci.sh`는 **워킹트리에서 스테이지된 수정 상태**(`M `)다. 위 목록은 `origin/*` 기준이므로
**작업자가 커밋한 뒤 `FRONT_TESTS`를 다시 뽑아 대조해야 한다.**

---

## §6. 🔴 손 병합이 필요한 둘 — ClimateSimPage · TyphoonSimPage

두 파일은 **양쪽 테스트가 둘 다 붙는다**(§1 #12: `exploreSims.render.test.mjs`가 합집합).
⇒ **손 병합 결과가 main의 레이아웃 단정과 integ의 ⑬ 단정을 동시에 만족해야 한다.**

### 6.1 `ClimateSimPage.jsx` — 4헝크

| 헝크 | integ | main | 비고 |
|---|---|---|---|
| `:21-27` | `import SchematicPanel` + `RADIATION_SCENE/STEPS` | `import HeroBanner` | **둘 다 필요** — 합집합 |
| `:244-294` | 고지 `<p>`에 `t('explore.climate.disclaimer', { sens })` | 고지를 **배너 밖 위쪽 줄**로(`flex-wrap` + `sm:text-right`), 배너 `right=` 칩 | 자리는 main·**내용(보간)은 integ** |
| `:342-462` | 모식도 패널 배선(81줄) | **3판 2열 레이아웃**(39줄) | 🔴 가장 큰 자리 |
| `:499-505` | `onClick={resetAll}` · `py-1.5` | `onClick={() => setCo2(CO2_PRESENT_DAY)}` · `py-2` | **판정 필요 ④** |

**🔴 실측 경고 — 슬라이더가 2개 줄어들 수 있다:**
```sh
git show HEAD:frontend/src/modules/explore/ClimateSimPage.jsx | grep -c 'type="range"'        # 3
git show origin/main:frontend/src/modules/explore/ClimateSimPage.jsx | grep -c 'type="range"'  # 1
```
main의 ClimateSimPage에는 `type="range"`가 **1개**뿐이고 integ에는 **3개**다(⑬ 조작 변수 확대).
**충돌 헝크 3을 main 쪽으로 통째로 받으면 조작 변수 2건이 사라진다.**

`:499` 헝크: integ의 `resetAll`은 **민감도·해수면 계수까지 되돌리는 함수**로,
민감도가 조작 변수가 된 뒤(`53059bb`) 생겼다. main의 `setCo2(CO2_PRESENT_DAY)`는 CO₂만 되돌린다.
**의미상 integ 쪽이 새 상태에 맞지만 — 판정 필요 ④(세션이 정하지 않는다).**

### 6.2 `TyphoonSimPage.jsx` — 1헝크 (`:361-419`)

| integ | main |
|---|---|
| `<SchematicPanel>` 2종(태풍 단면 · 태풍의 일생) 삽입 + 발달 곡선 카드 | 위성도식↔「왜 그럴까」 **1.9 : 1 2열 격자**(`lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]`) |

integ 주석이 스스로 밝힌 원칙: *"기존 시각화를 **하나도 걷어내지 않고 뒤에 덧붙인다**"*
⇒ **구조적으로는 양립 가능**(main의 2열 격자 뒤에 integ의 패널 2종을 잇는 꼴).
다만 main의 계약이 `SatelliteView`와 해설이 **같은 격자의 직계 자식**일 것을 요구하므로
(`exploreSims.render.test.mjs` main 블록 ⓒ) 삽입 위치를 격자 **밖**으로 두어야 한다.

### 6.3 두 테스트 블록이 동시에 요구하는 것

| 출처 | 요구 |
|---|---|
| main 블록(`exploreSims.render.test.mjs:308-483`) | 기후: 곡선↔오른쪽 열이 격자 직계 자식 · 목표/왜/CTA는 격자 밖 · 곡선에 고정 높이 없음 · 고지가 **배너 밖**이고 화면에 **한 번만** · `GoalPanel` 제목 `text-base` |
| integ 블록(`:230-306`) | 곡선 `useMemo` 의존성이 조작 변수를 문다 · `seaNote`가 `{k}` 보간 · **`disclaimer` 호출부가 `{ sens: … }`를 넘긴다** |

⇒ **고지(`disclaimer`)는 main의 자리 + integ의 보간**이라야 둘 다 통과한다. §1 #2·#3의 board i18n
합집합(integ의 `{sens}` disclaimer + main의 `heroTitle`)과 **짝이다.**

---

## §7. main 쪽 38커밋 — 덩어리별 (비병합 22 + 병합 16)

```sh
git log --oneline --no-merges $B..origin/main   # 22
git log --oneline --merges   $B..origin/main   # 16 (PR #156~#171)
```

| # | 덩어리 | 커밋 | 우리와 겹치나 |
|---|---|---|---|
| A | **explore 실험실 레이아웃** — 2열/3판 · 고지 자리 4회 이동 · 위성도식 1.35→1.9 · 상단 튜터 카드 | 10 (`a5fd1aa` `03f86e3` `bbc4a30` `cf70c36` `1621046` `12dfa24` `ba0d1d2` `5916668` `2f11305` `b11c537`) | 🔴 **정면 충돌** — §6 (ClimateSim 4헝크 · TyphoonSim 1헝크 · exploreSims 1헝크 · board i18n 2헝크) |
| B | **`/me` 내 정보 개편** — 두 열 바닥 정렬 · 꼬리 2열 · 레이더 점선 자리 | 4 (`44b6e8c` `ba21e53` `2925814` `ea28b5a`) | 🔴 **정면 충돌** — §4.2 (ProgressPage 2헝크) + §3.2 (home.smoke 조용한 지뢰) |
| C | **기후 탐정** — 2열 사건 게시판 · 추리 보기 2×2 · 차트 되그림 정지 | 4 (`472fb91` `7c4dacd` `bea4187` `e77ab2d`) | 🟡 **부분** — 파일은 안 겹침(main만 `detective/CaseListPage.jsx`·`CaseChart.jsx`). `detective.smoke.test.mjs`는 자동 병합. **미커밋 탐정 XP와 §3.4** |
| D | **hindcast 확장** | 1 (`70d9c57`) + `a5fd1aa`의 20줄 | 🔴 **§2 — 판정 필요 ①** |
| E | **학습 튜터 카드 여백** py-5→6→7 | 2 (`a3d867a` `fa5957f`) | 🟢 **안전** — `LearnHeroCard.jsx` 자동 병합, `py-7`·`/onboarding/placement` 양쪽 다 산다(§1.1) |
| F | **화면 간 어긋남 3건** — 바깥 여백 `pt-2` · 뒤로가기 링크 표준형 · 카드 제목 크기 | 1 (`f8c3918`) | 🟡 `uiCopy.contract.test.mjs` 1헝크(합집합) · ClimateSim/TyphoonSim/ProgressPage에도 걸침 |

---

## §8. ④ 우리가 오늘 닫은 것 × main이 되돌릴 위험 — 대조표

| 우리 작업 | 커밋/상태 | main이 만진 파일과 겹치나 | 위험 |
|---|---|---|---|
| **과거 예보 삭제** | `83c28da` | 🔴 `modules/hindcast/*` 3 · `hindcast.{en,ko}.js` · `package.json` · `ci.sh` | 🔴 **최고** — §2. modify/delete 5건 + 밖의 참조 3곳이 자동 유입 |
| **해설 37판(board 64/64)** | `89262d7` `086cc49` + `b3e3b22` | 🟡 `board.{en,ko}.js`만(각 1헝크) | 🟢 **낮음** — 충돌은 `explore.climate.disclaimer`/`heroTitle` 한 자리뿐. **해설 본문(`database/seed/board_puzzles*`)은 main이 안 건드렸다** |
| **에러 바운더리** | `7a3b426` | `App.jsx` **미접촉** · `ci.sh` 종목 `error-boundary` | 🟡 **중** — §5 합집합에서 종목이 빠지면 계약이 안 돈다 |
| **슬라이더 6건**(⑬ 조작 변수: 기후 3 · 태풍 3) | `f0f5fff` `53059bb` `3675196` `2381d20` | 🔴 `ClimateSimPage.jsx` · `TyphoonSimPage.jsx` · `SatelliteView.jsx` · `exploreSims.render.test.mjs` · board i18n | 🔴 **높음** — §6.1 실측: main의 ClimateSimPage는 `type="range"` **1개**, 우리는 **3개**. 잘못 받으면 2건 소실 |
| **탐정 XP** | `0bc46db`(로컬 미푸시) + 미커밋(`api/detective.js`·`detective.{en,ko}.js`·`CasePlayPage.jsx`·`detectiveXp.smoke.test.mjs`) | 🟡 `package.json`(충돌) · `detective.{en,ko}.js`(자동) | 🟡 **중** — `test:detective-xp` vs `test:hindcast`가 `package.json:43` **같은 줄**에 들어간다(§1 #1). §3.4도 |
| **MT-22 i18n 외부화** | `04b24b7`(로컬 미푸시) | 🔴 `ClimateSimPage.jsx` · `TyphoonSimPage.jsx` · board i18n | 🔴 **높음** — §6. 라벨 문자열을 리소스로 뺐으므로 손 병합에서 main의 인라인 문자열을 그대로 받으면 되돌아간다 |
| **P-N→FU-N 개칭** | `8020b71` | `ci.sh` 주석부(충돌 밖) · `CARRYOVER_R13.md`(main 미접촉) | 🟢 **없음** |
| **`explore` 4열** | `9a26a37` | `ExploreHome.jsx` — **main이 안 건드렸다**(`git diff --name-only $B origin/main \| grep ExploreHome` → 0건) | 🟢 **없음** |

---

## §9. 권고 병합 순서

> 각 단계의 **「확인」**을 통과하지 못하면 다음으로 가지 않는다.
> **판정 필요** 표시가 붙은 단계는 **클라이언트/PM 판정 전까지 착수하지 않는다.**

### 0단계 — 전제: 워킹트리를 비운다 (**병합 전 필수**)
작업자 넷이 미커밋분을 커밋·푸시한다. **그 전에는 병합을 시작하지 않는다.**
- 확인: `git status --porcelain`이 비었다.
- 확인: 로컬 3커밋(`4adf7d1` `04b24b7` `0bc46db`)이 `origin/integ/rolling-0820`에 올라갔다.

### 1단계 — 재측정 (**이 문서의 수치는 스냅샷이다**)
```sh
B=$(git merge-base origin/main origin/integ/rolling-0820)
git merge-tree --write-tree --name-only origin/integ/rolling-0820 origin/main
```
- 확인: 충돌 파일 목록이 §1의 14건과 같은가. **늘었으면 늘어난 파일을 이 문서에 추가한다.**
- 확인: `ci.sh`의 `FRONT_TESTS`를 커밋 후 상태로 다시 뽑아 §5.2 합집합을 갱신한다.

### 2단계 — 🔴 **판정 3건을 먼저 받는다**
| 판정 | 절 |
|---|---|
| ① hindcast 존폐 | §2.4 |
| ② `/me` 꼬리 — 학습 수준·하루 목표 카드 존폐 | §4.2 |
| ③ `ci.sh`의 `hindcast` 종목 (①에 종속) | §5.2 |
| ④ ClimateSimPage `:499` 되돌리기 버튼 의미 (`resetAll` vs `setCo2`) | §6.1 |

**②·④는 코드를 만지기 전에 답이 있어야 한다** — 어느 쪽으로 해소하느냐에 따라
`ProgressPage.jsx`와 `home.smoke.test.mjs` 227줄의 운명이 반대로 갈린다.

### 3단계 — 격리된 워크트리에서 병합한다
`main`을 **integ 쪽으로** 끌어온다(`integ`를 `main`에 올리는 것이 아니라).
방향을 이렇게 잡는 이유: integ가 216커밋·19,930줄로 압도적으로 크고, 해소해야 할
쪽은 main의 38커밋이기 때문이다.
- 확인: **지금 워크트리에서 하지 않는다.**

### 4단계 — 기계적 합집합 5건 (판정 불필요)
| 파일 | 해소 |
|---|---|
| `board.en.js:700` · `board.ko.js:704` | integ의 `{sens}` disclaimer **+** main의 `heroTitle` |
| `uiCopy.contract.test.mjs:171` | 두 블록 **둘 다** |
| `exploreSims.render.test.mjs:230` | 두 블록 **둘 다** (§6.3의 짝을 지킬 것) |
| `package.json:43` | `test:detective-xp` **+** `test:hindcast`(①이 「유지」일 때만) |
- 확인: `node -e "import('./frontend/src/i18n/resources/board.ko.js')"` 류로 문법이 산다.

### 5단계 — 🔴 손 병합 2건 (§6)
`ClimateSimPage.jsx`(4헝크) → `TyphoonSimPage.jsx`(1헝크) 순.
- 확인 ⒜ `grep -c 'type="range"' ClimateSimPage.jsx` → **3**(1이면 조작 변수가 사라진 것)
- 확인 ⒝ `grep -c 'explore.climate.disclaimer' ClimateSimPage.jsx` → **1**(main 계약)
- 확인 ⒞ `disclaimer'` 호출부에 `{ sens:` 가 있다(integ 계약)
- 확인 ⒟ `SchematicPanel`이 TyphoonSimPage에 **2개**, ClimateSimPage에 **1개**
- 확인 ⒠ `npm run test:explore && npm run test:schematic`

### 6단계 — 판정에 막힌 파일 2건
- `ProgressPage.jsx` (판정 ②) → 해소 직후 **`home.smoke.test.mjs`의 main 추가분 21줄을 판정에 맞춘다**(§3.2).
- hindcast 5파일 (판정 ①) → 「삭제 유지」면 `git rm` 5건 **＋ 밖의 6자리를 손으로 걷는다**:
  `Layout.jsx:80` · `SideNav.jsx:57` · `mascotAssets.contract.test.mjs:350` ·
  `package.json:39` · `ci.sh`의 `hindcast` · `tests/hindcast.smoke.test.mjs`(파일).
- 확인: `grep -rn hindcast frontend/src frontend/tests scripts package.json`이 **0건**이거나,
  「되살림」이면 `npm run test:hindcast`가 통과한다.

### 7단계 — `ci.sh` (§5)
§5.2의 합집합 37종(또는 ①·③ 판정에 따라 36종)을 넣는다.
integ의 FU-18 갈래 판별(`step_frontend`)은 **그대로 살린다** — 이 병합에서 「안 돌았다」가
나올 확률이 높고, 그 갈래가 없으면 §3의 지뢰가 「단정 실패」에 섞여 안 보인다.
- 확인: `bash -n scripts/ci.sh` · `${#FRONT_TESTS[@]}`가 기대 종목 수와 같다.

### 8단계 — 전건 실행
`bash scripts/ci.sh` 전체.
- 확인: **`nostart`(안 돌은 종목)가 0건**. 하나라도 있으면 §3의 지뢰가 남은 것이다.
- 확인: `test:mascot` · `test:home` · `test:explore` · `test:ui-copy` — §3에서 지목한 넷이 모두 녹색.

### 9단계 — 그 뒤에야 `main`으로
- 확인: `/health`의 `code_fingerprint` 대조(낡은 컨테이너 함정).

---

## §10. 판정 필요 — 한자리 모음

| # | 판정 | 절 | 막고 있는 것 |
|---|---|---|---|
| ① | **hindcast 존폐** — 삭제 유지(main 337+170줄 사장, 6자리 손 정리) vs 되살림(21파일 2,256줄 · 클라이언트 지시 되돌림) | §2.4 | 4·6·7단계 |
| ② | **`/me` 꼬리** — `LevelGroupCard`·`DailyGoalPicker` 존폐. 08-19/08-20 지시가 반대 방향 | §4.2 | 6단계 · `home.smoke` 21줄 |
| ③ | **`ci.sh`의 `hindcast` 종목** (①에 종속) | §5.2 | 7단계 |
| ④ | **ClimateSimPage `:499`** 되돌리기 버튼 — `resetAll`(integ) vs `setCo2`(main) | §6.1 | 5단계 |

---

*측정 시각 2026-08-21 · 기준 `origin/main`=`6a81a71` · `origin/integ/rolling-0820`=`8020b71` · 로컬 `HEAD`=`0bc46db` · merge-base=`a88d63a`*
