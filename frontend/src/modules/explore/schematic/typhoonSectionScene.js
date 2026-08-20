/**
 * typhoonSectionScene — **T1 태풍 개별 단면** 장면 데이터 (MT-22 · 2026-08-19 재제작).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  왜 다시 그렸나 — **1단계가 「검은 상자에 떠 있는 글자 4개」였다**
 * ══════════════════════════════════════════════════════════════════════════════
 * 실측: 종전 0단계의 항목은 `{line 8, label 4, arrow 1}`. 그림이 하나도 없었다.
 * 종전 그림은 **위에서 내려다본 평면 링 다이어그램**이었고, 보드가 쓰는
 * 「투명 유리 상자 + 지도 시점 바닥 + 전면 수직 단면」과 **다른 언어**였다.
 *
 * 🔴 그래서 **판형을 바꿨다 — 이제 진짜 「단면」이다.** 눈을 가운데 두고 좌우로
 * 갈라 자른 연직 단면이고, 바닥은 바다 평면이다. 이름(「태풍 **단면**」)과 그림이
 * 처음으로 일치한다.
 *
 * ── 2차 보정(2026-08-19 오후 · 이미지 조사 §2) ───────────────────────────────
 * 1차 재제작은 무대는 세웠는데 **「태풍」이 아니라 「적란운 두 개」로 읽혔다.**
 * 원인이 조사에서 특정됐다 — 관례에서 태풍을 태풍으로 만드는 시각 신호가 둘인데
 * 그 둘이 없거나 늦게 나왔다:
 *  ⑴ **모래시계 실루엣** — 눈벽 구름은 위로 갈수록 **바깥으로 기운다**(실제 눈벽의
 *     outward slope). 보드의 `cbTower`는 **수직** 적란운이라 그대로 쓰면 뇌우다.
 *     그래서 `bb`(보드 프리미티브)를 직접 쌓아 기울였다 — 보드 파일은 안 건드린다.
 *  ⑵ **권운 차양** — 영어권 라벨 *"Dense Cirrus Overcast"*. 아래보다 **넓은** 얇은
 *     차양이 꼭대기에 얹힌다. 1차에서는 이것이 **3단계에야** 나와서 **0단계 무대가
 *     태풍으로 안 보였다.** 0단계로 올렸다.
 *  ⑶ 나선 비구름대는 관례가 **바깥으로 갈수록 낮아지는 아치의 행진**이다
 *     (1차에서는 좌우 퍼프 하나씩이었다).
 *  ⑷ **긴 문장을 캔버스에서 걷어냈다.** 보드는 `CrossSectionPanel`이 단계 캡션을
 *     캔버스 **밖 HTML**로 뿌리고 캔버스 안에는 `V.*`의 **짧은 명사구**만 둔다.
 *     그래서 설명 문장은 전부 `T1_STEPS[].note`로 옮겼고 `SchematicPanel`이 캡션
 *     줄로 뿌린다 — 반려 사유였던 「떠 있는 글자 목록」이 바로 이 형태였다.
 *
 * 🔴 **틀리게 그리면 안 되는 사실 3건**(조사 §3 T1 · 출처 S1 · 대장 §4.21):
 *  ① **최대 풍속은 중심이 아니라 눈벽 — 중심에서 40~100km.** 「가운데가 제일 세다」로
 *     그리면 틀린 것을 가르친다. 눈(지름 20~50km)은 **하강기류·약풍·맑음**이다.
 *     그래서 눈벽 화살표가 전체 최대이고 눈 속 화살표가 전체 최소다.
 *  ② **하층은 반시계로 수렴, 상층은 시계로 발산 — 감김이 반대다.**
 *     단면에서는 좌우가 아니라 **앞뒤(z)**가 그것을 말한다: 저기압성(반시계) 접선은
 *     `p × ŷ = (-pz, 0, px)`이므로 **동쪽(px>0) 하층은 북(+z)**으로 흐르고,
 *     상층은 고기압성이라 **동쪽에서 남(-z)**으로 흐른다. 부호가 곧 사실이다.
 *     ⚠️ 다만 **직교 측면 투영에서 ±z는 눈에 거의 안 보인다.** 조사가 관례를 알려
 *     줬다 — 역회전은 「감김」이 아니라 **「아래는 모이고 위는 퍼진다」**로 읽힌다
 *     (한국 자료도 하층 파랑 수렴 / 상층 빨강 발산으로 색까지 갈랐다). 그래서
 *     **부호는 사실 그대로 두고 반지름 성분을 키워** 그 실루엣이 보이게 했다.
 *  ③ **진행 방향 오른쪽이 위험반원.** 진행이 북(+z)이므로 오른쪽은 동(+x)이고,
 *     동쪽 화살표만 `DANGEROUS_GAIN`만큼 굵다(대칭으로 그리면 그것도 틀린 그림).
 *
 * ── 좌표 규약 — **보드와 같다**(따로 만들지 않았다) ──────────────────────────
 *   x 0~1 서→동(0.5 = 눈 중심) · y 고도(`H(h)`, 0 = 해수면) · z 0~0.42 남→북(깊이).
 *
 * ── 축척 ─────────────────────────────────────────────────────────────────────
 *   가로 **1.0 = 600km** · 세로 `H(1)`이 약 **16km**(구름 꼭대기 12~20km의 가운데).
 * ⚠️ 즉 **세로가 약 37배 과장**돼 있다. 실제 비율로 그리면 태풍은 지름 600km에
 * 두께 16km인 **종잇장**이라 연직 구조가 한 픽셀도 안 보인다. 교육용 모식도의
 * 관례대로 과장하되, 과장했다는 사실을 여기 적어 둔다(수치 라벨은 실제 값이다).
 */
import {
  H, ZC, Z, bb, flow, label, precip, composeScene,
} from '../../board/webgl/crossSection/scenes.js';
import { rgba } from '../../board/webgl/crossSection/glCore.js';

/** 가로 축척 — 이 값으로 나눈 km가 월드 단위다(상자 폭 1.0 = 600km) */
export const KM_PER_UNIT = 600;
export const km = (v) => v / KM_PER_UNIT;

/**
 * 조사 §3 T1의 수치 — 그림의 모든 반지름이 여기서 파생된다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  ⚠️ `eyeRadiusKm: 25`가 왜 25인가 — **「25 유지」는 PM 판정이다(2026-08-19)**
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 **17.5km(범위 가운데)로 내리지 말 것.** PM이 근거 셋으로 「25 유지」를
 * 판정했고 **조건이 「사유 주석 필수」**였다 — 이 문단이 그 조건의 이행이다.
 * 지우면 판정의 근거가 끊긴다.
 *
 * **판정 근거(PM)**
 *  ⓐ 25는 조사 범위 **안**의 값이다(틀린 값이 아니다).
 *  ⓑ 롤링 직전에 **계약 수치를 건드리는 위험**이 크다 — 내리면
 *     `schematicGl.contract`의 축척 검사가 울어 그림·계약·캡션 셋을 함께 옮겨야
 *     한다.
 *  ⓒ **작은 그림에서는 큰 눈이 읽힌다** — 260×150 판형에서 눈을 전형값으로
 *     줄이면 **눈벽 모래시계 구조가 안 읽힌다.** 「구조가 보이는 것」을 골랐다.
 *  👉 PM 문장 그대로: **「오독을 만든 것은 값이 아니라 문구였고, 문구를 고쳤다.」**
 *
 * ① **함께 정정한 사실 오기**: 25는 **반지름**이다(지름 50km). 🔴 종전 주석이
 *    *"지름 20~50km의 가운데"*라고 적었고 **두 군데가 틀렸다** — 25는 지름이
 *    아니라 반지름이고, 지름 50은 조사 범위의 **위 끝**이지 가운데가 아니다
 *    (가운데는 지름 ≈35 = 반지름 17.5). 그 오기가 이미 라벨 문구
 *    (*"눈 — 지름 50km 안팎"*)를 낳아 **범위의 최대치를 전형값으로 가르치고**
 *    있었다. 값이 아니라 이 문구가 진짜 결함이었다(위 PM 문장 그대로).
 * ② **그래서 고친 것**: 값은 **건드리지 않고** 문구만 고쳤다. 캔버스 라벨은 수를
 *    빼고 「눈」만 쓰고, `T1_STEPS[0].note`가 「지름 20~50km」라고 **범위로** 말한다.
 *    그림이 범위 안의 한 값을 그리는 것과 그 값을 전형이라 **가르치는** 것은
 *    다르고, 반려 위험은 후자에 있었다.
 *
 * ⚠️ **이 문단이 한 번 「판정받은 적 없다」로 뒤집혔다가 되돌아왔다** — 경위를
 * 남긴다. 작성 에이전트의 전사가 중간에 끊겨 판정 메시지가 자기 기록에 남지
 * 않았고, 그것을 **「기록에 없다」가 아니라 「없었다」로 읽고** 스스로 「지어낸
 * 승인」이라 자진 신고하며 이 값을 「미결」로 되돌려 놓았다. 판정은 실재했고 PM이
 * 원문을 갖고 있다. **자기 기록에 없으면 「없었다」로 결론 내리지 말고 「내 기록에
 * 없다」로 보고하고 확인을 요청할 것** — 없는 판정을 지어내는 것과 있는 판정을
 * 지우는 것은 **똑같이 나쁘다.**
 */
export const T1_FACTS = Object.freeze({
  eyeRadiusKm: 25, // 🔴 **반지름**(지름 50km). 「25 유지」는 PM 판정 — 사유는 위 ⓐⓑⓒ
  maxWindInnerKm: 40, // 최대 풍속대 안쪽 경계
  maxWindOuterKm: 100, // 〃 바깥 경계
  outerRadiusKm: 285, // 전체 직경 200~2000km 중 작은 쪽
  cloudTopKm: 16, // 12~20km
  minPressureHpa: 950, // 최성기 970~930
  warmSeaC: 26.5, // 이 온도 위에서만 산다
});

/** 눈 중심의 x — 단면의 대칭축 */
export const EYE_X = 0.5;
const R_EYE = km(T1_FACTS.eyeRadiusKm); // 0.042
const R_WALL = km(70); // 눈벽 = 최대 풍속대(40~100km)의 한가운데 → 0.117
const R_OUTER = km(T1_FACTS.outerRadiusKm); // 0.475
const Y_LOW = H(0.1); // 하층 유입 고도
const Y_TOP = H(0.96); // 상층 유출 고도 — **권운 차양 높이**에 맞춘다(조사 §2 ④)
const CLOUD_TOP = 0.98; // 구름 꼭대기(h)

/**
 * 굵기 = **풍속**. 보드 무대의 화살표 크기(`flow`의 `scale`) 단위다.
 * 이 넷의 대소가 곧 ①번 사실이고 `schematicGl.contract`가 값으로 문다.
 */
export const T1_THICKNESS = Object.freeze({
  eyewall: 0.058, // 최대 — 눈벽
  inflow: 0.042, // 중간 — 바깥 유입
  outflow: 0.038, // 상층 유출
  eye: 0.026, // 최소 — 눈 속 하강기류(약풍)
});
/**
 * 위험반원(진행 방향 오른쪽) 가중 — 비대칭이 구조의 일부다.
 * ⚠️ **유입에 이 가중을 곱해도 눈벽을 넘으면 안 된다**(넘으면 ①이 깨진다):
 *    inflow 0.042 × 1.35 = 0.0567 < eyewall 0.058 ✓
 */
export const DANGEROUS_GAIN = 1.35;

// ── 색 — **보드 팔레트 그대로** ──────────────────────────────────────────────
const SEA = '#0284c7'; // 하층 유입(바다에서 빨려 든다) — 보드 비·바다 계열
const SEA_TXT = '#0369a1';
const WALL = '#dc2626'; // 눈벽 상승 — 보드 온난·상승 계열
const WALL_TXT = '#b91c1c';
const OUT = '#7c3aed'; // 상층 유출 — 보드 시어·정체 계열(하층과 색부터 다르다)
const OUT_TXT = '#6d28d9';
const EYE_TXT = '#475569';
const WARM_TXT = '#c2410c';

/** 진행 방향 — **북**(+z). 위험반원 판정의 기준이라 0단계부터 세운다 */
export const MOTION_DIR = Object.freeze([0, 0, 1]);
/**
 * 진행 방향의 **오른쪽** 단위벡터 = ŷ × m.
 * 위험반원의 정의가 「진행 방향 기준 오른쪽」이라 이 부호를 틀리면
 * **위험한 쪽을 반대로 가르친다.** m = 북(+z) → 오른쪽 = 동(+x).
 */
export function rightOfMotion(m = MOTION_DIR) {
  return [m[2], 0, -m[0]];
}

/**
 * 저기압성(위에서 볼 때 **반시계**) 접선 = `p × ŷ = (-pz, 0, px)`.
 * `spin`이 -1이면 고기압성(시계)이다 — 하층과 상층이 이 부호 하나로 갈린다.
 */
export function tangent(p, spin) {
  const t = [-p[2], 0, p[0]];
  return spin > 0 ? t : [-t[0], 0, -t[2]];
}

/**
 * 단계 — **메커니즘 순서**로 나눈다. 태풍 단면에서 그 순서는
 * 「무대(따뜻한 바다와 구름벽) → 하층이 빨려 든다 → 눈벽이 솟고 눈은 가라앉는다 →
 * 상층이 반대로 풀린다 → 그래서 어디가 가장 센가」다. **③이 ②의 결과이고
 * ④가 ③의 배출구**라, 순서를 바꾸면 「왜 눈이 맑은가」가 설명되지 않는다.
 *
 * ⚠️ `note`는 **캔버스 밖 캡션**이다(보드 `CrossSectionPanel`이 `steps[step]`을
 * 캔버스 아래 HTML로 뿌리는 것과 같은 자리). 캔버스 안에는 짧은 명사구만 남긴다.
 *
 * 🔴 **누적의 범위가 2026-08-19에 갈렸다 — 그림은 누적, 라벨은 아니다.**
 * 클라이언트 지적(*"글자들이 너무 난잡하다"*) 뒤 실측: 단계별 라벨 5,6,8,9,**12**.
 * 보드 17장면(수리 중 3장면 제외)의 최대가 6인데 두 배였다. 그래서 **구름·화살표·
 * 강수는 그대로 누적**하되 **무대를 소개하고 역할이 끝난 라벨만 `until`로 걷는다**
 * (나선 비구름대·권운 차양은 0단계 무대 소개, 바다 온도는 1단계 유입까지가 몫).
 * 🔴 **걷으면 안 되는 둘은 남겼다**: 「눈벽」(4단계 「최대 풍속」과 짝이라 ①이
 * 화면에서 성립한다) · 「하층 수렴 ↔ 상층 발산」(②의 역회전을 **글자로 말하는 유일한
 * 통로**라 3단계에서 반드시 **함께** 떠 있어야 한다).
 */
export const T1_STEPS = Object.freeze([
  {
    key: 'stage',
    title: '따뜻한 바다 위 — 눈과 눈벽',
    note: `해수면 ${T1_FACTS.warmSeaC}°C 이상이 연료다. 가운데 지름 20~50km가 비어 있고(눈) 그 둘레를 가장 높은 구름 벽이 감싼다 — 꼭대기는 ${T1_FACTS.cloudTopKm}km 안팎(12~20km).`,
  },
  {
    key: 'inflow',
    title: '하층 — 반시계로 빨려 든다',
    note: '바다 위 공기가 반시계로 감기면서 중심으로 모여든다. 모이는 만큼 올라갈 수밖에 없다.',
  },
  {
    key: 'updraft',
    title: '눈벽은 솟고 눈은 가라앉는다',
    note: '모인 공기는 눈벽에서 솟는다. 그 반작용으로 한가운데는 오히려 가라앉아 바람이 약하고 맑다 — 비도 눈벽 아래에만 온다.',
  },
  {
    key: 'outflow',
    title: '상층 — 시계로 빠져나간다',
    note: '올라간 공기는 꼭대기의 권운 차양을 따라 밖으로 퍼진다. 이때 감김은 시계 방향 — 하층과 **반대**다.',
  },
  {
    key: 'danger',
    title: '최대 풍속은 눈벽 · 오른쪽이 위험반원',
    note: `가장 센 바람은 중심이 아니라 눈벽, 중심에서 ${T1_FACTS.maxWindInnerKm}~${T1_FACTS.maxWindOuterKm}km다. 진행 방향 오른쪽이 더 세다(위험반원). 최성기 중심기압은 ${T1_FACTS.minPressureHpa}hPa 안팎.`,
  },
]);

/**
 * 눈벽 — **위로 갈수록 바깥으로 기우는** 구름 벽(조사 §2 ③).
 *
 * 🔴 보드의 `cbTower`(수직 적란운)를 쓰지 않는 이유가 여기 있다. 수직으로 세우면
 * 화면이 「적란운 두 개」로 읽히고 **태풍으로 안 읽힌다.** 실제 눈벽도 고도와 함께
 * 바깥으로 기울고(outward slope), 그 기울기가 만드는 **모래시계 실루엣**이 관례에서
 * 태풍의 시각 신호다. 새 표현을 만든 것이 아니라 **보드의 `bb`를 다르게 쌓았을
 * 뿐**이다(셰이더 0줄 · `modules/board/**` 수정 0줄).
 *
 * @param side +1이면 눈 오른쪽(동), -1이면 왼쪽 — **기우는 방향이 이 부호다**
 */
function eyewall({ side, top = H(CLOUD_TOP), at }) {
  const x0 = EYE_X + side * R_WALL;
  // 아래 → 위. `out`이 바깥으로 밀리는 양이고 그것이 곧 기울기다
  const seg = [
    { dy: -0.300, out: 0.000, w: 0.150, h: 0.115, c: rgba('#94a3b8', 0.93) },
    { dy: -0.238, out: 0.014, w: 0.172, h: 0.126, c: rgba('#cbd5e1', 0.95) },
    { dy: -0.170, out: 0.034, w: 0.192, h: 0.136, c: rgba('#e2e8f0', 0.96) },
    { dy: -0.100, out: 0.058, w: 0.206, h: 0.140, c: rgba('#f1f5f9', 0.96) },
    { dy: -0.040, out: 0.084, w: 0.198, h: 0.130, c: rgba('#f8fafc', 0.96) },
  ];
  return seg.map((s) => bb({
    x: x0 + side * s.out, y: top + s.dy, z: ZC, w: s.w, h: s.h, color: s.c, kind: 1, at,
  }));
}

/**
 * 권운 차양 — 영어권 라벨 **"Dense Cirrus Overcast"**(조사 §2 ③).
 * **아래 눈벽보다 넓은** 얇은 차양이 꼭대기에 얹히는 것이 태풍의 두 번째 시각
 * 신호다. 🔴 **0단계에 있어야 한다** — 1차 재제작에서는 3단계에야 나와서 0단계
 * 무대가 「적란운 두 개」로 읽혔다.
 */
function cirrusCanopy({ at }) {
  return [
    bb({ x: EYE_X, y: H(1.03), z: ZC, w: 0.98, h: 0.062, color: rgba('#eef2f7', 0.93), kind: 1, at }),
    bb({ x: EYE_X - 0.26, y: H(0.99), z: ZC - 0.05, w: 0.46, h: 0.05, color: rgba('#e2e8f0', 0.9), kind: 1, at }),
    bb({ x: EYE_X + 0.26, y: H(0.99), z: ZC + 0.05, w: 0.46, h: 0.05, color: rgba('#e2e8f0', 0.9), kind: 1, at }),
  ];
}

/**
 * 나선 비구름대 — 관례는 **바깥으로 갈수록 낮아지는 아치의 행진**이다(조사 §2 ②).
 * 1차에서는 좌우에 퍼프 하나씩이라 「구름이 하나 더 있다」로만 보였다.
 */
function rainBands({ side, at }) {
  const band = [
    { r: 0.30, y: 0.62, s: 0.95 },
    { r: 0.375, y: 0.52, s: 0.85 },
    { r: 0.445, y: 0.43, s: 0.74 },
  ];
  return band.map((b) => bb({
    x: EYE_X + side * b.r, y: H(b.y), z: ZC + side * 0.03,
    w: 0.155 * b.s, h: 0.10 * b.s, color: rgba('#cbd5e1', 0.9), kind: 1, at,
  }));
}

/**
 * 단면 위 한 지점의 기류 — `side`가 +1이면 동(눈 오른쪽), -1이면 서.
 * 방향은 「반지름 성분(수렴/발산) + 접선 성분(회전)」의 합이고, 접선의 부호가
 * 곧 감김이다. 위험반원 가중은 **동쪽(오른쪽)에만** 붙는다.
 */
function limb({ side, x, y, radialGain, spin, rise = 0, thickness, color, travel, count, speed, at, dangerous = true }) {
  const p = [side, 0, 0]; // 단면 위에서 중심 → 이 지점의 방향(z 성분 0)
  const t = tangent(p, spin);
  const dir = [radialGain * p[0], rise, t[2]];
  const gain = dangerous && side > 0 ? DANGEROUS_GAIN : 1;
  return flow({
    from: [x, y, ZC], dir, travel: travel * (gain > 1 ? 1.2 : 1), count,
    scale: thickness * gain, color: rgba(color, 0.95), speed, at, spreadZ: 0.12,
    // 계약 테스트가 읽는 표식 — 층과 감김을 좌표 밖에서도 되짚을 수 있게 한다
  }).map((a) => ({ ...a, ring: spin > 0 ? 'low' : 'high', side, spin }));
}

export const TYPHOON_SECTION_SCENE = composeScene({
  night: false,
  sea: { from: 0, to: 1 }, // 바닥 전체가 바다 — 태풍은 바다 위에서만 산다
  items: [
    // ── 0단계: 무대 ─────────────────────────────────────────────────────────
    // 따뜻한 바다 = 연료. 보드의 `groundHeating` 관용구(bb kind 3)를 바다에 쓴다.
    bb({ x: 0.5, y: 0.004, w: 1.0, h: 0.1, color: rgba('#fb923c', 0.4), kind: 3, at: 0 }),
    // `until: 1` — 연료(따뜻한 바다)는 **하층이 빨려 드는 1단계까지**가 몫이다.
    // 2단계부터는 이야기가 위로 올라가고, 이 수치는 0단계 캡션이 이미 말한다.
    label({ x: 0.17, y: H(0.06), text: `바다 ${T1_FACTS.warmSeaC}°C 이상`, color: WARM_TXT, at: 0, until: 1, size: 10 }),
    // 나선 비구름대 — 눈벽보다 **먼저** 놓아 painter 정렬에서 뒤로 간다
    ...rainBands({ side: -1, at: 0 }),
    ...rainBands({ side: +1, at: 0 }),
    // `until: 0` — 무대를 소개하는 이름표다. 아치는 끝까지 그려지고 이름만 걷는다.
    label({ x: 0.10, y: H(0.78), text: '나선 비구름대', color: '#475569', at: 0, until: 0, size: 9.5 }),
    // 🔴 눈벽 — 좌우 한 쌍이 **위로 갈수록 바깥으로** 기운다(모래시계)
    ...eyewall({ side: -1, at: 0 }),
    ...eyewall({ side: +1, at: 0 }),
    // 🔴 `until` **없음** — 끝까지 남는다. 4단계의 「최대 풍속」이 이 이름표와 짝일
    //    때에만 사실 ①(가장 센 곳은 중심이 아니라 **눈벽**)이 화면에서 성립한다.
    label({ x: EYE_X - R_WALL - 0.15, y: H(0.66), text: '눈벽', color: WALL_TXT, at: 0, size: 11 }),
    // 🔴 권운 차양 — 아래보다 넓다. 이것이 0단계를 태풍으로 만든다
    ...cirrusCanopy({ at: 0 }),
    // ⚠️ 높이 H(1.16) — 차양(H(1.03)) 바로 위다. 실측: H(1.16)은 화면 상단 1.3%로 계약(>2%)에 걸렸다. 보드 라벨의 상단
    //    최소가 5.1%(siberian_snow)라 그보다 위로 올리면 글자 윗변이 잘린다.
    // 🔴 `until: 0` — **0단계에는 반드시 남아야 한다**: `exploreSims.render.test`가
    //    T1의 「껍데기 + 장면 라벨」 짝을 이 문자열로 확인하고 SSR은 step 0만 그린다.
    //    3단계에서 상층이 이 차양을 따라 퍼지지만 그 사실은 3단계 캡션이 말한다.
    label({ x: 0.31, y: H(1.10), text: '권운 차양', color: '#64748b', at: 0, until: 0, size: 10 }),
    // 눈 — 구름을 **비워 두는 것**이 그림이다(중앙에 아무것도 놓지 않는다).
    // `until: 2` — 2단계에서 「하강 · 맑음」이 같은 자리를 이어받는다.
    label({ x: EYE_X, y: H(0.42), text: '눈', color: EYE_TXT, at: 0, until: 2, size: 11 }),

    // ── 1단계: 하층이 빨려 든다 — 반시계(spin +1) ───────────────────────────
    // 동쪽(오른쪽)은 접선이 북(+z), 서쪽은 남(-z) — 그것이 반시계다.
    // ⚠️ `radialGain`을 1.5로 키운 이유: 직교 측면 투영에서 ±z는 거의 안 보인다.
    //    조사가 알려 준 관례대로 **「모인다」를 반지름 성분으로 보이게** 한다
    //    (감김의 부호는 그대로라 사실은 안 바뀐다 — 계약이 그 부호를 문다).
    ...limb({ side: +1, x: EYE_X + R_OUTER, y: Y_LOW, radialGain: -1.5, spin: +1, rise: 0.04, thickness: T1_THICKNESS.inflow, color: SEA, travel: 0.3, count: 3, speed: 0.5, at: 1 }),
    ...limb({ side: -1, x: EYE_X - R_OUTER, y: Y_LOW, radialGain: -1.5, spin: +1, rise: 0.04, thickness: T1_THICKNESS.inflow, color: SEA, travel: 0.3, count: 3, speed: 0.5, at: 1 }),
    // 🔴 `until: 3` — **3단계까지는 반드시 남는다.** 「하층 수렴 ↔ 상층 발산」이 한
    //    화면에 함께 떠야 사실 ②(아래·위 감김이 반대)가 글자로 성립하고, 그 짝이
    //    맺어지는 곳이 3단계다. 4단계는 「어디가 센가」라 이 몫이 끝난다.
    label({ x: 0.16, y: H(0.24), text: '하층 수렴', color: SEA_TXT, at: 1, until: 3, size: 10 }),

    // ── 2단계: 눈벽은 솟고 눈은 가라앉는다 ──────────────────────────────────
    // 🔴 **여기가 전체 최대 굵기**다 — 최대 풍속은 눈벽이지 중심이 아니다.
    ...limb({ side: +1, x: EYE_X + R_WALL, y: H(0.14), radialGain: -0.12, spin: +1, rise: 2.6, thickness: T1_THICKNESS.eyewall, color: WALL, travel: 0.26, count: 3, speed: 0.62, at: 2 }),
    ...limb({ side: -1, x: EYE_X - R_WALL, y: H(0.14), radialGain: -0.12, spin: +1, rise: 2.6, thickness: T1_THICKNESS.eyewall, color: WALL, travel: 0.26, count: 3, speed: 0.62, at: 2 }),
    // `until: 2` — 「솟는다」는 2단계의 말이고, 4단계에서 같은 눈벽을 가리키는 말은
    // 「최대 풍속」이다. 둘을 함께 띄우면 같은 화살표에 이름표가 둘 붙는다.
    label({ x: EYE_X + R_WALL + 0.19, y: H(0.56), text: '상승', color: WALL_TXT, at: 2, until: 2, size: 11 }),
    // 눈 속 — 하강기류·약풍·맑음. **가장 가는 화살표**여야 한다
    ...flow({ from: [EYE_X, H(0.66), ZC], dir: [0, -1, 0], travel: 0.22, count: 1, scale: T1_THICKNESS.eye, color: rgba('#94a3b8', 0.95), speed: 0.24, at: 2 })
      .map((a) => ({ ...a, eye: true })),
    label({ x: EYE_X, y: H(0.16), text: '하강 · 맑음', color: EYE_TXT, at: 2, size: 10 }),
    // 눈벽 아래에만 비가 온다 — 눈에는 안 온다는 것이 이 배치의 뜻이다
    precip({ x0: EYE_X - R_WALL - 0.07, x1: EYE_X - R_WALL + 0.05, y1: H(0.7), z0: 0.06, z1: Z - 0.06, slant: 0.3, speed: 1.7, count: 26, at: 2 }),
    precip({ x0: EYE_X + R_WALL - 0.05, x1: EYE_X + R_WALL + 0.07, y1: H(0.7), z0: 0.06, z1: Z - 0.06, slant: 0.3, speed: 1.7, count: 26, at: 2 }),

    // ── 3단계: 상층이 반대로 풀린다 — 시계(spin -1) ─────────────────────────
    // 🔴 발산은 **권운 차양 위에서 바깥으로** 눕는다 — 조사가 알려 준 「나비」
    //    실루엣이다(아래는 모이고 위는 퍼진다). 감김의 부호(z)는 그대로다.
    ...limb({ side: +1, x: EYE_X + R_WALL + 0.10, y: Y_TOP, radialGain: 1.8, spin: -1, rise: 0.12, thickness: T1_THICKNESS.outflow, color: OUT, travel: 0.34, count: 3, speed: 0.56, at: 3, dangerous: false }),
    ...limb({ side: -1, x: EYE_X - R_WALL - 0.10, y: Y_TOP, radialGain: 1.8, spin: -1, rise: 0.12, thickness: T1_THICKNESS.outflow, color: OUT, travel: 0.34, count: 3, speed: 0.56, at: 3, dangerous: false }),
    label({ x: 0.76, y: H(1.16), text: '상층 발산', color: OUT_TXT, at: 3, size: 11 }),

    // ── 4단계: 그래서 어디가 센가 ───────────────────────────────────────────
    // 진행 방향은 바닥 평면 위에 둔다(지도 시점 바닥이 보드 문법의 절반이다)
    ...flow({ from: [0.5, 0.012, 0.04], dir: MOTION_DIR, travel: 0.16, count: 1, scale: 0.05, color: rgba('#334155', 0.9), speed: 0.3, at: 4 })
      .map((a) => ({ ...a, motion: true })),
    label({ x: 0.46, y: H(-0.12), text: '진행 방향(북)', color: '#334155', at: 4, size: 10 }),
    label({ x: 0.85, y: H(0.30), text: '위험반원', color: '#b91c1c', at: 4, size: 11 }),
    label({ x: 0.30, y: H(0.36), text: '최대 풍속', color: WALL_TXT, at: 4, size: 10 }),
  ],
});

/** 계약 테스트가 값으로 검산하는 표 — 「그림이 사실과 맞나」를 코드가 판정한다 */
export function t1Checks() {
  const arrows = TYPHOON_SECTION_SCENE.items.filter((it) => it.type === 'arrow');
  const radiusKm = (a) => Math.abs(a.origin[0] - EYE_X) * KM_PER_UNIT;
  const strongest = arrows.reduce((m, a) => (a.scale > m.scale ? a : m), arrows[0]);
  const eyeArrows = arrows.filter((a) => radiusKm(a) < T1_FACTS.eyeRadiusKm);
  return {
    maxWindRadiusKm: radiusKm(strongest),
    maxWindScale: strongest.scale,
    eyeScale: Math.min(...eyeArrows.map((a) => a.scale)),
    lowSpins: [...new Set(arrows.filter((a) => a.ring === 'low').map((a) => a.spin))],
    highSpins: [...new Set(arrows.filter((a) => a.ring === 'high').map((a) => a.spin))],
    eyeRadius: R_EYE,
    wallRadius: R_WALL,
  };
}
