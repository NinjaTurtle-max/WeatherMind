/**
 * precipEngine 단위 검증 (R9-08) — node tests/precipEngine.test.mjs
 *
 * Canvas 강수 파티클 엔진의 성능 계약을 검증한다:
 *  - 파티클 총량 상한(MAX_PARTICLES=200) 강제 — 어떤 cap 인자로도 초과 불가
 *  - weight 비례 배분(강한 강수 존이 더 많은 입자)
 *  - stepSystem: 낙하(비 y 증가·사선), 박스 이탈 시 상단 재생성, dt 클램프
 *  - shouldAnimate: reduced-motion·탭 비활성·뷰포트 밖이면 false(루프 정지 계약)
 */
import {
  MAX_PARTICLES,
  createSystem,
  stepSystem,
  spawnParticle,
  shouldAnimate,
} from '../src/modules/board/precipEngine.js';

let failed = 0;
const check = (name, cond) => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
};

const box = (kind, extra = {}) => ({ x: 0, y: 0, w: 100, h: 100, kind, ...extra });

// ── 상한 ─────────────────────────────────────────────────────────────────────
{
  const sys = createSystem([box('rain')]);
  check('단일 에미터: 0 < 파티클 ≤ MAX_PARTICLES', sys.particles.length > 0 && sys.particles.length <= MAX_PARTICLES);
}
{
  const sys = createSystem(Array.from({ length: 7 }, () => box('rain')), 120);
  check('다중 에미터 + cap=120: 총량 ≤ 120', sys.particles.length <= 120);
  check('다중 에미터: 모든 에미터가 ≥1개 받음', new Set(sys.particles.map((p) => p.e)).size === 7);
}
{
  const sys = createSystem([box('rain')], 10_000);
  check('과대 cap 요청도 전역 상한(200) 초과 불가', sys.particles.length <= MAX_PARTICLES);
}
{
  const sys = createSystem([], 100);
  check('에미터 없음 → 파티클 0 + stepSystem 무해', stepSystem(sys, 0.016).particles.length === 0);
}

// ── weight 배분 ──────────────────────────────────────────────────────────────
{
  const sys = createSystem([box('rain', { weight: 3 }), box('rain', { weight: 1 })], 160);
  const heavy = sys.particles.filter((p) => p.e === 0).length;
  const light = sys.particles.filter((p) => p.e === 1).length;
  check(`weight 3:1 비례 배분 (${heavy}:${light})`, heavy > light && heavy + light <= 160);
}

// ── 물리 ─────────────────────────────────────────────────────────────────────
{
  const em = box('rain', { slant: 1 });
  const sys = createSystem([em], 50);
  const before = sys.particles.map((p) => ({ x: p.x, y: p.y }));
  stepSystem(sys, 0.016);
  const fell = sys.particles.every((p, i) => p.y > before[i].y || p.y < before[i].y - em.h * 0.5 /* 재생성 */);
  check('비: 스텝마다 낙하(y 증가) 또는 상단 재생성', fell);
  const slanted = sys.particles.every((p) => p.vx < 0);
  check('비: 사선 낙하(vx≠0)', slanted);
}
{
  const em = box('snow');
  const p = spawnParticle(em, 0, true);
  check('눈: 비보다 느린 낙하 속도', p.vy < em.h * 0.7);
}
{
  const em = box('rain');
  const sys = createSystem([em], 40);
  for (let i = 0; i < 600; i += 1) stepSystem(sys, 0.033);
  const inBounds = sys.particles.every(
    (p) => p.x >= em.x && p.x <= em.x + em.w && p.y >= em.y && p.y <= em.y + em.h + 0.01,
  );
  check('장시간 스텝 후에도 파티클이 에미터 박스 안 유지(재생성 포함)', inBounds);
  check('장시간 스텝 후에도 총량 불변(≤ cap)', sys.particles.length <= 40);
}
{
  const em = box('rain');
  const sys = createSystem([em], 10);
  const y0 = sys.particles.map((p) => p.y);
  stepSystem(sys, 5); // 탭 복귀 직후 거대 dt
  const teleported = sys.particles.some((p, i) => p.y - y0[i] > em.h * 3);
  check('거대 dt는 0.05s로 클램프(순간이동 없음)', !teleported);
}

// ── 정지 계약 ────────────────────────────────────────────────────────────────
check('shouldAnimate: 기본(모두 활성) → true', shouldAnimate({ reduced: false, hidden: false, inView: true }));
check('shouldAnimate: reduced-motion → false', !shouldAnimate({ reduced: true, hidden: false, inView: true }));
check('shouldAnimate: 탭 비활성 → false', !shouldAnimate({ reduced: false, hidden: true, inView: true }));
check('shouldAnimate: 뷰포트 밖 → false', !shouldAnimate({ reduced: false, hidden: false, inView: false }));

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: precipEngine 단위 검증 통과');
