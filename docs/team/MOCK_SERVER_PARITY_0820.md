# 목 ↔ 서버 응답 필드 전수 대조 — 2026-08-20

클라이언트 지시: *「가짜 데이터와 서버 응답이 맞는지 전수 확인한다」*
**고치지 않았다. 목록만이다.**

## 어떻게 쟀나 — 정적 분석은 버리고 **실행**으로 갔다

⑴ `frontend/scripts/mock_capture.mjs` — 목을 **실제로 띄워**(`VITE_MOCK=1`) 라우트
   표의 56개 경로를 전부 두드리고 응답 JSON의 최상위 키를 적는다.
⑵ `scripts/mock_parity.py` — 서버 `schemas/*.py`의 필드 집합과 양방향 대조하고,
   그 필드를 읽는 화면이 있는지(`frontend/src` 참조 수)를 함께 단다.

🔴 **처음엔 소스에서 키를 긁는 정적 분석으로 시작했다가 버렸다.** 목 핸들러의 과반이
`return [200, devStatePayload()]`처럼 **함수 호출**을 돌려주기 때문에 46개 중 13개
밖에 못 봤다. 그리고 그 도구가 **거짓 결함을 네 번** 냈다:

| 도구 버그 | 증상 |
|---|---|
| 깊이와 키를 한 정규식으로 봐 여는 `{`를 깊이 쪽이 먹음 | 객체의 **첫 키가 통째로** 누락 → `POST /auth/login`의 `access_token`이 「목에없음」 |
| 축약 프로퍼티 `{ region }` 미지원 | `PUT /progress/region`이 결함으로 |
| 4xx 분기를 성공 응답으로 오인 | `POST /dev/clouds`의 422 객체(`detail`·`code`)와 대조해 가짜 결함 무더기 |
| 빈 배열을 「필드 없음」으로 읽음 | `GET /progress/weak-tags`가 스키마 전 필드를 뒤집어씀 |

⚠️ **첫 판은 「목에없음 0」이었다.** 그 0이 거짓이었다. **도구가 조용한 것을
「차이 없음」으로 읽으면 안 된다** — 이 표의 「대조 못 함」 절이 그래서 있다.

## 🔴 가장 값이 큰 발견 — `/me` 개념 칩이 「초급」인 이유

`GET /progress/abilities`가 목에서 **`knowledge_level`·`knowledge_level_max`를 안
준다.** 서버 `ConceptAbilityOut`은 준다(R13-02 T3). `/me`의 WeatherBrainPanel이 그
필드로 교과 표기를 그리므로, **없으면 4밴드(「초급」)로 내려앉는다.**
⇒ QA 롤링 0820 ⑴ *「`/me`의 개념 칩 6개가 전부 「초급」」*의 **원인이 이것이다.**
같은 날 배치고사 결과 화면에서 고친 것(`PlacementAbility`)과 **같은 형태이고, 자리만
다르다.**

# 실행 대조 **1판** — 스키마 대조 성사 **30** / 서버 응답모델 46 · 목 라우트 56

> ⚠️ **이 절의 숫자와 표는 1판(8/20 오전)이고, 지금의 HEAD를 설명하지 않는다.**
> · 아래 「목에없음」 12건 중 **9건은 그날 고쳐졌다**(`7e86763`·`3db8a7f`·`2b5383e`).
>   지우지 않고 남긴다 — 무엇이 있었는지가 기록이다.
> · 「대조 못 함」 26건 중 **17건은 목의 문제가 아니라 수집기·대조기의 문제**였다.
> · 최신 숫자는 문서 맨 아래 **§커버리지 2판**을 볼 것.

| 경로 | 갈래 | 필드 | 스키마 | src 참조 |
|---|---|---|---|---|
| `POST /dev/theta` | 목에만 | `clouds` | DevThetaResult | 24 |
| `POST /dev/curriculum` | 목에만 | `clouds` | DevCurriculumResult | 24 |
| `POST /dev/theta` | 목에만 | `streak_count` | DevThetaResult | 9 |
| `POST /dev/clouds` | 목에만 | `streak_count` | DevCloudsResult | 9 |
| `POST /dev/curriculum` | 목에만 | `streak_count` | DevCurriculumResult | 9 |
| `POST /dev/theta` | 목에만 | `abilities` | DevThetaResult | 6 |
| `POST /dev/clouds` | 목에만 | `abilities` | DevCloudsResult | 6 |
| `POST /dev/curriculum` | 목에만 | `abilities` | DevCurriculumResult | 6 |
| `POST /dev/theta` | 목에만 | `placement_done` | DevThetaResult | 5 |
| `POST /dev/clouds` | 목에만 | `placement_done` | DevCloudsResult | 5 |
| `POST /dev/curriculum` | 목에만 | `placement_done` | DevCurriculumResult | 5 |
| `GET /duel/history` | 목에만 | `caster_grade` | DuelHistoryItem | 5 |
| `POST /dev/theta` | 목에만 | `overall_theta` | DevThetaResult | 2 |
| `POST /dev/theta` | 목에만 | `weak_tags` | DevThetaResult | 2 |
| `POST /dev/clouds` | 목에만 | `overall_theta` | DevCloudsResult | 2 |
| `POST /dev/clouds` | 목에만 | `weak_tags` | DevCloudsResult | 2 |
| `POST /dev/curriculum` | 목에만 | `overall_theta` | DevCurriculumResult | 2 |
| `POST /dev/curriculum` | 목에만 | `weak_tags` | DevCurriculumResult | 2 |
| `GET /progress/me` | 목에만 | `max_clouds` | ProgressMe | 1 |
| `POST /dev/theta` | 목에만 | `dev_mode` | DevThetaResult | 1 |
| `POST /dev/theta` | 목에만 | `target_level_group` | DevThetaResult | 1 |
| `POST /dev/theta` | 목에만 | `unlock_floor` | DevThetaResult | 1 |
| `POST /dev/clouds` | 목에만 | `dev_mode` | DevCloudsResult | 1 |
| `POST /dev/clouds` | 목에만 | `target_level_group` | DevCloudsResult | 1 |
| `POST /dev/clouds` | 목에만 | `unlock_floor` | DevCloudsResult | 1 |
| `POST /dev/curriculum` | 목에만 | `dev_mode` | DevCurriculumResult | 1 |
| `POST /dev/curriculum` | 목에만 | `target_level_group` | DevCurriculumResult | 1 |
| `POST /dev/curriculum` | 목에만 | `unlock_floor` | DevCurriculumResult | 1 |
| `POST /dev/clouds` | 목에없음 | `max` | DevCloudsResult | 98 |
| `GET /duel/today` | 목에없음 | `xp_earned` | DuelToday | 9 |
| `POST /duel/today` | 목에없음 | `xp_earned` | DuelToday | 9 |
| `GET /duel/history` | 목에없음 | `xp_earned` | DuelHistoryItem | 9 |
| `GET /league/me/results` | 목에없음 | `tier` | LeagueResultOut | 5 |
| `POST /onboarding/placement/start` | 목에없음 | `closing_step` | SessionToday | 3 |
| `GET /progress/abilities` | 목에없음 | `knowledge_level` | ConceptAbilityOut | 3 |
| `GET /progress/abilities` | 목에없음 | `knowledge_level_max` | ConceptAbilityOut | 1 |
| `GET /dev/state` | 목에없음 | `max_clouds` | DevState | 1 |
| `POST /dev/theta` | 목에없음 | `updated` | DevThetaResult | 0 |
| `POST /dev/curriculum` | 목에없음 | `action` | DevCurriculumResult | 0 |
| `POST /dev/curriculum` | 목에없음 | `affected` | DevCurriculumResult | 0 |

합계: 목에없음 12(화면이 읽는 것 9) · 목에만 28

## 대조 못 함 — 「차이 없음」이 아니라 「안 봤다」
  - GET /auth/me — 스키마 MeResponse 파싱 0
  - GET /board/puzzles/* — HTTP 404
  - GET /board/regions — response_model 없음
  - GET /board/rules — response_model 없음
  - GET /courses — response_model 없음
  - GET /curriculum — response_model 없음
  - GET /detective/cases — response_model 없음
  - GET /detective/cases/* — HTTP 404
  - GET /progress/weak-tags — 빈 배열 — 표본 없음
  - GET /quiz/history — response_model 없음
  - GET /quiz/today — response_model 없음
  - GET /session/* — HTTP 404
  - PATCH /auth/me — 스키마 MeResponse 파싱 0
  - POST /auth/guest/convert — HTTP 409
  - POST /board/puzzles/*/attempt — HTTP 404
  - POST /curriculum/units/*/session — HTTP 404
  - POST /detective/cases/*/solve — HTTP 404
  - POST /dev/placement — HTTP 422
  - POST /dev/reset-me — HTTP 422
  - POST /dev/streak — HTTP 422
  - POST /hindcast/cases/*/predict — HTTP 404
  - POST /quiz/*/answer — response_model 없음
  - POST /session/*/answer — HTTP 404
  - POST /session/*/complete — HTTP 404
  - PUT /progress/daily-goal — HTTP 422
  - PUT /progress/region — HTTP 422


# 축 ②: 재구현 사본 — 목이 서버 로직을 자체 구현한 자리

필드 유무와 **다른 축**이다. 같은 입력에 같은 답이 나오는지를 따로 쟀다.

## 실측 — `board_difficulty`

시드의 **board 문항 55건 전건**에 서버 `routers/board.board_difficulty`와 목
`boardDifficulty`를 각각 돌려 비교했다.

    불일치 **0 / 55** (산출 분포 1:23 · 2:16 · 3:16)

⚠️ **그런데 두 구현의 「규칙」은 이미 갈려 있다.**

    서버: isinstance(palette, (list, dict)) and len(palette) >= 3
    목  : Array.isArray(palette) && palette.length >= 3

시드 55건의 palette가 **전부 배열**이라 오늘은 답이 같다. **객체 palette가 한 건이라도
저작되는 순간 목만 난이도가 1 낮아진다.** 지금 초록인 것은 규칙이 같아서가 아니라
**입력이 아직 그 갈래를 안 밟아서**다.

## 🔴 파리티 그물이 안 덮는 사본 — 값은 오늘 같지만 **아무도 안 본다**

`__mockPolicy()`가 노출하는 것만 `test_r13_mock_policy_parity`가 대조한다.
아래는 사본인데 **노출돼 있지 않다** — 서버가 바뀌어도 조용하다.

| 목의 사본 | 서버 원본 | 오늘 값 | 노출? |
|---|---|---|---|
| `LEVEL_GROUP_ITEM_B` | `weatherbrain_service.LEVEL_GROUP_ITEM_B` | 일치 | ❌ |
| `DEFAULT_ITEM_B` | 같음 | 일치(0.0) | ❌ |
| `LEVEL_GROUP_TONE` | `weatherbrain_service.LEVEL_GROUP_TONE` | 일치 | ❌ |
| `boardDifficulty` **규칙** | `routers/board.board_difficulty` | 위 ⚠️ 참조 | ❌(표만 노출) |
| `thetaToLevelGroup` | `weatherbrain_service` 4밴드 | 미검 | ❌ |

⚠️ `board_band_max_difficulty`·`theta_knowledge_level_bounds`·`knowledge_level_max`는
노출돼 **이미 대조되고 있다.** 문제는 **같은 파일 안에서 어떤 사본은 그물에 있고
어떤 사본은 없다**는 것이다 — 있는 쪽만 보고 「목은 대조된다」고 읽기 쉽다.

## 이 축에서 못 한 것

`compute_unlocked_ids`(보드 순차 잠금)·`order_puzzles_for_progress`(정렬)·
`mastery_label`도 목이 사본을 갖고 있다. **안 쟀다** — 시간이 모자랐다.


---

# 커버리지 2판 — 2026-08-20 (오후). 대조 성사 **48 / 51** (1판 30 / 46)

1판이 남긴 「대조 못 함」 26건을 사유별로 파고들었다. **목은 한 줄도 안 고쳤다** —
고친 것은 **수집기(`frontend/scripts/mock_capture.mjs`)와 대조기
(`scripts/mock_parity.py`)뿐**이다.

    cd frontend && VITE_MOCK=1 node scripts/mock_capture.mjs > /tmp/live.json
    python3 scripts/mock_parity.py . /tmp/live.json      # ← 2번째 인자가 실행 수집 모드

두 번 돌려 **출력이 완전히 같음**을 확인했다(결정적).

## 🔴 1판의 「대조 못 함」은 **절반 이상이 우리 도구 탓**이었다

| 1판이 적은 사유 | 건수 | 실제 원인 | 2판 조치 |
|---|---:|---|---|
| HTTP 404 | 9 | **표본 id가 가짜.** `:caseId`는 치환표에 아예 없어 URL에 **문자 그대로 `:caseId`가 실려 나갔다** | 목록 경로를 먼저 불러 **진짜 id를 캐는 정탐 단계**를 앞에 둔다 |
| HTTP 422 | 5 | **공용 잡탕 바디**가 경로 계약과 불일치(`daily_goal_items`를 보냈는데 핸들러는 `items`를 본다 · region은 한글 12도시 화이트리스트인데 `'seoul'`을 보냈다) | 핸들러를 읽고 **경로별 바디**를 따로 만든다 |
| HTTP 409 | 1 | register와 convert가 **같은 이메일**을 썼다 | 실행마다 유일한 이메일 + convert 직전 게스트 재발급 |
| 빈 배열 | 1 | 표본이 없었다(약한 개념 0개) | dev θ 주입으로 **표본을 만든다** |
| 스키마 파싱 0 | 2 | `MeResponse`가 `schemas/`가 아니라 **라우터 파일 안**에 있다 | 대조기가 라우터도 스캔한다 |
| `response_model` 없음 | 8 | **그중 2건은 오판정이었다**(아래) | 정규식 수정 |

합계 26. 이 중 **17건이 2판에서 대조 성사**했다(남은 9건은 맨 아래 §끝내 대조 못 한 …).

### 🔴 「서버가 `response_model`을 안 걸었다」가 3건 **거짓**이었다

`routers/curriculum.py`는 라우터를 셋(`router`·`curriculum_router`·`courses_router`)
두고 `@curriculum_router.get(...)`으로 건다. 대조기가 `@router\.`만 보느라 **파일을
통째로 놓쳤고**, 그 결과를 「서버가 응답 모델을 선언 안 했다」로 적었다.

| 1판 기술 | 사실 |
|---|---|
| `GET /courses` — response_model 없음 | **`CoursesOut` 선언돼 있다** |
| `GET /curriculum` — response_model 없음 | **`CurriculumOut` 선언돼 있다** |
| `POST /curriculum/units/*/session` — HTTP 404 | **`SessionToday` 선언돼 있다** (사유도 틀렸다 — 404는 가짜 unit id 탓) |
| `GET /courses/*` — 목록에 없었다 | `CourseOut` 선언돼 있다. 대조기가 못 봐서 **경로 자체가 통계 밖**이었다 |

⚠️ 도구가 못 본 것을 **서버 탓으로 돌린** 형태다. 1판이 경고한 *「조용한 것을
「차이 없음」으로 읽지 마라」*의 쌍둥이 — **「안 보인 것」을 「없다」로 읽지 마라**.

### 분모가 46 → 51로 는 내역

    46 (1판) + 4 (위 정규식 수정으로 되찾은 curriculum·courses 4경로)
             + 1 (통합에서 신설된 POST /auth/resume) = 51

## 새로 대조된 18경로

`GET /auth/me` · `PATCH /auth/me` · `GET /courses` · `GET /curriculum` ·
`GET /board/puzzles/*` · `POST /board/puzzles/*/attempt` ·
`POST /session/*/answer` · `POST /session/*/complete` ·
`POST /curriculum/units/*/session` · `POST /hindcast/cases/*/predict` ·
`GET /progress/weak-tags` · `PUT /progress/daily-goal` · `PUT /progress/region` ·
`POST /dev/reset-me` · `POST /dev/placement` · `POST /dev/streak` ·
`POST /auth/guest/convert` · `POST /auth/resume`

그중 **차이 0으로 나온 12경로**: `GET /auth/me` · `PATCH /auth/me` · `GET /courses` ·
`GET /curriculum` · `GET /board/puzzles/*` · `POST /board/puzzles/*/attempt` ·
`POST /hindcast/cases/*/predict` · `GET /progress/weak-tags` ·
`PUT /progress/daily-goal` · `PUT /progress/region` · `POST /auth/guest/convert` ·
`POST /auth/resume`

## 새로 나온 차이 — **목에없음 9** (고치지 않았다. 목록이다.)

| 경로 | 필드 | 스키마 | src 참조 | 성격 |
|---|---|---|---|---|
| `POST /session/*/answer` | `retry_correct` | SessionAnswerResult | 9 | 분기 의존 — 목은 **만회 재제출 분기에서만** 싣는다 |
| `POST /dev/reset-me` | `reset` | DevResetResult | 6 | **아예 없다**(목은 `devStatePayload()`를 통째로 돌려준다) |
| `POST /session/*/answer` | `phenomena` | SessionAnswerResult | 6 | 분기 의존 — board 유형 문항에만 |
| `POST /session/*/complete` | `abilities` | SessionCompleteResult | 6 | 분기 의존 — 배치고사 완료 분기에만 |
| `POST /session/*/complete` | `placement_done` | SessionCompleteResult | 5 | 분기 의존 — 배치고사 완료 분기에만 |
| 🔴 `POST /session/*/answer` | `feedback_source` | SessionAnswerResult | 4 | **아예 없다** — 목 전체에 이 이름이 0회 |
| `POST /curriculum/units/*/session` | `closing_step` | SessionToday | 3 | **아예 없다** — 같은 스키마인 `GET /session/today`·`placement/start`는 싣는다 |
| `POST /session/*/answer` | `is_retry` | SessionAnswerResult | 3 | 분기 의존 — 만회 분기에만 |
| `POST /dev/streak` | `last_login_date` | DevStreakResult | 0 | **아예 없다**(목은 `devLastLoginDaysAgo`로 저장만) |

🔴 **`feedback_source`가 이 판의 가장 값이 큰 발견이다.** 서버 `AnswerResult`는
`Literal["board","authored","ai"] = "ai"`로 **항상** 싣고, 화면은 그 값으로
「AI 피드백 / 사람 저작」 배지를 고른다(R13 CO-I-1). 목에는 이 이름이 **한 번도
안 나온다** ⇒ 목으로 도는 화면은 사람이 쓴 해설에도 기본값 `ai` 배지를 붙인다.
1판의 `knowledge_level` 발견(`/me` 개념 칩이 「초급」)과 **같은 형태이고 자리만 다르다.**

⚠️ **「분기 의존」은 「차이 없음」이 아니다.** 서버는 `response_model` 덕에 그 필드를
기본값(`false`·`null`)으로 **항상** 내보내고, 목은 분기에서만 키를 만든다. 즉
`'is_retry' in res`로 가르는 코드는 목과 서버에서 다르게 돈다.
그리고 **실행 수집은 경로당 표본 하나**다 — 다른 분기는 이번에도 **안 봤다**.

## 새로 나온 차이 — **목에만 30**

`POST /dev/reset-me`·`POST /dev/placement`·`POST /dev/streak` 셋이 **28건**이다.
1판의 `dev/theta`·`dev/clouds`·`dev/curriculum`과 **완전히 같은 형태** — 목이 dev
경로마다 `devStatePayload()`(상태 전체)를 돌려주는데 서버는 좁은 결과 스키마만 준다.

| 경로 | 목에만 있는 필드 |
|---|---|
| `POST /dev/reset-me` | `clouds`·`streak_count`·`abilities`·`placement_done`·`overall_theta`·`weak_tags`·`dev_mode`·`max_clouds`·`target_level_group`·`unlock_floor` (10) |
| `POST /dev/placement` | `clouds`·`streak_count`·`abilities`·`overall_theta`·`weak_tags`·`dev_mode`·`max_clouds`·`target_level_group`·`unlock_floor` (9) |
| `POST /dev/streak` | `clouds`·`abilities`·`placement_done`·`overall_theta`·`weak_tags`·`dev_mode`·`max_clouds`·`target_level_group`·`unlock_floor` (9) |

나머지 2건은 dev가 아니다:

| 경로 | 필드 | 스키마 | src 참조 |
|---|---|---|---|
| `POST /curriculum/units/*/session` | `unit` | SessionToday | 40 |
| `POST /curriculum/units/*/session` | `unit_id` | SessionToday | 0 |

⚠️ 서버는 `response_model=SessionToday`라 이 둘을 **응답에서 깎아 낸다.** 목만 준다.
오늘 `UnitSessionPage`는 URL 파라미터로 unitId를 쓰고 이 필드를 안 읽으므로 조용하지만,
**목을 보고 「응답에 unit이 있다」고 배선하면 실서버에서 undefined가 된다.**

## 전체 합계(2판, HEAD 기준)

    대조 성사 48 / 51 · 목 응답 57
    목에없음 12 (화면이 읽는 것 8) · 목에만 61
      ├ 새로 나온 것: 목에없음 9 · 목에만 30
      └ 1판에서 이월: 목에없음 3(`dev/theta.updated` · `dev/curriculum.action` ·
                       `dev/curriculum.affected` — 셋 다 src 참조 0) · 목에만 31

## 끝내 대조 못 한 8경로 — **사유와 함께 남긴다**

### ⑴ 서버에 있는데 **목에 그 경로가 아예 없다** — 3건 (2판 신규 발견)

| 경로 | 스키마 |
|---|---|
| `GET /courses/*` | CourseOut |
| `GET /league/division` | LeagueDivision |
| `GET /progress/mastery` | ConceptMasteryOut |

⚠️ 「필드가 다르다」보다 **한 단계 나쁜 상태**다. 목으로 도는 화면은 이 경로를
두드리면 dev 프록시로 빠져 나간다(1판 §`GET /courses` 사건과 같은 함정).

### ⑵ 서버가 `response_model`을 **선언 안 했다** — 5건. **잴 수 없다**

| 경로 |
|---|
| `GET /board/regions` |
| `GET /board/rules` |
| `GET /detective/cases` |
| `GET /detective/cases/*` |
| `POST /detective/cases/*/solve` |

대조의 **기준이 서버에 없다.** 목이 옳은지 그른지 말할 수 없다 — 「차이 없음」이
아니라 **「잴 수 없음」**이다. 재려면 서버 라우터가 응답 모델을 선언해야 한다.
**이번 범위 밖**이고, 고치는 사람이 볼 자리로 남긴다.

### ⑶ 참고 — 목에만 있고 서버에 그 경로가 없는 것 4건

`GET /quiz/today` · `GET /quiz/history` · `POST /quiz/*/answer` · `GET /session/*`.
`backend/app/routers/quiz.py`는 **존재하지 않고**, 백엔드 어디에도 `/quiz` 경로가
없다(세션 엔진으로 대체됨). `GET /session/{id}`도 서버에 없다 — `session.py`는
`/today`·`/{id}/answer`·`/{id}/complete` 셋뿐이다. 넷 다 목이 옛 경로를 아직 들고
있는 것이라 애초에 서버 대조 대상이 아니다.
⚠️ 1판은 quiz 셋을 「`response_model` 없음」으로, `GET /session/*`을 「HTTP 404」로
적었는데 **둘 다 사유가 틀렸다.** 서버에 그 경로가 **없는** 것이다.

## 2판이 안 한 것

· **분기별 표본** — 경로당 표본 하나다. 만회 재제출·board 문항·배치고사 완료 분기의
  응답 모양은 이번에도 안 봤다(위 「분기 의존」 5건이 그 자리다).
· **값 대조** — 이 문서 전체가 **필드 유무** 축이다. 같은 입력에 같은 값이 나오는지는
  §축 ②가 `board_difficulty` 하나만 쟀고 나머지는 그대로 미검이다.
· **목 수정** — 위 표의 어느 것도 고치지 않았다. 지시대로 목록만이다.
