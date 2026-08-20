/**
 * 목(apiMockPlugin)을 **실제로 띄워** 모든 경로의 응답을 받아 적는다.
 *
 * 🔴 왜 정적 분석이 아니라 실행인가(2026-08-20).
 *   목 핸들러의 절반 이상이 `return [200, devStatePayload()]`처럼 **함수 호출**을
 *   돌려준다. 소스에서 키를 긁는 방식으로는 46개 경로 중 **13개**밖에 못 봤고,
 *   그나마도 세 번 거짓 결함을 냈다(첫 키 누락 · 축약 프로퍼티 · 4xx 분기를
 *   성공 응답으로 오인). **「전수 확인」을 정적으로는 못 한다.**
 *
 * 사용법: cd frontend && VITE_MOCK=1 node scripts/mock_capture.mjs > /tmp/mock_live.json
 *   ⚠️ **VITE_MOCK=1이 없으면 목이 아예 안 붙는다** — vite.config가 그 env로만 켠다.
 *      없이 돌리면 요청이 dev 프록시를 타고 진짜 백엔드로 나가 401/404가 쏟아진다.
 *
 * 산출: 표준출력에 `{경로: {status, keys, sample}}` JSON 한 덩어리.
 * 이 파일은 **판정하지 않는다** — 대조는 `scripts/mock_parity.py`가 한다.
 */
import { createServer } from 'vite';

// 🔴 **가짜 req/res를 만들지 않는다.** 처음엔 미들웨어에 손수 만든 객체를 넣었는데,
//   목이 안 다루는 경로가 `next()`로 **dev 프록시**까지 흘러가 `req.pipe is not a
//   function`으로 죽었다. 진짜 리스너를 띄우고 `fetch`로 두드리는 것이 옳다.
const PORT = 5399;
const vite = await createServer({
  server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});
await vite.listen();

/** 목 라우트 표에서 경로 목록을 그대로 읽는다 — 손으로 적지 않는다. */
const src = await (await import('node:fs/promises')).readFile(
  new URL('../mock/apiMockPlugin.js', import.meta.url), 'utf-8',
);
const table = src.slice(src.indexOf('const routes = {'));
const ROUTES = [...table.matchAll(/^ {2}'([A-Z]+ [^']+)':/gm)].map((m) => m[1]);

/** 경로 변수 자리에 넣을 **최후의** 값 — 아래 정탐이 진짜 id를 못 캤을 때만 쓴다.
 *
 * 🔴 첫 판은 이 표가 전부였다. 그래서 **9개 경로가 404**로 「대조 못 함」에 남았다
 *    (`GET /session/:id`·`/board/puzzles/:id`·`/detective/cases/:caseId` …).
 *    `:caseId`는 아예 표에 없어서 URL에 **문자 그대로 `:caseId`가 실려 나갔다.**
 *    ⇒ 404는 「목이 그 필드를 안 준다」가 아니라 **「우리가 가짜 id를 보냈다」**였다.
 */
const SAMPLE_ID = {
  ':id': '1', ':case_id': '1', ':caseId': '1', ':content_item_id': '1',
  ':session_id': '1', ':unit_slug': 'intro',
};

// 🔴 목도 토큰을 본다 — 첫 판은 임의 문자열을 보내 **41개 경로가 401**이었다.
//   게스트를 발급받아 그 토큰으로 훑는다(실제 화면과 같은 동선).
let TOKEN = 'mock-access';

const callMock = async (method, path, body) => {
  // ⚠️ 목이 안 다루는 경로는 dev 프록시로 빠져 백엔드(8000)를 두드린다. 짧은
  //    타임아웃으로 끊고 「목이 안 다룸」으로 적는다 — 도커 기동 여부에 안 흔들리게.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/v1${path}`, {
      method,
      signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 비 JSON */ }
    return { status: r.status, json };
  } catch {
    return { status: 0, json: null, unhandled: true };
  } finally {
    clearTimeout(timer);
  }
};

// ⚠️ 빈 배열은 **「필드가 없다」가 아니라 「표본이 없다」**다. 구별해서 돌려준다 —
//    구별 안 하면 `GET /progress/weak-tags`처럼 목이 []를 준 경로가 스키마 필드
//    전부를 「목에없음」으로 뒤집어쓴다(실제로 그렇게 나왔다).
const topKeys = (v) => {
  if (Array.isArray(v)) return v.length ? topKeys(v[0]) : null;
  if (v && typeof v === 'object') return Object.keys(v);
  return [];
};

{
  const g = await callMock('POST', '/auth/guest', { level_group: 'middle_high' });
  if (g.json?.access_token) TOKEN = g.json.access_token;
}

/** 공용 바디 — 「무엇이든 하나는 맞겠지」식 잡탕이다. 아래 `BODY`가 없는 경로에만 쓴다. */
const GENERIC_BODY = {
  region: '서울', clouds: 5, streak: 3, theta: 0.5, level_group: 'middle_high',
  daily_goal_items: 5, action: 'unlock_all', rain_prob: 50, temp_max: 28, temp_min: 20,
  password: 'pw123456', nickname: '목', answers: [], board: {},
  abilities: [{ concept_tag: 'typhoon', theta: 0.5 }],
};

/* ═══ 2단계 수집 — ⑴ 정탐으로 **진짜 id·바디**를 캐고 ⑵ 그 다음에 훑는다 ═══════
 *
 * 🔴 왜 필요한가(2026-08-20 커버리지 2차). 첫 판은 46개 서버 경로 중 **30개**만
 *    대조가 성사됐고, 못 한 16개의 사유가 셋이었다:
 *      ① HTTP 404 — 표본 id가 가짜(`1`·`:caseId` 리터럴)
 *      ② HTTP 422 — 공용 잡탕 바디가 그 경로의 요구와 안 맞음
 *      ③ `response_model` 없음 — 서버 쪽 사정(여기서 고칠 수 없다)
 *    ①②는 **수집기의 결함**이지 목의 결함이 아니다. 「404였다」를 「차이 없음」으로
 *    읽으면 안 되는 것과 마찬가지로, 「404였다」를 **결론으로 남겨서도 안 된다.**
 *
 * ⚠️ **목은 고치지 않는다.** 여기서 하는 일은 전부 목이 이미 공개한 API를 쓰는 것뿐
 *    이다(목록 → 상세, dev 경로로 구름 복구). 목 소스는 한 줄도 안 건드린다.
 */

/** 'VERB /path' → 경로변수 치환표. 같은 `:id`라도 경로마다 **다른 것**을 넣는다. */
const PARAM = {};
/** 'VERB /path' → 그 경로 전용 바디. **경로별로 따로 만든다**(잡탕 하나로 안 때운다). */
const BODY = {};

/** 이 프로세스에서만 유효한 꼬리표 — 이메일·닉네임 중복 409를 피한다. */
const NONCE = Date.now().toString(36);

const firstOk = async (candidates, probe) => {
  for (const c of candidates) if (await probe(c)) return c;
  return null;
};

/** 정탐이 쓴 구름을 되돌린다 — 목이 CLOUD_MAX로 clamp한다.
 *
 * 🔴 이게 없어서 2차 판이 갈렸다. 정탐이 유닛 세션 문항을 전부 오답으로 채우는
 *    동안 구름이 바닥나, 바로 뒤 **보드 퍼즐 정탐이 전부 429**로 떨어졌고 → 진짜
 *    id를 못 캐 본 훑기가 `:id=1`로 나가 **404**가 됐다. 구름 게이트가 「필드 대조
 *    실패」로 둔갑한 것이다. 게이트를 통과하는 것은 목을 고치는 게 아니라
 *    **화면이 실제로 하는 일**이다(개발 도구의 구름 리필).
 */
const refillClouds = () => callMock('POST', '/dev/clouds', { clouds: 9999 });

// ── ① 오늘 세션 → `GET /session/:id` · `POST /session/:id/answer` ────────────
const todaySession = (await callMock('GET', '/session/today')).json;
if (todaySession?.session_id) {
  const sid = todaySession.session_id;
  PARAM['GET /session/:id'] = { ':id': sid };
  PARAM['POST /session/:id/answer'] = { ':id': sid };
  // 아직 안 푼 문항 하나를 고른다 — 이미 답한 문항은 409 ALREADY_ANSWERED다.
  const item = (todaySession.items ?? []).find((it) => it.is_correct == null) ?? todaySession.items?.[0];
  BODY['POST /session/:id/answer'] = {
    quiz_id: item?.quiz_id,
    answer: '0',
    // board 유형이면 board_state가 **필수**(없으면 422). 빈 elements는 유효한 상태다
    // (목표 미달로 오답이 될 뿐 — 우리가 보려는 건 정오가 아니라 **응답의 모양**이다).
    board_state: { elements: [] },
  };
}

// ── ② 유닛 세션 → `POST /session/:id/complete` · `POST /curriculum/units/:id/session`
//    complete는 **전 문항 응답 완료**라야 200이다(아니면 409 SESSION_NOT_COMPLETED).
//    그래서 오늘 세션(①에 한 문항을 남겨 둬야 한다)과 **다른 세션**이 필요하다.
const curriculum = (await callMock('GET', '/curriculum')).json;
const units = (curriculum?.sections ?? []).flatMap((s) => s.units ?? []);
const openUnit = units.find((u) => u.locked === false) ?? units[0];
if (openUnit?.id) {
  PARAM['POST /curriculum/units/:id/session'] = { ':id': openUnit.id };
  const started = (await callMock('POST', `/curriculum/units/${openUnit.id}/session`, {})).json;
  if (started?.session_id) {
    for (const it of started.items ?? []) {
      await callMock('POST', `/session/${started.session_id}/answer`, {
        quiz_id: it.quiz_id, answer: '0', board_state: { elements: [] },
      });
    }
    PARAM['POST /session/:id/complete'] = { ':id': started.session_id };
  }
}

// ── ③ 보드 퍼즐 → 잠금·난이도 게이트를 **실제로 통과하는** 한 건을 고른다 ──────
await refillClouds(); // ②가 구름을 다 썼다 — 안 되돌리면 아래 정탐이 전부 429다
const puzzles = (await callMock('GET', '/board/puzzles')).json ?? [];
const openPuzzle = await firstOk(
  [...puzzles].sort((a, b) => (a.difficulty ?? 9) - (b.difficulty ?? 9)).slice(0, 12),
  async (p) => (await callMock('GET', `/board/puzzles/${p.content_item_id}`)).status === 200,
);
if (openPuzzle) {
  PARAM['GET /board/puzzles/:id'] = { ':id': openPuzzle.content_item_id };
  PARAM['POST /board/puzzles/:id/attempt'] = { ':id': openPuzzle.content_item_id };
  BODY['POST /board/puzzles/:id/attempt'] = { board_state: { elements: [] } };
}

// ── ④ 추리 케이스 → 상세에서 **단서 id·가설 id**까지 캔다 ─────────────────────
//    solve는 `min_clues`개 이상 조사 + 유효 가설이라야 200이다(아니면 422).
const dCase = ((await callMock('GET', '/detective/cases')).json ?? [])[0];
if (dCase?.case_id) {
  PARAM['GET /detective/cases/:caseId'] = { ':caseId': dCase.case_id };
  PARAM['POST /detective/cases/:caseId/solve'] = { ':caseId': dCase.case_id };
  const detail = (await callMock('GET', `/detective/cases/${dCase.case_id}`)).json;
  BODY['POST /detective/cases/:caseId/solve'] = {
    opened_clue_ids: (detail?.clues ?? []).map((c) => c.clue_id),
    hypothesis_id: detail?.hypotheses?.[0]?.hypothesis_id,
  };
}

// ── ④-2 코스 상세 → `GET /courses/:slug` (3판 추가) ──────────────────────────
// 🔴 2판까지 이 경로는 **404**로 「대조 못 함」에 남아 있었다. 사유는 `:caseId`와
//    똑같다 — 치환표에 `:slug`가 없어 URL에 **문자 그대로 `:slug`가 실려 나갔고**,
//    목은 규정대로 404 COURSE_NOT_FOUND를 냈다. 목이 아니라 **수집기 탓**이다.
//    ⇒ 목록에서 진짜 코스 키를 캔다(서버 `get_course`도 목도 `view["id"]`로 찾는다).
const course0 = ((await callMock('GET', '/courses')).json?.courses ?? [])[0];
if (course0?.id) PARAM['GET /courses/:slug'] = { ':slug': course0.id };

// ── ⑤ 과거 예보 회차 ─────────────────────────────────────────────────────────
const hCase = ((await callMock('GET', '/hindcast/cases')).json?.cases ?? [])[0];
if (hCase?.case_id) {
  PARAM['POST /hindcast/cases/:caseId/predict'] = { ':caseId': hCase.case_id };
  BODY['POST /hindcast/cases/:caseId/predict'] = { temp_max: 29, rain_prob: 50 };
}

// ── ⑥ 422 다섯 — **핸들러를 읽고 경로별로** 맞춘다(잡탕 하나로 안 때운다) ──────
//    daily-goal: DAILY_GOAL_CHOICES(3·5·10) 밖은 422 — 첫 판은 `daily_goal_items`를
//      보냈는데 핸들러가 보는 건 `items`다.
//    region: KMA 12도시 화이트리스트 — 첫 판의 `'seoul'`은 목록에 없다(값은 한글).
//    reset-me / placement / streak: 각각 `reset:true` · `action:'reset'|'complete'` ·
//      `streak_count` — **셋이 서로 다른 계약**이다.
BODY['PUT /progress/daily-goal'] = { items: 5 };
BODY['PUT /progress/region'] = { region: '서울' };
BODY['POST /dev/reset-me'] = { reset: true };
BODY['POST /dev/placement'] = { action: 'complete' };
BODY['POST /dev/streak'] = { streak_count: 3, last_login_days_ago: 0 };

// ── ⑦ 인증 3종 — 중복 409를 피하고, resume이 열 **자격을 먼저 저장**한다 ──────
//    첫 판은 register·convert가 같은 `a@b.dev`를 써서 convert가 409
//    EMAIL_ALREADY_EXISTS였다. resume은 저장된 자격이 없어 401이었다.
//    ⇒ 이메일을 경로마다 다르게 주고, resume용 자격은 정탐에서 게스트 전환으로 만든다.
const RESUME = { email: `resume-${NONCE}@mock.dev`, password: 'pw123456' };
BODY['POST /auth/register'] = { email: `reg-${NONCE}@mock.dev`, password: 'pw123456', nickname: `목${NONCE}` };
BODY['POST /auth/login'] = { email: RESUME.email, password: RESUME.password };
BODY['POST /auth/resume'] = { ...RESUME };
BODY['POST /auth/guest/convert'] = { email: `conv-${NONCE}@mock.dev`, password: 'pw123456' };
await callMock('POST', '/auth/guest', { level_group: 'middle_high' });
await callMock('POST', '/auth/guest/convert', RESUME); // savedAccounts에 심는다

/** 'VERB /path' → 그 경로의 **전제 조건**을 세우는 선행 호출. */
const PRE = {
  // convert는 「지금 게스트인가」를 본다(아니면 409 NOT_GUEST). 그런데 표에서 이 경로
  // 바로 앞에 있는 register·login·resume이 **셋 다 isGuest=false로 내린다.**
  // ⇒ 표 순서를 그대로 훑는 한, 게스트를 다시 발급해 주지 않으면 영원히 409다.
  //   (화면도 같은 순서다: 게스트로 시작 → 저장. 전제를 세우는 것뿐이다.)
  'POST /auth/guest/convert': () => callMock('POST', '/auth/guest', { level_group: 'middle_high' }),
};

// ── ⑧ 빈 배열 = 「필드 없음」이 아니라 **「표본 없음」**이다 — 표본을 만든다 ─────
//    `GET /progress/weak-tags`는 `num_responses>0 AND θ<0.41`인 개념만 돌려준다.
//    갓 발급된 게스트에는 그런 개념이 없어 `[]`였고, 그래서 스키마 필드를 **하나도**
//    대조하지 못했다. dev θ 주입으로 약한 개념 하나를 만들어 표본을 세운다.
await callMock('POST', '/dev/theta', {
  abilities: [{ concept_tag: 'typhoon', theta: -1.2, num_responses: 6 }],
});

// ── ⑨ 정탐이 쓴 구름을 되돌린다 — 본 훑기가 429 OUT_OF_CLOUDS로 갈리지 않게 ────
await refillClouds();

const out = {};
for (const key of ROUTES) {
  const [method, raw] = key.split(' ');
  let path = raw;
  const subst = { ...SAMPLE_ID, ...(PARAM[key] ?? {}) };
  for (const [k, v] of Object.entries(subst)) path = path.split(k).join(v);
  const body = method === 'GET' ? undefined : (BODY[key] ?? GENERIC_BODY);
  try {
    if (PRE[key]) await PRE[key]();
    const r = await callMock(method, path, body);
    out[key] = {
      status: r.status,
      keys: topKeys(r.json)?.sort() ?? null,
      unhandled: !!r.unhandled,
      // 정탐이 진짜 id를 캤는지 — 못 캔 채 404가 나면 「가짜 id」와 구별해야 한다.
      resolved_id: PARAM[key] ? Object.values(PARAM[key])[0] : null,
    };
  } catch (e) {
    out[key] = { status: -1, keys: [], error: String(e).slice(0, 120) };
  }
}
await vite.close();
process.stdout.write(JSON.stringify(out, null, 1));
process.exit(0);
