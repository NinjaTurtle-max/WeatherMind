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
 * 채우고, 그 전에는 CSS 기본 자리(오른쪽 아래)에 붙는다.
 *
 * ── 왜 pointer 이벤트인가 ────────────────────────────────────────────
 * mouse/touch를 따로 달면 같은 로직이 두 벌이 되고 한쪽만 고쳐지는 일이 생긴다.
 * pointer는 마우스·터치·펜을 한 경로로 받고, `setPointerCapture`가 커서가 캐릭터를
 * 앞질러도 드래그를 놓치지 않게 해 준다(빠르게 끌면 실제로 놓친다).
 *
 * ── 3D는 「덤」이다 ───────────────────────────────────────────────────
 * 캐릭터 그림은 **항상 2D PNG가 먼저 그려지고**, 실제 WebGL 3D(`GuideBot3D`)는
 * 준비된 뒤에야 그 자리를 넘겨받는다. 세 가지가 이 순서에 걸려 있다:
 *   ⓐ 첫 페인트 — `.mesh`는 266KB다. 정적 import를 하면 메인 번들과 첫 화면이
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

/** 위치 영속 키. 사용자가 옮긴 자리는 새로고침해도 남는다. */
const POS_KEY = 'weathermind.guidebot.pos';

/**
 * 캐릭터 지름(px). 화면 밖 이탈을 막는 계산에 쓴다.
 *
 * ⚠️ **아래 버튼의 `h-32 w-32`(128px)와 반드시 같은 값이어야 한다.** 이 값이
 * 실제보다 작으면 클램프가 캐릭터를 화면 밖으로 내보낸다(오른쪽·아래 가장자리에서
 * 잘린 채 돌아오지 못한다). 2026-08-13에 56 → 128로 키웠다 — 클라이언트가
 * "너무 작다, 적어도 「이어서 풀기」 노드만큼은 돼야 한다"고 했고, 그때 이 상수를
 * 같이 안 옮기면 커진 만큼 그대로 화면 밖으로 나간다.
 */
const SIZE = 128;

/** 여백(px) — 캐릭터가 화면 모서리에 딱 붙어 잘려 보이지 않게 한다. */
const EDGE = 8;

/**
 * 위치를 지금 창 안으로 밀어 넣는다.
 *
 * 저장된 자리가 **다음에 열 때 창 밖일 수 있다** — 큰 모니터에서 오른쪽 끝에 두고
 * 노트북에서 열면 그렇다. 그 경우 캐릭터가 영영 안 보이고 되돌릴 방법도 없다.
 * 그래서 읽을 때마다 클램프한다. (모바일 회전도 같은 경로다.)
 */
function clamp(pos, win) {
  const maxX = Math.max(EDGE, win.innerWidth - SIZE - EDGE);
  const maxY = Math.max(EDGE, win.innerHeight - SIZE - EDGE);
  return {
    x: Math.min(Math.max(pos.x, EDGE), maxX),
    y: Math.min(Math.max(pos.y, EDGE), maxY),
  };
}

function readPos(win) {
  try {
    const raw = win.localStorage?.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 저장값이 손상됐을 때 NaN이 스타일로 흘러가면 캐릭터가 사라진다.
    if (!Number.isFinite(parsed?.x) || !Number.isFinite(parsed?.y)) return null;
    return clamp(parsed, win);
  } catch {
    return null; // 사파리 프라이빗 모드 등 — 위치만 못 외운다, 기능은 산다
  }
}

export default function GuideBot({ pathname = '/', state = {}, speaker = GUIDE_SPEAKER }) {
  const t = useT();
  const [pos, setPos] = useState(null); // null = 아직 CSS 기본 자리(SSR 포함)
  const [open, setOpen] = useState(true);
  const [Bot3D, setBot3D] = useState(null); // 로드된 3D 컴포넌트(없으면 2D만)
  const [live3D, setLive3D] = useState(false); // 3D가 실제로 한 프레임 그렸나
  const [dragging, setDragging] = useState(false); // 끄는 중에는 커서 추종을 끈다
  const dragRef = useRef(null); // { dx, dy } — 잡은 지점과 캐릭터 좌상단의 차이
  const nodeRef = useRef(null);

  // 첫 마운트에 저장된 자리를 읽는다(클라이언트 전용).
  useEffect(() => {
    setPos(readPos(window));
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
    const onResize = () => setPos((p) => (p ? clamp(p, window) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e) => {
    const node = nodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    // 3D의 커서 추종을 끈다 — 끌고 가는 손과 쳐다보는 고개가 싸우지 않게.
    setDragging(true);
    // 커서가 캐릭터를 앞질러도 move/up이 계속 이 노드로 온다.
    node.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 드래그 중에는 텍스트 선택·스크롤이 끼어들지 않게 한다.
    e.preventDefault();
    setPos(clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, window));
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
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

  // 위치가 아직 없으면 CSS 기본 자리(오른쪽 아래)에 둔다 — SSR과 첫 페인트가 같다.
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={style}
      // touch-none이 없으면 모바일에서 드래그가 페이지 스크롤로 먹힌다.
      className="fixed bottom-20 right-4 z-40 flex cursor-grab touch-none select-none items-end gap-2 active:cursor-grabbing sm:bottom-6"
    >
      {open && (
        // 말풍선이 캐릭터 **왼쪽**에 온다 — 캐릭터 기본 자리가 오른쪽 아래라
        // 오른쪽에 두면 화면 밖으로 나간다.
        <div
          data-testid="guide-bot-bubble"
          role="status"
          aria-live="polite"
          // 캐릭터가 56 → 128px가 되면서 말풍선도 함께 키웠다(13rem은 그 옆에서
          // 쪽지처럼 작아 보인다). 꼬리는 캐릭터 세로 중앙에 맞춘다.
          className="relative max-w-[17rem] rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-snug text-sky-900 shadow-lg ring-1 ring-sky-200"
        >
          <span
            aria-hidden="true"
            className="absolute -right-[5px] bottom-8 h-2.5 w-2.5 rotate-45 border-b border-r border-sky-200 bg-sky-50"
          />
          {message}
        </div>
      )}

      <button
        type="button"
        data-testid="guide-bot-toggle"
        onClick={() => setOpen((v) => !v)}
        // 드래그로 옮기고 클릭으로 접는다. 키보드 사용자에게는 접기만 있으면
        // 충분하다 — 위치는 기능이 아니라 편의이고, 기본 자리가 이미 유효하다.
        aria-expanded={open}
        aria-label={t(open ? 'guide.aria.collapse' : 'guide.aria.expand')}
        // 128px — 「이어서 풀기」 노드 정도의 존재감을 요구받았다(2026-08-13).
        // ⚠️ 이 크기를 바꾸면 위 `SIZE` 상수를 **같이** 바꿔야 한다(클램프 계약).
        className="grid h-32 w-32 flex-none place-items-center rounded-full bg-white shadow-lg ring-1 ring-sky-200"
      >
        {/* 2D와 3D가 **같은 정사각 박스**를 공유한다 — 크기·중심이 같아야 교체가
            안 보인다(PNG는 내용 경계로 잘려 있고 3D는 그 박스에 맞춰 그린다). */}
        <span className="relative block h-28 w-28" data-guide-3d={live3D ? '1' : '0'}>
          <Mascot
            name={speaker}
            // 3D가 살아 있는 동안만 숨긴다. 지우지 않는 이유는 컨텍스트 소실 같은
            // 사고가 났을 때 **같은 프레임에** 되돌아와야 하기 때문이다.
            className={`h-28 w-28 ${live3D ? 'invisible' : ''}`}
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
    </div>
  );
}
