/**
 * typhoonLifecycleScene — **T2 태풍의 생애(발달 → 소멸)** 장면 데이터
 * (MT-22 · 2026-08-19 재제작).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  왜 다시 그렸나 — **좌측 2/3가 통째로 비어 있었다**
 * ══════════════════════════════════════════════════════════════════════════════
 * 실측: 종전 0단계의 항목은 `{line 4, label 5, arrow 8}`. 지도라면서 **지도가
 * 없었다** — 위도선 4줄이 전부였고 해안선도 바다도 육지도 없었다. 화면 우하단
 * 구석에 주황 화살표 몇 개만 떠 있었다.
 *
 * 그래서 **보드 무대의 「지도 시점 바닥」을 그대로 쓴다.** 보드 문법은 「투명 유리
 * 상자 + 지도 시점 바닥 + 전면 수직 단면」인데, T2는 그중 **바닥이 주인공**인
 * 그림이다(T1은 전면 단면이 주인공이다). 바닥에 바다를 깔고 그 위에 육지 덩어리를
 * 세우면, 유리 상자·지표 격자·흙 앞단면이 **무대에서 공짜로 따라온다.**
 *
 * ⚠️ **T1과 다른 그림이다.** T1은 한 시점을 자르는 그림이고, T2는 **시간에 따라
 * 겉모습과 위치가 어떻게 변하는가**다(클라이언트 문장의 「개별적 단면」 ↔ 「전체적
 * 외적」). 하나를 회전시켜 둘로 쓰는 것이 아니다.
 *
 * ── 2차 보정(2026-08-19 오후 · 이미지 조사 §4) ───────────────────────────────
 * 조사에서 **「단계 나열」이 아니라 「지도 위 경로」가 관례**임을 확인했다(예외를
 * 거의 못 봤다) — 1차의 판형 선택이 맞았다는 외부 근거다. 바꾼 것은 하나다:
 * 🔴 **`note` 전체 문장을 캔버스에서 걷어냈다.** 보드는 `CrossSectionPanel`이 단계
 * 캡션을 캔버스 **밖 HTML**로 뿌리고 캔버스 안에는 짧은 명사구만 둔다. 1차는 긴
 * 문장을 상자 앞 바닥에 눕혀 놨는데, **라벨 화면 좌표 실측으로 보드 라벨이 top
 * 5~66%에 머무는 동안 T2만 82%까지 내려갔다** — 반려 사유였던 「떠 있는 글자 목록」과
 * 같은 형태다. 이제 문장은 `T2_STEPS[].note`이고 `SchematicPanel`이 캡션으로 뿌린다.
 *
 * ── 시간 전개가 무대 계약 안에서 되는가 — **된다** ───────────────────────────
 * 근거는 `crossSection/renderer.js:46` 한 줄이다:
 *   `visible = (it) => it.at <= step && step <= (it.until ?? Infinity)`
 *  · `at: k`만 주면 **누적** — 지나온 경로처럼 쌓이는 것
 *  · `at: k, until: k`를 주면 **그 단계에만** — 태풍 자신처럼 **한 번에 한 자리에만**
 *    있어야 하는 것. 이 배타 표시가 곧 시간 전개다(누적이면 태풍이 5마리가 된다)
 * ⚠️ 관례(정적 요약 이미지)는 오히려 **모든 위치에 기호를 남긴다.** 그쪽은 한 장에
 * 생애 전체를 담아야 해서이고, 이쪽은 단계 애니메이션이라 성격이 다르다 —
 * 지나온 자리는 **경로 점**이 대신한다.
 *
 * ── 좌표 규약 — **보드와 같다** ──────────────────────────────────────────────
 *   x 0~1 서→동(`xOfLon`) · z 0~0.42 남→북(`zOfLat`) · y 고도(세력의 키).
 * 종전 파일은 「북 = -z」라는 자기만의 규약을 세웠으나 보드는 「z 0 = 앞/남」이다.
 * 규약을 보드로 되돌렸다 — 두 그림이 다른 세계로 보이던 원인 중 하나였다.
 *
 * ── 조사(§3 T2 · 출처 S1)에서 가져온 사실 ────────────────────────────────────
 *  · 4단계: 형성기 → 발달기 → **최성기** → 쇠퇴기. 수명 평균 5일(길게 10~15일)
 *  · 발달기에는 **무역풍**을 타고 서~서북서로 **20~25km/h**(느리다)
 *  · 🔴 **북위 20~30°에서 전향** — 이 그림의 주인공이다. **전향할 때 약 하루 정체**하고
 *    **전향 후 편서풍을 타고 급가속**한다(여름 35~40km/h, 가을엔 드물게 80km/h+)
 *  · 🔴 소멸은 「사라진다」가 아니라 **온대저기압으로 성질이 바뀐다(ET)**
 *
 * **화살표가 말하는 것 두 가지**(굵기와 길이의 뜻이 T1과 다르다):
 *   · 이동 화살표의 **왕복 거리(travel) = 이동 속도**(km/h에 비례) · 크기 = 세력
 *   · 세력 기둥의 **왕복 거리 = 세력의 키**(구름 높이) — 최성기에 가장 높다
 * 정체 구간은 **거의 움직이지 않는 화살표**로, 급가속은 **가장 멀리 가는 화살표**로
 * 읽힌다.
 */
import {
  H, vol, bb, cbTower, flow, label, precip, puff, composeScene,
} from '../../board/webgl/crossSection/scenes.js';
import { rgba } from '../../board/webgl/crossSection/glCore.js';

const TAU = Math.PI * 2;

/** 이동 속도 → 화살표 왕복 거리. 20km/h = 0.11, 55km/h = 0.30 */
export const SPEED_UNIT = 0.0055;
export const speedLen = (kmh) => Math.max(0.03, kmh * SPEED_UNIT);

/** 경위도 → 바닥 좌표. **북이 +z**(보드 규약: z 0 = 앞/남) */
export const GEO = Object.freeze({ west: 112, east: 152, south: 8, north: 41.6 });
export const xOfLon = (lon) => (lon - GEO.west) / (GEO.east - GEO.west);
export const zOfLat = (lat) => (lat - GEO.south) * 0.0125;

/**
 * 조사 §3 T2의 수치 — 단계마다 하나씩 대응한다.
 * `lon`·`lat`이 **좌표의 단일 소유자**다(종전에는 x를 손으로 적어 지도와 어긋났다).
 * `note`는 **캔버스 밖 캡션**으로 나간다(위 2차 보정 참조).
 */
export const T2_STAGES = Object.freeze([
  { key: 'form', title: '형성기', lat: 12, lon: 145, speedKmh: 20, power: 0.28, height: 0.3, note: '해수면 26.5°C 이상 · 잠열이 에너지원' },
  { key: 'grow', title: '발달기', lat: 17, lon: 132, speedKmh: 23, power: 0.44, height: 0.52, note: '무역풍을 타고 서~서북서 20~25km/h' },
  { key: 'peak', title: '최성기 · 전향', lat: 24, lon: 127, speedKmh: 5, power: 0.62, height: 0.86, note: '북위 20~30°에서 전향한다 — 여기서 약 하루 정체한다' },
  { key: 'accel', title: '전향 후 급가속', lat: 31, lon: 134, speedKmh: 38, power: 0.5, height: 0.66, note: '편서풍을 타고 북~북동 35~40km/h — 느리게 오다가 갑자기 빨라진다' },
  { key: 'et', title: '쇠퇴 · 온대저기압으로 변질', lat: 38, lon: 145, speedKmh: 55, power: 0.3, height: 0.34, note: '수증기 공급이 끊긴다 — 사라지는 것이 아니라 성질이 바뀐다(ET). 수명은 평균 5일(길게 10~15일).' },
]);

// ── 색 — 보드 팔레트 ────────────────────────────────────────────────────────
const LAND = '#a3b98c'; // 육지(보드 잔디 #c6dbb0보다 한 톤 진하게 — 바다 위에서 읽히게)
const TRACK = '#64748b';
const WARM = '#ea580c'; // 열대 성질(태풍)
const PEAK = '#dc2626'; // 최성기
const COLD = '#2563eb'; // 온대저기압으로 변질된 뒤
const TXT = '#334155';
const TXT_DIM = '#475569';

const stageColor = (i) => (i === T2_STAGES.length - 1 ? COLD : i === 2 ? PEAK : WARM);
const posOf = (s) => [xOfLon(s.lon), zOfLat(s.lat)];

/** 육지 — 얇은 판을 바다 위에 얹는다. 해안선 대신 **덩어리의 배치**로 지도를 만든다 */
const island = (x0, x1, z0, z1) => vol({
  x0, x1, y0: 0.0, y1: 0.008, z0, z1, color: rgba(LAND, 0.98), pattern: 4, at: 0,
});

/**
 * 그 단계의 태풍 자신 — **구름 소용돌이 + 반시계 접선 화살표**.
 * 저기압성 접선은 `p × ŷ = (-pz, 0, px)`(T1과 같은 부호 규약).
 * ⚠️ `until`을 주는 것이 이 그림의 전부다 — 태풍은 **한 번에 한 자리에만** 있어야
 * 하므로 다음 단계로 넘어가면 사라져야 한다.
 */
function storm(stage, i) {
  const [cx, cz] = posOf(stage);
  const r = 0.05 + stage.power * 0.08;
  const color = stageColor(i);
  const cloud = i === 2
    // 최성기만 적란운 타워 — 「키가 가장 높다」를 구름으로도 말한다
    ? cbTower({ x: cx, z: cz, top: H(0.34 + stage.height * 0.5), at: i }).map((b) => ({ ...b, until: i }))
    : [0, 1, 2, 3].map((k) => {
      const a = (k / 4) * TAU + 0.4;
      return puff({
        x: cx + Math.cos(a) * r, y: H(0.06 + stage.power * 0.1), z: cz + Math.sin(a) * r * 0.9,
        s: 0.6 + stage.power * 0.7,
        color: rgba(i === 4 ? '#cbd5e1' : '#e2e8f0', 0.92), at: i, until: i,
      });
    });
  const spin = [0, 1, 2, 3].flatMap((k) => {
    const a = (k / 4) * TAU;
    const p = [Math.cos(a), 0, Math.sin(a)];
    return flow({
      from: [cx + p[0] * r, H(0.02), cz + p[2] * r],
      dir: [-p[2], 0, p[0]], // p × ŷ — 반시계(북반구 저기압성)
      travel: 0.05 + stage.power * 0.05, count: 1,
      scale: 0.026 + stage.power * 0.03, color: rgba(color, 0.95), speed: 0.7, at: i, until: i,
    }).map((arw) => ({ ...arw, storm: stage.key, spin: 1 }));
  });
  return [...cloud, ...spin];
}

/** 세력의 키 — 수직 화살표. 최성기에 가장 높고 ET에서 낮아진다 */
function powerColumn(stage, i) {
  const [cx, cz] = posOf(stage);
  return flow({
    from: [cx, H(0.03), cz], dir: [0, 1, 0], travel: stage.height * 0.3, count: 1,
    scale: 0.028 + stage.power * 0.036, color: rgba(stageColor(i), 0.95), speed: 0.42, at: i, until: i,
  }).map((a) => ({ ...a, column: stage.key, height: stage.height }));
}

/** 이동 화살표 — **왕복 거리가 곧 속도**다. 정체는 거의 움직이지 않는다 */
function motionArrow(stage, i) {
  const next = T2_STAGES[Math.min(i + 1, T2_STAGES.length - 1)];
  const [cx, cz] = posOf(stage);
  const [nx, nz] = posOf(next);
  const dir = i === T2_STAGES.length - 1 ? [0.5, 0, 1] : [nx - cx, 0, nz - cz];
  return flow({
    from: [cx, H(0.015), cz], dir, travel: speedLen(stage.speedKmh), count: 1,
    scale: 0.05, color: rgba(TXT, 0.92), speed: 0.5, at: i, until: i,
  }).map((a) => ({ ...a, motion: stage.key, speedKmh: stage.speedKmh, travelLen: speedLen(stage.speedKmh) }));
}

/** 지나온 경로 — **누적**(at만 주고 until을 안 준다). 자국이 남아야 「생애」다 */
function trackDots(i) {
  const [ax, az] = posOf(T2_STAGES[i]);
  const [bx, bz] = posOf(T2_STAGES[i + 1]);
  return [0.2, 0.35, 0.5, 0.65, 0.8].map((u) => {
    const x = ax + (bx - ax) * u;
    const z = az + (bz - az) * u;
    return {
      ...vol({
        x0: x - 0.008, x1: x + 0.008, y0: 0.008, y1: 0.012,
        z0: z - 0.006, z1: z + 0.006, color: rgba(TRACK, 0.85), at: i + 1,
      }),
      track: true,
    };
  });
}

/** 단계 목록 — `note`가 **캔버스 밖 캡션**의 소유자다 */
export const T2_STEPS = Object.freeze(T2_STAGES.map((s) => ({ key: s.key, title: s.title, note: s.note })));

export const TYPHOON_LIFECYCLE_SCENE = composeScene({
  night: false,
  sea: { from: 0, to: 1 }, // 바닥 전체가 북서태평양 — 그 위에 육지를 얹는다
  items: [
    // ── 무대: 지도 ──────────────────────────────────────────────────────────
    // 🔴 종전에 **없던 것이 바로 이것**이다. 위도선만 있고 육지가 없으면
    //    「태풍이 어디로 가는가」가 좌표놀이가 된다.
    island(0, xOfLon(126), zOfLat(27), 0.42), // 아시아 대륙 북부
    island(0, xOfLon(122), zOfLat(12), zOfLat(27)), // 중국 남부~인도차이나
    island(xOfLon(126), xOfLon(129.5), zOfLat(34), zOfLat(38.5)), // 한반도
    island(xOfLon(129), xOfLon(132), zOfLat(31), zOfLat(34)), // 규슈
    island(xOfLon(131), xOfLon(141), zOfLat(33), zOfLat(37)), // 혼슈
    island(xOfLon(140), xOfLon(145), zOfLat(41), 0.42), // 홋카이도
    island(xOfLon(120), xOfLon(122), zOfLat(22), zOfLat(25)), // 대만
    island(xOfLon(120), xOfLon(124), zOfLat(10), zOfLat(18)), // 필리핀
    label({ x: xOfLon(127.5), y: H(0.02), z: zOfLat(36), text: '한반도', color: '#3f6212', at: 0, size: 9.5 }),
    // 전향대(북위 20~30°)를 글자로 못박는다 — 격자는 무대가 이미 그린다
    label({ x: 0.05, y: H(0.01), z: zOfLat(20), text: '북위 20°', color: TXT_DIM, at: 0, size: 9.5 }),
    label({ x: 0.05, y: H(0.01), z: zOfLat(30), text: '북위 30°', color: TXT_DIM, at: 0, size: 9.5 }),
    label({ x: 0.92, y: H(0.01), z: zOfLat(13), text: '무역풍대', color: TXT_DIM, at: 1, size: 9.5 }),
    label({ x: 0.9, y: H(0.01), z: zOfLat(35), text: '편서풍대', color: TXT_DIM, at: 3, size: 9.5 }),

    // ── 경로: 지나온 자리는 남는다(누적) ────────────────────────────────────
    ...T2_STAGES.slice(0, -1).flatMap((_, i) => trackDots(i)),

    // ── 각 단계의 태풍 자신 — **그 단계에만**(at = until) ────────────────────
    // ⚠️ 캔버스 안 글자는 **단계 이름과 속도 둘뿐**이다. 설명 문장은 `note`로
    //    나가서 패널 캡션이 된다(보드가 긴 문장을 두는 자리와 같다).
    ...T2_STAGES.flatMap((s, i) => [
      ...storm(s, i),
      powerColumn(s, i)[0],
      motionArrow(s, i)[0],
      label({ x: posOf(s)[0], y: H(0.34 + s.height * 0.5), z: posOf(s)[1], text: s.title, color: stageColor(i), at: i, until: i, size: 11 }),
      label({ x: posOf(s)[0], y: H(0.02), z: posOf(s)[1] - 0.06, text: `${s.speedKmh}km/h`, color: TXT, at: i, until: i, size: 9.5 }),
    ]),
    // 최성기에만 비를 뿌린다 — 세력이 최대라는 것을 강수로도 말한다
    precip({ x0: xOfLon(127) - 0.07, x1: xOfLon(127) + 0.07, y1: H(0.5), z0: zOfLat(24) - 0.05, z1: zOfLat(24) + 0.05, slant: 0.16, speed: 1.5, count: 26, at: 2 }),

    // 🔴 전향점 — 이 그림의 주인공. 짧은 명사구로만 못박는다(문장은 캡션이 맡는다)
    label({ x: xOfLon(123), y: H(0.02), z: zOfLat(21), text: '전향', color: PEAK, at: 2, size: 11 }),
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
    // 전향 정체 → 급가속: 이동 거리가 그 순서를 그대로 담고 있어야 한다
    stallLen: motions.find((m) => m.motion === 'peak').travelLen,
    growLen: motions.find((m) => m.motion === 'grow').travelLen,
    accelLen: motions.find((m) => m.motion === 'accel').travelLen,
    recurveLat: T2_STAGES[2].lat,
    peakHeight: T2_STAGES[2].height,
    lastKey: T2_STAGES[T2_STAGES.length - 1].key,
    spins: [...new Set(rings.map((r) => r.spin))],
  };
}
