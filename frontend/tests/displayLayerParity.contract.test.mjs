/**
 * 표시 계층 전수 패리티 계약 (MT / 2026-08-18)
 *   실행: cd frontend && node tests/displayLayerParity.contract.test.mjs
 *         (npm run test:display-parity — ci.sh FRONT_TESTS 등록됨)
 *
 * ── 왜 이 파일이 생겼나 ──────────────────────────────────────────────────────
 * **같은 뿌리의 결함이 세 번 났다.** 규칙·현상을 들이는 커밋이 표시 계층 표에
 * 행을 안 넣었고, 그때마다 화면만 조용히 비었다:
 *   ① `PRECIP_META` 3종 누락 (MT-18 통합 중 발견)
 *   ② `SCENE_BY_RULE` 3종 누락 (㉣ 커밋 46e3ef4·99b7bc1)
 *   ③ `PHENOMENON_META`는 **검증이 아예 없었다** — `metaDict`가 키를 동적 경로
 *      (`board.meta.phenomenon.${key}.label`)로 만들어 리터럴 `t()` 스캐너에
 *      안 보이고, ko·en 양쪽에서 동시에 빠지면 i18n 키 패리티도 통과한다.
 *
 * 🔴 **「계약이 붉어지는 것」과 「그 계약이 무언가를 지키는 것」은 다르다.**
 * ①②에는 계약이 있었는데도 새 규칙을 못 봤다 — `mapOverlayGeometry.contract`가
 * `PRECIP_META`에 대해 검사한 것은 *"강수 현상 4종(shower·persistent_rain·rain·
 * snow)을 갖고 있는가"*, 즉 **자기가 이미 가진 키의 목록**이었다. 표가 안 자라도
 * 초록이다. 그래서 이 파일의 단 하나의 규칙은:
 *
 *   👉 **요구 집합을 손으로 적지 않는다. `database/seed/board_rules.json`에서 판다.**
 *
 * 규칙 파일에 규칙·현상이 들어오면 요구 집합이 저절로 자라고, 표가 안 자라면 운다.
 *
 * ── 두 개의 면제 대장 — 「옳게 없는 것」과 「빠진 것」은 다르다 ────────────────
 * 빈칸을 전부 누락으로 세면 이 계약이 거짓 경보를 만든다(`PRECIP_META`에 `clear`가
 * 없는 것은 결함이 아니다 — 맑은 날엔 비가 안 온다). 그래서 대장을 **둘로 가른다**:
 *
 *   `CORRECT_ABSENCES` 물리·설계상 **있으면 안 되는** 칸. 영구.
 *                      역압력: 표에 **생기면** 운다("근거가 낡았다").
 *   `KNOWN_GAPS`       메워야 하는데 **아직 수리가 배정 안 된** 칸. 한시.
 *                      역압력: 표에 **생기면** 운다("메워졌다 — 목록에서 지울 것").
 *
 * 두 대장 다 `why`가 **값이 아니라 근거**여야 한다. 선례는
 * `backend/tests/test_curriculum_band_fallback.py`의 `KNOWN_ORDER_VIOLATIONS`
 * (양방향 래칫 — 기지 위반이 해소되면 "지울 것"이라고 운다).
 *
 * ⚠️ **㉣ 3종(cold_front_squall_storm·siberian_gale_wildfire·front_convergence_flood)의
 * 단면 장면은 일부러 대장에 넣지 않았다.** 다른 담당이 지금 메우고 있어
 * **수리가 배정된** 공백이기 때문이다 — 대장에 넣으면 그 담당이 병합할 때
 * 「지울 것」으로 한 번 더 울려 일이 늘고, 그 사이 이 계약은 공백을 승인해 버린다.
 * 그래서 이 파일은 **지금 빨갛게 서는 것이 정상**이고, 그 담당의 작업이 병합되면
 * 초록이 된다. 나머지 기지 공백은 전부 `KNOWN_GAPS`에 근거와 함께 있다.
 *
 * ── 이 계약이 못 무는 것 ─────────────────────────────────────────────────────
 *  · **행이 있는데 값이 틀린 것.** 키 존재만 본다 — 잘못된 이모지·엉뚱한 색은 못 본다.
 *  · **표가 아닌 분기.** `PeninsulaMap`의 `clearLike = cloud==='none' && (clear||heatwave)`
 *    같은 인라인 조건은 키 집합이 없어 스윕 대상이 아니다(감사 보고 참조).
 *  · **새 표가 생기는 것.** 아래 `TABLES`에 등록해야 검사된다 — 표 자체의 전수성은
 *    사람의 스윕이 소유한다. 새 표를 만들면 여기 한 줄을 넣을 것.
 *  · **en 화면 영향.** `detectLocale`이 ko 고정이라(2026-08-13) en은 휴면 자산이다.
 *    그래도 en을 검사하는 이유는 되살릴 때 공백이 그대로 드러나기 때문이다.
 *
 * ── 고장 주입(되돌림 게이트) ─────────────────────────────────────────────────
 *   WM_FAULT=drop-row      `PHENOMENON_META`에서 행 하나를 지운 사본으로 검사
 *   WM_FAULT=fake-rule     규칙 파일에 가짜 규칙 1건을 주입(새 규칙·새 현상 상황)
 *   WM_FAULT=stale-exempt  이미 표에 있는 키를 `CORRECT_ABSENCES`에 넣는다(면제 근거 만료)
 *   WM_FAULT=orphan-exempt 요구 집합에 없는 키를 면제한다(유령 면제 — 아무것도 안 지킴)
 *   WM_FAULT=filled-gap    `KNOWN_GAPS` 키를 표에 심는다(공백 해소 — 지울 것)
 *   WM_FAULT=break-parse   소스 파싱 산출을 비운다(파서가 조용히 죽는 것 차단)
 *   WM_FAULT=hangul-new    면제 없는 파일에 한국어가 생긴 상황(고정 목록이 못 보던 자리)
 *   WM_FAULT=hangul-drift  면제 줄 수가 실측과 어긋난 상황(외부화 진행 — 목록 갱신)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // frontend/
const repo = resolve(root, '..');
const FAULT = process.env.WM_FAULT ?? '';

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}${detail ? `\n${detail}` : ''}`);
    failed += 1;
  }
};

// ── 요구 집합의 소유자 — 규칙 파일 하나 ──────────────────────────────────────
const RULES_PATH = resolve(repo, 'database/seed/board_rules.json');
const rules = JSON.parse(readFileSync(RULES_PATH, 'utf-8'));
if (FAULT === 'fake-rule') {
  // 새 규칙이 새 현상을 들고 들어온 상황 그대로 — 표가 안 자라면 전부 울어야 한다.
  rules.push({
    id: 'fault_injected_rule',
    priority: 1,
    when: ['sun>=99'],
    then: { phenomenon: 'fault_phenomenon', cloud: 'cumulonimbus' },
    explain: '고장 주입',
  });
}

const uniq = (xs) => [...new Set(xs)].sort();
const RULE_IDS = uniq(rules.map((r) => r.id));
const RULE_PHENOMENA = uniq(rules.map((r) => r.then?.phenomenon).filter(Boolean));
const RULE_CLOUDS = uniq(rules.map((r) => r.then?.cloud).filter(Boolean));

// ── 모듈 적재 (vite SSR — crossSectionWebgl.contract 선례) ────────────────────
const { createServer } = await import('vite');
const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const load = (p) => server.ssrLoadModule(p);
  const engine = await load('/src/lib/boardEngine.js');
  const display = await load('/src/modules/board/boardDisplay.js');
  const symbols = await load('/src/modules/board/boardSymbols.jsx');
  const infographic = await load('/src/modules/board/mapInfographic.jsx');
  const overlay = await load('/src/modules/board/webgl/mapOverlay/overlayScene.js');
  const panel = await load('/src/modules/board/CrossSectionPanel.jsx');
  const glScenes = await load('/src/modules/board/webgl/crossSection/scenes.js');
  const atmosphere = await load('/src/modules/board/AtmosphereBoard.jsx');
  const i18n = await load('/src/i18n/core.js');

  const { PHENOMENON_ENUM, CLOUD_ENUM, AIR_MASS_SUBTYPES, FRONT_SUBTYPES, DEFAULT_RESULT } = engine;

  // 기본 판정(§3.2)은 규칙이 하나도 안 서는 존의 결과다 — 규칙 파일에 없지만
  // **화면에는 뜬다.** 요구 집합에서 빼면 `cloudy`·`cumulus`가 영원히 검사 밖이다.
  const ALL_PHENOMENA = uniq([...RULE_PHENOMENA, DEFAULT_RESULT.phenomenon]);
  const ALL_CLOUDS = uniq([...RULE_CLOUDS, DEFAULT_RESULT.cloud]);

  // 강수 에미터를 **요구하는** 현상 = 비를 내리는 구름을 결과로 갖는 현상.
  // 목록이 아니라 규칙이라 새 규칙이 들어오면 저절로 자란다. 근거는 overlayScene의
  // 자기 주석 — "침수는 「비가 그치지 않는 상태」다 … 비층운만 뜨고 비가 안 내리면
  // 그 존만 그림이 멈춰 보인다 / 산불은 cloud=none이라 강수·구름이 없는 것이 옳다".
  const PRECIPITATING_CLOUDS = new Set(['cumulonimbus', 'nimbostratus']);
  const PRECIP_PHENOMENA = uniq(
    rules.filter((r) => PRECIPITATING_CLOUDS.has(r.then?.cloud)).map((r) => r.then?.phenomenon),
  );

  // 재난 배너를 요구하는 현상 — `_risk`(주의보급)·`_warning`(경보급)은 이 저장소의
  // 재난 등급 명명 규약이다(board_engine.PHENOMENA 주석: "「위험(주의보)」 위의 경보급").
  // ⚠️ `severe_storm`은 규약 밖 이름이라 여기 안 들어온다 — 판단 필요(보고 ⑥).
  const DISASTER_PHENOMENA = ALL_PHENOMENA.filter((p) => /_(risk|warning)$/.test(p));

  // 지도 구름 변형의 정의역 — `cloudVariantFor`를 **실제 판정 결과 전건**에 돌려서
  // 뽑는다. 손으로 적으면 새 (현상, 구름) 조합이 생겨도 안 자란다.
  const outcomes = [
    ...rules.map((r) => ({ ...r.then, rule_id: r.id })),
    { ...DEFAULT_RESULT, rule_id: null },
  ];
  const VARIANTS = uniq(outcomes.map((o) => overlay.cloudVariantFor(o)).filter(Boolean));

  // ── 소스 텍스트 파싱 (export되지 않는 표 · 파이썬) ──────────────────────────
  const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const stripPy = (s) => s.replace(/^\s*#.*$/gm, '');

  /** `const NAME = {` 블록의 최상위 키 (JSX 안에서 export 안 되는 표용) */
  function parseObjectKeys(file, name) {
    const src = stripJs(readFileSync(resolve(root, file), 'utf-8'));
    const head = src.indexOf(`const ${name} = {`);
    if (head < 0) return [];
    const open = src.indexOf('{', head);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = src.slice(open + 1, end);
    // 최상위(중첩 0)에서 `key:`인 것만
    const keys = [];
    depth = 0;
    for (const line of body.split('\n')) {
      const m = depth === 0 ? line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:/) : null;
      if (m) keys.push(m[1]);
      for (const ch of line) {
        if (ch === '{' || ch === '[' || ch === '(') depth += 1;
        else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
      }
    }
    return uniq(keys);
  }

  /** 파이썬 `NAME = frozenset({...})` 안의 문자열 리터럴 */
  function parsePyStrings(file, name) {
    const src = stripPy(readFileSync(resolve(repo, file), 'utf-8'));
    const head = src.indexOf(`${name} = `);
    if (head < 0) return [];
    const open = src.indexOf('{', head);
    const end = src.indexOf('}', open);
    return uniq([...src.slice(open, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
  }

  const CLOUD_VARIANT_KEYS = parseObjectKeys('src/modules/board/realisticEffects.jsx', 'CLOUD_VARIANTS');
  const BE_PHENOMENA = parsePyStrings('backend/app/services/board_engine.py', 'PHENOMENA');
  const BE_CLOUDS = parsePyStrings('backend/app/services/board_engine.py', 'CLOUDS');

  // 파서가 조용히 죽으면 「빈 집합 ⊆ 무엇이든」으로 전부 초록이 된다 — 그 분기를 막는다.
  const sane = (label, got, sentinel) =>
    check(
      `파싱 온전성 — ${label}`,
      FAULT !== 'break-parse' && got.length > 0 && got.includes(sentinel),
      `       파싱 결과: [${got}] · 표식 '${sentinel}' 없음\n` +
        '       → 소스 형태가 바뀌어 파서가 죽었다. 파서를 고치기 전에는 이 파일의\n' +
        '         해당 표 검사가 아무것도 지키지 않는다.',
    );
  sane('realisticEffects CLOUD_VARIANTS', FAULT === 'break-parse' ? [] : CLOUD_VARIANT_KEYS, 'cumulonimbus');
  sane('board_engine.py PHENOMENA', FAULT === 'break-parse' ? [] : BE_PHENOMENA, 'shower');
  sane('board_engine.py CLOUDS', FAULT === 'break-parse' ? [] : BE_CLOUDS, 'cumulus');

  // ── i18n 리소스 키 집합 ─────────────────────────────────────────────────────
  const i18nKeys = (locale, path) => {
    let node = i18n.RESOURCES[locale];
    for (const part of path.split('.')) node = node?.[part];
    return node && typeof node === 'object' ? uniq(Object.keys(node)) : [];
  };

  // ── 표 목록 ────────────────────────────────────────────────────────────────
  // effect = 그 키가 없을 때 **화면에서 무슨 일이 나는가**. 실패 메시지에 그대로 실린다.
  const withFault = (keys, table) => {
    if (FAULT === 'drop-row' && table === 'PHENOMENON_META') return keys.slice(0, -1);
    if (FAULT === 'filled-gap' && table === 'RULE_ANNOTATIONS') return uniq([...keys, 'okhotsk_sea_fog']);
    return keys;
  };

  const TABLES = [
    // ── rule_id로 키를 잡는 표 ───────────────────────────────────────────────
    {
      table: 'SCENE_BY_RULE', file: 'src/modules/board/CrossSectionPanel.jsx',
      required: RULE_IDS, keys: () => uniq(Object.keys(panel.SCENE_BY_RULE)),
      effect: '단면 스토리보드가 통째로 사라지고 explain 캡션 상자만 남는다(CrossSectionPanel `if (!story)`).',
    },
    {
      table: 'SCENES(3D)', file: 'src/modules/board/webgl/crossSection/scenes.js',
      required: RULE_IDS, keys: () => uniq(Object.keys(glScenes.SCENES)),
      effect: 'buildScene(ruleId)가 null → CrossSectionGL이 onFail로 SVG로 내려간다(3D가 조용히 사라진다).',
    },
    {
      table: 'RULE_ANNOTATIONS', file: 'src/modules/board/mapInfographic.jsx',
      required: RULE_IDS, keys: () => withFault(uniq(Object.keys(infographic.RULE_ANNOTATIONS)), 'RULE_ANNOTATIONS'),
      effect: 'ZoneAnnotation이 null을 반환 → 지도에 그 존의 현상 주석(리더선 라벨)이 안 뜬다.',
    },
    {
      table: 'i18n board.panel.story (ko)', file: 'src/i18n/resources/board.ko.js',
      required: RULE_IDS, keys: () => i18nKeys('ko', 'board.panel.story'),
      effect: '스토리보드 제목·단계가 키 원문으로 뜨거나 단계가 0개가 되어 재생이 멈춘다.',
    },
    {
      table: 'i18n board.panel.story (en)', file: 'src/i18n/resources/board.en.js',
      required: RULE_IDS, keys: () => i18nKeys('en', 'board.panel.story'),
      effect: 'en 되살릴 때 그 규칙만 한국어/키 원문으로 남는다(지금은 휴면 — detectLocale ko 고정).',
    },
    {
      table: 'i18n board.map.annotation (ko)', file: 'src/i18n/resources/board.ko.js',
      required: RULE_IDS, keys: () => i18nKeys('ko', 'board.map.annotation'),
      effect: 'RULE_ANNOTATIONS getter가 키 원문을 돌려주어 지도 라벨에 `board.map.annotation.…`이 그대로 뜬다.',
    },
    {
      table: 'i18n board.map.annotation (en)', file: 'src/i18n/resources/board.en.js',
      required: RULE_IDS, keys: () => i18nKeys('en', 'board.map.annotation'),
      effect: 'en 되살릴 때 지도 주석만 한국어/키 원문으로 남는다(지금은 휴면).',
    },

    // ── phenomenon으로 키를 잡는 표 ──────────────────────────────────────────
    {
      table: 'PHENOMENON_META', file: 'src/modules/board/boardDisplay.js',
      required: ALL_PHENOMENA, keys: () => withFault(uniq(Object.keys(display.PHENOMENON_META)), 'PHENOMENON_META'),
      effect: 'phenomenonMeta 폴백이 발화 — 지도·단면·요약 카드에 **enum 원문 + ❔**가 그려진다.',
    },
    {
      table: 'i18n board.meta.phenomenon (ko)', file: 'src/i18n/resources/board.ko.js',
      required: ALL_PHENOMENA, keys: () => i18nKeys('ko', 'board.meta.phenomenon'),
      effect: 'metaDict의 label getter가 키 원문을 돌려준다 — `board.meta.phenomenon.x.label`이 화면에 뜬다. '
        + '⚠️ 키가 ko·en 양쪽에서 동시에 빠지면 i18n 키 패리티도, 리터럴 t() 스캐너도 못 본다(동적 경로).',
    },
    {
      table: 'i18n board.meta.phenomenon (en)', file: 'src/i18n/resources/board.en.js',
      required: ALL_PHENOMENA, keys: () => i18nKeys('en', 'board.meta.phenomenon'),
      effect: '위와 같음(en은 지금 휴면 자산).',
    },
    {
      table: 'REGISTRY.phenomenon', file: 'src/modules/board/boardSymbols.jsx',
      required: ALL_PHENOMENA, keys: () => ALL_PHENOMENA.filter((k) => symbols.hasSymbol('phenomenon', k)),
      effect: 'SVG 심볼 대신 EMOJI_FALLBACK(=PHENOMENON_META.icon)이 그려진다. 그 표에도 없으면 ❔.',
    },
    {
      table: 'PRECIP_META', file: 'src/modules/board/webgl/mapOverlay/overlayScene.js',
      required: PRECIP_PHENOMENA, keys: () => withFault(uniq(Object.keys(overlay.PRECIP_META)), 'PRECIP_META'),
      effect: '그 존에 강수 에미터가 안 생긴다 — 비구름만 뜨고 비가 안 내려 그림이 멈춰 보인다(WebGL·Canvas2D 양 경로).',
    },
    {
      table: 'DISASTER_META', file: 'src/modules/board/AtmosphereBoard.jsx',
      required: DISASTER_PHENOMENA, keys: () => uniq(Object.keys(atmosphere.DISASTER_META)),
      effect: '재난 판정인데 재난 배너가 안 뜬다 — 화면이 그 심각도를 말하지 않는다(배너가 생긴 이유가 그것이다).',
    },

    // ── cloud로 키를 잡는 표 ─────────────────────────────────────────────────
    {
      table: 'CLOUD_META', file: 'src/modules/board/boardDisplay.js',
      required: ALL_CLOUDS, keys: () => uniq(Object.keys(display.CLOUD_META)),
      effect: 'cloudMeta 폴백 — 구름 이름 자리에 enum 원문 + ❔.',
    },
    {
      table: 'i18n board.meta.cloud (ko)', file: 'src/i18n/resources/board.ko.js',
      required: ALL_CLOUDS, keys: () => i18nKeys('ko', 'board.meta.cloud'),
      effect: '구름 라벨이 키 원문으로 뜬다(동적 경로라 다른 어떤 검사도 못 본다).',
    },
    {
      table: 'i18n board.meta.cloud (en)', file: 'src/i18n/resources/board.en.js',
      required: ALL_CLOUDS, keys: () => i18nKeys('en', 'board.meta.cloud'),
      effect: '위와 같음(휴면).',
    },
    {
      table: 'REGISTRY.cloud', file: 'src/modules/board/boardSymbols.jsx',
      required: ALL_CLOUDS, keys: () => ALL_CLOUDS.filter((k) => symbols.hasSymbol('cloud', k)),
      effect: 'SVG 심볼 대신 이모지 폴백.',
    },

    // ── 구름 변형(cloudVariantFor 정의역)으로 키를 잡는 표 ────────────────────
    {
      table: 'CLOUD_SHAPES(GL)', file: 'src/modules/board/webgl/mapOverlay/overlayScene.js',
      required: VARIANTS, keys: () => uniq(Object.keys(overlay.CLOUD_SHAPES)),
      effect: 'WebGL 오버레이에서 그 존의 구름 덩어리가 아예 안 그려진다(SVG 폴백과 화면이 갈린다).',
    },
    {
      table: 'CLOUD_VARIANTS(SVG)', file: 'src/modules/board/realisticEffects.jsx',
      required: VARIANTS, keys: () => (FAULT === 'break-parse' ? [] : CLOUD_VARIANT_KEYS),
      effect: 'RealCloudMass가 `?? CLOUD_VARIANTS.cumulus`로 떨어져 **엉뚱한 구름 모양**이 그려진다(빈 화면보다 나쁘다).',
    },

    // ── 배치 요소 subtype으로 키를 잡는 표 ───────────────────────────────────
    {
      table: 'AIR_MASS_META', file: 'src/modules/board/boardDisplay.js',
      required: [...AIR_MASS_SUBTYPES].sort(), keys: () => uniq(Object.keys(display.AIR_MASS_META)),
      effect: '팔레트 칩이 subtype 원문 + 🌀로 뜨고 힌트 문구가 사라진다.',
    },
    {
      table: 'i18n board.meta.airMass (ko)', file: 'src/i18n/resources/board.ko.js',
      required: [...AIR_MASS_SUBTYPES].sort(), keys: () => i18nKeys('ko', 'board.meta.airMass'),
      effect: '기단 이름·힌트가 키 원문으로 뜬다.',
    },
    {
      table: 'FRONT_META', file: 'src/modules/board/boardDisplay.js',
      required: [...FRONT_SUBTYPES].sort(), keys: () => uniq(Object.keys(display.FRONT_META)),
      effect: '팔레트 칩이 subtype 원문 + ➰로 뜬다.',
    },
    {
      table: 'i18n board.meta.front (ko)', file: 'src/i18n/resources/board.ko.js',
      required: [...FRONT_SUBTYPES].sort(), keys: () => i18nKeys('ko', 'board.meta.front'),
      effect: '전선 이름·힌트가 키 원문으로 뜬다.',
    },
    {
      table: 'REGISTRY.air_mass', file: 'src/modules/board/boardSymbols.jsx',
      required: [...AIR_MASS_SUBTYPES].sort(), keys: () => [...AIR_MASS_SUBTYPES].filter((k) => symbols.hasSymbol('air_mass', k)),
      effect: 'SVG 기단 심볼(cP/mP/mT/cT) 대신 이모지 폴백.',
    },
    {
      table: 'REGISTRY.front', file: 'src/modules/board/boardSymbols.jsx',
      required: [...FRONT_SUBTYPES].sort(), keys: () => [...FRONT_SUBTYPES].filter((k) => symbols.hasSymbol('front', k)),
      effect: 'SVG 전선 심볼 대신 이모지 폴백.',
    },
    {
      table: 'BLOOM_META', file: 'src/modules/board/webgl/mapOverlay/overlayScene.js',
      required: [...AIR_MASS_SUBTYPES].sort(), keys: () => uniq(Object.keys(overlay.BLOOM_META)),
      effect: '지도에 그 기단의 색 번짐이 안 그려진다(어느 공기 덩어리인지 색으로 안 보인다).',
    },
    {
      table: 'FLOW_META', file: 'src/modules/board/webgl/mapOverlay/overlayScene.js',
      required: [...AIR_MASS_SUBTYPES].sort(), keys: () => uniq(Object.keys(overlay.FLOW_META)),
      effect: '지도에 그 기단의 유입 화살표가 안 그려진다.',
    },
  ];

  // ── 🔴 대장 ① 「옳게 없는 것」 — 물리·설계상 있으면 안 되는 칸 ─────────────
  // 지금은 비어 있다. `PRECIP_META`의 「비 안 오는 현상」은 여기 목록으로 적지 않고
  // **PRECIP_PHENOMENA 파생 규칙**(비를 내리는 구름을 결과로 갖는 현상만 요구)으로
  // 풀었다 — 목록은 새 현상이 들어와도 안 자라지만 규칙은 자란다.
  const CORRECT_ABSENCES = [];
  if (FAULT === 'stale-exempt') {
    // 이미 표에 **있는** 키를 「옳게 없다」고 적어 둔 상황 — 면제 근거 만료.
    CORRECT_ABSENCES.push({ table: 'PRECIP_META', key: 'snow', why: '고장 주입 — 근거가 낡은 면제' });
  }
  if (FAULT === 'orphan-exempt') {
    // 표 이름이 바뀌었거나 요구 집합에서 빠진 키를 가리키는 면제 — 아무것도 안 지킨다.
    CORRECT_ABSENCES.push({ table: 'PRECIP_META', key: 'no_such_phenomenon', why: '고장 주입 — 유령 면제' });
  }

  // ── 🔴 대장 ② 「빠진 것 — 수리 미배정」 ────────────────────────────────────
  // 메워야 하는 칸인데 이 작업의 소유 밖이라 수리가 배정되지 않았다.
  // **메워지면 아래 역압력이 "지울 것"이라고 운다.** 수리 라우팅은 PM 몫.
  const KNOWN_GAPS = [
    // ── RULE_ANNOTATIONS ✅ **해소(2026-08-19 · #124)** ──────────────────────
    // 12종이 무표시였다(표가 규칙 8종 시절에 멈춤). 문구를 ko/en 저작해 닫혔다.
    // 행을 남기지 않는다 — **낡은 면제를 남기면 다음 회귀를 덮는다.**

    // ── REGISTRY.phenomenon: 재난·경보 5종에 SVG 심볼이 없다 ───────────────
    // ⚠️ 이것은 **크래시도 무표시도 아니다.** EMOJI_FALLBACK이 PHENOMENON_META의
    // 아이콘(🔥·🌊·⛈️·🚨)으로 그리므로 ❔가 아니라 제대로 된 이모지가 뜬다.
    // 즉 「설계된 폴백」이고 지금 무해하다. 그래도 CORRECT_ABSENCES가 아니라
    // 여기 두는 이유: 이 레지스트리의 의도된 최종 상태는 **전 현상 SVG**이고
    // (그래서 8종을 손으로 그렸다), 이모지는 과도기 표현이기 때문이다.
    ...['wildfire_risk', 'flood_risk', 'severe_storm', 'wildfire_warning', 'flood_warning',
        // MT-18이 들인 2종도 같은 성질이다(2026-08-19 등재 · PM 판정).
        // **심볼을 새로 저작하지 않는다**: ⑴ 이모지 폴백이라 화면이 안 깨지고
        // ⑵ 8/20이 마지막 창인데 심볼 저작은 **실기기 검증이 필요한 종류**이며
        // 그 검증이 지금 막혀 있고 ⑶ 면제가 **양방향 래칫**이라 나중에 채우면
        // 「지우라」고 운다 — 잊히지 않는다. **수신자: 심볼 저작 담당(대회 후).**
        'typhoon', 'tropical_night',
    ].map((key) => ({
      table: 'REGISTRY.phenomenon', key,
      why: 'SVG 심볼 미저작 — EMOJI_FALLBACK이 PHENOMENON_META 이모지로 그려 화면 무해. 심볼 저작은 대회 후(수신자: 심볼 저작 담당). 최종 상태는 전 현상 SVG.',
    })),

    // ── PRECIP_META ✅ **해소(#122)** ─────────────────────────────────────────
    // severe_storm·flood_warning·typhoon이 채워졌다. 행 삭제.

    // ── DISASTER_META ✅ **해소(2026-08-19 · #124)** ──────────────────────────
    // 🔴 **이 칸이 이 계약의 가장 중요한 교훈을 남겼다.** 면제돼 있었으므로 계약이
    // **조용했고**, 조율 과정에서 「계약이 안 우니 이미 고쳐졌다」로 읽혀 **가장 급한
    // 결함(경보급 재난인데 배너 없음)이 수리 목록에서 빠질 뻔했다.**
    // ⇒ **「계약이 안 운다」는 「없다」가 아니다 — 면제 목록을 함께 읽어야 한다.**
  ];

  const inLedger = (ledger, table, key) => ledger.some((e) => e.table === table && e.key === key);

  // ── 검사 ①: 표가 요구 집합을 덮는가 (면제분 제외) ──────────────────────────
  for (const t of TABLES) {
    const have = new Set(t.keys());
    const missing = t.required.filter(
      (k) => !have.has(k) && !inLedger(CORRECT_ABSENCES, t.table, k) && !inLedger(KNOWN_GAPS, t.table, k),
    );
    check(
      `${t.table} — 요구 ${t.required.length}종 전건 보유`,
      missing.length === 0,
      `       파일: frontend/${t.file}\n` +
        `       표:   ${t.table}\n` +
        `       누락: ${missing.join(', ')}\n` +
        `       화면: ${t.effect}\n` +
        '       고치는 법 — 둘 중 하나:\n' +
        `         ⑴ 위 파일의 ${t.table}에 그 키의 행을 넣는다(요구 집합의 소유자는 database/seed/board_rules.json이다).\n` +
        `         ⑵ 정말 없는 것이 옳다면 tests/displayLayerParity.contract.test.mjs의\n` +
        '            CORRECT_ABSENCES(물리적으로 없어야 함) 또는 KNOWN_GAPS(메워야 하는데 미배정)에\n' +
        "            { table, key, why } 를 넣는다. why는 값이 아니라 **근거**를 적을 것.",
    );
  }

  // ── 검사 ②: 역압력 — 면제가 해소됐는데 목록에 남아 있는가 ──────────────────
  const byTable = new Map(TABLES.map((t) => [t.table, new Set(t.keys())]));
  const staleAbsence = CORRECT_ABSENCES.filter((e) => byTable.get(e.table)?.has(e.key));
  check(
    `CORRECT_ABSENCES ${CORRECT_ABSENCES.length}건 — 전건 여전히 부재`,
    staleAbsence.length === 0,
    `       표에 생긴 면제 키: ${staleAbsence.map((e) => `${e.table}.${e.key}`).join(', ')}\n` +
      '       → 「옳게 없다」고 적어 둔 칸이 채워졌다. 둘 중 하나다:\n' +
      '         ⑴ 면제 근거가 낡았다 → CORRECT_ABSENCES에서 지운다.\n' +
      '         ⑵ 있으면 안 되는 것이 들어왔다 → 표에서 지운다.\n' +
      '       판단하지 않고 목록만 지우면 근거가 사라진다 — 경위를 주석으로 남길 것.',
  );
  const filledGap = KNOWN_GAPS.filter((e) => byTable.get(e.table)?.has(e.key));
  check(
    `KNOWN_GAPS ${KNOWN_GAPS.length}건 — 전건 아직 미해소`,
    filledGap.length === 0,
    `       메워진 칸: ${filledGap.map((e) => `${e.table}.${e.key}`).join(', ')}\n` +
      '       → 기지 공백이 해소됐다. tests/displayLayerParity.contract.test.mjs의\n' +
      '         KNOWN_GAPS에서 그 행을 **지울 것**. 낡은 면제를 남기면 다음 회귀를 덮는다.',
  );

  // ── 검사 ③: 면제 대장이 실재하는 표·키를 가리키는가 ────────────────────────
  const allRequired = new Map(TABLES.map((t) => [t.table, new Set(t.required)]));
  const orphan = [...CORRECT_ABSENCES, ...KNOWN_GAPS].filter(
    (e) => !allRequired.has(e.table) || !allRequired.get(e.table).has(e.key),
  );
  check(
    '면제 대장이 실재하는 (표, 요구 키)만 가리킨다',
    orphan.length === 0,
    `       유령 면제: ${orphan.map((e) => `${e.table}.${e.key}`).join(', ')}\n` +
      '       → 표 이름이 바뀌었거나 그 키가 더 이상 요구 집합에 없다. 지울 것 —\n' +
      '         가리키는 곳이 없는 면제는 조용히 아무것도 안 지킨다.',
  );
  check(
    '면제 사유가 비어 있지 않다(근거 없는 면제 금지)',
    [...CORRECT_ABSENCES, ...KNOWN_GAPS].every((e) => typeof e.why === 'string' && e.why.length >= 10),
    '       → why는 값이 아니라 **근거**를 적는 자리다. 비면 다음 사람이 판단을 복원할 수 없다.',
  );

  // ── 검사 ④: enum ↔ 규칙 파일 ↔ 백엔드 (표시 계층이 딛는 바닥) ──────────────
  const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const fePhen = uniq(PHENOMENON_ENUM);
  const feCloud = uniq(CLOUD_ENUM);
  check(
    `boardEngine.PHENOMENON_ENUM(${fePhen.length}) === 규칙 파생 현상 ∪ 기본 판정(${ALL_PHENOMENA.length})`,
    setEq(fePhen, ALL_PHENOMENA),
    `       enum에만: [${fePhen.filter((k) => !ALL_PHENOMENA.includes(k))}]  ← 어떤 규칙도 못 내는 사문(死文) 어휘\n` +
      `       규칙에만: [${ALL_PHENOMENA.filter((k) => !fePhen.includes(k))}]  ← enum이 모르는 현상(검증이 통째로 비껴간다)\n` +
      '       → frontend/src/lib/boardEngine.js의 PHENOMENON_ENUM을 규칙 파일에 맞춘다.',
  );
  check(
    `boardEngine.CLOUD_ENUM(${feCloud.length}) === 규칙 파생 구름 ∪ 기본 판정(${ALL_CLOUDS.length})`,
    setEq(feCloud, ALL_CLOUDS),
    `       enum에만: [${feCloud.filter((k) => !ALL_CLOUDS.includes(k))}] / 규칙에만: [${ALL_CLOUDS.filter((k) => !feCloud.includes(k))}]`,
  );
  check(
    `board_engine.py PHENOMENA(${BE_PHENOMENA.length}) === boardEngine.js PHENOMENON_ENUM(${fePhen.length})`,
    setEq(BE_PHENOMENA, fePhen),
    `       백엔드에만: [${BE_PHENOMENA.filter((k) => !fePhen.includes(k))}] / 프론트에만: [${fePhen.filter((k) => !BE_PHENOMENA.includes(k))}]\n` +
      '       → 채점 권위(서버)와 표시(프론트)가 서로 모르는 현상을 갖고 있다.\n' +
      '         boardEngine.js 주석이 "백엔드 PHENOMENA와 같은 집합이어야 한다"고 적은 그 계약이다.',
  );
  check(
    `board_engine.py CLOUDS(${BE_CLOUDS.length}) === boardEngine.js CLOUD_ENUM(${feCloud.length})`,
    setEq(BE_CLOUDS, feCloud),
    `       백엔드에만: [${BE_CLOUDS.filter((k) => !feCloud.includes(k))}] / 프론트에만: [${feCloud.filter((k) => !BE_CLOUDS.includes(k))}]`,
  );

  // ── 검사 ⑤: 하드코딩 한국어 — **디렉터리 전수**(고정 목록이 아니다) ────────
  //
  // 🔴 **네 번째 같은 뿌리다.** `i18n.smoke.test.mjs`의 「보드 시각화 모듈에
  // 하드코딩 한국어가 없다」(MT-28 회귀)가 **파일 5개를 손으로 적어** 검사한다.
  // `src/modules/board` 한 디렉터리만 27파일이고, 새로 생기는 화면 모듈은
  // 그 목록에 자동으로 들어가지 않는다 — `PRECIP_META`·`SCENE_BY_RULE`·
  // `PHENOMENON_META`와 정확히 같은 실패 형태다(계약이 자기 목록만 본다).
  //
  // 여기서는 목록을 지우고 **`src/**` 전수**를 훑는다. 탐지 규칙은 그 스모크와
  // 같게 맞췄다(블록 주석·행 주석 제거 후 한글 포함 줄) — 두 검사가 같은 것을
  // 세야 결과가 갈리지 않는다. 그 스모크를 지울지는 PM 라우팅 몫이라 손대지 않았다.
  //
  // ⚠️ **리소스 디렉터리는 목록이 아니라 규칙으로 뺀다.** `src/i18n/resources/`는
  // 외부화의 **목적지**라 한국어가 있는 것이 옳다 — 새 리소스 파일이 생겨도
  // 자동으로 옳다. 목록으로 뺐다면 그때마다 손을 봐야 한다.
  //
  // ⚠️ **면제는 줄 수를 못박는다.** 파일 단위로 통째 면제하면 그 파일에 새로
  // 들어오는 한국어를 영영 못 본다. 정확히 N줄로 못박아 **늘어도 줄어도** 운다.
  const { readdirSync, statSync } = await import('node:fs');
  const { join, sep } = await import('node:path');

  const walkJs = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walkJs(p) : (/\.(jsx?|mjs)$/.test(name) ? [p] : []);
    });
  const HANGUL = /[가-힣]/;
  const hangulLines = (abs) =>
    readFileSync(abs, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .map((l) => l.replace(/\/\/.*$/, ''))
      .filter((l) => HANGUL.test(l));

  // ── 대장 ③ 「코드에 한국어가 있어도 되는 파일」 ─────────────────────────────
  // `lines`는 **지금 실측값**이고 양방향 래칫이다. 늘면 새 한국어가 들어온 것,
  // 줄면 외부화가 진행된 것 — 어느 쪽이든 이 목록을 갱신해야 한다.
  const HANGUL_CORRECT = [
    // 🔴 **여기와 HANGUL_GAPS를 가르는 선은 「사용자에게 닿는가」다.**
    // 섞이면 다음 사람이 전부 옮긴다 — 개발 문자열까지 리소스로 가면 번역 대상이
    // 부풀고, 사용자 문자열이 면제에 묻히면 en 복원 때 화면이 깨진다.
    { file: 'src/modules/explore/schematic/glCore.js', lines: 2,
      why: '셰이더 컴파일·링크 실패 시 throw하는 **개발자 진단**이다. 사용자 화면에는 SchematicGL의 폴백 문구(리소스)가 뜨고 이 문자열은 콘솔에만 남는다 — 번역 대상이 아니다.' },
    { file: 'src/lib/boardEngine.js', lines: 11,
      why: '서버 어휘 미러(ZONES·조건 파서 주석 문자열) — 화면 표시명은 board.map.zone에서 온다(PeninsulaMap.zoneLabel).' },
    { file: 'src/modules/board/boardLayout.js', lines: 4,
      why: 'FALLBACK_REGIONS의 name은 서버 board_regions.json 원문 미러 — 표시는 zoneLabel이 i18n으로 덮는다.' },
    { file: 'src/lib/geoSnap.js', lines: 12,
      why: 'REGIONS.value는 **서버 전송용 원문**이고 표시명은 region.city.{key}다 — 파일 자신이 :17에 그렇게 적어 두었다.' },
    { file: 'src/components/RegionPicker.jsx', lines: 1,
      why: "me?.region ?? '서울' — 서버 지역 어휘의 기본값(전송 값)이지 표시 문자열이 아니다." },
    { file: 'src/modules/dev/DevPanel.jsx', lines: 38,
      why: '개발자 전용 패널 — GET /dev/state가 200일 때만 렌더된다(운영 서버는 404라 마운트 자체가 없다). 학습자 화면이 아니다.' },
    { file: 'src/lib/guideBotMesh.js', lines: 8,
      why: 'throw new Error 메시지 — 개발자·CI가 읽는 진단 문자열이고 화면에 나가지 않는다.' },
    { file: 'src/modules/board/webgl/crossSection/glCore.js', lines: 2,
      why: '셰이더 컴파일 실패 throw — 개발자용 진단.' },
    { file: 'src/components/GuideBot3D.jsx', lines: 1,
      why: 'WebGL 컨텍스트 소실 Error — 개발자용 진단(사용자에게는 폴백 그림이 뜬다).' },
    { file: 'src/lib/exploreSims.js', lines: 1,
      why: '인자 검증 throw — 개발자용 진단.' },
  ];

  // ── 대장 ④ 「외부화해야 하는데 안 된 것」 ──────────────────────────────────
  // ✅ **비었다(2026-08-19).** `Mascot.jsx`의 이름표가 리소스로 나갔다.
  // ⚠️ 그 면제의 사유가 *"MASCOT_NAMES로 재수출돼 소비처가 여럿"*이었는데
  // **실측 소비처는 `src/**`에 0곳**이었다 — 짐작으로 적은 면제 사유가 작업을
  // 미루게 했다. **면제 사유도 근거여야지 짐작이면 안 된다.**
  const HANGUL_GAPS = [
    // ── MT-22 입체 화살표 모식도(2026-08-19 등재 · PM 판정) ─────────────────
    // 🔴 **외부화가 아니라 면제로 가는 근거 3개**: ⑴ `detectLocale`이 ko 고정이고
    // 스위처가 언마운트라 **en 런타임 경로가 없다 — 사용자 영향 0** ⑵ 8/20이 마지막
    // 기능 창인데 37줄을 옮기는 것은 **회귀면만 넓힌다** ⑶ 대장 §4.25가 이미
    // 「i18n 위생 담당·대회 후」로 수신자와 시점을 세워 뒀다.
    //
    // ⚠️ **줄 수가 곧 계약이다**(양방향 래칫). 늘면 「새 한국어가 들어왔다」고 울고,
    // 줄면 「외부화가 진행됐으니 낮추거나 지우라」고 운다. 그래서 값을 적는다.
    //
    // ✅ **이 목록에서 빠진 것 하나를 남긴다**: `SchematicGL.jsx`의 `ariaLabel`과
    // WebGL2 폴백 문구는 **리소스로 뺐다**. 스크린리더가 읽고 화면에 그대로 뜨는
    // **사용자 문자열**이기 때문이다 — 마스코트 `alt`에 적용한 기준과 같다.
    // 「사용자에게 닿으면 리소스로, 안 닿으면 면제로」가 이 표의 가르는 선이다.
    { file: 'src/modules/explore/ClimateSimPage.jsx', lines: 3,
      why: '모식도 카드의 제목·설명·aria — 화면에 뜨는 사용자 문자열이라 결국 리소스로 가야 한다. §4.25 이월(수신자: i18n 위생 담당, 대회 후).' },
    { file: 'src/modules/explore/TyphoonSimPage.jsx', lines: 6,
      why: '위와 같음 — 모식도 2종의 제목·설명·aria.' },
    { file: 'src/modules/explore/SchematicPanel.jsx', lines: 8,
      why: '단계 컨트롤 라벨(재생/정지/이전/다음/n단계)과 도트 aria — 사용자 문자열. §4.25 이월.'
        + ' ⚠️ 6 → 8: MT-22 재제작(2026-08-19)이 보드와 같은 **자동 재생**을 넣으면서 재생·정지 라벨이 늘었다.' },
    { file: 'src/modules/explore/schematic/radiationScene.js', lines: 22,
      why: '복사수지 장면의 라벨·단계 제목 — 화면에 겹쳐 그려지는 사용자 문자열. §4.25 이월.'
        + ' ⚠️ 18 → 20: 재제작이 「온실기체 층」·「붙잡힌 열이 되돌아온다」를 새로 그렸다(온실효과의 본체).'
        + ' ⚠️ 20 → 25: 2차 보정(2026-08-19)이 **긴 문장을 캔버스 밖으로** 내면서 단계마다'
        + ' `note` 한 줄이 생겼다(캔버스 라벨은 오히려 짧아졌는데 줄 수는 늘었다 — 문장이'
        + ' 사라진 것이 아니라 **자리를 옮긴** 것이라 총량은 는다). 「태양」 라벨 1줄도 여기 든다.'
        + ' ✅ 25 → 22: 라벨 가독성 지적(2026-08-19)으로 3단계에 몰리던 라벨 넷이 줄었다 —'
        + ' 「잠열 19」·「대류 9」·「붙잡히는 6」 세 줄이 합계 「지표→대기 34」 한 줄이 되고'
        + ' 「온실기체 층」 이름표가 캡션으로 갔다. **문구는 3단계 `note`(같은 파일 안)로'
        + ' 옮겨 갔고 그 줄은 이미 세고 있던 줄이라 총량이 순감한다.**' },
    { file: 'src/modules/explore/schematic/typhoonSectionScene.js', lines: 22,
      why: '태풍 단면 장면의 라벨·단계 제목 — 위와 같음.'
        + ' ⚠️ 16 → 18: 재제작이 무대(따뜻한 바다·바깥 나선 비구름대)를 라벨과 함께 세웠다.'
        + ' ⚠️ 18 → 22: 2차 보정이 단계마다 `note`(캔버스 밖 캡션) 5줄을 더하고 캔버스 라벨을'
        + ' 짧은 명사구로 줄였다 — **문장이 캔버스에서 캡션으로 옮겨 간 순증**이다.' },
    { file: 'src/modules/explore/schematic/typhoonLifecycleScene.js', lines: 11,
      why: '태풍 생애 장면의 라벨·단계 제목 — 위와 같음.'
        + ' ⚠️ 13 → 14: 재제작이 바다 위에 육지를 세우면서 「한반도」 라벨이 붙었다.'
        + ' ✅ 14 → 11: 2차 보정이 **캔버스 안에 눕혀 두었던 설명 문장 라벨을 걷어냈다**'
        + ' — 문장은 이미 `T2_STAGES[].note`에 있어서 옮길 자리를 새로 만들 필요가 없었다.'
        + ' 세 파일 중 **여기만 줄었다**는 것이 그 차이다.' },
  ];
  // ⚠️ MT-22의 `src/modules/explore/schematic/**`는 origin/main에 **아직 없다**.
  // 병합되면 이 검사가 그 파일들을 처음으로 본다 — 외부화가 이월된 상태라면
  // HANGUL_GAPS에 { file, lines, why }를 넣어야 초록이 된다. **그 압력이 의도다**:
  // 고정 목록이었다면 새 디렉터리가 통째로 안 보인 채 들어왔을 것이다.

  const hangulLedger = new Map(
    [...HANGUL_CORRECT, ...HANGUL_GAPS].map((e) => [e.file, e]),
  );
  const RESOURCE_DIR = join('src', 'i18n', 'resources') + sep;
  const unlisted = [];
  const drifted = [];
  const seen = new Set();
  for (const abs of walkJs(join(root, 'src'))) {
    const rel = abs.slice(root.length + 1);
    if (rel.startsWith(RESOURCE_DIR)) continue; // 규칙으로 제외 — 외부화의 목적지
    const lines = hangulLines(abs);
    let n = lines.length;
    if (FAULT === 'hangul-new' && rel === 'src/modules/board/boardDisplay.js') { n = 1; lines[0] ??= "  const 라벨 = '하드코딩';"; }
    if (FAULT === 'hangul-drift' && rel === 'src/lib/geoSnap.js') n -= 1; // 외부화 진행
    if (n === 0) continue;
    const e = hangulLedger.get(rel);
    if (!e) unlisted.push({ rel, n, sample: (lines[0] ?? '').trim().slice(0, 60) });
    else if (e.lines !== n) drifted.push({ rel, was: e.lines, now: n });
    seen.add(rel);
  }
  check(
    `하드코딩 한국어 — src/** 전수(리소스 제외) 중 미등재 0건 (등재 ${hangulLedger.size}파일)`,
    unlisted.length === 0,
    unlisted.map((u) => `       ${u.rel}: 코드에 한국어 ${u.n}줄 — 예: ${u.sample}`).join('\n') +
      '\n       → 셋 중 하나다:\n' +
      '         ⑴ 화면에 나가는 문자열이면 src/i18n/resources/*.ko.js·en.js로 빼고 t()로 읽는다.\n' +
      '         ⑵ 서버 어휘 미러·개발자 진단이라 옳게 있는 것이면 이 파일의 HANGUL_CORRECT에\n' +
      '            { file, lines, why } 를 넣는다(lines = 실측 줄 수).\n' +
      '         ⑶ 빼야 하는데 지금 못 빼면 HANGUL_GAPS에 같은 형태로 넣는다.\n' +
      '       why는 「어디에 어떻게 나가는가/안 나가는가」를 적을 것 — 값이 아니라 근거다.',
  );
  check(
    '하드코딩 한국어 면제의 줄 수가 실측과 일치(양방향 래칫)',
    drifted.length === 0,
    drifted.map((d) => `       ${d.rel}: 등재 ${d.was}줄 ↔ 실측 ${d.now}줄`).join('\n') +
      '\n       → 늘었으면 새 한국어가 들어온 것이다(그 줄을 리소스로 뺄 것).\n' +
      '         줄었으면 외부화가 진행된 것이다(등재 줄 수를 낮추고, 0이 되면 행을 지울 것).',
  );
  const ghostFiles = [...hangulLedger.keys()].filter((f) => !seen.has(f));
  check(
    '하드코딩 한국어 면제가 실재하는 파일만 가리킨다',
    ghostFiles.length === 0,
    `       유령 면제: ${ghostFiles.join(', ')}\n` +
      '       → 파일이 사라졌거나 한국어가 0줄이 됐다. HANGUL_CORRECT·HANGUL_GAPS에서 지울 것.',
  );

  // ── 요약 ───────────────────────────────────────────────────────────────────
  console.log(
    `\n· 요약: 규칙 ${RULE_IDS.length}종 · 현상 ${ALL_PHENOMENA.length}종(규칙 ${RULE_PHENOMENA.length} + 기본 1) · ` +
      `구름 ${ALL_CLOUDS.length}종 · 구름변형 ${VARIANTS.length}종 · 표 ${TABLES.length}개 검사 · ` +
      `면제 ${CORRECT_ABSENCES.length}(옳게 없음) + ${KNOWN_GAPS.length}(기지 공백)`,
  );
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패 — 표시 계층 표가 규칙 파일을 따라가지 못했다.`);
  process.exit(1);
}
console.log('OK: 표시 계층 표가 board_rules.json 전건을 덮는다 (또는 근거 있는 면제)');
