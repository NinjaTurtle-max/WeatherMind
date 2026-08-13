/**
 * 안내봇 3D 계약 (MT-26) — node tests/guideBot3d.smoke.test.mjs
 *
 * `guideBot.smoke.test.mjs`가 **무엇을 말하는가**(규칙표)를 지킨다면, 여기는
 * **어떻게 그려지는가**를 지킨다. 무는 것은 다섯 가지다:
 *
 *  ⑴ **자산 계약** — `public/guidebot.mesh`가 실재하고, 런타임 파서가 헤더를
 *     왕복으로 읽어내고, 인덱스가 정점 범위를 벗어나지 않고, 예산(≤300KB)
 *     안에 있는가. 이 파일이 깨지면 화면이 아니라 **콘솔만** 조용히 운다.
 *  ⑵ **드로우콜 예산** — 재질별 병합이 살아 있는가(그룹 ≤ 5). 베이킹에서 병합이
 *     빠지면 드로우콜이 44로 돌아가는데 화면은 똑같이 보여서 눈으로는 못 잡는다.
 *     crossSection의 드로우콜 예산 계약(`test:webgl`)과 같은 취지다.
 *  ⑶ **얼굴판 제외** — 그룹 색 4종을 **정확히** 대조한다. 원본 모델에는 흰
 *     `face_panel`이 있지만 2D 폴백 PNG에는 없어서(근거는 bake 스크립트 주석)
 *     3D만 그리면 교체 순간 얼굴에 흰 판이 튀어나온다. 누가 그것을 되살리면
 *     여기가 붉어져야 한다 — 되살리려면 PNG를 먼저 다시 렌더해야 한다.
 *  ⑷ **폴백** — WebGL이 없는 환경에서 ⓐ SSR이 죽지 않고 ⓑ 2D PNG가 **실제로
 *     DOM에 그려져 있고** ⓒ 렌더러 생성이 예외가 아니라 `null`로 떨어지는가.
 *     이 기능의 1순위 요구가 "3D가 안 되면 2D로 조용히 떨어진다"이다.
 *  ⑸ **베이킹 결정성** — 같은 glb를 두 번 구우면 같은 바이트인가. 아니면 배포
 *     때마다 캐시가 깨지고 diff가 무의미해진다. (python3·numpy가 없으면 SKIP.)
 *
 * 관례: 러너 의존 없이 node 직접 실행 · vite ssrLoadModule · PASS/FAIL 출력 ·
 * 실패 시 exit 1 (guideBot.smoke.test.mjs와 동일).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.NODE_ENV = 'production';
// 로케일 ko 고정 — SSR 단정이 한국어라서(러너 navigator.language가 en-US다).
globalThis.localStorage = {
  getItem: (k) => (k === 'weathermind.locale' ? 'ko' : null),
  setItem() {}, removeItem() {},
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
};
const skip = (name, why) => console.log(`SKIP ${name} — ${why}`);

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { createServer } = await import('vite');

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const M = await server.ssrLoadModule('/src/lib/guideBotMesh.js');

  // ── ⑴ 자산 계약 ─────────────────────────────────────────────────────────
  const meshPath = resolve(root, 'public/guidebot.mesh');
  check('public/guidebot.mesh가 있다 (없으면 python3 scripts/bake_mascot_glb.py)',
    existsSync(meshPath));
  if (!existsSync(meshPath)) throw new Error('자산 없음 — 이후 검사 불가');

  const raw = await readFile(meshPath);
  const bytes = (await stat(meshPath)).size;
  const mesh = M.parseBotMesh(raw); // node Buffer(풀 오프셋 있음)를 그대로 먹여 본다
  console.log(`     · ${bytes.toLocaleString()} B · 정점 ${mesh.vertexCount.toLocaleString()}`
    + ` · 삼각형 ${(mesh.indexCount / 3).toLocaleString()} · 드로우콜 ${mesh.groups.length}`);

  check(`파일이 예산 안이다 (${(bytes / 1024).toFixed(1)}KB ≤ 300KB)`, bytes <= 300 * 1024);
  check('헤더 버전이 런타임 기대와 같다', mesh.version === M.MESH_VERSION);
  check('정점 스트라이드 10B(pos int16×3 + normal int8×3 + pad)', M.VERTEX_STRIDE === 10);
  check('선언한 정점/인덱스 수가 실제 바이트와 정확히 맞는다',
    mesh.vertexBytes.byteLength === mesh.vertexCount * M.VERTEX_STRIDE
    && mesh.indexBytes.byteLength === mesh.indexCount * 2);
  check('인덱스가 삼각형 단위다', mesh.indexCount % 3 === 0);
  check('정점이 uint16 인덱스 상한 안이다 — 넘으면 인덱스가 감겨 엉뚱한 정점을 가리킨다',
    mesh.vertexCount <= 65536);

  // 인덱스 범위 — 여기서 새면 GPU가 쓰레기를 그리거나(디버그 없이) 드라이버가 죽는다.
  const idx = new Uint16Array(mesh.indexBytes.buffer, mesh.indexBytes.byteOffset, mesh.indexCount);
  let maxIdx = 0;
  for (let i = 0; i < idx.length; i += 1) if (idx[i] > maxIdx) maxIdx = idx[i];
  check(`모든 인덱스가 정점 범위 안이다 (max ${maxIdx} < ${mesh.vertexCount})`,
    maxIdx < mesh.vertexCount);

  // 그룹 구간이 인덱스 블록을 빈틈없이·겹침 없이 덮는가
  let cursor = 0;
  let contiguous = true;
  for (const g of mesh.groups) {
    if (g.indexOffset !== cursor || g.indexCount % 3 !== 0) contiguous = false;
    cursor += g.indexCount;
  }
  check('그룹 구간이 인덱스 블록을 빈틈·겹침 없이 덮는다',
    contiguous && cursor === mesh.indexCount);

  // 바운딩 박스가 실제로 캐릭터 크기다(0이면 런타임 화면 맞춤이 0으로 나눠진다)
  check('바운딩 박스가 양수다 — 런타임이 이 값으로 캔버스에 맞춘다',
    mesh.size.every((v) => v > 0) && mesh.scale.every((v) => v > 0));

  // ── ⑵ 드로우콜 예산 ─────────────────────────────────────────────────────
  check(`드로우콜이 5 이하다 (실측 ${mesh.groups.length} · 원본 프리미티브는 44개였다)`,
    mesh.groups.length <= 5);

  // ── ⑶ 얼굴판 제외 계약 ──────────────────────────────────────────────────
  // 소유자는 bake 스크립트의 SKIP_MATERIALS. 흰 얼굴판(0.888,0.965,1.0)이 없어야 한다.
  const hex = (c) => c.map((v) => Math.round(v * 255)).join(',');
  const got = mesh.groups.map((g) => hex(g.color));
  const want = [
    '29,119,194',   // cloudblue_deep
    '70,168,233',   // cloudblue
    '226,246,255',  // face_panel — 흰 얼굴판
    '3,29,55',      // glyph_ink
    '255,164,17',   // sun_yellow
  ];
  check(`재질 색 5종이 원본 그대로다 (${got.join(' / ')})`,
    JSON.stringify(got) === JSON.stringify(want));
  // ⚠️ 이 단정은 **뒤집힌 것**이다(2026-08-13). 종전에는 *"흰 face_panel이 들어
  // 있지 않다"*를 계약으로 걸었다 — 당시 2D PNG에 얼굴판이 없었기 때문이고,
  // 3D만 그리면 교체 순간 얼굴에 흰 판이 튀어나왔다. 그 원인은 모델이 아니라
  // `render_mascot_glb.py`가 **무인덱스 프리미티브를 건너뛴 버그**였다. PNG를
  // 고쳐 다시 렌더한 지금은 양쪽 다 얼굴판이 있고, **없는 쪽이 결함**이 됐다.
  // 경위를 남기는 이유: 계약이 왜 뒤집혔는지 모르면 다음 사람이 되돌린다.
  check('흰 face_panel이 들어 있다 — 2D PNG와 같은 얼굴이어야 교체가 안 튄다',
    got.includes('226,246,255'));

  // 잘못된 입력은 조용히 이상하게 그리지 말고 던져야 한다(호출측이 2D로 남는다).
  const bad = Buffer.from(raw.subarray(0, 40));
  let threwShort = false;
  try { M.parseBotMesh(bad); } catch { threwShort = true; }
  check('잘린 파일은 파싱이 던진다 — 반쪽 데이터를 GPU에 올리지 않는다', threwShort);
  const wrongMagic = Buffer.from(raw);
  wrongMagic[0] = 0x58;
  let threwMagic = false;
  try { M.parseBotMesh(wrongMagic); } catch { threwMagic = true; }
  check('매직이 다르면 파싱이 던진다', threwMagic);

  // ── ⑷ 폴백 ──────────────────────────────────────────────────────────────
  // ⓐ 렌더러 생성이 예외가 아니라 null — 심사위원 기기를 고를 수 없다.
  check('canvas가 없으면 렌더러는 null(던지지 않는다)', M.createBotRenderer(null, mesh) === null);
  check('getContext가 없는 객체여도 null', M.createBotRenderer({}, mesh) === null);
  check('WebGL2를 못 만들면 null — 이 경로가 2D 폴백의 문이다',
    M.createBotRenderer({ getContext: () => null }, mesh) === null);
  check('mesh가 없으면 null', M.createBotRenderer({ getContext: () => ({}) }, null) === null);

  // ⓑ 3D 모듈이 SSR에서 안 죽는다(모듈 최상위에서 window/document를 안 만진다).
  const { default: GuideBot3D } = await server.ssrLoadModule('/src/components/GuideBot3D.jsx');
  const canvasHtml = renderToString(createElement(GuideBot3D, {}));
  check('GuideBot3D가 SSR에서 렌더된다 — 서버 렌더 스모크를 깨지 않는다',
    canvasHtml.includes('data-testid="guide-bot-canvas"'));
  check('3D 캔버스는 포인터를 먹지 않는다 — 밑의 접기 버튼·드래그가 살아 있어야 한다',
    canvasHtml.includes('pointer-events-none'));
  check('3D 캔버스는 aria-hidden 장식이다 — 의미는 말풍선(role=status)이 전달한다',
    canvasHtml.includes('aria-hidden="true"'));

  // ⓒ 안내봇 본체: SSR에서 **2D PNG가 실제로 그려진다**(3D는 나중에 얹힌다).
  const { default: GuideBot } = await server.ssrLoadModule('/src/components/GuideBot.jsx');
  const html = renderToString(createElement(GuideBot, { pathname: '/board', state: {} }));
  check('SSR 첫 페인트에 2D PNG가 그려진다 — 3D가 늦거나 실패해도 빈 자리가 없다',
    html.includes('src="/guidebot.png"'));
  check('SSR에는 3D 캔버스가 없다 — 서버가 GL 청크를 끌고 오지 않는다',
    !html.includes('data-testid="guide-bot-canvas"'));
  check('첫 페인트는 3D 미가동 상태로 표시된다', html.includes('data-guide-3d="0"'));
  check('PNG가 숨겨져 있지 않다 — 3D가 살아나기 전에 감추면 아무것도 안 보인다',
    !/guidebot\.png[^>]*invisible|invisible[^>]*guidebot\.png/.test(html));
  // 기존 26건 계약이 이 작업으로 밀리지 않았는지 여기서도 얇게 확인한다.
  check('기존 계약이 살아 있다 — role=status · 기본 자리 · 규칙 표시',
    html.includes('role="status"') && html.includes('data-guide-placed="0"')
    && html.includes('data-guide-rule="/board"'));

  // ⓓ 소스 규약: 모듈 최상위에서 브라우저 전역을 만지지 않는다.
  const meshSrc = await readFile(resolve(root, 'src/lib/guideBotMesh.js'), 'utf8');
  const topLevel = meshSrc
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')       // 주석 제거
    .replace(/(?:export\s+)?(?:async\s+)?function[\s\S]*?\n}/g, ''); // 함수 본문 제거
  check('guideBotMesh 최상위에 window·document·fetch 호출이 없다(SSR 계약)',
    !/\b(window|document)\b|\bfetch\s*\(/.test(topLevel));
  check('guideBotMesh는 외부 라이브러리를 import하지 않는다 — 의존 0이 이 기능의 전제다',
    !/^\s*import\s/m.test(meshSrc));

  // ── ⑹ 자세: 원근·미세 모션·커서 추종·말할 때 반응 ───────────────────────
  // 2026-08-13 피드백("3D가 평평하다 · 튀어나와 말하는 것 같아야 한다")이 만든 절.
  // 계산은 순수 함수라 브라우저 없이 그대로 검산한다.
  const vsSrc = (await readFile(resolve(root, 'src/lib/guideBotMesh.js'), 'utf8'));
  check('투영이 원근이다 — gl_Position.w가 1이 아니라 -p.z다(직교로 되돌리면 평평해진다)',
    /gl_Position\s*=\s*vec4\([\s\S]*?-p\.z\)/.test(vsSrc) && /uProj/.test(vsSrc));

  const p0 = M.botPose({ tMs: 0 });
  const pUp = M.botPose({ tMs: M.BOB_MS / 4 });
  const pDown = M.botPose({ tMs: (M.BOB_MS * 3) / 4 });
  check('상시 부유가 있다 — 정지한 3D는 2D와 구별되지 않는다',
    Math.abs(pUp.bobY - M.BOB_AMP) < 1e-6 && Math.abs(pDown.bobY + M.BOB_AMP) < 1e-6);
  check('부유 진폭이 과하지 않다 (≤5% 높이) — 크면 멀미가 난다', M.BOB_AMP <= 0.05);
  check('요잉은 「살아 있음」 수준이다 (≤10°) — 큰 회전은 뒤통수를 보여 준다',
    M.SWAY_RAD <= 0.18 && Math.abs(p0.yaw) <= M.SWAY_RAD + 1e-9);

  const box = { left: 0, top: 0, width: 112, height: 112 };
  const far = M.lookTarget(box, { x: 99999, y: 56 }, false);
  const near = M.lookTarget(box, { x: 56, y: 56 }, false);
  check('커서를 따라 고개가 돈다', far.yaw > 0.05);
  check('추종 각도가 상한(±12°/±8°) 안이다 — 목이 꺾여 보이면 안 된다',
    Math.abs(far.yaw) <= M.LOOK_YAW + 1e-9 && Math.abs(far.pitch) <= M.LOOK_PITCH + 1e-9);
  check('정중앙 커서는 정면이다', Math.abs(near.yaw) < 1e-9 && Math.abs(near.pitch) < 1e-9);
  check('드래그 중에는 추종을 끈다 — 끄는 손과 보는 고개가 싸운다',
    M.lookTarget(box, { x: 99999, y: 0 }, true).yaw === 0);

  const react = M.botPose({ tMs: 0, reactAge: M.REACT_MS / 2 });
  const afterReact = M.botPose({ tMs: 0, reactAge: M.REACT_MS + 1 });
  check('말풍선이 바뀌면 앞으로 튀어나오는 펄스가 있다 — 「말하는 것 같은」의 핵심',
    react.pulse > 1.05);
  check('반응은 0.5초 안에 끝난다', M.REACT_MS <= 500 && Math.abs(afterReact.pulse - 1) < 1e-9);
  check('반응이 고개 끄덕임을 동반한다', Math.abs(M.botPose({ tMs: 0, reactAge: M.REACT_MS * 0.25 }).pitch) > 0.05);

  // ⚠️ 접근성 계약 — reduced-motion이면 **전부** 멈춘다("조금만"은 타협이 아니다).
  const still = [0, M.BOB_MS / 4, 1234].map((tMs) => M.botPose({
    tMs, reduced: true, look: { yaw: 0.2, pitch: 0.1 }, reactAge: M.REACT_MS / 2,
  }));
  check('prefers-reduced-motion이면 부유·요잉·추종·반응이 전부 멈춘다',
    still.every((p) => p.yaw === 0 && p.pitch === 0 && p.bobY === 0 && p.pulse === 1));

  check('접지 그림자가 SSR에 있다 — 「떠 있다」는 그림자가 만든다',
    canvasHtml.includes('data-testid="guide-bot-shadow"'));

  // ── ⑺ 크기 계약 ─────────────────────────────────────────────────────────
  // 클라이언트 지시로 56 → 128px로 키웠다(2026-08-13). **클램프 상수와 실제 렌더
  // 크기가 어긋나면 캐릭터가 화면 밖으로 나가 돌아오지 못한다** — 사람이 눈으로
  // 볼 수 없는 결함이라(큰 모니터에서는 멀쩡하다) 여기서 못박는다.
  const botSrc = await readFile(resolve(root, 'src/components/GuideBot.jsx'), 'utf8');
  const sizeConst = Number(/const SIZE = (\d+)/.exec(botSrc)?.[1]);
  const btnRem = Number(/grid h-(\d+) w-\1 flex-none/.exec(botSrc)?.[1]);
  const btnBig = Number(/2xl:h-(\d+) 2xl:w-\1/.exec(botSrc)?.[1]);
  const figRem = Number(/relative block h-(\d+) w-\1/.exec(botSrc)?.[1]);
  // 해상도 검증(2026-08-13): 1366×768에서 128px 캐릭터가 본문을 141px 덮었다.
  // 본문(max-w-6xl=1152)이 사이드바 208을 뺀 1158 안에 들어가 좌우 여백이 3px뿐이라
  // 그렇다. 1920은 여백 280px이라 안 겹친다. 1366은 md·lg·xl에 전부 걸리므로
  // **2xl(1536)만이 둘을 가르는 분기점**이다 — 이 단정이 그 사실을 못박는다.
  check(`기본 크기가 96px 이상이다 (실측 ${btnRem * 4}px)`, btnRem * 4 >= 96);
  check(`넓은 화면에서만 커진다 — 2xl 분기 존재 (${btnBig * 4}px)`,
    Number.isFinite(btnBig) && btnBig > btnRem);
  check(`1366에서 본문을 안 덮는다 — 기본 ${btnRem * 4}px + 여백 16 ≤ 셸 여백 이내`,
    btnRem * 4 <= 96);
  // SIZE는 노드를 못 재는 순간(첫 읽기·SSR)의 폴백이다. 작은 쪽에 맞추면 큰
  // 화면에서 캐릭터가 밖으로 나가므로 **가장 큰 값**과 같아야 한다.
  check(`SIZE 상수 = 가질 수 있는 최대 크기 (${sizeConst} vs ${btnBig * 4}px)`,
    sizeConst === btnBig * 4);
  // ⚠️ 위 단정만으로는 **부족하다**. SIZE는 캐릭터 하나의 크기인데 화면에서 자리를
  // 잡는 것은 말풍선까지 포함한 **상자 전체**(≈408px)라, SIZE로만 클램프하면
  // 오른쪽으로 넘친다. 코드 리뷰가 *"이 테스트가 오히려 버그를 고정한다"*고 잡았다.
  // 그래서 클램프가 **실제 노드를 재는지**를 함께 못박는다 — SIZE는 노드를 못 받는
  // 첫 읽기·SSR용 폴백으로만 남아야 한다.
  check('clamp가 노드 실측을 쓴다 — getBoundingClientRect 경유',
    /function clamp\(pos, win, node\)/.test(botSrc)
    && /node\?\.getBoundingClientRect\?\.\(\)/.test(botSrc));
  check('clamp 호출부가 전부 노드를 넘긴다 (리사이즈·드래그·첫 읽기)',
    (botSrc.match(/clamp\([^)]*window, (?:nodeRef\.current|node)\)/g) || []).length >= 2
    && /return clamp\(parsed, win, node\)/.test(botSrc));
  // 드래그와 클릭이 서로를 잡아먹지 않는지 — 리뷰가 잡은 3번.
  // ⚠️ **주석을 걷어내고 본다.** 이 파일은 왜 캡처를 미루는지를 주석으로 길게
  // 설명하고 있어서, 날것의 소스로 검사하면 그 설명 문장을 코드로 오인한다
  // (실제로 처음 쓴 단정이 그렇게 거짓 빨강을 냈다).
  const code = botSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const downBody = /const onPointerDown[\s\S]*?\}, \[\]\);/.exec(code)?.[0] ?? '';
  const moveBody = /const onPointerMove[\s\S]*?\}, \[\]\);/.exec(code)?.[0] ?? '';
  check('포인터 캡처를 누르는 즉시 걸지 않는다 (안쪽 버튼의 click을 죽인다)',
    downBody.length > 0 && !/setPointerCapture/.test(downBody));
  check('캡처는 실제로 움직인 뒤에 건다 (그때는 클릭이 아니라 드래그다)',
    /setPointerCapture/.test(moveBody));
  check('드래그 문턱이 있고, 끈 뒤의 click은 캡처 단계에서 삼킨다',
    /DRAG_SLOP/.test(botSrc) && /onClickCapture/.test(botSrc));
  // 탭바(md:hidden)에 가리지 않는지 — 리뷰가 잡은 5번.
  check('바닥 여백 분기가 md다 (sm이면 640~767px에서 탭바가 캐릭터를 덮는다)',
    /md:bottom-6/.test(botSrc) && !/sm:bottom-6/.test(botSrc));
  check(`2D PNG와 3D 캔버스가 같은 박스를 쓴다 (${figRem * 4}px)`,
    Number.isFinite(figRem) && figRem < btnRem && new RegExp(`h-${figRem} w-${figRem}`).test(botSrc));

  // ── ⑸ 베이킹 결정성 ─────────────────────────────────────────────────────
  // 커밋된 산출물과 대조하지 않는다 — 부동소수 미세차가 OS/BLAS마다 갈릴 수 있어
  // 거짓 빨강이 된다. **같은 기계에서 두 번 구워 대조**하는 것이 결정성의 정의다.
  const py = ['python3', 'python'].find((p) => {
    const r = spawnSync(p, ['-c', 'import numpy'], { encoding: 'utf8' });
    return r.status === 0;
  });
  const bake = resolve(repo, 'scripts/bake_mascot_glb.py');
  const glb = resolve(repo, 'design/mascot/weathermind-bot.glb');
  if (!py) skip('베이킹 결정성', 'numpy를 쓸 수 있는 python이 없다');
  else if (!existsSync(glb)) skip('베이킹 결정성', '원본 glb가 없다(디자인 자산 미배포)');
  else {
    const dir = await mkdtemp(join(tmpdir(), 'guidebot-bake-'));
    try {
      const a = join(dir, 'a.mesh');
      const b = join(dir, 'b.mesh');
      const r1 = spawnSync(py, [bake, a], { encoding: 'utf8' });
      const r2 = spawnSync(py, [bake, b], { encoding: 'utf8' });
      check('베이킹 스크립트가 두 번 다 성공한다', r1.status === 0 && r2.status === 0);
      if (r1.status === 0 && r2.status === 0) {
        const [ba, bb] = [await readFile(a), await readFile(b)];
        check('같은 입력 → 같은 출력 바이트 (결정적)', ba.equals(bb));
        check('갓 구운 결과가 커밋된 자산과 같은 크기다 — 자산이 소스보다 낡지 않았다',
          ba.byteLength === bytes);
      } else {
        console.error((r1.stderr || r2.stderr || '').split('\n').slice(-4).join('\n'));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
} finally {
  await server.close();
}

// ── jsdom: WebGL이 없는 브라우저에서 2D가 실제로 남는가 ──────────────────────
// SSR만으로는 "첫 렌더에 PNG가 있다"까지밖에 못 본다. 사용자가 실제로 겪는 것은
// **마운트 후 3D가 실패하고 나서도 PNG가 그대로인가**이므로 여기서 붙여 돌린다.
// 관례는 boardHintCharacter.smoke.test.mjs와 같다(getContext를 null로 고정).
{
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/', pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.localStorage = window.localStorage;
  window.localStorage.setItem('weathermind.locale', 'ko');
  for (const k of ['HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'getComputedStyle']) {
    globalThis[k] = window[k];
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  globalThis.matchMedia = window.matchMedia;
  // **이 한 줄이 이 절의 전부다** — 심사위원 기기에 WebGL2가 없는 상황.
  window.HTMLCanvasElement.prototype.getContext = () => null;

  const vite2 = await createServer({
    root, logLevel: 'error', server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { createElement: h } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { default: GuideBot } = await vite2.ssrLoadModule('/src/components/GuideBot.jsx');

    const host = window.document.getElementById('root');
    const rootNode = createRoot(host);
    rootNode.render(h(GuideBot, { pathname: '/board', state: {} }));
    // 유휴 로딩(400ms 타이머) + 동적 import + 실패 처리까지 넉넉히 기다린다.
    await new Promise((r) => setTimeout(r, 1500));

    const img = window.document.querySelector('[data-testid="guide-bot"] img');
    check('WebGL이 없어도 마운트가 죽지 않는다', Boolean(window.document.querySelector('[data-testid="guide-bot"]')));
    check('2D PNG가 실제로 DOM에 그려져 있다', img?.getAttribute('src') === '/guidebot.png');
    check('PNG가 숨겨지지 않았다 — 3D가 못 뜨면 감추면 안 된다',
      !(img?.getAttribute('class') ?? '').includes('invisible'));
    check('3D 미가동으로 표시된다(data-guide-3d="0")',
      window.document.querySelector('[data-guide-3d]')?.getAttribute('data-guide-3d') === '0');
    check('말풍선은 그대로 읽힌다 — 3D 실패가 접근성을 건드리지 않는다',
      Boolean(window.document.querySelector('[data-testid="guide-bot-bubble"][role="status"]')));
    rootNode.unmount();
  } finally {
    await vite2.close();
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 안내봇 3D(자산 계약·드로우콜 예산·얼굴판 제외·2D 폴백·베이킹 결정성) 스모크 통과');
