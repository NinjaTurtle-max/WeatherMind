/**
 * shaders — 단면 모식도 GLSL ES 3.0 소스 (R10-C / S2).
 *
 * 외부 에셋 0: 텍스처를 쓰지 않고 구름 질감·햇살·지면 해칭·바다 잔물결을 전부
 * 프래그먼트 셰이더의 해시 노이즈(value noise + fbm)로 절차 생성한다.
 * 프로그램 6종 — sky / solid / line / billboard / arrow / precip.
 */

const NOISE = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
`;

// ── 1) 하늘 배경 (전체 화면 그라디언트 + 밤이면 별) ──────────────────────────
export const SKY_VS = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.999, 1.0);
}`;

export const SKY_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUV;
uniform vec4 uTop;
uniform vec4 uBottom;
uniform float uNight;
out vec4 outColor;
${NOISE}
void main() {
  vec3 c = mix(uBottom.rgb, uTop.rgb, pow(vUV.y, 0.85));
  if (uNight > 0.5) {
    float s = hash21(floor(vUV * 220.0));
    c += vec3(step(0.9975, s)) * (0.6 + 0.4 * vUV.y);
  }
  outColor = vec4(c, 1.0);
}`;

// ── 2) 솔리드 볼륨 (기단·전선 슬랩·지표·바다·토양) — 인스턴싱 단위 큐브 ─────
export const SOLID_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 iCenter;
in vec3 iSize;
in vec2 iTaper;
in vec2 iShear;
in vec4 iColor;
in vec2 iMode;   // x = 패턴 종류, y = 성장(0~1)
uniform mat4 uVP;
out vec4 vColor;
out vec3 vLocal;
out float vPattern;
void main() {
  float grow = clamp(iMode.y, 0.004, 1.0);
  float t = (aPos.y + 0.5) * grow;            // 0=바닥, grow=위
  vec3 local = vec3(aPos.x * mix(1.0, iTaper.x, t), t - 0.5, aPos.z * mix(1.0, iTaper.y, t));
  vec3 world = local * iSize;
  world.xz += iShear * t;
  world += iCenter;
  gl_Position = uVP * vec4(world, 1.0);
  float lambert = 0.66 + 0.34 * max(dot(normalize(aNormal), normalize(vec3(0.38, 0.86, 0.34))), 0.0);
  vColor = vec4(iColor.rgb * lambert, iColor.a);
  vLocal = vec3(aPos.x + 0.5, t, aPos.z + 0.5);
  vPattern = iMode.x;
}`;

export const SOLID_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec4 vColor;
in vec3 vLocal;
in float vPattern;
uniform float uTime;
out vec4 outColor;
${NOISE}
void main() {
  vec4 c = vColor;
  if (vPattern > 0.5 && vPattern < 1.5) {
    // 전선면 — 경사 슬랩 위를 타고 오르는 띠(활승 방향 가시화)
    float band = sin((vLocal.y * 22.0) - uTime * 2.2);
    c.rgb += vec3(0.10) * smoothstep(0.55, 1.0, band);
    c.a *= 0.72 + 0.28 * smoothstep(-0.4, 0.9, band);
  } else if (vPattern > 1.5 && vPattern < 2.5) {
    // 토양 앞단면 — 교과서 사선 해칭
    float h = fract((vLocal.x * 26.0) + (1.0 - vLocal.y) * 9.0);
    c.rgb *= 1.0 - 0.22 * smoothstep(0.86, 1.0, h);
  } else if (vPattern > 2.5 && vPattern < 3.5) {
    // 바다 — 느린 잔물결 밴드
    float w = vnoise(vec2(vLocal.x * 16.0 + uTime * 0.35, vLocal.z * 9.0));
    c.rgb += vec3(0.05, 0.07, 0.08) * smoothstep(0.55, 1.0, w);
  } else if (vPattern > 3.5) {
    // 지표 — 미세 반점(식생 질감)
    c.rgb *= 0.94 + 0.10 * fbm(vec2(vLocal.x, vLocal.z) * 26.0);
  }
  outColor = vec4(c.rgb * c.a, c.a);
}`;

// ── 3) 라인 (지표 격자 · 유리 상자 모서리) ──────────────────────────────────
export const LINE_VS = /* glsl */ `#version 300 es
in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;

export const LINE_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

// ── 4) 빌보드 (구름 볼륨 노이즈 · 색 번짐 · 햇빛 · 안개층 · 번개) ───────────
export const BILLBOARD_VS = /* glsl */ `#version 300 es
in vec2 aCorner;      // [-0.5,0.5]^2
in vec3 iCenter;
in vec2 iSize;
in vec4 iColor;
in vec3 iMode;        // x = kind, y = seed, z = grow
uniform mat4 uVP;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUV;
out vec4 vColor;
out float vKind;
out float vSeed;
void main() {
  float kind = iMode.x;
  bool flat_ = kind > 2.5 && kind < 3.5;                 // 지표에 눕는 판(열·안개)
  vec3 r = flat_ ? vec3(1.0, 0.0, 0.0) : uRight;
  vec3 u = flat_ ? vec3(0.0, 0.0, 1.0) : uUp;
  float g = mix(0.3, 1.0, clamp(iMode.z, 0.0, 1.0));
  vec3 w = iCenter + r * (aCorner.x * iSize.x * g) + u * (aCorner.y * iSize.y * g);
  gl_Position = uVP * vec4(w, 1.0);
  vUV = aCorner;
  vColor = vec4(iColor.rgb, iColor.a * mix(0.25, 1.0, clamp(iMode.z, 0.0, 1.0)));
  vKind = kind;
  vSeed = iMode.y;
}`;

export const BILLBOARD_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
in float vKind;
in float vSeed;
uniform float uTime;
out vec4 outColor;
${NOISE}
void main() {
  float r = length(vUV * vec2(1.0, 1.0)) * 2.0;   // 0(중심)~1(테두리)
  vec4 c = vColor;
  float a = 0.0;
  if (vKind < 0.5) {
    // 0: 기단 색 번짐(방사형)
    a = pow(smoothstep(1.0, 0.0, r), 1.7);
  } else if (vKind < 1.5) {
    // 1: 구름 볼륨 — fbm 노이즈로 퍼프 윤곽·명암(윤곽이 뭉게구름으로 읽히게 조임)
    vec2 q = vUV * 2.6 + vec2(vSeed * 11.7, vSeed * 5.1 - uTime * 0.045);
    float n = fbm(q);
    a = smoothstep(0.96, 0.54, r + (n - 0.5) * 0.34);
    float shade = 0.60 + 0.40 * fbm(q * 1.9 + 3.1);
    c.rgb *= mix(0.70, 1.04, shade);
    c.rgb += vec3(0.07) * smoothstep(0.0, -0.35, vUV.y); // 상부 하이라이트
  } else if (vKind < 2.5) {
    // 2: 태양 — 원반 + **부드러운 빛무리**(2026-08-18 사용자 지시
    //    "이 해 모양을 더 부드럽게").
    //    종전에는 햇살 계수가 0~1 전폭으로 흔들려 **골에서 알파가 0**이 됐다 —
    //    살 사이가 완전히 비어 톱니바퀴처럼 뾰족했다. 셋을 바꾼다:
    //      · 빛무리를 **각도와 무관한 항**으로 세운다(halo) — 어디서도 0이
    //        되지 않아 살 사이가 이어진다
    //      · 각도 항은 0.86~1.00배의 **아주 옅은 물결**로만 남긴다(정지 화면이
    //        아니라 도는 빛이라는 인상은 유지하되 윤곽을 만들지 않는다)
    //      · 합이 아니라 **max()**다. 더하면 중심부 알파가 1을 넘어 **넓은
    //        (⚠️ 이 파일의 주석은 JS 템플릿 리터럴 **안**이다 — 백틱을 쓰면
    //        문자열이 거기서 끊겨 모듈 전체가 SyntaxError가 된다. 실제로 그렇게
    //        적었다가 단면 패널이 통째로 안 뜨었다.)
    //        구간이 통째로 불투명해지고**, 그 경계선을 각도 항이 그려 「꽃잎」
    //        모양이 된다 — 실제로 합으로 먼저 고쳤다가 그 꼴이 나와 되돌렸다.
    //        max는 중심 1에서 단조 감소라 경계선 자체가 생기지 않는다.
    float ang = atan(vUV.y, vUV.x);
    float wave = 0.86 + 0.14 * sin(ang * 10.0 + uTime * 0.5);
    float disc = smoothstep(0.50, 0.28, r);
    float halo = pow(smoothstep(1.0, 0.16, r), 2.4);
    a = max(disc, halo * 0.62 * wave);
  } else if (vKind < 3.5) {
    // 3: 지표에 눕는 판 — 열 번짐·안개층
    a = pow(smoothstep(1.0, 0.05, r), 1.35);
    a *= 0.82 + 0.18 * fbm(vUV * 5.0 + uTime * 0.12);
  } else {
    // 4: 번개 섬광 — 짧고 불규칙하게 번쩍
    float flick = step(0.86, hash21(vec2(floor(uTime * 3.4), vSeed)));
    a = pow(smoothstep(1.0, 0.0, r), 2.2) * flick;
  }
  a *= c.a;
  if (a < 0.004) discard;
  outColor = vec4(c.rgb * a, a);
}`;

// ── 5) 화살표 (상승·하강·수평 기류 벡터 필드) ───────────────────────────────
export const ARROW_VS = /* glsl */ `#version 300 es
in vec2 aShape;      // x = 좌우, y = 진행 방향
in vec3 iOrigin;
in vec3 iDir;
in vec2 iSpan;       // x = 이동 거리, y = 화살표 크기
in vec4 iColor;
in vec2 iAnim;       // x = 위상, y = 속도
uniform mat4 uVP;
uniform vec3 uForward;
uniform float uTime;
out vec4 vColor;
void main() {
  vec3 d = normalize(iDir);
  vec3 ref = abs(dot(d, uForward)) > 0.97 ? vec3(0.0, 1.0, 0.0) : uForward;
  vec3 side = normalize(cross(d, ref));
  float p = fract(iAnim.x + uTime * iAnim.y);
  vec3 base = iOrigin + d * (p * iSpan.x);
  vec3 w = base + d * (aShape.y * iSpan.y) + side * (aShape.x * iSpan.y);
  gl_Position = uVP * vec4(w, 1.0);
  float fade = smoothstep(0.0, 0.16, p) * smoothstep(1.0, 0.70, p);
  vColor = vec4(iColor.rgb, iColor.a * fade);
}`;

export const ARROW_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

// ── 6) 강수 파티클 (인스턴싱 — 비 줄기 / 눈송이) ────────────────────────────
export const PRECIP_VS = /* glsl */ `#version 300 es
in vec2 aCorner;     // x = 폭(-0.5~0.5), y = 길이(0~1, 위로)
in vec3 iOrigin;     // 에미터 박스 최소 코너
in vec3 iSize;       // 에미터 박스 크기
in vec4 iMode;       // x = seed, y = kind(0 비/1 눈), z = 기울기, w = 낙하 속도
uniform mat4 uVP;
uniform vec3 uRight;
uniform vec3 uForward;
uniform float uTime;
out vec2 vUV;
out float vKind;
out float vAlpha;
float h11(float n) { return fract(sin(n * 78.233) * 43758.5453); }
void main() {
  float seed = iMode.x;
  float kind = iMode.y;
  float phase = fract(seed * 0.37 + uTime * iMode.w);
  float drop = 1.0 - phase;                       // 1(상단) → 0(지표)
  float sway = kind > 0.5 ? sin(uTime * 1.6 + seed * 6.283) * 0.013 : 0.0;
  vec3 c = vec3(
    iOrigin.x + iSize.x * h11(seed) - iMode.z * iSize.y * drop + sway,
    iOrigin.y + iSize.y * drop,
    iOrigin.z + iSize.z * h11(seed + 3.7)
  );
  vec3 fall = normalize(vec3(-iMode.z, -1.0, 0.0));
  vec3 axis = -fall;
  vec3 side = normalize(cross(axis, uForward));
  float len = kind > 0.5 ? 0.0075 : 0.030;
  float wid = kind > 0.5 ? 0.0075 : 0.0026;
  vec3 w = c + side * (aCorner.x * wid) + axis * (aCorner.y * len);
  gl_Position = uVP * vec4(w, 1.0);
  vUV = aCorner;
  vKind = kind;
  vAlpha = smoothstep(0.0, 0.07, phase) * smoothstep(1.0, 0.90, phase);
}`;

export const PRECIP_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUV;
in float vKind;
in float vAlpha;
out vec4 outColor;
void main() {
  float a;
  vec3 c;
  if (vKind > 0.5) {
    float r = length(vUV * vec2(1.0, 1.0)) * 2.0;
    a = smoothstep(1.0, 0.15, r) * 0.95;
    c = vec3(0.97, 0.99, 1.0);
  } else {
    a = (1.0 - smoothstep(0.22, 0.5, abs(vUV.x))) * mix(0.45, 1.0, vUV.y);
    c = vec3(0.33, 0.66, 0.90);
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  outColor = vec4(c * a, a);
}`;
