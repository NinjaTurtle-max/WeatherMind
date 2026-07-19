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

  'GET /progress/me': () => [
    200,
    {
      xp: state.xp,
      level: state.level,
      streak_count: state.streak,
      next_level_xp: nextLevelXp(state.level),
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
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
    if (re.test(path)) return routes[key];
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
