/**
 * 위성 구름장 — 순수 계산부 (MT-21 개정).
 *
 * **왜 다시 만들었나**: 초판은 동심원 3겹이었다. 그건 도해(diagram)이지 위성이 아니다.
 * 실제 위성 영상(천리안·히마와리 IR)의 인상을 만드는 것은 세 가지다 —
 *   ⑴ **난류 질감**: 구름 가장자리가 매끈하지 않고 잘게 찢어져 있다
 *   ⑵ **나선 밴드**: 구름이 중심으로 감겨 들어간다(원이 아니라 소용돌이)
 *   ⑶ **비대칭**: 시어가 있으면 상층 구름이 한쪽으로 흘러 중심이 드러난다
 * 셋 다 노이즈를 **극좌표에서 뒤틀어** 만든다. 원을 겹쳐서는 나오지 않는다.
 *
 * 캔버스와 분리한 이유: 이 파일은 DOM을 모른다. 시어가 실제로 비대칭을 만드는지
 * 같은 판정은 픽셀을 그리지 않고 **숫자로** 검증할 수 있어야 한다(스모크가 그렇게 문다).
 *
 * 결정성: 해시 기반 값 노이즈라 같은 입력이면 항상 같은 그림이다. `Math.random`을
 * 쓰지 않는다 — 렌더할 때마다 구름이 바뀌면 슬라이더를 움직였을 때 **무엇 때문에
 * 바뀐 것인지** 알 수 없게 된다.
 */

/** 정수 해시 → 0..1. 곱수는 흔한 32bit 혼합 상수(품질만 보고 고름, 의미 없음). */
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** 값 노이즈 — 격자 4점 보간. */
function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** fBm — 옥타브를 겹쳐 "잘게 찢어진" 가장자리를 만든다. 4겹이면 충분하다. */
export function fbm(x, y, octaves = 6) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07; // 정수배를 피해 격자 무늬가 겹쳐 보이는 것을 막는다
  }
  return sum / norm;
}

/** 시어 등급 → 상층 구름이 밀리는 거리(정규화 반경 대비). 물리량이 아니라 표시 강도다. */
export const SHEAR_DRIFT = { weak: 0.0, moderate: 0.22, strong: 0.5 };

/**
 * 한 점의 구름 두께 0..1.
 *
 * @param nx,ny  중심을 원점으로 한 정규화 좌표(태풍 반경 1 기준)
 * @param p      { intensity 0..100, shear, seed }
 *
 * 구조:
 *  · `phase = θ + swirl·ln(r)` — **로그 나선**. 실제 강수 밴드가 이 형태로 감긴다.
 *  · 노이즈를 그 위상 위에서 샘플링하면 밴드가 감기면서 잘게 부서진다.
 *  · 눈: 중심 반경 안쪽을 깎는다. **시어가 세면 눈이 안 뚫린다**(상하층이 어긋나
 *    기둥이 무너지므로) — `eyeOpen`이 그 판정이다.
 *  · 시어: 반경이 클수록(=상층일수록) 샘플 중심을 `drift`만큼 옮긴다. 그래서
 *    바깥 구름만 밀리고 중심은 제자리에 남아 **중심이 드러나는** 모양이 된다.
 */
export function cloudAt(nx, ny, p) {
  const inten = Math.max(0, Math.min(100, p.intensity ?? 0)) / 100;
  if (inten <= 0) return 0;
  const drift = SHEAR_DRIFT[p.shear] ?? 0;
  const seed = p.seed ?? 0;
  const spin = p.spin ?? 0; // 회전 위상(회전수) — 프레임마다 늘어난다

  const r0 = Math.hypot(nx, ny);
  const lift = Math.min(1, r0 / 1.1);
  const sx = nx - drift * lift;
  const sy = ny + drift * lift * 0.35;

  const r = Math.hypot(sx, sy);
  if (r > 1.6) return 0;

  // ── 회전 ──
  // ⚠️ **위상을 돌리면 안 된다.** 처음에 노이즈 위상에 회전을 더했더니 값이
  // 0.04 → 0.98 → 0.00으로 널뛰었다 — 그건 회전이 아니라 **매 프레임 다른 무늬**다.
  // 진짜 회전은 "같은 무늬가 각도만 바뀌는 것"이므로, 필드를 고정하고
  // **샘플 좌표를 반대로 돌려** 읽는다. 그래야 밴드가 모양을 유지한 채 흐른다.
  //
  // 차등 회전: 안쪽이 훨씬 빨리 돈다. 통째로 돌리면 바람개비가 되고, 실제 위성
  // 루프에서 눈벽이 빠르게 도는 동안 바깥 나선이 느릿한 이유가 이 차등이다.
  // 북반구는 반시계 — 부호가 음수다.
  const omega = -1 / (0.22 + r * 2.2);
  const a = spin * 2 * Math.PI * omega;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rx = sx * ca - sy * sa;
  const ry = sx * sa + sy * ca;

  const theta = Math.atan2(ry, rx);
  const swirl = 2.4;
  const phase = theta + swirl * Math.log(Math.max(r, 0.05));

  const k = 5.0;
  const n = fbm(
    Math.cos(phase) * k + r * 7.0 + seed * 17,
    Math.sin(phase) * k + r * 7.0 - seed * 11,
  );

  // 반경 프로파일 — 나선 팔이 바깥까지 길게 뻗는다(레퍼런스: 팔이 화면 밖까지 간다).
  // 지수를 낮출수록 멀리 간다.
  const shieldR = 0.62 + inten * 0.62;
  const falloff = Math.max(0, 1 - Math.pow(r / shieldR, 1.5));

  // 눈 — **작고 또렷하게**. 레퍼런스의 눈은 거의 점이다.
  const eyeOpen = drift < 0.1 && inten >= 0.4;
  const eyeR = eyeOpen ? 0.055 + (1 - inten) * 0.03 : 0;
  const eye = eyeOpen ? Math.min(1, Math.max(0, (r - eyeR) / (eyeR * 0.25))) : 1;

  // 중심 밀집(CDO) — 눈 둘레는 밴드가 갈라지지 않고 **통짜 흰 덩어리**다.
  // 이게 없으면 중심까지 줄무늬가 들어가 "무지개 소용돌이"가 된다.
  const cdo = Math.exp(-Math.pow(r / (0.17 + inten * 0.14), 2));

  const band = Math.max(0, Math.min(1, (n - 0.44) * 3.6));
  // ⚠️ eye를 **CDO에도** 곱해야 한다 — 안 그러면 통짜 덩어리가 눈을 덮어 버려
  //    "눈이 뚫린다"가 화면에서 사라진다(실측: 중심 구름 0.74로 눈이 막혔다).
  const dense = Math.min(1, band * eye + cdo * eye * (0.55 + inten * 0.45));
  return Math.max(0, Math.min(1, dense * falloff * (0.5 + inten * 0.6)));
}

/**
 * 비대칭 지표 — 좌우 구름량 차이의 비(0=대칭). 스모크가 **픽셀 없이** 시어를 검증한다.
 * 화면을 안 보고도 "시어를 올리면 한쪽으로 쏠린다"를 숫자로 확인할 수 있어야 한다.
 */
export function asymmetry(p, samples = 40) {
  let left = 0;
  let right = 0;
  for (let i = 0; i < samples; i += 1) {
    for (let j = 0; j < samples; j += 1) {
      const nx = (i / (samples - 1)) * 2.6 - 1.3;
      const ny = (j / (samples - 1)) * 2.6 - 1.3;
      const v = cloudAt(nx, ny, p);
      if (nx < 0) left += v;
      else right += v;
    }
  }
  const total = left + right;
  return total === 0 ? 0 : Math.abs(right - left) / total;
}

/**
 * 눈 구멍의 깊이 — **중심 아주 가까이**(반경 0.05)의 평균 구름량.
 *
 * ⚠️ 반경을 0.18로 잡았다가 틀렸다: 눈이 실제로 뚫렸는데도(중심 값 0.00) 그 안에
 * **눈벽**(0.90)이 들어와 평균이 0.74로 나왔다 — 지표가 눈이 아니라 눈벽을 재고
 * 있었다. 눈은 작다(반경 0.055). 재는 창도 그만큼 작아야 한다.
 */
export function coreCover(p, samples = 16) {
  let sum = 0;
  let n = 0;
  const R = 0.05;
  for (let i = 0; i < samples; i += 1) {
    for (let j = 0; j < samples; j += 1) {
      const nx = (i / (samples - 1)) * 2 * R - R;
      const ny = (j / (samples - 1)) * 2 * R - R;
      if (Math.hypot(nx, ny) > R) continue;
      sum += cloudAt(nx, ny, p);
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

// ═══════════════════════════════════════════════════════════════
// 이동 경로 (MT-21 개정 ②) — 태풍은 한자리에 있지 않다
// ═══════════════════════════════════════════════════════════════

/**
 * 전향 경로(recurving track) — 실제 한반도 접근 태풍의 전형이다.
 * 필리핀 해상에서 **서북서로 밀려오다** 아열대고기압 가장자리에서 **북동으로 꺾인다**.
 * 직선으로 두면 "북상하면 약해진다"는 학습 요점이 안 살고, 무엇보다 실제와 다르다.
 *
 * t: 0(발생) ~ 1(소멸). 반환은 뷰 정규 좌표(0~1)와 **생애 배율**이다.
 */
export function trackAt(t) {
  const u = Math.max(0, Math.min(1, t));
  // 실제 경위도로 잡은 제어점 — 화면 창(112~148°E, 18~48°N)에 그대로 얹힌다.
  // 필리핀 동쪽 해상 발생 → 오키나와 서쪽 북상 → 제주 남쪽에서 전향 → 동해로 빠짐.
  // 2018 솔릭·2020 마이삭 계열의 전형적인 전향 경로다.
  const LON = [128.0, 126.5, 126.0, 128.5, 134.0];
  const LAT = [19.0, 25.5, 31.5, 37.0, 43.5];
  const W = 112.0;
  const E = 148.0;
  const S = 18.0;
  const N = 48.0;

  // 2차 베지에 2개(전향점 = 가운데 제어점)
  const k = u < 0.5 ? u / 0.5 : (u - 0.5) / 0.5;
  const i = u < 0.5 ? 0 : 2;
  const m = 1 - k;
  const lon = m * m * LON[i] + 2 * m * k * LON[i + 1] + k * k * LON[i + 2];
  const lat = m * m * LAT[i] + 2 * m * k * LAT[i + 1] + k * k * LAT[i + 2];

  // 생애 곡선 — 따뜻한 바다에서 자라 전향 후 찬 바다·육지에서 급히 쇠퇴한다.
  // 최성기를 전향점 직전(t≈0.42)에 둔다: 실제로도 전향 무렵이 가장 세다.
  const peak = 0.42;
  const life = u <= peak
    ? Math.pow(Math.min(1, u / peak), 0.7)
    : Math.max(0, 1 - Math.pow((u - peak) / (1 - peak), 1.35));

  return {
    x: (lon - W) / (E - W),
    y: (N - lat) / (N - S),
    lon,
    lat,
    life: Math.max(0, Math.min(1, life)),
  };
}

/** 경로 폴리라인 — 화면에 지나온 길을 그린다(실제 태풍 경로도의 관례). */
export function trackPolyline(steps = 48) {
  return Array.from({ length: steps + 1 }, (_, i) => trackAt(i / steps));
}
