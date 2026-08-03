/**
 * shaders — 지도 오버레이 GLSL ES 3.00 소스 (R10-01 S3 §3.3).
 *
 * 오버레이 4요소 = 프로그램 4개. 에셋·텍스처 0(노이즈도 셰이더 내부 절차 생성).
 * 좌표 변환(toClip)과 fbm은 glCore.GLSL_COMMON에서 온다 —
 * userSpace(VIEW_W×VIEW_H)를 u_view로 받아 그대로 쓰므로 좌표계 재구현이 없다.
 *
 * **알파 규약**: 모든 프래그먼트는 premultiplied alpha(`vec4(rgb * a, a)`)를 낸다.
 * 캔버스는 기본 `premultipliedAlpha: true`이고 블렌드는 (ONE, ONE_MINUS_SRC_ALPHA).
 * straight alpha를 내면 브라우저 합성 단계에서 알파가 한 번 더 곱해져 색이
 * 배경색 쪽으로 빠진다(실측: 기단 번짐이 주황이 아니라 회백색으로 보였다).
 */
import { GLSL_COMMON } from './glCore';

// ── ① 기단 색 번짐(확산) ────────────────────────────────────────────────────
export const BLOOM_VS = `${GLSL_COMMON}
in vec2 a_pos;
in vec2 a_local;
in vec3 a_color;
in float a_seed;
in float a_peak;
out vec2 v_local;
out vec3 v_color;
out float v_seed;
out float v_peak;
void main() {
  v_local = a_local;
  v_color = a_color;
  v_seed = a_seed;
  v_peak = a_peak;
  gl_Position = vec4(toClip(a_pos), 0.0, 1.0);
}`;

// 방사 감쇠(pow) + fbm으로 경계를 흐트려 "번짐/확산"을 만들고, 아주 느린 맥동을 준다.
export const BLOOM_FS = `${GLSL_COMMON}
in vec2 v_local;
in vec3 v_color;
in float v_seed;
in float v_peak;
out vec4 outColor;
void main() {

  float d = length(v_local);
  float n = fbm(v_local * 2.4 + vec2(u_time * 0.05, -u_time * 0.035) + v_seed);
  float dd = clamp(d + (n - 0.5) * 0.38, 0.0, 1.6);
  float a = pow(max(0.0, 1.0 - dd), 2.2);
  a *= v_peak * (0.9 + 0.1 * sin(u_time * 0.55 + v_seed * 3.0));
  if (a <= 0.002) discard;
  outColor = vec4(v_color * a, a);
}`;

// ── ③ 유동 화살표 흐름장 ────────────────────────────────────────────────────
export const FLOW_VS = `${GLSL_COMMON}
in vec2 a_pos;
in vec2 a_uv;
in vec3 a_color;
out vec2 v_uv;
out vec3 v_color;
void main() {
  v_uv = a_uv;
  v_color = a_color;
  gl_Position = vec4(toClip(a_pos), 0.0, 1.0);
}`;

// v(폭)로 소프트 엣지, u(진행)로 꼬리→머리 그라디언트(SVG FlowArrow 승계),
// fract(u*3.2 - t)로 진행 방향 스트릭이 흐른다 = animate-flow-dash의 GL 대응물.
export const FLOW_FS = `${GLSL_COMMON}
in vec2 v_uv;
in vec3 v_color;
out vec4 outColor;
void main() {
  float across = 1.0 - abs(v_uv.y);
  float body = smoothstep(0.0, 0.42, across);
  float along = mix(0.10, 0.52, v_uv.x);
  float s = fract(v_uv.x * 3.2 - u_time * 0.42);
  float streak = smoothstep(0.52, 0.80, s) * (1.0 - smoothstep(0.80, 1.0, s));
  vec3 col = mix(v_color, vec3(1.0), streak * 0.7);
  float a = body * along * (0.78 + 0.5 * streak);
  if (a <= 0.002) discard;
  outColor = vec4(col * a, a);
}`;

// ── ④ 터뷸런스 구름 ─────────────────────────────────────────────────────────
export const CLOUD_VS = `${GLSL_COMMON}
in vec2 a_pos;
in vec2 a_local;
in vec3 a_shape;
in float a_seed;
out vec2 v_local;
out vec3 v_shape;
out float v_seed;
void main() {
  v_local = a_local;
  v_shape = a_shape;
  v_seed = a_seed;
  gl_Position = vec4(toClip(a_pos), 0.0, 1.0);
}`;

// fbm 밀도 × 타원 감쇠. billow=부풀기 맥동, nc의 시간항=표류(SVG cloud-drift 대응).
// tall(수직 발달)이 크면 위쪽 밀도가 살아남고 하부가 어두워진다(적란운 ↔ 층운·안개).
export const CLOUD_FS = `${GLSL_COMMON}
in vec2 v_local;
in vec3 v_shape;   // (bright, tall, alpha)
in float v_seed;
out vec4 outColor;
void main() {
  float bright = v_shape.x;
  float tall = v_shape.y;
  float peak = v_shape.z;

  float billow = 1.0 + 0.05 * sin(u_time * 0.5 + v_seed * 2.0);
  vec2 q = v_local / billow;
  vec2 nc = q * 1.7 + vec2(u_time * 0.045 + v_seed * 9.0, -u_time * 0.018);
  float n = fbm(nc);
  float n2 = fbm(nc * 2.7 + 4.0);

  float yBias = q.y + tall * 0.22;
  float d = length(vec2(q.x, yBias * mix(1.35, 0.85, tall)));
  float edge = 1.0 - smoothstep(0.30, 1.0, d + (n - 0.5) * 0.8);
  float dens = clamp(edge * (0.5 + 0.7 * n), 0.0, 1.0);

  float shade = mix(1.0, mix(0.95, 0.42, tall), clamp(q.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 col = vec3(bright * shade + 0.05 * n2);
  float a = dens * peak;
  if (a <= 0.003) discard;
  outColor = vec4(col * a, a);
}`;

// ── ⑤ 강수 ──────────────────────────────────────────────────────────────────
export const PRECIP_VS = `${GLSL_COMMON}
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_color;
in float a_round;
out vec2 v_uv;
out vec4 v_color;
out float v_round;
void main() {
  v_uv = a_uv;
  v_color = a_color;
  v_round = a_round;
  gl_Position = vec4(toClip(a_pos), 0.0, 1.0);
}`;

// a_round=0 → 비 줄기(폭 방향 소프트 엣지) / 1 → 눈송이(원형 마스크). 드로우콜 1개로 합친다.
export const PRECIP_FS = `${GLSL_COMMON}
in vec2 v_uv;
in vec4 v_color;
in float v_round;
out vec4 outColor;
void main() {
  float lin = smoothstep(0.0, 0.6, 1.0 - abs(v_uv.y));
  float rnd = 1.0 - smoothstep(0.35, 1.0, length(v_uv));
  float a = v_color.a * mix(lin, rnd, v_round);
  if (a <= 0.004) discard;
  outColor = vec4(v_color.rgb * a, a);
}`;
