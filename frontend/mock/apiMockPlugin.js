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

const todayISO = () => new Date().toISOString().slice(0, 10);

const weekStartISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 월요일 기준
  return d.toISOString().slice(0, 10);
};

// 세션 간 유지되는 간단한 인메모리 상태 (dev server 재시작 시 초기화)
const state = {
  xp: 1180,
  level: 4,
  streak: 6,
  streakFreeze: 1, // 구름 방패 보유 수 (§3.5, 최대 2)
  answeredToday: false,
  predicted: false,
};

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
// SessionItem = QuizQuestion + {source, slot_filled}. 배합 §3.2를 흉내 내되
// (new 2 / review 2 / live 1, 같은 question_type 3연속 금지) 데이터는 고정이다.
// _mock 필드는 목 전용 채점 정보로, 실제 응답 직전에 제거한다.
const SESSION_ITEMS = [
  {
    quiz_id: `${todayISO()}-s1-bank`,
    concept_tag: 'pressure_front',
    question_type: 'multiple_choice',
    question_text: '전선을 경계로 성질이 다른 두 공기가 만납니다. 찬 공기가 따뜻한 공기를 밀어 올리며 이동할 때 만들어지는 전선은?',
    options: ['한랭 전선', '온난 전선', '정체 전선', '폐색 전선'],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
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
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '북태평양 기단',
      accept: ['북태평양', '북태평양기단', '북태평양 기단'],
      feedbackCorrect:
        '맞아요! 북태평양 기단은 저위도 해양에서 만들어져 고온 다습합니다. 한여름 무더위와 열대야의 주범이에요.',
      feedbackWrong:
        '아쉬워요! 정답은 "북태평양 기단"이에요. 저위도 해양에서 발달해 고온 다습하고, 여름철 우리나라를 덮으면 무더위와 열대야가 이어집니다. 시베리아 기단(한랭 건조)과 성질을 비교해 기억해 보세요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s3-review`,
    concept_tag: 'typhoon',
    question_type: 'multiple_choice',
    question_text: '태풍이 우리나라 쪽으로 북상할 때, 일반적으로 바람 피해가 더 큰 "위험 반원"은 태풍 진행 방향의 어느 쪽일까요?',
    options: ['오른쪽(동쪽) 반원', '왼쪽(서쪽) 반원', '태풍의 눈 정중앙', '진행 방향과 무관하게 남쪽'],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '오른쪽(동쪽) 반원',
      feedbackCorrect:
        '정답이에요! 오른쪽 반원에서는 태풍 자체의 바람과 태풍을 이동시키는 바람(이동 속도)이 같은 방향으로 겹쳐 풍속이 더 강해집니다. 그래서 위험 반원이라고 불러요.',
      feedbackWrong:
        '아쉬워요! 정답은 "오른쪽(동쪽) 반원"이에요. 태풍의 회전 바람에 태풍의 이동 방향 바람이 더해지는 쪽이라 풍속이 훨씬 강해집니다. 왼쪽 반원은 두 바람이 반대로 작용해 상대적으로 약한 "가항 반원"이에요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s4-live`,
    concept_tag: 'anomaly',
    question_type: 'slider',
    question_text: '오늘 서울의 강수확률은 60%로 예보됐어요. 예보관이 말하는 "강수확률 60%"에 가장 가까운 값을 슬라이더로 맞춰보세요. (같은 조건이 100번 있을 때 비가 오는 횟수)',
    options: null,
    level_group: 'middle_high',
    source: 'generated',
    slot_filled: true,
    _mock: {
      correct: '60',
      tolerance: 10,
      feedbackCorrect:
        '잘했어요! 강수확률 60%는 "오늘과 같은 기상 조건이 100번 있으면 약 60번은 비가 온다"는 통계적 의미예요. 우산을 챙기는 게 합리적인 수준이죠.',
      feedbackWrong:
        '아쉬워요! 정답은 60이에요. 강수확률은 비의 양이 아니라, 같은 조건에서 비가 관측될 통계적 빈도를 뜻해요. 60%면 100번 중 60번꼴이니 우산을 챙기는 편이 좋아요.',
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
    _mock: {
      correct: '도시 상공의 오존층이 두꺼워져서',
      feedbackCorrect:
        '정확해요! 오존층은 성층권의 이야기로 열섬과는 무관해요. 열섬은 인공 피복의 축열, 인공열 배출, 증발 냉각 감소가 겹쳐 생기는 도시 기후 현상입니다.',
      feedbackWrong:
        '아쉬워요! 정답은 "오존층" 보기예요. 오존층은 성층권에 있어 도시 열섬과 관련이 없습니다. 열섬은 아스팔트의 축열, 인공열, 녹지 부족으로 인한 증발 냉각 감소가 원인이에요.',
    },
  },
  // ── R3-01 §3.6 신규 유형 4종 (세션 통합 검증용, 각 1건) ──
  {
    quiz_id: `${todayISO()}-s6-board`,
    concept_tag: 'pressure_front',
    question_type: 'board',
    question_text: '수도권에 소나기를 내려 보세요',
    template_json: {
      question_text: '수도권에 소나기를 내려 보세요',
      mode: 'guided',
      guide_steps: [
        '수도권(2번째 존)에 한랭전선을 놓아 보세요.',
        '습기 슬라이더를 60 이상으로 올려 상승기류를 강하게 만드세요.',
      ],
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['front:cold', 'moisture'],
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      hints: ['비가 오려면 공기 중에 무엇이 충분해야 할까요?', '차가운 공기가 파고들면 상승기류가 강해져요.'],
    },
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      feedbackCorrect: '정확해요! 한랭전선이 습한 공기를 파고들며 적란운이 발달해 수도권에 소나기가 내렸어요.',
      feedbackWrong: '아직이에요. 수도권에 한랭전선을 놓고 습기를 60 이상으로 올려 보세요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s7-match`,
    concept_tag: 'air_mass',
    question_type: 'match',
    question_text: '기단과 그 성질을 알맞게 연결하세요.',
    pairs: [
      { left: '시베리아 기단', right: '한랭 건조' },
      { left: '북태평양 기단', right: '고온 다습' },
      { left: '오호츠크해 기단', right: '한랭 다습' },
      { left: '양쯔강 기단', right: '온난 건조' },
    ],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      pairs: [
        { left: '시베리아 기단', right: '한랭 건조' },
        { left: '북태평양 기단', right: '고온 다습' },
        { left: '오호츠크해 기단', right: '한랭 다습' },
        { left: '양쯔강 기단', right: '온난 건조' },
      ],
      feedbackCorrect: '완벽해요! 각 기단은 발원지(대륙/해양·고위도/저위도)에 따라 성질이 결정됩니다.',
      feedbackWrong: '아쉬워요! 발원지가 대륙이면 건조, 해양이면 다습하고, 고위도면 한랭, 저위도면 고온입니다.',
    },
  },
  {
    quiz_id: `${todayISO()}-s8-ordering`,
    concept_tag: 'typhoon',
    question_type: 'ordering',
    question_text: '태풍의 일생을 이른 단계부터 순서대로 정렬하세요.',
    items: ['열대저압부 발생', '태풍으로 발달', '최성기(최대 세력)', '온대저기압으로 쇠약'],
    shuffled: true,
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      // items가 정답 순서로 저작됨 → 정답 순열은 항등 "0,1,2,3" (§3.6)
      correctOrder: '0,1,2,3',
      feedbackCorrect: '정확해요! 태풍은 열대저압부 → 발달 → 최성기 → 쇠약(온대저기압) 순으로 일생을 마칩니다.',
      feedbackWrong: '아쉬워요! 태풍은 열대저압부에서 시작해 세력을 키우다 최성기를 지나 온대저기압으로 약해집니다.',
    },
  },
  {
    quiz_id: `${todayISO()}-s9-cloze`,
    concept_tag: 'pressure_front',
    question_type: 'cloze',
    question_text: '공기가 상승하면 단열 팽창으로 온도가 낮아지고, 수증기가 ___하여 구름이 만들어진다.',
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '응결',
      accept: ['응결', '응축'],
      feedbackCorrect: '맞아요! 상승한 공기가 이슬점 아래로 식으면 수증기가 응결해 물방울(구름)이 됩니다.',
      feedbackWrong: '아쉬워요! 정답은 "응결"이에요. 수증기가 물방울로 바뀌는 과정을 응결이라고 합니다.',
    },
  },
];

// ── 보드 연습 퍼즐 (§3.5 /board/puzzles) ──
const BOARD_PUZZLES = [
  {
    content_item_id: 'b0000001-0000-4000-8000-000000000001',
    template_json: {
      question_text: '수도권에 소나기를 내려 보세요',
      mode: 'guided',
      guide_steps: [
        '수도권(2번째 존)에 한랭전선을 놓아 보세요.',
        '습기 슬라이더를 60 이상으로 올려 보세요.',
      ],
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['front:cold', 'moisture'],
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      hints: ['비가 오려면 공기 중에 무엇이 충분해야 할까요?', '차가운 공기가 파고들면 상승기류가 강해져요.'],
    },
  },
  {
    content_item_id: 'b0000002-0000-4000-8000-000000000002',
    template_json: {
      question_text: '동해안에 폭염을 만들어 보세요',
      mode: 'goal_only',
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['air_mass:north_pacific', 'sun'],
      goal_conditions: [{ zone: 3, phenomenon: 'heatwave' }],
      hints: ['여름철 무더위를 부르는 기단은 무엇일까요?', '강한 햇볕(일사 70 이상)이 더해져야 해요.'],
    },
  },
  {
    content_item_id: 'b0000003-0000-4000-8000-000000000003',
    template_json: {
      question_text: '서해안에 눈을 내려 보세요',
      mode: 'goal_only',
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['air_mass:siberian', 'moisture'],
      goal_conditions: [{ zone: 0, phenomenon: 'snow' }],
      hints: ['겨울철 찬 공기를 몰고 오는 기단은?', '서해를 건너며 습기를 얻어야 눈구름이 생겨요(습기 60 이상).'],
    },
  },
];

// 최초 클리어 기록 (content_item_id 집합) — 재도전 0 XP (§3.5)
const clearedBoardPuzzles = new Set();

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

// 목 세션 상태: 당일 1세션 멱등. answers는 quiz_id → 채점 결과.
let mockSession = null;

function ensureSession() {
  const today = todayISO();
  if (!mockSession || mockSession.session_date !== today) {
    mockSession = {
      session_id: '5e1c8b1e-0000-4000-8000-0000000000aa',
      session_date: today,
      mode: 'daily',
      answers: {},
      completed: false,
    };
  }
  return mockSession;
}

const sessionProgress = (s) => ({
  answered: Object.keys(s.answers).length,
  total: SESSION_ITEMS.length,
});

const stripMock = ({ _mock, ...item }) => item;

function gradeSessionItem(item, rawAnswer) {
  const answer = String(rawAnswer ?? '').trim();
  const { correct, accept, tolerance } = item._mock;
  const norm = (v) => v.replace(/\s+/g, '').toLowerCase();

  if (item.question_type === 'slider') {
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
  'POST /auth/register': () => [
    201,
    { user_id: '2b1c8b1e-0000-4000-8000-000000000001', access_token: 'mock-access' },
  ],
  'POST /auth/login': () => [
    200,
    { access_token: 'mock-access', refresh_token: 'mock-refresh' },
  ],
  'POST /auth/refresh': () => [200, { access_token: 'mock-access-2' }],
  'POST /auth/logout': () => [200, { success: true }],

  'GET /quiz/today': () => [200, QUIZ],
  'POST /quiz/:id/answer': (body) => {
    const isCorrect = body?.answer === QUIZ.options[0] || body?.answer === '0';
    const xp = isCorrect ? 15 : 2;
    state.xp += xp;
    state.answeredToday = true;
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
    const s = ensureSession();
    return [
      200,
      {
        session_id: s.session_id,
        session_date: s.session_date,
        mode: s.mode,
        items: SESSION_ITEMS.map(stripMock),
        progress: sessionProgress(s),
      },
    ];
  },
  'POST /session/:id/answer': (body, params) => {
    const s = ensureSession();
    if (params?.id !== s.session_id) {
      return [404, { detail: '세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    }
    if (s.completed) {
      // 완료된 세션 = 전 문항 응답 완료이므로 실서버와 동일하게 ALREADY_ANSWERED (§3.1 코드 표준)
      return [409, { detail: '이미 답안을 제출한 퀴즈입니다.', code: 'ALREADY_ANSWERED' }];
    }
    const item = SESSION_ITEMS.find((it) => it.quiz_id === body?.quiz_id);
    if (!item) {
      return [404, { detail: '세션에 없는 문항입니다', code: 'QUIZ_NOT_FOUND' }];
    }
    // 멱등 가드: 이미 응답한 문항 재제출 금지 (덮어쓰기·XP 중복 가산 원천 차단)
    if (s.answers[item.quiz_id]) {
      return [409, { detail: '이미 답한 문항이에요', code: 'ALREADY_ANSWERED' }];
    }

    // board 유형(§3.4): board_state 필수, 서버가 재판정(권위 채점)
    let isCorrect;
    let phenomena;
    if (item.question_type === 'board') {
      if (!body?.board_state) {
        return [422, { detail: '보드 상태(board_state)가 필요합니다', code: 'BOARD_STATE_REQUIRED' }];
      }
      const validationErrors = validateBoardState(body.board_state);
      if (validationErrors.length > 0) {
        return [422, { detail: `보드 상태가 올바르지 않습니다: ${validationErrors[0]}`, code: 'BOARD_STATE_INVALID' }];
      }
      const judged = judgeBoard(body.board_state, item._mock.goal_conditions);
      isCorrect = judged.passed;
      phenomena = judged.phenomena;
    } else {
      isCorrect = gradeSessionItem(item, body?.answer);
    }

    const xp = isCorrect ? 15 : 2;
    s.answers[item.quiz_id] = { is_correct: isCorrect, xp_earned: xp };
    state.xp += xp;
    state.answeredToday = true;
    return [
      200,
      {
        is_correct: isCorrect,
        correct_answer: item._mock.correct ?? null,
        feedback: isCorrect ? item._mock.feedbackCorrect : item._mock.feedbackWrong,
        xp_earned: xp,
        concept_tag: item.concept_tag,
        session_progress: sessionProgress(s),
        ...(phenomena ? { phenomena } : {}),
      },
    ];
  },
  'POST /session/:id/complete': (_body, params) => {
    const s = ensureSession();
    if (params?.id !== s.session_id) {
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
    s.completed = true;
    const results = Object.values(s.answers);
    return [
      200,
      {
        xp_total: results.reduce((sum, r) => sum + r.xp_earned, 0),
        correct_count: results.filter((r) => r.is_correct).length,
        total: progress.total,
        streak_count: state.streak,
      },
    ];
  },

  // ── 대기 보드 연습 API (R3-01 §3.5) ──
  'GET /board/rules': () => [200, BOARD_RULES],
  'GET /board/puzzles': () => [
    200,
    BOARD_PUZZLES.map((p) => ({
      content_item_id: p.content_item_id,
      template_json: p.template_json,
      cleared: clearedBoardPuzzles.has(p.content_item_id),
    })),
  ],
  'POST /board/puzzles/:id/attempt': (body, params) => {
    const puzzle = BOARD_PUZZLES.find((p) => p.content_item_id === params?.id);
    if (!puzzle) {
      return [404, { detail: '퍼즐을 찾을 수 없습니다', code: 'PUZZLE_NOT_FOUND' }];
    }
    if (!body?.board_state) {
      return [422, { detail: '보드 상태(board_state)가 필요합니다', code: 'BOARD_STATE_REQUIRED' }];
    }
    const validationErrors = validateBoardState(body.board_state);
    if (validationErrors.length > 0) {
      return [422, { detail: `보드 상태가 올바르지 않습니다: ${validationErrors[0]}`, code: 'BOARD_STATE_INVALID' }];
    }
    const { passed, phenomena, feedback } = judgeBoard(body.board_state, puzzle.template_json.goal_conditions);
    // 최초 클리어만 +5 XP (재도전 0) (§3.5)
    let xpEarned = 0;
    if (passed && !clearedBoardPuzzles.has(puzzle.content_item_id)) {
      clearedBoardPuzzles.add(puzzle.content_item_id);
      xpEarned = 5;
      state.xp += 5;
    }
    return [200, { passed, phenomena, feedback, xp_earned: xpEarned }];
  },

  'GET /progress/me': () => [
    200,
    {
      xp: state.xp,
      level: state.level,
      streak_count: state.streak,
      next_level_xp: nextLevelXp(state.level),
      streak_freeze_count: state.streakFreeze,
    },
  ],
  'GET /progress/weak-tags': () => [
    200,
    [
      { concept_tag: 'typhoon', wrong_count: 4, total_count: 6, accuracy_rate: 33.3, updated_at: null },
      { concept_tag: 'anomaly', wrong_count: 3, total_count: 7, accuracy_rate: 57.1, updated_at: null },
      { concept_tag: 'pressure_front', wrong_count: 2, total_count: 9, accuracy_rate: 77.8, updated_at: null },
    ],
  ],
  'POST /progress/attendance': () => [
    200,
    { streak_count: state.streak, is_new_record: false },
  ],

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
    Array.from({ length: 10 }, (_, i) => ({
      rank: i + 1,
      nickname: ['하늘지기', '비요미', '구름사냥꾼', '태풍의눈', '무지개탐정', '요미', '맑음이', '천둥벌거숭이', '이슬비', '바람돌이'][i],
      accuracy_score: Math.round((97 - i * 4.3) * 10) / 10,
      elo_rating: 1400 - i * 22,
    })),
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
          },
        ]
      : [],
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
