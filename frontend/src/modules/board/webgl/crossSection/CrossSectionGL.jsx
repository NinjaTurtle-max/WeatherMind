/**
 * CrossSectionGL — 단면 모식도 WebGL2 장면 마운트 (R10-C / S2).
 *
 * 이 컴포넌트는 **브라우저에서 WebGL2가 확인된 뒤에만** 마운트된다
 * (CrossSectionPanel이 useEffect에서 판정 — SSR·reduced-motion·컨텍스트 실패
 * 3경로는 애초에 여기까지 오지 않고 기존 SVG 스토리보드를 그대로 쓴다).
 * 그래도 이중 안전망으로 렌더러 생성 실패 시 `onFail()`을 올려 SVG로 되돌린다.
 *
 * rAF 생명주기는 realisticEffects.PrecipCanvas 관례를 답습한다:
 *  - `visibilitychange`로 탭 비활성 시 정지
 *  - `IntersectionObserver`로 뷰포트 밖이면 정지
 *  - `ResizeObserver`로 백버퍼·카메라 종횡비 재계산
 *  - 언마운트 시 rAF 취소 + GL 리소스 해제
 *
 * 라벨은 GL이 아니라 위에 겹치는 SVG 텍스트 레이어가 그린다 — 기존 스토리보드의
 * 흰 헤일로 문법(paintOrder=stroke)을 그대로 쓰고 드로우콜을 늘리지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScene } from './scenes';
import { createRenderer, labelsFor } from './renderer';

/** 라벨 좌표계 — 기존 SVG 스토리보드와 동일(레이아웃·글자 크기 연속성) */
const VB_W = 260;
const VB_H = 150;
/** scenes.js의 size(px 감각) → viewBox 260×150 단위 */
const LABEL_SCALE = 0.6;

export default function CrossSectionGL({ ruleId, step, onFail }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const startRef = useRef(null);
  const [aspect, setAspect] = useState(VB_W / VB_H);

  const scene = useMemo(() => buildScene(ruleId), [ruleId]);
  const labels = useMemo(() => labelsFor(scene, step, aspect), [scene, step, aspect]);

  // 렌더러 생성 + rAF 생명주기 (장면 교체와 무관하게 1회)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined; // SSR 가드
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') return undefined;
    if (!scene) {
      onFail?.(); // rule_id → 3D 장면 매핑 누락(규칙 드리프트) → SVG 스토리보드로
      return undefined;
    }

    const renderer = createRenderer(canvas);
    if (!renderer) {
      onFail?.();
      return undefined;
    }
    rendererRef.current = renderer;
    renderer.resize();

    let raf = 0;
    let running = false;
    let hidden = document.visibilityState === 'hidden';
    let inView = true;

    const frame = (t) => {
      raf = 0;
      if (hidden || !inView) {
        running = false;
        return;
      }
      renderer.render(t / 1000);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || hidden || !inView) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    startRef.current = start;
    start();

    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      if (!hidden) start();
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
          renderer.resize();
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) setAspect(rect.width / rect.height);
          start();
        })
      : null;
    ro?.observe(canvas);

    // 컨텍스트 소실(드라이버 리셋·탭 과다) → SVG 폴백으로 되돌린다
    const onLost = (e) => {
      e.preventDefault();
      running = false;
      if (raf) cancelAnimationFrame(raf);
      onFail?.();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      running = false;
      startRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      io?.disconnect();
      ro?.disconnect();
      rendererRef.current = null;
      renderer.dispose();
    };
    // onFail은 부모에서 useCallback 없이 넘어올 수 있어 의존성에서 제외(1회 마운트 계약)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 장면 교체(rule_id 변경)
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !scene) return;
    r.setScene(scene);
    startRef.current?.();
  }, [scene]);

  // 단계 전환 — 등장 애니메이션 기준 시각을 렌더러에 전달
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    r.setStep(step, now);
    startRef.current?.();
  }, [step]);

  const halo = scene?.night ? '#0f172a' : '#ffffff';

  return (
    <div className="relative w-full" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {labels.map((l) => (
          <text
            key={l.key}
            x={(l.left / 100) * VB_W}
            y={(l.top / 100) * VB_H}
            textAnchor="middle"
            fontSize={l.size * LABEL_SCALE}
            fontWeight={l.weight}
            fill={l.color}
            stroke={halo}
            strokeWidth="2"
            paintOrder="stroke"
            strokeLinejoin="round"
          >
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
