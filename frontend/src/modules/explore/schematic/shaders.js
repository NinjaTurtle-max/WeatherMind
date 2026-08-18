/**
 * shaders — 모식도 GLSL ES 3.0 (MT-22). 프로그램 2종 — arrow(입체) / line(보조선).
 *
 * 텍스처·외부 에셋 0. 난수도 0 — 이 모식도에는 절차 질감이 필요 없다(화살표는
 * **형태**로 읽혀야지 얼룩으로 읽히면 안 된다). 그래서 `Math.random`은 물론
 * 해시 노이즈도 쓰지 않는다: 같은 장면·같은 시각이면 픽셀까지 같은 그림이다.
 */

// ── 1) 입체 화살표 ────────────────────────────────────────────────────────────
// 🔴 이 셰이더의 핵심은 **정규직교 기저 세 개**다. 기존 2D 화살표 셰이더
// (`crossSection/shaders.js:ARROW_VS`)는 `d`와 `side` 둘만 만들어 평면 실루엣을
// 눕혔다 — 3D 메시는 굵기축이 두 개라 그것으로는 세울 수 없다.
//   d    진행축(장면이 준 방향, CPU에서 정규화)
//   side 굵기축 1 (CPU가 특이점을 해소해 넘긴다 — arrowMesh.arrowBasis 참조)
//   up   굵기축 2 = cross(side, d)
// `side`와 `d`가 이미 **직교 단위**라 이 cross는 절대 0이 되지 않는다. 특이점
// (방향이 월드 상방과 평행)은 CPU에서 이미 끝났고, 여기 남은 것은 안전한 한 번의
// 외적뿐이다. 이 분리가 없으면 **수직 화살표가 사라진다** — 복사수지(C1)는 수직이
// 주역이라 반드시 그 분기를 밟는다.
export const ARROW_VS = /* glsl */ `#version 300 es
in vec3 aPos;        // 로컬: y = 진행축 0~1, x·z = 굵기축
in vec3 aNormal;
in vec3 iOrigin;
in vec3 iDir;        // 단위
in vec3 iSide;       // 단위, iDir과 직교
in vec2 iSpan;       // x = 길이, y = 굵기
in vec4 iColor;
in vec3 iAnim;       // x = 흐름 이동거리, y = 위상, z = 속도(회전/초)
uniform mat4 uVP;
uniform vec3 uEye;
uniform float uTime;
out vec3 vNormal;
out vec3 vView;
out vec4 vColor;
void main() {
  vec3 d = iDir;
  vec3 s = iSide;
  vec3 u = cross(s, d);
  float flow = step(0.0001, iAnim.x);
  float p = flow * fract(iAnim.y + uTime * iAnim.z);
  vec3 base = iOrigin + d * (p * iAnim.x);
  vec3 world = base + d * (aPos.y * iSpan.x) + (s * aPos.x + u * aPos.z) * iSpan.y;
  // 비균등 스케일(길이≠굵기)이라 법선은 역전치로 옮긴다 — 안 그러면 가늘고 긴
  // 화살표의 뿔 옆면이 실제보다 눕게 비쳐 조명이 뭉갠다.
  vNormal = normalize(s * (aNormal.x * iSpan.x) + d * (aNormal.y * iSpan.y) + u * (aNormal.z * iSpan.x));
  vView = normalize(uEye - world);
  float fade = mix(1.0, smoothstep(0.0, 0.14, p) * smoothstep(1.0, 0.74, p), flow);
  vColor = vec4(iColor.rgb, iColor.a * fade);
  gl_Position = uVP * vec4(world, 1.0);
}`;

// 조명 — **단색이면 입체가 입체로 안 읽힌다.** 램버트(키라이트)에 반대편 채움광과
// 시선 기준 림을 얹는다. 림을 시선 기준으로 잡는 이유는 원근 투영이라 화면
// 가장자리일수록 시선이 기울고, 그 경계가 밝아야 원통이 둥글게 보이기 때문이다
// (guideBotMesh.js:201-226과 같은 판단·같은 상수 감각).
export const ARROW_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vView;
in vec4 vColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  const vec3 L = vec3(-0.3592, 0.5644, 0.7423);   // 키라이트
  const vec3 F = vec3(0.6247, -0.1561, -0.7649);  // 채움광 — 반대 아래쪽
  float lam = clamp(dot(n, L), 0.0, 1.0);
  float fill = clamp(dot(n, F), 0.0, 1.0);
  float rim = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.4);
  float spec = pow(clamp(dot(reflect(-L, n), v), 0.0, 1.0), 22.0);
  float shade = 0.30 + 0.80 * lam + 0.13 * fill;
  vec3 c = vColor.rgb * shade + vec3(0.32) * rim * 0.38 + vec3(0.16) * spec;
  float a = vColor.a;
  if (a < 0.004) discard;
  // 프리멀티플라이드 알파(컨텍스트 규약과 일치)
  outColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)) * a, a);
}`;

// ── 2) 보조선 ────────────────────────────────────────────────────────────────
// 화살표만으로는 「어디를 흐르는가」가 안 잡힌다(T1 눈벽 윤곽 · T2 진로 · C1 층 경계).
// 색을 정점에 실어 폴리라인 전부를 **드로우콜 1번**에 묶는다.
export const LINE_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec4 aColor;
uniform mat4 uVP;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

export const LINE_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;
