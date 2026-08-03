/**
 * support — WebGL2 지원 판정만 담은 최소 모듈 (R10-C / S2).
 *
 * 왜 별도 파일인가: `CrossSectionPanel`은 이 함수 하나 때문에 **GL 코드 전체를
 * 메인 번들로 끌어오면 안 된다**(단면 3D는 `lazy()` 청크로 분리 — 번들 증가 ≈0).
 * 그래서 정적 import 대상은 이 파일뿐이고, 렌더러·셰이더·장면은 동적 청크에 있다.
 *
 * 모듈 최상위에서 document를 만지지 않는다 — 호출은 반드시 useEffect 안에서.
 *
 * ── 탐지용 컨텍스트와 렌더 컨텍스트는 완전히 분리돼 있다 ────────────────────
 * 여기서 만드는 컨텍스트는 **DOM에 붙지 않는 임시 canvas**(`createElement`)의 것이고,
 * 실제 렌더 컨텍스트는 `CrossSectionGL`이 마운트한 canvas ref에서 `glCore.createContext`가
 * 따로 만든다. 두 컨텍스트는 어떤 객체도 공유하지 않으므로 여기의 `loseContext()`가
 * 렌더 컨텍스트를 죽이는 일은 없다(오버레이 mapOverlay/support.js:28과 같은 패턴).
 * **렌더 컨텍스트를 죽이면 안 되는 이유는 renderer.dispose() 주석 참조.**
 *
 * 판정 결과는 1회만 캐시한다 — 패널은 존 판정마다 리마운트되고 StrictMode(dev)에서는
 * 마운트가 2회다. 캐시가 없으면 그때마다 새 WebGL2 컨텍스트를 만들어 브라우저의
 * 라이브 컨텍스트 상한(Chrome ≈16)을 압박하고, 상한을 넘으면 브라우저가 **가장 오래된
 * 컨텍스트를 강제로 잃게** 만든다(= 단면·지도 오버레이 렌더 컨텍스트가 희생될 수 있다).
 */

let supportCache = null;

/**
 * WebGL2 컨텍스트를 만들 수 있는 환경인가 (SSR·미지원 브라우저면 false).
 * SSR(document 없음)에서는 **캐시하지 않고** false — 같은 모듈이 클라이언트에서
 * 다시 평가될 때 false가 굳어버리지 않게(mapOverlay/support.js와 같은 규약).
 */
export function supportsWebGL2() {
  if (supportCache !== null) return supportCache;
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas'); // DOM에 붙지 않는 탐지 전용 캔버스
    const gl = probe.getContext('webgl2');
    supportCache = Boolean(gl);
    // 탐지용 컨텍스트만 즉시 반납한다(렌더 컨텍스트와 무관 — 위 주석 참조).
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supportCache = false;
  }
  return supportCache;
}

/** 테스트·복구용 — 탐지 캐시 초기화 */
export function resetWebGL2SupportCache() {
  supportCache = null;
}
