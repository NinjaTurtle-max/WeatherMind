import { useCallback, useEffect, useRef, useState } from 'react';
import Mascot from './Mascot';
import { useT } from '../i18n';
import { GUIDE_SPEAKER, pickGuideMessage } from '../lib/guideRules';

/**
 * GuideBot (MT-26) — 화면을 따라다니며 말하는 구름 안내봇.
 *
 * **무엇을 말할지는 이 파일이 안 정한다.** `lib/guideRules.js`가 소유한다(순수 함수라
 * 브라우저 없이 테스트된다). 여기는 **어떻게 보이고 어떻게 끌리는지**만 맡는다.
 * 둘을 갈라 둔 이유는 규칙이 바뀔 일(문구·우선순위)과 표현이 바뀔 일(디자인 시안)이
 * 서로 다른 속도로 오기 때문이다 — 시안이 오면 이 파일만 손댄다.
 *
 * ── 접근성: 기존 마스코트와 **반대로 간다** ──────────────────────────────
 * `Mascot`은 `aria-hidden` 장식이다. 정오답·진도 같은 의미를 옆의 배지·문구가
 * 이미 말하므로 스크린리더에서 중복해 읽지 않으려는 것이다. **안내봇은 다르다** —
 * 이 말풍선이 그 정보의 **유일한 전달자**라서 숨기면 화면을 못 보는 사용자에게는
 * 기능이 아예 없는 것이 된다. 그래서 말풍선은 `role="status"`로 읽히고, 그림만
 * 장식으로 남긴다(`Mascot`의 기본값 그대로).
 * ⚠️ `aria-live`를 `assertive`로 올리지 말 것. 안내는 급한 정보가 아니고,
 * assertive는 사용자가 읽던 것을 끊는다.
 *
 * ── SSR ──────────────────────────────────────────────────────────────
 * 이 저장소는 화면들을 **서버에서 렌더해 보는 스모크**를 돌린다(SessionRunner·보드
 * 비주얼 등). 그래서 모듈 최상단은 물론 **첫 렌더까지** `window`·`localStorage`를
 * 만지면 안 된다. 위치는 `null`로 시작해 `useEffect`(= 클라이언트 전용)에서만
 * 채우고, 그 전에는 CSS 기본 자리(**왼쪽 아래** — 2026-08-17)에 붙는다.
 *
 * ── 왜 pointer 이벤트인가 ────────────────────────────────────────────
 * mouse/touch를 따로 달면 같은 로직이 두 벌이 되고 한쪽만 고쳐지는 일이 생긴다.
 * pointer는 마우스·터치·펜을 한 경로로 받고, `setPointerCapture`가 커서가 캐릭터를
 * 앞질러도 드래그를 놓치지 않게 해 준다(빠르게 끌면 실제로 놓친다).
 *
 * ── 3D는 「덤」이다 ───────────────────────────────────────────────────
 * 캐릭터 그림은 **항상 2D PNG가 먼저 그려지고**, 실제 WebGL 3D(`GuideBot3D`)는
 * 준비된 뒤에야 그 자리를 넘겨받는다. 세 가지가 이 순서에 걸려 있다:
 *   ⓐ 첫 페인트 — `.mesh`는 284.6KB다. 정적 import를 하면 메인 번들과 첫 화면이
 *     같이 느려지므로 **동적 import + 유휴 시간**에 받는다(2D가 그동안 서 있다).
 *   ⓑ 폴백 — WebGL2 미지원·컨텍스트 실패·`.mesh` 오류·컨텍스트 소실 중 무엇이든
 *     `onFail`로 올라오고, 그러면 3D를 걷어내 PNG가 다시 보인다. 3D가 없어도
 *     화면은 처음부터 완성돼 있다는 것이 이 구조의 요점이다.
 *   ⓒ 교체를 페이드로 하지 않는다 — **이유가 2026-08-13에 바뀌었다.** 처음에는
 *     베이킹이 PNG와 같은 프레이밍·같은 조명 상수를 써서 두 그림이 거의 같았고,
 *     그래서 겹쳐 넘기면 밝기만 한 번 꺼졌다 켜지므로 즉시 교체가 나았다. 지금은
 *     클라이언트 지시로 3D가 **원근 투영 + 강한 대비**로 바뀌어 두 그림이 일부러
 *     다르다(평평한 2D → 입체). 즉시 교체는 그 전환을 흐리지 않으려는 선택이고,
 *     캐릭터가 정지 그림에서 살아 움직이는 것으로 바뀌는 순간이 오히려 눈에 띄는
 *     편이 낫다는 판단이다. **폴백은 그대로 1순위** — 아래 onFail이 즉시 되돌린다.
 */

/**
 * 위치 영속 키. 사용자가 옮긴 자리는 새로고침해도 남는다.
 *
 * ⚠️ **`.v2`는 2026-08-17에 붙였다.** 기본 자리가 오른쪽 아래 → 왼쪽 아래로
 * 바뀌었는데, 저장된 좌표는 절대값(`left`/`top`)이라 옛 값이 남아 있으면
 * **이 변경이 그 사람에게만 안 보인다**(캐릭터가 계속 오른쪽에 뜬다).
 * 키를 바꿔 옛 좌표를 버린다 — 잃는 것은 「끌어다 둔 자리」 하나뿐이다.
 */
const POS_KEY = 'weathermind.guidebot.pos.v2';

/** 말풍선을 닫은 선택을 기억하는 키. 캐릭터를 눌러 다시 열면 지워진다. */
const DISMISS_KEY = 'weathermind.guidebot.dismissed';

/**
 * 캐릭터 지름(px). 화면 밖 이탈을 막는 계산에 쓴다.
 *
 * ⚠️ **버튼이 가질 수 있는 「가장 큰」 값과 같아야 한다**(지금은 2xl의 128px).
 * 이 값은 노드를 아직 못 재는 순간(첫 읽기·SSR)의 **폴백**이다 — 실제 클램프는
 * `clamp()`가 `getBoundingClientRect()`로 상자 전체를 잰다. 폴백을 작은 쪽에
 * 맞추면 큰 화면에서 캐릭터가 화면 밖으로 나가므로 **큰 쪽에 맞춘다**(보수적).
 *
 * 2026-08-13에 두 번 바뀌었다: 56 → 128(클라이언트 "「이어서 풀기」 노드만큼")
 * → **2xl 미만 96 · 2xl 이상 128**(해상도 검증). 1366×768에서 128px 캐릭터가
 * 본문 오른쪽을 141px 덮었다 — 본문(max-w-6xl=1152)이 사이드바 208을 뺀 1158
 * 안에 들어가 **좌우 여백이 3px밖에 안 남기 때문**이다. 1920에서는 여백이 280px
 * 이라 안 겹친다.
 * **분기를 `2xl`(1536)로 잡은 이유**: 1366은 md·lg·xl에 전부 걸려서 그보다 낮은
 * 분기점으로는 1366과 1920을 가를 수 없다.
 */
const SIZE = 128;

/** 여백(px) — 캐릭터가 화면 모서리에 딱 붙어 잘려 보이지 않게 한다. */
const EDGE = 8;

/**
 * 드래그로 인정하는 최소 이동(px, 맨해튼 거리).
 *
 * 이 문턱이 없으면 **손떨림 한 픽셀이 드래그가 되어 클릭을 삼킨다**(말풍선을
 * 마우스로 못 접는다). 반대로 너무 크면 짧은 드래그가 클릭으로 읽혀 놓을 때마다
 * 말풍선이 접힌다. 4px는 OS들이 쓰는 관례값 언저리다.
 */
const DRAG_SLOP = 4;

/**
 * 위치를 지금 창 안으로 밀어 넣는다.
 *
 * 저장된 자리가 **다음에 열 때 창 밖일 수 있다** — 큰 모니터에서 오른쪽 끝에 두고
 * 노트북에서 열면 그렇다. 그 경우 캐릭터가 영영 안 보이고 되돌릴 방법도 없다.
 * 그래서 읽을 때마다 클램프한다. (모바일 회전도 같은 경로다.)
 */
function clamp(pos, win, node) {
  // ⚠️ **캐릭터가 아니라 「자리를 잡는 상자」 전체를 재야 한다.** 말풍선이 펼쳐져
  // 있으면 상자는 캐릭터 128 + 간격 8 + 말풍선(최대 17rem=272) ≈ 408px이고
  // 캐릭터는 그 **왼쪽 끝**에 있다(2026-08-17에 좌우가 뒤집혔다 — 잘리는 쪽은
  // 이제 말풍선이다). SIZE(128)로만 재면 큰 모니터에서 오른쪽에
  // 뒀다가 작은 화면에서 열 때 상자가 화면 밖으로 밀려 말풍선이 잘린다 —
  // 이 함수가 막겠다고 적어 둔 바로 그 실패다. 노드를 못 받으면(첫 읽기·SSR)
  // SIZE로 떨어지되, 그때는 아직 CSS 기본 자리라 넘칠 일이 없다.
  const rect = node?.getBoundingClientRect?.();
  const w = rect?.width || SIZE;
  const h = rect?.height || SIZE;
  const maxX = Math.max(EDGE, win.innerWidth - w - EDGE);
  const maxY = Math.max(EDGE, win.innerHeight - h - EDGE);
  return {
    x: Math.min(Math.max(pos.x, EDGE), maxX),
    y: Math.min(Math.max(pos.y, EDGE), maxY),
  };
}

function readPos(win, node) {
  try {
    const raw = win.localStorage?.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 저장값이 손상됐을 때 NaN이 스타일로 흘러가면 캐릭터가 사라진다.
    if (!Number.isFinite(parsed?.x) || !Number.isFinite(parsed?.y)) return null;
    return clamp(parsed, win, node);
  } catch {
    return null; // 사파리 프라이빗 모드 등 — 위치만 못 외운다, 기능은 산다
  }
}

/**
 * 화면 아래 오버레이 레인을 양보하는 조건(2026-08-14, B3 — §4.15).
 *
 * `laneBusy`가 참이면 **좁은 화면에서만** 자취를 감춘다. 폭 기준을 `lg`로 잡은 것은
 * 임의값이 아니라 **`FeedbackPanel`의 짝**이다: `SessionRunner`가 그 패널을
 * `<div className="lg:hidden">`에 감싸 좁은 화면에서만 띄우고, 넓은 화면에서는
 * 같은 내용을 오른쪽 열 안(`FeedbackCard`)에 인라인으로 넣는다. 즉 레인을 다투는
 * 구간이 정확히 `<lg`다. `max-lg:hidden`은 그 여집합이므로 **둘이 동시에 화면에
 * 있을 수 있는 폭이 존재하지 않는다** — z 순서가 아니라 점유 자체가 갈린다.
 * ⚠️ `SessionRunner`의 감싸개 분기점이 바뀌면 여기도 같이 바꿔야 한다.
 * ⚠️ **언마운트가 아니라 CSS 숨김이다.** 조건부 렌더로 하면 사용자가 끌어다 둔
 * 자리(`pos`)와 3D 로드 상태가 매번 날아간다 — 위 SSR/영속 주석의 전제가 깨진다.
 */
const LANE_YIELD_CLASS = 'max-lg:hidden';

export default function GuideBot({ pathname = '/', state = {}, laneBusy = false, speaker = GUIDE_SPEAKER }) {
  const t = useT();
  const [pos, setPos] = useState(null); // null = 아직 CSS 기본 자리(SSR 포함)
  const [open, setOpen] = useState(true);

  /**
   * 말풍선을 닫고 **그 선택을 기억한다**.
   *
   * 기억하지 않으면 새로고침·재방문마다 다시 떠서 X를 붙인 뜻이 없어진다 —
   * 모바일에서는 그게 곧 "화면이 계속 가려진다"는 뜻이다.
   * ⚠️ 캐릭터 자체는 남긴다(다시 눌러 펼 수 있다). 캐릭터까지 지우면 되살릴
   * 통로가 사라져서, 한 번 닫으면 영영 못 여는 기능이 된다.
   */
  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage?.setItem(DISMISS_KEY, '1');
    } catch {
      /* 프라이빗 모드 — 이번 세션만 닫힌 채로 간다 */
    }
  }, []);
  const [Bot3D, setBot3D] = useState(null); // 로드된 3D 컴포넌트(없으면 2D만)
  const [live3D, setLive3D] = useState(false); // 3D가 실제로 한 프레임 그렸나
  const [dragging, setDragging] = useState(false); // 끄는 중에는 커서 추종을 끈다
  const dragRef = useRef(null); // { dx, dy, x0, y0, moved, id }
  // 드래그로 끝난 포인터의 click을 한 번 삼킨다(캡처 단계에서 가로챈다).
  const swallowClickRef = useRef(false);
  const nodeRef = useRef(null);

  // 첫 마운트에 저장된 자리와 **닫아 둔 선택**을 읽는다(클라이언트 전용).
  useEffect(() => {
    setPos(readPos(window, nodeRef.current));
    try {
      if (window.localStorage?.getItem(DISMISS_KEY) === '1') setOpen(false);
    } catch {
      /* 못 읽으면 기본값(열림) */
    }
  }, []);

  // 3D는 **유휴 시간에** 받는다 — 첫 페인트·초기 API 호출과 대역폭을 다투지 않게.
  // 이 import가 실패해도(청크 404 등) 조용히 2D로 남는다.
  useEffect(() => {
    let alive = true;
    const load = () => {
      import('./GuideBot3D')
        .then((m) => { if (alive) setBot3D(() => m.default); })
        .catch(() => { /* 2D 유지 */ });
    };
    const ric = window.requestIdleCallback;
    const id = ric ? ric(load, { timeout: 2000 }) : window.setTimeout(load, 400);
    return () => {
      alive = false;
      if (ric) window.cancelIdleCallback?.(id);
      else window.clearTimeout(id);
    };
  }, []);

  // 창 크기가 바뀌면 다시 안으로 밀어 넣는다.
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p, window, nodeRef.current) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e) => {
    const node = nodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      id: e.pointerId,
    };
    // ⚠️ **여기서 setPointerCapture를 하지 않는다.** 접기 버튼이 이 노드 **안**에
    // 있어서, 누르는 즉시 캡처하면 호환 마우스 이벤트가 컨테이너로 리타깃되고
    // 버튼의 onClick이 영영 안 불린다(Pointer Events 명세대로 크롬이 그렇게 한다).
    // 그러면 말풍선을 키보드로만 접을 수 있게 된다. 캡처는 **실제로 움직인 뒤**
    // 아래 onPointerMove에서 건다 — 그때는 이미 클릭이 아니라 드래그다.
  }, []);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      // 손떨림을 드래그로 읽지 않는다. 이 문턱을 넘기 전에는 아직 「클릭 중」이다.
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < DRAG_SLOP) return;
      drag.moved = true;
      // 3D의 커서 추종을 끈다 — 끌고 가는 손과 쳐다보는 고개가 싸우지 않게.
      setDragging(true);
      // 이제부터 커서가 캐릭터를 앞질러도 move/up이 계속 이 노드로 온다.
      nodeRef.current?.setPointerCapture?.(drag.id);
    }
    // 드래그 중에는 텍스트 선택·스크롤이 끼어들지 않게 한다.
    e.preventDefault();
    setPos(clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, window, nodeRef.current));
  }, []);

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    // 끌었으면 이번 클릭은 삼킨다 — 안 그러면 **놓을 때마다 말풍선이 접힌다**.
    // 실제로 움직였을 때만 세운다(문턱 미만은 평범한 클릭으로 남긴다).
    swallowClickRef.current = drag.moved;
    dragRef.current = null;
    setDragging(false);
    if (!drag.moved) return;
    // 놓은 자리만 저장한다 — 드래그 중 매 프레임 쓰면 localStorage가 동기라 끊긴다.
    setPos((p) => {
      if (p) {
        try {
          window.localStorage?.setItem(POS_KEY, JSON.stringify(p));
        } catch {
          /* 못 외워도 이번 세션 위치는 유지된다 */
        }
      }
      return p;
    });
  }, []);

  const { key, ruleId, kind } = pickGuideMessage(pathname, state);
  const message = t(key);

  // 위치가 아직 없으면 CSS 기본 자리(왼쪽 아래)에 둔다 — SSR과 첫 페인트가 같다.
  const style = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }
    : undefined;

  return (
    <div
      ref={nodeRef}
      data-testid="guide-bot"
      data-guide-rule={ruleId}
      data-guide-kind={kind}
      data-guide-placed={pos ? '1' : '0'}
      // 레인 점유 상태를 **항상** 내보낸다(둘 중 하나). 없을 때만 없는 속성으로
      // 두면 "아직 안 붙었다"와 "양보 안 한다"를 구별할 수 없다.
      data-guide-lane={laneBusy ? 'yielded' : 'free'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // 드래그로 끝났으면 뒤따라오는 click을 **버튼에 닿기 전에** 삼킨다.
      // 캡처 단계라야 안쪽 버튼보다 먼저 잡는다.
      onClickCapture={(e) => {
        if (!swallowClickRef.current) return;
        swallowClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={style}
      // touch-none이 없으면 모바일에서 드래그가 페이지 스크롤로 먹힌다.
      //
      // ⚠️ 바닥 여백의 분기점은 **`md`**다(`sm` 아님). `bottom-20`은 TabBar를
      // 피하려고 있는데, TabBar는 `md:hidden`이라 **767px까지 떠 있다**. 여기를
      // `sm:`(640px)으로 두면 640~767px 구간에서 z-50 불투명 탭바가 캐릭터의
      // 아랫부분을 덮는다 — 코드 리뷰가 실측으로 잡았다.
      //
      // 🔴 **기본 자리가 왼쪽 아래다**(2026-08-17 사용자 지시 — 종전 `right-4`).
      // 사이드바 튜터 카드가 있던 자리를 그대로 물려받는다(`SideNav.jsx`에서
      // 그 카드를 걷었다). 캐릭터는 208px 사이드바 폭 안에 들어가고 말풍선만
      // 오른쪽으로 삐져나와 본문 위에 뜬다 — 그래서 아래 자식 순서가
      // **캐릭터 → 말풍선**이다.
      //
      // ⚠️ **z가 `z-40` → `z-50`이다.** `SideNav`가 `z-50`이라 그대로 두면
      // 캐릭터가 사이드바 **뒤로** 숨는다(왼쪽으로 옮기기 전에는 사이드바와
      // 겹칠 일이 없어 z-40으로 충분했다). 같은 z에서는 DOM 뒤가 위로 오는데,
      // `Layout`이 `SideNav`(:211) → `TabBar`(:322) → `GuideBot`(:341) 순으로
      // 그리므로 이 노드가 마지막이다. ⚠️ Layout의 그 순서가 바뀌면 여기가
      // 조용히 가려진다.
      //
      // ⚠️ **세로 정렬은 `items-start`다**(2026-08-17 — 종전 `items-end`).
      // 바닥에 맞추면 말풍선이 캐릭터 발치까지 내려와 **화면 맨 아래 줄을
      // 덮는다**(학습 경로 카드의 「현재 진도」 막대에서 실제로 그랬다).
      // 위에 맞추면 말풍선이 캐릭터 **얼굴 높이**로 올라가고, 바닥 한 줄이
      // 비어 그 겹침이 사라진다. 캐릭터가 더 크므로 상자 높이는 그대로다
      // — 움직이는 것은 말풍선뿐이다.
      className={`fixed bottom-20 left-4 z-50 flex cursor-grab touch-none select-none items-start gap-2 active:cursor-grabbing md:bottom-6 ${laneBusy ? LANE_YIELD_CLASS : ''}`}
    >
      <button
        type="button"
        data-testid="guide-bot-toggle"
        onClick={() => setOpen((v) => {
          const next = !v;
          // 다시 열면 「닫아 뒀다」는 기억을 지운다 — 안 그러면 새로고침에 또 닫힌다.
          try {
            if (next) window.localStorage?.removeItem(DISMISS_KEY);
            else window.localStorage?.setItem(DISMISS_KEY, '1');
          } catch { /* 기억 못 해도 이번 세션 상태는 유지된다 */ }
          return next;
        })}
        // 드래그로 옮기고 클릭으로 접는다. 키보드 사용자에게는 접기만 있으면
        // 충분하다 — 위치는 기능이 아니라 편의이고, 기본 자리가 이미 유효하다.
        aria-expanded={open}
        aria-label={t(open ? 'guide.aria.collapse' : 'guide.aria.expand')}
        // 128px — 「이어서 풀기」 노드 정도의 존재감을 요구받았다(2026-08-13).
        // ⚠️ 이 크기를 바꾸면 위 `SIZE` 상수를 **같이** 바꿔야 한다(클램프 계약).
        //
        // ⚠️ **흰 원 배경을 두지 않는다**(2026-08-13 클라이언트 지시). 종전에는
        // `rounded-full bg-white shadow-lg ring-1 ring-sky-200`으로 캐릭터 뒤에 흰
        // 동그라미를 깔았는데, 그러면 **캐릭터가 아니라 버튼처럼 보인다** — 화면을
        // 떠다니며 말을 거는 캐릭터라는 인상이 그 테두리 하나에 깨진다. 접지
        // 그림자(GuideBot3D)가 이미 "떠 있다"를 만들고 있으므로 판이 필요 없다.
        // 배경을 지웠으니 **버튼임을 알리는 것은 커서와 접근 이름이 맡는다**.
        className="grid h-24 w-24 flex-none cursor-pointer place-items-center bg-transparent 2xl:h-32 2xl:w-32"
      >
        {/* 2D와 3D가 **같은 정사각 박스**를 공유한다 — 크기·중심이 같아야 교체가
            안 보인다(PNG는 내용 경계로 잘려 있고 3D는 그 박스에 맞춰 그린다). */}
        <span className="relative block h-20 w-20 2xl:h-28 2xl:w-28" data-guide-3d={live3D ? '1' : '0'}>
          <Mascot
            name={speaker}
            // 3D가 살아 있는 동안만 숨긴다. 지우지 않는 이유는 컨텍스트 소실 같은
            // 사고가 났을 때 **같은 프레임에** 되돌아와야 하기 때문이다.
            className={`h-20 w-20 2xl:h-28 2xl:w-28 ${live3D ? 'invisible' : ''}`}
          />
          {Bot3D && (
            <Bot3D
              className="absolute inset-0 h-full w-full"
              // 문구가 바뀌는 순간이 「말하는 순간」이다 — 규칙표의 키를 그대로
              // 넘긴다(무엇을 말할지는 guideRules가 소유하고 여기는 안 정한다).
              speakKey={key}
              dragging={dragging}
              onReady={() => setLive3D(true)}
              onFail={() => { setLive3D(false); setBot3D(null); }}
            />
          )}
        </span>
      </button>

      {open && (
        // 말풍선이 캐릭터 **오른쪽**에 온다(2026-08-17 사용자 지시 — 종전 왼쪽).
        // 캐릭터가 왼쪽 아래(사이드바 폭 안)로 옮겨졌으므로 왼쪽에 두면 화면
        // 밖으로 나간다 — 방향이 캐릭터 자리를 따라 뒤집힌 것이지 취향이 아니다.
        <div
          data-testid="guide-bot-bubble"
          role="status"
          aria-live="polite"
          // 캐릭터가 56 → 128px가 되면서 말풍선도 함께 키웠다(13rem은 그 옆에서
          // 쪽지처럼 작아 보인다). 꼬리는 캐릭터 세로 중앙에 맞춘다.
          // ⚠️ 폭 상한이 **셋**이다(2026-08-14 B3에서 좁은 쪽 한 칸을 더 넣었다).
          // §4.15 실측: 390px 폰에서 말풍선 208 + 간격 8 + 캐릭터 96 = 312px으로
          // **가로의 80%**를 먹었다. 10.5rem(168)로 내리면 272px = 70%다. 레인
          // 양보(위 LANE_YIELD_CLASS)가 해설과의 충돌은 이미 없앴지만, 해설이 없는
          // 화면(학습 경로·보드)에서도 캐릭터 상자가 본문 오른쪽을 덮는 것은 남는다.
          className="relative max-w-[10.5rem] rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-snug text-sky-900 shadow-lg ring-1 ring-sky-200 sm:max-w-[13rem] 2xl:max-w-[17rem]"
        >
          {/* 꼬리 — 캐릭터 쪽(왼쪽)을 가리킨다. 종전 오른쪽 꼬리
              (`-right-[5px] … border-b border-r`)의 **수평 거울상**이다:
              위치가 좌우로 뒤집히고, 드러나는 두 변도 r → l로 바뀐다.

              ⚠️ 세로 기준이 `bottom-8` → **`top-8`**로 바뀌었다(2026-08-17).
              바깥이 `items-start`라 말풍선 **위쪽**이 캐릭터 위쪽에 고정되므로,
              위에서 재야 꼬리가 항상 같은 높이(= 얼굴)를 가리킨다. 아래에서
              재면 문구가 한 줄이냐 세 줄이냐에 따라 꼬리가 오르내려서, 긴
              문구에서는 얼굴이 아니라 발치를 가리킨다. */}
          <span
            aria-hidden="true"
            className="absolute -left-[5px] top-8 h-2.5 w-2.5 rotate-45 border-b border-l border-sky-200 bg-sky-50"
          />
          {/* 닫기 X — **모바일에서 필수다**(2026-08-13 클라이언트 제보:
              "컴퓨터는 괜찮은데 모바일 웹 접속이 가로막아").
              390px 폰에서 말풍선 208 + 간격 8 + 캐릭터 96 = 312px로 **가로의 80%**를
              먹고, `FeedbackPanel`(`fixed bottom-14 z-40`)과 **같은 z-40**이라
              정답 피드백 위에 겹친다. 캐릭터를 눌러 접을 수는 있었지만 그게
              접기 버튼이라는 단서가 화면에 없었다 — 눌러 볼 생각이 안 든다.
              ⚠️ 지우지 말 것: 이 X가 없으면 모바일에서 **화면을 되찾을 방법이 없다.** */}
          <button
            type="button"
            data-testid="guide-bot-dismiss"
            onClick={(e) => { e.stopPropagation(); dismiss(); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={t('guide.aria.dismiss')}
            className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-white text-sm leading-none text-sky-700 shadow ring-1 ring-sky-200"
          >
            ✕
          </button>
          {message}
        </div>
      )}
    </div>
  );
}
