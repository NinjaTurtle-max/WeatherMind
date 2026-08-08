/**
 * 마스코트 정렬 계약 (2026-08-06).
 *
 * 여섯 캐릭터를 같은 자리에 같은 크기로 앉히려면 **세 가지가 동시에** 참이어야 한다.
 * 하나만 어긋나도 화면에서는 "캐릭터마다 위치가 미묘하게 다르다"로 나타나는데,
 * 원인이 이미지인지 클래스인지 눈으로는 갈라낼 수 없다 — 그래서 셋을 다 못 박는다.
 *
 *   ① PNG에 투명 여백이 없다        — 내용 경계 = 이미지 경계
 *   ② Mascot이 object-contain을 박는다 — 호출부가 빠뜨릴 수 없게
 *   ③ 호출부가 가로·세로를 둘 다 준다  — 폭만 주면 세로가 원본 비율을 따라간다
 *
 * ①이 왜 계약인가: 원본 6장은 캔버스마다 18~21px 투명 여백을 달고 있었고 snow는
 * 중심까지 (−8, −6) 어긋나 있었다. 같은 박스에 넣어도 캐릭터가 제각각 작게·치우쳐
 * 보였다. 새 PNG를 여백째 넣으면 조용히 같은 상태로 돌아간다.
 *
 * 의존 0 — node_modules 없이 돈다. colortype 6(RGBA)·bitdepth 8·비인터레이스만
 * 읽는다(현재 6장 전부 해당). 다른 형식이 들어오면 디코더가 실패로 알린다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 캐릭터 목록을 손으로 적지 않는다(2026-08-08) — 적어 두면 **새로 합류한 그림이
// ① 검사를 조용히 비켜간다**. 실제로 무지개·달님을 넣을 때 이 배열이 6종에
// 멈춰 있었다. Mascot.jsx의 SRC 표가 유일한 소유자이므로 거기서 읽는다.
const MASCOT_JSX = readFileSync(join(ROOT, 'src/components/Mascot.jsx'), 'utf8');
const NAMES = [
  ...(MASCOT_JSX.match(/const SRC = \{[^}]*\}/s)?.[0].matchAll(/(\w+):\s*'\/([\w-]+)\.png'/g) ?? []),
].map((m) => m[2]);
// 알파 8(3%) 미만은 눈에 보이지 않는 안티에일리어싱 잔털이라 내용으로 세지 않는다.
// drop 원본은 이 잔털이 오른쪽으로 107px 뻗어 있었다.
const ALPHA_THRESHOLD = 8;

let failures = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

/** PNG(RGBA8, 비인터레이스)에서 알파 채널만 뽑는다. */
function readAlpha(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 시그니처 아님');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('IHDR 없음');
  const { width, height, depth, colorType, interlace } = header;
  if (depth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`지원하지 않는 PNG: depth=${depth} colorType=${colorType} interlace=${interlace}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const alpha = new Uint8Array(width * height);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    raw.copy(cur, 0, pos, pos + stride);
    pos += stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0; // 왼쪽
      const b = prev[x]; // 위
      const c = x >= bpp ? prev[x - bpp] : 0; // 왼쪽 위
      let value = cur[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error(`알 수 없는 필터 ${filter} (행 ${y})`);
      }
      cur[x] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = cur[x * bpp + 3];
    cur.copy(prev);
  }
  return { width, height, alpha };
}

/** 알파가 임계 이상인 픽셀들의 경계 상자 — 없으면 null. */
function contentBBox({ width, height, alpha }) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < ALPHA_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

console.log('마스코트 정렬 계약');

ok(NAMES.length >= 6, `Mascot.jsx SRC에서 캐릭터 목록을 읽었다 — ${NAMES.length}종 (${NAMES.join(', ')})`);

console.log('① PNG 투명 여백 0 — 내용 경계가 곧 이미지 경계');
for (const name of NAMES) {
  const file = join(ROOT, 'public', `${name}.png`);
  let image;
  try {
    image = readAlpha(readFileSync(file));
  } catch (err) {
    ok(false, `${name}.png 디코드: ${err.message}`);
    continue;
  }
  const box = contentBBox(image);
  if (!box) {
    ok(false, `${name}.png 에 불투명 픽셀이 없다`);
    continue;
  }
  const pad = {
    left: box.left,
    top: box.top,
    right: image.width - 1 - box.right,
    bottom: image.height - 1 - box.bottom,
  };
  const clean = pad.left === 0 && pad.top === 0 && pad.right === 0 && pad.bottom === 0;
  ok(
    clean,
    `${name}.png ${image.width}x${image.height} 여백 L${pad.left} T${pad.top} R${pad.right} B${pad.bottom}`
      + (clean ? '' : ' — 알파 경계로 크롭할 것'),
  );
}

console.log('② Mascot이 object-contain을 스스로 박는다');
const mascotSrc = readFileSync(join(ROOT, 'src/components/Mascot.jsx'), 'utf8');
ok(
  /className=\{`object-contain \$\{className\}`\}/.test(mascotSrc),
  'Mascot이 className에 object-contain을 합성한다',
);

console.log('③ 호출부가 가로·세로를 둘 다 준다');
// 호출부 목록을 손으로 적지 않는다 — 적어 두면 새로 생긴 호출부가 검사를
// 조용히 비켜간다. src 전체를 훑어 <Mascot .../>를 찾는다.
const jsxFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? jsxFiles(p) : (/\.jsx$/.test(name) ? [p] : []);
  });
let callCount = 0;
for (const file of jsxFiles(join(ROOT, 'src'))) {
  if (file.endsWith(`components${sep}Mascot.jsx`)) continue; // 정의부
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const call of src.match(/<Mascot[^>]*\/>/g) ?? []) {
    callCount += 1;
    const cls = call.match(/className="([^"]*)"/)?.[1] ?? '';
    ok(
      /(^|\s)h-\S+/.test(cls) && /(^|\s)w-\S+/.test(cls),
      `${rel}: 가로·세로 지정 — "${cls}"`,
    );
  }
}
ok(callCount >= 3, `Mascot 호출부를 훑었다 — ${callCount}건 (0이면 정규식이 죽은 것)`);

console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
