/**
 * typhoonLifecycleScene — **T2 태풍의 생애(발달 → 소멸)** 장면 데이터 (MT-22).
 *
 * ⚠️ **T1과 다른 그림이다.** T1은 한 시점을 자르는 그림이고, T2는 **시간에 따라
 * 겉모습과 위치가 어떻게 변하는가**다(클라이언트 문장의 「개별적 단면」 ↔ 「전체적
 * 외적」). 하나를 회전시켜 둘로 쓰는 것이 아니다.
 *
 * ── 🔴 착수 전 판정: 「시간 전개가 렌더러 계약 안에서 되는가」 ────────────────
 * **된다. 장면 데이터만으로 되고 렌더러·API 변경이 0이다.** 근거는 `renderer.js:89`
 * 한 줄이다: `visible = (it.at ?? 0) <= step && step <= (it.until ?? Infinity)`.
 *  · `at: k`만 주면 **누적**(C1·T1이 쓰는 방식) — 경로선·위도선처럼 쌓이는 것
 *  · `at: k, until: k`를 주면 **그 단계에만** 보인다 — 태풍 자신처럼 **한 번에 한
 *    자리에만 있어야 하는 것**. 이 배타 표시가 곧 시간 전개다
 * 실측으로도 확인했다(0단계 A·1단계 B·2단계 소멸 — 계약 테스트가 같은 것을 문다).
 * 그래서 범위 확대 없이 진행한다.
 *
 * ── 좌표 규약 — T1과 같다 ────────────────────────────────────────────────────
 *   x = 동 · **z = 남**(+z가 남쪽) · y = 고도(세력의 키).
 * 북이 -z여야 화면에서 북이 위로 온다(이유는 `typhoonSectionScene.js` 헤더).
 * 위도는 `zOfLat()`이 소유한다.
 *
 * ── 조사(§3 T2 · 출처 S1)에서 가져온 문법 ────────────────────────────────────
 *  · 4단계: 형성기 → 발달기 → **최성기** → 쇠퇴기. 수명 평균 5일(길게 10~15일)
 *  · 발달기에는 **무역풍**을 타고 서~서북서로 **20~25km/h**(느리다)
 *  · 🔴 **북위 20~30°에서 전향** — 이 그림의 주인공이다. **전향할 때 약 하루 정체**하고
 *    **전향 후 편서풍을 타고 급가속**한다(여름 35~40km/h, 가을엔 드물게 80km/h+)
 *  · 🔴 소멸은 「사라진다」가 아니라 **온대저기압으로 성질이 바뀐다(ET)**. 고위도
 *    이동·상륙·연직 시어가 원인
 *
 * **화살표가 말하는 것 두 가지**(이 그림에서 굵기와 길이의 뜻이 T1과 다르다):
 *   · 수평 화살표의 **길이 = 이동 속도**(km/h에 비례) · 굵기 = 세력
 *   · 수직 화살표의 **길이 = 세력의 키**(구름 높이) — 최성기에 가장 높다
 * 정체 구간은 **길이가 거의 0인 화살표**로, 급가속은 **가장 긴 화살표**로 읽힌다.
 */

const TAU = Math.PI * 2;

/** 이동 속도 → 화살표 길이. 20km/h = 0.16, 80km/h = 0.64 */
export const SPEED_UNIT = 0.008;
export const speedLen = (kmh) => Math.max(0.05, kmh * SPEED_UNIT);

/** 위도 → z. 북이 -z다(적도 쪽이 +z) */
export const zOfLat = (lat) => 0.5 - (lat - 10) * 0.04;

/** 조사 §3 T2의 수치 — 단계마다 하나씩 대응한다 */
export const T2_STAGES = Object.freeze([
  { key: 'form', title: '형성기', lat: 12, x: 0.92, speedKmh: 20, power: 0.28, height: 0.3, note: '해수면 26.5°C 이상 · 잠열이 에너지원' },
  { key: 'grow', title: '발달기', lat: 17, x: 0.42, speedKmh: 23, power: 0.44, height: 0.52, note: '무역풍을 타고 서~서북서 20~25km/h' },
  { key: 'peak', title: '최성기 · 전향', lat: 24, x: -0.08, speedKmh: 5, power: 0.62, height: 0.86, note: '북위 20~30°에서 전향 — 약 하루 정체' },
  { key: 'accel', title: '전향 후 급가속', lat: 31, x: 0.28, speedKmh: 38, power: 0.5, height: 0.66, note: '편서풍을 타고 북~북동 35~40km/h' },
  { key: 'et', title: '쇠퇴 · 온대저기압으로 변질', lat: 38, x: 0.78, speedKmh: 55, power: 0.3, height: 0.34, note: '수증기 공급이 끊긴다 — 사라지는 것이 아니라 성질이 바뀐다' },
]);

const TRACK = '#94a3b8';
const WARM = '#f97316'; // 열대 성질(태풍)
const PEAK = '#ef4444'; // 최성기
const COLD = '#60a5fa'; // 온대저기압으로 변질된 뒤
const GRID = '#475569';
const TEXT = '#e2e8f0';

const stageColor = (i) => (i === T2_STAGES.length - 1 ? COLD : i === 2 ? PEAK : WARM);
const posOf = (s) => [s.x, 0, zOfLat(s.lat)];

const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const arrow = (origin, dir, length, thickness, color, extra = {}) => ({
  type: 'arrow', origin, dir: norm(dir), length, thickness, color, alpha: 1, ...extra,
});
const label = (pos, text, color, extra = {}) => ({
  type: 'label', pos, text, size: 11, weight: 600, color, ...extra,
});

/**
 * 그 단계의 태풍 자신 — **반시계 접선 화살표 링**(북반구 저기압성 회전).
 * T1과 같은 부호 규약이다(spin +1 = 위에서 봤을 때 반시계).
 * ⚠️ `until`을 주는 것이 이 그림의 전부다 — 태풍은 **한 번에 한 자리에만** 있어야
 * 하므로 다음 단계로 넘어가면 사라져야 한다(누적이면 태풍이 5마리가 된다).
 */
function stormRing(stage, i, n = 6) {
  const c = posOf(stage);
  const r = 0.13 + stage.power * 0.24;
  const color = stageColor(i);
  const items = [];
  for (let k = 0; k < n; k += 1) {
    const a = (k / n) * TAU;
    const p = [Math.cos(a), 0, Math.sin(a)];
    const t = [p[2], 0, -p[0]]; // ŷ × p = 반시계(위에서 볼 때)
    items.push(arrow([c[0] + p[0] * r, 0.02, c[2] + p[2] * r], t, 0.12 + stage.power * 0.1,
      0.12 + stage.power * 0.3, color, { at: i, until: i, storm: stage.key, spin: +1 }));
  }
  return items;
}

/** 세력의 키 — 수직 화살표. 최성기에 가장 높고 ET에서 낮아진다(수직 = 특이점 분기) */
function powerColumn(stage, i) {
  const c = posOf(stage);
  return arrow([c[0], 0.02, c[2]], [0, 1, 0], stage.height, 0.16 + stage.power * 0.34,
    stageColor(i), { at: i, until: i, column: stage.key });
}

/** 이동 화살표 — **길이가 곧 속도**다. 정체는 길이가 거의 0이 된다 */
function motionArrow(stage, i) {
  const next = T2_STAGES[Math.min(i + 1, T2_STAGES.length - 1)];
  const c = posOf(stage);
  const to = posOf(next);
  const dir = i === T2_STAGES.length - 1 ? [0.4, 0, -1] : [to[0] - c[0], 0, to[2] - c[2]];
  return arrow([c[0], 0.03, c[2]], dir, speedLen(stage.speedKmh), 0.3, TEXT,
    { at: i, until: i, motion: stage.key, speedKmh: stage.speedKmh });
}

export const T2_STEPS = Object.freeze(T2_STAGES.map((s) => ({ key: s.key, title: s.title })));

export const TYPHOON_LIFECYCLE_SCENE = Object.freeze({
  id: 't2-typhoon-lifecycle',
  background: null,
  // 거의 위에서 내려다보는 시점 — 지도이기 때문이다. 다만 완전 수직은 아니어서
  // 세력의 키(수직 화살표)가 입체로 읽힌다.
  // ⚠️ yaw는 **0이어야 한다** — 조금만 틀어도 위도선이 화면에서 기울어 지도가
  // 아니라 비스듬한 판이 된다(실기기에서 확인). pitch는 지도로 읽히되 세력의 키가
  // 납작해지지 않는 선에서 잡았다.
  camera: { yaw: 0, pitch: 64, dist: 2.85, fov: 34, target: [0.05, 0.1, -0.02] },
  items: [
    // ── 무대: 위도선 ─ 전향대(20~30°)를 띠로 강조한다 ────────────────────────
    ...[10, 20, 30, 40].map((lat) => ({
      type: 'line',
      points: [[-1.0, 0, zOfLat(lat)], [1.0, 0, zOfLat(lat)]],
      color: lat === 20 || lat === 30 ? '#64748b' : GRID,
      alpha: lat === 20 || lat === 30 ? 0.8 : 0.45,
      at: 0,
    })),
    label([-1.0, 0.03, zOfLat(20)], '북위 20°', '#94a3b8', { at: 0, size: 10 }),
    label([-1.0, 0.03, zOfLat(30)], '북위 30°', '#94a3b8', { at: 0, size: 10 }),
    label([0.95, 0.03, zOfLat(14)], '무역풍대 — 서쪽으로', '#94a3b8', { at: 1, size: 10 }),
    label([-0.75, 0.03, zOfLat(34)], '편서풍대 — 동쪽으로', '#94a3b8', { at: 3, size: 10 }),

    // ── 경로: 단계가 지나간 자리는 **남는다**(누적. at만 주고 until을 안 준다) ─
    ...T2_STAGES.slice(0, -1).map((s, i) => ({
      type: 'line',
      points: [posOf(s), posOf(T2_STAGES[i + 1])],
      color: i === 2 ? COLD : TRACK,
      alpha: 0.85,
      at: i + 1,
      track: true,
    })),

    // ── 각 단계의 태풍 자신 — **그 단계에만**(at = until) ────────────────────
    ...T2_STAGES.flatMap((s, i) => [
      ...stormRing(s, i),
      powerColumn(s, i),
      motionArrow(s, i),
      label([s.x, s.height + 0.14, zOfLat(s.lat)], `${i + 1}. ${s.title}`, stageColor(i), { at: i, until: i, size: 12 }),
      // ⚠️ 긴 문장을 태풍 옆에 두면 **화면 밖으로 잘린다**(실기기 확인). 라벨은 앵커
      // 중앙 정렬이라 x를 가운데로 당기고 위도만 따라가게 한다.
      label([-0.02, 0.04, zOfLat(s.lat) + 0.34], s.note, '#cbd5e1', { at: i, until: i, size: 10 }),
      // 속도 라벨은 **경로 반대쪽**(서쪽)에 붙인다 — 동쪽에 붙이면 형성기(x=0.92)에서 화면 밖이다
      label([s.x - 0.42, 0.08, zOfLat(s.lat) + 0.02], `${s.speedKmh}km/h`, TEXT, { at: i, until: i, size: 10 }),
    ]),

    // 🔴 전향점 — 이 그림의 주인공. 최성기 단계에서만 못박는다
    label([-0.3, 0.02, zOfLat(24) - 0.2], '전향 — 여기서 약 하루 정체한다', PEAK, { at: 2, until: 2, size: 11 }),
    label([-0.05, 0.02, zOfLat(31) - 0.22], '전향 뒤 급가속 — 느리게 오다가 갑자기 빨라진다', TEXT, { at: 3, until: 3, size: 11 }),
    label([-0.02, 0.02, zOfLat(38) - 0.24], '온대저기압으로 변질(ET) — 태풍으로서의 일생을 마친 것', COLD, { at: 4, until: 4, size: 11 }),
    label([0.0, 0.02, zOfLat(9)], '수명 평균 5일(길게 10~15일)', '#94a3b8', { at: 4, size: 10 }),
  ],
});

/** 계약 테스트가 값으로 검산하는 표 */
export function t2Checks() {
  const items = TYPHOON_LIFECYCLE_SCENE.items;
  const motions = items.filter((it) => it.motion);
  const rings = items.filter((it) => it.storm);
  return {
    // 한 단계에 태풍은 **하나**여야 한다 — 배타 표시가 살아 있는지의 값
    stormsPerStep: T2_STAGES.map((_, s) => new Set(rings.filter((r) => (r.at ?? 0) <= s && s <= (r.until ?? Infinity)).map((r) => r.storm)).size),
    // 전향 정체 → 급가속: 길이가 그 순서를 그대로 담고 있어야 한다
    stallLen: motions.find((m) => m.motion === 'peak').length,
    growLen: motions.find((m) => m.motion === 'grow').length,
    accelLen: motions.find((m) => m.motion === 'accel').length,
    recurveLat: T2_STAGES[2].lat,
    peakHeight: T2_STAGES[2].height,
    lastKey: T2_STAGES[T2_STAGES.length - 1].key,
    spins: [...new Set(rings.map((r) => r.spin))],
  };
}
