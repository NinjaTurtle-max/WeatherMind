/**
 * 갤러리 공용 부품 — 칸·머리글·주석.
 *
 * 🔴 **꾸미지 않는다는 것이 규약이다.** 크기를 키우지 않고(모든 GL/SVG 칸은
 * `CrossSectionPanel`과 같은 260:150 판형), 배경을 바꾸지 않고(장면이 자기 하늘을
 * 그린다), 고르지 않는다(장면 목록은 소스에서 파생한다). 갤러리가 더하는 것은
 * **이름·경로·단계 번호·빈 자리의 사유**뿐이다.
 *
 * 장식은 전부 인라인 스타일이다 — tailwind content 글롭이 `src/**`뿐이라 여기 쓴
 * 유틸리티 클래스는 CSS로 생성되지 않는다(main.jsx 머리 주석 참조).
 */
import { useEffect, useRef, useState } from 'react';
import CrossSectionGL from '../src/modules/board/webgl/crossSection/CrossSectionGL.jsx';
import { acquire, release, unregister, nextId, liveCount, waitingCount, GL_CAP } from './glBudget.js';

export const C = {
  page: '#f1f5f9',
  card: '#ffffff',
  line: '#e2e8f0',
  ink: '#0f172a',
  dim: '#64748b',
  faint: '#94a3b8',
  warn: '#b45309',
  bad: '#b91c1c',
  ok: '#047857',
  accent: '#0369a1',
};

/** 모든 그림 칸의 판형 — 보드 단면 viewBox 260×150과 같다. 절대 키우지 않는다. */
const FRAME = { aspectRatio: '260 / 150', width: '100%', position: 'relative' };

function Placeholder({ text, tone = C.dim, bg = '#e2e8f0' }) {
  return (
    <div
      style={{
        ...FRAME,
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: 11, lineHeight: 1.5, color: tone, textAlign: 'center' }}>{text}</span>
    </div>
  );
}

/**
 * GL 한 칸 — **뷰포트 근방에서만 마운트**하고 벗어나면 언마운트한다.
 * 비어 있는 이유를 항상 글로 남긴다(빈 칸 = 「그림이 없다」 오독 차단).
 */
export function GLCell({ ruleId = null, scene = null, step = 0 }) {
  const boxRef = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = nextId();
  const [live, setLive] = useState(false);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    const id = idRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      // IO가 없는 환경 — 예산 장치가 없으니 아예 켜지 않고 그 사실을 적는다
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries[0]?.isIntersecting ?? false;
        setNear(hit);
        if (hit) acquire(id, setLive);
        else release(id);
      },
      { rootMargin: '320px 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      unregister(id);
    };
  }, []);

  let body;
  if (failed) {
    body = (
      <Placeholder
        tone={C.bad}
        bg="#fee2e2"
        text={'GL 실패 — 컨텍스트 생성 실패·소실 또는 rule_id→장면 매핑 누락.\n(앱에서는 이때 SVG로 내려간다. 여기서는 일부러 내려가지 않는다 — 그러면 비교가 거짓이 된다.)'}
      />
    );
  } else if (live) {
    body = <CrossSectionGL ruleId={ruleId} scene={scene} step={step} onFail={() => setFailed(true)} />;
  } else if (near) {
    body = <Placeholder text={`컨텍스트 대기 — 동시 상한 ${GL_CAP}개에 걸렸다.\n조금 기다리거나 천천히 스크롤하면 뜬다.`} tone={C.warn} bg="#fef3c7" />;
  } else {
    body = <Placeholder text={'뷰포트 밖 — 스크롤해 들어오면 GL을 마운트한다.\n(그림이 없는 것이 아니다)'} />;
  }

  return (
    <div ref={boxRef} style={FRAME}>
      {body}
    </div>
  );
}

/** SVG 폴백 한 칸 — `STORYBOARDS[ruleId].Scene`을 그대로 그린다. */
export function SvgCell({ Scene, step }) {
  if (!Scene) {
    return <Placeholder tone={C.bad} bg="#fee2e2" text={'SVG 장면 없음 — SCENE_BY_RULE에 이 rule_id가 없다.'} />;
  }
  // animate={false}: 화면 밖에서 등장 애니메이션이 흘러가 버리지 않게 정지 프레임으로 본다.
  return (
    <div style={FRAME}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Scene step={step} animate={false} />
      </div>
    </div>
  );
}

/** 칸 위의 꼬리표 — 이름 · 경로 · 단계 번호. */
export function Tag({ children, tone = C.dim, bg = '#f1f5f9' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        background: bg,
        color: tone,
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </span>
  );
}

export function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        padding: 10,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function H2({ children, note }) {
  return (
    <div style={{ margin: '34px 0 10px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: C.ink, margin: 0 }}>{children}</h2>
      {note ? <p style={{ fontSize: 12, color: C.dim, margin: '4px 0 0', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{note}</p> : null}
    </div>
  );
}

export function Note({ children, tone = C.warn, bg = '#fffbeb' }) {
  return (
    <p
      style={{
        margin: '8px 0',
        padding: '8px 10px',
        border: `1px solid ${tone}33`,
        background: bg,
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.75,
        color: tone,
        whiteSpace: 'pre-line',
      }}
    >
      {children}
    </p>
  );
}

/** 상단 고정 계기판 — 지금 몇 개의 GL 컨텍스트가 살아 있는지 그대로 보인다. */
export function GLGauge() {
  const [n, setN] = useState(0);
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setN(liveCount());
      setW(waitingCount());
    }, 300);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 50,
        background: 'rgba(15,23,42,0.9)',
        color: '#e2e8f0',
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.6,
      }}
    >
      살아 있는 GL 컨텍스트 <b style={{ color: '#38bdf8' }}>{n}</b> / 상한 {GL_CAP}
      <br />
      대기 중 <b style={{ color: '#fbbf24' }}>{w}</b>
    </div>
  );
}
