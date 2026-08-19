/**
 * radiationScene — **C1 지구 복사수지** 모식도 장면 데이터 (MT-22 · 2026-08-19 재제작).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  왜 다시 그렸나 — 틀린 것은 「사실」이 아니라 **「시각 문법」**이었다
 * ══════════════════════════════════════════════════════════════════════════════
 * 클라이언트 반려: *"내가 원한 모식은 **우리 보드 세션과 같은 모식**인데 지금
 * **화살표로 지 멋대로**잖아"*. 실화면은 **검은 배경에 화살표와 얇은 평면선**뿐이었다.
 * 수지(100단위 정규화·굵기 비례)는 맞았지만 **그 사실을 빈 배경에 화살표만으로**
 * 말했다.
 *
 * 원인이 특정됐다: 종전 렌더러(`schematic/renderer.js`)의 항목 종류가
 * **`arrow`·`line`·`label` 셋뿐**이라 보드 문법이 서 있는 토대(하늘·지면·바다·흙
 * 앞단면·유리 상자·격자·구름·강수·기단 볼륨)가 **통째로 없었다.** 격차는 노력이
 * 아니라 **어휘의 부재**였다.
 *
 * 그래서 PM 판정대로 **보드 무대를 재사용한다**(`board/webgl/crossSection/`).
 * 무대·팔레트·관용구를 복제하지 않고 **그대로 import** 한다 — 복제하면 갈라지고,
 * 그 갈라짐이 반려 사유 그 자체이기 때문이다.
 *
 * 🔴 **입체 화살표(원기둥+원뿔)는 포기했다.** 보드 무대는 **직교 카메라 + 깊이
 * 테스트 OFF + painter 정렬**로 반투명 볼륨을 합성한다 — 불투명 3D 화살표를 섞으면
 * 그 합성 규칙이 깨진다. *"「보드와 같아 보이는 것」이 입체 화살표보다 위"*라는
 * PM 판정에 따라 무대의 표현(테이퍼 화살표·볼륨·빌보드)으로 대체했다.
 *
 * ── 2차 보정(2026-08-19 오후 · 이미지 조사 §3) ───────────────────────────────
 * 조사에서 관례 넷을 확인했고 셋은 이미 맞았다(좌→우 3열 · 굵기 비례 · 대기가
 * 층으로 실재 · 되돌아오는 장파). 바꾼 것은 **긴 문장을 캔버스 밖으로** 낸 것이다 —
 * 보드는 `CrossSectionPanel`이 단계 캡션을 캔버스 **아래 HTML**로 뿌리고 캔버스
 * 안에는 짧은 명사구만 둔다. 설명은 전부 `RADIATION_STEPS[].note`로 옮겼다.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  🔴 색 규약이 **정면으로 충돌하는 유일한 자리** — 그래서 두 판을 낸다
 * ══════════════════════════════════════════════════════════════════════════════
 * 복사수지 관례는 **색이 곧 파장**이다 — 단파는 **들어오든 되반사되든 전부 노랑**,
 * 장파만 빨강(NASA·NOAA·Wikipedia·eoPortal·HyperPhysics·한국 교과서 계열 전부).
 * 그런데 **보드 팔레트는 반사를 물·바다 계열 하늘색**으로 칠하게 한다.
 * 「보드와 같아 보이는가」와 「학문 관례대로인가」가 여기서만 부딪힌다.
 *
 * **판정: 「둘 다 만들어 갤러리에서 비교한다」 — 사용자가 직접 정했다(2026-08-19,
 * PM 세션 경유 전달).** 말로 고르지 않고 나란히 놓고 고른다 — 이 과업의 판정
 * 기준이 「같은 화면에서 온 것으로 보이는가」이므로 그 기준 그대로다.
 *   · `RADIATION_SCENE`          = ⓐ **보드 팔레트판 — 기본값.** 실제 화면이 쓴다.
 *     기본인 이유는 **이 과업의 구속 기준이 보드 화면**이기 때문이다.
 *   · `RADIATION_SCENE_SPECTRAL` = ⓑ 파장 관례판. 갤러리 비교용.
 *     ⚠️ **어디에도 import되지 않으면 트리셰이킹으로 사라진다** — 배선 위치는
 *     갤러리 담당 몫으로 남아 있다(2026-08-19 기준 미배선).
 *
 * ⚠️ **이 문단이 한 번 「판정받은 적 없다」로 뒤집혔다가 되돌아왔다** — 경위를
 * 남긴다. 작성 에이전트의 전사가 중간에 끊겨 판정 메시지가 자기 기록에 남지
 * 않았고, 그것을 **「기록에 없다」가 아니라 「없었다」로 읽고** 스스로 「지어낸
 * 승인」이라 자진 신고하며 이 자리를 「미해결」로 고쳐 버렸다. 판정은 실재했고
 * PM이 원문을 갖고 있다. 두 방향 모두 거짓을 코드에 박는 길이므로 규칙을 적어
 * 둔다 — **자기 기록에 없으면 「없었다」로 결론 내리지 말고 「내 기록에 없다」로
 * 보고하고 확인을 요청할 것.** 오늘 같은 세션에서 「알림이 없다 = 아직 막혔다」로
 * 읽은 것과 뿌리가 같다(부재의 오독).
 * ⚠️ **갈린 것은 팔레트뿐이다.** 항목 배열(`RAW_ITEMS`)을 **한 번만** 만들고
 * 색만 나중에 채운다(`paint`) — 그래야 나란히 놨을 때 **색 말고는 같다**가 코드로
 * 보장된다. 두 번 만들면 `bb`의 노이즈 `seed`(scenes.js의 모듈 전역 카운터)까지
 * 달라져 **구름 모양이 미묘하게 어긋나고 비교가 오염된다.**
 * 경위를 남기는 이유: 근거가 끊기면 다음 사람이 한쪽을 「실수」로 읽고 조용히 고친다.
 *
 * ── 숫자의 출처와 저작권 선 ─────────────────────────────────────────────────
 * 수치는 `docs/design/research/RESEARCH_MT22_CO2_TYPHOON.md` §3 C1(출처 S2)이
 * 소유한다. **차용한 것은 「표현 문법」이지 그림이 아니다** — 어떤 이미지도 보고
 * 따라 그리지 않았고 전부 절차적으로 만든다. 문법 두 가지만 가져왔다:
 *   ① **TOA 입사 340 W/m²를 100단위로 정규화**한다
 *   ② **굵기가 에너지량에 비례**한다(Sankey 관례)
 *
 * ── 수지 (합이 맞는지 아래 UNITS로 직접 검산된다) ───────────────────────────
 *   입사 100 = 반사 35(구름 27 + 눈얼음 2 + 대기 6) + 흡수 65(대기 14 + 지표 51)
 *   지표 51 → 우주로 직접 17 · 대기로 34(잠열 19 + 대류·난류 9 + 온실기체 흡수 6)
 *   OLR 65 = 직접 17 + 대기 방출 48  ⇒ 흡수 65와 균형
 *   **EEI ≈ +0.9 W/m² = 0.3단위** — 이 미세한 초과가 온난화다
 *
 * ⚠️ **글자는 GL이 그리지 않는다.** `label` 항목은 `labelsFor()`가 화면 백분율로
 * 돌려주고 `CrossSectionGL`이 **흰 헤일로 SVG 텍스트**로 겹쳐 그린다(보드와 같은
 * 문법·같은 레이어). 그래서 한국어 문자열이 이 파일에 리터럴로 있고, 그 면제는
 * `displayLayerParity.contract`의 `HANGUL_GAPS`가 줄 수로 못박는다(§4.25 이월).
 */
import {
  H, ZC, vol, bb, flow, label, layerBand, composeScene,
} from '../../board/webgl/crossSection/scenes.js';
import { rgba } from '../../board/webgl/crossSection/glCore.js';

/** 100단위 정규화의 기준 — 이 값이 100단위다(W/m²) */
export const TOA_INSOLATION_WM2 = 340;
/** 지구 에너지 불균형(2005~2019) — 100단위로는 0.3 */
export const EEI_WM2 = 0.9;
export const EEI_UNITS = Math.round((EEI_WM2 / TOA_INSOLATION_WM2) * 1000) / 10; // 0.3

/** 갈래별 에너지(100단위). 그림의 모든 굵기가 여기서 파생된다 */
export const UNITS = Object.freeze({
  incoming: 100,
  reflectCloud: 27,
  reflectSurface: 2,
  reflectAir: 6,
  absorbAir: 14,
  absorbSurface: 51,
  windowIR: 17,
  latent: 19,
  thermals: 9,
  surfaceIR: 6,
  atmosphereIR: 48,
});

/**
 * 굵기 = 에너지량에 **선형 비례**(Sankey 문법). 다만 바닥이 있다.
 *
 * ⚠️ 순수 비례로 두면 2단위(눈·얼음 반사)가 100단위의 1/50이 되어 **실 화면에서
 * 선 한 올**로 사라진다. 그래서 `MIN_THICKNESS` 아래로는 내려가지 않게 잘랐다.
 * 이것은 문법의 예외이므로 **어디까지가 비례이고 어디부터가 바닥인지**를 값으로
 * 고정해 둔다(`schematicGl.contract.test.mjs`가 둘 다 문다):
 *   · u ≥ FLOOR_UNITS(≈13.5) 구간은 **정확히 비례**
 *   · 그 아래는 전부 같은 굵기 — 「작다」까지만 말하고 「얼마나 작은지」는 라벨이 말한다
 */
export const UNIT_THICKNESS = 0.0052; // 100단위 → 0.52
export const MIN_THICKNESS = 0.07;
export const FLOOR_UNITS = MIN_THICKNESS / UNIT_THICKNESS; // ≈ 13.5 — 이 아래(2·6·9)만 바닥

export function thicknessFor(units) {
  const u = Number.isFinite(units) ? Math.abs(units) : 0;
  return Math.max(MIN_THICKNESS, u * UNIT_THICKNESS);
}

/**
 * 굵기 → 보드 무대의 화살표 크기(`flow`의 `scale`).
 *
 * ⚠️ **바탕값 `SCALE_BASE`가 있는 이유를 적어 둔다**: 보드 화살표는 자루+촉이 한
 * 실루엣이라 일정 크기 아래로는 **촉이 뭉개져 방향을 못 읽는다**(보드 장면들이
 * scale 0.03 아래를 안 쓰는 이유다). 그래서 「비례분」 위에 바탕을 얹는다 —
 * **비례의 소유자는 여전히 `thicknessFor` 하나**이고, 이 함수는 그것을 화면
 * 단위로 옮기기만 한다.
 */
export const SCALE_BASE = 0.026;
export const SCALE_GAIN = 0.062;
export const scaleFor = (units) => SCALE_BASE + thicknessFor(units) * SCALE_GAIN;
/** 다발의 화살표 개수도 에너지를 말한다 — 굵기 하나로는 3배 이상 차이가 안 읽힌다 */
export const countFor = (units) => (units >= 40 ? 3 : units >= 15 ? 2 : 1);

// ── 고도 규약 — 보드와 같다(h 0 = 지표, 1 = 상자 뚜껑) ───────────────────────
const CLOUD_H = 0.66; // 반사하는 구름층
const GHG_LO = 0.34; // 온실기체 층 아래
const GHG_HI = 0.58; // 〃 위
const TOP = 1.06; // 대기권 밖(뚜껑 위)

/**
 * ⓐ **보드 팔레트판 — 기본값.** 실제 화면(`SchematicPanel`)이 쓰는 것.
 * 값의 출처는 `scenes.js`·`CrossSectionPanel`이 공유하는 보드 팔레트다.
 */
export const BOARD_PALETTE = Object.freeze({
  SUN: '#f59e0b', // 강한 일사(보드 strongSun)
  SUN_TXT: '#b45309',
  REFLECT: '#38bdf8', // 🔴 되나가는 단파 — **보드 물·바다 계열**. 관례와 갈리는 지점
  REFLECT_TXT: '#0369a1',
  ABSORB: '#ea580c', // 흡수·가열(보드 상승기류·지면가열)
  ABSORB_TXT: '#c2410c',
  LONGWAVE: '#dc2626', // 지구 장파(보드 온난 계열)
  LONGWAVE_TXT: '#b91c1c',
  LATENT: '#0d9488', // 잠열·대류(보드 습기 계열)
  LATENT_TXT: '#0f766e',
  GHG_TXT: '#0369a1',
  EEI: '#7f1d1d',
});

/**
 * ⓑ **파장 관례판 — 갤러리 비교용.**
 * 바뀌는 것은 **반사 두 값뿐**이다: 반사도 결국 단파(햇빛)이므로 **노랑 계열**로
 * 되돌린다. 입사와 구분되게 한 톤 밝은 노랑을 쓴다 — 관례도 「되나가는 쪽」을
 * 옅은 노랑으로 그리는 예가 많다. 나머지는 ⓐ와 **완전히 같다**(비교 오염 방지).
 */
export const SPECTRAL_PALETTE = Object.freeze({
  ...BOARD_PALETTE,
  REFLECT: '#fbbf24',
  REFLECT_TXT: '#a16207',
});

/**
 * 팔레트 토큰 — 색을 **나중에** 채우기 위한 자리표시자.
 * 이 장치가 있어야 두 판이 「색 말고는 같다」가 보장된다(위 ⓐⓑ 주석 참조).
 */
const tok = (name, alpha) => ({ tok: name, alpha });

/** 토큰을 실제 색으로 채운다 — 라벨은 SVG fill(문자열), 나머지는 GL 색(rgba) */
function paint(items, P) {
  return items.map((it) => {
    const c = it.color;
    if (!c || typeof c !== 'object' || !c.tok) return it;
    return { ...it, color: it.type === 'label' ? P[c.tok] : rgba(P[c.tok], c.alpha) };
  });
}

/**
 * 단계 — **메커니즘 순서**로 나눈다(보드 규약: 원인 → 과정 → 결과).
 * 복사수지에서 그 순서는 「들어온다 → 일부는 되나간다 → 나머지가 데운다 →
 * 데운 만큼 내보낸다 → 그런데 조금이 안 나간다」다. 마지막이 곧 온난화이고,
 * **그 앞 네 단계가 전부 있어야 「조금」이 얼마나 작은지가 보인다.**
 * 단계는 **누적**이다 — 마지막에 수지 전체가 한 화면에 있어야 「균형」이 보인다.
 *
 * ⚠️ `note`는 **캔버스 밖 캡션**이다(보드가 긴 문장을 두는 자리와 같다).
 */
export const RADIATION_STEPS = Object.freeze([
  {
    key: 'incoming',
    title: '들어오는 햇빛 100',
    note: `대기권 밖에 닿는 햇빛 전부를 100으로 놓고 센다 — 실제 값은 ${TOA_INSOLATION_WM2} W/m²다.`,
  },
  {
    key: 'reflect',
    title: '되돌아 나가는 빛 35',
    note: '35는 지구를 데우지 못하고 그대로 되나간다 — 구름 27 · 대기 6 · 눈과 얼음 2. 밝은 것일수록 많이 되쏜다.',
  },
  {
    key: 'absorb',
    title: '흡수해서 데우는 65',
    note: '남은 65만 흡수된다 — 지표 51 · 대기 14. 지구를 데우는 몫은 이것이 전부다.',
  },
  {
    key: 'outgoing',
    title: '우주로 나가는 열 65',
    note: '데운 만큼 장파로 내보낸다. 그중 일부를 온실기체가 붙잡았다가 **다시 아래로도** 내보내는 것이 온실효과다.',
  },
  {
    key: 'imbalance',
    title: `남는 ${EEI_WM2} W/m²가 온난화`,
    note: `흡수 65와 방출 65가 거의 같다. 그 「거의」가 남기는 +${EEI_WM2} W/m²(${EEI_UNITS}단위)가 해마다 쌓이는 것이 온난화다.`,
  },
]);

/** 갈래 하나 — 굵기·개수가 전부 `units`에서 파생된다(Sankey 문법의 실행부) */
const beam = ({ from, dir, travel, units, color, at, speed = 0.4, spreadZ = 0.1 }) => flow({
  from, dir, travel, count: countFor(units), scale: scaleFor(units),
  color: tok(color, 0.95), speed, at, spreadZ,
});

/**
 * 항목은 **한 번만** 만든다 — 두 팔레트가 이 배열을 공유해야 「색 말고는 같다」가
 * 성립한다(`bb`의 seed가 모듈 전역 카운터라 두 번 만들면 구름이 어긋난다).
 */
const RAW_ITEMS = [
  // ── 0단계: 들어온다 ─────────────────────────────────────────────────────
  bb({ x: 0.07, y: H(TOP), z: 0.06, w: 0.2, h: 0.2, color: tok('SUN', 0.95), kind: 2, at: 0 }),
  // 해에 이름을 붙인다 — 0단계에 **장면 라벨이 「햇빛 100」 하나뿐**이면
  // `exploreSims.render.test`가 무는 「껍데기 + 장면 라벨」 짝이 무너진다:
  // 단계 제목이 「들어오는 햇빛 100」이라 그 문자열을 **패널만으로도** 만들 수 있고,
  // 그러면 `scene`이 null이어도 초록이 된다(그 시험의 머리 주석이 경고하는 실패다).
  label({ x: 0.07, y: H(0.86), text: '태양', color: tok('SUN_TXT'), at: 0, size: 10 }),
  ...beam({ from: [0.17, H(1.02), ZC], dir: [0.1, -1, 0], travel: 0.34, units: UNITS.incoming, color: 'SUN', at: 0, speed: 0.42 }),
  label({ x: 0.25, y: H(1.0), text: '햇빛 100', color: tok('SUN_TXT'), at: 0, size: 11 }),

  // ── 1단계: 일부는 되나간다 (35) ─────────────────────────────────────────
  // 🔴 구름이 **실제로 있어야** 「구름이 되반사한다」가 그림이 된다. 종전에는
  //    구름 없이 화살표만 위로 올라갔다 — 무엇에 튕겼는지 화면에 없었다.
  ...layerBand({ x0: 0.26, x1: 0.68, y: H(CLOUD_H), at: 1, dark: false, n: 3 }),
  ...beam({ from: [0.31, H(CLOUD_H + 0.08), ZC + 0.06], dir: [-0.1, 1, 0], travel: 0.3, units: UNITS.reflectCloud, color: 'REFLECT', at: 1, speed: 0.44 }),
  label({ x: 0.41, y: H(0.9), text: '구름 반사 27', color: tok('REFLECT_TXT'), at: 1, size: 10 }),
  ...beam({ from: [0.08, H(0.5), ZC - 0.06], dir: [-0.04, 1, 0], travel: 0.26, units: UNITS.reflectAir, color: 'REFLECT', at: 1, speed: 0.36 }),
  label({ x: 0.04, y: H(0.66), text: '대기 반사 6', color: tok('REFLECT_TXT'), at: 1, size: 10 }),
  // 눈·얼음 — 흰 지면 조각이 있어야 「밝은 표면이 되쏜다」가 읽힌다
  bb({ x: 0.46, y: 0.006, w: 0.2, h: 0.055, color: rgba('#f8fafc', 0.9), kind: 3, at: 1 }),
  ...beam({ from: [0.46, H(0.05), ZC], dir: [0.04, 1, 0], travel: 0.24, units: UNITS.reflectSurface, color: 'REFLECT', at: 1, speed: 0.3 }),
  label({ x: 0.48, y: H(0.32), text: '눈·얼음 2', color: tok('REFLECT_TXT'), at: 1, size: 10 }),

  // ── 2단계: 나머지가 데운다 (65) ─────────────────────────────────────────
  ...beam({ from: [0.2, H(0.34), ZC], dir: [0.04, -1, 0], travel: 0.2, units: UNITS.absorbSurface, color: 'ABSORB', at: 2, speed: 0.46 }),
  // 지면 가열 — 보드의 `groundHeating` 관용구(bb kind 3, 주황 번짐) 그대로
  bb({ x: 0.34, y: 0.004, w: 0.62, h: 0.16, color: rgba('#fb923c', 0.5), kind: 3, at: 2 }),
  label({ x: 0.19, y: H(0.12), text: '지표 흡수 51', color: tok('ABSORB_TXT'), at: 2, size: 10 }),
  ...beam({ from: [0.6, H(0.74), ZC - 0.04], dir: [0.02, -1, 0], travel: 0.12, units: UNITS.absorbAir, color: 'ABSORB', at: 2, speed: 0.34 }),
  label({ x: 0.64, y: H(0.82), text: '대기 흡수 14', color: tok('ABSORB_TXT'), at: 2, size: 10 }),

  // ── 3단계: 데운 만큼 내보낸다 (65) + 붙잡힌다 ───────────────────────────
  // 온실기체 층 — **반투명 볼륨**이다. 보드가 기단을 그리는 그 문법이고,
  // 「층이 실재해서 그 안에서 되돌아온다」가 이것 없이는 성립하지 않는다.
  vol({ x0: 0, x1: 1, y0: H(GHG_LO), y1: H(GHG_HI), color: rgba('#38bdf8', 0.2), at: 3 }),
  label({ x: 0.11, y: H(0.5), text: '온실기체 층', color: tok('GHG_TXT'), at: 3, size: 10 }),
  // 지표 → 대기 34: 셋을 나란히 세워 「잠열이 제일 굵다」가 보이게 한다
  ...beam({ from: [0.62, H(0.05), ZC + 0.05], dir: [0, 1, 0], travel: 0.22, units: UNITS.latent, color: 'LATENT', at: 3, speed: 0.5 }),
  label({ x: 0.59, y: H(0.34), text: '잠열 19', color: tok('LATENT_TXT'), at: 3, size: 10 }),
  ...beam({ from: [0.71, H(0.05), ZC + 0.05], dir: [0, 1, 0], travel: 0.2, units: UNITS.thermals, color: 'LATENT', at: 3, speed: 0.44 }),
  label({ x: 0.72, y: H(0.26), text: '대류 9', color: tok('LATENT_TXT'), at: 3, size: 10 }),
  ...beam({ from: [0.79, H(0.05), ZC + 0.05], dir: [0, 1, 0], travel: 0.2, units: UNITS.surfaceIR, color: 'LONGWAVE', at: 3, speed: 0.4 }),
  label({ x: 0.83, y: H(0.16), text: '붙잡히는 6', color: tok('LONGWAVE_TXT'), at: 3, size: 9.5 }),
  // 🔴 되돌아 내려오는 장파 — **온실효과의 본체**다. 위로 나가는 화살표만
  //    그리면 「나간다」로 끝나고 온실효과가 화면에서 사라진다.
  ...flow({ from: [0.66, H(GHG_LO + 0.02), ZC - 0.08], dir: [-0.12, -1, 0], travel: 0.16, count: 2, scale: 0.036, color: tok('LONGWAVE', 0.9), speed: 0.5, at: 3, spreadZ: 0.09 }),
  label({ x: 0.47, y: H(0.62), text: '되돌아오는 열', color: tok('LONGWAVE_TXT'), at: 3, size: 10 }),
  // 우주로 나가는 65
  ...beam({ from: [0.93, H(0.05), ZC - 0.02], dir: [0.02, 1, 0], travel: 0.42, units: UNITS.windowIR, color: 'LONGWAVE', at: 3, speed: 0.42 }),
  label({ x: 0.96, y: H(0.5), text: '대기창 17', color: tok('LONGWAVE_TXT'), at: 3, size: 10 }),
  ...beam({ from: [0.86, H(GHG_HI + 0.06), ZC + 0.04], dir: [0.04, 1, 0], travel: 0.3, units: UNITS.atmosphereIR, color: 'LONGWAVE', at: 3, speed: 0.46 }),
  label({ x: 0.87, y: H(1.12), text: '대기 방출 48', color: tok('LONGWAVE_TXT'), at: 3, size: 10 }),

  // ── 4단계: 그런데 조금이 안 나간다 ──────────────────────────────────────
  // 🔴 **여기만 굵기가 비례가 아니다.** 0.3단위를 비례로 그리면 화면에서
  //    존재하지 않는다. 「보이지 않는 것」과 「없는 것」은 다르므로 바닥 굵기로
  //    세우고 **짧게** 그려 다른 갈래와 급이 다름을 길이로 말한다.
  ...flow({ from: [0.5, H(0.72), ZC - 0.12], dir: [0, 1, 0], travel: 0.08, count: 1, scale: scaleFor(EEI_UNITS), color: tok('EEI', 0.95), speed: 0.28, at: 4 }),
  label({ x: 0.5, y: H(0.94), text: `남는 ${EEI_UNITS}`, color: tok('EEI'), at: 4, size: 11 }),
];

/** 바다 스트립 — 잔디/바다 대비가 「지표」를 **지구의 표면**으로 읽히게 한다 */
const SEA = { from: 0, to: 0.3 };

/** ⓐ **기본** — 보드 팔레트판. `SchematicPanel`이 이것을 쓴다 */
export const RADIATION_SCENE = composeScene({ night: false, sea: SEA, items: paint(RAW_ITEMS, BOARD_PALETTE) });
/** ⓑ 갤러리 비교용 — 파장 관례판(반사도 노랑). 채택되면 위 export를 이것으로 바꾼다 */
export const RADIATION_SCENE_SPECTRAL = composeScene({ night: false, sea: SEA, items: paint(RAW_ITEMS, SPECTRAL_PALETTE) });

/** 수지가 실제로 맞는지 — 그림이 아니라 **숫자**로 검산한다(계약 테스트가 쓴다) */
export function radiationBalance() {
  const u = UNITS;
  return {
    reflected: u.reflectCloud + u.reflectSurface + u.reflectAir, // 35
    absorbed: u.absorbAir + u.absorbSurface, // 65
    surfaceToAir: u.latent + u.thermals + u.surfaceIR, // 34
    outgoing: u.windowIR + u.atmosphereIR, // 65
  };
}
