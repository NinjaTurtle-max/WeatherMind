import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { cloudAt, trackAt, trackPolyline } from './satelliteField';
// 해안선 — 지형 좌표의 단일 소유자는 board/PeninsulaMap이다(사본 금지, MT-21)
// 해안선 — Natural Earth 1:50m 실측(퍼블릭 도메인). 손으로 그린 실루엣을 두 번
// 실패한 뒤의 결론이다(coastline.js 머리 주석). 보드 좌표 소유권은 그대로다.
import { COASTLINES, GEO_W, GEO_H } from './coastline';

/**
 * SatelliteView (MT-21 개정) — **위성 영상처럼 보이는** 구름 도식.
 *
 * 초판은 동심원 3겹이었고 클라이언트가 *"실질 위성 같은 연출"*을 요구해 다시 만들었다.
 * 원을 겹치면 도해(diagram)가 되지 위성이 되지 않는다. 실제 위성(천리안·히마와리 IR)의
 * 인상은 ⑴ 잘게 찢어진 난류 질감 ⑵ 중심으로 감기는 나선 밴드 ⑶ 해안선·격자·색 램프라는
 * **관측 산출물 크롬**에서 온다. 앞의 둘은 `satelliteField.cloudAt`이 극좌표에서
 * 노이즈를 뒤틀어 만들고, 셋째를 여기서 얹는다.
 *
 * SVG가 아니라 캔버스인 이유: 픽셀마다 값을 계산하는 절차적 장면이라 path로는 못 그린다.
 *
 * ⚠️ **「실사 아님」 표기는 계약**이다(초판부터 유지). 원 F3는 KMA 실사 영상이라
 * 저작권·프록시 때문에 대회 전 불가였고, 도식으로 바꾼 것이 착수를 가능하게 만든
 * 경계다. **사실적으로 보일수록 그 표기의 무게가 커진다** — 위성처럼 보이는 그림에
 * 그 줄이 없으면 그 자체가 허위 표시다. 산출물 라벨에 실제 기관·위성 이름을 쓰지
 * 않는 것도 같은 이유다(출처 사칭이 된다).
 */

// 논리 해상도. 실제 버퍼는 이보다 작게 그려 확대한다 — 위성 영상 특유의 부드러운
// 번짐이 그 확대에서 나오고, 픽셀 루프 비용도 1/4로 준다.
const VIEW_W = 720;
const VIEW_H = 450;   // = GEO_W:GEO_H(100:62.5)와 같은 비율 — 어긋나면 해안선이 늘어난다

// **폭풍은 스프라이트로 한 번만 계산해 캐시한다.**
// 종전에는 매 프레임 화면 전체를 다시 계산해서, 8fps를 지키려면 버퍼를 240×150까지
// 줄여야 했다 — 그게 곧 "질감·해상도가 낮다"의 원인이었다(실측: 480×300은 148ms,
// 8fps 예산 125ms를 넘긴다). 폭풍 내부 구조는 **세력이 같으면 같으므로** 세력을
// 구간으로 묶어 스프라이트를 재사용하면, 매 프레임 비용이 drawImage 한 번으로 준다.
// 그 대가로 해상도를 4배 넘게 올릴 수 있다.
const SPRITE = 360;         // 폭풍 국소 좌표 해상도(반경 1 = SPRITE/2 px)
const INTENSITY_STEP = 25;  // → 세력 구간 4개 = 캐시 4장

// ⚠️ **회전 프레임을 스프라이트로 굽지 않는다.**
// 처음에 세력 4구간 × 회전 10프레임 = 40장을 미리 구웠는데, 예열이 **27초**였고
// 그전 80장 판에서는 렌더러가 아예 얼었다. 이유는 단순하다 — 회전 한 프레임마다
// 22만 픽셀을 다시 계산하는 것은 낭비다. **회전은 픽셀이 아니라 변환**이다.
//
// 대신 스프라이트는 세력별 4장만 굽고(예열 ~0.6초), 화면에 얹을 때 canvas를
// 돌린다. 차등 회전(안쪽이 빠름)은 스프라이트를 **두 겹**으로 나눠 서로 다른
// 속도로 돌려서 낸다 — 안쪽 코어와 바깥 나선이 다른 속도로 도는 것이 눈에 보이는
// 차등의 거의 전부다.
const CORE_CUT = 0.42;      // 코어/외곽을 가르는 정규 반경
// 프레임당 회전량(회전수). 외곽이 2.5초에 한 바퀴, 코어는 2.6배 빠르다.
// 프레임당 회전량(회전수) — **세기에 비례한다.**
// 색을 뺀 대신 세기를 읽는 축이 크기와 속도 둘뿐이므로, 속도가 실제로 변해야 한다.
// 종전에는 고정값이라 "약한 태풍도 똑같이 빨리 돈다"는 모순이 있었다.
// 실제로도 중심 최대풍속이 세기의 정의다 — 세기가 곧 회전 속도다.
const SPIN_MIN = 1 / 40;   // 갓 발생 — 느릿하게 돈다
const SPIN_MAX = 1 / 10;   // 최성기 — 눈에 띄게 빠르다

// 태풍 중심(뷰 좌표 0~1) · 반경(뷰 폭 대비). 한반도 남서 해상 — 실제 접근 구도.
const EYE = { x: 0.38, y: 0.62, r: 0.42 };

/**
 * 가시광 회색조 램프 — **색을 쓰지 않는다** (2026-08-12 클라이언트 결정).
 *
 * 강조 IR(초록·노랑·빨강·자홍)을 넣었다가 뺐다. 실제 위성 루프를 보면 태풍은
 * **압도적으로 흰색**이고, 예보 현장의 무지개 강조색은 판독 훈련을 받은 사람을 위한
 * 것이다. 학습자에게는 그 색이 정보가 아니라 **소음**으로 읽힌다 — 화면이 "밤티"처럼
 * 튄다는 지적이 정확했다.
 *
 * 그래서 세기를 읽는 축을 **크기와 회전 속도** 둘로 좁혔다. 축이 적을수록 무엇이
 * 무엇을 뜻하는지 분명해진다: 슬라이더를 올리면 **커지고 빨라진다**, 그게 전부다.
 * 색까지 같이 변하면 학습자가 셋 중 무엇을 봐야 할지 모른다.
 */
const IR_RAMP = [
  [0.00, [6, 14, 28]],     // 바다 — 거의 검다
  [0.25, [52, 70, 96]],    // 얇은 하층운
  [0.50, [150, 168, 192]], // 중층운
  [0.75, [222, 230, 240]], // 두꺼운 구름
  [1.00, [255, 255, 255]], // 가장 높고 찬 꼭대기 — 순백
];

function irColor(v, out, i) {
  const t = Math.max(0, Math.min(1, v));
  let a = IR_RAMP[0];
  let b = IR_RAMP[IR_RAMP.length - 1];
  for (let k = 0; k < IR_RAMP.length - 1; k += 1) {
    if (t >= IR_RAMP[k][0] && t <= IR_RAMP[k + 1][0]) {
      a = IR_RAMP[k];
      b = IR_RAMP[k + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const f = (t - a[0]) / span;
  out[i] = a[1][0] + (b[1][0] - a[1][0]) * f;
  out[i + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
  out[i + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
  out[i + 3] = 255;
}

/** 램프를 CSS 그라디언트로 — 범례가 실제 색과 어긋나면 안 되므로 같은 배열에서 만든다 */
const RAMP_CSS = `linear-gradient(90deg, ${IR_RAMP
  .map(([stop, [r, g, b]]) => `rgb(${r},${g},${b}) ${(stop * 100).toFixed(0)}%`)
  .join(', ')})`;

// 육지 — 해안선만 선으로 두면 바다와 구분이 안 된다(실영상은 육지가 면으로 보인다)
const LAND_FILL = 'rgba(28, 52, 40, 0.92)';
const COAST = 'rgba(120, 245, 180, 0.75)';

/**
 * 세력·시어 한 조합의 폭풍 스프라이트. 같은 키는 다시 계산하지 않는다.
 * 캐시는 모듈 수준이라 슬라이더를 앞뒤로 움직여도 한 번 만든 것을 계속 쓴다.
 */
const spriteCache = new Map();

const quantize = (intensity) =>
  Math.min(100, Math.max(0, Math.round(intensity / INTENSITY_STEP) * INTENSITY_STEP));

const spriteKey = (q, shear, part) => `${q}|${shear}|${part}`;

/**
 * 스프라이트 1장. `part`가 'core'면 안쪽만, 'outer'면 바깥만 담는다(경계는 부드럽게
 * 겹쳐서 이음매가 안 보이게 한다). 둘을 다른 속도로 돌리면 차등 회전이 된다.
 */
function buildSprite(q, shear, part) {
  const cv = document.createElement('canvas');
  cv.width = SPRITE;
  cv.height = SPRITE;
  const c = cv.getContext('2d');
  const img = c.createImageData(SPRITE, SPRITE);
  const px = img.data;
  const half = SPRITE / 2;
  for (let y = 0; y < SPRITE; y += 1) {
    for (let x = 0; x < SPRITE; x += 1) {
      const nx = ((x - half) / half) * 1.6;
      const ny = ((y - half) / half) * 1.6;
      const r = Math.hypot(nx, ny);
      const v = cloudAt(nx, ny, { intensity: q, shear, seed: 1, spin: 0 });
      // 겹치는 띠(±0.12)에서 부드럽게 갈라 이음매를 숨긴다
      const t = Math.max(0, Math.min(1, (r - (CORE_CUT - 0.12)) / 0.24));
      const w = part === 'core' ? 1 - t : t;
      const i = (y * SPRITE + x) * 4;
      irColor(v, px, i);
      px[i + 3] = Math.round(Math.min(1, v * 2.4) * w * 255);
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/**
 * 예열 (A안) — 필요한 스프라이트를 미리 만든다.
 *
 * 왜 예열인가: 회전을 담으려면 세력 5구간 × 16프레임 = 80장이 필요하고, 재생 중에
 * 만들면 프레임마다 ~35ms씩 메인 스레드를 막아 **회전이 끊긴다**(실제로 한 번
 * 페이지가 멎었다). 미리 만들면 이후 매 프레임 비용이 drawImage 하나다.
 *
 * 한 장씩 나눠 만들고 사이에 제어권을 넘긴다 — 한 번에 다 만들면 그 3초 동안
 * 페이지가 얼어 진행 표시조차 안 돈다.
 */
function warmSprites(shear, onProgress, signal) {
  const jobs = [];
  for (let q = INTENSITY_STEP; q <= 100; q += INTENSITY_STEP) {
    for (const part of ['core', 'outer']) {
      if (!spriteCache.has(spriteKey(q, shear, part))) jobs.push([q, part]);
    }
  }
  const total = jobs.length;
  if (total === 0) {
    onProgress(1);
    return;
  }
  let done = 0;
  const BUDGET_MS = 10;
  const step = () => {
    if (signal.cancelled) return;
    const t0 = performance.now();
    while (jobs.length && performance.now() - t0 < BUDGET_MS) {
      const [q, part] = jobs.shift();
      spriteCache.set(spriteKey(q, shear, part), buildSprite(q, shear, part));
      done += 1;
    }
    onProgress(done / total);
    if (jobs.length) window.setTimeout(step, 0);
  };
  step();
}

/** 캐시 조회 — {core, outer} 두 겹. 없으면 즉석 생성(예열 전 첫 프레임 대비). */
function stormSprites(intensity, shear) {
  const q = quantize(intensity);
  if (q <= 0) return null;
  const get = (part) => {
    const key = spriteKey(q, shear, part);
    let sp = spriteCache.get(key);
    if (!sp) {
      sp = buildSprite(q, shear, part);
      spriteCache.set(key, sp);
    }
    return sp;
  };
  return { core: get('core'), outer: get('outer') };
}

// 재생 한 바퀴(초). 위성 루프처럼 **띄엄띄엄** 넘긴다 — 실제 위성도 10분 간격
// 정지영상을 이어 붙인 것이라, 매끄러운 60fps보다 이쪽이 오히려 사실적이다.
const LOOP_SEC = 14;
const FPS = 6;

export default function SatelliteView({ intensity, shear }) {
  const t = useT();
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState(0.42); // 최성기에서 시작 — 첫 화면이 가장 볼 만하다
  const [playing, setPlaying] = useState(true);
  const [spin, setSpin] = useState(0);       // 회전 위상(회전수)
  // phase를 인터벌 안에서 읽되 **의존성에 넣지 않는다** — 넣으면 매 프레임
  // 인터벌이 헐리고 다시 서서 재생이 끊긴다.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [warm, setWarm] = useState(0);       // 예열 진행 0~1
  const active = intensity > 0;
  const ready = warm >= 1;

  // ── 예열 (A안) — 시어가 바뀌면 그 시어의 스프라이트를 다시 채운다 ──
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const signal = { cancelled: false };
    setWarm(0);
    warmSprites(shear, (p) => { if (!signal.cancelled) setWarm(p); }, signal);
    return () => { signal.cancelled = true; };
  }, [shear]);

  // ── 재생 루프 (MT-21 개정 ②) ──
  // reduced-motion이면 재생하지 않는다. 그래도 **슬라이더로 직접 넘길 수 있어**
  // 이동·쇠퇴라는 학습 내용 자체는 잃지 않는다(모션을 끄는 것과 정보를 뺏는 것은 다르다).
  useEffect(() => {
    if (typeof window === 'undefined' || !playing || !active || !ready) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce) return undefined;
    const id = window.setInterval(() => {
      // 회전과 이동은 **시간 척도가 다르다**. 실제로 태풍은 며칠에 걸쳐 이동하는
      // 동안 수백 바퀴를 돈다. 같은 속도로 묶으면 둘 중 하나가 반드시 어색해진다.
      // 지금 세력에 맞는 회전 속도. phase가 곧 생애 단계라 여기서 다시 잰다.
      const life = trackAt(phaseRef.current).life;
      const rate = SPIN_MIN + (SPIN_MAX - SPIN_MIN) * life;
      setSpin((v) => (v + rate) % 1);
      setPhase((v) => (v + 1 / (LOOP_SEC * FPS)) % 1);    // 생애 한 번 = LOOP_SEC
    }, 1000 / FPS);
    return () => window.clearInterval(id);
  }, [playing, active, ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = VIEW_W * dpr;
    canvas.height = VIEW_H * dpr;

    // 지금 시점의 위치·세력. `life`가 곧 **북상하며 약해지는 것**이다.
    const pos = trackAt(phase);
    const nowIntensity = intensity * pos.life;
    // 세력이 줄면 보이는 크기도 준다 — 위치만 옮기고 크기가 그대로면 "이동했다"만
    // 보이고 "약해졌다"가 안 보인다. 축소가 이 항목의 절반이다.
    // 실제 규모에 맞춘다: 화면 창이 경도 36°(≈3,000km)라, 강한 태풍의 구름 방패
    // 반경 400~500km는 화면 폭의 13~17%다. 종전 값(최대 40%)은 태풍이 한반도를
    // 통째로 덮어 규모감이 무너졌다.
    const radius = (0.05 + 0.12 * pos.life) * VIEW_W;

    ctx.save();
    ctx.scale(dpr, dpr);

    // ── ① 바다 ──
    ctx.fillStyle = '#040a14';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // ── ② 육지 — 구름보다 **먼저** 깔아야 구름이 육지 위를 덮는다 ──
    // 지형 좌표(GEO_W × GEO_H)를 화면 폭에 맞춘다. 경위도 창이 곧 화면 창이라
    // 태풍 위치·크기가 실제 축척과 맞는다(손그림 시절엔 이 대응이 없었다).
    if (typeof Path2D === 'function') {
      const gs = VIEW_W / GEO_W;
      ctx.save();
      ctx.scale(gs, gs);
      ctx.lineWidth = 0.7 / gs;
      for (const d of COASTLINES) {
        const p2 = new Path2D(d);
        ctx.fillStyle = LAND_FILL;
        ctx.fill(p2);
        ctx.strokeStyle = COAST;
        ctx.stroke(p2);
      }
      ctx.restore();
    }

    // ── ③ 구름 — 캐시된 스프라이트를 위치·크기만 바꿔 얹는다 ──
    // 투명도를 가진 스프라이트라 육지가 그대로 비친다(lighter 합성이 아니다).
    if (nowIntensity > 0.5) {
      const sp = stormSprites(nowIntensity, shear);
      const d = radius * 2 * 1.6; // 스프라이트가 반경 1.6까지 담고 있다
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const cxp = pos.x * VIEW_W;
      const cyp = pos.y * VIEW_H;
      // 북반구는 반시계 — 각도 부호가 음수. 코어가 외곽보다 **2.6배 빠르다**.
      const layer = (canvasImg, turns) => {
        ctx.save();
        ctx.translate(cxp, cyp);
        ctx.rotate(-turns * 2 * Math.PI);
        ctx.drawImage(canvasImg, -d / 2, -d / 2, d, d);
        ctx.restore();
      };
      layer(sp.outer, spin);
      layer(sp.core, spin * 2.6);
    }

    // ── ④ 이동 경로 — 지나온 길 실선, 앞길 점선(태풍 경로도의 관례) ──
    const poly = trackPolyline(48);
    const seg = (from, to, style, dash) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1.2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      poly.slice(from, to + 1).forEach((q, i) => {
        const X = q.x * VIEW_W;
        const Y = q.y * VIEW_H;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const cut = Math.round(phase * 48);
    seg(0, cut, 'rgba(255,255,255,0.5)', []);
    seg(cut, 48, 'rgba(255,255,255,0.2)', [3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(pos.x * VIEW_W, pos.y * VIEW_H, 5, 0, Math.PI * 2);
    ctx.stroke();

    // ── ⑤ 위경도 격자 ──
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.12)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    for (let i = 1; i < 8; i += 1) {
      const gx = (VIEW_W / 8) * i;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, VIEW_H);
    }
    for (let i = 1; i < 5; i += 1) {
      const gy = (VIEW_H / 5) * i;
      ctx.moveTo(0, gy);
      ctx.lineTo(VIEW_W, gy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }, [intensity, shear, phase, spin, warm]);

  const hasEye = active && shear === 'weak' && intensity >= 40;
  const readKey = active
    ? hasEye
      ? 'explore.satellite.readEye'
      : shear === 'weak'
        ? 'explore.satellite.readGrowing'
        : 'explore.satellite.readSheared'
    : 'explore.satellite.readNone';
  const ariaKey = active
    ? hasEye
      ? 'explore.satellite.ariaEye'
      : 'explore.satellite.ariaSheared'
    : 'explore.satellite.ariaNone';

  return (
    // ⚠️ **자기 여백(`mt-4`)을 갖지 않는다**(2026-08-19). 이 도식이 2열 격자의
    // 한 칸이 되면서, 자기 마진이 있으면 옆 칸(「왜 그럴까」)보다 16px 내려앉는다.
    // 세로로 쌓이던 시절에도 부모의 `space-y-4`가 같은 16px을 이미 주고 있어
    // 실제로는 중복이었다 — 값이 같아 눈에 안 띄었을 뿐이다.
    <figure className="overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-slate-700">
      {/* 산출물 머리 — 실제 위성 영상의 라벨 띠를 흉내 내되 **우리 이름**을 쓴다 */}
      <figcaption className="flex items-baseline justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <span className="font-mono text-[10px] font-bold tracking-wider text-slate-300">
          {t('explore.satellite.productLine')}
        </span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/40">
          {t('explore.satellite.schematicBadge')}
        </span>
      </figcaption>

      <div className="relative">
        <canvas
          ref={canvasRef}
          data-sat-canvas={shear}
          role="img"
          aria-label={t(ariaKey)}
          className="block w-full"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        />
        {/* 예열 표시 — 3초쯤 걸린다. 진행률을 보여야 "멈춘 것"으로 안 읽힌다. */}
        {active && !ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/75">
            <p className="font-mono text-[11px] font-bold text-slate-300">
              {t('explore.satellite.warming')}
            </p>
            <div className="h-1 w-40 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full bg-sky-400 transition-[width] duration-150"
                   style={{ width: `${Math.round(warm * 100)}%` }} />
            </div>
          </div>
        )}
        {/* 미발생 안내 — 캔버스가 거의 검을 때 "고장"으로 읽히지 않게 한다 */}
        {!active && (
          <p className="absolute inset-x-0 bottom-3 text-center text-[11px] font-bold text-slate-400">
            {t('explore.satellite.noSystem')}
          </p>
        )}
      </div>

      {/* 시간 축 (MT-21 개정 ②) — 재생 + 직접 넘기기.
          reduced-motion이면 자동 재생은 멈추지만 슬라이더는 살아 있다:
          모션을 끄는 것과 학습 내용을 빼앗는 것은 다르다. */}
      <div className="flex items-center gap-2 border-t border-slate-800 px-3 py-2">
        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          aria-label={t(playing ? 'explore.satellite.pause' : 'explore.satellite.play')}
          className="rounded-md px-2 py-1 font-mono text-[11px] font-bold text-slate-200 ring-1 ring-slate-600 hover:bg-slate-800"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min="0" max="1" step="0.01"
          value={phase}
          onChange={(e) => { setPlaying(false); setPhase(Number(e.target.value)); }}
          aria-label={t('explore.satellite.timeAria')}
          className="h-1 flex-1 cursor-pointer accent-sky-400"
        />
        <span className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-400">
          {t('explore.satellite.stage', { pct: Math.round(trackAt(phase).life * 100) })}
        </span>
      </div>

      {/* 색 램프 — 색이 무엇을 뜻하는지 없으면 그냥 예쁜 그림이다 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="font-mono text-[9.5px] text-slate-500">{t('explore.satellite.rampLow')}</span>
        <div
          className="h-1.5 flex-1 rounded-full"
          style={{ background: RAMP_CSS }}
        />
        <span className="font-mono text-[9.5px] text-slate-200">{t('explore.satellite.rampHigh')}</span>
      </div>

      <p className="border-t border-slate-800 px-3 py-2.5 text-[11px] leading-relaxed text-slate-300">
        {t(readKey)}
      </p>
    </figure>
  );
}
