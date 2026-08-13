/**
 * 지식 단계(knowledge_level) 표시 계약 (R13) —
 *   node tests/knowledgeLevel.test.mjs
 *
 * 왜 있나: 2026-08-10에 지식 단계를 6 → 10칸으로 넓히고 문항 1,000건을 그 축으로
 * 분류했는데 화면에는 4밴드(초급/중급/고급/최상급)만 떴다. 그 구멍을 메운 라벨·
 * 선택자가 **서버의 단계 수와 조용히 갈라지지 않게** 붙잡는다.
 *
 * 관례는 uiCopy.contract.test.mjs와 동일: 테스트 러너·node_modules 의존 없음.
 * i18n/core.js·lib/abilityDisplay.js는 bare 지정자를 끌지 않아 그대로 import된다
 * (그래서 워크트리의 react dispatcher 함정에도 걸리지 않는다).
 *
 * 지키는 계약
 *   1. 2축 병기 — knowledgeLevel 라벨을 더해도 기존 4밴드(ability.level·LEVEL_KO·
 *      THETA_BAND_BOUNDS)는 한 글자도 변하지 않는다.
 *   2. 라벨 칸 수 = 서버 KNOWLEDGE_LEVEL_BANDS 길이 (ko·en 양쪽).
 *      단계 수가 10 → N으로 바뀌면 여기서 먼저 운다.
 *   3. selectKnowledgeLevel — 서버 필드 부재/빈 배열/이상값이면 null(카드 감춤),
 *      값이 오면 {level, max}. **분모는 knowledge_level_max에서만 나온다.**
 *   4. 라벨이 ko·en 양쪽에서 실제로 풀린다(키 문자열 그대로 뜨지 않는다).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${label}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n      기대 ${e}\n      실제 ${a}`);
}

// ── 서버 원본(단일 진실원)에서 단계 수를 읽는다 ─────────────────────────────
// 평문 튜플이라 텍스트 파서가 적법하다(uiCopy.contract.test.mjs와 같은 선례).
// ⚠️ 정의행에만 걸어야 한다 — 같은 이름을 언급하는 주석이 파일에 여럿 있다.
const brainSrc = readFileSync(
  resolve(repoRoot, 'backend/app/services/weatherbrain_service.py'),
  'utf-8',
);
// ⚠️ 닫는 괄호는 **줄 시작**의 것으로 잡아야 한다. 행 끝 주석에 괄호가 들어 있어
// (`# 6 — 고2~3 일반선택(지구과학·…) 정성 심화`) `[\s\S]*?\)`로 끊으면 6칸에서
// 멈춘다 — 실제로 이 테스트가 처음에 그렇게 틀렸다.
const bandsMatch = brainSrc.match(/^KNOWLEDGE_LEVEL_BANDS\s*(?::[^=]*)?=\s*\(([\s\S]*?)^\)/m);
if (!bandsMatch) {
  console.error('FAIL KNOWLEDGE_LEVEL_BANDS를 backend에서 찾지 못했다 — 상수 이름이 바뀌었나?');
  process.exit(1);
}
const SERVER_LEVEL_COUNT = bandsMatch[1]
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter((line) => /^["'][a-z_]+["'],?$/.test(line)).length;

const { RESOURCES, _syncLocale, getCurrentLocale } = await import('../src/i18n/core.js');
const ability = await import('../src/lib/abilityDisplay.js');

// ⚠️ **로케일을 ko로 고정한다.** 이 파일은 한국어 문구를 단정하는데, 아래
// `ability.*` 사전은 리소스 파생 **getter**라 접근 시점의 현재 로케일로 풀린다
// (`localizedDict` — `translate(getCurrentLocale(), …)`). 고정하지 않으면
// `detectLocale()`이 `navigator.language`를 따라가고, node 22는 시스템 로케일에서
// 그 값을 만든다: en-US 머신에서는 「최상급」 자리에 "Expert"가, 「고등학교
// 진로선택」 자리에 "High School Career Electives"가 온다(2026-08-11 실측 —
// GitHub 러너는 통과하는데 로컬 `scripts/ci.sh`만 빨간불이었다).
//
// 다른 스모크가 jsdom localStorage에 `weathermind.locale=ko`를 심는 것과 같은
// 계약이다(CLAUDE.md 「하네스는 로케일 ko 고정 — en-US 러너 대비」). 여기는
// jsdom을 안 쓰므로 스토어를 직접 맞춘다.
//
// ⚠️ `RESOURCES[locale]`을 직접 읽는 검사(2번)는 로케일과 무관하다 — 그래서
// 이 파일이 **반은 통과하고 반만 실패**해서 원인이 한눈에 안 보였다.
_syncLocale('ko');

check('로케일이 ko로 고정됐다', () => {
  // 이 단정이 먼저 터져야 아래 문구 불일치가 "번역이 틀렸다"로 오독되지 않는다.
  eq(getCurrentLocale(), 'ko', '로케일 고정 실패 — 아래 한국어 단정이 전부 무의미해진다');
});

check('서버 단계 수를 읽었다', () => {
  assert(SERVER_LEVEL_COUNT >= 2, `파싱된 단계 수가 이상하다: ${SERVER_LEVEL_COUNT}`);
});

// ── 1. 2축 병기 — 기존 4밴드는 그대로 ───────────────────────────────────────
check('2축 병기: 4밴드(표현 톤)는 그대로 남아 있다', () => {
  eq(ability.THETA_BAND_BOUNDS, [-0.5, 0.5, 1.5], 'THETA_BAND_BOUNDS가 바뀌었다');
  eq(
    ability.THETA_BAND_LABELS,
    ['beginner', 'intermediate', 'advanced', 'expert'],
    'THETA_BAND_LABELS가 바뀌었다',
  );
  for (const locale of ['ko', 'en']) {
    eq(
      Object.keys(RESOURCES[locale].ability.level).sort(),
      ['advanced', 'beginner', 'expert', 'intermediate'],
      `${locale} ability.level 키가 바뀌었다 — 4밴드는 지우지도 바꾸지도 않는다`,
    );
  }
  eq(ability.LEVEL_KO.expert, '최상급', 'LEVEL_KO ko 값이 바뀌었다');
});

// ── 2. 라벨 칸 수 = 서버 단계 수 ────────────────────────────────────────────
check(`지식 단계 라벨이 서버 ${SERVER_LEVEL_COUNT}칸을 전부 덮는다 (ko·en)`, () => {
  const expected = Array.from({ length: SERVER_LEVEL_COUNT }, (_, i) => String(i + 1));
  for (const locale of ['ko', 'en']) {
    const kl = RESOURCES[locale].ability.knowledgeLevel;
    assert(kl, `${locale}.ability.knowledgeLevel이 없다`);
    eq(Object.keys(kl.name), expected, `${locale} knowledgeLevel.name 칸 수가 서버와 다르다`);
    eq(Object.keys(kl.sub), expected, `${locale} knowledgeLevel.sub 칸 수가 서버와 다르다`);
    for (const level of expected) {
      for (const part of ['name', 'sub']) {
        const value = kl[part][level];
        assert(
          typeof value === 'string' && value.length > 0,
          `${locale}.ability.knowledgeLevel.${part}.${level} 값이 비었다 — 화면에 키 문자열이 뜬다`,
        );
        assert(
          !value.includes('**') && !/\[\d/.test(value),
          `${locale}.${part}.${level}에 anchor 원문의 마크다운·성취기준 코드가 남았다: "${value}"`,
        );
      }
    }
  }
});

check('라벨 사전이 ko에서 실제로 풀린다(키 문자열 폴백이 아니다)', () => {
  eq(ability.KNOWLEDGE_LEVEL_NAME[7], '고등학교 진로선택', 'Lv.7 표시명');
  eq(ability.KNOWLEDGE_LEVEL_SUB[7], '지구시스템과학 · 고급 지구과학', 'Lv.7 부제');
  eq(ability.KNOWLEDGE_LEVEL_NAME[1], '초등 3~4학년', 'Lv.1 표시명');
  eq(
    ability.KNOWLEDGE_LEVEL_NAME[SERVER_LEVEL_COUNT],
    '기상청 현업',
    '최상 단계 표시명',
  );
  // 미지 단계는 undefined — 소비처의 `?? Lv.{n}` 폴백이 살아야 한다(크래시 금지)
  eq(ability.KNOWLEDGE_LEVEL_NAME[SERVER_LEVEL_COUNT + 1], undefined, '범위 밖 단계');
});

// ── 3. 선택자 — 서버 필드가 없으면 카드가 감춰진다 ──────────────────────────
check('selectKnowledgeLevel: 서버 필드가 없으면 null(= 카드 감춤)', () => {
  eq(ability.selectKnowledgeLevel(undefined), null, 'undefined');
  eq(ability.selectKnowledgeLevel(null), null, 'null');
  eq(ability.selectKnowledgeLevel([]), null, '빈 배열');
  eq(
    ability.selectKnowledgeLevel({ xp: 10, level: 2, tier: 'stratus' }),
    null,
    '구 백엔드 /progress/me — 필드 부재',
  );
  eq(
    ability.selectKnowledgeLevel({ knowledge_level: null, knowledge_level_max: 10 }),
    null,
    '콜드스타트(θ 행 없음) — 서버가 null을 주면 화면도 숫자를 지어내지 않는다',
  );
  eq(ability.selectKnowledgeLevel({ knowledge_level: 0 }), null, '0은 유효 단계가 아니다');
  eq(ability.selectKnowledgeLevel({ knowledge_level: '7' }), null, '문자열은 받지 않는다');
});

check('selectKnowledgeLevel: 값이 오면 {level, max} — 분모는 서버 값만 쓴다', () => {
  eq(
    ability.selectKnowledgeLevel({ knowledge_level: 7, knowledge_level_max: 10 }),
    { level: 7, max: 10 },
    '/progress/me — 사용자 1인의 대표 단계',
  );
  eq(
    ability.selectKnowledgeLevel({ knowledge_level: 3, knowledge_level_max: 12 }),
    { level: 3, max: 12 },
    '분모 12(다음 확장)도 그대로 따른다 — 10을 박지 않는다',
  );
  eq(
    ability.selectKnowledgeLevel({ knowledge_level: 5 }),
    { level: 5, max: null },
    'max 부재 — 단계는 뜨고 막대·다음 단계만 빠진다',
  );
  eq(
    ability.selectKnowledgeLevel({ knowledge_level: 9, knowledge_level_max: 4 }),
    { level: 9, max: null },
    'max < level인 모순값은 분모로 쓰지 않는다',
  );
  eq(
    ability.selectKnowledgeLevel([{ knowledge_level: 7, knowledge_level_max: 10 }]),
    { level: 7, max: 10 },
    '한 행짜리 배열도 받는다(편의) — 개념별 목록을 넘기라는 뜻은 아니다',
  );
});

// ── 4. 사용자 대표 단계의 출처가 /progress/me다 ─────────────────────────────
check('사용자 1인의 대표 단계는 ProgressMe(/progress/me)에 있다', () => {
  // 같은 이름의 필드가 ConceptAbilityOut·ConceptMasteryOut에도 있지만 그것은
  // **개념별** 값이다(스키마 주석이 "축이 다르다"고 못박는다). 카드가 mastery
  // 첫 행을 집으면 숙련 낮은 순 정렬 탓에 **가장 약한 개념**을 "현재 단계"라고
  // 말하게 된다 — 이 가드는 소비처가 /me를 떠나지 않게 붙잡는다.
  const schemaSrc = readFileSync(resolve(repoRoot, 'backend/app/schemas/progress.py'), 'utf-8');
  const body = schemaSrc.split(/^class ProgressMe\b/m)[1]?.split(/^class /m)[0] ?? '';
  assert(
    /^\s{4}knowledge_level:/m.test(body),
    'ProgressMe에 knowledge_level이 없다 — 카드의 데이터 출처가 사라졌다',
  );
  assert(
    /^\s{4}knowledge_level_max:/m.test(body),
    'ProgressMe에 knowledge_level_max가 없다 — 분모를 프론트가 지어내게 된다',
  );
});

// ── 5. **목이 이 카드를 실제로 띄운다** (2026-08-12) ─────────────────────────
//
// 위 1~4는 전부 "값이 오면 어떻게 되는가"였다. 정작 **값이 오는가**를 아무도 안
// 봤고, 목의 `GET /progress/me`는 `knowledge_level`을 **안 보내고 있었다** —
// `selectKnowledgeLevel`이 항상 null → 카드가 통째로 렌더되지 않음 → 프론트
// 스모크 24종 중 어느 것도 이 카드를 본 적이 없음. 그 상태로 카드를 /me 오른쪽
// 열로 옮기는 배치 변경이 들어갔다(2026-08-12에 발견).
//
// 목 라우트가 쓰는 **바로 그 함수**를 불러 선택자에 통과시킨다. 목이 필드를
// 다시 잃으면 여기서 먼저 운다.
const { __progressMePayload } = await import('../mock/apiMockPlugin.js');

check('목의 /progress/me가 지식 단계 두 필드를 보낸다', () => {
  const me = __progressMePayload();
  assert(
    Number.isInteger(me.knowledge_level),
    `knowledge_level이 정수가 아니다 — ${JSON.stringify(me.knowledge_level)} (목이 필드를 안 보내면 카드가 통째로 사라진다)`,
  );
  assert(
    Number.isInteger(me.knowledge_level_max),
    `knowledge_level_max가 정수가 아니다 — ${JSON.stringify(me.knowledge_level_max)}`,
  );
});

check('목 응답이 선택자를 통과한다(= 카드가 뜬다)', () => {
  const picked = ability.selectKnowledgeLevel(__progressMePayload());
  assert(picked !== null, '목 응답으로 selectKnowledgeLevel이 null — 카드가 안 뜬다');
  const me = __progressMePayload();
  assert(
    picked.level === me.knowledge_level && picked.max === me.knowledge_level_max,
    `선택자 결과가 응답과 다르다 — ${JSON.stringify(picked)} vs ${me.knowledge_level}/${me.knowledge_level_max}`,
  );
});

// 목이 **반올림된 θ**로 단계를 내면 서버와 경계에서 갈린다: `abilityRows()`는
// 표시용으로 θ를 소수 2자리로 자르는데(θ=0.4951 → 0.50) 서버는 원값으로 센다.
// 그 한 칸 차이가 화면의 「10단계 중 N단계」를 통째로 바꾼다.
// 파이썬 패리티 테스트는 **변환 함수**만 대조하므로 이 파생 경로는 여기서 문다.
check('목이 반올림 전 θ로 단계를 낸다', () => {
  const src = readFileSync(resolve(here, '..', 'mock', 'apiMockPlugin.js'), 'utf8');
  const fn = src.slice(src.indexOf('function knowledgeLevelNow()'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert(
    !body.includes('abilityRows('),
    'knowledgeLevelNow가 abilityRows()(θ 2자리 반올림)를 쓴다 — 서버는 원값이라 경계에서 한 칸 갈린다',
  );
  assert(body.includes('devAbilities'), 'knowledgeLevelNow가 원 저장소(devAbilities)를 안 본다');
});

check('목 단계에 라벨이 있다(카드가 키 문자열을 그대로 띄우지 않는다)', () => {
  const { level } = ability.selectKnowledgeLevel(__progressMePayload());
  const name = ability.KNOWLEDGE_LEVEL_NAME[level];
  assert(typeof name === 'string' && name.length > 0, `${level}단계 라벨이 없다`);
});

if (failed > 0) {
  console.error(`\n실패 ${failed}건`);
  process.exitCode = 1;
} else {
  console.log('\nOK: 지식 단계 표시 계약 통과');
}
