/**
 * guideBotMesh — 안내봇 3D의 파서 + raw WebGL2 렌더러 (MT-26).
 *
 * 외부 라이브러리 0. three.js를 쓰지 않는 이유는 이 저장소가 i18n 60KB 때문에
 * 자체 구현을 택한 곳이기 때문이고, **쓸 이유도 없다** — 원본 모델에 텍스처·
 * 애니메이션·스킨이 전부 0이고 재질이 단색 4종뿐이라 glTF 파서가 할 일이 없다.
 * 노드 트리 접기·재질 병합·양자화는 전부 빌드타임(`scripts/bake_mascot_glb.py`)에
 * 끝나 있고, 여기는 **바이트를 그대로 GPU에 올려 드로우콜 4번**을 부를 뿐이다.
 *
 * ── SSR 계약 ────────────────────────────────────────────────────────────────
 * 모듈 최상위에서 window·document·fetch를 만지지 않는다. 파서는 순수 함수라
 * node에서도 돌고(스모크가 실제로 그렇게 문다), GL 코드는 호출될 때만 canvas를
 * 만진다. `crossSection/glCore.js`와 같은 규약이다.
 *
 * ── 왜 glCore를 재사용하지 않나 ─────────────────────────────────────────────
 * `crossSection/glCore.js`가 담당자 전용 보유 헬퍼임을 스스로 밝히고 있고
 * (*"공용 모듈 신설 시 두 사람이 같은 파일을 만들게 되므로 소량 중복을 의도적으로
 * 허용"*), 여기서 필요한 것은 컨텍스트 생성·셰이더 컴파일 두 가지뿐이다. 그 규약을
 * 그대로 따라 소량 중복을 택한다 — 남의 소유 파일을 이 기능이 붙잡지 않는다.
 */

/** 베이킹 산출물 경로. `scripts/bake_mascot_glb.py`의 출력과 짝이다. */
export const MESH_URL = '/guidebot.mesh';

const MAGIC = 0x48534d57; // 'WMSH' little-endian
export const MESH_VERSION = 1;
/** 정점 스트라이드(B): pos int16×3(6) + normal int8×3(3) + 패딩 1 */
export const VERTEX_STRIDE = 10;
const HEADER_BYTES = 52;
const GROUP_BYTES = 20;

/**
 * `.mesh` 바이트 → 렌더에 필요한 서술 + 원본 뷰. **순수 함수**(DOM·네트워크 없음).
 *
 * 형식이 어긋나면 조용히 이상하게 그리지 말고 던진다 — 호출측이 2D로 폴백한다.
 */
export function parseBotMesh(buffer) {
  // ArrayBuffer도 뷰(Uint8Array·node Buffer)도 받는다. **node Buffer는 풀에서
  // 잘라 쓰기 때문에 `.buffer`의 시작이 데이터의 시작이 아니다** — byteOffset을
  // 무시하면 테스트에서만 엉뚱한 바이트를 읽는다. 그래서 뷰의 구간을 그대로 쓴다.
  const base = buffer instanceof ArrayBuffer ? buffer : buffer?.buffer;
  const start = buffer instanceof ArrayBuffer ? 0 : (buffer?.byteOffset ?? 0);
  const length = buffer instanceof ArrayBuffer ? buffer.byteLength : (buffer?.byteLength ?? 0);
  if (!base || length < HEADER_BYTES) throw new Error('guidebot.mesh: 너무 짧다');
  const dv = new DataView(base, start, length);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('guidebot.mesh: 매직이 다르다');
  const version = dv.getUint16(4, true);
  if (version !== MESH_VERSION) throw new Error(`guidebot.mesh: 버전 ${version} (기대 ${MESH_VERSION})`);

  const groupCount = dv.getUint16(6, true);
  const vertexCount = dv.getUint32(8, true);
  const indexCount = dv.getUint32(12, true);
  const offset = [dv.getFloat32(16, true), dv.getFloat32(20, true), dv.getFloat32(24, true)];
  const scale = [dv.getFloat32(28, true), dv.getFloat32(32, true), dv.getFloat32(36, true)];
  const size = [dv.getFloat32(40, true), dv.getFloat32(44, true), dv.getFloat32(48, true)];

  const groups = [];
  for (let i = 0; i < groupCount; i += 1) {
    const p = HEADER_BYTES + i * GROUP_BYTES;
    groups.push({
      color: [dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true)],
      indexOffset: dv.getUint32(p + 12, true),
      indexCount: dv.getUint32(p + 16, true),
    });
  }

  const vStart = HEADER_BYTES + groupCount * GROUP_BYTES;
  const iStart = vStart + vertexCount * VERTEX_STRIDE;
  const need = iStart + indexCount * 2;
  if (length < need) {
    throw new Error(`guidebot.mesh: 잘렸다 (${length} < ${need})`);
  }
  // uint16 인덱스라 정점은 65,536개를 못 넘는다. 넘으면 인덱스가 감겨 엉뚱한 정점을
  // 가리키므로 **그리기 전에** 죽인다(빌드에서도 같은 상한을 못박아 둔다).
  if (vertexCount > 65536) throw new Error('guidebot.mesh: 정점이 uint16 상한을 넘는다');

  return {
    version,
    vertexCount,
    indexCount,
    offset,
    scale,
    size,
    groups,
    // 정렬 문제를 원천 차단하려고 8비트 뷰로 넘긴다 — bufferData는 어떤
    // ArrayBufferView든 받고, 성분 해석은 vertexAttribPointer가 한다.
    vertexBytes: new Uint8Array(base, start + vStart, vertexCount * VERTEX_STRIDE),
    indexBytes: new Uint8Array(base, start + iStart, indexCount * 2),
  };
}

/** `.mesh`를 받아 파싱. 실패는 그대로 던진다(호출측이 2D 유지). */
export async function loadBotMesh(url = MESH_URL, fetchImpl) {
  const f = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('fetch를 쓸 수 없는 환경');
  const res = await f(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`guidebot.mesh HTTP ${res.status}`);
  return parseBotMesh(await res.arrayBuffer());
}

// ── 자세(pose) — 순수 함수 ────────────────────────────────────────────────────
// 「어떻게 움직이나」를 GL 밖으로 꺼내 둔다. 이유는 두 가지다:
//  · **테스트가 브라우저 없이 문다** — reduced-motion 분기·반응 길이·틸트 상한은
//    계약이지 취향이 아니라서 스모크가 직접 계산해 보고 확인해야 한다(guideRules가
//    "무엇을 말할지"를 순수 함수로 갖는 것과 같은 이유).
//  · 정책(접근성·드래그 중 정지)이 셰이더가 아니라 한 곳에 모인다.

/** 부유 주기(ms)와 진폭(캐릭터 높이 대비 비율) */
export const BOB_MS = 2600;
export const BOB_AMP = 0.022;
/** 약한 요잉 — 회전이 아니라 「살아 있음」의 신호라 아주 느리고 얕다 */
export const SWAY_MS = 7300;
export const SWAY_RAD = 0.075;
/** 커서 추종 상한(라디안) — 약 ±12° / ±8° */
export const LOOK_YAW = 0.21;
export const LOOK_PITCH = 0.14;
/** 말할 때 반응 길이(ms). 0.4초 안에 끝나야 「반응」이지 「애니메이션」이 아니다 */
export const REACT_MS = 420;

/**
 * 커서 위치 → 목표 각도(라디안). **드래그 중이면 0** — 끌고 가는 손과 쳐다보는
 * 고개가 같은 좌표를 놓고 싸우면 둘 다 이상해진다.
 * @param box 캔버스의 화면 사각형 {left, top, width, height}
 */
export function lookTarget(box, pointer, dragging = false) {
  if (dragging || !pointer || !box || !(box.width > 0)) return { yaw: 0, pitch: 0 };
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  // 캐릭터 폭의 6배에서 최대로 돈다 — 화면 반대편 커서까지 좇으면 목이 계속
  // 꺾여 있어 부자연스럽다.
  const reach = box.width * 6;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return {
    yaw: clamp((pointer.x - cx) / reach) * LOOK_YAW,
    pitch: clamp((cy - pointer.y) / reach) * LOOK_PITCH,
  };
}

/**
 * 이 프레임의 자세.
 *
 * ⚠️ **`reduced`면 전부 정지**(요·피치·펄스·부유 0). `prefers-reduced-motion`은
 * 취향 설정이 아니라 접근성 요구라 「조금만 움직이기」로 타협하지 않는다.
 *
 * @param tMs        마운트 후 경과(ms)
 * @param look       평활된 커서 추종 각도 {yaw, pitch}
 * @param reactAge   말하기 반응 시작 후 경과(ms). null이면 반응 없음
 */
export function botPose({ tMs = 0, reduced = false, look = null, reactAge = null } = {}) {
  if (reduced) return { yaw: 0, pitch: 0, pulse: 1, bobY: 0 };
  const pose = {
    yaw: Math.sin((tMs / SWAY_MS) * Math.PI * 2) * SWAY_RAD + (look?.yaw ?? 0),
    pitch: look?.pitch ?? 0,
    pulse: 1,
    bobY: Math.sin((tMs / BOB_MS) * Math.PI * 2) * BOB_AMP,
  };
  if (reactAge !== null && reactAge >= 0 && reactAge < REACT_MS) {
    const e = reactAge / REACT_MS;
    // 앞으로 살짝 커졌다 돌아오고(펄스), 고개를 한 번 끄덕인다(감쇠 사인 1주기).
    pose.pulse = 1 + 0.12 * Math.sin(Math.PI * e);
    pose.pitch += -0.20 * Math.sin(Math.PI * 2 * e) * (1 - e);
  }
  return pose;
}

// ── 투영: 직교가 아니라 **원근** ───────────────────────────────────────────────
// 처음에는 2D PNG와 같은 직교 투영이었다. 그런데 직교는 앞뒤가 같은 크기로 그려져서
// **돌아도 평평해 보인다** — 클라이언트가 "3D가 이상하다, 진짜 튀어나온 것 같은 걸
// 원한다"고 지적한 지점이 정확히 이것이다(2026-08-13). 그래서 시야각 34°의 원근으로
// 바꿨다: 가까운 배(앞쪽 볼륨)가 실제로 커져서 화면 밖으로 나오는 인상이 생긴다.
// 대가로 **2D PNG와 실루엣이 완전히 같지는 않다** — 아래 조명 변경과 함께, 톤 일치
// 보다 입체감을 택한 결과다(교체가 눈에 띄지 않는 것보다 우선한다는 지시).
//
// `aPos * uScale`가 곧 **바운딩 박스 중심을 원점으로 옮긴 좌표**다(베이킹이 중심을
// offset에 담아 뺐기 때문). 그래서 회전 전에 따로 중심 이동을 하지 않는다.
const VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
uniform vec3 uScale;    // 양자화 복원(축별)
uniform mat3 uRot;      // 요(yaw)·피치(pitch) 합성 — 모델 → 뷰
uniform float uPulse;   // 말할 때 살짝 커졌다 돌아오는 배율
uniform vec3 uBody;     // x,y = 부유 이동(월드), z = 카메라 거리
uniform vec3 uProj;     // x = 초점거리(1/tan(fov/2)), y = 종횡비, z = 미사용
out vec3 vNormal;
out vec3 vView;
void main() {
  vec3 m = (uRot * (aPos * uScale)) * uPulse + vec3(uBody.xy, 0.0);
  // 카메라는 원점에서 -Z를 본다 → 모델을 -Z로 uBody.z 만큼 민다.
  vec3 p = m - vec3(0.0, 0.0, uBody.z);
  vNormal = normalize(uRot * aNormal);
  vView = normalize(-p);                     // 조각 → 카메라
  const float near = 0.05;
  const float far = 40.0;
  gl_Position = vec4(
    p.x * uProj.x / uProj.y,
    p.y * uProj.x,
    p.z * ((far + near) / (near - far)) + (2.0 * far * near / (near - far)),
    -p.z);
}`;

// ── 조명: 2D PNG보다 **대비를 세게** ──────────────────────────────────────────
// 원래는 `scripts/render_mascot_glb.py`의 상수를 그대로 썼다(앰비언트 0.42 · 램버트
// 0.58 · 림 0.22). 그 값은 부드러워서 평평해 보인다는 지적을 받아, 키라이트를 올리고
// 그늘을 낮추고 하이라이트를 더했다. 채움광(fill)을 반대편에 약하게 두는 이유는
// 그늘이 새까맣게 죽으면 실루엣이 뭉개지기 때문이다.
const FS = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vView;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  const vec3 L = vec3(-0.3592, 0.5644, 0.7423);   // 키라이트(PNG와 같은 방향)
  const vec3 F = vec3(0.6247, -0.1561, -0.7649);  // 채움광 — 반대 아래쪽
  float lam = clamp(dot(n, L), 0.0, 1.0);
  float fill = clamp(dot(n, F), 0.0, 1.0);
  // 림은 **시선 기준**이다 — 원근이라 화면 가장자리일수록 시선이 기울고, 그 경계가
  // 빛나야 몸이 둥글게 읽힌다(고정 z축 기준으로 하면 회전 중에 엉뚱한 데가 빛난다).
  float rim = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.6);
  float spec = pow(clamp(dot(reflect(-L, n), v), 0.0, 1.0), 26.0);
  float shade = 0.26 + 0.86 * lam + 0.12 * fill;
  vec3 c = uColor * shade + vec3(0.34) * rim * 0.42 + vec3(0.18) * spec;
  outColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[guideBot] 셰이더 컴파일 실패: ${log}`);
  }
  return sh;
}

/**
 * WebGL2 컨텍스트 — 실패하면 **null**(호출측이 2D PNG를 그대로 둔다).
 * 예외를 던지지 않는 것이 계약이다: 심사위원 기기를 고를 수 없으므로
 * 그리기 실패는 오류가 아니라 정상 경로다.
 */
export function createBotContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return (
      canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        depth: true,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      }) || null
    );
  } catch {
    return null;
  }
}

/**
 * 렌더러 생성. 컨텍스트·컴파일·업로드 중 어디서 실패해도 **null**을 돌려준다.
 *
 * 반환: { render(seconds), resize(cssW, cssH, dpr), dispose(), drawCalls }
 *
 * 성능 계약: 드로우콜 = `.mesh`의 그룹 수(재질 수)이고 **정점 버퍼 업로드는 1회**다.
 * 매 프레임 바뀌는 것은 uniform 두 개(회전·화면 맞춤)뿐이라 CPU 작업이 사실상 0이다.
 */
export function createBotRenderer(canvas, mesh) {
  const gl = createBotContext(canvas);
  if (!gl || !mesh) return null;

  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? 'link 실패');
    }
  } catch (err) {
    if (typeof console !== 'undefined') console.warn(String(err?.message ?? err));
    return null;
  }

  const u = {
    scale: gl.getUniformLocation(prog, 'uScale'),
    rot: gl.getUniformLocation(prog, 'uRot'),
    pulse: gl.getUniformLocation(prog, 'uPulse'),
    body: gl.getUniformLocation(prog, 'uBody'),
    proj: gl.getUniformLocation(prog, 'uProj'),
    color: gl.getUniformLocation(prog, 'uColor'),
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertexBytes, gl.STATIC_DRAW);
  const locPos = gl.getAttribLocation(prog, 'aPos');
  const locNor = gl.getAttribLocation(prog, 'aNormal');
  if (locPos >= 0) {
    gl.enableVertexAttribArray(locPos);
    // normalized=false — 양자화된 정수를 그대로 받아 셰이더에서 scale·offset을 편다.
    gl.vertexAttribPointer(locPos, 3, gl.SHORT, false, VERTEX_STRIDE, 0);
  }
  if (locNor >= 0) {
    gl.enableVertexAttribArray(locNor);
    // normalized=true — int8 → [-1,1]. 법선은 셰이더에서 다시 정규화한다.
    gl.vertexAttribPointer(locNor, 3, gl.BYTE, true, VERTEX_STRIDE, 6);
  }
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBytes, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  gl.enable(gl.DEPTH_TEST);
  // **뒷면 제거를 켜지 않는다.** 노드 51개를 접으면서 감기 방향이 뒤집힌 서브메시가
  // 하나라도 있으면 캐릭터에 구멍이 뚫린다(원본은 음수 행렬식이 0이라 지금은 없지만,
  // 모델이 갱신되면 조용히 생길 수 있는 종류의 사고다). 56px 캔버스에서 뒷면을 다
  // 그려도 비용이 없으므로 그 버그 종류 자체를 없앤다.
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 0); // 배경 투명 — 버튼의 흰 원이 그대로 비친다

  let vw = 1;
  let vh = 1;

  // ── 카메라 거리 ────────────────────────────────────────────────────────────
  // 원근이라 "얼마나 크게 보이나"가 **거리**로 정해진다. 캐릭터가 캔버스를 꽉
  // 채우되 기울기·펄스·부유로 움직여도 잘리지 않게 살짝 여유를 둔다.
  //   화면 반높이 = (거리 - 앞면까지) · tan(fov/2)
  // 이므로 높이를 맞추는 거리는 `(spanY/2)·초점 + 앞면깊이`다. 폭도 같은 식으로
  // 계산해 **둘 중 먼 쪽**을 쓴다(가로가 좁은 캔버스에서 어깨가 잘리지 않게).
  const spanY = Math.max(mesh.size[1], 1e-6);
  // 회전하면 가로폭이 x와 z 사이를 오간다 — 최악값(대각)으로 잡아 두면 흔들려도
  // 배율이 변하지 않는다(프레임마다 다시 맞추면 캐릭터가 숨쉬듯 커졌다 작아진다).
  const spanX = Math.max(Math.hypot(mesh.size[0], mesh.size[2]), 1e-6);
  const halfDepth = 0.5 * spanX; // 회전 중 앞면이 카메라에 가장 가까워지는 거리
  const FOV = (34 * Math.PI) / 180;
  const focal = 1 / Math.tan(FOV / 2);
  /** 여백 — 기울기(±12°)·펄스(+13%)·부유가 겹쳐도 캔버스 안에 남게 */
  const FILL = 0.86;

  function resize(cssW, cssH, dpr = 1) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    vw = w;
    vh = h;
    gl.viewport(0, 0, w, h);
  }

  const rot = new Float32Array(9);

  /**
   * 한 프레임 그린다. **자세는 호출측(GuideBot3D)이 소유한다** — 여기는 시간을
   * 모른다. 그래야 `prefers-reduced-motion`이나 드래그 같은 정책이 GL 코드가
   * 아니라 컴포넌트 한 곳에 모인다.
   *
   * @param pose { yaw, pitch, pulse, bobY } — 각도는 라디안, bobY는 캐릭터 높이 대비 비율
   */
  function render(pose = {}) {
    const yaw = pose.yaw ?? 0;
    const pitch = pose.pitch ?? 0;
    const pulse = pose.pulse ?? 1;
    const bobY = (pose.bobY ?? 0) * spanY;

    gl.viewport(0, 0, vw, vh);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);

    // R = Ryaw · Rpitch (먼저 고개를 끄덕이고, 그 다음 좌우로 돈다)
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // column-major 3×3
    rot[0] = cy; rot[1] = 0; rot[2] = -sy;
    rot[3] = sy * sp; rot[4] = cp; rot[5] = cy * sp;
    rot[6] = sy * cp; rot[7] = -sp; rot[8] = cy * cp;
    gl.uniformMatrix3fv(u.rot, false, rot);
    gl.uniform3fv(u.scale, new Float32Array(mesh.scale));
    gl.uniform1f(u.pulse, pulse);

    // 캔버스가 세로로 길면 높이가, 가로로 길면 폭이 먼저 찬다 — 둘 다 안 넘치는
    // 거리를 고른다. 거리는 종횡비에 따라서만 바뀌므로 회전해도 배율이 안 흔들린다.
    const aspect = vw / vh;
    const distY = (spanY / 2) * focal / FILL + halfDepth;
    const distX = (spanX / 2) * focal / (aspect * FILL) + halfDepth;
    gl.uniform3f(u.body, 0, bobY, Math.max(distY, distX));
    gl.uniform3f(u.proj, focal, aspect, 0);

    for (const g of mesh.groups) {
      gl.uniform3fv(u.color, new Float32Array(g.color));
      gl.drawElements(gl.TRIANGLES, g.indexCount, gl.UNSIGNED_SHORT, g.indexOffset * 2);
    }
    gl.bindVertexArray(null);
  }

  function dispose() {
    gl.deleteBuffer(vbo);
    gl.deleteBuffer(ibo);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(prog);
    // 컨텍스트는 명시적으로 잃게 만들지 않는다 — 브라우저 라이브 컨텍스트 상한을
    // 압박하지 않는 선에서, 캔버스가 GC되면 함께 사라진다(crossSection과 같은 판단).
  }

  return { render, resize, dispose, drawCalls: mesh.groups.length };
}
