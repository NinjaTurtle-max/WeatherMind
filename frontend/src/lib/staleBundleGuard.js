/**
 * staleBundleGuard (R8-01 버그픽스 B②) — 스테일 번들 자가 복구.
 *
 * 배포 후 브라우저가 캐시한 옛 index.html이 옛 JS 자산을 참조해 구버전 앱이
 * 뜨는 문제(배치고사 미진입 재발 원인)의 런타임 방어막. 앱 시작 시 1회
 * `fetch('/', {cache:'no-store'})`로 서버의 현재 문서를 받아 자산 해시
 * (assets/index-*.js)를 추출하고, 지금 실행 중인 번들 이름과 비교한다.
 *  - 다르면 sessionStorage 가드를 세우고 location.reload() 1회 (가드가 루프 방지)
 *  - 같으면 가드를 해제(다음 배포에서 다시 복구 가능하도록)
 *  - fetch 실패·HTML 파싱 불가·스크립트 미발견 등은 전부 조용히 무시
 *
 * dev 서버(vite)에서는 비활성 — 호출부(main.jsx)가 import.meta.env.DEV로 차단
 * (자산이 /src/main.jsx라 해시 자체가 없음). 순수 함수부는 node 단위 검증 가능.
 */

const GUARD_KEY = 'wm-stale-bundle-reloaded';
// vite 기본 산출물 패턴: /assets/index-<hash>.js (해시는 영숫자·-·_)
const BUNDLE_RE = /assets\/(index-[\w-]+)\.js/;

/** HTML 문자열(또는 URL 문자열)에서 엔트리 번들 이름(index-<hash>)을 추출. 없으면 null. */
export function extractBundleName(text) {
  const m = BUNDLE_RE.exec(String(text ?? ''));
  return m ? m[1] : null;
}

/** 현재 문서가 실행 중인 엔트리 번들 이름. 스크립트 태그에서 못 찾으면 null. */
export function currentBundleName(doc) {
  for (const script of doc?.querySelectorAll?.('script[src]') ?? []) {
    const name = extractBundleName(script.getAttribute('src'));
    if (name) return name;
  }
  return null;
}

/**
 * 순수 판정: 서버 문서와 런타임 번들을 비교해 다음 행동을 결정한다.
 * @returns 'reload' | 'match' | 'skip'
 *  - 번들 이름을 못 구하면(파싱 불가·dev 문서 등) 'skip' — 조용히 무시
 *  - 일치하면 'match' — 가드 해제(리로드 후 복구 확인 + 다음 배포 재무장)
 *  - 불일치인데 guarded=true(직전에 이미 리로드함)면 'skip' — 루프 방지
 */
export function decideStaleAction({ guarded, currentName, serverHtml }) {
  if (!currentName) return 'skip';
  const serverName = extractBundleName(serverHtml);
  if (!serverName) return 'skip';
  if (serverName === currentName) return 'match';
  return guarded ? 'skip' : 'reload';
}

/**
 * 가드 실행(앱 시작 시 1회). 브라우저 의존성은 전부 주입 가능(단위 검증용).
 * 어떤 실패도 앱을 방해하지 않는다 — 항상 조용히 종료.
 */
export async function runStaleBundleGuard({
  fetchFn = (...args) => fetch(...args),
  doc = typeof document !== 'undefined' ? document : null,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  reload = () => window.location.reload(),
} = {}) {
  try {
    if (!doc || !storage) return 'skip';
    const guarded = storage.getItem(GUARD_KEY) === '1';
    const currentName = currentBundleName(doc);
    if (!currentName) return 'skip';
    const res = await fetchFn('/', { cache: 'no-store' });
    if (!res?.ok) return 'skip';
    const serverHtml = await res.text();
    const action = decideStaleAction({ guarded, currentName, serverHtml });
    if (action === 'reload') {
      storage.setItem(GUARD_KEY, '1'); // reload 전에 세워 루프 차단
      reload();
    } else if (action === 'match') {
      storage.removeItem(GUARD_KEY); // 복구 완료/정상 — 다음 배포를 위해 해제
    }
    return action;
  } catch {
    return 'skip'; // 네트워크·파싱 등 어떤 실패도 조용히 무시
  }
}
