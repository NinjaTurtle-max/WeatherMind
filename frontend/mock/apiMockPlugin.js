/**
 * 디자인/개발용 목 API 플러그인.
 * `VITE_MOCK=1 npm run dev`로 실행하면 backend 없이 /api/v1 전 엔드포인트가 동작한다.
 * 응답 스키마는 backend/app/schemas/*.py(02번 스펙)와 1:1로 맞춘다.
 *
 * R3-01: 대기 보드(§3.5)·신규 4유형(§3.6) 엔드포인트를 추가한다.
 * 보드 판정은 프론트 인터프리터(src/lib/boardEngine.js)를 그대로 재사용해
 * 백엔드 권위 채점(§3.4)을 흉내 낸다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluateBoard, checkGoals, validateBoardState } from '../src/lib/boardEngine.js';
import { tierFromElo } from '../src/lib/tierMeta.js';
import { levelFromTheta } from '../src/lib/abilityDisplay.js';
// R12 선행 §8.2 — 지역 화이트리스트. 목록의 단일 소스는 프론트 lib(geoSnap.REGIONS,
// 순수 모듈 — bare 지정자 없음)이고, 서버 KMA_GRID 12도시와의 정합은
// tests/region.smoke.test.mjs가 파일을 읽어 대조한다(parity 관례).
import { REGIONS } from '../src/lib/geoSnap.js';

const REGION_VALUES = REGIONS.map((r) => r.value);

const here = dirname(fileURLToPath(import.meta.url));

// 규칙은 database/seed/board_rules.json을 단일 진실원으로 읽는다(데이터 직군 저작).
// 파일이 없으면 계약 §3.2의 8종 명세로 임시 작성한 폴백을 쓴다(주석 표시).
function loadBoardRules() {
  try {
    return JSON.parse(readFileSync(resolve(here, '../../database/seed/board_rules.json'), 'utf-8'));
  } catch {
    // --- 폴백(임시): board_rules.json 부재 시 계약 §3.2 8종 명세로 작성 ---
    return FALLBACK_BOARD_RULES;
  }
}

// 계약 §3.2 8종 임시 규칙(데이터 실제 파일이 있으면 위에서 덮어씀)
const FALLBACK_BOARD_RULES = [
  { id: 'cold_front_shower', priority: 100, when: ['front:cold', 'moisture>=60'], then: { phenomenon: 'shower', cloud: 'cumulonimbus' }, explain: '한랭전선이 습한 공기를 파고들면 강한 상승기류로 적란운이 발달해 소나기가 내린다.' },
  { id: 'stationary_front_monsoon', priority: 90, when: ['front:stationary', 'moisture>=70'], then: { phenomenon: 'persistent_rain', cloud: 'nimbostratus' }, explain: '정체전선에 습기가 계속 공급되면 장마처럼 여러 날 비가 이어진다.' },
  { id: 'warm_front_steady_rain', priority: 80, when: ['front:warm', 'moisture>=50'], then: { phenomenon: 'rain', cloud: 'nimbostratus' }, explain: '온난전선은 따뜻한 공기가 완만하게 타고 올라 넓은 지역에 약한 비를 오래 내린다.' },
  { id: 'siberian_snow', priority: 70, when: ['air_mass:siberian', 'moisture>=60'], then: { phenomenon: 'snow', cloud: 'nimbostratus' }, explain: '시베리아 기단이 서해를 건너며 수증기를 얻으면 눈구름이 발달한다.' },
  { id: 'convective_shower', priority: 60, when: ['sun>=80', 'moisture>=60'], then: { phenomenon: 'shower', cloud: 'cumulonimbus' }, explain: '강한 일사가 습한 공기를 데우면 대류로 적란운이 발달해 소나기가 쏟아진다.' },
  { id: 'radiation_fog', priority: 50, when: ['sun<=30', 'moisture>=80'], then: { phenomenon: 'fog', cloud: 'stratus' }, explain: '일사가 약하고 습도가 높으면 복사냉각으로 안개가 낀다.' },
  { id: 'north_pacific_heatwave', priority: 40, when: ['air_mass:north_pacific', 'sun>=70'], then: { phenomenon: 'heatwave', cloud: 'none' }, explain: '덥고 습한 북태평양 기단과 강한 일사가 겹치면 폭염이 나타난다.' },
  { id: 'siberian_clear', priority: 30, when: ['air_mass:siberian', 'moisture<=40'], then: { phenomenon: 'clear', cloud: 'none' }, explain: '차고 건조한 시베리아 기단이 자리 잡으면 춥고 맑다.' },
];

const BOARD_RULES = loadBoardRules();

// ── 기후 탐정 케이스 (R13, 대장 CO-N-2) ─────────────────────────────────────
// board_rules와 같은 관례로 **database/seed/detective_cases.json을 읽는다**
// (사본 금지 — 사본은 시드가 바뀌면 조용히 갈라진다). 파일이 없으면 빈 배열이고,
// 그때 목은 서버와 같은 "0건 200" 빈 상태를 낸다(프론트 빈 화면 계약 검증용).
function loadDetectiveCases() {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(here, '../../database/seed/detective_cases.json'), 'utf-8'),
    );
    return Array.isArray(raw) ? raw.filter((c) => (c?.status ?? 'active') === 'active') : [];
  } catch {
    return [];
  }
}

const DETECTIVE_CASES = loadDetectiveCases();

// ── 과거 예보 회차 (MT-30) ───────────────────────────────────────────────────
// ⚠️ **사본이다.** 단일 진실원은 `backend/app/services/hindcast_service.py`의
// `HINDCAST_CASES`이고, 그것이 **파이썬 모듈**이라 detective처럼 JSON을 읽을 수 없다.
// 그래서 여기 값을 손으로 맞춰 두고, 갈라지는 것은 사람이 아니라
// `backend/tests/test_hindcast_mock_parity.py`가 이 파일을 파싱해 대조한다
// (test_ci_workflow_contract·test_prompt_spec_parity가 세운 「파이썬 밖 파일을
// 파싱해 대조하는 계약 테스트」 선례). 값을 고치면 양쪽을 함께 고쳐야 한다.
//
// 실측(actual)은 **여기 있어도 응답에 넣지 않는다** — 목이 정답을 흘리면 프론트가
// 목에서만 되는 로컬 판정을 짤 수 있게 된다(detective와 같은 주의). 채점은 아래
// 핸들러가 서버와 같은 공식으로 계산한다.
const HINDCAST_CASES = [
  {
    case_id: 'seoul-2018-08-01',
    observed_date: '2018-08-01',
    region: '서울',
    station: '108',
    title: '2018년 8월 1일 — 서울',
    climatology: { temp_max: 29.6, rain_prob: 70 },
    actual: { temp_max: 39.6, sum_rn: 0.0 },
  },
  // 🔴 seoul-2022-08-08은 **보류**라 여기 없다(2026-08-19 PM 판정 — 기온축 공식값
  // 미확인). 서버 픽스처에는 `enabled: false`로 남아 있고 사유·활성 조건도 거기 있다.
  // 목은 **활성 회차만** 담는다 — 이 배열과 서버의 활성분이 갈리는 것은
  // backend/tests/test_hindcast_mock_parity.py가 막는다.
];

// 「데모용 고정 날짜」 고지 — 서버 `hindcast_service.DISCLOSURE`와 같은 뜻.
// 화면은 i18n 리소스를 쓰고, 이 필드는 API를 직접 보는 쪽을 위한 것이다.
const HINDCAST_DISCLOSURE =
  '과거 관측을 서버에 적재하는 경로가 아직 없어, 공개 기록으로 검증된 ' +
  '고정 날짜만 제공하는 데모입니다. 값의 출처는 각 회차 결과에 함께 표시됩니다.';

/** 채점용 실측 — sumRn>0 → 100 이진화 (서버 hindcast_service.scoring_actual과 동일) */
function hindcastScoringActual(c) {
  return { temp_max: c.actual.temp_max, rain_prob: c.actual.sum_rn > 0 ? 100 : 0 };
}

/** 정확도 점수 — 07번 문서 공식(league_service.accuracy_score와 동일) */
function hindcastAccuracy(pred, actual) {
  const tempScore = Math.max(0, 100 - Math.abs(pred.temp_max - actual.temp_max) * 10);
  const rainScore = Math.max(0, 100 - Math.abs(pred.rain_prob - actual.rain_prob));
  return Math.round(((tempScore + rainScore) / 2) * 100) / 100;
}

// ── 문항 시드 (R10-07 §2.3) ─────────────────────────────────────────────────
// board_rules.json 선례를 확장해 **database/seed/content_items.json을 단일 진실원**
// 으로 읽는다. 손으로 베낀 픽스처는 시드가 바뀌면 조용히 갈라지고(보드 퍼즐 4 vs
// 시드 12), 그 어긋난 숫자가 관찰 보고서의 규모 서술까지 오염시켰다.
// 파생 대상: 보드 퍼즐 목록 · 배치고사 문항 · 유닛 세션 문항 · 실황 슬롯 문항 ·
//            세션 배합의 시드 오버플로.
// 파일 부재 시(테스트 환경) 폴백을 쓰고 SEED_SOURCE='fallback'으로 표시한다 —
// 계약 테스트가 "폴백으로 조용히 통과"하는 경로를 차단한다.
let SEED_SOURCE = 'seed';
function loadSeedItems() {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(here, '../../database/seed/content_items.json'), 'utf-8'),
    );
    const active = Array.isArray(raw) ? raw.filter((it) => it?.status === 'active') : [];
    if (active.length === 0) throw new Error('active 문항 0건');
    return active;
  } catch {
    SEED_SOURCE = 'fallback';
    return FALLBACK_SEED_ITEMS;
  }
}

// 폴백(임시): content_items.json 부재 시 7유형 최소 1건. 실 시드가 있으면 미사용.
const FALLBACK_SEED_ITEMS = [
  {
    concept_tag: 'pressure_front', level_group: 'middle_high', question_type: 'multiple_choice',
    uses_live_slots: false, status: 'active',
    template_json: {
      question_text: '한랭전선이 지나갈 때 나타나는 비의 특징으로 옳은 것은?',
      options: ['좁은 지역에 강한 비가 짧게 내린다', '넓은 지역에 약한 비가 오래 내린다', '비가 전혀 내리지 않는다', '전국에 같은 양의 비가 내린다'],
      correct_answer: '좁은 지역에 강한 비가 짧게 내린다',
      explanation_hint: '한랭전선은 상승기류가 급해 적운형 구름과 짧고 강한 비를 만듭니다.',
    },
  },
  {
    concept_tag: 'pressure_front', level_group: 'middle_high', question_type: 'short_answer',
    uses_live_slots: false, status: 'active',
    template_json: {
      question_text: '성질이 다른 두 기단이 만나는 경계면을 무엇이라고 하는가?',
      correct_answer: '전선', explanation_hint: '두 기단의 경계면을 전선이라고 합니다.',
    },
  },
  {
    concept_tag: 'anomaly', level_group: 'middle_high', question_type: 'multiple_choice',
    uses_live_slots: true, status: 'active',
    template_json: {
      question_text: "오늘 {today.region}의 최고기온은 {today.temp_max}도다. '이상고온' 판단의 기준은?",
      options: ['최근 30년 평균인 평년값', '어제 기온', '작년 같은 날 기온', '전국 최고기온'],
      correct_answer: '최근 30년 평균인 평년값',
      explanation_hint: '이상기후 판단의 기준은 최근 30년 평균인 평년값입니다.',
    },
  },
  {
    concept_tag: 'typhoon', level_group: 'middle_high', question_type: 'slider',
    uses_live_slots: false, status: 'active',
    template_json: {
      question_text: '열대 저기압은 중심 부근 최대 풍속이 초속 몇 m 이상일 때 태풍인가? (단위: m/s)',
      correct_answer: '17', explanation_hint: '17m/s 이상인 열대 저기압을 태풍이라고 부릅니다.',
      min: 0, max: 40, step: 1, unit: 'm/s',
    },
  },
  {
    concept_tag: 'air_mass', level_group: 'middle_high', question_type: 'match',
    uses_live_slots: false, status: 'active',
    template_json: {
      question_text: '계절과 대표 기단을 연결하세요.',
      pairs: [
        { left: '겨울', right: '시베리아 기단' },
        { left: '여름', right: '북태평양 기단' },
      ],
      correct_answer: '겨울:시베리아 기단|여름:북태평양 기단',
      explanation_hint: '발원지가 대륙이면 건조, 해양이면 다습합니다.',
    },
  },
  {
    concept_tag: 'typhoon', level_group: 'middle_high', question_type: 'ordering',
    uses_live_slots: false, status: 'active',
    template_json: {
      question_text: '태풍의 일생을 순서대로 배열하세요.',
      items: ['열대 저기압 발생', '태풍으로 발달', '최성기', '온대저기압으로 쇠약'],
      shuffled: true, correct_answer: '0,1,2,3',
      explanation_hint: '태풍은 발생 → 발달 → 최성기 → 쇠약 순으로 일생을 마칩니다.',
    },
  },
  {
    concept_tag: 'heat_island', level_group: 'middle_high', question_type: 'cloze',
    uses_live_slots: false, status: 'active',
    template_json: {
      question_text: '밤 최저기온이 ___℃ 아래로 내려가지 않는 밤을 열대야라고 한다.',
      correct_answer: '25', explanation_hint: '열대야의 기준은 밤 최저기온 25℃입니다.',
    },
  },
  {
    concept_tag: 'pressure_front', level_group: 'middle_high', question_type: 'board',
    uses_live_slots: false, status: 'active',
    template_json: {
      question_text: '수도권에 소나기를 내려 보세요.',
      mode: 'guided',
      guide_steps: ['수도권(존 1)에 한랭전선을 놓아 보세요.', '같은 존의 습기를 60 이상으로 올려 보세요.'],
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['front:cold', 'moisture'],
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      hints: ['비가 내리려면 습기가 충분해야 해요.', '찬 공기가 파고들면 적란운이 발달해요.'],
      correct_answer: '',
    },
  },
];

const SEED_ITEMS = loadSeedItems();

// ── 유형별 플레이 페이로드 화이트리스트 ─────────────────────────────────────
// backend routers/session.QUESTION_PAYLOAD_FIELDS의 사본. 서버는 이 필드들을
// **template_json 안에** 실어 보내므로(최상위 아님) 목도 같은 모양으로 낸다 —
// 최상위만 읽는 컴포넌트를 새로 쓰면 R10-07 결함이 재발한다.
// correct_answer·explanation_hint는 어떤 유형에서도 목록에 없다(구조적 미노출).
// 드리프트는 backend tests/test_r10_mock_parity_contract.py가 감시한다.
const QUESTION_PAYLOAD_FIELDS = {
  board: [
    'question_text', 'mode', 'guide_steps', 'initial_state', 'palette',
    'goal_conditions', 'hints', 'time_limit_sec', 'based_on',
  ],
  match: ['pairs'],
  ordering: ['items', 'shuffled'],
  slider: ['min', 'max', 'step', 'unit'],
};

/** 유형별 플레이 필드만 추린 template_json (없으면 null — 빈 값 주입 금지). */
function questionPayload(template, questionType) {
  const fields = QUESTION_PAYLOAD_FIELDS[questionType];
  if (!fields) return null;
  const payload = {};
  for (const key of fields) if (key in template) payload[key] = template[key];
  return Object.keys(payload).length > 0 ? payload : null;
}

// ── 실황 슬롯 치환 (§3.3 허용 5종) ──────────────────────────────────────────
// 서버 session_service.fill_live_slots와 같은 규칙으로 {today.*}를 치환한다.
// 값은 목 고정 실황(KMA 캐시 대역) — 미치환 원문이 유저에게 보이지 않게 한다.
const LIVE_SLOT_VALUES = {
  'today.sky': '구름많음',
  'today.rain_prob': '60',
  'today.temp_max': '31',
  'today.temp_min': '24',
};
// today.region은 유저 설정 지역을 탄다(R12 선행 §8.2 — 서버 fill_live_slots 배선과
// 동일 의미론). state는 아래에서 선언되지만 이 함수는 요청 시점에만 불린다(TDZ 무관).
function liveSlotValue(key) {
  return key === 'today.region' ? state.region : LIVE_SLOT_VALUES[key];
}
const SLOT_RE = /\{(today\.[a-z_]+)\}/g;
function fillLiveSlots(value) {
  if (typeof value === 'string') {
    return value.replace(SLOT_RE, (m, key) => liveSlotValue(key) ?? m);
  }
  if (Array.isArray(value)) return value.map(fillLiveSlots);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillLiveSlots(v)]));
  }
  return value;
}

// 슬라이더 허용 오차 — backend answer_service.SLIDER_TOLERANCE와 동일값
const SLIDER_TOLERANCE = 10;

/**
 * 해설의 **출처** — server `answer_service.feedback_source()`의 사본.
 * 우선순위까지 같다: board면 `board`, 사람이 쓴 해설(`explanation_hint`)이 있으면
 * `authored`, 없으면 `ai`.
 *
 * 🔴 **목이 이 필드를 아예 안 보내고 있었다**(2026-08-20 전수 대조). 화면
 * (`FeedbackPanel`)이 **부재를 `ai`로 폴백**하므로, 목으로 도는 화면은 **사람이
 * 저작한 해설에도 「AI」 배지**를 붙였다. 그 파일 주석이 스스로 적어 두었다 —
 * *「배점 ⑤(생성형 AI 활용)에 직결되는 표기 오류」*.
 * ⚠️ 값을 손으로 넣지 않는다. 서버와 **같은 우선순위로 파생**한다.
 */
function feedbackSourceOf(questionType, template) {
  if (questionType === 'board') return 'board';
  return String(template?.explanation_hint ?? '').trim() ? 'authored' : 'ai';
}

/** 시드 template_json → 목 전용 채점 정보(_mock). 응답 직전 stripMock이 제거한다. */
function seedGrading(questionType, template) {
  const correct = template.correct_answer ?? '';
  const hint = template.explanation_hint ?? '';
  const feedbackSource = feedbackSourceOf(questionType, template);
  const feedbackCorrect = hint ? `정확해요! ${hint}` : '정확해요!';
  const feedbackWrong = hint
    ? `아쉬워요! 정답은 "${correct}"이에요. ${hint}`
    : `아쉬워요! 정답은 "${correct}"이에요.`;
  if (questionType === 'board') {
    return {
      feedbackSource,
      goal_conditions: template.goal_conditions ?? [],
      feedbackCorrect: '정확해요! 목표 대기현상을 만들었어요.',
      feedbackWrong: `아직이에요. ${template.hints?.[0] ?? '배치를 바꿔 다시 시도해 보세요.'}`,
    };
  }
  if (questionType === 'slider') {
    return { correct, tolerance: SLIDER_TOLERANCE, feedbackCorrect, feedbackWrong, feedbackSource };
  }
  if (questionType === 'match') {
    return { correct, pairs: template.pairs ?? [], feedbackCorrect, feedbackWrong, feedbackSource };
  }
  if (questionType === 'ordering') {
    return { correct, correctOrder: correct, feedbackCorrect, feedbackWrong, feedbackSource };
  }
  // multiple_choice·short_answer·cloze — 텍스트 채점은 공백·대소문자 무시
  return { correct, accept: [correct], feedbackCorrect, feedbackWrong, feedbackSource };
}

/** 시드 1건 → SessionItem 모양의 목 문항(+_mock). 서버 _to_session_item과 같은 형태. */
function seedToSessionItem(seed, { quizId, source = 'bank' }) {
  const template = fillLiveSlots(seed.template_json ?? {});
  const type = seed.question_type;
  return {
    quiz_id: quizId,
    concept_tag: seed.concept_tag,
    question_type: type,
    question_text: template.question_text ?? '',
    options: template.options ?? null,
    level_group: seed.level_group ?? 'middle_high',
    // 지식 단계(난이도 축) — 서버 SessionItem.knowledge_level과 같은 필드.
    // 시드 행의 컬럼값을 **파생 없이** 그대로 흘린다(서버 session_service와 동일).
    // 없으면 null이고 화면은 배지를 그리지 않는다 — 목이 값을 지어내면 "구 데이터엔
    // 배지가 안 뜬다"는 계약을 목에서 검증할 수 없게 된다.
    knowledge_level: seed.knowledge_level ?? null,
    source,
    slot_filled: Boolean(seed.uses_live_slots),
    template_json: questionPayload(template, type),
    _mock: seedGrading(type, template),
  };
}

// 하루 경계는 **KST**다 — 서버가 `datetime.now(KST).date()`로 "오늘"을 정의한다
// (`session_service.kst_day_start_utc`). `toISOString()`은 UTC라, 이 목은 R2부터
// 하루가 **09:00 KST**에 넘어갔다: 자정 리셋을 기대하는 화면이 목에서는 오전 9시에
// 리셋되는 것으로 보였다(R10-01 D9 — 실서버는 정상, 목만 시프트).
// UTC 시각에 +9h를 더한 뒤 잘라내면 그 순간의 KST 날짜가 나온다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstDate = (epochMs) => new Date(epochMs + KST_OFFSET_MS);
const todayISO = () => kstDate(Date.now()).toISOString().slice(0, 10);

const weekStartISO = () => {
  const d = kstDate(Date.now());
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // 월요일 기준(KST 요일)
  return d.toISOString().slice(0, 10);
};

// 세션 간 유지되는 간단한 인메모리 상태 (dev server 재시작 시 초기화)
const state = {
  xp: 1180,
  level: 4,
  streak: 6,
  streakFreeze: 1, // 구름 방패 보유 수 (§3.5, 최대 2) — 스트릭 방어 자원(clouds와 독립)
  answeredToday: false,
  // 오늘 응답한 문항 수 (R10-01 D4·D10) — /progress/me의 today_answered_count.
  // 서버는 answered_at 날짜로 매번 재계산하므로 목도 날짜가 바뀌면 0에서 시작해야
  // 한다 → answeredCountDate 앵커로 지연 리셋한다(rolloverAnsweredCount).
  answeredTodayCount: 0,
  answeredCountDate: null, // 카운트가 속한 날짜(todayISO). null이면 다음 접근 시 재앵커.
  // 일일 목표 문항 수 (R10-01 D4, users.daily_goal_items) — null=미설정.
  dailyGoalItems: null,
  predicted: false,
  tier: 'nimbostratus', // 최근 정산 티어 (§3.2 /progress/me)
  // 일일 퀘스트 진행 (§3.1) — 당일 집계 흉내. 디자인 검토용 초기 진행값 시드.
  // doneCodes = **이미 완료로 전환된** 코드들. 서버 UserQuestProgress.done(sticky)의
  // 목 대응물이고, 이것이 있어야 "이번에 새로 완료됐다"(newly_done)를 말할 수 있다
  // — 진행도만 들고 있으면 재계산할 때마다 완료가 새로 일어난 것처럼 보인다 (CO-T-4).
  quest: { xpToday: 20, weakCorrect: 0, liveAnswered: 0, doneCodes: [] },
  // 예보 대결 (§3.4) — 오늘 제출 상태. evidence: 선택한 판단 근거 (R9-01 §3.1)
  duel: { submitted: false, userPred: null, aiPred: null, evidence: null },
  // 과거 예보 (MT-30) — 회차당 1회. 제출된 판정 결과를 case_id로 들고 있다.
  hindcastAttempts: [],
  // 구름 에너지 (R5-01 §3.3) — 소모성 플레이 자원. 지연 회복 모델.
  clouds: 10,
  cloudsUpdatedAt: Date.now(),
  // 온보딩 배치고사 (R7-01 S3) — 1회 완료 여부. 완료 후 start는 409.
  placementDone: false,
  // 학습 지역 (R12 선행 §8.2, users.region) — 서버는 NULL=서울로 해석하므로
  // 목은 해석 완료값 '서울'을 기본으로 든다(me 응답 형태 동일).
  region: '서울',
};

// ── 오늘 응답 수 (R10-01 D4·D10) ────────────────────────────────────────────
// 목 서버는 며칠씩 떠 있으므로 자정을 넘기면 카운트가 누적돼 "오늘 목표 N/M"이
// 틀린다. regenClouds가 cloudsUpdatedAt으로 하는 **지연 계산** 관례를 그대로
// 따라, 읽기·증가 시점에 앵커 날짜를 확인해 하루가 바뀌었으면 0으로 되돌린다.
// 날짜 기준은 ensureSession의 session_date와 같은 todayISO() — 목 내부 일관성.
// 기존 answeredToday 불린(R5)은 이번 스코프가 아니므로 동작을 바꾸지 않는다.

/** 앵커 날짜가 오늘이 아니면 카운트를 0으로 되돌린다(지연 리셋). */
function rolloverAnsweredCount() {
  const today = todayISO();
  if (state.answeredCountDate !== today) {
    state.answeredCountDate = today;
    state.answeredTodayCount = 0;
  }
}

/** 응답 1건 반영 — 증가 전에 날짜 경계를 확인한다. */
function bumpAnsweredToday() {
  rolloverAnsweredCount();
  state.answeredTodayCount += 1;
}

/** /progress/me의 today_answered_count — 읽기 시점에도 지연 리셋. */
function todayAnsweredCount() {
  rolloverAnsweredCount();
  return state.answeredTodayCount;
}

// ── 복습 큐 (R11-01 C2 · §6.2) — 응답 이력 파생 read-model ──────────────────
// 서버 review_schedule_service와 같은 의미론을 **목 내부 응답 이력**에서 매 요청
// 재계산한다(손으로 박은 정적 큐 금지 — 응답이 큐를 실제로 움직여야 카드가 목에서
// 검증 가능하다). 서버 계약:
// - 사다리 REVIEW_INTERVALS_DAYS(1·3·7·14·30) — 인덱스 = 말미 연속 정답 횟수
//   (오답이 나오면 0으로 리셋), 끝을 넘으면 마지막 값(캡).
// - 다음 복습일 = 마지막 응답의 KST 달력일 + 간격 → KST 자정(UTC 표기).
// - 배치고사 응답은 **기록하지 않는다**(서버 history_stmt 제외 — D10-2 전례).
//   보드 연습 시도는 기록한다(서버가 session_id null quiz_logs로 남기고 이력에 포함).
// - 전 개념이 실려 오고 due 필터는 소비자(ReviewQueueCard) 몫.
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30];

// "N일 전 KST 정오"의 epoch ms — 자정 경계 모호성 없이 항상 그 KST 달력일에 속한다.
const kstNoonDaysAgoMs = (days) => {
  const d = kstDate(Date.now());
  return (
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - days, 12) - KST_OFFSET_MS
  );
};

// 초기 이력 시드 — **파생의 입력**이지 큐 자체가 아니다(state.xp=1180 등과 같은
// 디자인 검토용 시드). answered_at 오름차순. 파생 결과(오늘 기준, 결정적):
//   typhoon       스트릭 2 → 간격 7일  → 3일 전 도래 (due)
//   heat_island   스트릭 1 → 간격 3일  → 1일 전 도래 (due)
//   air_mass      스트릭 0(오답 리셋) → 간격 1일 → 1일 전 도래 (due)
//   pressure_front 스트릭 3 → 간격 14일 → 내일 도래 (미due — 카드 필터 검증용)
const seedAnswerHistory = () => [
  { concept_tag: 'pressure_front', is_correct: true, answered_at: kstNoonDaysAgoMs(15) },
  { concept_tag: 'pressure_front', is_correct: true, answered_at: kstNoonDaysAgoMs(14) },
  { concept_tag: 'pressure_front', is_correct: true, answered_at: kstNoonDaysAgoMs(13) },
  { concept_tag: 'typhoon', is_correct: true, answered_at: kstNoonDaysAgoMs(12) },
  { concept_tag: 'typhoon', is_correct: true, answered_at: kstNoonDaysAgoMs(10) },
  { concept_tag: 'heat_island', is_correct: true, answered_at: kstNoonDaysAgoMs(4) },
  { concept_tag: 'air_mass', is_correct: false, answered_at: kstNoonDaysAgoMs(2) },
];
let answerHistory = seedAnswerHistory();

/** 응답 1건 기록(서버 quiz_logs 1행 대응) — 채점 확정 시점 호출, 배치고사 제외. */
function recordAnswerFact(conceptTag, isCorrect) {
  answerHistory.push({ concept_tag: conceptTag, is_correct: isCorrect, answered_at: Date.now() });
}

/** 말미 연속 정답 횟수 → 간격(일). 서버 interval_days와 동일(끝 초과는 캡). */
const reviewIntervalDays = (streak) =>
  REVIEW_INTERVALS_DAYS[Math.min(streak, REVIEW_INTERVALS_DAYS.length - 1)];

/** (마지막 응답의 KST 달력일 + 간격일)의 KST 자정 — UTC epoch ms. 서버 next_review_at. */
function nextReviewAtMs(lastAnsweredMs, streak) {
  const d = kstDate(lastAnsweredMs); // UTC 필드가 곧 KST 달력일(위 kstDate 주석)
  return (
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + reviewIntervalDays(streak)) -
    KST_OFFSET_MS
  );
}

/** GET /progress/review-queue 페이로드 — ReviewQueueItem[] 6필드, 서버와 동일 형태.
 *  이력을 시간 오름차순으로 접어(정답 +1·오답 리셋 0) 개념별 요약을 만들고,
 *  next_review_at 오름차순(동률은 concept_tag)으로 정렬한다 — due가 자연히 앞. */
function reviewQueuePayload(nowMs = Date.now()) {
  const streaks = new Map();
  const lastAt = new Map();
  const ordered = [...answerHistory].sort((a, b) => a.answered_at - b.answered_at);
  for (const fact of ordered) {
    streaks.set(fact.concept_tag, fact.is_correct ? (streaks.get(fact.concept_tag) ?? 0) + 1 : 0);
    lastAt.set(fact.concept_tag, fact.answered_at);
  }
  return [...lastAt.entries()]
    .map(([tag, lastMs]) => {
      const streak = streaks.get(tag);
      const dueAtMs = nextReviewAtMs(lastMs, streak);
      return {
        concept_tag: tag,
        last_answered_at: new Date(lastMs).toISOString(),
        consecutive_correct: streak,
        interval_days: reviewIntervalDays(streak),
        next_review_at: new Date(dueAtMs).toISOString(),
        due: nowMs >= dueAtMs,
      };
    })
    .sort((a, b) =>
      a.next_review_at !== b.next_review_at
        ? (a.next_review_at < b.next_review_at ? -1 : 1)
        : (a.concept_tag < b.concept_tag ? -1 : 1),
    );
}

// ── 게스트→정식 전환 (R11-01 §6.2 — BE-1 계약의 목 대응) ────────────────────
// 목은 단일 유저 세계라 "현재 계정이 게스트인가"를 불린 하나로 흉내 낸다:
// POST /auth/guest → true · register/login/convert 성공 → false.
// registeredEmails는 서버 users.email 유니크 제약의 대응물 — 중복 검증용으로
// 기존 가입 이메일 1건을 시드한다(스모크·디자인에서 409 경로 재현).
// level_group은 서버 users.level_group의 목 대응물이다 (R13 CO-P-5). 종전에는
// 목에 학령 자체가 없어서 "게스트는 평생 middle_high"라는 결함을 목 위 스모크로는
// 원리적으로 볼 수 없었다 — 이제 GET/PATCH /auth/me가 서버와 같은 형태로 읽고 쓴다.
// takenNicknames는 서버 **닉네임 유일성 검사**의 대응물이다 —
// ⚠️ **DB 유니크 제약이 아니다.** `users.nickname`에는 제약이 없고(기존 게스트가
// 자동 닉네임 `게스트-xxxxxx`를 공유해 인덱스가 만들어지지 않는다) 유일성은
// `guest_login`이 **신고 경로에서만** SELECT로 확인한다(대장 §4.16).
// registeredEmails와 **같은 관례**로, 이미 쓰이고 있는 이름 1건을 시드해 409 경로를
// 목 위에서 재현한다. 시드값은 새로 지어낸 이름이 아니라 **목이 이미 「쓰이고 있다」고
// 선언한 이름**이다: `meResponse`의 정식 계정 닉네임 '날씨러버'.
// ⚠️ 리그 리더보드의 닉네임 10종은 **시드하지 않는다.** 그 배열의 '구름사냥꾼'은
// i18n 예시 문구(`entryInfo.nicknamePlaceholder`)이자 entryFlow ⑧-a가 실제로 적어
// 넣는 이름이라, 시드하면 「적은 이름이 바디에 실린다」 계약이 409로 무너진다.
// nickname은 현재 게스트가 신고한 이름(없으면 null → 서버 자동 닉네임 자리).
const mockAuth = {
  isGuest: false,
  levelGroup: 'middle_high', // 서버 GUEST_LEVEL_GROUP과 같은 무정보 기본값
  nickname: null,
  registeredEmails: new Set(['taken@weathermind.dev']),
  takenNicknames: new Set(['날씨러버']),
  /**
   * 🔴 **저장을 마친 계정의 자격** — `POST /auth/resume`의 목 대응물
   * (2026-08-19 오후 · 클라이언트 결정 「불러오기는 로그인 인증으로」).
   *
   * ⚠️ **`takenNicknames`가 아니라 여기가 불러오기의 소유자다.** 같은 날 오전
   * 판은 닉네임 집합을 열쇠로 썼는데, 그러면 **이름만 맞히면 남의 진도가 열린다** —
   * 화면이 아니라 서버가 그랬고, 목도 그것을 그대로 리허설하고 있었다.
   *
   * ⚠️ 시드는 지어낸 값이 아니라 **목이 이미 「등록돼 있다」고 선언한 이메일**
   * (`registeredEmails`)과 짝을 맞춘다 — 저장(`guest/convert`)이 넣는 그 집합이다.
   * 비밀번호는 서버 `SaveProgressForm`의 `minLength=8`을 만족해야 목에서만
   * 통과하는 값이 안 생긴다.
   *
   * ⚠️ **게스트는 여기 없다.** 서버에서 게스트 비밀번호는 무작위 시크릿이라 이
   * 문을 못 연다 — 목이 게스트를 넣어 두면 실서버에 없는 경로가 초록이 된다.
   */
  savedAccounts: new Map([['saved@weathermind.dev', 'weathermind-8']]),
};

// 서버 schemas/auth.LevelGroup Literal과 같은 3값 — 목이 사본을 갖는 대신
// __mockPolicy()로 노출해 backend 계약 테스트가 실값으로 대조한다(CO-J-9).
const LEVEL_GROUPS = ['elementary', 'middle_high', 'adult'];

// 서버 routers/auth.GUEST_EMAIL_DOMAIN — 프론트 isGuestUser의 두 번째 판별 신호가
// 이 도메인이라, 목 응답도 같은 규약을 따라야 "게스트인데 게스트가 아니라고 읽힘"이
// 생기지 않는다(RFC 2606 예약 TLD).
const GUEST_EMAIL_DOMAIN = 'guest.weathermind.invalid';
const MOCK_USER_ID = '2b1c8b1e-0000-4000-8000-000000000001';

/** GET/PATCH /auth/me 응답 (서버 MeResponse 5필드 — R13 CO-P-4/P-5/P-10).
 *  서버가 "너는 누구인가"를 알려주는 유일한 경로다. 게스트 판별이 클라 상태에만
 *  의존하면 그 상태가 유실될 때 로그아웃 경고가 사라지고(진도 영구 소실),
 *  학령 설정 화면이 자기 현재값을 모른다. */
const meResponse = () => ({
  user_id: MOCK_USER_ID,
  email: mockAuth.isGuest
    ? `guest-${MOCK_USER_ID}@${GUEST_EMAIL_DOMAIN}`
    : 'demo@weathermind.dev',
  // 게스트가 이름을 신고했으면 그 이름으로 유저가 만들어진 것이다 — 신고가 없으면
  // 서버가 짓는 자동 닉네임(`게스트-{uuid6}`)의 목 대응물로 되돌아간다.
  nickname: mockAuth.isGuest ? (mockAuth.nickname ?? '게스트-2b1c8b') : '날씨러버',
  is_guest: mockAuth.isGuest,
  level_group: mockAuth.levelGroup,
});

// ── 개발자 모드 (R7-03) ─────────────────────────────────────────────────────
// 실서버는 Settings.DEV_MODE가 꺼져 있으면 /dev/* 전 경로 404 — 목은
// VITE_MOCK_DEV=0 으로 같은 404 모드를 재현한다(기본은 켜짐).
const DEV_MODE = process.env.VITE_MOCK_DEV !== '0';

// 개념별 능력(θ) 저장소 — /dev/state·/dev/theta·(배치 완료 시 갱신) 공유.
// 초기값은 사전(prior) 배정 흉내: θ 0.0 · num_responses 0.
const CONCEPT_TAGS = ['air_mass', 'anomaly', 'co2_climate', 'heat_island', 'pressure_front', 'typhoon'];
const seedAbilities = () =>
  new Map(CONCEPT_TAGS.map((tag) => [tag, { theta: 0.0, num_responses: 0 }]));
let devAbilities = seedAbilities();

const abilitySE = (n) => Number((1 / Math.sqrt(n + 1)).toFixed(2));
const abilityRows = () =>
  [...devAbilities.entries()].map(([concept_tag, { theta, num_responses }]) => ({
    concept_tag,
    theta: Number(theta.toFixed(2)),
    theta_se: abilitySE(num_responses),
    num_responses,
  }));

/**
 * `GET /progress/abilities` 응답 — 라우트가 부르는 **바로 이 함수**를
 * `__abilitiesPayload`로 내보내 계약이 같은 것을 문다(§5 관례).
 *
 * 🔴 **`knowledge_level`을 함께 싣는다**(2026-08-20). 안 실어서 `/me`의 개념 칩이
 *   전부 「초급」이었다 — WeatherBrainPanel이 이 필드로 교과 표기를 그리고,
 *   없으면 4밴드로 내려앉는다(QA 롤링 0820 ⑴의 원인).
 *
 * ⚠️ **단계는 반올림 전 θ로 낸다.** `abilityRows()`는 표시용으로 θ를 소수 2자리로
 *   자르는데(0.4951 → 0.50) 서버는 원값으로 센다. 그 한 칸 차이가 「10단계 중 N」을
 *   통째로 바꾼다 — `/progress/me`가 같은 자리에서 이미 한 번 겪었고
 *   `knowledgeLevel.test.mjs`가 그 경위를 들고 있다.
 */
const abilitiesPayload = () =>
  [...devAbilities.entries()]
    .map(([concept_tag, { theta, num_responses }]) => ({
      concept_tag,
      theta: Number(theta.toFixed(2)),
      theta_se: abilitySE(num_responses),
      num_responses,
      level_label: levelFromTheta(theta),
      knowledge_level: thetaToKnowledgeLevel(theta), // ← 원 θ
      knowledge_level_max: KNOWLEDGE_LEVEL_MAX,
      updated_at: null,
    }))
    .sort((a, b) => a.theta - b.theta);

/**
 * 대표 θ — backend `weatherbrain_service.overall_theta`와 **같은 규칙**이다:
 * n 가중 평균, 전부 n=0이면 단순 평균, 행이 없으면 null(콜드스타트).
 * 종전에는 devStatePayload가 여기서 단순 평균만 썼는데, 시드가 n=0이라 값이
 * 같아 드리프트가 안 보였을 뿐이다 — 배치고사·응답으로 n이 붙는 순간 갈렸다.
 */
function overallTheta(rows) {
  if (!rows.length) return null;
  const totalN = rows.reduce((sum, r) => sum + (r.num_responses || 0), 0);
  if (totalN <= 0) return rows.reduce((sum, r) => sum + r.theta, 0) / rows.length;
  return rows.reduce((sum, r) => sum + r.theta * (r.num_responses || 0), 0) / totalN;
}

/**
 * θ → 지식 단계(1..MAX) — backend `weatherbrain_service.theta_to_knowledge_level`의
 * **사본**이다. 4밴드(thetaToLevelGroup)와 같은 축을 더 잘게 나눈 뷰다.
 *
 * ⚠️ 이 상수 둘은 서버가 소유하고 여기 있는 것은 사본이라, `__mockPolicy()`로
 * 노출해 `test_r13_mock_policy_parity`가 서버 실값과 대조한다(CO-J-9 관례).
 * **테스트에 기대값 사본을 또 쓰지 말 것** — 그러면 계약이 자기 자신을 본다.
 */
/** 학령 → 표현 톤. server weatherbrain_service.LEVEL_GROUP_TONE의 사본. */
const LEVEL_GROUP_TONE = {
  elementary: 'child',
  middle_high: 'teen',
  adult: 'adult',
  expert: 'adult', // 신고 학령은 아니지만 서버가 방어적으로 성인 톤에 붙인다
};

const KNOWLEDGE_LEVEL_MIN = 1;
const KNOWLEDGE_LEVEL_MAX = 10;
const THETA_KNOWLEDGE_LEVEL_BOUNDS = [-1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 1.75, 2.0, 2.25];

function thetaToKnowledgeLevel(theta) {
  const i = THETA_KNOWLEDGE_LEVEL_BOUNDS.findIndex((bound) => theta < bound);
  return i < 0 ? KNOWLEDGE_LEVEL_MAX : KNOWLEDGE_LEVEL_MIN + i;
}

/**
 * 지금의 대표 지식 단계 — 서버 `overall_knowledge_level`과 같은 경로.
 * ⚠️ **`abilityRows()`를 쓰지 않는다.** 그쪽은 표시용으로 θ를 소수 2자리로
 * 반올림하는데 서버는 원값으로 계산한다 — θ=0.495면 목은 5단계(0.50 < 0.5가
 * 거짓), 서버는 4단계로 갈린다(2026-08-12 리뷰). 저장소 원값을 그대로 본다.
 */
function knowledgeLevelNow() {
  const rows = [...devAbilities.values()].map((a) => ({
    theta: a.theta,
    num_responses: a.num_responses,
  }));
  const theta = overallTheta(rows);
  return theta === null ? null : thetaToKnowledgeLevel(theta);
}

/**
 * θ → 출제 대상 레벨 그룹. 경계는 backend `weatherbrain_service.LEVEL_GROUP_BANDS`
 * (·ai-worker theta_to_target_level_group)와 동일하다.
 *
 * ⚠️ **expert가 빠져 있었다**(2026-08-12 발견). 서버는 4밴드
 * (elementary/middle_high/adult/**expert**)이고 θ≥1.5가 expert인데 목은 adult를
 * 냈다. 지식 단계 축을 붙이면서 드러난 어긋남이다 — 같은 θ에서 목이
 * 「9단계(expert 구간)」이라 하면서 밴드는 adult라고 말하는 자기모순이었다
 * (두 축은 접으면 같아야 한다: level_group_of_knowledge_level ∘
 *  theta_to_knowledge_level == theta_to_level_group).
 */
function thetaToLevelGroup(theta) {
  if (theta < -0.5) return 'elementary';
  if (theta < 0.5) return 'middle_high';
  if (theta < 1.5) return 'adult';
  return 'expert';
}

// DEV_MODE 꺼진 실서버(FastAPI 라우터 미등록)의 기본 404 본문과 동일
const DEV_404 = [404, { detail: 'Not Found' }];

/** GET /dev/state 페이로드 (R7-03 계약) — 조작 POST들도 최신 상태를 되돌려준다 */
function devStatePayload() {
  regenClouds();
  const rows = abilityRows();
  // 서버와 같은 규칙(n 가중) — 위 overallTheta 주석 참조.
  const overall = Number((overallTheta(rows) ?? 0).toFixed(2));
  return {
    dev_mode: true,
    abilities: rows,
    overall_theta: overall,
    target_level_group: thetaToLevelGroup(overall),
    // unlock_floor: 배치 θ 선해제가 연 선두 연속 유닛 수 (backend placement_unlock_floor)
    unlock_floor: preUnlockedUnits.size,
    clouds: state.clouds,
    // 서버 `DevState.max_clouds` — 목이 빼먹고 있었다(2026-08-20 전수 대조).
    max_clouds: CLOUD_MAX,
    streak_count: state.streak,
    placement_done: state.placementDone,
    // θ 파생 약점 (R8-01 §3.5, backend build_state와 동일 규칙): n>0 AND θ<0.41.
    // /dev/theta 조작이 즉시 반영된다 — 정적 WEAK_TAGS(퀘스트 판정용)와 별개.
    weak_tags: rows
      .filter((r) => r.num_responses > 0 && r.theta < 0.41)
      .map((r) => r.concept_tag),
  };
}

// ── 구름 에너지 상수 (R5-01 §3.3) ──
const ENERGY_ENABLED = true; // §3.4 기능 플래그(기본 true). false면 무제한.
// 서버 `Settings.CLOUD_MAX`와 같아야 한다 — 갈리면 스모크가 실화면을 안 본다.
const CLOUD_MAX = 10;
const CLOUD_REGEN_MS = 20 * 60 * 1000; // 20분당 1개 회복
const CLOUD_COST = 1; // 소모 1회분 (R10-01 §3.1: 수치 불변, 트리거만 변경)

// 일일 목표 허용값 (R10-01 §3.4·D4) — 서버 `routers/progress.py`와 같아야 한다.
// ⚠️ 2026-08-19: 최대값이 9 → 하루 세션 문항 수(SESSION_RECIPE 합 10)로 바뀌었다.
// 종전에는 "SESSION_RECIPE와 독립된 표시용 타깃"이라 적혀 있었고 설계로는 옳았으나
// 화면에서 「오늘 목표 10/9」가 됐다(클라이언트 반려). 3·5는 부분 목표라 그대로다.
const DAILY_GOAL_CHOICES = [3, 5, 10];

/** 지연 회복(§3.3): 읽기·소모 시점에 elapsed로 회복량 계산·clamp·anchor 갱신 */
function regenClouds() {
  if (state.clouds >= CLOUD_MAX) {
    state.cloudsUpdatedAt = Date.now();
    return;
  }
  const elapsed = Date.now() - state.cloudsUpdatedAt;
  const gained = Math.floor(elapsed / CLOUD_REGEN_MS);
  if (gained > 0) {
    state.clouds = Math.min(CLOUD_MAX, state.clouds + gained);
    state.cloudsUpdatedAt =
      state.clouds >= CLOUD_MAX ? Date.now() : state.cloudsUpdatedAt + gained * CLOUD_REGEN_MS;
  }
}

/** 다음 1개 회복까지 남은 초 (가득 차면 0) */
function nextRegenSec() {
  if (state.clouds >= CLOUD_MAX) return 0;
  return Math.max(0, Math.ceil((state.cloudsUpdatedAt + CLOUD_REGEN_MS - Date.now()) / 1000));
}

/** GET /progress/energy 페이로드 (§3.3) */
function energyPayload() {
  regenClouds();
  return {
    clouds: state.clouds,
    max: CLOUD_MAX,
    next_regen_sec: nextRegenSec(),
    updated_at: new Date(state.cloudsUpdatedAt).toISOString(),
  };
}

// ── R10-01 §3.1 에너지 정책 전환 ────────────────────────────────────────────
// 구름은 **노력이 아니라 실수에 소모된다**: 소모는 채점 결과가 오답일 때만 1.
// 대신 문항을 열기 전에 잔량을 검사해 차단한다. 이미 발급된 세션의 진행 중
// 문항은 절대 차단하지 않는다("풀던 것을 뺏기지 않는다" 불변식 — §3.1 각주 7).
// 서버 대응: energy_service.should_consume / require_entry / consume_if_available.
// 회복 모델(만렙 5·20분당 1)은 불변 — 바뀐 것은 소모 트리거와 차단 시점뿐이다.

/** 소모 트리거(순수, server should_consume). 오답·미통과에만 true.
 *  정답·재제출(멱등 히트)·배치고사는 false. 보드는 passed를 isCorrect로 넘긴다. */
function shouldConsumeCloud({ isCorrect, alreadyAnswered = false, isPlacement = false }) {
  return !isCorrect && !alreadyAnswered && !isPlacement;
}

/** 진입 게이트(server require_entry). {ok:true} 또는 {ok:false, next_regen_sec}.
 *  **소모하지 않는다** — 검사 전용. 잔량 부족이면 호출측이 429 OUT_OF_CLOUDS로 변환.
 *  차단 지점 3곳(D6): 세션 신규 발급 · 유닛 세션 발급 · 퍼즐 상세 진입. */
function requireCloudEntry() {
  if (!ENERGY_ENABLED) return { ok: true };
  regenClouds();
  if (state.clouds < CLOUD_COST) return { ok: false, next_regen_sec: nextRegenSec() };
  return { ok: true };
}

/** 가드된 소모(server consume_if_available). 반환: 소모 후 잔량.
 *  잔량이 부족하면 **429 없이** 무소모로 통과한다(§3.1 각주 7) — 마지막 구름으로
 *  진입해 오답을 낸 진행 중 세션을 끊지 않기 위한 예외. 음수가 되지 않는다. */
function consumeCloudIfAvailable() {
  if (!ENERGY_ENABLED) return CLOUD_MAX;
  regenClouds();
  if (state.clouds < CLOUD_COST) return state.clouds; // 가드 UPDATE 0행 분기
  // MAX에서 처음 소모하면 이 시점부터 회복 타이머 시작
  if (state.clouds >= CLOUD_MAX) state.cloudsUpdatedAt = Date.now();
  state.clouds -= CLOUD_COST;
  return state.clouds;
}

/** 소모 결과 응답 필드 {clouds_spent, clouds} (server D10-1 — 서버와 동일 산출).
 *  소모 **전후 실측 차이**로 낸다: 오답이어도 잔량 0이면 무소모 통과라 0이 되고,
 *  무제한 모드(ENERGY_ENABLED=false)에서도 0이다. 프론트가 is_correct로 "구름 −1"을
 *  계산하면 이 두 경우에 거짓 표기가 되므로 서버 실측을 그대로 읽는다.
 *  trigger = shouldConsumeCloud(...) 결과. */
function cloudSpendResult(trigger) {
  regenClouds();
  const before = ENERGY_ENABLED ? state.clouds : CLOUD_MAX;
  const clouds = trigger ? consumeCloudIfAvailable() : before;
  return { clouds_spent: Math.max(0, Math.min(CLOUD_COST, before - clouds)), clouds };
}

/** OUT_OF_CLOUDS 429 응답 본문 (회복 ETA 포함 — 리텐션 훅 §3.3) */
function outOfCloudsError(nextSec) {
  const min = Math.max(1, Math.ceil(nextSec / 60));
  return [
    429,
    {
      detail: `구름이 모두 흩어졌어요 — 약 ${min}분 후 구름 1개가 회복돼요.`,
      code: 'OUT_OF_CLOUDS',
      next_regen_sec: nextSec,
      clouds: 0,
      max: CLOUD_MAX,
    },
  ];
}

// ── 지도 지역 좌표 (R5-01 §3.1) — 판정 미사용, 렌더 전용. 정규화 0~100. ──
// zone index 0~3 ↔ 지역 고정 매핑(계약 §3.1). 존 의미(boardEngine.ZONES)는 불변.
// 좌표 SSOT = database/seed/board_regions.json — 사본이 아니라 **파일을 읽는다**
// (R10-07 §2.3: 손으로 베낀 사본은 드리프트한다. board_rules.json과 같은 선례).
const FALLBACK_BOARD_REGIONS = [
  { zone: 0, name: '서해상', svg_point: [21, 54], label_anchor: [21, 66] },
  { zone: 1, name: '수도권', svg_point: [43, 33], label_anchor: [43, 21] },
  { zone: 2, name: '영서·태백', svg_point: [61, 47], label_anchor: [61, 35] },
  { zone: 3, name: '영동·동해', svg_point: [82, 43], label_anchor: [88, 55] },
];
function loadBoardRegions() {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(here, '../../database/seed/board_regions.json'), 'utf-8'),
    );
    return Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_BOARD_REGIONS;
  } catch {
    return FALLBACK_BOARD_REGIONS;
  }
}
const BOARD_REGIONS = loadBoardRegions();

// ── 커리큘럼 유닛 (R5-01 §3.2) — 2섹션·유닛 5개·선행 잠금 포함 ──
//   각 유닛은 concept_tag로 기존 content_items 풀과 연결(§3.2). kind: quiz|board.
//   slug(R8-01 §3.3): 백엔드 유닛 식별자 — spine.current_unit·crown_award가 노출한다.
const UNITS = [
  { id: 'u0000001-0000-4000-8000-000000000001', slug: 'pressure-front-intro', section: '하늘 읽기', unit_order: 1, title: '기압과 전선 입문', concept_tag: 'pressure_front', prereq_unit_id: null, kind: 'quiz', crown_target: 1 },
  { id: 'u0000002-0000-4000-8000-000000000002', slug: 'air-mass-basics', section: '하늘 읽기', unit_order: 2, title: '기단의 성질', concept_tag: 'air_mass', prereq_unit_id: 'u0000001-0000-4000-8000-000000000001', kind: 'quiz', crown_target: 1 },
  { id: 'u0000003-0000-4000-8000-000000000003', slug: 'front-weather-board', section: '하늘 읽기', unit_order: 3, title: '전선으로 날씨 만들기', concept_tag: 'pressure_front', prereq_unit_id: 'u0000002-0000-4000-8000-000000000002', kind: 'board', crown_target: 1 },
  { id: 'u0000004-0000-4000-8000-000000000004', slug: 'typhoon-structure', section: '큰 바람', unit_order: 1, title: '태풍의 구조', concept_tag: 'typhoon', prereq_unit_id: null, kind: 'quiz', crown_target: 1 },
  { id: 'u0000005-0000-4000-8000-000000000005', slug: 'anomaly-replay-board', section: '큰 바람', unit_order: 2, title: '이상 기후 재현', concept_tag: 'anomaly', prereq_unit_id: 'u0000004-0000-4000-8000-000000000004', kind: 'board', crown_target: 1 },
];

// user_unit_progress 흉내 (unit_id → {crowns, cleared_at}). 첫 유닛 1개를 클리어 상태로 시드
// → u2 열림(현재), u3 잠금, u4 열림, u5 잠금 혼합을 학습 홈에서 보여준다.
const unitProgress = new Map([
  ['u0000001-0000-4000-8000-000000000001', { crowns: 1, cleared_at: '2026-07-18T09:00:00Z', attempted_at: '2026-07-18T09:00:00Z' }],
]);

// id 또는 slug로 조회 — 프론트 라우트는 트리의 id를, spine.current_unit은 slug를 쓴다(R8-01 §3.3).
const getUnit = (idOrSlug) => UNITS.find((u) => u.id === idOrSlug || u.slug === idOrSlug) ?? null;
const getUnitProgress = (id) => {
  if (!unitProgress.has(id)) unitProgress.set(id, { crowns: 0, cleared_at: null, attempted_at: null });
  return unitProgress.get(id);
};
// 배치 θ 선해제(R7-02 S4): 배치 실응답 θ로 선두 연속 잠금 유닛이 왕관 0인 채
// 열릴 수 있다(백엔드 파생). 목은 선해제된 유닛 id 집합으로 흉내 낸다.
const preUnlockedUnits = new Set();

/** 선행 잠금(§3.2) — 서버 `curriculum_service.is_locked`와 **같은 규칙**이어야 한다.
 *  🔴 2026-08-19 결함 ⑩: 종전에는 `prereq.crowns >= 1`만 봤고 서버도 같았는데,
 *  왕관이 만점·하루 첫·최초 완료를 모두 요구해 **한 문항만 틀려도 다음이 안 열렸다.**
 *  진행과 보상을 갈랐다 — `attempted_at`(해 봤다)이 잠금을 풀고 `crowns`는 보상이다.
 *  `crowns >= 1`은 OR로 남긴다(왕관만 올리는 유입로가 있다 — 배지·/dev).
 *  첫 유닛(무 prereq)은 항상 열림 · 배치 θ 선해제(R7-02 S4)도 열림.
 *  ⚠️ 이 함수와 서버가 갈리면 dev에서만 되는(또는 안 되는) 결함이 된다 —
 *  `backend/tests/test_curriculum_mock_parity.py`가 그것을 문다. */
const isUnitLocked = (unit) => {
  if (!unit.prereq_unit_id) return false;
  if (preUnlockedUnits.has(unit.id)) return false;
  const p = unitProgress.get(unit.prereq_unit_id);
  return !((p?.crowns ?? 0) >= 1 || p?.attempted_at != null);
};

/** 섹션 표시 메타 — 서버는 database/seed/section_meta.json이 소유한다.
 *  값이 어긋나면 시안·프론트가 서버와 다른 화면을 그리므로 시드와 같은 값을 둔다. */
const SECTION_META = {
  '하늘 읽기': { subtitle: '기압과 전선이 만드는 오늘의 하늘', est_minutes: 15, topics: ['고기압', '저기압', '온난전선', '한랭전선'] },
  '공기의 힘': { subtitle: '계절을 지배하는 네 기단과 그 변질', est_minutes: 15, topics: ['시베리아 기단', '북태평양 기단', '기단 변질', '계절풍'] },
  '큰 바람': { subtitle: '태풍의 구조와 이상 기후의 재현', est_minutes: 12, topics: ['태풍의 눈', '위험반원', '집중호우', '이상 기후'] },
  '도시와 기후': { subtitle: '열섬에서 이상기후까지 — 사람이 바꾼 하늘', est_minutes: 22, topics: ['열섬 현상', '온실효과', 'CO₂', '이상기후'] },
};

/** GET /curriculum 트리 (섹션→유닛→유저 진도·잠금·상태)
 *  status 4종(R7-02 S4 계약, 백엔드 build_curriculum과 동일): cleared(완료)
 *  > locked > unlocked(열림 — 배치 θ 선해제 포함). 이후 트리 전체 노출 순서에서
 *  잠기지 않은 첫 미클리어(unlocked) 유닛 **정확히 1개**를 current로 승격한다
 *  — 섹션별 1개가 아니라 전역 1개(R7-14 통합에서 백엔드 계약과 정렬).
 *  기존 crowns/cleared/locked 불변. */
function curriculumPayload() {
  const bySection = new Map();
  for (const u of UNITS) {
    if (!bySection.has(u.section)) bySection.set(u.section, []);
    bySection.get(u.section).push(u);
  }
  const sections = [...bySection.entries()].map(([section, units]) => ({
    section,
    subtitle: SECTION_META[section]?.subtitle ?? null,
    est_minutes: SECTION_META[section]?.est_minutes ?? null,
    topics: SECTION_META[section]?.topics ?? [],
    units: [...units]
      .sort((a, b) => a.unit_order - b.unit_order)
      .map((u) => {
        const prog = getUnitProgress(u.id);
        const cleared = prog.crowns >= u.crown_target;
        const locked = isUnitLocked(u);
        const status = cleared ? 'cleared' : locked ? 'locked' : 'unlocked';
        return {
          id: u.id,
          slug: u.slug,
          unit_order: u.unit_order,
          title: u.title,
          concept_tag: u.concept_tag,
          kind: u.kind,
          crown_target: u.crown_target,
          crowns: prog.crowns,
          cleared,
          cleared_at: prog.cleared_at,
          locked,
          status,
        };
      }),
  }));
  // 'current' 승격 — 백엔드 `build_curriculum`과 **같은 규칙**이다.
  //
  // 🔴 **2026-08-19 결함 ⑧**: 종전에는 「첫 'unlocked'」였다. 배치 선해제는 잠금만
  // 풀고 `cleared_at`을 안 채우므로, 고등으로 진단받아 여러 유닛을 인정받은 학습자도
  // 그것들이 전부 미클리어라 **커서가 맨 앞으로 떨어졌다** — 화면에 「섹션 1 · 초등
  // 3~4학년」이 뜨고 배치를 본 흔적이 사라졌다.
  //
  // 이제 **배치가 연 구간의 끝**에 선다. 구간 **다음** 유닛이 아닌 이유: 그것은
  // 잠겨 있다(선해제 밖에서는 선행 왕관을 요구하는데 배치는 왕관을 주지 않는다).
  // ⚠️ **배치를 안 본 학습자(`preUnlockedUnits`가 빔)는 종전 그대로 맨 앞**이다 —
  // 이 분기가 없으면 신규 학습자가 갑자기 뒤쪽 유닛으로 떨어진다.
  const flatUnits = sections.flatMap((s) => s.units);
  const openUnits = flatUnits.filter((v) => v.status === 'unlocked');
  if (openUnits.length > 0) {
    const inside = openUnits.filter((v) => preUnlockedUnits.has(v.id));
    // 인정 구간이 전부 클리어됐으면 그 밖의 첫 열린 유닛으로 자연 승계한다.
    const target =
      preUnlockedUnits.size > 0 && inside.length > 0
        ? inside[inside.length - 1]
        : openUnits[0];
    target.status = 'current';
  }
  return { sections };
}

/** 스파인 집계 (R8-01 §3.3) — GET /progress/me의 additive spine 필드.
 *  서버 계산과 동일 정의: cleared=crown_target 도달, crowns_total=Σcrown_target,
 *  current=트리 노출 순서에서 잠기지 않은 첫 미클리어 유닛(없으면 null). */
/**
 * 진도 블록 유닛 = "잠기지 않은 첫 미클리어 유닛" (R13-01 §2.10).
 * 서버 `curriculum_service.open_units_in_order`의 첫 원소(= build_curriculum이
 * 'current'로 승격하는 유닛)와 같은 정의다. 일일 세션의 진도 블록이 이 유닛에서
 * 나오고, **왕관도 이 유닛에 붙는다**(CO-M6: 블록 유닛 자신의 쌍을 기록한다).
 */
function currentProgressUnit() {
  return (
    UNITS.find((u) => (unitProgress.get(u.id)?.crowns ?? 0) < u.crown_target && !isUnitLocked(u))
    ?? null
  );
}

/**
 * GET /progress/me 페이로드 — **함수로 뺐다**(2026-08-12). 테스트가 라우트를
 * 거치지 않고 같은 값을 볼 수 있어야 한다: 목이 `knowledge_level`을 안 보내
 * 「현재 지식 단계」 카드가 목에서 통째로 안 뜨던 것을 24종 스모크 중 아무도
 * 못 잡았다. `__progressMePayload`로 노출한다 — 사본이 아니라 **라우트가 쓰는
 * 바로 그 함수**다(사본을 두면 계약이 자기 자신을 보게 된다).
 */
function progressMePayload() {
  regenClouds();
  return {
    xp: state.xp,
    level: state.level,
    streak_count: state.streak,
    next_level_xp: nextLevelXp(state.level),
    streak_freeze_count: state.streakFreeze,
    tier: state.tier, // 현재 리그 티어 (§3.2 — 최근 정산, 없으면 stratus)
    clouds: state.clouds, // 구름 에너지 잔량 (§3.3)
    max_clouds: CLOUD_MAX,
    next_regen_sec: nextRegenSec(),
    placement_done: state.placementDone, // 온보딩 배치고사 완료 여부 (R7-01 S3)
    spine: spinePayload(), // 스파인 집계 (R8-01 §3.3, additive)
    // 일일 목표 (R10-01 §3.4·D4, additive) — null이면 미설정(온보딩 1스텝 노출).
    daily_goal_items: state.dailyGoalItems,
    // 오늘 응답한 문항 수 — "오늘 목표 N/M" 표기의 N (자정 지연 리셋 포함).
    today_answered_count: todayAnsweredCount(),
    // 학습 지역 (R12 선행 §8.2, additive) — 서버는 NULL=서울 해석값을 노출.
    region: state.region,
    // 지식 단계 (R13) — 서버 schemas/progress.ProgressMe의 두 필드.
    // ⚠️ 종전에는 **이 둘이 없었다**. 그래서 `KnowledgeLevelCard`가 목에서
    // 항상 null을 반환했고(카드가 통째로 안 뜸), 프론트 스모크 어느 것도
    // 그 카드를 렌더해 본 적이 없었다 — 2026-08-12에 그 카드를 /me 오른쪽
    // 열로 옮기고 나서야 드러난 mock↔서버 드리프트다.
    // 값은 서버 `overall_knowledge_level`과 같은 경로로 만든다:
    // 개념 θ → 대표 θ(n 가중) → 단계. 행이 없으면 null(콜드스타트).
    knowledge_level: knowledgeLevelNow(),
    knowledge_level_max: KNOWLEDGE_LEVEL_MAX,
    // 표현 톤 (server schemas/progress.ProgressMe.tone ·
    // weatherbrain_service.effective_tone) — 신고 톤이 없으면 학령에서 파생한다.
    // 목에는 users.tone이 없으므로 항상 파생 경로다. 종전에는 이 필드가 아예
    // 없었다(지식 단계와 같은 종류의 구멍 — 2026-08-12 리뷰).
    tone: LEVEL_GROUP_TONE[mockAuth.levelGroup] ?? LEVEL_GROUP_TONE.middle_high,
  };
}

function spinePayload() {
  let unitsCleared = 0;
  let crownsEarned = 0;
  let crownsTotal = 0;
  for (const u of UNITS) {
    const crowns = unitProgress.get(u.id)?.crowns ?? 0;
    crownsTotal += u.crown_target;
    crownsEarned += Math.min(crowns, u.crown_target);
    if (crowns >= u.crown_target) unitsCleared += 1;
  }
  const current = currentProgressUnit();
  return {
    units_total: UNITS.length,
    units_cleared: unitsCleared,
    crowns_earned: crownsEarned,
    crowns_total: crownsTotal,
    current_unit: current ? { slug: current.slug, title: current.title } : null,
  };
}

/**
 * 왕관 대상 (concept_tag, kind) — **한 유닛에서 나온 쌍** (CO-M6 · 서버
 * routers/session.py `_crown_target`과 같은 규칙).
 *
 * 발급 시점에 적어 둔 `unit_block`의 쌍을 그대로 쓴다. 두 값이 같은 유닛에서
 * 나오므로 "concept AND kind 일치" 요구가 구조적으로 만족된다 — 예전처럼 kind는
 * 블록 유닛에서, concept은 블록 문항 최다 태그에서 뽑으면 블록이 두 유닛에 걸칠 때
 * 둘이 서로 다른 유닛을 가리켜 왕관이 증발한다.
 * 쌍이 없는 세션(unit_block 미기록 = 개정 전 발급분)만 종전 방식으로 폴백한다:
 * 블록 최다 개념(동률은 route target 우선 → 사전순) + kind 기본 'quiz'.
 */
function crownTargetOf(s, crownItems) {
  const block = s.unit_block;
  if (block?.concept_tag && block?.kind) return [block.concept_tag, block.kind];
  const tagCounts = new Map();
  for (const item of crownItems) {
    tagCounts.set(item.concept_tag, (tagCounts.get(item.concept_tag) ?? 0) + 1);
  }
  if (tagCounts.size === 0) return [null, 'quiz'];
  const topCount = Math.max(...tagCounts.values());
  const tied = [...tagCounts.entries()]
    .filter(([, count]) => count === topCount)
    .map(([tag]) => tag)
    .sort();
  const routeTarget = s.route_target_concept_tag ?? null;
  return [tied.includes(routeTarget) ? routeTarget : tied[0], 'quiz'];
}

/** 왕관 유입로 (R8-01 §3.4) — 유닛에 왕관 +1(crown_target 초과 불가).
 *  실제로 부여됐을 때만 crown_award 페이로드 {unit_slug, unit_title, crowns, cleared}를
 *  반환하고, 대상 없음/이미 만관이면 null(무동작). 백엔드 grant_unit_crown과 동일하게
 *  cleared 전환 시 +20 XP(XP_UNIT_CLEAR) 1회 — 보드 +5 XP·데일리 문항 XP는 별도
 *  기존 경로 그대로다. crown_award 페이로드 계약(4필드)은 불변. */
function grantUnitCrown(unit) {
  if (!unit) return null;
  const prog = getUnitProgress(unit.id);
  if (prog.crowns >= unit.crown_target) return null;
  prog.crowns += 1;
  const cleared = prog.crowns >= unit.crown_target;
  if (cleared && !prog.cleared_at) {
    prog.cleared_at = new Date().toISOString();
    state.xp += 20; // 유닛 cleared 전환 보상 — backend xp_service.XP_UNIT_CLEAR
  }
  return { unit_slug: unit.slug, unit_title: unit.title, crowns: prog.crowns, cleared };
}

// 약점 태그(§3.1 weak_correct_1 판정용) — /progress/weak-tags 목데이터와 일치
const WEAK_TAGS = new Set(['typhoon', 'anomaly', 'pressure_front']);

// ── 세션 문항 XP 분해 (R10-01 §3.5 마감 3 — server xp_service.quiz_xp_breakdown) ──
// 서버와 같은 커밋에서 동기화한다(D10-1 선례): 응답에 xp_base·xp_weak_bonus를
// 실어야 프론트가 "약점 극복 +N"을 역산 없이 표기하고, **목에서도 보너스 줄이
// 실제로 렌더된다**(이전 목은 항상 15를 줘서 이 표기가 검증 불가였다).
// 기본 지급액은 그대로: 정답 15(=10+첫 시도 5) · 오답 2. 달라진 것은 약점 개념
// (WEAK_TAGS) **정답**에만 1.5배가 붙는 것뿐 — 서버와 동일 조건.
const MOCK_XP_CORRECT = 15;
const MOCK_XP_WRONG = 2;
/** 파이썬 round()의 half-to-even. Math.round(22.5)=23이라 서버(22)와 어긋난다 —
 *  약점 첫 시도 정답 15*1.5=22.5가 정확히 이 경계라 별도 구현이 필요하다. */
function roundHalfToEven(x) {
  const floor = Math.floor(x);
  if (x - floor !== 0.5) return Math.round(x);
  return floor % 2 === 0 ? floor : floor + 1;
}
/** {xp_earned, xp_base, xp_weak_bonus} — 합 계약(base+bonus === earned) 유지. */
function quizXpBreakdown({ isCorrect, conceptTag, isPlacement = false }) {
  if (isPlacement) return { xp_earned: 0, xp_base: 0, xp_weak_bonus: 0 };
  const base = isCorrect ? MOCK_XP_CORRECT : MOCK_XP_WRONG;
  const bonus =
    isCorrect && WEAK_TAGS.has(conceptTag)
      ? roundHalfToEven(base * 1.5) - base
      : 0;
  return { xp_earned: base + bonus, xp_base: base, xp_weak_bonus: bonus };
}

// 퀘스트 진행 반영 헬퍼 (세션·보드·퀴즈 응답 시 호출 — 당일 재계산 흉내)
function bumpQuest({ xp = 0, correctTag = null, live = false }) {
  state.quest.xpToday += xp;
  if (correctTag && WEAK_TAGS.has(correctTag)) state.quest.weakCorrect = 1;
  if (live) state.quest.liveAnswered = 1;
}

// GET /progress/quests 응답 3종 (§3.1 코드 고정)
function questPayload() {
  const q = state.quest;
  return [
    {
      code: 'daily_xp_30',
      title: '오늘 30 XP 모으기',
      progress: Math.min(q.xpToday, 30),
      target: 30,
      done: q.xpToday >= 30,
      xp_reward: 10,
    },
    {
      code: 'weak_correct_1',
      title: '약점 개념 정답 맞히기',
      progress: q.weakCorrect,
      target: 1,
      done: q.weakCorrect >= 1,
      xp_reward: 10,
    },
    {
      code: 'live_answered',
      title: '오늘의 실황 문항 풀기',
      progress: q.liveAnswered,
      target: 1,
      done: q.liveAnswered >= 1,
      xp_reward: 5,
    },
  ];
}

/**
 * 세션 완료·보드 통과가 일으킨 **완료 전환**만 추린다 (CO-T-4 — 서버
 * quest_service.reward_events 대응).
 *
 * 서버와 같은 규칙이어야 하는 지점이 둘이다:
 * ⑴ 실리는 것은 done이 아니라 **newly_done** — 이미 완료된 퀘스트는 재계산해도
 *    다시 실리지 않는다. 그래서 doneCodes에 기록하고 그 여집합만 낸다.
 * ⑵ done은 **sticky** — 한번 전환되면 진행도가 내려가도 유지된다.
 */
function questTransitions() {
  const done = new Set(state.quest.doneCodes);
  const events = [];
  for (const q of questPayload()) {
    if (!q.done || done.has(q.code)) continue;
    done.add(q.code);
    // 보상은 **실제로 잔액에 넣는다** — 서버 recalculate_quests가 xp_service.add_xp를
    // 부르는 자리다. 안 넣으면 응답은 "+10 받았다"인데 /progress/me는 모르고,
    // 보드에서 addXp(bonus) 직후 ['progress','me'] 무효화가 돌아 헤더 XP가
    // 올랐다가 도로 내려간다(BoardPage.jsx). 다른 목 XP 지급과 같은 관례.
    state.xp += q.xp_reward;
    events.push({ code: q.code, title: q.title, reward_xp: q.xp_reward });
  }
  state.quest.doneCodes = [...done];
  return events;
}

// GET /progress/badges 응답 5종 (§3.3 저작 코드) — 일부 획득/미획득 혼합
const BADGES = [
  { code: 'streak_7', title: '7일 연속', description: '7일 연속 출석 달성', earned_at: '2026-07-12T00:00:00Z' },
  { code: 'streak_30', title: '30일 연속', description: '30일 연속 출석 달성', earned_at: null },
  { code: 'streak_100', title: '100일 연속', description: '100일 연속 출석 달성', earned_at: null },
  { code: 'perfect_session', title: '무오답 세션', description: '세션 10문항을 모두 맞힘', earned_at: '2026-07-18T09:20:00Z' },
  { code: 'tier_promoted', title: '티어 승급', description: '리그 티어 승급 달성', earned_at: null },
];

// ── 예보 대결 브리핑 (R9-01 §3.1 /duel/briefing) ─────────────────────────────
// KMA 키 부재 degraded 모드 재현: VITE_MOCK_BRIEFING=degraded 로 실행하면
// briefing 필드가 null/빈 배열이고 base_forecast도 null(§3.1 — 실패 시 비노출).
const BRIEFING_DEGRADED = process.env.VITE_MOCK_BRIEFING === 'degraded';

// 예보 대결 참고 예보(§3.4 KMA 내일 예보 흉내)와 AI 캐스터 결정적 예측.
// R9-01 §3.2: ai_pred JSONB에 noise_scale 스냅샷 동봉(감사 가능) —
// state.tier(nimbostratus)의 티어 5계단 계약값 0.70.
const DUEL_BASE_FORECAST = { temp_max: 30, rain_prob: 40 };
const DUEL_AI_PRED = { temp_max: 31.2, rain_prob: 55, noise_scale: 0.7 }; // base + 결정적 노이즈(온도 +1.2·강수 +15)

// 근거 선택 화이트리스트 5종 (R9-01 §3.1 — 미지 코드 422)
const EVIDENCE_CODES = ['pop_trend', 'humidity_high', 'temp_drop', 'sky_overcast', 'recent_rain'];

const isoDaysFromToday = (offset) => {
  const d = kstDate(Date.now()); // todayISO와 같은 KST 기준(위 주석)
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** 내일 3시간 간격 8행 결정적 시계열 — 랜덤 없음(스모크·디자인 재현성).
 *  시나리오: 오후 소나기(pop 상승 추세·습도 높음 — 근거 판정 이야기와 정합). */
function briefingHourly() {
  const target = isoDaysFromToday(1);
  const rows = [
    // [시, tmp℃, pop%, pcp(mm), reh%, wsd(m/s), sky(1맑음|3구름많음|4흐림), pty(0없음|1비|4소나기)]
    [0, 24.1, 20, 0, 70, 1.8, 1, 0],
    [3, 23.4, 20, 0, 75, 1.5, 1, 0],
    [6, 23.9, 30, 0, 80, 2.0, 3, 0],
    [9, 26.8, 40, 0, 70, 2.6, 3, 0],
    [12, 29.6, 60, 1.5, 65, 3.4, 4, 1],
    [15, 30.4, 70, 4.0, 60, 3.8, 4, 4],
    [18, 28.2, 60, 1.0, 70, 3.0, 4, 1],
    [21, 25.7, 40, 0, 80, 2.2, 3, 0],
  ];
  return rows.map(([h, tmp, pop, pcp, reh, wsd, sky, pty]) => ({
    // ⚠️ 실서버 형식은 **YYYYMMDDHHMM 압축형**이다(`weather_api.group_forecast_items`가
    // fcstDate+fcstTime을 그대로 이어 붙인다). 종전에 목이 ISO를 주는 바람에
    // `fmtHour`가 ISO 기준으로 쓰였고, 실서버에서는 전 슬롯이 「0시」로 찍혔다
    // (2026-08-10 실기동에서 발견). **목이 실서버보다 친절하면 그 차이가 곧 버그다.**
    datetime: `${target.replace(/-/g, '')}${String(h).padStart(2, '0')}00`,
    tmp,
    pop,
    pcp,
    reh,
    wsd,
    sky,
    pty,
  }));
}

/** GET /duel/briefing 페이로드 (§3.1) — 실패 필드는 null/빈 배열 */
function duelBriefingPayload() {
  if (BRIEFING_DEGRADED) {
    return {
      region: '서울',
      target_date: isoDaysFromToday(1),
      hourly: [],
      today_observed: null,
      recent_days: [],
    };
  }
  return {
    region: '서울',
    target_date: isoDaysFromToday(1),
    hourly: briefingHourly(),
    today_observed: { max_ta: 29.3, min_ta: 22.8, sum_rn: 0.0 },
    // 최근 7일 실측(어제부터 역순) — 3일 전 강수 이력(recent_rain 근거 판정용)
    recent_days: [
      { date: isoDaysFromToday(-1), max_ta: 29.3, sum_rn: 0.0 },
      { date: isoDaysFromToday(-2), max_ta: 28.1, sum_rn: 12.5 },
      { date: isoDaysFromToday(-3), max_ta: 27.4, sum_rn: 3.0 },
      { date: isoDaysFromToday(-4), max_ta: 30.2, sum_rn: 0.0 },
      { date: isoDaysFromToday(-5), max_ta: 31.0, sum_rn: 0.0 },
      { date: isoDaysFromToday(-6), max_ta: 29.8, sum_rn: 0.5 },
      { date: isoDaysFromToday(-7), max_ta: 28.6, sum_rn: 0.0 },
    ],
  };
}

// 세션 마감 단계 제출 경로 (R13 A-1) — **새 엔드포인트가 아니라** 기존 예보 대결
// 제출이다. 서버 상수 session_service.DUEL_SUBMIT_PATH와 같은 값이어야 한다.
const DUEL_SUBMIT_PATH = '/api/v1/duel/today';

/** 일일 세션의 예보 마감 단계 (R13 A-1) — 필요 없으면 null.
 *
 * 문항이 아니라 **단계**다: 예보의 정답은 내일의 관측이 정하므로 즉시 채점이
 * 불가능하고, 그래서 MOCK_SESSION_RECIPE(15문항)에 들어가지 않는다.
 * null이 되는 조건 2가지는 서버(forecast_closing_step)와 같다:
 *   1) 오늘 이미 제출했다  2) KMA 판단 재료가 없다(degraded)
 */
function closingStepPayload(mode) {
  if (mode !== 'daily') return null; // 유닛·배치 세션은 마감 단계가 없다
  if (state.duel.submitted) return null;
  if (BRIEFING_DEGRADED) return null; // 키 부재·KMA 장애 → 단계 생략, 15문항으로 완료
  return {
    kind: 'forecast_duel',
    duel_date: isoDaysFromToday(1), // 예보 대상일 = 내일(KST)
    submit_path: DUEL_SUBMIT_PATH,
    base_forecast: DUEL_BASE_FORECAST,
  };
}

/** GET/POST /duel/today 응답 (schemas/duel.DuelToday).
 *
 * ⚠️ 서버 정합 2건(R13 3일차 FE-1 — 목이 어긋나 있던 드리프트):
 *   1. duel_date는 **예보 대상일 = 내일(KST)**이다(라우터 _duel_target_date →
 *      duel_service.duel_target_date). 오늘로 두면 마감 단계의 duel_date와
 *      대결 화면의 duel_date가 하루 어긋난다.
 *   2. 스키마 필드는 `submitted: bool`이다 — `status: 'open'|'submitted'` 문자열은
 *      서버에 존재하지 않는다(프론트가 목에서만 도는 분기를 갖게 된다).
 */
function duelTodayPayload() {
  const submitted = state.duel.submitted;
  return {
    duel_date: isoDaysFromToday(1),
    submitted,
    base_forecast: BRIEFING_DEGRADED ? null : DUEL_BASE_FORECAST,
    caster_grade: state.tier, // R9-01 §3.2 — 유저 티어 기준 적응형 캐스터 등급(additive)
    user_pred: state.duel.userPred,
    ai_pred: submitted ? state.duel.aiPred : null, // 제출 후 공개 (§3.4)
    evidence: state.duel.evidence, // R9-01 §3.1 — 선택한 판단 근거(additive)
    evidence_review: null, // 정산 후 조회 시 계산 — 오늘 대결은 미정산이므로 null
    actual: null, // 오늘 대결은 미정산 (다음날 실측)
    user_score: null,
    ai_score: null,
    result: null,
    // 서버 `_duel_xp_earned(result)` — 정산 전이면 null. 오늘 대결은 미정산이다.
    // ⚠️ 액수를 프론트가 하드코딩하지 않도록 **서버가 보내는** 필드다(R10).
    xp_earned: null,
  };
}

/**
 * 대결 승리 XP — server `duel_service.DUEL_WIN_XP`의 **사본**.
 * `__mockPolicy().duel_win_xp`로 노출해 서버 실값과 대조한다(오늘 그물 밖 사본
 * 넷을 메운 것과 같은 이유 — 값이 같아도 노출이 없으면 서버가 바뀔 때 조용하다).
 */
const MOCK_DUEL_WIN_XP = 15;

const nextLevelXp = (level) => 50 * (level + 1) ** 2;

const QUIZ = {
  quiz_id: `${todayISO()}-middle_high-general`,
  concept_tag: 'pressure_front',
  question_type: 'multiple_choice',
  question_text:
    '오늘 서울은 고기압의 영향으로 맑고 건조합니다. 고기압 중심부에서 하강 기류가 생길 때 날씨가 맑아지는 이유로 가장 알맞은 것은?',
  options: [
    '공기가 하강하며 단열 압축되어 구름이 증발하기 때문',
    '공기가 상승하며 팽창해 수증기가 응결하기 때문',
    '지표면의 복사열이 우주로 모두 빠져나가기 때문',
    '바람이 강해져 구름을 밀어내기 때문',
  ],
  level_group: 'middle_high',
};

// ── 세션 모드 (R2-01 계약 §3.1) ─────────────────────────────────────────────
// SessionItem = QuizQuestion + {source, slot_filled}. 문항 수는 **배합에서 파생**한다
// (R10-07 §2.3: 손으로 쓴 9건이 서버 배합 5건과 어긋났고, 그 9가 관찰 보고서 §1의
// 분모로 새어 R10-B 우선순위 판단까지 오염시켰다).
// 배합 슬롯별 후보 풀 앞쪽에는 프론트 스모크가 문구를 고정한 저작 픽스처를 두고,
// 뒤쪽은 **시드 파생**으로 잇는다 — 배합이 커지면 시드 문항이 자동으로 채운다.
// _mock 필드는 목 전용 채점 정보로, 실제 응답 직전에 stripMock이 제거한다.
//
// ⚠️ 아래 픽스처를 시드 파생으로 바꾸기 전에 반드시 읽을 것:
//   frontend/tests/boardAssistRetention.smoke.test.mjs가 세션 1·2번 문항의
//   **보기 문구·정답 문자열**을 그대로 단정한다 — 시나리오 7('한랭 전선' 버튼 클릭 후
//   '북태평양 기단' 입력), 시나리오 10(typhoon '오른쪽(동쪽) 반원',
//   heat_island '도시 상공의 오존층이 두꺼워져서'). 이 문구들은 시드 53문항에
//   존재하지 않아(전수 grep 확인) 시드 파생으로 대체하면 스모크가 깨진다.
//   스모크를 함께 손댈 수 있을 때 이 4건도 시드 파생으로 넘긴다(R10-07 보고 사항).
// R13-02 §T3: 세션 디폴트 **10문항**(실황2·신규4·복습3·**보드1**) — backend
// Settings.SESSION_RECIPE와 parity 계약(test_r10_mock_parity_contract)이 대조한다.
//
// ⚠️ **2026-08-12 개정**(종전 15문항 신규5·복습4·실황1·진도5).
//   ⑴ **`unit`(진도) 블록이 빠졌다.** 왕관 판정을 유닛 세션 완료로 되돌리기로
//      클라이언트가 확정했다 — 데일리가 진도를 겸하지 않는다.
//   ⑵ **`board` 1문항이 명시 블록으로 들어왔다.** 「오늘 날씨 반영 보드」다:
//      KMA 실황 → 현상 판정 → 그 현상에 맞는 보드 선택(`order_boards_for_today`).
const MOCK_SESSION_RECIPE = { live: 2, new: 4, review: 3, board: 1 };

// ── 출제 순서 (server `session_service.plan_bank_picks`의 **블록 호출 순서**) ──
// ⚠️ **배합 dict의 키 순서는 출제 순서를 정하지 않는다.** 소유자는 서버에서도
// 목에서도 "블록을 부르는 순서"이고, 그래서 별도 상수로 선언한다.
//
// **2026-08-13 정정**: 목은 `new → review → live → board`로 돌고 있었고 서버는
// `live → new → review → board`였다 — 조용히 갈린 채였다. 지금 고치는 이유는
// 하루 첫 유닛 세션이 이 화면을 공유하게 되면서, 크롬으로 눈으로 확인할 때
// **화면에서 본 순서가 진짜 결함인지 목 인공물인지 구분되지 않기 때문**이다.
// 하루를 오늘의 날씨로 열고 오늘의 보드로 닫는 것이 클라이언트 사양의 서술
// 순서(「오늘 날씨 2 · 신규 4 · 복습 3 · 오늘 날씨 반영 보드 1」)다.
//
// __mockPolicy()로 노출해 backend `test_r13_mock_policy_parity`가 **서버
// plan_bank_picks를 실제로 실행한 결과**와 대조한다(기대값 사본 금지 — CO-J-9).
const MOCK_BLOCK_ORDER = ['live', 'new', 'review', 'board'];

// 서버 `Settings.UNIT_SESSION_SIZE` — **「두 번째 이후」 유닛 세션 문항 수**
// (2026-08-13 확정: 하루 첫 유닛 세션은 위 배합 총합 10문항을 받는다).
// __mockPolicy()로 노출해 backend 계약 테스트가 실값으로 대조한다 — 종전 목은
// 이 자리에 하드코딩 `3`을 갖고 있어 서버(4)와 조용히 갈려 있었다(CO-J-9와 같은 모양).
const MOCK_UNIT_SESSION_SIZE = 4;

// 서버 Settings.DAILY_BOARD_CAP — daily 비진도 블록의 board 상한(CO-H5).
// 목 뱅크는 board가 소수라 지금은 상한에 닿지 않지만, **정책을 선언하지 않으면
// 저작이 늘었을 때 조용히 갈린다**(에너지 상수를 리터럴로 복사했다가 대조가 0이던
// CO-J-9와 같은 자리). __mockPolicy()로 노출해 backend 계약 테스트가 실값을 문다.
//
// **2 → 1** (2026-08-12 클라이언트 확정, 서버가 먼저 바뀜).
// 배합이 `board: 1`을 **보장 자리**로 갖게 되면서 상한 2는 「보장 1 + 우발 1」을
// 뜻했다. 상한 1이면 배합이 보장한 그 1건이 예산을 전부 쓰고, new·review 슬롯에
// board가 우발적으로 끼어드는 경로가 닫힌다 — 하루에 보드는 「오늘의 하늘」 하나.
const MOCK_DAILY_BOARD_CAP = 1;

// 신규(new) 슬롯 픽스처 — 스모크 시나리오 7이 1·2번 문항으로 고정
const PINNED_NEW_ITEMS = [
  {
    quiz_id: `${todayISO()}-s1-bank`,
    concept_tag: 'pressure_front',
    question_type: 'multiple_choice',
    question_text: '전선을 경계로 성질이 다른 두 공기가 만납니다. 찬 공기가 따뜻한 공기를 밀어 올리며 이동할 때 만들어지는 전선은?',
    options: ['한랭 전선', '온난 전선', '정체 전선', '폐색 전선'],
    level_group: 'middle_high',
    knowledge_level: 4,
    source: 'bank',
    slot_filled: false,
    template_json: null, // 서버: 추가 페이로드가 필요 없는 유형은 None
    _mock: {
      correct: '한랭 전선',
      feedbackCorrect:
        '정확해요! 찬 공기는 무거워서 따뜻한 공기 밑을 파고들며 급하게 밀어 올립니다. 그래서 한랭 전선 뒤에는 적운형 구름과 소나기가 잘 생겨요.',
      feedbackWrong:
        '아쉬워요! 정답은 "한랭 전선"이에요. 찬 공기가 따뜻한 공기를 밀어 올리면 상승 기류가 급해져 적운형 구름과 짧고 강한 비가 내립니다. 온난 전선은 반대로 따뜻한 공기가 찬 공기 위로 완만하게 타고 오르는 경우예요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s2-bank`,
    concept_tag: 'air_mass',
    question_type: 'short_answer',
    question_text: '여름철 우리나라에 덥고 습한 날씨를 가져오는, 남동쪽 해양에서 발달하는 기단의 이름은? (○○○○ 기단)',
    options: null,
    level_group: 'middle_high',
    knowledge_level: 3,
    source: 'bank',
    slot_filled: false,
    template_json: null,
    _mock: {
      correct: '북태평양 기단',
      accept: ['북태평양', '북태평양기단', '북태평양 기단'],
      feedbackCorrect:
        '맞아요! 북태평양 기단은 저위도 해양에서 만들어져 고온 다습합니다. 한여름 무더위와 열대야의 주범이에요.',
      feedbackWrong:
        '아쉬워요! 정답은 "북태평양 기단"이에요. 저위도 해양에서 발달해 고온 다습하고, 여름철 우리나라를 덮으면 무더위와 열대야가 이어집니다. 시베리아 기단(한랭 건조)과 성질을 비교해 기억해 보세요.',
    },
  },
];

// 복습(review) 슬롯 픽스처 — 스모크 시나리오 10이 개념·정답으로 고정
// (typhoon = 목 WEAK_TAGS 최약 개념 → 약점 보너스 XP 분해 검증, heat_island = 비약점)
// ⚠️ 이 두 건에는 `knowledge_level`을 **일부러 안 넣는다**(2026-08-12). 단계 미분류
// 문항(구 데이터·생성 문항)에서 학습 수준 배지가 그려지지 않는 것을 개발 화면에서
// 매번 눈으로 확인할 수 있게 하는 자리다 — 빈 배지·"?"가 뜨면 여기서 먼저 보인다.
// 값을 채우고 싶어지면 그 계약이 어디서 검증되는지부터 확인할 것.
const PINNED_REVIEW_ITEMS = [
  {
    quiz_id: `${todayISO()}-s3-review`,
    concept_tag: 'typhoon',
    question_type: 'multiple_choice',
    question_text: '태풍이 우리나라 쪽으로 북상할 때, 일반적으로 바람 피해가 더 큰 "위험 반원"은 태풍 진행 방향의 어느 쪽일까요?',
    options: ['오른쪽(동쪽) 반원', '왼쪽(서쪽) 반원', '태풍의 눈 정중앙', '진행 방향과 무관하게 남쪽'],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    template_json: null,
    _mock: {
      correct: '오른쪽(동쪽) 반원',
      feedbackCorrect:
        '정답이에요! 오른쪽 반원에서는 태풍 자체의 바람과 태풍을 이동시키는 바람(이동 속도)이 같은 방향으로 겹쳐 풍속이 더 강해집니다. 그래서 위험 반원이라고 불러요.',
      feedbackWrong:
        '아쉬워요! 정답은 "오른쪽(동쪽) 반원"이에요. 태풍의 회전 바람에 태풍의 이동 방향 바람이 더해지는 쪽이라 풍속이 훨씬 강해집니다. 왼쪽 반원은 두 바람이 반대로 작용해 상대적으로 약한 "가항 반원"이에요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s5-review`,
    concept_tag: 'heat_island',
    question_type: 'multiple_choice',
    question_text: '한여름 밤, 도심 기온이 주변 교외보다 눈에 띄게 높게 유지되는 열섬 현상의 원인으로 보기 어려운 것은?',
    options: [
      '도시 상공의 오존층이 두꺼워져서',
      '아스팔트·콘크리트가 낮 동안 저장한 열을 밤에 방출해서',
      '건물·자동차·에어컨 실외기가 인공열을 배출해서',
      '녹지와 수면이 적어 증발 냉각이 약해서',
    ],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    template_json: null,
    _mock: {
      correct: '도시 상공의 오존층이 두꺼워져서',
      feedbackCorrect:
        '정확해요! 오존층은 성층권의 이야기로 열섬과는 무관해요. 열섬은 인공 피복의 축열, 인공열 배출, 증발 냉각 감소가 겹쳐 생기는 도시 기후 현상입니다.',
      feedbackWrong:
        '아쉬워요! 정답은 "오존층" 보기예요. 오존층은 성층권에 있어 도시 열섬과 관련이 없습니다. 열섬은 아스팔트의 축열, 인공열, 녹지 부족으로 인한 증발 냉각 감소가 원인이에요.',
    },
  },
];

// ── 시드 파생 풀 ────────────────────────────────────────────────────────────
// quiz 풀: board(=board_state 필요)와 실황 슬롯 문항을 뺀 시드 전건.
const SEED_QUIZ_POOL = SEED_ITEMS.filter(
  (it) => it.question_type !== 'board' && !it.uses_live_slots,
);
// 실황(live) 풀: uses_live_slots=true 문항. 기존 목과 같은 anomaly 개념을 우선해
// 결정적으로 고른다({today.*}는 seedToSessionItem이 치환하고 slot_filled=true).
const SEED_LIVE_POOL = [
  ...SEED_ITEMS.filter((it) => it.uses_live_slots && it.concept_tag === 'anomaly'),
  ...SEED_ITEMS.filter((it) => it.uses_live_slots && it.concept_tag !== 'anomaly'),
];

const SESSION_SLOT_POOLS = {
  new: [
    ...PINNED_NEW_ITEMS,
    ...SEED_QUIZ_POOL.map((seed, i) =>
      seedToSessionItem(seed, { quizId: `${todayISO()}-new${i + 1}-bank` }),
    ),
  ],
  review: [
    ...PINNED_REVIEW_ITEMS,
    // 복습은 풀 뒤쪽부터 — 신규 슬롯과 같은 시드 문항을 먼저 집지 않는다
    ...[...SEED_QUIZ_POOL].reverse().map((seed, i) =>
      seedToSessionItem(seed, { quizId: `${todayISO()}-review${i + 1}-bank` }),
    ),
  ],
  live: SEED_LIVE_POOL.map((seed, i) =>
    seedToSessionItem(seed, { quizId: `${todayISO()}-live${i + 1}-generated`, source: 'generated' }),
  ),
  // board 슬롯 (R13-02 §T3) — 「오늘 날씨 반영 보드」 1문항.
  // 서버는 KMA 실황으로 오늘 현상을 판정해 `order_boards_for_today`로 정렬하지만,
  // 목에는 실황 판정기가 없으므로 board 유형 시드를 **결정적 순서**로 집는다.
  // 여기서 검증하는 것은 "board 블록이 배합만큼 실려 오고 kind가 board로 표시되는가"다.
  // ⚠️ **`SEED_ITEMS`에서 고른다 — `SEED_QUIZ_POOL`이 아니다.** 그 풀은 정의부터
  // `question_type !== 'board'`라 board를 걸러낸다(위 1215행). 거기서 board를 찾으면
  // 항상 빈 배열이고, 그러면 board 블록이 조용히 new로 대체되어 **화면에 「오늘의
  // 하늘」 블록이 영영 안 뜬다** — 실제로 그렇게 한 번 짰다(2026-08-12).
  board: SEED_ITEMS.filter(
    (seed) => seed.question_type === 'board' && !seed.uses_live_slots,
  ).map((seed, i) => seedToSessionItem(seed, { quizId: `${todayISO()}-board${i + 1}-bank` })),
};

/** 배합대로 슬롯을 채운다 — 총 문항 수는 항상 배합 총합. 같은 문항은 한 번만.
 *  블록 구분(kind)은 서버 SessionItem.kind와 같은 값으로 실어 보낸다(§2.10). */
function buildSessionItems(recipe) {
  const seen = new Set();
  let boardTaken = 0;

  /** 한 블록을 `count`만큼 집는다 — 서버 `plan_bank_picks`의 `take()`와 같은 역할.
   *  `kind`는 **표시 라벨**이라 풀과 다를 수 있다(부족분을 new 풀에서 메울 때
   *  서버가 그 문항을 "new"로 라벨하는 것과 동일). */
  function take(poolName, count, kind, capBoard = true) {
    const picked = [];
    let taken = 0;
    const deferred = [];
    for (const item of SESSION_SLOT_POOLS[poolName] ?? []) {
      if (taken >= (count ?? 0)) break;
      if (seen.has(item.question_text)) continue;
      if (capBoard && item.question_type === 'board' && boardTaken >= MOCK_DAILY_BOARD_CAP) {
        deferred.push(item);
        continue;
      }
      seen.add(item.question_text);
      if (item.question_type === 'board') boardTaken += 1;
      picked.push({ ...item, kind });
      taken += 1;
    }
    // 상한 초과분은 버리지 않고 뒤로 미룬다 — 서버와 같은 이유(배합이 덜 차면
    // 그 자리가 유료 생성으로 샌다). 목은 생성이 없으므로 여기서는 "문항 수가
    // 줄어 배합 총합 계약이 깨지는 것"을 막는 역할이다.
    for (const item of deferred) {
      if (taken >= (count ?? 0)) break;
      seen.add(item.question_text);
      boardTaken += 1;
      picked.push({ ...item, kind });
      taken += 1;
    }
    return picked;
  }

  // ── board 블록은 **선점**한다 (서버 plan_bank_picks와 같은 순서 — R13-02 §T3) ──
  // 자리는 live 뒤지만 **선택은 맨 먼저** 한다. board 문항은 new 풀에도 들어 있어서
  // new 블록이 먼저 돌면 오늘 현상에 맞춰 고른 바로 그 보드를 new가 집어가고,
  // board 블록은 차선을 받는다 — 「오늘 날씨 반영 보드」의 핵심이 정확히 그 1건이라
  // 뒤집힌다. 선점해 두면 new는 자동으로 다음 후보로 넘어간다(`seen`이 막는다).
  // cap_board=false: 배합이 **보장한** 자리라 DAILY_BOARD_CAP으로 막지 않는다.
  const boardCount = recipe.board ?? 0;
  const boardPicks = boardCount ? take('board', boardCount, 'board', false) : [];

  // ── 출제 순서는 `MOCK_BLOCK_ORDER`가 소유한다 (서버 plan_bank_picks와 같은 형태) ──
  // ⚠️ **부족분은 new 풀이 메운다** — 서버와 같은 규칙이고, 없으면 배합 총합이
  // 깨진다(실제로 깨졌다: live 풀이 2건에 못 미쳐 10문항이 9문항이 됐다.
  // 2026-08-12). 서버에서 이 폴백의 뜻은 "그 자리가 유료 생성으로 새지 않게
  // 한다"이고, 목에서는 "총합 계약을 지킨다"이다. 메운 문항의 **라벨은 new**다
  // — 서버가 그렇게 라벨하므로 블록 표기도 같이 맞춘다.
  // board만 예외적으로 **위에서 선점한 결과**를 그대로 쓴다(부족분 대체는 여기서).
  const picks = [];
  for (const block of MOCK_BLOCK_ORDER) {
    const count = recipe[block] ?? 0;
    if (!count) continue;
    const taken = block === 'board' ? boardPicks : take(block, count, block);
    picks.push(...taken, ...take('new', count - taken.length, 'new'));
  }
  return picks;
}

const SESSION_ITEMS = buildSessionItems(MOCK_SESSION_RECIPE);

// ── 온보딩 배치고사 (R7-01 S3) — 진단 세션 ────────────────────────────────
// 서버 `Settings.PLACEMENT_SIZE` — **6 → 10**(2026-08-12 PM 판정).
// `placement_service.target_level_sequence`가 지식 단계 1~10을 한 번씩 겨냥하려면
// 슬롯이 10칸이어야 한다. 진단 도메인은 여전히 기상 6종(`CONCEPT_TAGS`)이므로
// **개념이 순환한다** — 서버의 `CONCEPT_TAGS[i % len(CONCEPT_TAGS)]` 배정과 같다.
// 「개념당 1문항」은 더 이상 성립하지 않고, 그것이 사양이다.
//
// ⚠️ 목이 6문항에 멈춰 있었고 `__mockPolicy()`가 이 크기를 노출하지 않아
// **패리티 테스트가 못 봤다**(2026-08-13 코드 리뷰 결함 ④ — 에너지 상수를
// 리터럴로 복사한 채 대조가 0이던 CO-J-9와 같은 모양).
//
// **시드 파생**(R10-07 §2.3): 슬롯마다 board·실황을 뺀 문항을 고르되, 아직 쓰지
// 않은 question_type을 우선해 진단이 한 유형으로 편중되지 않게 한다(결정적).
// 같은 개념이 두 번 돌아오므로 **이미 쓴 시드도 제외**한다 — 안 그러면 같은 문항이
// quiz_id만 바꿔 두 번 나온다.
// 실황 슬롯 없음(진단 성격) · board 없음(일괄 채점 경로는 board_state를 받지 않는다).
const MOCK_PLACEMENT_SIZE = 10;

const PLACEMENT_ITEMS = (() => {
  const usedTypes = new Set();
  const usedSeeds = new Set();
  const items = [];
  for (let i = 0; i < MOCK_PLACEMENT_SIZE; i += 1) {
    const tag = CONCEPT_TAGS[i % CONCEPT_TAGS.length];
    const candidates = SEED_QUIZ_POOL.filter(
      (it) => it.concept_tag === tag && !usedSeeds.has(it),
    );
    const seed =
      candidates.find((it) => !usedTypes.has(it.question_type)) ?? candidates[0];
    if (!seed) continue;
    usedSeeds.add(seed);
    usedTypes.add(seed.question_type);
    items.push(seedToSessionItem(seed, { quizId: `${todayISO()}-p${i + 1}` }));
  }
  return items;
})();

const PLACEMENT_SESSION_ID = '91ac8b1e-0000-4000-8000-0000000000bb';

/** 배치 세션 발급(미완료 당일 세션은 멱등 재사용) — mode:'placement'는 구름 미소모 */
function ensurePlacementSession() {
  const today = todayISO();
  let s = sessions.get(PLACEMENT_SESSION_ID);
  if (!s || s.completed || s.session_date !== today) {
    s = {
      session_id: PLACEMENT_SESSION_ID,
      session_date: today,
      mode: 'placement',
      unit_id: null,
      items: PLACEMENT_ITEMS,
      answers: {},
      completed: false,
    };
    sessions.set(PLACEMENT_SESSION_ID, s);
  }
  return s;
}

// ── 보드 연습 퍼즐 (§3.5 /board/puzzles) — **시드 파생**(R10-07 §2.3) ──
// 목록 = 시드의 question_type==='board' 전건. 손으로 베낀 4건이 시드 12건과
// 어긋나 "목으로는 퍼즐 커버리지를 판단할 수 없다"는 상태였다.
// difficulty 1|2|3 (R7-02 S5)도 하드코딩하지 않고 서버 routers/board.board_difficulty와
// **같은 순수 규칙**으로 계산한다(현 시드 12건 = 1,1,1,2,2,2,2,2,3,3,3,3 — 백엔드
// test_board_difficulty와 동일 산출). 목록은 시드 순서를 그대로 반환한다(서버는 θ
// 인접 정렬 — 목은 정렬하지 않음). 시드 순서가 마침 난이도 오름차순이라, "클라이언트가
// 재정렬하지 않는다"는 성질은 이 목록만으로는 더 이상 눈으로 구분되지 않는다.
// content_item_id는 시드 순서로 결정적 합성(실서버는 DB UUID).
// 사전 b — backend weatherbrain_service.LEVEL_GROUP_ITEM_B의 사본.
// R13에서 밴드가 4종(expert 추가)이 되면서 서버가 "adult" **문자열 비교**를 버리고
// b 임계로 바꿨는데, 목이 문자열 비교로 남아 있었다. 그래서 expert 문항이 서버에선
// 어려움(3)인데 목에선 보통(2)으로 떠, 화면상 난이도가 되돌아가는 것처럼 보였다
// (실측: board_order 32~34가 목에서만 보통. 서버 시드 34건은 단조 증가가 맞다).
const LEVEL_GROUP_ITEM_B = { elementary: -1.0, middle_high: 0.0, adult: 1.0, expert: 2.0 };
const DEFAULT_ITEM_B = 0.0;

function boardDifficulty(template, levelGroup) {
  let score = template.mode === 'guided' ? 1 : 2;
  if (template.time_limit_sec) score += 1;
  // 🔴 **서버는 배열 **또는 객체**를 센다**(`isinstance(palette, (list, dict))`).
  //   목은 배열만 봤다 — 시드 55건이 전부 배열이라 **오늘만** 답이 같았고, 객체
  //   palette가 한 건이라도 저작되면 목만 난이도가 1 낮아진다. 초록인 이유가
  //   「규칙이 같아서」가 아니라 「입력이 그 갈래를 안 밟아서」였다(2026-08-20 실측).
  const pal = template.palette;
  const palSize = Array.isArray(pal)
    ? pal.length
    : (pal && typeof pal === 'object' ? Object.keys(pal).length : 0);
  if (palSize >= 3) score += 1;
  const priorB = LEVEL_GROUP_ITEM_B[levelGroup] ?? DEFAULT_ITEM_B;
  if (priorB >= LEVEL_GROUP_ITEM_B.adult) score += 1;
  return Math.max(1, Math.min(3, score));
}

// 서버 order_puzzles_for_progress와 같은 규칙 — 저작 순서(board_order) 오름차순,
// 없는 문항은 뒤로. 순차 진행에서 순서가 곧 코스라 목이 시드 순서를 그대로 쓰면
// 잠금 판정이 실서버와 갈린다.
// 서버와 같은 폴백 — `??`로 두면 board_order=0이 맨 앞으로 가는데 서버는
// 정수가 아닌 값만 뒤로 보낸다(0은 정수라 그대로 0). 판정이 갈리지 않게 맞춘다.
//
// 🔴 서버 판정은 파이썬 `isinstance(value, int)`다. `typeof v === 'number'`로는
//    두 갈래가 갈렸다(2026-08-20 실측 — 시드 55건이 전부 정수라 **답만** 같았다):
//    ⑴ **비정수 실수**: 파이썬에서 int가 아니므로 뒤(10000)로 간다. JS는 number라
//       앞으로 보냈다 — `2.5`가 `3`보다 앞에 서던 자리다.
//    ⑵ **불리언**: 파이썬에서 bool은 int라 `true`가 키 1, `false`가 키 0으로
//       **맨 앞에 선다**. JS는 boolean이라 뒤로 보냈다. 서버 쪽 기벽이지만
//       서버가 권위라 그대로 베낀다.
//    ⚠️ 남는 한계: `3.0`처럼 **정수값 실수**는 서버에선 뒤로 가지만 JS에는 그런
//       구분 자체가 없다(`Number.isInteger(3.0) === true`). JSON을 건너면 파이썬도
//       int 3으로 읽으므로 계약도 이 갈래는 볼 수 없다 — 시드가 정수만 쓰는 한
//       도달하지 않는 자리라 여기 적어 두는 것으로 갈음한다.
//
// ── 병합(2026-08-20 A조 ↔ B조) ────────────────────────────────────────────
// 🔴 퍼즐의 **층** = 지식 단계(A조 축 교체). 서버 `board_tier`의 사본이고 파생이
//    아니라 **저작값**이다 — 꾸밀 규칙이 없다.
// 🔴 **A조 첫 판은 `typeof v === 'number'`를 썼고, 그것이 위에 적힌 바로 그 함정
//    이었다.** 같은 트리에서 B조가 `boardOrderOf`의 같은 결함을 잡아 놓은 채였다 —
//    한 파일 안에서 한쪽은 고쳐지고 한쪽은 새로 만들어졌다. 그래서 **같은 가드**로
//    통일한다. 경위를 남기는 이유는 이 형태가 오늘 세 번 나왔기 때문이다.
// ⚠️ 서버 `board_tier`는 `isinstance(level, int)`이므로 **bool도 통과한다**
//    (파이썬에서 bool은 int다) — `true`면 값 자체가 1처럼 비교된다. 그 기벽까지 베낀다.
// ⚠️ 미상은 `10000`이 아니라 **`null`**이다 — 층의 부재는 정렬 꼬리 뿐 아니라
//    **「잠그지 않는다」는 뜻**을 갖는다(서버 `locked_tiers`). 정렬에서만 `?? 10000`을
//    씌운다. 여기서 10000을 내면 미상 퍼즐이 10층으로 취급돼 전 밴드에서 잠긴다.
const boardTierOf = (seed) => {
  const v = seed?.knowledge_level;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return Number.isInteger(v) ? v : null;
};

const boardOrderOf = (seed) => {
  const v = seed?.template_json?.board_order;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return Number.isInteger(v) ? v : 10000;
};

/**
 * 서버 `routers/board.order_puzzles_for_progress`의 **사본** — 이름을 붙여
 * 뺐다(2026-08-20). 인라인 `.sort()`로 두면 규칙을 표본에 태워 서버가 다시 풀게
 * 할 수 없고, 그러면 「값이 같은 오늘만 조용한」 사본이 하나 더 남는다.
 * JS `Array.sort`도 파이썬 `sorted`도 **안정 정렬**이라 동률·전건 부재는 입력
 * 순서를 지킨다 — 그 성질까지 표본이 밟는다.
 */
// 🔴 **이름이 `byBoardOrder`였다**(2026-08-20 병합 전). 축이 (board_order) 하나에서
//    **(지식 단계, board_order)**로 바뀌어 이름과 본문을 함께 고쳤다 — 이름만 남기면
//    다음 사람이 board_order만 보는 줄 안다.
// ⚠️ **한 곳에 두고 프로덕션(`BOARD_PUZZLES`)과 표본(`orderPuzzlesForProgress`)이
//    함께 쓰는 것이 요점**이다. 프로덕션만 인라인 비교식으로 갈라 놓으면
//    **표본은 초록인데 화면 순서만 갈린다**(B조 되돌림 실측: 인라인으로 바꿔도 53건
//    전건 통과 — 시드가 정수만 써서 산출이 같기 때문. 행동 대조로는 못 잡는다).
//    그래서 `test_보드_퍼즐_정렬이_표본과_같은_규칙을_쓴다`가 **링크를 직접** 문다.
const byTierThenBoardOrder = (a, b) =>
  (boardTierOf(a) ?? 10000) - (boardTierOf(b) ?? 10000)
  || boardOrderOf(a) - boardOrderOf(b);

const orderPuzzlesForProgress = (items) => items.slice().sort(byTierThenBoardOrder);

/**
 * 정렬 **규칙**을 서버가 직접 재도록 내보내는 입력 표본(`board_difficulty_samples`
 * 관례). ⚠️ **정렬 키를 값으로 박지 않는다** — 키 축이 바뀌면(A조가 지식 단계를
 * 얹는 중) 값 대조는 헛울거나 조용히 틀린다. 「같은 입력에 같은 **순서**가
 * 나오는가」만 묻는다.
 * ⚠️ 표본은 **갈리면 순서가 실제로 달라지는** 모양이어야 한다 — 실수 뒤에는
 *    그보다 **큰 정수**를, 불리언 옆에는 **1보다 큰 정수**를 둔다. 그러지 않으면
 *    갈래는 밟는데 답이 같아 계약이 초록으로 통과한다(오늘 palette 2개짜리가
 *    그렇게 되돌림을 놓쳤다).
 *
 * 🔴 **모양이 바뀌었다**(2026-08-20 판정 4): 항목이 「템플릿 배열」에서
 * `{ templates, tiers? }`로 늘었다. **층(지식 단계)은 `template_json` 안이 아니라
 * 컬럼(속성)**이라 템플릿만으로는 1차 키를 실을 수 없기 때문이다 — 서버
 * `board_tier`도 `getattr(item, "knowledge_level")`을 읽는다.
 * `tiers`가 없는 항목은 전건 층 미상(null)이고, 그때 답은 축이 늘기 전과 같다
 * (전부 같은 1차 키 → 2차 키 `board_order`가 결정) — 그래서 위 ⓐ~ⓘ는 손대지 않았다.
 */
const BOARD_ORDER_SAMPLES = [
  // ⓐ 평범한 정수 — 뒤섞인 입력이 오름차순으로 선다
  { templates: [{ board_order: 3 }, { board_order: 1 }, { board_order: 2 }] },
  // ⓑ 0은 「없음」이 아니다 — `??` 폴백으로 되돌아가면 여기서 운다
  { templates: [{}, { board_order: 0 }] },
  // ⓒ 🔴 비정수 실수 + **그보다 큰 정수**. 서버는 2.5를 뒤로 보내 [1,0]이고
  //    `typeof number`로 두면 2.5 < 3이라 [0,1] — 순서가 갈린다
  { templates: [{ board_order: 2.5 }, { board_order: 3 }] },
  // ⓓ 🔴 불리언 + **1보다 큰 정수**. 서버는 true=1·false=0이라 [2,1,0]이고
  //    boolean을 뒤로 보내면 [0,1,2] — 순서가 갈린다
  { templates: [{ board_order: 5 }, { board_order: true }, { board_order: false }] },
  // ⓔ 동률 안정성 — 같은 키끼리는 입력 순서를 지킨다
  { templates: [{ board_order: 2, tag: 'a' }, { board_order: 1 }, { board_order: 2, tag: 'b' }] },
  // ⓕ 전건 부재 안정성 — 전부 10000이라 입력 순서 그대로
  { templates: [{}, { tag: 'x' }, {}] },
  // ⓖ 정수가 아닌 값(문자열·null)은 뒤로, 있는 정수는 앞으로
  { templates: [{ board_order: '3' }, { board_order: null }, { board_order: 7 }] },
  // ⓗ 음수도 정수다 — 뒤로 가지 않는다
  { templates: [{ board_order: -1 }, { board_order: 0 }] },
  // ⓘ template_json 자체가 null — 서버 `(item.template_json or {})`와 같은 자리
  { templates: [null, { board_order: 1 }] },

  // ── 🔴 층 축(지식 단계) 갈래 — 2026-08-20 판정 4 ───────────────────────────
  // 위 ⓐ~ⓘ는 `board_order` 축만 밟는다. 정렬 키가 **(층, board_order)**로 늘었으므로
  // 층 축을 안 밟으면 **1차 키가 갈려도 조용히 통과한다** — 이 파일 위쪽 주석이
  // *「축 변경 후 이 표본으로 재대조할 것」*이라 스스로 적어 둔 그 자리다.
  // ⚠️ 전부 **갈리면 순서가 실제로 달라지는** 모양으로 만들었다: 층이 답을 정해야
  //    하는 갈래에서는 `board_order`를 **전건 같은 값**으로 둬서 2차 키가 답을
  //    가리지 못하게 한다. 그러지 않으면 갈래는 밟는데 답이 같다(palette 2개짜리).
  //
  // ⓙ 🔴 **층 순서와 board_order 순서가 서로 반대** — 이 표본이 핵심이다. 두 키가
  //    같은 방향이면 **어느 키로 정렬해도 답이 같아** 1차 키를 잃어도 조용하다.
  //    층 우선 [0,1,2] ↔ board_order 우선 [2,1,0].
  {
    tiers: [1, 2, 3],
    templates: [{ board_order: 3 }, { board_order: 2 }, { board_order: 1 }],
  },
  // ⓚ 층 **부재 + 존재**(board_order 동일) — 부재가 뒤로 가는가. `?? 0`처럼 앞으로
  //    보내는 폴백으로 되돌리면 [0,1]이 되어 순서가 갈린다.
  {
    tiers: [null, 3],
    templates: [{ board_order: 1 }, { board_order: 1 }],
  },
  // ⓛ 층 **동률** — 1차 키가 같으면 2차 키(board_order)로 떨어진다. 2차 키를
  //    잃으면 안정 정렬이 입력 순서 [0,1]을 내어 갈린다.
  {
    tiers: [4, 4],
    templates: [{ board_order: 2 }, { board_order: 1 }],
  },
  // ⓜ 🔴 층이 **비정수 실수** + 그보다 큰 정수(board_order 동일). 서버
  //    `isinstance(level, int)`는 2.5를 뒤로 보내 [1,0]이고, `typeof v === 'number'`로
  //    두면 2.5 < 3이라 [0,1] — `boardTierOf`의 가드가 갈리는 바로 그 자리다.
  {
    tiers: [2.5, 3],
    templates: [{ board_order: 1 }, { board_order: 1 }],
  },
  // ⓝ 🔴 층이 **불리언** + 1보다 큰 정수(board_order 동일). 파이썬에서 bool은 int라
  //    `true`=1·`false`=0으로 **맨 앞**에 선다 → [2,1,0]. 뒤로 보내면 [0,1,2].
  {
    tiers: [5, true, false],
    templates: [{ board_order: 1 }, { board_order: 1 }, { board_order: 1 }],
  },
];

// ⚠️ **`SEED_ITEMS.filter(...)`가 대입 바로 뒤에 붙어 있어야 한다** —
//   `test_r10_mock_parity_contract::test_보드_퍼즐이_시드_board에서_파생된다`가
//   그 형태를 문다(손으로 베낀 배열 리터럴 차단). 2026-08-20에 정렬을
//   `orderPuzzlesForProgress(...)`로 **감쌌다가 그 계약이 울었고**, 계약의 정규식을
//   넓히는 대신 **코드를 계약에 맞추는 쪽으로 판정**이 났다(클라이언트).
//   ⇒ 감싸지 않고 **같은 비교 함수**(`byTierThenBoardOrder` — 병합 전 이름은
//     `byBoardOrder`였고 축이 (지식 단계, board_order)로 늘며 개명됐다)를 태운다.
//     그러면 표본이 무는
//     `orderPuzzlesForProgress`와 여기가 **한 규칙**을 공유해 사본이 안 생긴다.
const BOARD_PUZZLES = SEED_ITEMS.filter((it) => it.question_type === 'board')
  .sort(byTierThenBoardOrder)
  .map((seed, i) => {
    const n = i + 1;
    const template = seed.template_json ?? {};
    return {
      content_item_id: `b${String(n).padStart(7, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`,
      knowledge_level: boardTierOf(seed),
      concept_tag: seed.concept_tag,
      // 세션 payload 화이트리스트(정답성 필드 구조적 제외) + **보드 목록 전용 표시 필드**.
      // /board/puzzles는 세션 문항 표면이 아니다 — 실서버는 template_json을 통째로
      // 내려주므로 목이 세션 화이트리스트만 쓰면 카드 제목·요약이 목에서만 빈다.
      // QUESTION_PAYLOAD_FIELDS 자체는 건드리지 않는다(서버와 같은 집합이어야 하고,
      // backend test_r10_mock_parity_contract가 그 동일성을 감시한다).
      template_json: {
        ...(questionPayload(template, 'board') ?? {}),
        ...Object.fromEntries(
          ['board_order', 'title', 'summary']
            .filter((k) => template[k] !== undefined)
            .map((k) => [k, template[k]]),
        ),
      },
    };
  });

// 최초 클리어 기록 (content_item_id 집합) — 재도전 0 XP (§3.5)
const clearedBoardPuzzles = new Set();

// 🔴 학습 수준 → **천장 층**(2026-08-20 축 교체). 서버는 천장을 θ 파생값
// (`overall_knowledge_level`)에서 얻는데 목에는 θ 테이블이 없다 — 그래서
// **진단 전 기본값 표**를 옮긴다. 값의 출처는 서버
// `theta_to_knowledge_level(LEVEL_GROUP_ITEM_B[밴드])` 실측이다(2026-08-20):
//   elementary −1.0 → 2 · middle_high 0.0 → 4 · adult 1.0 → 6 · expert 2.0 → 9
// ⚠️ 이것이 **클라이언트가 승인한 노출 표**(초등 8판·성인 48판)를 재현하는 경로다.
// ⚠️ 서버의 두 번째 폴백(`knowledge_level_of_level_group` — 1·3·5·7)과 값이 다르다.
//    선재 어긋남이고 대장에 기록돼 있다. 목은 **1순위 경로만** 흉내 낸다.
// `__mockPolicy().board_level_group_tier`로 노출해 파리티가 실값을 대조한다 —
// 노출하지 않으면 축이 갈려도 그물이 아무 소리를 안 낸다(B조 실측).
const BOARD_LEVEL_GROUP_TIER = {
  elementary: 2,
  middle_high: 4,
  adult: 6,
  expert: 9,
};
/**
 * `boardDifficulty` 규칙을 서버가 직접 재도록 내보내는 **입력 표본**.
 * ⚠️ **객체 palette를 반드시 포함한다** — 시드가 전부 배열이라 그 갈래를 아무도
 *    안 밟았고, 그래서 규칙이 갈린 채로 답만 같았다(2026-08-20).
 */
const BOARD_DIFFICULTY_SAMPLES = [
  { template: { mode: 'guided' }, level_group: 'elementary' },
  { template: { mode: 'goal_only' }, level_group: 'middle_high' },
  { template: { mode: 'guided', time_limit_sec: 60 }, level_group: 'middle_high' },
  { template: { mode: 'guided', palette: ['a', 'b', 'c'] }, level_group: 'middle_high' },
  { template: { mode: 'guided', palette: { a: 1, b: 2, c: 3 } }, level_group: 'middle_high' }, // ← 객체 갈래
  { template: { mode: 'guided', palette: { a: 1, b: 2 } }, level_group: 'middle_high' },
  { template: { mode: 'goal_only', time_limit_sec: 30, palette: ['a', 'b', 'c'] }, level_group: 'adult' },
  { template: {}, level_group: 'expert' },
];

// 층 수 — 서버 `KNOWLEDGE_LEVEL_MAX` 사본. 파리티가 실값을 대조한다.
const BOARD_TIER_MAX = 10;
const BOARD_TIERS = Array.from({ length: BOARD_TIER_MAX }, (_, i) => i + 1);

/**
 * 잠긴 난이도 집합 — 서버 `routers/board.locked_difficulties`의 **사본**이다.
 * 초등은 쉬움만, 중·고등은 쉬움·보통, 성인은 전부(2026-08-10). 열쇠는 진도가
 * 아니라 `users.level_group`이라, 목에서도 PATCH /auth/me로 수준을 바꾸면
 * 그 자리에서 열린다 — 스모크가 그 왕복을 볼 수 있다.
 */
function lockedBoardTiers() {
  // ⚠️ **미상 밴드는 잠그지 않는다**(서버 `locked_tiers`와 같다) — 「못 여는 것이
  //    열리는 것보다 나쁘다」. 값이 비는 순간 퍼즐이 통째로 사라지는 것을 막는다.
  const ceiling = BOARD_LEVEL_GROUP_TIER[mockAuth.levelGroup];
  if (typeof ceiling !== 'number') return new Set();
  return new Set(BOARD_TIERS.filter((t) => t > ceiling));
}

/** BoardPuzzle 1건 (서버 schemas/board.BoardPuzzle) — 목록·상세가 공유한다.
 *  R10-01 D1: 상세 엔드포인트는 단건 전용 스키마를 만들지 않고 이 형태를 그대로 쓴다. */
const boardPuzzlePayload = (p, locked = null) => ({
  content_item_id: p.content_item_id,
  // 🔴 `difficulty`(파생 1~3) **제거** — 서버 스키마와 같은 이름·같은 축이다.
  knowledge_level: p.knowledge_level ?? null,
  template_json: p.template_json,
  cleared: clearedBoardPuzzles.has(p.content_item_id),
  // 잠금 두 축이 다 실린다(서버 schemas/board.BoardPuzzle과 같다).
  // 상세는 잠긴 퍼즐이 그 앞에서 403이라 둘 다 "안 잠김"으로 나간다.
  locked: locked === null ? false : locked.has(p.knowledge_level),
  unlocked: unlockedBoardIds().has(p.content_item_id), // MT-24
});

/** 앞으로 함께 열어 둘 칸 수 — 서버 `board.BOARD_UNLOCK_LOOKAHEAD`와 같아야 한다. */
const MOCK_BOARD_UNLOCK_LOOKAHEAD = 2;

/**
 * 열린 퍼즐 id 집합 (MT-24) — 서버 `compute_unlocked_ids`와 **같은 규칙**이다.
 * ⑴ 이미 깬 칸은 언제나 열림 ⑵ 미클리어는 진행 커서부터 LOOKAHEAD칸까지.
 *
 * 목이 이 규칙을 흉내 내지 않으면 목 위 스모크가 **잠금이 없던 시절의 화면**을
 * 계속 초록으로 통과시킨다 — 목↔서버 정책이 갈라졌던 CO-J-9와 같은 형태다.
 * `BOARD_PUZZLES`는 이미 board_order로 정렬돼 있다(선언부 참고).
 */
// 🔴 **인자를 받게 만들려다 되돌렸다 — 경위를 남긴다**(2026-08-20 판정 2).
//
// 하려던 것: 이 규칙을 순수 함수로 열어 `__mockPolicy().board_unlock_samples`로
// **규칙째** 내보내기(서버가 같은 이유로 `below_ceiling_ids`·`ceiling_tier`·
// `compute_unlocked_ids`로 쪼개 뒀다 — *"잠금 규칙만 따로 고정할 수 있어야 회귀를
// 싸게 잡는다"*). 지금 이 규칙은 **행동 그물이 없다** — 파리티 파일이 그 공백을
// 적어 뒀다: *"`__mockPolicy()`가 목의 잠긴 집합 계산을 노출하지 않는다"*.
//
// 왜 못 했나: `test_board_mock_parity._fn_body`가 **`function unlockedBoardIds()`**
// — 인자 없는 그 형태를 정규식으로 찾고, 몸통에서 「천장 아래 인정」·「천장층 순차」
// 구문을 확인한다(결함 ⑨의 본체). 빼내면 `test_목이_천장_아래를_인정한다`가 울고,
// 기본 인자를 붙이면 `\(\)`가 안 맞아 **함수를 아예 못 찾는다.** 그 파일은 리드
// 소유라 손대지 않고 **코드를 계약에 맞췄다**(같은 날 `BOARD_PUZZLES` 정렬에서
// 내려온 판정과 같은 방향 — 정규식을 넓히지 않고 코드를 맞춘다).
// ⇒ 대신 아래 두 갈래를 **소스 계약**으로 물렸다(`test_r13_mock_policy_parity`의
//   `test_층이_미상인_퍼즐은_열리되_줄에_서지_않는다`). 행동 대조는 리드가
//   `_fn_body` 정규식을 인자까지 받게 넓히면 곧바로 열린다 — 보고했다.
function unlockedBoardIds() {
  // 🔴 **서버 `below_ceiling_ids` + `ceiling_tier`와 같은 규칙**(2026-08-19 결함 ⑨).
  //
  // 종전에는 `sequenceable`(천장 **이하** 전부) 위에서 순차를 셌다. 그러면 수준이
  // **천장만 올리고 시작 위치를 안 옮겨** 성인도 1번부터 3칸씩 걸었다 — PM이 로컬
  // dev에서 **성인인데 01~03만 열리는 것**을 화면으로 확인했다.
  //
  // 고침은 「아래는 인정, 내 층은 순차」다:
  //   · 천장보다 **낮은** 난이도 → 전부 열림(이미 자기 수준 아래다)
  //   · **천장** 난이도 → 순차 그대로(MT-24 유지 — 난이도 곡선이 거기서 산다)
  //
  // ⚠️ 순차 대상을 천장층으로 **좁히지 않으면 천장층이 하나도 안 열린다**: 커서가
  // 1층 맨 앞에 서고 LOOKAHEAD 창이 통째로 1층에 떨어지는데, 그 1층은 이미 인정으로
  // 열려 있어 창이 아무것도 추가하지 못한다(서버 쪽에서 계약 테스트가 그 형태를 잡았다).

  // 🔴 **판정 2 — 층이 미상인 퍼즐은 「열리되 줄에 서지 않는다」**(2026-08-20).
  //
  // ⚠️ **목은 이 갈래를 이미 열고 있었지만 그것은 우연이었다**: 아래 필터가
  // `p.knowledge_level < ceiling`이고 JS에서 `null < 6`이 **참**이라 미상 퍼즐이
  // 「천장 아래」로 새어 들어갔다. 우연히 맞는 코드는 **다음 사람이 「버그」로 보고
  // 고친다** — 그러면 미상 퍼즐이 `locked=false`인데 `unlocked=false`가 되어
  // **누구에게도, 영원히** 안 열린다(저작 실수 하나가 콘텐츠를 소리 없이 증발시킨다).
  // 그래서 **명시 분기**로 올린다. 근거는 `lockedBoardTiers`가 이미 이어받은
  // 「미상은 잠그지 않는다」 관례와 같다 — *못 여는 것이 열리는 것보다 나쁘다.*
  //
  // ⚠️ **우연과 달라지는 자리가 하나 있다**: 종전 우연은 천장이 **숫자일 때만**
  // 참이었다(`null < undefined`는 거짓). 명시 분기는 **천장이 미상이어도** 미상
  // 퍼즐을 연다. 판정 문언(「열리되」)에 조건이 없어 그대로 따랐고, 그 자리는
  // 서버 담당 몫이라 보고했다.
  const items = BOARD_PUZZLES;
  const cleared = clearedBoardPuzzles;
  const ceiling = BOARD_LEVEL_GROUP_TIER[mockAuth.levelGroup];
  const tierless = (p) => p.knowledge_level === null || p.knowledge_level === undefined;

  const unlocked = new Set(
    items
      .filter((p) => {
        if (tierless(p)) return true; // ← 판정 2: 미상은 언제나 열림(명시 분기)
        // 천장 아래 층은 순차와 무관하게 열린다. ⚠️ 천장이 미상이면 「아래」가
        //    정의되지 않아 빈 집합이고, 그때는 `lockedBoardTiers()`가 아무것도 잠그지 않는다.
        return typeof ceiling === 'number' && p.knowledge_level < ceiling;
      })
      .map((p) => p.content_item_id),
  );
  // 이미 깬 칸은 언제나 열린다(서버 compute_unlocked_ids 규칙 ⑴)
  for (const p of items) {
    if (cleared.has(p.content_item_id)) unlocked.add(p.content_item_id);
  }
  // 천장 층 **안에서만** 순차를 센다(규칙 ⑵).
  // ⚠️ **미상은 여기서 빠진다**(판정 2의 「줄에 서지 않는다」) — 아무 층에나 끼우면
  //    그 층의 순서 의미가 깨지고, 미상 퍼즐 하나가 **커서를 붙잡아** 뒤 칸을
  //    막을 수 있다. `=== ceiling`이 이미 미상을 걸러내지만(null !== 숫자), 그것도
  //    우연에 기대는 형태라 조건을 눈에 보이게 적는다.
  const tier = items.filter((p) => !tierless(p) && p.knowledge_level === ceiling);
  let cursor = tier.findIndex((p) => !cleared.has(p.content_item_id));
  if (cursor < 0) cursor = tier.length;
  for (const p of tier.slice(cursor, cursor + MOCK_BOARD_UNLOCK_LOOKAHEAD + 1)) {
    unlocked.add(p.content_item_id);
  }
  return unlocked;
}

/** 잠긴 퍼즐 진입·시도 거부 — 서버 403 BOARD_LOCKED와 같은 코드·같은 문구. */
const boardLockedError = () => [
  403,
  { detail: '앞의 퍼즐을 먼저 풀면 열려요.', code: 'BOARD_LOCKED' },
];

/** 보드 재판정 + 목표 검사 → {passed, phenomena, feedback} (권위 채점 흉내) */
function judgeBoard(boardState, goalConditions) {
  const phenomena = evaluateBoard(boardState, BOARD_RULES);
  const { passed, unmet } = checkGoals(phenomena, goalConditions);
  let feedback;
  if (passed) {
    // 목표 존의 성립 규칙 explain을 우선 사용(§3.4 RAG 절약)
    const goalZone = goalConditions?.[0]?.zone ?? 0;
    feedback = phenomena[goalZone]?.explain ?? '목표 대기현상을 만들었어요!';
  } else {
    feedback = `아직 목표에 도달하지 않았어요. (${unmet.map((u) => `${u.zone}번 존`).join(', ')} 조건 미충족)`;
  }
  return { passed, phenomena, feedback };
}

// 목 세션 저장소: session_id → 세션. 일일 세션과 유닛 세션(§3.2)이 같은
// /session/:id/answer·/complete 엔진을 공유한다(계약: 기존 세션 엔진 재사용).
// 각 세션은 자체 items(_mock 포함)를 들고 있어 세션별로 독립 채점한다.
const sessions = new Map();
const DAILY_SESSION_ID = '5e1c8b1e-0000-4000-8000-0000000000aa';

/** 오늘자 일일 세션이 이미 발급돼 있는가 (R10-01 §3.1·D6).
 *  ensureSession의 발급 조건과 동일 — 진입 게이트를 **신규 발급 분기에서만**
 *  적용하기 위해 분리했다(기존 세션 재조회는 무차단: "풀던 것을 뺏기지 않는다"). */
function dailySessionIssued() {
  const existing = sessions.get(DAILY_SESSION_ID);
  return !!existing && existing.session_date === todayISO();
}

function ensureSession() {
  const today = todayISO();
  const existing = sessions.get(DAILY_SESSION_ID);
  if (!existing || existing.session_date !== today) {
    // 진도 블록 유닛을 **발급 시점에** 못 박는다 — 서버 sessions.recipe_json.unit_block
    // (session_service.py)과 같은 4필드. 왕관 대상은 complete 시점에 문항 태그로
    // 되짚는 것이 아니라 여기 적힌 쌍이 정한다(CO-M6: kind와 concept이 서로 다른
    // 유닛을 가리켜 왕관이 증발하던 결함의 수리). 배합에 진도 슬롯이 있고 열린
    // 미클리어 유닛이 있을 때만 기록한다 — 서버의 `any(kind=='unit')` 조건과 동일.
    const blockUnit = (MOCK_SESSION_RECIPE.unit ?? 0) > 0 ? currentProgressUnit() : null;
    sessions.set(DAILY_SESSION_ID, {
      session_id: DAILY_SESSION_ID,
      session_date: today,
      mode: 'daily',
      unit_id: null,
      items: SESSION_ITEMS,
      answers: {},
      completed: false,
      unit_block: blockUnit
        ? {
            unit_id: blockUnit.id,
            unit_slug: blockUnit.slug,
            kind: blockUnit.kind,
            concept_tag: blockUnit.concept_tag,
          }
        : null,
      // Router 라우팅 결정 흉내 (backend sessions.route_decision.target_concept_tag)
      // — 데일리 만점 왕관 동률 시 이 개념 우선(R8-01 §3.4 majority_concept 정렬).
      // 목 Router는 약점 θ 최하 개념을 겨냥한다고 가정: typhoon(WEAK_TAGS 최약).
      route_target_concept_tag: 'typhoon',
    });
  }
  return sessions.get(DAILY_SESSION_ID);
}

const sessionProgress = (s) => ({
  answered: Object.keys(s.answers).length,
  total: s.items.length,
});

/** 오늘(KST) 이미 발급된 유닛 세션이 있는가 — 서버
 *  `curriculum_service.is_first_unit_session_today`의 목 대응물.
 *
 *  ⚠️ **하루 경계는 KST다**(`todayISO()` → `KST_OFFSET_MS`). UTC로 세면 09:00 KST에
 *  하루가 넘어가고 「하루 첫 세션」이 아침에 두 번 열린다 — 서버는 `session_date`가
 *  `datetime.now(KST).date()` 파생이라 KST이고, 갈리면 목 위 스모크가 실서버에
 *  없는 동선을 검증하게 된다. */
const hasUnitSessionToday = () => {
  const today = todayISO();
  for (const s of sessions.values()) {
    if (s.mode === 'unit' && s.session_date === today) return true;
  }
  return false;
};

/** 유닛 세션 items 구성 — **하루 첫 세션이면 데일리 배합**(2026-08-13 확정).
 *
 *  서버 `create_unit_session`과 같은 갈림이다:
 *    · `dailyFirst` → 10문항 `실황2·신규4·복습3·보드1` (= daily 세션과 같은 배합).
 *      목에는 유닛별 daily 풀이 없으므로 daily가 쓰는 `SESSION_ITEMS`를 그대로
 *      재사용한다 — **검증 대상은 "첫 세션이 데일리 배합·10문항으로 온다"**이지
 *      문항 선정 알고리즘이 아니다(그쪽은 서버 계약 테스트가 소유).
 *    · 그 외 → `MOCK_UNIT_SESSION_SIZE`문항, **실황 0 · 보드 0**의 순수 학습.
 *
 *  ⚠️ **종전 목은 첫 세션도 비실황 3~4문항으로 만들었다.** 서버가 첫 세션에
 *  데일리 배합을 주기 시작하면 그 순간 목과 서버가 갈리고, **프론트 스모크는 그
 *  차이를 못 본다** — 목 위에서는 영영 4문항 화면만 보이기 때문이다. */
function buildUnitItems(unit, dailyFirst = false) {
  if (dailyFirst) {
    // quiz_id를 유닛 세션용으로 다시 붙인다 — daily 세션과 같은 id를 쓰면
    // `sessions` 답안 맵이 두 세션 사이에서 섞인다.
    return SESSION_ITEMS.map((item, i) => ({
      ...item,
      quiz_id: `${todayISO()}-unit${unit.unit_order}-${unit.slug}-d${i + 1}`,
    }));
  }
  if (unit.kind === 'board') {
    const puzzle =
      BOARD_PUZZLES.find((p) => p.concept_tag === unit.concept_tag) ?? BOARD_PUZZLES[0];
    return [
      {
        quiz_id: `${todayISO()}-unit${unit.unit_order}-${unit.section}-board`,
        concept_tag: unit.concept_tag,
        question_type: 'board',
        // 서버 `create_unit_session`이 두 번째 이후 세션에 싣는 블록 라벨과 같은 값.
        // ⚠️ board **유닛**의 퍼즐은 확정 사양의 「보드 0」과 무관하다 — 그 0은
        // 데일리 배합의 board **블록**을 뜻하고, 이쪽은 그 유닛이 가르치는 내용
        // 자체다(서버도 `question_type == "board"`로 필터해 같은 것을 낸다).
        kind: 'unit',
        question_text: puzzle.template_json.question_text,
        template_json: puzzle.template_json,
        level_group: 'middle_high',
        source: 'bank',
        slot_filled: false,
        _mock: {
          goal_conditions: puzzle.template_json.goal_conditions,
          feedbackCorrect: '정확해요! 목표 대기현상을 만들었어요.',
          feedbackWrong: '아직이에요 — 배치를 바꿔 다시 시도해 보세요.',
        },
      },
    ];
  }
  // quiz 유닛(두 번째 이후): **시드 파생**(R10-07 §2.3) — 같은 concept_tag의
  // board·실황 제외 문항을 `MOCK_UNIT_SESSION_SIZE`건. 유형이 겹치지 않는 것을
  // 먼저 골라(결정적) 유닛 하나에서 여러 유형이 보이게 한다.
  // ⚠️ **`SEED_QUIZ_POOL`은 정의부터 board·실황을 뺀 풀**이라 여기서 실황 0 ·
  // 보드 0이 구조적으로 성립한다(확정 사양의 「두 번째 이후는 순수 학습」).
  const candidates = SEED_QUIZ_POOL.filter((it) => it.concept_tag === unit.concept_tag);
  const pool = candidates.length > 0 ? candidates : SEED_QUIZ_POOL;
  const picked = [];
  const seenTypes = new Set();
  for (const seed of pool) {
    if (picked.length >= MOCK_UNIT_SESSION_SIZE) break;
    if (seenTypes.has(seed.question_type)) continue;
    seenTypes.add(seed.question_type);
    picked.push(seed);
  }
  for (const seed of pool) {
    if (picked.length >= MOCK_UNIT_SESSION_SIZE) break;
    if (!picked.includes(seed)) picked.push(seed);
  }
  return picked.map((seed, i) => ({
    ...seedToSessionItem(seed, {
      quizId: `${todayISO()}-unit${unit.unit_order}-${unit.slug}-${i + 1}`,
    }),
    // 서버가 두 번째 이후 세션의 entries에 싣는 블록 라벨과 같은 값 —
    // 완료 화면이 이 값으로 「내 진도」 블록을 표기한다. 없으면 목에서만
    // 라벨이 비어 화면이 서버와 갈린다.
    kind: 'unit',
  }));
}

/** POST /curriculum/units/{id|slug}/session — 유닛 문항으로 세션 발급(멱등, §3.2).
 *  R8-01: slug 진입("이어서 학습")도 허용 — 세션 unit_id는 항상 정규 id로 저장해
 *  id/slug 어느 쪽으로 발급해도 같은 세션·같은 진도 키(unitProgress)를 쓴다. */
function startUnitSession(unitIdOrSlug) {
  const unit = getUnit(unitIdOrSlug);
  if (!unit) return [404, { detail: '유닛을 찾을 수 없습니다', code: 'UNIT_NOT_FOUND' }];
  if (isUnitLocked(unit)) {
    return [403, { detail: '선행 유닛을 먼저 완료해야 열려요', code: 'UNIT_LOCKED' }];
  }
  const unitId = unit.id; // 정규화 — slug 발급이어도 진도는 id 키로 기록
  const today = todayISO();
  const sessionId = `unit-${unitId}-${today}`;
  let s = sessions.get(sessionId);
  if (!s || s.completed || s.session_date !== today) {
    // 진입 게이트 (R10-01 §3.1·D6): 잠금 403 판정 **이후**, 세션 생성 직전.
    //
    // ⚠️ **재사용 판정 다음으로 옮겼다** (2026-08-13 코드 리뷰 결함 ①).
    // 종전 주석은 "서버는 호출마다 새 세션을 만드므로 조건 없이 차단한다 —
    // 목의 멱등 재사용은 목 전용 편의다"였는데, 그 전제가 뒤집혔다: 서버도
    // 오늘·같은 유닛의 미완료 세션을 재사용한다(`curriculum_service.
    // get_open_unit_session` — D10-3 대체). 게이트가 앞에 있으면 구름 0인
    // 학습자가 **이미 발급된 세션**에 재진입할 때 429로 쫓겨나 「이미 발급된
    // 세션은 잔량 0이어도 끝까지 보장」(R10)이 깨진다 — 서버와 목이 **같이**
    // 갖고 있던 결함이라 양쪽을 함께 고쳤다.
    const gate = requireCloudEntry();
    if (!gate.ok) return outOfCloudsError(gate.next_regen_sec);
    // 이 분기 자체가 재사용 규칙이다 — 미완료 당일 세션은 위에서 그대로 반환되고,
    // 완료됐으면(재도전) 새 세션을 발급한다. 서버도 같은 규칙이다.
    //
    // 「오늘 첫 유닛 세션인가」 도장 (2026-08-13 확정) — 서버
    // `recipe_json["daily_first"]`에 대응한다. **발급 시점에 찍고 완료 시점은
    // 읽기만 한다**: 완료 시점에 재계산하면 두 유닛을 역순으로 완료할 때 둘 다
    // 첫 세션이 되거나 둘 다 아니게 된다(서버와 같은 사유).
    const dailyFirst = !hasUnitSessionToday();
    s = {
      session_id: sessionId,
      session_date: today,
      mode: 'unit',
      unit_id: unitId,
      daily_first: dailyFirst,
      items: buildUnitItems(unit, dailyFirst),
      answers: {},
      completed: false,
    };
    sessions.set(sessionId, s);
  }
  return [
    200,
    {
      session_id: s.session_id,
      session_date: s.session_date,
      mode: s.mode,
      unit_id: s.unit_id,
      unit: { id: unit.id, title: unit.title, kind: unit.kind, concept_tag: unit.concept_tag },
      items: sessionItemsOf(s),
      progress: sessionProgress(s),
    },
  ];
}

const stripMock = ({ _mock, ...item }) => item;

/**
 * 세션 items 응답 변환 — stripMock + **재진입 복원 필드** (R13 CO-A5).
 *
 * `GET /session/today`는 하루 동안 멱등이라 중간 이탈 후 다시 들어오는 것이 정상
 * 경로인데, 목이 문항별 정오를 안 실어서 프론트가 만회 큐를 복원할 수 없었다 —
 * 그 결과 **만회 중 새로고침 = 즉시 완료**(CO-M10)를 목 위 스모크로는 원리적으로
 * 볼 수 없었다. 서버 schemas/session.SessionItem과 같은 두 필드를 싣는다:
 *   is_correct    최초 채점 결과. **null = 아직 안 푼 문항**.
 *   retry_correct 만회 결과. null = 만회 시도 없음.
 * 정답 자체(correct_answer)는 여전히 안 나간다 — 나가는 건 "맞았나/틀렸나"뿐이다.
 */
const sessionItemsOf = (s) =>
  s.items.map((item) => {
    const a = s.answers[item.quiz_id];
    return {
      ...stripMock(item),
      is_correct: a ? Boolean(a.is_correct) : null,
      retry_correct: a && a.retry_correct != null ? Boolean(a.retry_correct) : null,
    };
  });

/**
 * 배치고사 「모르겠어요」 센티널 — server `PLACEMENT_SKIP_SENTINEL`의 목 대응물.
 *
 * 건너뛴 문항은 **새 필드가 아니라 기존 `answer` 필드에 이 값**으로 온다
 * (서버 `PlacementAnswerItem`이 `extra='forbid'`라 필드를 늘릴 통로가 없다).
 *
 * ⚠️ **왜 빈 문자열이 아닌가 — 목이 빈 답을 「정답」으로 채점하던 자리다.**
 * `answer: str = ""`가 서버 스키마 기본값이라 "빈 답 = 스킵"이 자연스러워 보이지만,
 * 이 파일의 slider 채점이 `Number('')` → **0**이어서 `|0 - 정답| <= 허용오차`가
 * 되고, **정답값이 허용오차 이하인 slider 문항은 빈 답이 정답**이 됐다. 서버
 * `_grade_slider`는 `float('')` → ValueError → 오답이다. 즉 빈 문자열을 표식으로
 * 쓰면 스킵이 목에서만 정답이 되고, **프론트 스모크가 목 위에서 도는 탓에 그
 * 결함이 계약으로 굳는다**(「목이 서버를 안 따라와 화면에 안 닿는다」의 최악 형태).
 * 비어 있지 않은 센티널은 양쪽 채점기에서 **구조적으로 오답**이다
 * (`float('__skip__')` → ValueError / `Number('__skip__')` → NaN).
 *
 * 값의 **단일 소유자는 서버 상수**이고 목은 같은 리터럴을 쓴다. 세 자리(서버 상수·
 * 프론트·목)가 같은 값인지는 backend `test_placement_skip_mock_parity.py`가 문다 —
 * ⚠️ 여기 주석에 "서버와 같다"고 적는 것은 계약이 아니다(이 파일에 그 주석이
 * 이미 있었고 그래도 갈렸다).
 */
const MOCK_PLACEMENT_SKIP_SENTINEL = '__skip__';

function gradeSessionItem(item, rawAnswer) {
  const answer = String(rawAnswer ?? '').trim();
  const { correct, accept, tolerance } = item._mock;
  const norm = (v) => v.replace(/\s+/g, '').toLowerCase();

  // 「모르겠어요」 = 무조건 오답 (유형 분기보다 **앞**이다).
  // 센티널은 어느 분기에서도 우연히 오답이지만, 그 우연에 기대지 않는다: 규칙이
  // 유형별 채점의 부수효과로만 성립하면 채점기를 손댈 때 조용히 뒤집힌다.
  // 진척(`answered`)은 호출자가 결과를 저장하면서 올라간다 — 스킵도 「푼 문항」이다.
  if (answer === MOCK_PLACEMENT_SKIP_SENTINEL) return false;

  if (item.question_type === 'slider') {
    // ⚠️ **파싱 성공 여부를 먼저 본다** — 서버 `_grade_slider`는 `float()` 실패를
    // 오답으로 떨구는데, JS `Number('')`는 0이라 목만 「정답」이 됐다(선재 결함:
    // 정답값 <= 허용오차인 문항에서 빈 답이 통과. 스킵과 별개로 존재했다).
    // 빈 문자열은 `Number.isFinite(Number(''))`가 true라 따로 걸러야 한다.
    if (answer === '' || !Number.isFinite(Number(answer))) return false;
    return Math.abs(Number(answer) - Number(correct)) <= (tolerance ?? 0);
  }
  if (item.question_type === 'short_answer' || item.question_type === 'cloze') {
    // cloze는 short_answer와 동일 규칙(공백·대소문자 무시) (§3.6)
    return [correct, ...(accept ?? [])].some((a) => norm(a) === norm(answer));
  }
  if (item.question_type === 'match') {
    // 제출 "left:right|left:right" 전 쌍 일치 (순서 무관)
    const submitted = new Map(answer.split('|').map((seg) => {
      const idx = seg.indexOf(':');
      return [seg.slice(0, idx).trim(), seg.slice(idx + 1).trim()];
    }));
    const expected = item._mock.pairs ?? [];
    return expected.length === submitted.size && expected.every((p) => submitted.get(p.left) === p.right);
  }
  if (item.question_type === 'ordering') {
    // 제출 "0,2,1,3" 원본 인덱스 순열이 정답 순서와 완전 일치 (§3.6)
    return answer === item._mock.correctOrder;
  }
  return answer === correct;
}

const routes = {
  'POST /auth/register': (body) => {
    if (body?.email) mockAuth.registeredEmails.add(body.email); // convert 중복 판정 공유
    mockAuth.isGuest = false;
    return [
      201,
      { user_id: '2b1c8b1e-0000-4000-8000-000000000001', access_token: 'mock-access' },
    ];
  },
  'POST /auth/login': () => {
    mockAuth.isGuest = false;
    return [200, { access_token: 'mock-access', refresh_token: 'mock-refresh' }];
  },
  // R11-01 J: 게스트 인증 — 서버 POST /auth/guest와 형태 동일(201 + LoginResponse
  // {access_token, refresh_token}). 드리프트는 test_auth_guest 계약이 감시한다.
  // 바디는 **선택**이다(서버 GuestStartRequest) — 없으면 기본 middle_high.
  // 보내면 그 학령으로 시작한다(R13 CO-P-5). 허용값 밖은 서버 pydantic이 422다.
  //
  // nickname도 **선택**이다(2026-08-14). 안 보내면 이 핸들러는 종전과 완전히 동일하게
  // 동작한다 — 기존 스모크 다수가 무바디·`{level_group}`만으로 부른다.
  // 보내면 유일성 검사를 통과해야 유저가 만들어진다: 이미 쓰이는 이름이면 409
  // `NICKNAME_TAKEN`(서버 `guest_login`의 신고 경로 유일성 검사에 대응 — 프론트
  // `EntryInfoPage`의 거절 걸쇠가 이 코드로 분기한다).
  // 검사 순서는 서버와 같다: pydantic 형태 검증(422)이 먼저고, 유일성은 그 다음이다.
  'POST /auth/guest': (body) => {
    if (body?.level_group != null && !LEVEL_GROUPS.includes(body.level_group)) {
      return [422, { detail: '알 수 없는 학습 수준입니다.', code: 'VALIDATION_ERROR' }];
    }
    const nickname = body?.nickname ?? null;
    // 서버 GuestStartRequest.nickname의 `min_length=1, max_length=50` 대응 —
    // 「안 적음」의 서버 표현은 빈 문자열이 아니라 **필드 부재**다. 이 분기가 없으면
    // 목에서만 빈 이름이 유효한 닉네임으로 접수돼 실서버 422를 리허설할 수 없다.
    if (nickname !== null && (typeof nickname !== 'string' || nickname.length < 1 || nickname.length > 50)) {
      return [422, { detail: '닉네임은 1~50자로 적어 주세요.', code: 'VALIDATION_ERROR' }];
    }
    if (nickname !== null && mockAuth.takenNicknames.has(nickname)) {
      return [409, { detail: '이미 사용 중인 닉네임입니다.', code: 'NICKNAME_TAKEN' }];
    }
    if (nickname !== null) mockAuth.takenNicknames.add(nickname);
    mockAuth.isGuest = true;
    mockAuth.levelGroup = body?.level_group ?? 'middle_high';
    // ⚠️ 이름을 **매번** 덮어쓴다(신고가 없으면 null). 서버는 발급마다 새 유저 행을
    // 새 자동 닉네임으로 만들므로, 앞선 발급의 이름이 다음 무바디 발급에 남으면
    // 「닉네임 없이 부르면 종전과 동일」이 한 프로세스 안에서 깨진다.
    mockAuth.nickname = nickname;
    return [201, { access_token: 'mock-guest-access', refresh_token: 'mock-guest-refresh' }];
  },
  // 진도 불러오기(2026-08-19 **오후** — 클라이언트 결정, 주최측 확인 후) —
  // 서버 `POST /auth/resume`와 형태 동일: {email, password} → 200 LoginResponse ·
  // 자격 불일치 401 INVALID_CREDENTIALS · 형태 위반 422.
  // 드리프트는 backend `test_auth_resume`가 감시한다.
  //
  // 🔴 **같은 날 오전 판을 뒤집는다.** 그 판은 `{nickname}` 하나를 받아
  //    `mockAuth.takenNicknames`에 있으면 토큰을 줬다 — 즉 **이름만 맞히면 남의
  //    진도가 열렸고**, 서버가 실제로 그랬다. 화면만 고치면 그 통로는 curl로
  //    그대로 남는다(대장 §4.14 · 이 파일과 서버가 함께 바뀌어야 하는 이유).
  //    그래서 404 `NICKNAME_NOT_FOUND` · 409 `NICKNAME_AMBIGUOUS` 분기도 함께
  //    걷힌다 — 그 둘은 「그 이름이 있다/없다」를 응답으로 자백하는 열거 표면이었다.
  //
  // 「이 자격이 있는가」의 소유자는 `mockAuth.savedAccounts` **하나**다 — 저장
  // (`guest/convert`)이 넣는 바로 그 맵이라, 목 안에서 「저장 → 불러오기」가 한
  // 왕복으로 성립한다. 사본을 만들면 저장한 자격으로 못 여는 목이 된다.
  'POST /auth/resume': (body) => {
    const email = typeof body?.email === 'string' ? body.email : null;
    const password = typeof body?.password === 'string' ? body.password : null;
    // 서버 ResumeRequest = LoginRequest 형태 — 둘 다 필수다.
    if (!email || !password || email.length > 255) {
      return [422, { detail: 'email·password가 필요합니다.', code: 'VALIDATION_ERROR' }];
    }
    // ⚠️ **없는 계정과 틀린 비밀번호를 가르지 않는다**(서버 `_authenticate`와 같은
    //    의미론). 가르면 응답이 「그 이메일은 있다」를 자백한다.
    if (mockAuth.savedAccounts.get(email) !== password) {
      return [401, { detail: '이메일 또는 비밀번호가 올바르지 않습니다.', code: 'INVALID_CREDENTIALS' }];
    }
    // 그 계정의 주인으로 갈아탄다 — 저장을 마친 사람이므로 게스트가 아니다.
    mockAuth.isGuest = false;
    mockAuth.nickname = null;
    return [200, { access_token: 'mock-resume-access', refresh_token: 'mock-resume-refresh' }];
  },
  // R11-01 §6.2: 게스트→정식 계정 전환 — BE-1 서버 계약 그대로.
  // 게스트 아님 → 409 NOT_GUEST · 이메일 중복 → register 의미론(409 EMAIL_ALREADY_EXISTS,
  // backend routers/auth.register와 동일 코드) · 성공 → 200 LoginResponse(토큰 재발급).
  // "같은 user_id 유지"(XP·θ·진도 보존)는 목이 단일 유저 세계라 자연 성립 —
  // state.*를 건드리지 않는 것이 곧 보존이다. 필수 필드 누락은 422.
  'POST /auth/guest/convert': (body) => {
    if (!mockAuth.isGuest) {
      return [409, { detail: '게스트 계정이 아닙니다.', code: 'NOT_GUEST' }];
    }
    if (!body?.email || !body?.password) {
      return [422, { detail: 'email·password가 필요합니다.', code: 'VALIDATION_ERROR' }];
    }
    if (mockAuth.registeredEmails.has(body.email)) {
      return [409, { detail: '이미 등록된 이메일입니다.', code: 'EMAIL_ALREADY_EXISTS' }];
    }
    mockAuth.registeredEmails.add(body.email);
    // 🔴 **저장이 곧 불러오기의 열쇠가 된다**(2026-08-19 오후). 이 한 줄이 없으면
    //    목에서 「저장했는데 그 자격으로 못 연다」가 되고, 그것이 정확히 오전 판이
    //    실서버에서 겪은 결함(저장과 불러오기가 서로 다른 열쇠)의 목 버전이다.
    mockAuth.savedAccounts.set(body.email, body.password);
    mockAuth.isGuest = false;
    return [
      200,
      { access_token: 'mock-converted-access', refresh_token: 'mock-converted-refresh' },
    ];
  },
  /**
   * GET /courses — 코스 목록 (R11-01 §3 F · `schemas/curriculum.CoursesOut`).
   *
   * 🔴 **이 핸들러가 없어서 `entry-flow ⑫`가 환경에 따라 갈렸다**(2026-08-18).
   * 경위를 남긴다:
   *   ① 목이 모르는 `/api/v1/*`는 `next()`로 넘어가고, 스모크가 만드는 vite
   *      서버는 `vite.config.js`의 **개발 프록시를 그대로 물려받는다**
   *      (`VITE_MOCK`이 안 켜져 있으므로 프록시 분기가 산다) → `localhost:8000`
   *   ② 그래서 로컬 도커 백엔드가 **떠 있으면** 가짜 토큰이 진짜 401
   *      (`{"detail":"Invalid token","code":"UNAUTHORIZED"}`)을 받고,
   *      401 인터셉터가 refresh를 돌려 토큰을 `mock-access-2`로 갈아 끼운다
   *   ③ 백엔드가 **꺼져 있으면** 연결 실패라 401이 아니어서 refresh가 안 돌고
   *      같은 테스트가 **통과**한다
   * 즉 「목이 안 덮은 경로」가 **환경 전역 상태(도커 기동 여부)에 대한 단정**으로
   * 둔갑했다 — CLAUDE.md가 금지하는 바로 그 형태다.
   *
   * ⚠️ **목의 공백은 조용하지 않다.** 안 덮으면 404가 아니라 **다른 서버의 응답**이
   * 돌아온다. 새 엔드포인트를 프론트가 쓰기 시작하면 여기에도 함께 넣을 것.
   *
   * 시드는 `database/seed/courses.json`과 같은 두 코스다. `CourseSwitcher`가
   * **2개 미만이면 탭을 안 그리므로**(단일 코스 = 고를 것이 없다) 둘 다 있어야
   * 코스 전환 경로가 목 위에서 재현된다.
   */
  'GET /courses': () => [
    200,
    {
      courses: [
        {
          id: 'weather',
          title: '날씨와 기후',
          description: '하늘을 읽는 법부터 기후 변화까지',
          course_order: 1,
          prereq_course_id: null,
          is_default: true,
          units_total: 138,
        },
        {
          id: 'basic-science',
          title: '기초 과학',
          description: '온도·압력·물의 상태 변화',
          course_order: 2,
          prereq_course_id: null,
          is_default: false,
          units_total: 99,
        },
      ],
    },
  ],
  'POST /auth/refresh': () => [200, { access_token: 'mock-access-2' }],
  'POST /auth/logout': () => [200, { success: true }],

  // ── 현재 사용자 정체 (R13 CO-P-4/P-5/P-10 — 서버 routers/auth.me) ──────────
  'GET /auth/me': () => [200, meResponse()],
  // PATCH /auth/me {level_group} — 학령 변경. 서버가 register 하나에만 두었던
  // writer를 **가입 이후에도** 여는 경로다: 게스트는 register를 안 타므로 이것이
  // 없으면 평생 middle_high였다(CO-P-5). 같은 행 갱신이라 θ·XP·진도는 보존된다.
  'PATCH /auth/me': (body) => {
    if (!LEVEL_GROUPS.includes(body?.level_group)) {
      return [422, { detail: '알 수 없는 학습 수준입니다.', code: 'VALIDATION_ERROR' }];
    }
    mockAuth.levelGroup = body.level_group;
    return [200, meResponse()];
  },

  'GET /quiz/today': () => [200, QUIZ],
  'POST /quiz/:id/answer': (body) => {
    const isCorrect = body?.answer === QUIZ.options[0] || body?.answer === '0';
    const xp = isCorrect ? 15 : 2;
    state.xp += xp;
    state.answeredToday = true;
    // 레거시 단일 퀴즈도 quiz_logs 1행 → 서버 today_answered_count에 포함된다.
    // (이 경로는 R5부터 구름을 소모하지 않았고 R10에서도 무소모 유지)
    bumpAnsweredToday();
    recordAnswerFact(QUIZ.concept_tag, isCorrect); // 복습 큐 이력 (R11-01 C2)
    bumpQuest({ xp, correctTag: isCorrect ? QUIZ.concept_tag : null });
    return [
      200,
      {
        is_correct: isCorrect,
        correct_answer: QUIZ.options[0],
        feedback: isCorrect
          ? '정확해요! 고기압 중심에서는 공기가 천천히 내려오면서 눌려 따뜻해지고(단열 압축), 상대습도가 낮아져 구름이 사라집니다. 그래서 오늘처럼 하늘이 맑고 건조한 날씨가 나타나요. 내일 아침에는 복사 냉각으로 일교차가 커질 수 있으니 겉옷을 챙기면 좋아요.'
          : '아쉬워요! 정답은 "단열 압축" 때문이에요. 고기압에서는 공기가 하강하며 눌려 따뜻해지고, 따뜻해진 공기는 수증기를 더 많이 머금을 수 있어 구름이 증발해요. 상승 기류·응결은 반대로 저기압에서 구름이 만들어지는 과정입니다.',
        xp_earned: xp,
        concept_tag: QUIZ.concept_tag,
      },
    ];
  },
  'GET /quiz/history': () => [
    200,
    Array.from({ length: 5 }, (_, i) => ({
      id: `3f1c8b1e-0000-4000-8000-00000000000${i}`,
      quiz_id: `2026-07-0${5 + i}-middle_high-general`,
      concept_tag: ['typhoon', 'air_mass', 'heat_island', 'co2_climate', 'anomaly'][i],
      question_type: 'multiple_choice',
      question_json: { question_text: `지난 퀴즈 ${i + 1}` },
      user_answer: '1',
      is_correct: i % 3 !== 0,
      elapsed_sec: 20 + i * 7,
      answered_at: `2026-07-0${5 + i}T09:1${i}:00Z`,
    })),
  ],

  // ── 세션 API (R2-01 계약 §3.1) ──
  'GET /session/today': () => {
    // 진입 게이트 (R10-01 §3.1·D6): **신규 발급 분기에서만** 429 OUT_OF_CLOUDS.
    // 이미 발급된 오늘 세션의 재조회는 잔량 0이어도 무차단 — 새로고침으로
    // 진행 중 세션을 잃지 않는다("풀던 것을 뺏기지 않는다" 불변식).
    if (!dailySessionIssued()) {
      const gate = requireCloudEntry();
      if (!gate.ok) return outOfCloudsError(gate.next_regen_sec);
    }
    const s = ensureSession();
    return [
      200,
      {
        session_id: s.session_id,
        session_date: s.session_date,
        mode: s.mode,
        items: sessionItemsOf(s),
        progress: sessionProgress(s),
        closing_step: closingStepPayload(s.mode), // R13 A-1 additive
      },
    ];
  },
  // GET /session/{id} — 세션 재조회(유닛 세션 새로고침 복원용)
  'GET /session/:id': (_body, params) => {
    const s = sessions.get(params?.id);
    if (!s) return [404, { detail: '세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    return [
      200,
      {
        session_id: s.session_id,
        session_date: s.session_date,
        mode: s.mode,
        unit_id: s.unit_id ?? null,
        items: sessionItemsOf(s),
        progress: sessionProgress(s),
      },
    ];
  },
  'POST /session/:id/answer': (body, params) => {
    const s = sessions.get(params?.id);
    if (!s) {
      return [404, { detail: '세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    }
    if (s.completed) {
      // 완료된 세션 = 전 문항 응답 완료이므로 실서버와 동일하게 ALREADY_ANSWERED (§3.1 코드 표준)
      return [409, { detail: '이미 답안을 제출한 퀴즈입니다.', code: 'ALREADY_ANSWERED' }];
    }
    const item = s.items.find((it) => it.quiz_id === body?.quiz_id);
    if (!item) {
      return [404, { detail: '세션에 없는 문항입니다', code: 'QUIZ_NOT_FOUND' }];
    }
    // 멱등 가드 + 만회 라운드(R13-01 §2.1) — 멱등 의미론의 **유일한 예외**.
    // 서버(answer_service.is_retry_eligible)와 같은 조건: 최초 오답이고 아직 만회로
    // 해결되지 않은 문항만 재채점한다. 그 밖의 재제출은 현행 그대로 409
    // ALREADY_ANSWERED다(계약 문서 초안의 "409 아님"은 오류였다).
    // 배치고사는 진단이라 제외 — 만회는 학습 루프의 장치다.
    const prior = s.answers[item.quiz_id];
    const retryEligible =
      prior != null && s.mode !== 'placement' && prior.is_correct === false && prior.retry_correct !== true;
    if (prior && !retryEligible) {
      return [409, { detail: '이미 답한 문항이에요', code: 'ALREADY_ANSWERED' }];
    }

    // board 유형(§3.4): board_state 필수·유효성 검사 (구름 소모 전에 422 판정)
    if (item.question_type === 'board') {
      if (!body?.board_state) {
        return [422, { detail: '보드 상태(board_state)가 필요합니다', code: 'BOARD_STATE_REQUIRED' }];
      }
      const validationErrors = validateBoardState(body.board_state);
      if (validationErrors.length > 0) {
        return [422, { detail: `보드 상태가 올바르지 않습니다: ${validationErrors[0]}`, code: 'BOARD_STATE_INVALID' }];
      }
    }

    // R10-01 §3.1: 여기서는 **아무것도 소모하지 않고 차단하지도 않는다**.
    // 발급된 세션의 문항 제출은 잔량 0이어도 항상 200 — 소모는 채점 이후,
    // 오답일 때만 1 (아래 shouldConsumeCloud 분기). 429 OUT_OF_CLOUDS는 발급·
    // 퍼즐 상세 진입에서만 발생한다.
    let isCorrect;
    let phenomena;
    if (item.question_type === 'board') {
      const judged = judgeBoard(body.board_state, item._mock.goal_conditions);
      isCorrect = judged.passed;
      phenomena = judged.phenomena;
    } else {
      isCorrect = gradeSessionItem(item, body?.answer);
    }

    // 만회 재제출(§2.1): retry_correct에만 기록하고 여기서 끝낸다 — 최초 기록
    // (is_correct)은 **불변 보존**이고, 구름 소모·XP·퀘스트·복습 큐 어디에도 닿지
    // 않는다(만회는 벌도 파밍도 아니다). clouds는 잔량만 실측해 돌려준다.
    if (retryEligible) {
      prior.retry_correct = isCorrect;
      const remaining = cloudSpendResult(false);
      return [
        200,
        {
          is_correct: isCorrect,
          correct_answer: item._mock.correct ?? null,
          feedback: isCorrect ? item._mock.feedbackCorrect : item._mock.feedbackWrong,
          // 해설의 출처(R13 CO-I-1) — 없으면 화면이 `ai`로 폴백해 **사람 글에 AI 배지**가 붙는다.
          feedback_source: item._mock.feedbackSource ?? 'ai',
          xp_earned: 0,
          xp_base: 0,
          xp_weak_bonus: 0,
          concept_tag: item.concept_tag,
          session_progress: sessionProgress(s),
          clouds_spent: 0,
          clouds: remaining.clouds,
          is_retry: true,
          retry_correct: isCorrect,
          ...(phenomena ? { phenomena } : {}),
        },
      ];
    }

    // 배치고사(R7-01 S3 계약 확정): 진단 전용 — XP·스트릭·퀘스트 미부여
    const isPlacement = s.mode === 'placement';
    // 구름 소모 (R10-01 §3.1): **채점 이후** 오답에만 1. 정답·배치고사는 0.
    // 재제출은 위 멱등 가드(409)에서 이미 걸러졌으므로 alreadyAnswered=false.
    // 잔량 0에서 오답이어도 429가 아니라 무소모 200 (§3.1 각주 7).
    const spend = cloudSpendResult(shouldConsumeCloud({ isCorrect, isPlacement }));
    // XP는 분해값으로 계산한다 (§3.5 마감 3) — 약점 개념 정답이면 배율 증분이 붙는다.
    const xpParts = quizXpBreakdown({ isCorrect, conceptTag: item.concept_tag, isPlacement });
    const xp = xpParts.xp_earned;
    s.answers[item.quiz_id] = { is_correct: isCorrect, xp_earned: xp };
    if (!isPlacement) {
      state.xp += xp;
      state.answeredToday = true;
      bumpAnsweredToday();
      bumpQuest({ xp, correctTag: isCorrect ? item.concept_tag : null, live: item.slot_filled });
      // 복습 큐 이력 (R11-01 C2) — 배치고사는 이 분기 밖이라 자연 제외(서버와 동일)
      recordAnswerFact(item.concept_tag, isCorrect);
    }
    return [
      200,
      {
        is_correct: isCorrect,
        correct_answer: item._mock.correct ?? null,
        feedback: isCorrect ? item._mock.feedbackCorrect : item._mock.feedbackWrong,
        // 해설의 출처(R13 CO-I-1) — 없으면 화면이 `ai`로 폴백해 **사람 글에 AI 배지**가 붙는다.
        feedback_source: item._mock.feedbackSource ?? 'ai',
        xp_earned: xp,
        // R10-01 §3.5 마감 3 (additive): "약점 극복 +N" 분리 표기용 실측 분해값
        xp_base: xpParts.xp_base,
        xp_weak_bonus: xpParts.xp_weak_bonus,
        concept_tag: item.concept_tag,
        session_progress: sessionProgress(s),
        // D10-1 (additive): 오답 피드백 "구름 −1" 표기용 실측값
        clouds_spent: spend.clouds_spent,
        clouds: spend.clouds,
        ...(phenomena ? { phenomena } : {}),
      },
    ];
  },
  'POST /session/:id/complete': (_body, params) => {
    const s = sessions.get(params?.id);
    if (!s) {
      return [404, { detail: '세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    }
    const progress = sessionProgress(s);
    if (progress.answered < progress.total) {
      return [
        409,
        {
          detail: `아직 답하지 않은 문항이 있어요 (${progress.answered}/${progress.total})`,
          code: 'SESSION_NOT_COMPLETED',
        },
      ];
    }
    // 재완료 여부를 **표시를 세우기 전에** 잡는다 — 서버
    // `routers/session.py`의 `is_first_complete = session.completed_at is None`과
    // 같은 값이고, 보상(배지·왕관·XP 전환)은 전부 이 값에 걸린다.
    const isFirstComplete = !s.completed;
    s.completed = true;
    const results = Object.values(s.answers);
    const correctCount = results.filter((r) => r.is_correct).length;
    // 만회 라운드(R13-01 §2.1): 왕관 판정값이 all_correct → all_resolved로 바뀌었다.
    // correct_count는 **최초 정답 수** 그대로다(회귀 방지) — 만회분을 더하지 않는다.
    const isResolved = (r) => Boolean(r.is_correct) || r.retry_correct === true;
    const allResolved = progress.total > 0 && results.every(isResolved);
    const retryResolvedCount = results.filter((r) => !r.is_correct && r.retry_correct === true).length;

    // 유닛 세션(§3.2 + R8-01 §3.1): 전 문항 정답 시 왕관 +1, cleared 전환 시 +20 XP(1회).
    // unit_result는 백엔드 grant_unit_crown 반환 dict와 동일한 5필드 고정 형태
    // {all_correct, crowns, crown_target, cleared, unit_xp} — 유닛 세션이 아니면 null.
    //
    // ⚠️ **왕관은 「하루 첫 유닛 세션」에만**(2026-08-13 클라이언트 확정 — 서버
    // `routers/session.py`가 `grant_crown=all_correct and daily_first`로 배선됨).
    //
    // 경위를 남긴다(같은 자리가 세 번 뒤집혔다):
    //   · R13-01 §2.10(2026-08-08)이 왕관을 일일 세션의 **진도 블록**으로 옮기면서
    //     유닛 직접 진입을 «연습 전용»(`grant_crown=False`)으로 고정했다.
    //   · 2026-08-12 배합이 `{live:2,new:4,review:3,board:1}`로 바뀌며 **`unit`
    //     kind 자체가 사라졌다** — 진도 블록이 없으니 그 유입로도 함께 죽어
    //     `grant_crown=all_correct`로 되돌렸다.
    //   · 그러자 **하루에 유닛을 여러 개 열수록 왕관이 무제한**이 됐다. daily가
    //     갖고 있던 「하루 1세션 = 하루 1왕관」 상한이 유닛에는 없기 때문이다.
    //     2026-08-13 확정이 그 구멍을 닫는다 — 하루 첫 유닛 세션이 곧 데일리
    //     세션이고, 왕관은 그 세션에만 붙는다.
    //
    // **재계산하지 않고 발급 시점 도장(`s.daily_first`)을 읽는다** — 서버와 같은
    // 이유(두 유닛을 역순으로 완료하면 재계산이 뒤집힌다). 도장이 없는 세션은
    // undefined → falsy라 왕관이 안 나간다(모르는 세션은 안 주는 쪽으로 닫힘).
    //
    // ⚠️ **재완료에는 왕관이 없다 — `isFirstComplete`가 세 번째 조건이다.**
    // 이 자리에는 "멱등은 `grantUnitCrown`이 지킨다(이미 만관이면 null·무동작)"고
    // 적혀 있었고 서버도 같은 말을 적었는데, **둘 다 틀렸다**: 만관 판정은
    // `crowns >= crown_target`이라 `crown_target = 2`인 유닛은 같은 세션에
    // `complete`를 두 번 던지면 두 번째에 왕관이 또 붙는다(서버는 거기에 +20 XP도
    // 얹혔다). 목의 UNITS는 전건 `crown_target: 1`이라 증상이 안 났을 뿐이라
    // **목이 서버 결함을 가려 준 꼴**이었다. 서버가
    // `all_correct and daily_first and is_first_complete`로 닫혔으므로 목도 같이 닫는다.
    let unitResult = null;
    if (s.unit_id) {
      const unit = getUnit(s.unit_id);
      const crownTarget = unit?.crown_target ?? 1;
      const allCorrect = progress.total > 0 && correctCount === progress.total;
      const grantCrown = allCorrect && Boolean(s.daily_first) && isFirstComplete;

      // cleared 전환 여부를 **부여 전에** 기록한다 — `unit_xp`는 서버
      // `grant_unit_crown`의 `xp_earned`와 같은 뜻이라 "이번에 처음 클리어됐을 때만
      // 20"이다. grantUnitCrown의 반환 4필드 계약(crown_award 페이로드)은 건드리지
      // 않으려고 전/후 스냅샷으로 판정한다.
      const wasCleared = getUnitProgress(s.unit_id).cleared_at != null;
      // 🔴 진행 기록은 **왕관과 무관하게 무조건**(2026-08-19 결함 ⑩ — 서버
      // `unit_result_for_session`이 `grant_crown` 분기 **앞**에서 하는 것과 같다).
      // 오답이 있어도·재완료여도 「해 봤다」는 사실은 참이고 다음 유닛은 그것으로
      // 열린다. 멱등 — 첫 시도 시각을 보존한다.
      {
        const pr = getUnitProgress(s.unit_id);
        if (pr.attempted_at == null) pr.attempted_at = new Date().toISOString();
      }
      if (grantCrown) grantUnitCrown(unit ?? null);
      const prog = getUnitProgress(s.unit_id);
      const newlyCleared = !wasCleared && prog.cleared_at != null;

      unitResult = {
        // all_correct는 **최초 시도 만점**이라는 원래 뜻을 유지한다(§2.1) —
        // 두 값이 갈리는 세션 = 만회로 클리어한 세션. 왕관은 이 값 **∧ 첫 세션**을
        // 따른다(만회 클리어에는 왕관이 없다 — 서버와 동일).
        // ⚠️ `all_correct`는 표기값이라 두 번째 이후 세션에서도 그대로 true가
        // 나간다 — 왕관이 안 붙었을 뿐 만점은 만점이다(서버도 같다).
        all_correct: allCorrect,
        crowns: prog.crowns,
        crown_target: crownTarget,
        cleared: prog.cleared_at != null,
        unit_xp: newlyCleared ? 20 : 0, // backend xp_service.XP_UNIT_CLEAR
        all_resolved: allResolved,
      };
    }
    // 데일리 왕관 유입로 (R8-01 §3.4 → R13-01 §2.10 소유권 이전).
    //
    // ⚠️ **판정 범위는 15문항 전건이 아니라 진도 블록(kind==='unit') 5문항이다**
    // (CO-A6 — 서버 routers/session.py `_crown_scope_logs`). "오늘의 발견·복습·
    // 실황"은 다양성 블록이라 유닛 진도의 근거가 아니고, 15문항 전건 해결을
    // 요구하면 왕관이 사실상 닫힌다. 종전 목은 `allResolved`(전건)를 봤다.
    //
    // **진도 블록 0이면 왕관도 0**이다 — 세션 전체로 폴백하지 않는다(CO-M7:
    // 폴백하면 기준이 5문항에서 15문항으로 조용히 올라간다).
    // placement는 제외. daily는 하루 1세션 멱등이라 파밍 자연 상한.
    // 데일리도 **최초 완료에만** — 서버는 이 분기 전체가 `if is_first_complete:`
    // 안에 있다(배지와 같은 블록). 목에는 그 게이트가 없어 서버와 갈렸다.
    let crownAward = null;
    if (s.mode === 'daily' && isFirstComplete) {
      const crownItems = s.items.filter((it) => it.kind === 'unit');
      const crownResolved =
        crownItems.length > 0 && crownItems.every((it) => isResolved(s.answers[it.quiz_id] ?? {}));
      if (crownResolved) {
        const [concept, kind] = crownTargetOf(s, crownItems);
        const target = concept
          ? UNITS.find(
              (u) =>
                u.kind === kind &&
                u.concept_tag === concept &&
                !isUnitLocked(u) &&
                (unitProgress.get(u.id)?.crowns ?? 0) < u.crown_target,
            )
          : null;
        crownAward = grantUnitCrown(target ?? null);
      }
    }
    // 배치고사 세션(R7-01 S3): 응답 이력으로 개념별 초기 능력(θ) 배정 흉내.
    // 실서버는 IRT EAP 추정 — 목은 개념별 정답률의 결정적 선형 근사를 쓴다.
    let placementResult = null;
    if (s.mode === 'placement') {
      state.placementDone = true;
      const byConcept = new Map();
      for (const item of s.items) {
        const r = s.answers[item.quiz_id];
        if (!r) continue;
        const agg = byConcept.get(item.concept_tag) ?? { correct: 0, n: 0 };
        agg.n += 1;
        if (r.is_correct) agg.correct += 1;
        byConcept.set(item.concept_tag, agg);
      }
      // 필드 형식은 /progress/abilities와 통일 (PM 계약 확정 — R7-01 S3)
      placementResult = {
        placement_done: true,
        abilities: [...byConcept.entries()].map(([conceptTag, { correct, n }]) => {
          const theta = Number(((correct / n - 0.5) * 2.4).toFixed(2)); // 0%→-1.2 · 50%→0 · 100%→+1.2
          return {
            concept_tag: conceptTag,
            theta,
            theta_se: Number((1 / Math.sqrt(n + 1)).toFixed(2)),
            num_responses: n,
            level_label: levelFromTheta(theta),
          };
        }),
      };
      // 배치 실응답 θ를 능력 저장소에도 반영 — /dev/state·/progress/abilities 일관 (R7-03)
      for (const a of placementResult.abilities) {
        devAbilities.set(a.concept_tag, { theta: a.theta, num_responses: a.num_responses });
      }
      // 배치 θ 선해제(R7-02 S4): 평균 θ>0이면 커리큘럼 선두(트리 순서)에서
      // 잠금 유닛을 1개(θ>=0.6이면 2개) 연속 선해제 — 왕관 0인데 열림(unlocked)
      // 케이스를 만든다. 실서버는 θ 기반 파생 — 목은 결정적 근사.
      const thetas = placementResult.abilities.map((a) => a.theta);
      const meanTheta = thetas.length ? thetas.reduce((sum, t) => sum + t, 0) / thetas.length : 0;
      const unlockCount = meanTheta >= 0.6 ? 2 : meanTheta > 0 ? 1 : 0;
      let unlocked = 0;
      for (const u of UNITS) {
        if (unlocked >= unlockCount) break;
        if (isUnitLocked(u)) {
          preUnlockedUnits.add(u.id);
          unlocked += 1;
        }
      }
    }
    // 보상 전환 (CO-T-4) — 서버와 같이 **이번 완료로 새로 전환된 것만** 싣는다.
    // 배지는 목이 perfect_session을 기획득 상태로 시드해 두어 신규 획득이 없다.
    //
    // ⚠️ **배치고사는 제외한다.** 서버는 placement를 XP·스트릭·퀘스트·배지·왕관
    // 전부 스킵하고 조기 반환한다(routers/session.py §3.3). 여기서 빼지 않으면
    // `questTransitions()`가 **부수효과로 doneCodes를 태워** 배치 완료가 조용히
    // `daily_xp_30` 전환을 삼키고(배치 화면은 PlacementSummary라 칩이 안 보인다)
    // 첫 데일리 세션에서 칩이 안 뜬다 — 이 PR이 고친 결함을 목 위에 되살린다.
    const isPlacement = s.mode === 'placement';
    const questRewards = isPlacement ? [] : questTransitions();
    const bonusXp = questRewards.reduce((sum, r) => sum + r.reward_xp, 0);
    const itemXp = results.reduce((sum, r) => sum + r.xp_earned, 0);
    return [
      200,
      {
        xp_total: itemXp,
        correct_count: correctCount,
        total: progress.total,
        streak_count: state.streak,
        quest_rewards: questRewards, // CO-T-4 — 방금 완료된 퀘스트
        badges_earned: [], // CO-T-4 — 목은 신규 배지 지급 경로가 없다
        bonus_xp: bonusXp,
        // 표기용 총합은 **서버가 더한다**(프론트 덧셈 금지) — 목도 같은 계약이어야
        // 목 위 스모크가 실서버와 다른 숫자를 초록으로 통과시키지 않는다.
        xp_awarded: itemXp + bonusXp,
        unit_result: unitResult, // R8-01 §3.1 — 유닛 세션이 아니면 null(additive)
        crown_award: crownAward, // R8-01 §3.4 — daily 만점 왕관 유입, 없으면 null(additive)
        all_resolved: allResolved, // R13-01 §2.1 — 만회 포함 전건 해결(왕관 판정값)
        retry_resolved_count: retryResolvedCount, // R13-01 §2.1 — "만회 완료 N문항"
        closing_step: closingStepPayload(s.mode), // R13 A-1 — 15문항 뒤 예보 단계(additive)
        ...(placementResult ?? {}),
      },
    ];
  },

  // ── 온보딩 배치고사 (R7-01 S3) — SessionToday 형태로 진단 세션 발급 ──
  'POST /onboarding/placement/start': () => {
    if (state.placementDone) {
      return [409, { detail: '이미 실력 진단을 마쳤어요', code: 'PLACEMENT_ALREADY_DONE' }];
    }
    const s = ensurePlacementSession();
    return [
      200,
      {
        session_id: s.session_id,
        session_date: s.session_date,
        mode: s.mode,
        items: sessionItemsOf(s),
        progress: sessionProgress(s),
        // 서버 `SessionToday.closing_step` — 배치 세션은 마감 단계가 없어 null이지만
        // **필드는 있어야 한다**. 없으면 화면이 `undefined`와 `null`을 구분 못 한다.
        closing_step: closingStepPayload(s.mode),
      },
    ];
  },

  // POST /onboarding/placement/submit-all (R7-02 S1) — 일괄 채점.
  // body {answers:[{quiz_id, answer, elapsed_sec?}]} → {results, progress}.
  // 이미 채점된 로그는 멱등 스킵(재채점 없이 저장된 결과 반환). 피드백 텍스트 없음.
  // 채점은 기존 answer mock 로직(gradeSessionItem)을 재사용한다(placement에 board 없음).
  'POST /onboarding/placement/submit-all': (body) => {
    const s = sessions.get(PLACEMENT_SESSION_ID);
    if (!s || s.session_date !== todayISO()) {
      return [404, { detail: '배치 세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    }
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    const results = [];
    for (const a of answers) {
      const item = s.items.find((it) => it.quiz_id === a?.quiz_id);
      if (!item) {
        // 세션 외 quiz_id → 404 (백엔드 QuizNotInSessionError 계약과 일치 — R7-14 판정)
        return [404, { detail: '세션에 해당 퀴즈가 없습니다.', code: 'QUIZ_NOT_FOUND' }];
      }
      const prev = s.answers[item.quiz_id];
      if (prev) {
        // 멱등 스킵 — 이미 채점된 로그는 저장된 결과를 그대로 돌려준다
        results.push({ quiz_id: item.quiz_id, is_correct: prev.is_correct });
        continue;
      }
      const isCorrect = gradeSessionItem(item, a?.answer);
      s.answers[item.quiz_id] = { is_correct: isCorrect, xp_earned: 0 }; // 진단 — XP 미부여
      results.push({ quiz_id: item.quiz_id, is_correct: isCorrect });
    }
    return [200, { results, progress: sessionProgress(s) }];
  },

  // ── 대기 보드 연습 API (R3-01 §3.5) ──
  'GET /board/rules': () => [200, BOARD_RULES],
  // GET /board/regions (R5-01 §3.1) — 지도 지역 좌표(렌더 전용, 판정 미사용)
  'GET /board/regions': () => [200, BOARD_REGIONS],
  // 목록은 **무차단**(R10-01 D1) — 잔량 0이어도 퍼즐 화면·cleared 표시는 열린다.
  'GET /board/puzzles': () => {
    const locked = lockedBoardTiers();
    return [200, BOARD_PUZZLES.map((p) => boardPuzzlePayload(p, locked))];
  },
  // GET /board/puzzles/{content_item_id} (R10-01 D1 신설) — 단건 BoardPuzzle.
  // 서버 스키마 재사용(목록 원소와 동일 필드, 단건 전용 스키마 없음).
  // §3.1 차단 지점 3: **퍼즐 상세 진입**에서 잔량 부족이면 429 OUT_OF_CLOUDS.
  // 프론트는 "퍼즐 시작" 시 이 엔드포인트를 호출한다(목록 payload로 바로 플레이 금지).
  'GET /board/puzzles/:id': (_body, params) => {
    const puzzle = BOARD_PUZZLES.find((p) => p.content_item_id === params?.id);
    if (!puzzle) {
      return [404, { detail: '퍼즐을 찾을 수 없습니다', code: 'PUZZLE_NOT_FOUND' }];
    }
    // 잠금 둘 다 **구름 검사보다 먼저**다(서버와 같은 순서) — 뒤집으면 잠긴 칸이
    // OUT_OF_CLOUDS로 나가서, 잔량 0인 사람이 "구름이 없어서"라는 틀린 이유를 듣고
    // 20분을 기다린 뒤 다시 막힌다. 잠긴 칸은 구름을 써도 안 열린다.
    // 난이도가 먼저인 것도 서버와 같다 — 그쪽이 더 바깥 조건이다.
    if (lockedBoardTiers().has(puzzle.knowledge_level)) {
      return [403, { detail: '내 정보에서 학습 수준을 올리면 열려요.', code: 'PUZZLE_LOCKED' }];
    }
    if (!unlockedBoardIds().has(puzzle.content_item_id)) return boardLockedError();
    const gate = requireCloudEntry();
    if (!gate.ok) return outOfCloudsError(gate.next_regen_sec);
    return [200, boardPuzzlePayload(puzzle)];
  },
  // 채점도 잠금을 본다(서버와 같다) — 진입만 막으면 attempt를 직접 POST해서
  // 판정·XP·클리어를 다 받아간다. 목이 이걸 빠뜨리면 스모크가 그 구멍을 못 본다.
  'POST /board/puzzles/:id/attempt': (body, params) => {
    const puzzle = BOARD_PUZZLES.find((p) => p.content_item_id === params?.id);
    if (!puzzle) {
      return [404, { detail: '퍼즐을 찾을 수 없습니다', code: 'PUZZLE_NOT_FOUND' }];
    }
    // 잠금 둘 다 **판정보다 먼저**다(서버와 같은 순서). 진입(GET)만 막으면
    // attempt를 직접 POST해서 판정·XP·클리어를 다 받아간다.
    if (lockedBoardTiers().has(puzzle.knowledge_level)) {
      return [403, { detail: '내 정보에서 학습 수준을 올리면 열려요.', code: 'PUZZLE_LOCKED' }];
    }
    if (!unlockedBoardIds().has(puzzle.content_item_id)) return boardLockedError();
    if (!body?.board_state) {
      return [422, { detail: '보드 상태(board_state)가 필요합니다', code: 'BOARD_STATE_REQUIRED' }];
    }
    const validationErrors = validateBoardState(body.board_state);
    if (validationErrors.length > 0) {
      return [422, { detail: `보드 상태가 올바르지 않습니다: ${validationErrors[0]}`, code: 'BOARD_STATE_INVALID' }];
    }
    // R10-01 §3.1: 시도 시점 소모·차단 없음. 판정 후 **미통과에만** 1 소모.
    const { passed, phenomena, feedback } = judgeBoard(body.board_state, puzzle.template_json.goal_conditions);
    // 복습 큐 이력 (R11-01 C2) — 서버는 보드 시도를 session_id null quiz_logs로
    // 남기고 history_stmt가 포함하므로 목도 기록한다(통과 여부 = 정오).
    recordAnswerFact(puzzle.concept_tag, passed);
    // 보드는 멱등 가드가 없어 매 시도가 새 판정이다 → alreadyAnswered=false.
    // 통과 시 0 (재도전 자체가 무료가 아니라 "틀린 시도"에만 과금 — §3.1).
    const spend = cloudSpendResult(shouldConsumeCloud({ isCorrect: passed }));
    // 최초 클리어만 +5 XP (재도전 0) (§3.5)
    const firstClear = passed && !clearedBoardPuzzles.has(puzzle.content_item_id);
    let xpEarned = 0;
    if (firstClear) {
      clearedBoardPuzzles.add(puzzle.content_item_id);
      xpEarned = 5;
      state.xp += 5;
      bumpQuest({ xp: 5 });
    }
    // 보드 왕관 유입로 (R8-01 §3.4): 그 퍼즐 최초 클리어(기존 +5 XP와 동일 조건)이고
    // 같은 concept_tag의 kind='board' 유닛이 열려 있으면 왕관 +1. 같은 퍼즐 재클리어
    // 불인정(첫 클리어 집합이 자연 차단 — crown_target=2는 서로 다른 퍼즐 2개로 달성).
    let crownAward = null;
    if (firstClear && puzzle.concept_tag) {
      const unit = UNITS.find(
        (u) => u.kind === 'board' && u.concept_tag === puzzle.concept_tag && !isUnitLocked(u),
      );
      crownAward = grantUnitCrown(unit ?? null);
    }
    // 퀘스트 전환 (CO-T-4) — 서버는 `if passed:` 안에서만 재계산한다. 미통과 시도가
    // 보상을 말하면 "틀렸는데 뭔가 받았다"가 되므로 목도 같은 조건으로 가른다.
    const questRewards = passed ? questTransitions() : [];
    return [
      200,
      {
        passed,
        phenomena,
        feedback,
        xp_earned: xpEarned,
        crown_award: crownAward,
        quest_rewards: questRewards, // CO-T-4
        bonus_xp: questRewards.reduce((sum, r) => sum + r.reward_xp, 0),
        // D10-1 (additive): 미통과 피드백 "구름 −1" 표기용 실측값
        clouds_spent: spend.clouds_spent,
        clouds: spend.clouds,
      },
    ];
  },

  'GET /progress/me': () => [200, progressMePayload()],

  // ── 복습 큐 (R11-01 C2 · §6.2) — 응답 이력 파생, 전 개념 + due 플래그 ──
  // 서버 ReviewQueueItem 6필드와 동일 형태(파생 로직은 위 reviewQueuePayload 주석).
  // due 필터·상위 3개 표시는 소비자(ReviewQueueCard) 몫 — 서버와 같은 분업.
  'GET /progress/review-queue': () => [200, reviewQueuePayload()],
  // ── 구름 에너지 (R5-01 §3.3) ──
  'GET /progress/energy': () => [200, energyPayload()],
  // PUT /progress/daily-goal {items} (R10-01 §3.4·D4·D10) — 허용값 3|5|9, 그 외 422.
  // SESSION_RECIPE(합 10)와 독립된 표시용 타깃이다(계약 수치 드리프트 아님).
  // 응답은 `daily_goal_items` **하나뿐**이다 — 서버에 없는 필드를 목에 얹으면
  // 프론트가 그것에 기대어 통합에서 깨진다(mock↔서버 드리프트 금지, D5).
  // 오늘 응답 수는 GET /progress/me의 today_answered_count에서 읽는다.
  'PUT /progress/daily-goal': (body) => {
    const items = Number(body?.items);
    if (!DAILY_GOAL_CHOICES.includes(items)) {
      return [
        422,
        {
          detail: `일일 목표는 ${DAILY_GOAL_CHOICES.join('·')} 중 하나여야 합니다`,
          code: 'VALIDATION_ERROR',
        },
      ];
    }
    state.dailyGoalItems = items;
    return [200, { daily_goal_items: items }];
  },
  // PUT /progress/region {region} (R12 선행 §8.2) — KMA_GRID 12도시 화이트리스트,
  // 밖은 422(daily-goal과 동일 의미론). 응답은 `region` **하나뿐** — 서버에 없는
  // 필드를 목에 얹으면 통합에서 깨진다(mock↔서버 형태 동일 계약).
  // 읽기는 GET /progress/me의 region(기본 '서울' — NULL=서울 해석값).
  'PUT /progress/region': (body) => {
    const region = body?.region;
    if (!REGION_VALUES.includes(region)) {
      return [
        422,
        {
          detail: `지역은 ${REGION_VALUES.join('·')} 중 하나여야 합니다`,
          code: 'VALIDATION_ERROR',
        },
      ];
    }
    state.region = region;
    return [200, { region }];
  },

  // ── 커리큘럼 단계별 학습 (R5-01 §3.2) ──
  'GET /curriculum': () => [200, curriculumPayload()],
  'POST /curriculum/units/:id/session': (_body, params) => startUnitSession(params?.id),

  // ── 일일 퀘스트·배지 (R4-01 §3.1·§3.3) ──
  'GET /progress/quests': () => [200, questPayload()],
  'GET /progress/badges': () => [200, BADGES],
  // GET /progress/weak-tags (R8-01 §3.5) — θ 파생 WeakConceptOut[] 형태.
  // 백엔드와 동일 판정: num_responses>0 AND θ < threshold, θ 오름차순(약한 순).
  // threshold는 middle_high 기준 b(0.0)+logit(0.6)≈0.41 고정(목 단순화).
  'GET /progress/weak-tags': () => {
    const threshold = 0.41;
    return [
      200,
      abilityRows()
        .filter((row) => row.num_responses > 0 && row.theta < threshold)
        .sort((a, b) => a.theta - b.theta)
        .map(({ concept_tag, theta, num_responses }) => ({
          concept_tag,
          theta,
          threshold,
          num_responses,
        })),
    ];
  },
  'POST /progress/attendance': () => [
    200,
    { streak_count: state.streak, is_new_record: false },
  ],
  // GET /progress/abilities (R6 WeatherBrain) — 약한 개념(θ 낮은 순) 우선 정렬.
  // R7-03에서 devAbilities 저장소를 공유해 /dev/theta 조작이 즉시 반영된다.
  // 🔴 **`knowledge_level`·`knowledge_level_max`를 함께 싣는다**(2026-08-20).
  //   목이 이 둘을 빼먹고 있었고, `/me`의 WeatherBrainPanel이 그 필드로 교과 표기를
  //   그리므로 **없으면 4밴드(「초급」)로 내려앉았다** — QA 롤링 0820 ⑴
  //   「`/me` 개념 칩 6개가 전부 초급」의 원인이 이것이다. 같은 날 배치고사 결과
  //   화면에서 고친 것(`PlacementAbility`)과 **같은 형태이고 자리만 달랐다.**
  // ⚠️ 값을 손으로 넣지 않는다 — 서버 `weatherbrain_service.theta_to_knowledge_level`과
  //   **같은 경계**(`THETA_KNOWLEDGE_LEVEL_BOUNDS`)로 θ에서 파생한다. 그 경계는
  //   `__mockPolicy()`로 노출돼 `test_r13_mock_policy_parity`가 서버 실값과 대조한다.
  'GET /progress/abilities': () => [200, abilitiesPayload()],

  // ── 개발자 모드 (R7-03 계약 — /dev/*) ──────────────────────────────────────
  // DEV_MODE(=VITE_MOCK_DEV!=='0')가 꺼지면 실서버(FastAPI 라우터 미등록)와
  // 동일하게 전 경로 404 {"detail":"Not Found"} — 프론트 노출 게이트.
  'GET /dev/state': () => {
    if (!DEV_MODE) return DEV_404;
    return [200, devStatePayload()];
  },
  // POST /dev/reset-me {reset:true} — 계정 진행 전체 초기화(신규 가입 직후 상태로)
  'POST /dev/reset-me': (body) => {
    if (!DEV_MODE) return DEV_404;
    if (body?.reset !== true) {
      return [422, { detail: 'reset:true 가 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    Object.assign(state, {
      xp: 0,
      level: 1,
      streak: 0,
      streakFreeze: 0,
      answeredToday: false,
      answeredTodayCount: 0,
      answeredCountDate: null, // 다음 접근 시 오늘로 재앵커
      dailyGoalItems: null,
      predicted: false,
      tier: 'stratus',
      quest: { xpToday: 0, weakCorrect: 0, liveAnswered: 0 },
      duel: { submitted: false, userPred: null, aiPred: null, evidence: null },
      hindcastAttempts: [],
      clouds: CLOUD_MAX,
      cloudsUpdatedAt: Date.now(),
      placementDone: false,
    });
    devAbilities = seedAbilities();
    unitProgress.clear();
    preUnlockedUnits.clear();
    sessions.clear();
    clearedBoardPuzzles.clear();
    // 신규 가입 직후 = quiz_logs 0행 → 복습 큐 빈 배열 (디자인 시드도 재주입 안 함)
    answerHistory = [];
    return [200, devStatePayload()];
  },
  // POST /dev/theta {abilities:[{concept_tag, theta, num_responses?}]}
  'POST /dev/theta': (body) => {
    if (!DEV_MODE) return DEV_404;
    const abilities = Array.isArray(body?.abilities) ? body.abilities : [];
    if (!abilities.length) {
      return [422, { detail: 'abilities 배열이 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    for (const a of abilities) {
      const theta = Number(a?.theta);
      if (!a?.concept_tag || Number.isNaN(theta)) {
        return [422, { detail: 'concept_tag·theta(숫자)가 필요합니다', code: 'VALIDATION_ERROR' }];
      }
      const prev = devAbilities.get(a.concept_tag) ?? { theta: 0, num_responses: 0 };
      const numResponses =
        a.num_responses != null ? Math.max(0, Number(a.num_responses) || 0) : prev.num_responses;
      devAbilities.set(a.concept_tag, { theta, num_responses: numResponses });
    }
    return [200, devStatePayload()];
  },
  // POST /dev/placement {action:"reset"|"complete"}
  'POST /dev/placement': (body) => {
    if (!DEV_MODE) return DEV_404;
    if (body?.action === 'reset') {
      state.placementDone = false;
      sessions.delete(PLACEMENT_SESSION_ID);
      preUnlockedUnits.clear(); // 배치 θ 선해제도 함께 철회
    } else if (body?.action === 'complete') {
      state.placementDone = true;
    } else {
      return [422, { detail: 'action은 reset|complete 입니다', code: 'VALIDATION_ERROR' }];
    }
    return [200, devStatePayload()];
  },
  // POST /dev/clouds {clouds} — 0..CLOUD_MAX clamp, 회복 타이머 anchor 재설정
  'POST /dev/clouds': (body) => {
    if (!DEV_MODE) return DEV_404;
    const clouds = Number(body?.clouds);
    if (Number.isNaN(clouds)) {
      return [422, { detail: 'clouds(숫자)가 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    state.clouds = Math.max(0, Math.min(CLOUD_MAX, Math.round(clouds)));
    state.cloudsUpdatedAt = Date.now();
    // 서버 `DevCloudsResult`는 `{clouds, max}`다. 목은 개발 패널이 한 번에 갱신되도록
    // 상태 전체를 돌려주지만, **서버가 주는 두 필드는 반드시 들어 있어야 한다** —
    // `max`가 없어서 화면이 상한을 못 읽던 자리다(2026-08-20 전수 대조).
    return [200, { ...devStatePayload(), max: CLOUD_MAX }];
  },
  // POST /dev/curriculum {action:"unlock_all"|"crown"|"reset", unit_slug?, crowns?}
  'POST /dev/curriculum': (body) => {
    if (!DEV_MODE) return DEV_404;
    if (body?.action === 'unlock_all') {
      for (const u of UNITS) preUnlockedUnits.add(u.id);
    } else if (body?.action === 'reset') {
      unitProgress.clear();
      preUnlockedUnits.clear();
    } else if (body?.action === 'crown') {
      // unit_slug는 slug 또는 목 내부 id 둘 다 허용(getUnit — 백엔드는 slug)
      const unit = getUnit(body?.unit_slug);
      if (!unit) return [404, { detail: '유닛을 찾을 수 없습니다', code: 'UNIT_NOT_FOUND' }];
      const prog = getUnitProgress(unit.id);
      prog.crowns = Math.max(0, Number(body?.crowns ?? 1) || 0);
      prog.cleared_at = prog.crowns >= unit.crown_target ? new Date().toISOString() : null;
      // /dev 경로도 진행 축을 채운다 — 왕관만 올리고 attempted_at을 비워 두면
      // 「왕관은 있는데 다음이 안 열린다」가 되고, 그것이 결함 ⑩의 형태다.
      if (prog.crowns > 0 && prog.attempted_at == null) prog.attempted_at = new Date().toISOString();
    } else {
      return [422, { detail: 'action은 unlock_all|crown|reset 입니다', code: 'VALIDATION_ERROR' }];
    }
    return [200, devStatePayload()];
  },
  // POST /dev/streak {streak_count, last_login_days_ago?}
  'POST /dev/streak': (body) => {
    if (!DEV_MODE) return DEV_404;
    const streakCount = Number(body?.streak_count);
    if (Number.isNaN(streakCount) || streakCount < 0) {
      return [422, { detail: 'streak_count(0 이상 숫자)가 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    state.streak = Math.round(streakCount);
    // last_login_days_ago: 실서버는 last_login_date를 오늘-N일로 설정(출석 판정용).
    // 목은 출석 시뮬레이션이 없어 저장만 한다.
    state.devLastLoginDaysAgo = body?.last_login_days_ago ?? null;
    return [200, devStatePayload()];
  },

  'GET /league/current': () => [
    200,
    {
      week_start: weekStartISO(),
      region: '서울',
      mid_forecast: { '3일 후': '맑음, 최고 31℃', '4일 후': '구름많음, 최고 29℃', '5일 후': '흐리고 비, 최고 26℃' },
    },
  ],
  'POST /league/predict': () => {
    if (state.predicted) return [409, { detail: '이번 주에는 이미 제출했어요', code: 'ALREADY_SUBMITTED' }];
    state.predicted = true;
    return [200, { submitted: true }];
  },
  'GET /league/leaderboard': () => [
    200,
    Array.from({ length: 10 }, (_, i) => {
      const elo = 1400 - i * 22;
      return {
        rank: i + 1,
        nickname: ['하늘지기', '비요미', '구름사냥꾼', '태풍의눈', '무지개탐정', '요미', '맑음이', '천둥벌거숭이', '이슬비', '바람돌이'][i],
        accuracy_score: Math.round((97 - i * 4.3) * 10) / 10,
        elo_rating: elo,
        tier: tierFromElo(elo), // 리더보드 행 티어 (§3.2)
      };
    }),
  ],
  'GET /league/me/results': () => [
    200,
    state.predicted
      ? [
          {
            id: '4a1c8b1e-0000-4000-8000-000000000001',
            week_start: weekStartISO(),
            predicted_value: { temp_max: 31, temp_min: 24, rain_prob: 40 },
            actual_value: null,
            accuracy_score: null,
            elo_rating_after: null,
            tier: state.tier, // 서버 `LeagueResultOut.tier` — 목이 빼먹고 있었다
          },
        ]
      : [],
  ],

  // ── 기후 탐정 (R13 — backend routers/detective.py와 같은 형태·같은 판정) ──
  // ⚠️ 상세 응답에 verdict·feedback·supporting_clues·solution을 **넣지 않는다**.
  //    목이 정답을 흘리면 프론트가 목에서만 되는 로컬 판정을 짤 수 있게 된다.
  'GET /detective/cases': () => [
    200,
    DETECTIVE_CASES.map((c) => ({
      case_id: c.case_id,
      title: c.title,
      concept_tag: c.concept_tag,
      knowledge_level: c.knowledge_level ?? null,
      level_group: c.level_group ?? null,
      xp_reward: c.xp_reward ?? 0,
      min_clues: c.min_clues ?? 0,
      headline: c.intro?.headline ?? '',
      clue_count: (c.clues ?? []).length,
      hypothesis_count: (c.hypotheses ?? []).length,
    })),
  ],
  'GET /detective/cases/:caseId': (_body, params) => {
    const c = DETECTIVE_CASES.find((x) => x.case_id === params.caseId);
    if (!c) return [404, { detail: '케이스를 찾을 수 없습니다', code: 'CASE_NOT_FOUND' }];
    return [
      200,
      {
        case_id: c.case_id,
        title: c.title,
        concept_tag: c.concept_tag,
        knowledge_level: c.knowledge_level ?? null,
        level_group: c.level_group ?? null,
        xp_reward: c.xp_reward ?? 0,
        min_clues: c.min_clues ?? 0,
        intro: c.intro ?? {},
        series: c.series ?? [],
        clues: c.clues ?? [],
        hypotheses: (c.hypotheses ?? []).map((h) => ({
          hypothesis_id: h.hypothesis_id,
          text: h.text,
        })),
      },
    ];
  },
  'POST /detective/cases/:caseId/solve': (body, params) => {
    const c = DETECTIVE_CASES.find((x) => x.case_id === params.caseId);
    if (!c) return [404, { detail: '케이스를 찾을 수 없습니다', code: 'CASE_NOT_FOUND' }];
    const minClues = c.min_clues ?? 0;
    const validIds = new Set((c.clues ?? []).map((cl) => cl.clue_id));
    const opened = new Set((body?.opened_clue_ids ?? []).filter((id) => validIds.has(id)));
    if (opened.size < minClues) {
      return [
        422,
        {
          detail: `단서를 ${minClues}개 이상 조사한 뒤에 추리할 수 있어요`,
          code: 'NOT_ENOUGH_CLUES',
          min_clues: minClues,
          opened_clue_count: opened.size,
        },
      ];
    }
    const h = (c.hypotheses ?? []).find((x) => x.hypothesis_id === body?.hypothesis_id);
    if (!h) return [422, { detail: '알 수 없는 가설이에요', code: 'UNKNOWN_HYPOTHESIS' }];
    const correct = h.verdict === 'correct';
    const sol = c.solution ?? {};
    return [
      200,
      {
        verdict: h.verdict,
        correct,
        feedback: h.feedback ?? '',
        supporting_clues: h.supporting_clues ?? [],
        solution: correct
          ? {
              title: sol.title ?? '',
              explanation: sol.explanation ?? '',
              takeaway: sol.takeaway ?? '',
              next_step_hint: sol.next_step_hint ?? '',
            }
          : null,
        xp_earned: 0, // 서버와 동일 — 영속이 없어 적립하지 않는다
        opened_clue_count: opened.size,
        min_clues: minClues,
      },
    ];
  },

  // ── 과거 예보 (MT-30 — backend routers/hindcast.py와 같은 형태·같은 판정) ──
  // ⚠️ 목록 응답에 actual·sources·explanation을 **넣지 않는다**(서버 스키마가
  //    구조적으로 배제한 것과 같은 계약). 목이 정답을 흘리면 프론트가 목에서만
  //    되는 로컬 판정을 짤 수 있게 된다.
  // 날짜 계산이 없다 — 회차는 고정 과거 날짜라 하루 경계(KST)가 개입하지 않는다.
  'GET /hindcast/cases': () => [
    200,
    {
      cases: HINDCAST_CASES.map((c) => ({
        case_id: c.case_id,
        observed_date: c.observed_date,
        region: c.region,
        station: c.station,
        title: c.title,
        intro: `${c.title} 회차입니다. 그날의 최고기온과 강수확률을 예보해 보세요.`,
        climatology: c.climatology,
        is_demo_fixture: true,
        disclosure: HINDCAST_DISCLOSURE,
        already_played: state.hindcastAttempts.some((a) => a.case_id === c.case_id),
      })),
      disclosure: HINDCAST_DISCLOSURE,
    },
  ],
  'GET /hindcast/attempts': () => [200, { attempts: state.hindcastAttempts }],
  'POST /hindcast/cases/:caseId/predict': (body, params) => {
    const c = HINDCAST_CASES.find((x) => x.case_id === params.caseId);
    if (!c) return [404, { detail: '그런 과거 예보 회차가 없습니다.', code: 'CASE_NOT_FOUND' }];

    const tempMax = Number(body?.temp_max);
    const rainProb = Number(body?.rain_prob);
    if (
      !Number.isFinite(tempMax) || !Number.isFinite(rainProb) ||
      tempMax < -60 || tempMax > 60 || rainProb < 0 || rainProb > 100
    ) {
      return [422, { detail: '최고기온·강수확률 값이 올바르지 않습니다.', code: 'INVALID_PREDICTION' }];
    }
    // 회차당 1회 — 서버 UNIQUE(user_id, case_id)의 목 대응물
    if (state.hindcastAttempts.some((a) => a.case_id === c.case_id)) {
      return [409, { detail: '이 회차는 이미 예보했습니다.', code: 'ALREADY_SUBMITTED' }];
    }

    const scoringActual = hindcastScoringActual(c);
    const userPred = { temp_max: tempMax, rain_prob: rainProb };
    // 캐스터: 평년값 기준 + 고정 오프셋(목은 결정적 해시 대신 단순 고정 — 서버의
    // 재현성 계약은 backend tests가 문다. 여기서는 "평년값 근처"만 성립하면 된다).
    const aiPred = {
      temp_max: Math.round((c.climatology.temp_max + 0.8) * 10) / 10,
      rain_prob: Math.max(0, Math.min(100, c.climatology.rain_prob - 5)),
      noise_scale: 1.0,
    };
    const userScore = hindcastAccuracy(userPred, scoringActual);
    const aiScore = hindcastAccuracy(aiPred, scoringActual);
    const result = userScore > aiScore ? 'win' : userScore < aiScore ? 'lose' : 'draw';

    const payload = {
      case_id: c.case_id,
      observed_date: c.observed_date,
      title: c.title,
      user_pred: { ...userPred, noise_scale: null },
      ai_pred: aiPred,
      actual: { ...scoringActual, sum_rn: c.actual.sum_rn },
      user_score: userScore,
      ai_score: aiScore,
      result,
      explanation: `실제 최고기온은 ${c.actual.temp_max}℃였고, 일강수량은 ${c.actual.sum_rn}mm였습니다.`,
      sources: {
        temp_max: `${c.actual.temp_max}℃ — 공개 기록 기반 고정 픽스처(출처는 서버 hindcast_service.HINDCAST_CASES가 소유).`,
        sum_rn: `${c.actual.sum_rn}mm — 공개 기록 기반 고정 픽스처.`,
      },
      created_at: new Date().toISOString(),
    };
    state.hindcastAttempts = [payload, ...state.hindcastAttempts];
    return [200, payload];
  },

  // ── 예보 대결 (R4-01 §3.4 /duel + R9-01 §3.1 브리핑·근거) ──
  'GET /duel/today': () => [200, duelTodayPayload()],
  'GET /duel/briefing': () => [200, duelBriefingPayload()],
  'POST /duel/today': (body) => {
    if (state.duel.submitted) {
      return [409, { detail: '오늘은 이미 예보를 제출했어요', code: 'ALREADY_SUBMITTED' }];
    }
    const tempMax = Number(body?.temp_max);
    const rainProb = Number(body?.rain_prob);
    if (Number.isNaN(tempMax) || Number.isNaN(rainProb)) {
      return [422, { detail: '최고기온·강수확률을 숫자로 입력해주세요', code: 'INVALID_PREDICTION' }];
    }
    // 근거 선택(R9-01 §3.1 additive): 배열이 아니거나 미지 코드가 있으면 422
    let evidence = null;
    if (body?.evidence != null) {
      if (
        !Array.isArray(body.evidence) ||
        body.evidence.some((code) => !EVIDENCE_CODES.includes(code))
      ) {
        return [422, { detail: '알 수 없는 근거 코드가 있어요', code: 'INVALID_EVIDENCE' }];
      }
      evidence = [...new Set(body.evidence)];
    }
    state.duel.submitted = true;
    state.duel.userPred = { temp_max: tempMax, rain_prob: rainProb };
    state.duel.aiPred = DUEL_AI_PRED; // 제출 시점 결정적 생성·고정 (§3.4)
    state.duel.evidence = evidence; // user_pred JSONB 동봉 저장 흉내 (§3.1)
    return [200, duelTodayPayload()];
  },
  // 정산 완료분은 evidence_review(근거 적중 해설)·caster_grade 포함 (R9-01 §3.1·§3.2)
  'GET /duel/history': () => [
    200,
    [
      {
        id: 'd0000001-0000-4000-8000-000000000001',
        duel_date: '2026-07-20',
        user_pred: { temp_max: 29, rain_prob: 60 },
        ai_pred: { temp_max: 31, rain_prob: 40, noise_scale: 0.7 },
        actual: { temp_max: 28.5, rain_prob: 70 },
        user_score: 92.1,
        ai_score: 78.3,
        result: 'win',
        xp_earned: MOCK_DUEL_WIN_XP, // 서버 `_duel_xp_earned`: win이면 DUEL_WIN_XP, 그 외 0
        caster_grade: 'nimbostratus',
        evidence: ['pop_trend', 'recent_rain'],
        evidence_review: [
          { code: 'pop_trend', hit: true, note: '강수확률이 오후로 갈수록 상승했고 실측에서도 비가 관측됐어요.' },
          { code: 'recent_rain', hit: true, note: '최근 7일 중 강수 이력이 있었고 실제로도 비가 이어졌어요.' },
        ],
      },
      {
        id: 'd0000002-0000-4000-8000-000000000002',
        duel_date: '2026-07-19',
        user_pred: { temp_max: 33, rain_prob: 20 },
        ai_pred: { temp_max: 31, rain_prob: 30, noise_scale: 0.7 },
        actual: { temp_max: 30.8, rain_prob: 35 },
        user_score: 74.0,
        ai_score: 88.5,
        result: 'lose',
        caster_grade: 'nimbostratus',
        evidence: ['sky_overcast'],
        evidence_review: [
          { code: 'sky_overcast', hit: false, note: '흐림을 근거로 골랐지만 실측 하늘은 구름많음에 그쳤어요.' },
        ],
      },
    ],
  ],
};

function matchRoute(method, path) {
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const paramNames = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:[^/]+/g, (seg) => {
          paramNames.push(seg.slice(1));
          return '([^/]+)';
        }) +
        '$',
    );
    const matched = path.match(re);
    if (matched) {
      const params = Object.fromEntries(paramNames.map((name, i) => [name, matched[i + 1]]));
      return (body) => routes[key](body, params);
    }
  }
  return null;
}

// ── 계약 테스트용 introspection (읽기 전용, R10-07 §2.3) ────────────────────
// backend tests/test_r10_mock_parity_contract.py가 node로 이 모듈을 import해
// **목이 실제로 내보내는 페이로드**를 서버 계약과 대조한다(소스 텍스트 파싱이 아니라
// 실값 대조 — 파생 로직이 바뀌어도 계약이 헛돌지 않는다).
// 런타임 응답 경로에는 관여하지 않는다. 전부 stripMock을 거쳐 _mock을 제거한다.
export const __mockFixtures = () => ({
  seed_source: SEED_SOURCE, // 'seed' | 'fallback' — 폴백으로 조용히 통과하는 경로 차단
  session_recipe: MOCK_SESSION_RECIPE,
  session_items: SESSION_ITEMS.map(stripMock),
  placement_items: PLACEMENT_ITEMS.map(stripMock),
  // ⚠️ point-free(`.map(boardPuzzlePayload)`)로 쓰지 말 것 — map이 두 번째 인자로
  // **인덱스**를 넘겨 그게 `locked`로 들어간다(2026-08-10: `0.has is not a
  // function`으로 목 import 전체가 죽었다). 잠금 집합은 목록 응답에서만 실리므로
  // 여기서는 인자 없이 부른다.
  board_puzzles: BOARD_PUZZLES.map((p) => boardPuzzlePayload(p)),
  unit_items: UNITS.map((u) => ({
    slug: u.slug,
    kind: u.kind,
    items: buildUnitItems(u).map(stripMock),
  })),
  board_regions: BOARD_REGIONS,
});

/**
 * 목이 **정책으로 삼는 실값** (CO-J-9 / 대장 CO-SN3 설계 선반영, 2026-08-08).
 *
 * `__mockFixtures()`가 "목이 내보내는 페이로드"를 노출한다면 이쪽은 "목이 그
 * 페이로드를 만들 때 쓰는 상수·정책"을 노출한다. 목 패리티가 4도메인 중 배합
 * 하나만 대조하고 있었고, 에너지 상수 3종은 목이 **하드코딩 리터럴로 복사**한
 * 채 대조가 0이었다 — 서버 `Settings.CLOUD_*`가 바뀌어도 목은 조용히 옛 값으로
 * 남는다. 왕관은 이미 행위가 갈라져 있었다(§2.10 이전).
 *
 * backend `tests/test_r13_mock_policy_parity.py`가 node로 이 값을 읽어 서버
 * 실값과 대조한다. **여기 적힌 값을 테스트에 사본으로 옮기지 말 것** — 사본을
 * 만드는 순간 이 계약은 자기 자신을 대조하게 된다.
 */
export const __mockPolicy = () => ({
  // 구름 에너지 (server Settings.CLOUD_MAX·CLOUD_REGEN_MINUTES·CLOUD_COST)
  cloud_max: CLOUD_MAX,
  cloud_regen_minutes: CLOUD_REGEN_MS / 60000,
  cloud_cost: CLOUD_COST,
  // 세션 배합 (server Settings.SESSION_RECIPE) — 하루 첫 유닛 세션도 이 배합이다
  session_recipe: MOCK_SESSION_RECIPE,
  // 출제 순서 (server session_service.plan_bank_picks의 블록 호출 순서)
  block_order: MOCK_BLOCK_ORDER,
  // **두 번째 이후** 유닛 세션 문항 수 (server Settings.UNIT_SESSION_SIZE).
  // 첫 세션은 위 배합 총합(10)이라 이 값이 아니다 — 2026-08-13 확정.
  unit_session_size: MOCK_UNIT_SESSION_SIZE,
  // daily 비진도 블록 board 상한 (server Settings.DAILY_BOARD_CAP — CO-H5)
  daily_board_cap: MOCK_DAILY_BOARD_CAP,
  // 보드 순차 잠금 앞보기 (server routers/board.BOARD_UNLOCK_LOOKAHEAD — MT-24)
  board_unlock_lookahead: MOCK_BOARD_UNLOCK_LOOKAHEAD,
  // 온보딩 배치고사 문항 수 (server Settings.PLACEMENT_SIZE — 2026-08-12 6 → 10).
  // ⚠️ **선언 상수가 아니라 실제로 만들어진 배열의 길이를 내보낸다.** 상수를
  // 내보내면 배열이 6건에 멈춰 있어도 패리티가 초록이라 결함이 그대로 산다 —
  // 이 항목이 애초에 그렇게 생겼다(결함 ④).
  placement_size: PLACEMENT_ITEMS.length,
  // 배치고사 「모르겠어요」 센티널 (server PLACEMENT_SKIP_SENTINEL).
  // ⚠️ 리터럴을 다시 적지 말고 **상수 식별자를 내보낸다** — 값을 여기 복사하면
  // 이 항목이 자기 사본을 대조하게 되고, 그것이 에너지 상수 3종이 갈렸던 방식이다
  // (CO-J-9). 세 자리 대조는 `test_placement_skip_mock_parity.py`가 소유한다.
  placement_skip_sentinel: MOCK_PLACEMENT_SKIP_SENTINEL,
  // 학령 (server schemas/auth.LevelGroup)
  level_groups: LEVEL_GROUPS,
  // 보드 난이도 잠금 (server routers/board.BAND_MAX_DIFFICULTY)
  // 🔴 새 축을 노출한다 — 파리티 그물이 **값만** 보므로, 노출하지 않으면 서버가
  //    축을 바꿔도 목이 옛 축으로 계산하며 아무도 안 운다(B조 실측 2026-08-20).
  board_level_group_tier: BOARD_LEVEL_GROUP_TIER,
  board_tier_max: BOARD_TIER_MAX,
  // 지식 단계 축 (server weatherbrain_service.KNOWLEDGE_LEVEL_MAX ·
  // THETA_KNOWLEDGE_LEVEL_BOUNDS) — /progress/me의 분모와 경계다.
  knowledge_level_max: KNOWLEDGE_LEVEL_MAX,
  theta_knowledge_level_bounds: THETA_KNOWLEDGE_LEVEL_BOUNDS,
  // 🔴 **그물 밖이던 사본 넷**(2026-08-20 전수 대조). 값이 서버와 같아도
  //   노출이 없으면 **서버가 바뀔 때 아무 소리가 안 난다.** 같은 파일 안에서
  //   어떤 사본은 대조되고 어떤 사본은 안 되던 것이 위험이었다.
  level_group_item_b: LEVEL_GROUP_ITEM_B,   // server weatherbrain_service.LEVEL_GROUP_ITEM_B
  default_item_b: DEFAULT_ITEM_B,           // server weatherbrain_service.DEFAULT_ITEM_B
  level_group_tone: LEVEL_GROUP_TONE,       // server weatherbrain_service.LEVEL_GROUP_TONE
  // ⚠️ 표가 아니라 **규칙**을 노출한다 — 같은 입력에 같은 답을 내는지 서버가
  //    직접 재게 한다. 표만 맞고 규칙이 갈린 것이 palette 갈래였다.
  board_difficulty_samples: BOARD_DIFFICULTY_SAMPLES.map((c) => ({
    ...c, out: boardDifficulty(c.template, c.level_group),
  })),
  // ⚠️ 같은 이유로 **진행 순서 규칙**도 규칙째 노출한다 (server
  //    routers/board.order_puzzles_for_progress — 2026-08-20).
  //    출력은 정렬 키가 아니라 **입력 인덱스의 순열**이다: 키를 값으로 박으면
  //    A조가 축을 `(지식 단계, board_order)`로 갈아탈 때 헛울거나 조용히 틀린다.
  //    순열로 물으면 축이 바뀌어도 「같은 입력에 같은 순서인가」는 그대로 성립한다.
  //    🔴 **층은 `template_json` 안이 아니라 컬럼(속성)으로 싣는다**(2026-08-20
  //    판정 4) — 서버 `board_tier`가 `getattr(item, "knowledge_level")`을 읽으므로
  //    템플릿 안에 넣으면 양쪽 모두 「층 없음」으로 읽고 **1차 키를 안 밟는다.**
  //    `tiers`가 없는 표본은 전건 null로 정규화해 내보낸다(JSON에서 `undefined`가
  //    조용히 사라지는 것을 막는다 — 사라지면 파이썬 쪽이 길이를 못 맞춘다).
  board_order_samples: BOARD_ORDER_SAMPLES.map(({ templates, tiers }) => ({
    templates,
    tiers: tiers ?? templates.map(() => null),
    out: orderPuzzlesForProgress(
      templates.map((t, i) => ({
        i,
        knowledge_level: tiers ? tiers[i] : null,
        template_json: t,
      })),
    ).map((x) => x.i),
  })),
  // 🔴 **열림 규칙(잠금의 짝)은 여기서 노출하지 못했다 — 공백을 명시해 둔다.**
  //    2026-08-20 판정 2를 규칙째 내보내려 `board_unlock_samples`를 만들었다가
  //    되돌렸다: `unlockedBoardIds`가 인자를 받으면 리드 소유
  //    `test_board_mock_parity._fn_body`의 `function unlockedBoardIds()` 정규식이
  //    함수를 아예 못 찾는다(그 함수 선언부 주석이 경위를 소유한다). 그래서 판정 2의
  //    두 갈래는 **소스 계약**으로 물렸고(`test_층이_미상인_퍼즐은_열리되_줄에_서지_않는다`),
  //    행동 대조는 그 정규식이 인자를 받게 넓혀질 때 이 자리에 붙인다.
  duel_win_xp: MOCK_DUEL_WIN_XP, // server duel_service.DUEL_WIN_XP
  guest_level_group: 'middle_high', // server routers/auth.GUEST_LEVEL_GROUP
  guest_email_domain: GUEST_EMAIL_DOMAIN, // server routers/auth.GUEST_EMAIL_DOMAIN
  // 왕관 정책 (server routers/session.py — §2.10 소유권 이전)
  crown: {
    // 일일 세션의 왕관 판정 범위: 15문항 전건이 아니라 진도 블록 kind
    daily_scope_kind: 'unit',
    // 진도 블록 0인 세션은 세션 전체로 폴백하지 않는다 (CO-M7)
    daily_scope_fallback_to_session: false,
    // 유닛 세션의 왕관 — **하루 첫 세션에만**(2026-08-13 확정).
    // 서버는 `grant_crown=all_correct and daily_first`이고, 판정은 발급 시점에
    // 찍은 도장(`recipe_json["daily_first"]` / 목은 `s.daily_first`)을 읽는다.
    unit_session_grants_crown: 'daily_first_only',
    // 「첫 세션인가」를 **완료 시점에 재계산하지 않는다** — 발급 시점 도장을
    // 읽기만 한다(역순 완료 경합 방지).
    unit_first_stamped_at_issue: true,
    // 왕관 대상 쌍의 출처: 발급 시점에 기록한 진도 블록 유닛 (CO-M6)
    target_source: 'unit_block',
  },
});

/**
 * θ→단계 변환 자체를 노출한다 — 상수 표가 같아도 **비교 방향**(< vs <=)이
 * 다르면 경계에서 갈린다. `test_r13_mock_policy_parity`가 경계 전건을 던져
 * 서버 `theta_to_knowledge_level`과 결과를 대조한다.
 */
export const __thetaToKnowledgeLevel = thetaToKnowledgeLevel;

/** 같은 이유로 4밴드 변환도 노출한다 — expert 가지가 빠져 있던 자리다. */
export const __thetaToLevelGroup = thetaToLevelGroup;

/** 라우트가 쓰는 바로 그 /progress/me 페이로드(사본 아님). */
export const __progressMePayload = progressMePayload;

/** `GET /progress/abilities`가 실제로 쓰는 함수 — 계약이 같은 것을 문다. */
export const __abilitiesPayload = abilitiesPayload;

/** 해설 출처 파생 — 계약이 **라우트가 쓰는 바로 그 규칙**을 부른다. */
export const __feedbackSourceOf = feedbackSourceOf;

export default function apiMockPlugin() {
  return {
    name: 'weathermind-api-mock',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/api/v1/')) return next();
        const path = req.url.slice('/api/v1'.length).split('?')[0];
        const handler = matchRoute(req.method, path);
        if (!handler) return next();

        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            /* ignore */
          }
          const [status, payload] = handler(body);
          // 실제 네트워크처럼 살짝 지연을 줘 로딩 상태도 디자인할 수 있게 한다
          setTimeout(() => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
          }, 250);
        });
      });
    },
  };
}
