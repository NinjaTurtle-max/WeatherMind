import { useEffect, useRef } from 'react';
import {
  BOB_AMP, botPose, createBotContext, createBotRenderer, loadBotMesh, lookTarget,
} from '../lib/guideBotMesh';

/**
 * GuideBot3D — 안내봇을 실제 WebGL로 그리는 오버레이 (MT-26).
 *
 * **이 컴포넌트는 그림을 「추가로」 얹을 뿐, 없어도 화면이 성립한다.** 아래 2D PNG는
 * 항상 깔려 있고 여기는 그 위에 투명 캔버스를 덮는다. 그래서 실패 경로가 전부
 * 「아무 일도 안 일어남」으로 수렴한다:
 *   · WebGL2 미지원 · 컨텍스트 생성 실패 · 셰이더 컴파일 실패 → `onFail()` → 언마운트
 *   · `.mesh` 404·잘림·매직 불일치                          → `onFail()`
 *   · 렌더 중 컨텍스트 소실(드라이버 리셋·탭 과다)          → `onFail()`
 * 심사위원 기기를 고를 수 없다는 것이 이 설계의 유일한 이유다.
 *
 * ── 「튀어나와 말하는 것 같은」 (2026-08-13 클라이언트 피드백) ────────────────
 * 처음 판은 **직교 투영 + 20초 1바퀴 자동 회전**이었다. 돌기는 하는데 평평하고,
 * 큰 회전은 뒤통수를 보여 줘서 「말하는 캐릭터」로 읽히지 않았다. 지금은 넷을 겹친다:
 *   ⓐ **원근 투영**(fov 34°) — 앞쪽 볼륨이 커져 화면 밖으로 나오는 인상 (guideBotMesh)
 *   ⓑ **상시 미세 모션** — 2.6초 주기 부유 + 7.3초 주기 약한 요잉. 큰 회전은 넣지
 *     않는다(멀미·주의 분산). 정지한 3D는 2D와 구별되지 않으므로 이게 최소선이다.
 *   ⓒ **커서 추종 틸트** ±12° — 「이쪽을 보고 있다」를 만든다. **드래그 중에는 끈다**:
 *     끌고 가는 손과 쳐다보는 고개가 같은 좌표를 놓고 싸우면 둘 다 이상해진다.
 *   ⓓ **말할 때 반응** — 말풍선 문구가 *바뀌는 순간* 0.42초 동안 살짝 앞으로
 *     커졌다 돌아오며 고개를 한 번 끄덕인다. 이것이 「말하는 것 같은」의 핵심이다.
 * 여기에 접지 그림자(캔버스가 아니라 CSS 타원)가 붙어 「떠 있다」가 생긴다.
 *
 * ⚠️ **`prefers-reduced-motion: reduce`면 ⓑⓒⓓ를 전부 끈다.** 정면 한 장을 그리고
 * rAF를 아예 돌지 않는다 — 접근성 요구이자 배터리 이득이고, 스모크가 이 분기를 문다.
 *
 * ── 지연 로딩 ────────────────────────────────────────────────────────────────
 * `.mesh`는 266KB다. 첫 페인트를 이것 때문에 늦추면 안 되므로 **부모가 이 모듈을
 * 동적 import**하고(= 별도 청크, 메인 번들 증가 ≈0), 여기서 다시 마운트 후에
 * fetch한다. 준비되기 전까지 사용자가 보는 것은 2D PNG다.
 *
 * ── SSR ─────────────────────────────────────────────────────────────────────
 * 모듈 최상위·첫 렌더에서 window·document·canvas를 만지지 않는다. 실제 접근은
 * 전부 `useEffect` 안이다(GuideBot·crossSection과 같은 규약).
 */

/** 자세 계산(주기·진폭·상한·반응 길이)의 소유자는 `lib/guideBotMesh.js`다 —
 *  브라우저 없이 테스트되어야 해서 순수 함수로 밖에 있다. */

/** 백버퍼 배율 상한 — 2를 넘으면 112px 캐릭터에 낭비다(모바일 배터리) */
const MAX_DPR = 2;

export default function GuideBot3D({ className = '', speakKey = '', dragging = false, onReady, onFail }) {
  const canvasRef = useRef(null);
  const shadowRef = useRef(null);
  // 콜백·프롭을 ref로 받는다 — 부모가 useCallback 없이 넘겨도 마운트가 1회로 유지된다
  // (crossSection이 eslint-disable로 풀던 문제를 여기서는 ref로 없앤다).
  const cbRef = useRef({ onReady, onFail });
  cbRef.current = { onReady, onFail };
  const dragRef = useRef(dragging);
  dragRef.current = dragging;
  const reactRef = useRef(0);
  const kickRef = useRef(null);

  // 말풍선 문구가 바뀌면 반응을 예약한다. 첫 마운트는 제외 — 화면에 들어오자마자
  // 놀란 듯 튀는 것은 「말한다」가 아니라 「깜빡인다」로 읽힌다.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    reactRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    kickRef.current?.(); // 멈춰 있었다면(탭 복귀 직후 등) 루프를 깨운다
  }, [speakKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined; // SSR 가드
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') {
      cbRef.current.onFail?.();
      return undefined;
    }

    let alive = true;
    let renderer = null;
    let raf = 0;
    let ro = null;
    let io = null;
    let inView = true;
    let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const fail = (err) => {
      if (err && typeof console !== 'undefined') console.warn('[guideBot3D]', String(err?.message ?? err));
      if (alive) cbRef.current.onFail?.();
    };

    const sizeToBox = () => {
      if (!renderer) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      renderer.resize(rect.width || canvas.clientWidth || 112, rect.height || canvas.clientHeight || 112, dpr);
    };

    // ── 커서 추종 ────────────────────────────────────────────────────────────
    // 좌표만 저장하고 각도는 프레임에서 계산한다(계산의 소유자는 lib의 lookTarget).
    let ptr = null;
    let box = null;
    let boxAt = 0;
    const onPointerMove = (e) => { ptr = { x: e.clientX, y: e.clientY }; };
    if (!reduced) window.addEventListener('pointermove', onPointerMove, { passive: true });

    let lookYaw = 0;
    let lookPitch = 0;

    let ready = false;
    const draw = (nowMs) => {
      if (!reduced && ptr && (!box || nowMs - boxAt > 250)) {
        // 캔버스 자리는 **프레임마다 읽지 않는다** — 매번 레이아웃을 강제로 다시
        // 계산시키기 때문이다. 0.25초에 한 번이면 드래그·스크롤을 충분히 따라잡는다.
        box = canvas.getBoundingClientRect();
        boxAt = nowMs;
      }
      const target = reduced ? { yaw: 0, pitch: 0 } : lookTarget(box, ptr, dragRef.current);
      // 지수 평활 — 커서가 튀어도 고개는 부드럽게 따라간다.
      lookYaw += (target.yaw - lookYaw) * 0.12;
      lookPitch += (target.pitch - lookPitch) * 0.12;

      const pose = botPose({
        tMs: nowMs - started,
        reduced,
        look: { yaw: lookYaw, pitch: lookPitch },
        reactAge: reactRef.current > 0 ? nowMs - reactRef.current : null,
      });
      renderer.render(pose);

      // 접지 그림자 — 캐릭터가 뜨면 작고 옅어진다(그래야 「떠 있다」가 읽힌다).
      const sh = shadowRef.current;
      if (sh) {
        const lift = pose.bobY / BOB_AMP; // -1(아래) ~ +1(위)
        sh.style.opacity = String(0.20 - lift * 0.05);
        sh.style.transform = `translateX(-50%) scaleX(${(1 - lift * 0.10).toFixed(3)})`;
      }

      if (!ready) {
        ready = true;
        // 첫 프레임이 **실제로 그려진 뒤에야** 부모에게 알린다 — 그 전에 PNG를
        // 지우면 한 프레임 동안 아무것도 없는 빈 원이 보인다.
        cbRef.current.onReady?.();
      }
    };

    const frame = (t) => {
      raf = 0;
      if (!alive || hidden || !inView) return;
      draw(t);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!alive || raf || hidden || !inView || !renderer) return;
      if (reduced) {
        // 정지 화면 — 한 장만 그리고 루프를 돌지 않는다.
        draw(started);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    kickRef.current = start;

    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      if (!hidden) start();
    };
    const onLost = (e) => {
      e.preventDefault();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      fail(new Error('WebGL 컨텍스트 소실'));
    };

    // **266KB를 받기 전에** 그릴 수 있는 기기인지부터 본다. 같은 캔버스에 같은
    // 타입으로 두 번 요청하면 브라우저는 **같은 컨텍스트를 돌려주므로**(getContext
    // 규약) 이 탐지는 공짜이고, 아래 렌더러 생성과 컨텍스트를 다투지 않는다.
    if (!createBotContext(canvas)) {
      window.removeEventListener('pointermove', onPointerMove);
      fail();
      return undefined;
    }

    loadBotMesh()
      .then((mesh) => {
        if (!alive) return;
        renderer = createBotRenderer(canvas, mesh);
        if (!renderer) {
          fail();
          return;
        }
        sizeToBox();
        canvas.addEventListener('webglcontextlost', onLost);
        document.addEventListener('visibilitychange', onVisibility);
        ro = typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => { sizeToBox(); box = null; start(); })
          : null;
        ro?.observe(canvas);
        io = typeof IntersectionObserver !== 'undefined'
          ? new IntersectionObserver((entries) => {
              inView = entries[0]?.isIntersecting ?? true;
              if (inView) start();
            })
          : null;
        io?.observe(canvas);
        start();
      })
      .catch(fail);

    return () => {
      alive = false;
      kickRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
      io?.disconnect();
      renderer?.dispose();
      renderer = null;
    };
  }, []);

  return (
    // 캐릭터는 장식이다 — 의미는 말풍선(role=status)이 전달한다. Mascot과 같은 규약.
    // 포인터를 먹지 않는다: 이 캔버스가 덮고 있는 것은 **접기 버튼**이고, 그 위
    // 조상은 드래그로 캐릭터를 옮긴다. 하나라도 가로채면 둘 다 죽는다.
    <span aria-hidden="true" className={`pointer-events-none block ${className}`}>
      <span
        ref={shadowRef}
        data-testid="guide-bot-shadow"
        className="absolute bottom-[3%] left-1/2 h-[7%] w-[42%] rounded-[50%] bg-slate-900/20 blur-[3px]"
        style={{ transform: 'translateX(-50%)' }}
      />
      <canvas
        ref={canvasRef}
        data-testid="guide-bot-canvas"
        className="absolute inset-0 h-full w-full"
      />
    </span>
  );
}
