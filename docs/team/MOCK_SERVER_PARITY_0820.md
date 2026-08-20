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

# 실행 대조 — 스키마 대조 성사 **30** / 서버 응답모델 46 · 목 라우트 56

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
