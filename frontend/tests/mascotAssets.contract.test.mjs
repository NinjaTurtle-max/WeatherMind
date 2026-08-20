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
/**
 * `attr={ ... }`의 중괄호 **짝을 세어** 안쪽을 꺼낸다.
 * 정규식 `\{([\s\S]*?)\}`는 첫 `}`에서 끊겨 템플릿 리터럴(`${}`)을 잘라 먹는다.
 */
function braced(source, attr) {
  const at = source.indexOf(`${attr}{`);
  if (at < 0) return null;
  let depth = 0;
  for (let i = at + attr.length; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at + attr.length + 1, i);
    }
  }
  return null;
}

/** 템플릿 리터럴에서 `${...}`를 걷어내고 **정적 텍스트**만 남긴다(중첩 중괄호 포함). */
function stripInterpolations(body) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < body.length && depth > 0) {
        if (body[i] === '{') depth += 1;
        else if (body[i] === '}') depth -= 1;
        i += 1;
      }
      out += ' '; // 보간 자리는 공백 — 앞뒤 클래스가 붙어 버리면 안 된다
      i -= 1;
      continue;
    }
    out += body[i];
  }
  return out;
}

/**
 * 문자열 리터럴만으로 된 삼항의 가지 목록. 가지 하나라도 문자열이 아니면
 * `null`(= 검증 불가 → 실패). 중첩 삼항도 편다.
 */
function ternaryBranches(expr) {
  if (expr == null) return null;
  const text = expr.trim();
  const quoted = /^(?:'([^']*)'|"([^"]*)")$/.exec(text);
  if (quoted) return [quoted[1] ?? quoted[2]];
  // 템플릿 리터럴은 **정적 부분**으로 판정한다. 거기에 h-/w-가 이미 있으면
  // 보간이 무엇을 더 붙이든 크기는 보장된다. 정적 부분만으로 모자라면 아래
  // sized 검사에서 떨어진다 — 보간이 크기를 줄 수도 있지만 확인할 수 없으니
  // 그때는 삼항으로 펴 쓰라는 뜻이다.
  if (text.startsWith('`') && text.endsWith('`') && text.length >= 2) {
    return [stripInterpolations(text.slice(1, -1))];
  }
  // 최상위 `?`를 찾는다(괄호 밖).
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === '?' && depth === 0) {
      // 대응하는 최상위 `:`를 찾는다(중첩 삼항이면 그 안의 `:`는 건너뛴다).
      let q = 0;
      for (let j = i + 1; j < text.length; j += 1) {
        const c = text[j];
        if ('([{'.includes(c)) depth += 1;
        else if (')]}'.includes(c)) depth -= 1;
        else if (c === '?' && depth === 0) q += 1;
        else if (c === ':' && depth === 0) {
          if (q > 0) { q -= 1; continue; }
          const left = ternaryBranches(text.slice(i + 1, j));
          const right = ternaryBranches(text.slice(j + 1));
          return left && right ? [...left, ...right] : null;
        }
      }
      return null;
    }
  }
  return null; // 문자열도 삼항도 아니다 — 변수·함수 호출 등은 검증할 수 없다
}

let callCount = 0;
for (const file of jsxFiles(join(ROOT, 'src'))) {
  if (file.endsWith(`components${sep}Mascot.jsx`)) continue; // 정의부
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const call of src.match(/<Mascot[^>]*\/>/g) ?? []) {
    callCount += 1;
    // className은 리터럴(`className="h-9 w-9"`)일 수도, **문자열만으로 된
    // 삼항**(`className={stack ? 'h-7 w-7' : 'h-9 w-9'}`)일 수도 있다.
    // 삼항이면 **모든 가지**가 가로·세로를 줘야 한다.
    //
    // ⚠️ 2026-08-12 1차 수정은 "표현식 안의 따옴표 문자열을 다 모아 검사"였는데
    // 그것은 **느슨했다**: `cond ? 'h-7 w-7' : sizeVar`가 통과한다(sizeVar를
    // 아무도 안 본다). 그래서 지금은 가지 자체가 문자열 리터럴일 것을 요구하고,
    // 하나라도 아니면 **검증 불가로 실패**시킨다. 변수로 크기를 주고 싶으면
    // 삼항 문자열로 펴 쓰라는 뜻이다 — 이 계약이 지키려는 것이 그것이다.
    const literal = call.match(/className="([^"]*)"/)?.[1];
    const expr = literal == null ? braced(call, 'className=') : null;
    const branches = literal != null ? [literal] : ternaryBranches(expr);
    const sized = (cls) => /(^|\s)h-\S+/.test(cls) && /(^|\s)w-\S+/.test(cls);
    ok(
      branches != null && branches.length > 0 && branches.every(sized),
      `${rel}: 가로·세로 지정 — ${
        branches == null
          ? `검증 불가(문자열 삼항이 아니다): ${String(expr).trim().slice(0, 60)}`
          : branches.length
            ? branches.map((c) => `"${c}"`).join(' | ')
            : '(className 없음)'
      }`,
    );
  }
}
ok(callCount >= 3, `Mascot 호출부를 훑었다 — ${callCount}건 (0이면 정규식이 죽은 것)`);

console.log('④ 화면마다 말하는 캐릭터는 하나 — 배너는 담당표를 따른다');
// **한 화면에 말하는 사람은 하나다.**
//
// ⚠️ **이 절의 지키는 방법이 2026-08-17에 바뀌었다.** 종전에는 「배너를 세운
// 화면은 사이드바 튜터를 접는가」(`HERO_PATHS`)를 물었다 — 안 접으면 같은
// 캐릭터가 74px(사이드바) + 62px(배너) 둘로 뜨고 각자 다른 말을 했다
// (2026-08-11에 /board에서 실제로 그랬다). 지금은 **사이드바 튜터 카드 자체가
// 없어져서**(`SideNav.jsx`) 접을 것이 없고, `HERO_PATHS`도 함께 사라졌다.
// 그래서 무는 것을 **한 단계 강한 쪽**으로 옮긴다: 목록에 잘 넣었는지가 아니라
// **사이드바가 캐릭터를 아예 안 그리는지**를 본다. 카드가 되살아나면 여기서 운다.
//
// 담당표(`TUTOR_BY_PATH`)는 남는다 — 렌더 입력이 아니라 「어느 화면을 누가
// 맡는가」의 단일 소유자이고, 배너들이 각자 하드코딩한 마스코트가 그 표와
// 어긋나지 않는지를 아래에서 대조한다.
{
  const nav = readFileSync(join(ROOT, 'src/components/SideNav.jsx'), 'utf8');

  // ⓐ 사이드바는 캐릭터를 그리지 않는다(튜터 카드 부활 감시).
  ok(
    !/<Mascot\b/.test(nav),
    '사이드바는 마스코트를 그리지 않는다 — 그리면 튜터 카드가 부활해 GuideBot과 둘이 뜬다',
  );

  // ⓑ 담당표에서 경로별 마스코트 이름을 뽑는다(문자열 리터럴 쌍).
  const table = nav.slice(nav.indexOf('const TUTOR_BY_PATH'), nav.indexOf('export default function SideNav'));
  const assigned = {};
  for (const row of table.split('\n')) {
    const path = row.match(/p === '([^']+)'/)?.[1];
    const name = row.match(/name: '([^']+)'/)?.[1];
    if (path && name) assigned[path] = name;
  }
  ok(
    Object.keys(assigned).length >= 5,
    `담당표(TUTOR_BY_PATH)를 읽었다 — ${JSON.stringify(assigned)}`,
  );

  // ⓒ 배너를 세운 화면의 마스코트가 담당표와 같은가.
  //    라벨을 「같다」로 적는다 — 종전에는 실패 문안(`≠`)을 그대로 써서
  //    **통과할 때 `ok … ≠ …`** 로 찍혔다(읽으면 정반대로 보인다).
  // ⚠️ 배너를 세운 화면은 **반드시 여기 넣을 것.** 안 넣으면 그 화면의 마스코트가
  //    담당표와 갈려도 아무도 울지 않는다 — /league가 2026-08-17에 배너를
  //    갖게 되면서 실제로 그 상태가 잠깐 있었다.
  const banners = [
    ['/explore', 'src/modules/explore/ExploreHome.jsx'],
    ['/duel', 'src/modules/duel/DuelPage.jsx'],
    ['/league', 'src/modules/league/LeaguePage.jsx'],
  ];
  for (const [path, file] of banners) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const used = src.match(/mascot="([a-z]+)"/)?.[1];
    ok(path in assigned, `${path} 배너의 담당이 표에 있다 — 없으면 담당이 정해지지 않은 화면이다`);
    ok(
      used === assigned[path],
      `${path} 배너 마스코트 = 담당표 (배너 ${used} · 표 ${assigned[path]})`,
    );
    // ⓓ **배너만 보면 놓친다.** 화면 본문에도 캐릭터를 직접 그리는 자리가 있다
    //    (리그의 「예측 제출됨」 카드가 그렇다). 2026-08-17에 리그 담당이
    //    번개 → 눈송이로 바뀌었을 때 배너 셋만 따라오고 그 카드는 번개로
    //    남아, **한 화면에서 두 캐릭터가 말했다** — 위 ⓒ는 초록이었다.
    //    그래서 파일 안의 모든 마스코트 참조를 담당표와 대조한다.
    const all = new Set([
      ...src.matchAll(/mascot="([a-z]+)"/g),
      ...src.matchAll(/<Mascot\s+name="([a-z]+)"/g),
    ].map((m) => m[1]));
    ok(
      all.size === 1 && all.has(assigned[path]),
      `${path} 화면의 캐릭터가 담당표 하나뿐이다 — 쓰인 것 ${JSON.stringify([...all])} · 표 ${assigned[path]}`,
    );
  }
}

console.log('⑤ 개념 태그 : 그림 — 폴백으로 떨어지는 태그가 없다');
// 2026-08-18. `conceptCharacter.js` 머리말이 「개념 14 : 그림 14 완전 1:1」이라고
// 선언한다. 그 선언을 사람이 지킬 수는 없다 — 개념 태그는 **시드가** 늘리고
// 그림은 사람이 따로 넣는 것이라, 태그만 늘면 그 개념은 조용히 폴백(구름)으로
// 떨어져 홈·복습 줄이 같은 얼굴로 채워진다. 실제로 기초과학 6종이 들어올 때
// 정확히 그랬다(머리말이 그 경위를 적어 놓았다).
//
// ⚠️ 같은 부류의 공백이 이번 주에 반복됐다 — 보드 규칙 5종이 단면 장면 없이
//    들어와 main이 빨갰다. **콘텐츠가 늘 때 짝을 강제하는 계약**이 그 답이다.
// 태그의 소유자는 시드(`content_items.json`)이고 그림의 소유자는 SRC다.
{
  // ⚠️ **태그 목록의 소유자는 시드가 아니라 백엔드다.** 화면에 행을 만드는 것은
  //    `weatherbrain_service.CONCEPT_TAGS`이고(가입 시 그 전 태그의 θ를 초기화한다),
  //    시드는 그 태그에 문항이 붙었는지를 말할 뿐이다. 저작보다 먼저 태그를 여는
  //    것이 이 저장소의 **문서화된 패턴**이라(재난 2종이 그랬다), 시드만 보면
  //    「열렸지만 아직 문항 없는 태그」가 조용히 폴백으로 떨어진다.
  //    그래서 **둘의 합집합**을 본다 — 어느 쪽에서 늘어도 걸린다.
  const seed = JSON.parse(readFileSync(join(ROOT, '../database/seed/content_items.json'), 'utf8'));
  const backend = readFileSync(join(ROOT, '../backend/app/services/weatherbrain_service.py'), 'utf8');
  // ⚠️ `indexOf(')')`로 끝을 잡으면 `tuple[str, ...]`의 닫는 괄호에서 끊겨 5종만
  //    읽힌다. 대입 뒤 **여는 괄호**부터 그 짝까지를 잡는다.
  const beAt = backend.indexOf('CONCEPT_TAGS: tuple');
  const beOpen = backend.indexOf('(', backend.indexOf('=', beAt));
  const beBlock = backend.slice(beOpen, backend.indexOf('\n)', beOpen));
  const beTags = [...beBlock.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
  ok(beTags.length >= 6, `백엔드 CONCEPT_TAGS를 읽었다 — ${beTags.length}종`);
  const tags = [...new Set([...seed.map((it) => it.concept_tag).filter(Boolean), ...beTags])].sort();
  const src = readFileSync(join(ROOT, 'src/components/conceptCharacter.js'), 'utf8');
  const body = src.slice(src.indexOf('const BY_CONCEPT'), src.indexOf('};', src.indexOf('const BY_CONCEPT')));
  const map = Object.fromEntries([...body.matchAll(/([a-z_0-9]+):\s*'([a-z]+)'/g)].map((m) => [m[1], m[2]]));
  ok(tags.length > 0, `개념 태그 합집합(시드 ∪ 백엔드) — ${tags.length}종`);

  const missing = tags.filter((t) => !map[t]);
  ok(
    missing.length === 0,
    `모든 개념 태그에 그림이 배정돼 있다 — 빠진 것 ${missing.length}건${missing.length ? ` (${missing})` : ''}`,
  );

  // SRC에만 있고 LABEL에 없으면 `MASCOT_NAMES[name]`이 undefined라
  // `decorative={false}` 호출부에서 **alt가 빈 문자열**이 된다 — 장식이 아니라고
  // 선언해 놓고 읽어 줄 이름이 없는 상태다. wind·grass를 넣을 때 실제로 그랬다.
  // ⚠️ **2026-08-19: LABEL이 리터럴에서 i18n getter로 바뀌었다**(이름이 `<img alt>`로
  // 나가는 사용자 문자열이라 외부화). 이 단정이 그 변경에 **정확히 울어 줬다** —
  // 텍스트 파서가 형태 변화에 걸린 것이고, 그래서 파서를 새 형태에 맞춘다.
  // 🔴 파서를 고칠 때 **검사가 약해지지 않았는지**가 관건이라, 오히려 한 겹 더 문다:
  // 종전에는 「키가 있다」까지만 봤고 이제 **그 키의 실제 문구가 리소스에 있는지**까지 본다.
  // (외부화 뒤에는 키만 있고 리소스가 비면 alt가 키 원문이 되어 더 나쁘다)
  const labelBlock = MASCOT_JSX.slice(MASCOT_JSX.indexOf('const LABEL = {'), MASCOT_JSX.indexOf(']', MASCOT_JSX.indexOf('const LABEL = {')));
  const labels = [...labelBlock.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  ok(labels.length > 0, `LABEL 키 목록을 읽었다 — ${labels.length}종`);
  const noLabel = NAMES.filter((n) => !labels.includes(n));
  ok(
    noLabel.length === 0,
    `SRC의 전 캐릭터에 이름표가 있다 — 빠진 것 ${noLabel.length}건${noLabel.length ? ` (${noLabel})` : ''}`,
  );

  const koRes = readFileSync(join(ROOT, 'src/i18n/resources/ko.js'), 'utf8');
  const mascotBlock = koRes.slice(koRes.indexOf('  mascot: {'), koRes.indexOf('},', koRes.indexOf('  mascot: {')));
  const resKeys = [...mascotBlock.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  const noString = labels.filter((n) => !resKeys.includes(n));
  ok(
    noString.length === 0,
    `이름표 키마다 ko 리소스에 실제 문구가 있다 — 빠진 것 ${noString.length}건${noString.length ? ` (${noString})` : ''}`,
  );

  // 유닛 노드 아이콘도 같은 짝이다 — 표 머리말이 "캐릭터 배정과 짝을 맞춘다"고
  // 선언한다. 빠지면 그 개념만 책 아이콘('📘')이 되어, 같은 개념이 유닛 노드와
  // 능력 분석에서 다른 얼굴로 보인다.
  //
  // 🔴 **2026-08-19: 소유자가 옮겼다.** 표는 `CurriculumHome.jsx`에 있었고
  // 결함 ⑪-a(큰 화면이 개념 아이콘을 상태 아이콘으로 덮어쓰던 것)를 고치면서
  // **`unitIcon.js`가 단일 소유**하게 됐다. 이 테스트가 옛 자리를 계속 읽어
  // **빈 블록을 슬라이스하고 전 태그가 「빠졌다」로 나왔다** — ⑪-a가 만든 회귀이고
  // `ci.sh frontend`를 막고 있었다(⑪-b 담당이 찾았다).
  // ⚠️ 표를 옮길 때 **읽는 쪽을 함께 고쳐야 한다**는 것이 교훈이다. 이 저장소가
  // 오늘만 네 번 겪은 「두 벌이 갈린다」의 거울상이다 — 한 벌로 모으는 수정도
  // **읽던 자리를 남겨 두면 깨진다.**
  const iconSrc = readFileSync(join(ROOT, 'src/modules/curriculum/unitIcon.js'), 'utf8');
  const iconBlock = iconSrc.slice(iconSrc.indexOf('CONCEPT_ICON = {'), iconSrc.indexOf('};', iconSrc.indexOf('CONCEPT_ICON = {')));
  const iconTags = [...iconBlock.matchAll(/^\s{2}([a-z_0-9]+):/gm)].map((m) => m[1]);
  const noIcon = tags.filter((t) => !iconTags.includes(t));
  ok(
    noIcon.length === 0,
    `모든 개념 태그에 유닛 노드 아이콘이 있다 — 빠진 것 ${noIcon.length}건${noIcon.length ? ` (${noIcon})` : ''}`,
  );

  const unknown = [...new Set(Object.values(map))].filter((c) => !NAMES.includes(c));
  ok(
    unknown.length === 0,
    `배정된 그림이 전부 SRC에 있다 — 없는 것 ${unknown.length}건${unknown.length ? ` (${unknown})` : ''}`,
  );

  // 겹침 0은 **선언이지 불변식이 아니다** — 태그가 그림보다 많아지면 다시
  // 겹칠 수 있고 그것 자체가 결함은 아니다. 다만 선언해 둔 동안에는 그 말이
  // 참이어야 하므로 선언과 실제를 대조한다.
  //
  // ⚠️ **산문을 정규식으로 읽지 않는다.** 처음엔 머리말에서 「완전 1:1」을
  //    찾았는데, 그 머리말은 §0-5(틀린 기술은 지우지 말고 경위를 남긴다)에 따라
  //    **철회된 종전 문구를 인용째 보존**한다 — 나중에 태그가 그림보다 많아져
  //    선언을 접어도 인용문 때문에 정규식이 계속 참이 되어 main이 빨개진다.
  //    그때 빠져나가려면 남겨야 할 이력을 지워야 한다. 그래서 기계가 읽는
  //    표식 한 줄에 건다 — 접을 때는 그 줄만 지운다.
  const claims1to1 = /@contract\s+concept-character-1to1/.test(src);
  const used = Object.keys(map).filter((t) => tags.includes(t)).map((t) => map[t]);
  const dupes = used.length - new Set(used).size;
  ok(
    !claims1to1 || dupes === 0,
    `머리말이 1:1이라 적었으면 실제로 겹침이 없다 — 겹침 ${dupes}건`,
  );
}

console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
