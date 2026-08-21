/**
 * WebGL 컨텍스트 예산 — 이 갤러리의 유일한 비자명한 장치.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 이 페이지는 보드 단면 20종을 **단계마다 한 칸씩** 펼치므로 GL 칸이 70칸을 넘는다.
 * 브라우저의 동시 WebGL 컨텍스트 상한은 대략 8~16개다(크롬 기준). 그 위로 넘기면
 * 브라우저는 오래된 컨텍스트를 **말없이 회수**하고, 회수된 칸은 검거나 하얗게 남는다.
 * 🔴 **빈 칸은 「그림이 없다」로 읽힌다** — 이 페이지의 목적이 판정이므로 그 오독은
 * 페이지 자체를 무의미하게 만든다.
 *
 * ── 왜 CrossSectionGL의 IntersectionObserver로는 부족한가 ────────────────────
 * `CrossSectionGL`도 IO를 갖고 있지만 그것이 하는 일은 **rAF 정지**뿐이다
 * (그 파일 머리 주석이 그렇게 밝힌다). 컨텍스트는 마운트되어 있는 한 살아 있다.
 * 즉 스크롤로 지나간 칸이 그리기를 멈춰도 **예산은 계속 먹는다.** 그래서 갤러리가
 * 마운트·언마운트 자체를 소유해야 한다.
 *
 * ── 무엇을 하는가 ────────────────────────────────────────────────────────────
 * 두 겹이다.
 *  ⑴ **뷰포트 근방에서만 마운트한다** — 각 칸이 자기 IO(rootMargin 320px)로 진입/이탈을
 *     알리고, 이탈하면 컴포넌트를 통째로 언마운트해 컨텍스트를 반납한다.
 *  ⑵ **그래도 동시 상한을 건다**(CAP). 넓은 화면·빠른 스크롤에서는 ⑴만으로 근방
 *     칸이 상한을 넘을 수 있다. 요청 순서대로 CAP개까지만 허가하고, 못 받은 칸은
 *     **자리를 비우는 대신 「컨텍스트 대기」라고 화면에 적는다**(빈 칸 오독 방지).
 *
 * CAP은 크롬의 실효 상한(≈16)보다 낮게 잡는다 — 이 페이지에는 GL을 쓰는 다른 것
 * (`PeninsulaMap`의 지도 오버레이)도 있고, 브라우저의 다른 탭과도 예산을 나눈다.
 */

/** 동시 허가 상한. 크롬 실효 상한(≈16)에서 지도 오버레이·여유분을 뺀 값. */
export const GL_CAP = 10;

const listeners = new Map(); // id → (granted: boolean) => void
const wanted = []; // 허가를 원하는 id — **요청 순서**(= 대체로 문서 순서)
const granted = new Set();

function pump() {
  // 원치 않게 된 것부터 회수한다 — 회수가 먼저여야 그 자리를 다음 대기자가 받는다
  for (const id of [...granted]) {
    if (!wanted.includes(id)) {
      granted.delete(id);
      listeners.get(id)?.(false);
    }
  }
  for (const id of wanted) {
    if (granted.size >= GL_CAP) break;
    if (granted.has(id)) continue;
    granted.add(id);
    listeners.get(id)?.(true);
  }
}

/** 이 칸이 화면 근방에 들어왔다 — 허가를 요청한다. */
export function acquire(id, onChange) {
  listeners.set(id, onChange);
  if (!wanted.includes(id)) wanted.push(id);
  pump();
}

/** 이 칸이 화면 밖으로 나갔다 — 컨텍스트를 반납한다. */
export function release(id) {
  const i = wanted.indexOf(id);
  if (i >= 0) wanted.splice(i, 1);
  pump();
}

/** 언마운트 — 요청도 리스너도 지운다. */
export function unregister(id) {
  release(id);
  listeners.delete(id);
}

/** 현재 살아 있는 컨텍스트 수 — 페이지 상단 계기판이 읽는다. */
export function liveCount() {
  return granted.size;
}

/** 근방에 있으나 상한에 걸려 대기 중인 칸 수. */
export function waitingCount() {
  return Math.max(0, wanted.length - granted.size);
}

let seq = 0;
export const nextId = () => `glcell-${++seq}`;
