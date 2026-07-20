/**
 * 디자인/개발용 목 API 플러그인.
 * `VITE_MOCK=1 npm run dev`로 실행하면 backend 없이 /api/v1 전 엔드포인트가 동작한다.
 * 응답 스키마는 backend/app/schemas/*.py(02번 스펙)와 1:1로 맞춘다.
 */

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
];

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
  if (item.question_type === 'slider') {
    return Math.abs(Number(answer) - Number(correct)) <= (tolerance ?? 0);
  }
  if (item.question_type === 'short_answer') {
    const norm = (v) => v.replace(/\s+/g, '').toLowerCase();
    return [correct, ...(accept ?? [])].some((a) => norm(a) === norm(answer));
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
    const isCorrect = gradeSessionItem(item, body?.answer);
    const xp = isCorrect ? 15 : 2;
    s.answers[item.quiz_id] = { is_correct: isCorrect, xp_earned: xp };
    state.xp += xp;
    state.answeredToday = true;
    return [
      200,
      {
        is_correct: isCorrect,
        correct_answer: item._mock.correct,
        feedback: isCorrect ? item._mock.feedbackCorrect : item._mock.feedbackWrong,
        xp_earned: xp,
        concept_tag: item.concept_tag,
        session_progress: sessionProgress(s),
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
