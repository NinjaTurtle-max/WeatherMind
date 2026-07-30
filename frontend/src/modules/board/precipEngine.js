/**
 * precipEngine — Canvas 강수 파티클 순수 엔진 (R9-08 §A).
 *
 * DOM/Canvas 의존 없는 순수 모듈: 파티클 생성·이동·상한만 담당한다.
 * 렌더(캔버스 그리기)와 생명주기(rAF·visibilitychange·IntersectionObserver)는
 * realisticEffects.jsx의 PrecipCanvas가 소유한다 — 이 분리로 상한·정지 로직을
 * node에서 단위 검증한다(tests/precipEngine.test.mjs).
 *
 * 계약(R9-08 성능 제약):
 *  - 전체 파티클 수 상한 MAX_PARTICLES=200 (모바일 고려) — createSystem이 강제.
 *  - shouldAnimate: reduced-motion·탭 비활성(hidden)·뷰포트 밖(inView=false)이면
 *    false — 호출측은 false면 rAF 루프를 돌리지 않는다.
 *  - 좌표는 캔버스 px. 에미터 박스 밖으로 떨어진 파티클은 박스 상단에서 재생성.
 */

export const MAX_PARTICLES = 200;

/** 애니메이션 루프를 돌려도 되는 상태인지 — 하나라도 아니면 정지 */
export function shouldAnimate({ reduced = false, hidden = false, inView = true } = {}) {
  return !reduced && !hidden && inView;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * 에미터 하나에서 파티클 1개 생성.
 * @param em {x, y, w, h, kind: 'rain'|'snow', slant?} px 박스
 * @param anywhere true면 박스 안 임의 높이(초기 채움), false면 상단(재생성)
 */
export function spawnParticle(em, emitterIndex, anywhere = false) {
  const snow = em.kind === 'snow';
  const slant = Number.isFinite(em.slant) ? em.slant : 1;
  return {
    e: emitterIndex,
    kind: em.kind,
    x: rand(em.x, em.x + em.w),
    y: anywhere ? rand(em.y, em.y + em.h) : em.y + rand(0, em.h * 0.1),
    // 속도(px/s) — 비는 빠른 사선, 눈은 느리게 흔들리며 낙하
    vy: snow ? rand(0.35, 0.6) * em.h : rand(1.6, 2.6) * em.h,
    vx: snow ? rand(-4, 4) : -rand(0.28, 0.42) * em.h * slant,
    len: snow ? rand(1, 1.8) : rand(0.09, 0.16) * em.h,
    phase: rand(0, Math.PI * 2), // 눈송이 좌우 흔들림 위상
    sway: snow ? rand(6, 14) : 0,
  };
}

/**
 * 에미터 배열로 파티클 시스템 생성. 총 파티클 수 ≤ cap 강제.
 * 에미터별 개수는 weight(기본 1) 비례 배분 — 강한 강수 존이 더 많은 입자를 받는다.
 * @returns {emitters, particles, cap}
 */
export function createSystem(emitters, cap = MAX_PARTICLES) {
  const list = (emitters ?? []).filter((e) => e && e.w > 0 && e.h > 0);
  const capped = Math.max(0, Math.min(cap, MAX_PARTICLES)); // 어떤 호출도 전역 상한 초과 불가
  const sys = { emitters: list, particles: [], cap: capped };
  if (list.length === 0 || capped === 0) return sys;

  const totalWeight = list.reduce((s, e) => s + (Number.isFinite(e.weight) ? Math.max(e.weight, 0.1) : 1), 0);
  list.forEach((em, ei) => {
    const w = Number.isFinite(em.weight) ? Math.max(em.weight, 0.1) : 1;
    const n = Math.max(1, Math.floor((capped * w) / totalWeight));
    for (let i = 0; i < n && sys.particles.length < capped; i += 1) {
      sys.particles.push(spawnParticle(em, ei, true));
    }
  });
  return sys;
}

/**
 * 시스템 한 스텝 전진(제자리 갱신). dt는 초 단위, 0.05s로 클램프 —
 * 프레임 드랍(30fps 하한)이나 탭 복귀 직후 큰 dt로 파티클이 순간이동하지 않게.
 */
export function stepSystem(sys, dt) {
  const step = Math.max(0, Math.min(Number(dt) || 0, 0.05));
  for (const p of sys.particles) {
    const em = sys.emitters[p.e];
    if (!em) continue;
    p.y += p.vy * step;
    if (p.kind === 'snow') {
      p.phase += step * 2.2;
      p.x += (p.vx + Math.sin(p.phase) * p.sway) * step;
    } else {
      p.x += p.vx * step;
    }
    // 박스 이탈 — 바닥이면 상단 재생성, 좌우면 감싸기
    if (p.y > em.y + em.h) {
      Object.assign(p, spawnParticle(em, p.e, false));
    } else if (p.x < em.x) {
      p.x = em.x + em.w - 0.01;
    } else if (p.x > em.x + em.w) {
      p.x = em.x + 0.01;
    }
  }
  return sys;
}
