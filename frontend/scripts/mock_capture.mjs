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

/** 경로 변수 자리에 넣을 값 — 목이 아는 것으로 채운다(모르면 1). */
const SAMPLE_ID = {
  ':id': '1', ':case_id': '1', ':content_item_id': '1',
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

const out = {};
for (const key of ROUTES) {
  const [method, raw] = key.split(' ');
  let path = raw;
  for (const [k, v] of Object.entries(SAMPLE_ID)) path = path.split(k).join(v);
  // 바디가 필요한 경로는 목이 422로 답하므로, 흔한 필드를 통째로 실어 보낸다.
  const body = method === 'GET' ? undefined : {
    region: 'seoul', clouds: 5, streak: 3, theta: 0.5, level_group: 'middle_high',
    daily_goal_items: 5, action: 'unlock_all', rain_prob: 50, temp_max: 28, temp_min: 20,
    email: 'a@b.dev', password: 'pw123456', nickname: '목', answers: [], board: {},
    abilities: [{ concept_tag: 'typhoon', theta: 0.5 }],
  };
  try {
    const r = await callMock(method, path, body);
    out[key] = { status: r.status, keys: topKeys(r.json)?.sort() ?? null, unhandled: !!r.unhandled };
  } catch (e) {
    out[key] = { status: -1, keys: [], error: String(e).slice(0, 120) };
  }
}
await vite.close();
process.stdout.write(JSON.stringify(out, null, 1));
process.exit(0);
