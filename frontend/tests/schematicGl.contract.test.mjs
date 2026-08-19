/**
 * 탐구 모식도 3종 계약 (MT-22 재제작) — `node tests/schematicGl.contract.test.mjs`
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  이 파일이 무엇을 물게 됐는지 — **가드의 대상이 바뀌었다(2026-08-19)**
 * ══════════════════════════════════════════════════════════════════════════════
 * 종전 판은 **MT-22 전용 입체 화살표 렌더러**(`schematic/renderer.js` + `arrowMesh`)를
 * 물었다: 원기둥 메시가 닫혔는가 · 수직 화살표 특이점 · 깊이 테스트가 켜졌는가.
 * 그 가드는 **전부 초록이었는데 화면은 반려됐다.** 클라이언트 문장이 이유를 정확히
 * 짚는다 — *"내가 원한 모식은 **우리 보드 세션과 같은 모식**인데 지금 **화살표로 지
 * 멋대로**잖아"*. 즉 **화살표를 잘 그렸는지**를 아무리 물어도 **그림이 있는지**는
 * 묻지 못했다. 실측이 그것을 값으로 보여 준다(재제작 전 0단계 항목 수):
 *   T1 `{line 8, label 4, arrow 1}` · T2 `{line 4, label 5, arrow 8}`
 * **그림 요소가 0개인 단계가 초록으로 통과했다.**
 *
 * 그래서 이 판은 **무대 문법**을 먼저 문다(§1). 세 장면은 이제 보드 판정 화면과
 * **같은 무대**(`board/webgl/crossSection/`) 위에 서고, 그 무대를 복제가 아니라
 * `composeScene`으로 **그대로 쓰는지**까지 소스로 확인한다.
 *
 * ⚠️ **파킹된 것**: `schematic/renderer.js`·`arrowMesh.js`·`shaders.js`·`camera.js`·
 * `glCore.js`·`SchematicGL.jsx`는 **지금 아무도 쓰지 않는다**(보드 무대로 갈아탔다).
 * 지우지 않고 남겨 두었고, 존치·철거 판단은 PM 몫이다. 그래서 **여기서 더 이상
 * 물지 않는다** — 안 쓰는 코드를 무는 초록은 「검증됐다」는 착각만 만든다.
 *
 * ── 🔴 이 가드가 못 재는 것 ──────────────────────────────────────────────────
 *  · **셰이더 문법·픽셀.** node에는 GL도 픽셀도 없다. 「보드와 같아 보이는가」는
 *    사람이 실브라우저에서 본다 — 이 저장소에 **스텁 초록인데 실브라우저에서
 *    단면이 한 번도 안 뜬** 전례가 있다(R10-06).
 *  · **드로우콜 예산·단계 스윕**은 `crossSectionWebgl.contract.test.mjs`가 소유한다
 *    (규칙 전건 + **탐구 장면 3종**. 그쪽에 이미 스텁 GL이 있어 중복을 안 만든다).
 *
 * 고장 주입(가드가 공허하지 않음을 증명할 때만 쓴다):
 *   WM_FAULT=stage-empty   0단계에서 그림 요소를 걷어낸다
 *                          (= 반려된 「검은 상자에 글자 4개」와 같은 관측)
 *   WM_FAULT=stage-copy    무대를 복제한 것처럼 소스 대조를 뒤집는다
 *   WM_FAULT=thickness     굵기를 제곱근 배분으로 바꾼다(= Sankey 문법 위반)
 *   WM_FAULT=t1-rotation   T1 상층 화살표의 감김을 하층과 **같게** 만든다
 *   WM_FAULT=t1-maxwind    T1 눈 속 화살표를 가장 굵게 만든다
 *                          (= 「가운데가 제일 세다」로 틀리게 그린 장면)
 *   WM_FAULT=t2-cumulative T2에서 `until`을 걷어낸다(= 화면에 태풍이 5마리)
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMATIC = resolve(root, 'src/modules/explore/schematic');
const FAULT = process.env.WM_FAULT ?? '';

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`PASS ${name}`);
  else {
    console.error(`FAIL ${name}${detail ? `\n     → ${detail}` : ''}`);
    failed += 1;
  }
};

// vite ssrLoadModule을 쓰는 이유: 장면이 이제 `board/webgl/crossSection/scenes.js`를
// import하고 그쪽이 **확장자 없는 상대 import**를 쓴다(node ESM은 못 푼다).
// 관례는 `crossSectionWebgl.contract.test.mjs`와 같다.
const { createServer } = await import('vite');
const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const load = (p) => server.ssrLoadModule(p);
  const c1 = await load('/src/modules/explore/schematic/radiationScene.js');
  const t1 = await load('/src/modules/explore/schematic/typhoonSectionScene.js');
  const t2 = await load('/src/modules/explore/schematic/typhoonLifecycleScene.js');
  const rendererMod = await load('/src/modules/board/webgl/crossSection/renderer.js');
  const { labelsFor } = rendererMod;

  const SCENES = [
    ['C1 복사수지', c1.RADIATION_SCENE, c1.RADIATION_STEPS],
    ['T1 태풍 단면', t1.TYPHOON_SECTION_SCENE, t1.T1_STEPS],
    ['T2 태풍 생애', t2.TYPHOON_LIFECYCLE_SCENE, t2.T2_STEPS],
  ];
  const visibleAt = (scene, step) =>
    scene.items.filter((it) => (it.at ?? 0) <= step && step <= (it.until ?? Infinity));
  /** 그림 요소 — **라벨과 화살표는 여기 안 들어간다**(그것이 이 가드의 요점이다) */
  const PICTURE = new Set(['solid', 'billboard', 'precip']);

  // ═════════════════════════════════════════════════════════════════════════
  //  §1 무대 문법 — 🔴 **반려의 직접 원인을 무는 자리**
  // ═════════════════════════════════════════════════════════════════════════
  for (const [name, scene, steps] of SCENES) {
    check(`${name} — 하늘이 있다(무대는 검은 빈 상자가 아니다)`,
      Boolean(scene.sky?.top && scene.sky?.bottom) && typeof scene.night === 'boolean',
      JSON.stringify(scene.sky));

    const ground = scene.items.filter((it) => it.type === 'solid' && it.layer === 'ground');
    check(`${name} — 지표 레이어(잔디·흙 앞단면·바다)가 깔린다`, ground.length >= 3,
      `${ground.length}개 — composeScene의 groundLayer를 지나지 않았다`);

    for (let s = 0; s < steps.length; s += 1) {
      let vis = visibleAt(scene, s);
      // 고장 주입: 그림 요소를 걷어낸다 = 재제작 전 화면과 같은 관측
      if (FAULT === 'stage-empty' && s === 0) vis = vis.filter((it) => !PICTURE.has(it.type));
      const pics = vis.filter((it) => PICTURE.has(it.type));
      check(`${name} step${s} — 그림 요소가 있다(글자·화살표만인 단계 금지)`,
        pics.length > 0,
        `단계 항목 ${JSON.stringify(vis.reduce((a, it) => ({ ...a, [it.type]: (a[it.type] ?? 0) + 1 }), {}))}`
        + ' — 이것이 「검은 상자에 떠 있는 글자」의 정체다');
    }

    // 구름·기단 같은 **덩어리**가 최소 한 번은 서야 한다(선만으로는 대기가 안 보인다)
    const bodies = scene.items.filter((it) => it.type === 'billboard' || (it.type === 'solid' && it.layer !== 'ground'));
    check(`${name} — 대기 안에 덩어리(구름·층·육지)가 선다`, bodies.length >= 4, `${bodies.length}개`);

    check(`${name} — 항목의 at이 단계 수를 넘지 않는다`,
      scene.items.every((it) => (it.at ?? 0) < steps.length),
      scene.items.filter((it) => (it.at ?? 0) >= steps.length).map((it) => `${it.type}@${it.at}`).join(','));

    const types = new Set(scene.items.map((it) => it.type));
    check(`${name} — 항목 종류가 무대가 아는 것뿐(모르는 종류는 조용히 안 그려진다)`,
      [...types].every((t) => ['solid', 'billboard', 'arrow', 'precip', 'label'].includes(t)),
      [...types].join(','));

    // 라벨은 **가리키는 것 옆**에 있어야 하고 화면 안이어야 한다
    let outOfFrame = 0;
    for (let s = 0; s < steps.length; s += 1) {
      for (const l of labelsFor(scene, s, 260 / 150)) {
        if (!Number.isFinite(l.left) || !Number.isFinite(l.top)) outOfFrame += 100;
        else if (l.left < 3 || l.left > 97 || l.top < 2 || l.top > 98) outOfFrame += 1;
      }
    }
    check(`${name} — 전 단계 라벨이 화면 안에 있다(실기기 확인의 대체 측정)`, outOfFrame === 0,
      `${outOfFrame}건 프레임 밖 — 실브라우저에서 잘린다`);
  }

  // 무대를 **복제하지 않고 그대로 쓰는가** — 팔레트·관용구가 갈라지면 반려가 재발한다
  {
    const srcs = ['radiationScene.js', 'typhoonSectionScene.js', 'typhoonLifecycleScene.js']
      .map((f) => [f, readFileSync(resolve(SCHEMATIC, f), 'utf-8')]);
    for (const [f, src] of srcs) {
      const uses = FAULT === 'stage-copy' ? false : /from '\.\.\/\.\.\/board\/webgl\/crossSection\/scenes\.js'/.test(src)
        && /composeScene/.test(src);
      check(`무대 공유 — ${f}가 보드 무대(composeScene)를 그대로 쓴다`, uses,
        '무대를 복제하면 팔레트·관용구가 갈라진다 — 그 갈라짐이 반려 사유였다');
      check(`무대 공유 — ${f}가 자체 렌더러를 다시 걸지 않는다`, !/from '\.\/renderer\.js'/.test(src));
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  §2 C1 복사수지 — 그림이 아니라 **숫자**가 맞아야 한다
  // ═════════════════════════════════════════════════════════════════════════
  {
    const { UNITS, thicknessFor, radiationBalance, UNIT_THICKNESS, MIN_THICKNESS, FLOOR_UNITS, scaleFor, countFor } = c1;
    const bal = radiationBalance();
    check('C1 — 반사 35 = 구름27 + 눈얼음2 + 대기6', bal.reflected === 35, String(bal.reflected));
    check('C1 — 흡수 65 = 대기14 + 지표51', bal.absorbed === 65, String(bal.absorbed));
    check('C1 — 입사 100 = 반사 35 + 흡수 65', UNITS.incoming === bal.reflected + bal.absorbed);
    check('C1 — 지표 → 대기 34 = 잠열19 + 대류9 + 온실기체6', bal.surfaceToAir === 34, String(bal.surfaceToAir));
    check('C1 — OLR 65 = 대기창17 + 대기방출48 ⇒ 흡수와 균형', bal.outgoing === 65 && bal.outgoing === bal.absorbed);
    check('C1 — 100단위의 기준이 340 W/m²다', c1.TOA_INSOLATION_WM2 === 340 && c1.EEI_WM2 === 0.9);

    const thickFn = FAULT === 'thickness' ? (u) => Math.max(MIN_THICKNESS, Math.sqrt(Math.abs(u)) * 0.052) : thicknessFor;
    const above = [UNITS.incoming, UNITS.absorbSurface, UNITS.atmosphereIR, UNITS.reflectCloud, UNITS.latent, UNITS.windowIR, UNITS.absorbAir];
    check('C1 — 바닥 위 굵기는 에너지에 정확히 비례한다',
      above.every((u) => Math.abs(thickFn(u) - u * UNIT_THICKNESS) < 1e-12),
      above.map((u) => `${u}→${thickFn(u).toFixed(4)}(기대 ${(u * UNIT_THICKNESS).toFixed(4)})`).join(' '));
    check('C1 — 바닥 아래(2·6·9단위)는 최소 굵기로 잘린다',
      [2, 6, 9].every((u) => u < FLOOR_UNITS && thickFn(u) === MIN_THICKNESS));
    check('C1 — 굵기 순서가 에너지 순서를 뒤집지 않는다',
      [...above].sort((a, b) => a - b).every((u, i, arr) => i === 0 || thickFn(u) >= thickFn(arr[i - 1])));
    // 화면 단위로 옮긴 뒤에도 순서가 살아 있어야 Sankey가 화면에서 성립한다
    check('C1 — 화면 굵기(scaleFor)도 에너지 순서를 지킨다',
      scaleFor(100) > scaleFor(51) && scaleFor(51) > scaleFor(27) && scaleFor(27) > scaleFor(2));
    check('C1 — 다발 개수도 에너지를 말한다', countFor(100) > countFor(19) && countFor(19) > countFor(6));

    // 🔴 온실효과의 본체 — **되돌아 내려오는 장파**가 그림에 있어야 한다
    const arrows = c1.RADIATION_SCENE.items.filter((it) => it.type === 'arrow');
    check('C1 — 위로 나가는 화살표와 아래로 되돌아오는 화살표가 둘 다 있다',
      arrows.some((a) => a.dir[1] > 0.9) && arrows.some((a) => a.dir[1] < -0.9),
      '되돌림이 없으면 「나간다」로 끝나고 온실효과가 화면에서 사라진다');
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  §3 T1 태풍 단면 — 🔴 틀리게 그리면 **틀린 것을 가르치는** 사실들
  // ═════════════════════════════════════════════════════════════════════════
  {
    const { TYPHOON_SECTION_SCENE, T1_STEPS, T1_FACTS, KM_PER_UNIT, EYE_X, rightOfMotion, MOTION_DIR, tangent } = t1;
    const scene = (() => {
      if (FAULT === 't1-rotation') {
        return { ...TYPHOON_SECTION_SCENE, items: TYPHOON_SECTION_SCENE.items.map((it) => (it.ring === 'high'
          ? { ...it, spin: 1, ring: 'high', dir: [it.dir[0], it.dir[1], -it.dir[2]] } : it)) };
      }
      if (FAULT === 't1-maxwind') {
        return { ...TYPHOON_SECTION_SCENE, items: TYPHOON_SECTION_SCENE.items.map((it) => (it.type === 'arrow'
          && Math.abs(it.origin[0] - EYE_X) < 0.01 ? { ...it, scale: 0.2 } : it)) };
      }
      return TYPHOON_SECTION_SCENE;
    })();
    const arrows = scene.items.filter((it) => it.type === 'arrow');
    const radiusKm = (a) => Math.abs(a.origin[0] - EYE_X) * KM_PER_UNIT;

    // ① 최대 풍속은 **눈벽**(중심에서 40~100km)이지 중심이 아니다
    const strongest = arrows.reduce((m, a) => (a.scale > m.scale ? a : m), arrows[0]);
    check('🔴 T1 — 가장 굵은(=가장 센) 화살표가 눈벽 반지름 40~100km에 있다',
      radiusKm(strongest) >= T1_FACTS.maxWindInnerKm && radiusKm(strongest) <= T1_FACTS.maxWindOuterKm,
      `가장 굵은 화살표가 중심에서 ${radiusKm(strongest).toFixed(0)}km에 있다 — 「가운데가 제일 세다」는 틀린 그림이다`);
    const eyeArrows = arrows.filter((a) => radiusKm(a) < T1_FACTS.eyeRadiusKm);
    check('🔴 T1 — 눈 속 화살표가 눈벽보다 가늘다(눈은 약풍·하강기류)',
      eyeArrows.length > 0 && Math.max(...eyeArrows.map((a) => a.scale)) < strongest.scale,
      `눈 속 최대 ${Math.max(...eyeArrows.map((a) => a.scale))} ↔ 눈벽 ${strongest.scale}`);
    check('T1 — 눈 속에 하강 화살표가 있다(dir.y < 0)', eyeArrows.some((a) => a.dir[1] < -0.9));
    check('T1 — 눈에는 비가 안 오고 눈벽 아래에만 온다',
      scene.items.filter((it) => it.type === 'precip')
        .every((p) => p.origin[0] + p.size[0] < EYE_X - 0.02 || p.origin[0] > EYE_X + 0.02));

    // ② 하층 반시계 · 상층 시계 — **감김이 반대**여야 한다
    const low = arrows.filter((a) => a.ring === 'low');
    const high = arrows.filter((a) => a.ring === 'high');
    check('T1 — 두 층 화살표가 실재한다(공허 통과 방지)', low.length >= 6 && high.length >= 6,
      `하층 ${low.length} · 상층 ${high.length}`);
    // 좌표로 되잰다(표식이 아니라 방향벡터가 증거다): 동쪽(x>EYE_X)에서 z 성분의 부호
    const eastLow = low.filter((a) => a.origin[0] > EYE_X);
    const eastHigh = high.filter((a) => a.origin[0] > EYE_X);
    check('🔴 T1 — 동쪽 하층은 북(+z)으로 흐른다(= 위에서 볼 때 반시계)',
      eastLow.length > 0 && eastLow.every((a) => a.dir[2] > 0.3),
      `dir.z = ${eastLow.map((a) => a.dir[2].toFixed(2)).join(',')}`);
    check('🔴 T1 — 동쪽 상층은 남(-z)으로 흐른다 — 하층과 **반대**다',
      eastHigh.length > 0 && eastHigh.every((a) => a.dir[2] < -0.3),
      `dir.z = ${eastHigh.map((a) => a.dir[2].toFixed(2)).join(',')} — 같은 부호면 「반대로 감긴다」를 못 그린 것이다`);
    check('T1 — 서쪽은 동쪽과 부호가 반대다(회전이지 평행이동이 아니다)',
      low.filter((a) => a.origin[0] < EYE_X).every((a) => a.dir[2] < -0.3));
    check('T1 — 접선 함수의 부호 규약이 문서대로다(p × ŷ)',
      tangent([1, 0, 0], 1)[2] > 0 && tangent([1, 0, 0], -1)[2] < 0);

    // ③ 위험반원 — 진행 방향 **오른쪽**이 더 세다
    const right = rightOfMotion();
    check('T1 — 오른쪽 단위벡터가 진행 방향과 직교하고 동쪽이다',
      Math.abs(right[0] * MOTION_DIR[0] + right[2] * MOTION_DIR[2]) < 1e-9 && right[0] > 0, JSON.stringify(right));
    const eastMax = Math.max(...low.filter((a) => a.origin[0] > EYE_X).map((a) => a.scale));
    const westMax = Math.max(...low.filter((a) => a.origin[0] < EYE_X).map((a) => a.scale));
    check('🔴 T1 — 위험반원(오른쪽)이 반대쪽보다 굵다(비대칭이 구조의 일부)',
      eastMax > westMax, `오른쪽 ${eastMax.toFixed(3)} ↔ 왼쪽 ${westMax.toFixed(3)}`);

    check('T1 — 눈벽에 수직 상승 화살표가 있다', arrows.some((a) => a.dir[1] > 0.9));
    check('T1 — 축척이 조사값과 맞는다(눈 25km · 구름 꼭대기 12~20km)',
      T1_FACTS.eyeRadiusKm * 2 >= 20 && T1_FACTS.eyeRadiusKm * 2 <= 50
      && T1_FACTS.cloudTopKm >= 12 && T1_FACTS.cloudTopKm <= 20);
    check('T1 — 단계가 메커니즘 순서다(무대 → 유입 → 상승/하강 → 유출 → 결론)',
      T1_STEPS.map((s) => s.key).join(',') === 'stage,inflow,updraft,outflow,danger');
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  §4 T2 태풍의 생애 — 🔴 **시간 전개**가 무대 계약 안에서 성립하는가
  // ═════════════════════════════════════════════════════════════════════════
  {
    const { TYPHOON_LIFECYCLE_SCENE, T2_STEPS, T2_STAGES, t2Checks, zOfLat, xOfLon, speedLen } = t2;
    const scene = FAULT === 't2-cumulative'
      ? { ...TYPHOON_LIFECYCLE_SCENE, items: TYPHOON_LIFECYCLE_SCENE.items.map(({ until, ...rest }) => rest) }
      : TYPHOON_LIFECYCLE_SCENE;

    const perStep = T2_STEPS.map((_, s) => new Set(visibleAt(scene, s).filter((it) => it.storm).map((it) => it.storm)).size);
    check('🔴 T2 — 단계마다 태풍이 정확히 하나다(시간 전개이지 누적이 아니다)',
      perStep.every((n) => n === 1), `단계별 태풍 수 ${perStep.join(',')} — 2 이상이면 지난 단계가 안 사라진 것이다`);
    const track = T2_STEPS.map((_, s) => visibleAt(scene, s).filter((it) => it.track).length);
    check('T2 — 지나온 경로는 누적된다', track.every((n, i) => i === 0 || n > track[i - 1]), track.join(','));

    const c = t2Checks();
    check('🔴 T2 — 전향은 북위 20~30° 사이에서 일어난다', c.recurveLat >= 20 && c.recurveLat <= 30, `${c.recurveLat}°`);
    check('🔴 T2 — 전향 때 정체(가장 짧은 이동) → 전향 후 급가속(가장 긴 이동)',
      c.stallLen < c.growLen && c.growLen < c.accelLen,
      `정체 ${c.stallLen.toFixed(3)} · 발달 ${c.growLen.toFixed(3)} · 가속 ${c.accelLen.toFixed(3)}`);
    check('T2 — 이동 거리가 속도(km/h)에 비례한다', Math.abs(speedLen(40) / speedLen(20) - 2) < 1e-9);
    check('T2 — 세력의 키가 최성기에서 최대다', T2_STAGES[2].height === Math.max(...T2_STAGES.map((s) => s.height)));
    check('T2 — 회전은 북반구 저기압성(반시계) 하나뿐', c.spins.length === 1 && c.spins[0] === 1);
    check('T2 — 위도가 커질수록 북(+z, 보드 규약)으로 간다', zOfLat(40) > zOfLat(20) && zOfLat(20) > zOfLat(10));
    check('T2 — 경도가 커질수록 동(+x)으로 간다', xOfLon(145) > xOfLon(127) && xOfLon(127) > xOfLon(115));
    check('T2 — 단계 수와 조사의 생애 단계가 맞는다(형성·발달·최성/전향·가속·ET)',
      T2_STEPS.length === 5 && c.lastKey === 'et');
    check('T2 — ET 단계 문구가 「사라진다」가 아니라 「성질이 바뀐다」다',
      /성질이 바뀐/.test(T2_STAGES[4].note) && !/사라진다$/.test(T2_STAGES[4].note));
    // 🔴 지도가 있어야 「어디로 가는가」가 좌표놀이가 아니게 된다
    const land = scene.items.filter((it) => it.type === 'solid' && it.layer !== 'ground' && it.center[1] < 0.02);
    check('🔴 T2 — 바다 위에 육지가 서 있다(위도선만 있던 것이 반려 사유였다)',
      land.length >= 6, `${land.length}덩어리`);
    // 태풍의 자리가 좌표의 단일 소유자에서 나오는가(손으로 적은 x가 지도와 어긋났었다)
    const stormAt = (s) => visibleAt(scene, s).find((it) => it.column);
    check('T2 — 태풍의 자리가 경위도에서 파생된다(손으로 적은 좌표가 아니다)',
      T2_STAGES.every((st, i) => Math.abs(stormAt(i).origin[0] - xOfLon(st.lon)) < 1e-9
        && Math.abs(stormAt(i).origin[2] - zOfLat(st.lat)) < 1e-9));
  }
} finally {
  await server.close();
}

console.log(failed === 0 ? '\nOK — 탐구 모식도 3종이 보드 무대 문법을 지킨다' : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
