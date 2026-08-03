/**
 * support — 지도 오버레이의 WebGL2 지원 판정만 담은 최소 모듈 (R10-01 S3 §3.3).
 *
 * 왜 별도 파일인가: `PeninsulaMap`은 이 함수 하나 때문에 **GL 코드 전체를 메인
 * 번들로 끌어오면 안 된다**. 오버레이는 폴백(SVG + Canvas2D)이 있는 향상 계층이라
 * 초기 렌더에 필수가 아니다 → 렌더러·셰이더·지오메트리는 동적 청크로 분리하고,
 * 정적 import 대상은 이 파일과 순수 장면 빌더(overlayScene)뿐이다.
 * (같은 이유로 FE-1의 `webgl/crossSection/support.js`가 존재한다 — 구조 선례.)
 *
 * 모듈 최상위에서 document를 만지지 않는다 — 호출은 렌더/이펙트 안에서.
 */

let supportCache = null;

/**
 * WebGL2 컨텍스트를 만들 수 있는 환경인지 1회만 탐지하고 캐시한다.
 * 탐지용 컨텍스트는 즉시 loseContext로 반납한다(컨텍스트 1개 예산 유지).
 * SSR(document 없음)에서는 **캐시하지 않고** false — 같은 모듈이 클라이언트에서
 * 다시 평가될 때 false가 굳어버리지 않게.
 */
export function webglSupported() {
  if (supportCache !== null) return supportCache;
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    supportCache = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supportCache = false;
  }
  return supportCache;
}

/** 테스트·복구용 — 탐지 캐시 초기화 */
export function resetWebglSupportCache() {
  supportCache = null;
}
