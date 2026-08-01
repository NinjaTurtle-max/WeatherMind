/**
 * support — WebGL2 지원 판정만 담은 최소 모듈 (R10-C / S2).
 *
 * 왜 별도 파일인가: `CrossSectionPanel`은 이 함수 하나 때문에 **GL 코드 전체를
 * 메인 번들로 끌어오면 안 된다**(단면 3D는 `lazy()` 청크로 분리 — 번들 증가 ≈0).
 * 그래서 정적 import 대상은 이 파일뿐이고, 렌더러·셰이더·장면은 동적 청크에 있다.
 *
 * 모듈 최상위에서 document를 만지지 않는다 — 호출은 반드시 useEffect 안에서.
 */

/** WebGL2 컨텍스트를 만들 수 있는 환경인가 (SSR·미지원 브라우저면 false) */
export function supportsWebGL2() {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
