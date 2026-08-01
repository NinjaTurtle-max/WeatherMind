/**
 * MapOverlayGL — 지도 SVG 위에 겹치는 raw WebGL2 오버레이 캔버스 1장 (R10-01 S3 §3.3).
 *
 * 담당(4요소): ① 기단 색 번짐(확산) ③ 유동 화살표 흐름장 ④ 터뷸런스 구름
 *              ⑤ 강수(현행 Canvas2D precipEngine 렌더 대체 — 물리는 그 엔진 재사용)
 * 담당 아님: 반도 지형·존 노드·표준 전선 기호·라벨·주석 = **SVG 유지**.
 *
 * 계약 준수 사항
 *  - 상호작용 비침습: 캔버스는 `pointer-events-none`. useBoardDrag의
 *    document.elementFromPoint 히트 테스트는 pointer-events:none 요소를 건너뛰므로
 *    `[data-board-zone]` 드롭 타깃과 존 탭이 그대로 SVG 계층에 남는다.
 *  - 좌표 정합: 캔버스를 지도 컨테이너에 absolute inset-0으로 겹치고,
 *    셰이더가 `u_view = (VIEW_W, VIEW_H)`(boardLayout 동결 계약)로 userSpace를
 *    직접 clip space로 보낸다. 즉 정점 좌표계 = SVG viewBox userSpace로 동일하며
 *    리사이즈 시 재계산이 필요한 것은 드로잉 버퍼 크기·viewport·dpr뿐이다.
 *  - 성능: 컨텍스트 1개, 드로우콜 4, 파티클 상한은 precipEngine 전역 200 이하.
 *    탭 비활성(visibilitychange)·뷰포트 밖(IntersectionObserver)·reduced-motion이면
 *    rAF 정지(precipEngine.shouldAnimate 재사용).
 *  - 폴백: 컨텍스트 생성/셰이더 컴파일 실패·컨텍스트 소실 시 onFallback()을 호출해
 *    호출측(PeninsulaMap)이 SVG + Canvas2D 경로로 되돌린다.
 *  - SSR: 모든 GL 접근은 useEffect + typeof window 가드 안에서만 일어난다.
 */
import { useEffect, useRef } from 'react';
import { MAX_PARTICLES, createSystem, shouldAnimate, stepSystem } from '../../precipEngine';
import { VIEW_H, VIEW_W } from '../../boardLayout';
import { createMesh, createProgram, uploadMesh, GlInitError } from './glCore';
import {
  BLOOM_LAYOUT,
  CLOUD_LAYOUT,
  FLOW_LAYOUT,
  PRECIP_FLOATS_PER_PARTICLE,
  PRECIP_LAYOUT,
  bloomVertices,
  cloudVertices,
  flowVertices,
  precipVertices,
} from './overlayGeometry';
import {
  BLOOM_FS,
  BLOOM_VS,
  CLOUD_FS,
  CLOUD_VS,
  FLOW_FS,
  FLOW_VS,
  PRECIP_FS,
  PRECIP_VS,
} from './shaders';

/** reduced-motion 정적 프레임에 쓰는 고정 시각 — 매번 같은 장면이 나오게 */
const STATIC_TIME = 3.2;

export default function MapOverlayGL({ scene, reduced = false, cap = 160, onFallback, className = '' }) {
  const ref = useRef(null);
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  // 장면은 작은 평면 객체다 — 문자열화로 얕은 재마운트 키를 만든다(PrecipCanvas 관례).
  const sceneKey = JSON.stringify(scene ?? null);

  useEffect(() => {
    // SSR/미마운트 가드 — WebGL은 브라우저에서만 존재한다
    if (typeof window === 'undefined') return undefined;
    const canvas = ref.current;
    if (!canvas || typeof canvas.getContext !== 'function') return undefined;

    const parsed = JSON.parse(sceneKey) ?? { blooms: [], flows: [], clouds: [], emitters: [] };
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: true, // 프래그먼트가 premultiplied alpha를 낸다(shaders.js 알파 규약)
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      fallbackRef.current?.('no-webgl2');
      return undefined;
    }

    let programs = [];
    let meshes = [];
    let raf = 0;
    let running = false;
    let last = 0;
    let disposed = false;
    let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    let inView = true;

    // GPU 리소스만 반납한다. **loseContext는 호출하지 않는다** —
    // 같은 <canvas> 엘리먼트의 컨텍스트는 한 번 잃으면 되살아나지 않고,
    // StrictMode(dev)의 mount→cleanup→remount에서 2회차가 죽은 컨텍스트를 받아
    // 전 사용자가 폴백으로 떨어진다(실측으로 잡은 버그). 컨텍스트는 캔버스
    // 엘리먼트가 언마운트될 때 GC된다.
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      running = false;
      for (const m of meshes) {
        gl.deleteBuffer(m.mesh.vbo);
        gl.deleteVertexArray(m.mesh.vao);
      }
      for (const p of programs) gl.deleteProgram(p);
      meshes = [];
      programs = [];
    };

    let layers;
    try {
      const build = (vs, fs, layout, verts, dynamic = false) => {
        const program = createProgram(gl, vs, fs);
        programs.push(program);
        const mesh = createMesh(gl, program, layout, dynamic);
        meshes.push({ mesh });
        return {
          program,
          mesh,
          uView: gl.getUniformLocation(program, 'u_view'),
          uTime: gl.getUniformLocation(program, 'u_time'),
          count: verts ? uploadMesh(gl, mesh, verts) : 0,
        };
      };
      layers = {
        bloom: build(BLOOM_VS, BLOOM_FS, BLOOM_LAYOUT, bloomVertices(parsed.blooms ?? [])),
        flow: build(FLOW_VS, FLOW_FS, FLOW_LAYOUT, flowVertices(parsed.flows ?? [])),
        cloud: build(CLOUD_VS, CLOUD_FS, CLOUD_LAYOUT, cloudVertices(parsed.clouds ?? [])),
        precip: build(PRECIP_VS, PRECIP_FS, PRECIP_LAYOUT, null, true),
      };
    } catch (err) {
      dispose();
      fallbackRef.current?.(err instanceof GlInitError ? 'shader' : 'gl-init');
      return undefined;
    }

    // ── 강수 물리는 precipEngine(동결) 재사용 — 좌표만 userSpace ──────────────
    // 에미터 박스가 userSpace라 파티클 속도·길이도 userSpace로 나오고, 셰이더가
    // 같은 좌표계를 clip으로 보내므로 리사이즈와 무관하게 정합이 유지된다.
    const particleCap = Math.max(0, Math.min(cap, MAX_PARTICLES));
    const sys = createSystem(parsed.emitters ?? [], particleCap);
    const precipBuf = new Float32Array(particleCap * PRECIP_FLOATS_PER_PARTICLE);

    // ── 리사이즈 = 드로잉 버퍼 + viewport 재계산 ──────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round((rect.width || canvas.clientWidth || 1) * dpr));
      const h = Math.max(1, Math.round((rect.height || canvas.clientHeight || 1) * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // premultiplied 소스 → (ONE, ONE_MINUS_SRC_ALPHA). 레이어를 여러 장 겹쳐도 색이 맞는다.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const drawLayer = (layer, t, count = layer.count) => {
      if (!count) return;
      gl.useProgram(layer.program);
      gl.uniform2f(layer.uView, VIEW_W, VIEW_H);
      gl.uniform1f(layer.uTime, t);
      gl.bindVertexArray(layer.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      gl.bindVertexArray(null);
    };

    /** 드로우콜 4 — 번짐 → 흐름 → 구름 → 강수 (뒤에서 앞으로) */
    const draw = (t) => {
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawLayer(layers.bloom, t);
      drawLayer(layers.flow, t);
      drawLayer(layers.cloud, t);
      const floats = precipVertices(sys, precipBuf);
      if (floats > 0) {
        const n = uploadMesh(gl, layers.precip.mesh, precipBuf, floats);
        drawLayer(layers.precip, t, n);
      }
    };

    const frame = (ts) => {
      raf = 0;
      if (disposed) return;
      if (!shouldAnimate({ reduced, hidden, inView })) {
        running = false;
        return;
      }
      const dt = last ? (ts - last) / 1000 : 0.016;
      last = ts;
      stepSystem(sys, dt); // 내부 dt ≤ 0.05s 클램프(30fps 하한 안정)
      draw(ts / 1000);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (disposed || running) return;
      if (!shouldAnimate({ reduced, hidden, inView })) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const staticFrame = () => {
      stepSystem(sys, 0.03); // 정적 최종 장면 1프레임
      draw(STATIC_TIME);
    };

    resize();
    if (reduced) staticFrame();
    else start();

    const onLost = (e) => {
      e.preventDefault?.();
      dispose();
      fallbackRef.current?.('context-lost');
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      if (!hidden) start(); // frame 가드가 hidden이면 스스로 멈춘다
    };
    document.addEventListener('visibilitychange', onVisibility);

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          inView = entries[0]?.isIntersecting ?? true;
          if (inView) start();
        })
      : null;
    io?.observe(canvas);

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (disposed) return;
          resize();
          if (reduced) staticFrame();
        })
      : null;
    ro?.observe(canvas);

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('visibilitychange', onVisibility);
      io?.disconnect();
      ro?.disconnect();
      dispose();
    };
  }, [sceneKey, reduced, cap]);

  return (
    <canvas
      ref={ref}
      data-map-overlay="webgl"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      aria-hidden="true"
    />
  );
}
