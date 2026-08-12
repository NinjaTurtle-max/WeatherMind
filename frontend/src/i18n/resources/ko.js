/**
 * ko 리소스 (R11-01 §3 D — i18n 골격 · §6.3 페이즈 B 전면 외부화)
 *
 * 규약:
 *  - 중첩 객체 + 점 경로 키(`streak.title`). 값은 문자열만.
 *  - 보간은 `{name}` 자리표시자 — i18n/index.js의 translate()가 치환한다.
 *  - ko가 기준 로케일: 새 키는 여기 먼저 추가하고 en에 짝을 만든다.
 *    (ko↔en 키 집합 일치는 tests/i18n.smoke.test.mjs가 상주 가드)
 *  - ⚠️ ko 값은 외부화 전 원문과 **바이트 동일**이 계약이다(§6.3) — 기존
 *    스모크(gating·session·placement·course-select·guest-convert·review-queue)가
 *    이 한국어 문구를 그대로 단정한다. 문구 개선은 별도 항목으로.
 *  - 굵기 등 마크업이 문장 중간에 끼는 문구는 segN/strongN 조각 키로 나눈다
 *    (조각을 이어 붙이면 원문과 바이트 동일).
 */
export default {
  streak: {
    // StreakBadge (파일럿): title 툴팁 전체 문구 + 최협폭에서 접히는 단위 표기
    title: '연속 출석 {count}일',
    days: '일',
  },
  locale: {
    label: '언어 선택',
    ko: '한국어',
    en: 'English',
  },
  common: {
    loading: '불러오는 중...',
    retry: '다시 시도',
    retryLater: '잠시 후 다시 시도해주세요.',
  },
  nav: {
    home: '홈',
    primary: '주 메뉴',
    homeTitle: '학습 홈으로',
    logout: '로그아웃',
    learn: '학습',
    board: '보드',
    // 내비 라벨은 **화면 제목과 다르다**(2026-08-11 사용자 지시). 제목은
    // `duel.title`(「예보 대결」)이고 여기는 사이드바·탭바에 들어가는 짧은 이름이라
    // 두 글자로 줄였다 — 리그와 한 화면으로 합치면서 이 항목이 두 탭을 함께
    // 담당하게 됐고(navItems.alsoMatch), 「예보 대결」이라 적으면 리그를 보고
    // 있을 때 내비가 틀린 이름을 켜 놓은 꼴이 된다.
    duel: '예보',
    league: '리그',
    explore: '탐구',
    me: '내 정보',
    tutor: {
      // 화면 담당 마스코트(Mascot 배정표) — 보드는 태양이
      board: { name: '태양이', line: '어떤 날씨를 만들어 볼까요?' },
      learn: { name: '물방울이', line: '오늘은 어디까지 가볼까요?' },
      duel: { name: '태풍이', line: '자료를 보고 내일 날씨를 맞혀 봐요!' },
      explore: { name: '구름이', line: '오늘은 무엇을 살펴볼까요?' },
      league: { name: '번개', line: '이번 주 순위를 올려볼까요?' },
    },
  },
  // 개념 태그 → 표시명 (클라이언트 저작 라벨 — 서버는 태그 코드만 보낸다.
  // 미지 태그는 conceptLabel() 헬퍼가 태그 원문으로 폴백)
  concept: {
    pressure_front: '기압과 전선',
    typhoon: '태풍',
    air_mass: '기단',
    heat_island: '열섬 현상',
    co2_climate: 'CO₂와 기후',
    temperature_heat: '온도와 열',
    radiation_budget: '복사와 에너지 수지',
    pressure_basics: '압력의 기초',
    phase_change: '물의 상태변화',
    density_buoyancy: '밀도와 부력',
    energy_transfer: '에너지의 이동',
    wildfire_weather: '산불 기상',
    flood_response: '홍수 대응',
    anomaly: '이상 기후',
  },
  energy: {
    full: '구름 에너지가 가득 찼어요 — 구름은 틀린 문항에만 1개 줄어들어요',
    empty: '구름이 모두 흩어졌어요 — 약 {min}분 후 회복돼요. 새 세션은 구름이 1개 이상 있어야 열려요(풀던 세션은 끝까지 마칠 수 있어요)',
    regen: '구름 에너지 — 틀린 문항에만 1개 소모 · 다음 회복까지 {countdown}',
  },
  feedback: {
    // 배지는 해설의 **출처**다(AnswerResult.feedback_source) — CO-I-1 후속.
    // 사람이 저작한 193건(2026-08-09 실측)을 "AI 피드백"으로 찍으면 배점 ⑤ 표기가 틀어진다.
    ai: 'AI 피드백',
    authored: '개념 해설',
    board: '판정 근거',
  },
  forecast: {
    numeric: '모든 값을 숫자로 입력해주세요.',
    rainRange: '강수확률은 0~100 사이여야 해요.',
    submitting: '제출 중...',
  },
  guestBanner: {
    aria: '게스트 진도 저장 — 30초 가입으로 계정 전환',
    title: '진도가 쌓였어요 — 30초 가입으로 저장',
    body: '게스트 진도는 이 기기에만 있어요. 계정을 만들면 XP·스트릭이 그대로 옮겨져요.',
    cta: '저장하기',
  },
  reviewQueue: {
    title: '복습할 때가 됐어요',
    count: '{count}개',
    body: '배운 지 시간이 지난 개념이에요 — 잊기 전에 한 번 더 보면 오래 남아요.',
    cta: '복습하러 가기 →',
  },
  // 학습 지역(R12 선행 §8 — RegionPicker·geoSnap). 신규 문자열이라 원문 규약 없음.
  region: {
    chipAria: '학습 지역 선택 — 현재 {region}',
    title: '어느 지역 날씨로 배울까요?',
    body: '오늘의 세션 실황 문항과 학습 피드백의 날씨가 이 지역 기준이에요. 예보 대결과 리그는 서울 기준 그대로예요.',
    gps: '내 위치로 설정',
    gpsPending: '위치 확인 중...',
    gpsHint: '위치는 가장 가까운 도시를 고르는 데만 쓰고, 어디에도 저장하거나 보내지 않아요.',
    gpsFailed: '위치를 확인할 수 없었어요 — 아래에서 도시를 직접 골라주세요.',
    saveFailed: '지역을 저장하지 못했어요. {detail}',
    close: '닫기',
    settingTitle: '학습 지역',
    settingBody: '실황 문항·학습 피드백의 날씨에 쓰는 지역이에요.',
    // 도시 표시명 — 값(서버 전송 원문)은 lib/geoSnap.js REGIONS가 소유
    city: {
      seoul: '서울',
      busan: '부산',
      daegu: '대구',
      incheon: '인천',
      gwangju: '광주',
      daejeon: '대전',
      ulsan: '울산',
      gangneung: '강릉',
      jeju: '제주',
      suwon: '수원',
      cheongju: '청주',
      jeonju: '전주',
    },
  },
  // 예보 대결 · 리그 공통 껍데기(modules/compete/CompeteLayout.jsx) — 2026-08-11에
  // 두 화면을 탭 하나로 합쳤다. 탭 이름은 각 화면의 제목(duel.title·league.title)과
  // **다른 키**다: 제목은 이모지·수식이 붙지만 탭은 짧아야 한다.
  compete: {
    tabsAria: '대결 화면 선택',
    tabDuel: '예보 대결',
    tabLeague: '리그',
  },
  spine: {
    title: '유닛 {cleared}/{total} 클리어 · 왕관 {crowns}/{crownsTotal}',
    crown: '왕관',
  },
  tier: {
    title: '리그 티어: {label}',
    // 티어 코드 → 표시명 (lib/tierMeta.js TIER_META.label의 리소스 파생 원본 —
    // ko 값은 계약 §3.2 표와 바이트 동일)
    name: {
      stratus: '층운',
      cumulus: '적운',
      nimbostratus: '난층운',
      cumulonimbus: '적란운',
      typhoon_eye: '태풍의 눈',
    },
  },
  // lib/abilityDisplay.js CONCEPT_KO·LEVEL_KO의 리소스 파생 원본.
  // ⚠️ ability.concept.*는 위 concept.*(D2 저작)와 표기가 다르다 — CONCEPT_KO의
  // ko 값을 기존 스모크가 단정하므로 원문 바이트 동일을 우선했다(§6.3 계약).
  ability: {
    concept: {
      air_mass: '기단',
      anomaly: '이상기후',
      co2_climate: 'CO₂·기후변화',
      heat_island: '열섬효과',
      pressure_front: '기압·전선',
      temperature_heat: '온도와 열',
      radiation_budget: '복사와 에너지 수지',
      pressure_basics: '압력의 기초',
      phase_change: '물의 상태변화',
      density_buoyancy: '밀도와 부력',
      energy_transfer: '에너지의 이동',
      wildfire_weather: '산불 기상',
      flood_response: '홍수 대응',
      typhoon: '태풍',
    },
    level: {
      beginner: '초급',
      intermediate: '중급',
      advanced: '고급',
      // CO-S-4: 서버 THETA_BAND_LABELS는 4밴드(θ>1.5=expert)인데 여기가 3개라
      // 화면에 `ability.level.expert` 키 문자열이 그대로 떴다.
      expert: '최상급',
    },
    // 지식 단계(knowledge_level) — 위 level(4밴드=표현 톤)과 **다른 축**(난이도)이다.
    // 두 축은 대체가 아니라 병기다. 라벨 원본은 database/seed/level_vocabulary.json의
    // `anchor`이고, 마크다운 강조(**)와 성취기준 코드([12지시03])를 걷어내
    // 「표시명 = 제도적 단계 / 부제 = 영역·과목」으로 다듬었다(뜻은 그대로).
    knowledgeLevel: {
      cardTitle: '현재 지식 단계',
      lv: 'Lv.{level}',
      ofMax: '{max}단계 중 {level}단계',
      next: '다음 단계: {name}',
      top: '가장 높은 단계예요',
      aria: '현재 지식 단계 — {max}단계 중 {level}단계, {name}',
      name: {
        1: '초등 3~4학년',
        2: '초등 5~6학년',
        3: '중학교 물질·에너지',
        4: '중학교 유체 지구',
        5: '고등학교 공통',
        6: '고등학교 일반선택',
        7: '고등학교 진로선택',
        8: '학부 대기과학',
        9: '학부 고학년',
        10: '기상청 현업',
      },
      sub: {
        1: '현상에 이름 붙이기',
        2: '기상 요소 측정과 규칙성',
        3: '열 · 비열 · 압력으로 설명하기',
        4: '대기와 해양을 하나의 계로 보기',
        5: '통합과학1 · 통합과학2',
        6: '지구과학 · 기후변화와 환경생태',
        7: '지구시스템과학 · 고급 지구과학',
        8: '역학 기초 · WMO 십운형',
        9: '종관 분석 · 수치예보',
        10: '특보 기준 · 현업 진단 지수',
      },
    },
  },
  // lib/onboardingGate.js DAILY_GOAL_CHOICES 라벨 + DailyGoal.jsx(피커·미터)
  dailyGoal: {
    choiceLabel: {
      3: '가볍게',
      5: '보통',
      9: '열심히',
    },
    choiceCaption: '하루 {items}문항',
    itemsUnit: '{items}문항',
    pickerTitle: '🎯 하루 목표를 정해요',
    pickerBody: '작게 시작해도 매일이 더 중요해요. 언제든 바꿀 수 있어요.',
    saved: '좋아요 — 오늘부터 하루 {items}문항이 목표예요.',
    // 내 정보 조회 실패 — 현재 목표를 모르니 선택지를 내주지 않고, 대신 자리를
    // 비우지 않는다(목표를 정하러 앵커를 타고 온 사람이 빈 화면 끝을 본다).
    loadFailed: '지금 설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
    saveFailed: '목표를 저장하지 못했어요. {detail} 다시 눌러주세요.',
    meterTitle: '🎯 오늘 목표 {done}/{goal}',
    reached: '달성!',
    remaining: '{count}문항 남음',
  },
  // api/client.js 에러 정규화 폴백 2건
  apiError: {
    generic: '요청 처리 중 오류가 발생했습니다.',
    network: '서버에 연결할 수 없습니다. 네트워크를 확인해주세요.',
  },
  // 온보딩 배치고사(modules/onboarding/**)
  placement: {
    skip: '건너뛰기 →',
    title: '실력 진단 — 내 수준 찾기',
    hint: '🧭 딱 6문항이면 충분해요 — 틀려도 괜찮아요, 진단일 뿐!',
    finalizingTitle: '내 난이도를 찾는 중…',
    finalizingBody: 'WeatherBrain이 방금 푼 문항을 분석해 딱 맞는 수준을 계산하고 있어요.',
    doneTitle: '진단 완료!',
    scored: '{total}문항 중 {correct}문항을 맞혔어요. ',
    doneBody: '이제 WeatherBrain이 내 수준에 맞는 문제를 준비해요.',
    barsNote: '막대가 짧을수록 앞으로 더 자주 만나게 될 개념이에요. 진단 결과는 프로필의 WeatherBrain 능력 분석에서 계속 갱신돼요.',
    emptyAbilities: '진단 결과가 아직 준비되지 않았어요. 학습을 진행하면 능력 분석이 채워져요.',
    start: '학습 시작하기 →',
  },
  // 내 정보 탭(modules/progress/ProgressPage.jsx — 헤더·진단 배너·스파인 카드)
  profile: {
    // MT-28: ProgressPage 스트릭 칩 — 마지막 하드코딩 한국어였다
    streak: {
      dayCount: '{n}일',
    },
    // 2026-08-06 시안 개편 — 2열 대시보드
    title: '내 정보',
    subtitle: '지금까지의 활동을 확인하고 더 높은 목표를 향해 나아가세요!',
    badgeStat: '획득 배지',
    unitStat: '클리어 유닛',
    crownStat: '획득 왕관',
    nextGoals: '다음 목표',
    goalLevel: '레벨 {level} 달성',
    goalStreak: '연속 출석 {days}일 달성',
    defaultNickname: '기상 학습자',
    levelXp: 'Lv.{level} · 누적 {xp} XP',
    leagueTier: '리그 티어',
    streakStat: '연속 출석',
    levelStat: '현재 레벨',
    placementBannerTitle: '아직 실력 진단 전이에요',
    placementBannerBody: '6문항 진단을 받으면 WeatherBrain이 내 수준에 맞는 문제를 골라줘요.',
    placementBannerCta: '진단 받고 내 수준 찾기 →',
    // 학습 수준 설정 (R13 P-5) — 게스트가 평생 middle_high에 갇히지 않게 하는 통로
    levelGroupTitle: '🎚️ 학습 수준',
    levelGroupBody: '문항 난이도와 보드에서 열리는 난이도가 이 설정을 따라가요. 세션은 다음 발급부터 반영돼요.',
    levelGroupSaved: '학습 수준을 바꿨어요.',
    levelGroupFailed: '학습 수준을 바꾸지 못했어요.',
    levelGroupSaving: '바꾸는 중...',
  },
  // 게스트 로그아웃 확인 (R13 P-4) — 게스트는 재진입 경로가 없어 진도가 영구 소실된다
  logoutGuest: {
    title: '지금 나가면 진도가 사라져요',
    body: '게스트로 학습 중이라 다시 들어올 방법이 없어요. 지금까지 쌓은 XP·스트릭·실력 진단이 모두 사라집니다.',
    stay: '계속 학습하기',
    save: '30초 가입으로 저장하기',
    quit: '그래도 로그아웃',
  },
  // 배지 컬렉션(modules/progress/BadgeCollection.jsx)
  badges: {
    loading: '배지를 불러오는 중...',
    loadFailed: '배지를 불러오지 못했어요. {detail}',
    title: '🏅 배지 컬렉션',
    earnedCount: '{earned}/{total} 획득',
    empty: '아직 등록된 배지가 없어요.',
    locked: '미획득',
    moreAfterFirstSession: '첫 세션을 마치면 배지 {count}개가 더 열려요.',
  },
  // 일일 퀘스트(modules/progress/QuestList.jsx)
  quests: {
    loading: '오늘의 퀘스트를 불러오는 중...',
    loadFailed: '퀘스트를 불러오지 못했어요. {detail}',
    title: '🎯 일일 퀘스트',
    doneCount: '{done}/{total} 완료',
    empty: '오늘의 퀘스트가 없어요.',
    moreAfterFirstSession: '첫 세션을 마치면 퀘스트 {count}개가 더 열려요.',
  },
  // 방금 받은 보상 칩(modules/progress/RewardChips.jsx — R13 CO-T-4).
  // {title}은 **서버 원문**이 그대로 들어온다(QuestList·BadgeCollection과 동일) —
  // 여기서 이름 사본을 만들면 같은 퀘스트가 화면마다 다른 이름으로 불린다.
  rewards: {
    questDone: '퀘스트 완료 · {title}',
    badgeEarned: '배지 획득 · {title}',
  },
  // WeatherBrain 능력 분석(modules/progress/WeatherBrainPanel.jsx)
  weatherBrain: {
    title: '🧠 WeatherBrain 능력 분석',
    loading: '능력 분석을 불러오는 중...',
    loadFailed: '능력 분석을 불러오지 못했어요. {detail}',
    // 두 열의 머리 문구는 짝을 이룬다 — 왼쪽 ability(지금 실력) ↔ 오른쪽
    // mastery(익혔을 확률). 한쪽만 고치면 카드가 짝짝이가 된다.
    ability: { title: '지금 실력' },
    introSeg1: 'WeatherMind 자체 적응형 모델 ',
    introStrong: 'WeatherBrain',
    introSeg2: '이 개념별 이해도를 추정해 문제 난이도를 맞춰줘요. 막대가 짧을수록 더 연습이 필요한 개념이에요.',
    priorNote: '아직 응답 없음 · 초기 배정',
    rowTitle: 'θ {theta} · {basis}',
    basisPrior: '초기 배정',
    basisMeasured: '응답 {count}회 기반',
    empty: '아직 능력 데이터가 없어요. 세션을 풀면 개념별 이해도가 분석돼요.',
    // BKT 숙련도(R13-01 §5-1) — θ와 다른 축임을 화면에서 읽히게 하는 문구.
    mastery: {
      title: '개념 숙련도',
      // ⚠️ 「위/아래」로 쓰지 말 것 — 2026-08-10에 두 축이 좌우로 갈렸는데 이
      // 문구만 세로 시절 그대로였다. 좁은 화면에서는 다시 위아래로 쌓이므로
      // **방향을 말하지 않고 이름으로 가리킨다**(어느 배치에서도 맞는다).
      subtitle: '「지금 실력」이 오늘 풀 수 있는 정도라면, 이쪽은 「이 개념을 익혔을 확률」이에요.',
      empty: '문제를 풀면 개념을 익혔는지 추적하기 시작해요.',
      insufficient: '데이터 부족',
      beginning: '아직 익히는 중',
      learning: '거의 익힘',
      mastered: '숙련',
      rowTitle: '익혔을 확률 {percent}% · 다음 문제 정답 확률 {next}% · 응답 {count}회',
      nextHint: '다음 문제 정답 확률 {next}%',
    },
  },
  // ── 홈 대시보드 (시안 Soft Cloud 홈) ─────────────────────────────────────
  // 실제 API에 있는 값만 쓴다 — 「최근 활동」은 조회 엔드포인트가 없어 뺐다.
  home: {
    greet: '안녕하세요, 기상 탐험가님',
    greetSub: '오늘도 하늘을 읽어볼까요?',
    dayUnit: '일',
    quickStart: '바로 시작하기',
    tutor: { name: '구름이', line: '무엇부터 해볼까요?' },
    entry: {
      learn: '학습 세션',
      learnEmpty: '첫 유닛부터 시작해요',
      learnGo: '이어서 풀기 →',
      go: '바로 가기 →',
      // R13-01 §2.5 진입 통합 — 홈의 학습 진입 카드 1개가 쓰는 문구
      todayLabel: '오늘의 학습',
      doneTitle: '오늘 몫은 다 했어요',
      doneCta: '지난 유닛 다시 보기 →',
      more: '더 해보기',
      board: '대기 보드',
      boardDesc: '기단·전선을 놓아 날씨를 만들어요',
      duel: '예보 대결',
      duelDesc: '오늘 기온·강수확률 맞히기',
      league: '리그',
      leagueDesc: '{tier} 티어에서 겨루는 중',
    },
    goal: {
      title: '오늘의 목표',
      cap: '푼 문항 수로 셉니다 — 배치고사는 빼고요.',
      items: '문항',
      remaining: '{n}문항만 더 풀면 오늘 목표 달성이에요.',
      done: '오늘 목표를 달성했어요! 🎉',
      unset: '아직 목표를 정하지 않았어요.',
    },
    streak: {
      title: '연속 출석',
      cap: '구름 방패 {n}개 보유 — 하루 빠져도 스트릭이 지켜져요.',
      days: '월,화,수,목,금,토,일',
    },
    review: {
      title: '다시 볼 개념',
      cap: '복습 주기가 돌아온 개념이에요.',
      empty: '지금 복습할 개념이 없어요. 잘하고 있어요!',
      meta: '연속 정답 {n}회 · {d}일 주기',
      cta: '복습',
    },
    brain: {
      title: 'WeatherBrain 분석',
      cap: '개념별 실력(θ) — 문제를 풀수록 정밀해져요.',
      aria: '개념별 실력 레이더 차트: {list}',
      empty: '아직 분석할 기록이 부족해요 — 문항을 조금 더 풀면 개념별 실력이 그려져요.',
    },
    // CO-S-2: 전 API 실패에도 홈이 "복습할 개념이 없어요"라고 말하던 자리
    error: {
      title: '지금 정보를 불러오지 못했어요',
      body: '연결을 확인한 뒤 다시 시도해 주세요.',
    },
  },
  curriculum: {
    // 하루 목표 미설정 — 진입 카드에서 내 정보(설정 통로)로 보낸다
    goalUnset: '목표를 설정하세요!',
    loading: '학습 경로를 불러오고 있어요...',
    loadFailed: '학습 경로를 불러오지 못했어요',
    title: '🎓 학습',
    // 배너 한 줄 부제. 2026-08-09 잠깐 값 안에 개행이 있었다(튜터 말풍선 두 줄
    // 고정) — 배너로 바뀌며 한 줄이 되어 원문 바이트 동일로 되돌렸다.
    subtitle: '유닛을 순서대로 클리어하며 날씨 개념을 쌓아요.',
    sectionDone: '{cleared}/{total} 완료',
    energyEmpty: {
      title: '☁️ 구름이 모두 흩어졌어요',
      seg1: '구름은 ',
      strong1: '틀린 문항에만 1개',
      seg2: ' 줄어들어요 — 열심히 푼 만큼이 아니라 실수에만 소모돼요. 약 ',
      strong2: '{min}분',
      seg3: ' 후 구름 1개가 회복되면 새 세션을 열 수 있어요.',
      seg4: ' 오늘 시작한 세션은 지금도 끝까지 마칠 수 있어요.',
    },
    emptyCourse: {
      title: '개념 트리 설계 완료 — 유닛 준비 중',
      body: '이 코스의 유닛이 열리면 여기에 학습 경로가 나타나요.',
      section: '섹션 {n} — {title}',
    },
    preview: {
      heatLight: { title: '열과 빛', subtitle: '온도·복사' },
      airWeight: { title: '공기의 무게', subtitle: '압력·밀도' },
      waterEnergy: { title: '물과 에너지', subtitle: '상태변화·이동' },
    },
    unit: {
      lockedSuffix: ' (잠김)',
      energySuffix: ' (구름 부족)',
      lockedTitle: '선행 유닛을 완료하면 열려요',
      energyTitle: '구름이 회복되면 열 수 있어요 — 약 {min}분 후',
      boardChip: '보드 퍼즐 유닛',
      placementOpened: '🧭 진단으로 열림',
    },
    // 학습 화면 하단 3카드의 리그 칸(2026-08-09 시안). 티어 표시명은 tier.name.*이
    // 소유하고 여기는 틀만 갖는다 — 두 벌로 두면 리그 화면과 이름이 갈린다.
    leagueCard: {
      titleUnranked: '리그',
      title: '{tier} 리그',
      people: '/ {total}명',
      cta: '순위표 보기 →',
    },
    daily: {
      title: '자유 일일 세션',
      body: '정해진 경로 대신 오늘의 세션을 바로 풀고 싶다면.',
      cta: '오늘의 세션 풀기 →',
      resume: '풀던 세션 이어서 풀기 →',
      regen: '☁️ 구름 회복까지 약 {min}분',
      regenResume: '☁️ 구름 회복까지 약 {min}분 — 오늘 시작한 세션은 끝까지 마칠 수 있어요.',
    },
    // 세로 경로(PcCurriculumPath) — 노드 밑 라벨을 뺀 대신 진도 바가 "지금 어디"를 말한다.
    path: {
      sectionEyebrow: '섹션 {n} · {title}',
      introTitle: '이 단계에서 배우는 것',
      start: '시작',
      estMinutes: '예상 {min}분',
      fold: '접기',
      unfold: '펼치기',
      scrollHint: '↓ 스크롤해서 다음 단계',
      progressLabel: '현재 진도',
      unitCount: '{done} / {total} 유닛',
    },
    tutor: {
      chip: '💧 튜터',
      name: '물방울이',
      greet: '"{title}" 유닛이네요 — 차근차근 같이 풀어봐요!',
      greetDefault: '오늘도 하늘 읽으러 가볼까요?',
    },
    switcher: {
      aria: '코스 선택',
      prereqTitle: '선행 학습(권장): {title} — 권장일 뿐 잠기지 않아요',
      prereqChip: '선행 학습(권장)',
    },
  },
  unitSession: {
    back: '← 학습 경로로',
    title: '유닛 학습',
    chip: '📚 커리큘럼 유닛',
    cleared: '유닛 클리어!',
    crowned: '왕관 획득!',
    done: '유닛을 마쳤어요',
    allCleared: '모든 문항을 맞혔어요. 다음 유닛이 열렸어요!',
    allMore: '모든 문항을 맞혔어요. 왕관 {target}개를 모으면 유닛이 클리어돼요.',
    hasWrong: '틀린 문항이 있어요. 다시 도전하면 왕관을 받을 수 있어요.',
    crowns: '왕관',
    bonus: '✨ 유닛 최초 클리어 보너스 +{xp} XP',
    next: '다음 유닛으로 →',
    backToPath: '학습 경로로 돌아가기',
  },
  session: {
    answerHere: '답을 고르면 여기에 정답과 해설이 나와요.',
    loading: '세션을 준비하고 있어요...',
    title: '오늘의 기상 세션',
    loadFailed: '세션을 불러오지 못했어요',
    // CO-S-3: 0문항 세션은 자동완료 가드(total>0)에 걸려 탈출구가 없었다
    empty: {
      title: '지금 낼 수 있는 문항이 없어요',
      body: '오늘 몫을 이미 마쳤거나, 아직 이 단계에 맞는 문항이 준비되지 않았어요.',
      cta: '학습 경로로 돌아가기 →',
    },
    // CO-M4: 실제 429는 answer가 아니라 세션 로드 경로에서 난다
    outOfClouds: {
      title: '☁️ 구름이 모두 흩어졌어요',
      body: '구름은 틀린 문항에만 1개 줄어들어요. 약 {min}분 후 1개가 회복되면 새 세션을 열 수 있어요.',
      cta: '학습 경로로 돌아가기 →',
    },
    // CO-S-1: 403 UNIT_LOCKED도 무한 스피너로 수렴했다 — 잠금은 잠금으로 보여야 한다
    unitLocked: {
      title: '🔒 아직 열리지 않은 유닛이에요',
      body: '선행 유닛을 먼저 완료하면 이 유닛이 열려요.',
      cta: '학습 경로로 돌아가기 →',
    },
    progressTitle: '오늘의 세션',
    progressCount: '{answered} / {total} 문항 완료',
    itemCount: '문항 {current} / {total}',
    slotFilled: '☀️ 오늘 실황 반영 문항',
    combo: '연속 정답 {combo}',
    // 칭찬 4단 (R10-01 §3.5) — SessionRunner.COMBO_PRAISE 계약과 바이트 동일
    // (boardAssistRetention 스모크가 ko 원문 4개를 그대로 단정한다)
    praise: {
      1: '정답이에요',
      2: '좋아요',
      3: '훌륭해요',
      4: '완벽해요',
    },
    grading: 'AI가 채점하고 있어요...',
    submitFailed: '답안 제출에 실패했어요. 잠시 후 다시 시도해주세요.',
    completeFailed: '세션 완료 처리에 실패했어요. 잠시 후 다시 시도해주세요.',
    crownToast: '👑 왕관 획득 — {title}',
    clouds: {
      title: '구름이 모두 흩어졌어요',
      seg1: '구름은 ',
      strong1: '틀린 문항에만 1개',
      seg2: ' 줄어들어요 — 열심히 푼 만큼이 아니라 실수에만 소모돼요. ',
      strong2: '지금 풀던 세션은 끝까지 마칠 수 있고',
      seg3: ', 구름이 1개라도 회복되면 새 세션도 다시 열려요.',
    },
    finishing: '세션을 마무리하고 있어요...',
    retryAfterRegen: '구름 회복 후 다시 시도',
    finish: '세션 마치기 →',
    next: '다음 문항 →',
    bulkFailTitle: '결과 계산에 실패했어요',
    bulkFailBody: '잠시 후 다시 시도해주세요. 푼 답안은 그대로 남아 있어요.',
    bulkFinalizing: '결과를 계산하고 있어요...',
    leave: {
      title: '지금 나가면 오늘 진도가 사라져요',
      remaining: '{remaining}문항만 더 풀면 오늘 진도와 스트릭이 기록돼요. ',
      almost: '조금만 더 하면 끝나요. ',
      tail: '여기서 멈추면 지금까지 푼 만큼만 남아요.',
      stay: '계속 풀기',
      quit: '그만두기',
    },
    // 만회 라운드 (R13-01 §2.1 · 상한 5 §2.11) — 세션 마지막 문항 뒤 오답 재투입.
    // 만회는 벌도 파밍도 아니다: 구름 무소모·XP 무가산이라 화면도 그렇게 읽혀야 한다.
    retry: {
      banner: '☂️ 만회 라운드 — 아까 놓친 {total}문항',
      note: '만회는 벌이 아니에요 — 구름도 XP도 움직이지 않아요.',
      itemCount: '만회 {current} / {total}',
      start: '놓친 {count}문항 만회하기 →',
      next: '다음 만회 문항 →',
      success: '☀️ 만회 성공! 이 문항은 해결했어요',
      fail: '🌧️ 이번엔 못 맞혔어요 — 내일 복습 문항으로 다시 만나요',
      alreadyResolved: '이미 해결한 문항이에요 — 다음으로 넘어갈게요.',
      capNote: '만회는 마지막 {limit}문항까지만 이어져요.',
    },
    summary: {
      title: '오늘의 세션 완료!',
      allCorrect: '전부 정답이에요. 완벽한 하루!',
      someWrong: '틀린 개념은 내일 세션의 복습 문항으로 다시 만나요.',
      correct: '정답 수',
      xp: '획득 XP',
      streak: '스트릭',
      tomorrow: '내일 또 새로운 {total}문항 세션이 준비돼요.',
      tomorrowNoCount: '내일 또 새로운 세션이 준비돼요.',
      boardCta: '대기 보드 풀어보기 →',
      // 만회 결산 (§2.1) — 서버 retry_resolved_count·all_resolved 실측만 쓴다
      retryResolved: '☂️ 만회 완료 {count}문항',
      allResolved: '만회까지 마쳐서 오늘 문항을 전부 해결했어요!',
      // 블록 구분 표기 (§2.10) — SessionItem.kind 4종
      blocksTitle: '오늘 푼 문항',
      blocks: {
        new: '오늘의 발견',
        review: '복습',
        live: '실황',
        unit: '진도',
      },
      blockCount: '{count}문항',
      unitBlockNote: '진도 문항은 지금 배우는 유닛의 다음 5문항이에요.',
    },
    // 예보 마감 단계 (R13 A-1) — 15문항 뒤에 붙는 **단계**(문항 아님).
    closing: {
      title: '마지막 단계 — 내일 예보 내기',
      subtitle: '{date}의 최고기온과 강수확률을 예보해 주세요.',
      noJudge: '예보는 지금 채점하지 않아요 — 정답은 내일의 관측이 정해요.',
      base: '기준 예보 {temp}℃ · 강수확률 {prob}%',
      tempLabel: '최고기온(℃)',
      rainLabel: '강수확률(%)',
      submit: '예보 제출하기',
      briefingCta: '판단 재료 자세히 보기 →',
      submittedTitle: '예보를 냈어요',
      settleNote: '{date}의 실제 날씨가 관측된 뒤 {settleDate}에 결과가 정산돼요.',
      alreadySubmitted: '오늘은 이미 예보를 냈어요.',
      failed: '예보 제출에 실패했어요. 잠시 후 다시 시도해주세요.',
      lastResultTitle: '지난 예보 결과',
      lastResult: '{date} 예보 — {result}',
      skip: '오늘은 건너뛰기',
    },
  },
  quiz: {
    clozePlaceholder: '빈칸에 들어갈 말을 입력하세요',
    answerPlaceholder: '답을 입력하세요',
    submit: '제출',
    sliderSubmit: '이 값으로 제출',
    match: {
      help: '왼쪽 항목을 누른 뒤 짝이 되는 오른쪽 항목을 누르세요. 연결된 왼쪽 항목을 다시 누르면 해제돼요 — 목록의 자리는 바뀌지 않아요.',
      assigned: '→ {right} · 다시 눌러 해제',
      reverse: '↔ {left}',
    },
    ordering: {
      help: '위/아래 버튼으로 올바른 순서로 정렬한 뒤 제출하세요.',
      up: '위로',
      down: '아래로',
    },
    result: {
      correct: '정답이에요! 🎉',
      wrong: '아쉬워요 😢',
      answerPrefix: '정답: ',
      clouds: '☁️ 구름 −{count} · 구름은 틀린 문항에만 줄어들어요',
      weakBonus: '약점 극복 +{xp}',
    },
  },
  duel: {
    heroTitle: '캐스터보다 잘 맞혀 볼까요?',
    result: {
      win: '승리',
      lose: '패배',
      draw: '무승부',
    },
    loading: '오늘의 예보 대결을 불러오는 중...',
    loadFailed: '대결 정보를 불러오지 못했어요',
    title: '🌡️ 예보 대결',
    subtitle: '브리핑을 읽고 AI 캐스터와 내일 예보를 겨뤄요.',
    submitToast: '✅ 예보 제출 완료! 내일 실측과 대결해요',
    settledToast: '어제 대결 {result}!',
    xpNote: ' (+{xp} XP)',
    submitFailed: '예보 제출에 실패했어요.',
    form: {
      title: '내일 예보를 맞혀보세요',
      desc: 'AI 캐스터와 내일 실측을 두고 대결해요. 승리 시 +15 XP! (하루 1회)',
      notice: '📡 참고 예보 — 최고 {max}℃ · 강수확률 {prob}%',
      tempMax: '내일 최고기온(°C)',
      rainProb: '강수확률(%)',
      submit: '예보 제출 (1일 1회)',
    },
    submittedNote: '예보 제출 완료! 이틀 뒤 실측으로 정산돼요. 🌙',
    myPred: '🙋 내 예보',
    aiPred: '🤖 AI 캐스터',
    actual: '실측',
    actualValue: '최고 {max}℃ · 강수 {prob}%',
    // PredColumn의 기온 아래 한 줄 — 없으면 화면에 'duel.rainShort'가 그대로
    // 찍힌다(2026-08-06 리뷰에서 발견. ko·en 둘 다 없어서 패리티 검사를 통과했다).
    rainShort: '강수확률 {prob}%',
    myEvidence: '내가 고른 근거',
    evidenceNote: '정산 후 근거가 맞았는지 해설해 드려요.',
    // 제출 버튼이 근거 카드보다 위에 있어서(2026-08-11 배치 변경) 못 보고 누르는
    // 것을 막는 안내. 강제가 아니라 알림이다 — 근거는 선택 사항이다.
    evidenceBelowHint: '↓ 아래에서 판단 근거를 고르면 정산 후 해설을 받아요 (선택).',
    reviewTitle: '근거 적중 해설',
    hit: '✓ 적중',
    miss: '✗ 빗나감',
    accuracy: '정확도 {score}점',
    historyTitle: '대결 이력',
    historyLoading: '이력 불러오는 중...',
    historyEmpty: '아직 대결 이력이 없어요. 첫 예보를 제출해 보세요!',
    historyVs: '내 {mine}℃ vs AI {ai}℃',
    settling: '정산 중',
    judge: {
      badgeTitle: 'AI 캐스터 등급: {label}급 (내 티어에 맞춰 조정돼요)',
      badgeLabel: '{label}급 캐스터',
      title: '🔍 AI 캐스터의 판단',
      intro: '실제 수치예보도 "기준 자료 → 모델 계산 → 최종 예보" 단계를 거쳐요. 캐스터가 오늘 예측을 만든 과정을 공개할게요.',
      step1: '기준 예보 (기상청 단기예보)',
      tempPrefix: '최고 ',
      rainMid: ' · 강수확률 ',
      step1Waiting: '실황 자료 수신 대기 — 내부 폴백 예보를 기준으로 사용했어요.',
      step2: '오차 모델 ({label}급 · 배율 ×{scale})',
      step2Seg1: '기온 ±{temp}℃ · 강수 ±{rain}%p 기본 오차에 등급 배율을 곱해 ',
      step2Strong: '±{tempAmp}℃ · ±{rainAmp}%p',
      step2Seg2: ' 범위에서 결정적으로 변형해요. 등급이 높을수록 오차가 작아 더 정확해져요.',
      step3: '최종 예측',
    },
  },
  evidence: {
    pop_trend: { label: '강수확률 추세', desc: '시간이 갈수록 강수확률이 높아져요' },
    humidity_high: { label: '높은 습도', desc: '공기가 습해 비구름이 자라기 좋아요' },
    temp_drop: { label: '기온 하강', desc: '전일보다 기온이 내려갈 것 같아요' },
    sky_overcast: { label: '흐린 하늘', desc: '하늘이 흐려 일사가 약해질 거예요' },
    recent_rain: { label: '최근 강수 이력', desc: '최근 며칠 사이 비가 온 적이 있어요' },
    pickerTitle: '🧭 판단 근거 고르기',
    pickerHelp: '브리핑에서 본 단서 중 예측의 근거를 골라요(복수 선택). 정산 후 근거가 맞았는지 해설해 줘요.',
    picked: '✓ 선택',
    pick: '선택',
  },
  briefing: {
    title: '📊 예보 브리핑',
    regionDefault: '서울',
    loading: '브리핑 자료를 불러오는 중...',
    loadError: '브리핑 자료를 불러오지 못했어요. 자료 없이도 예측 제출은 가능해요.',
    waitingTitle: '실황 자료 수신 대기',
    waitingBody: '실황 자료 수신 대기 중이에요. 기상 자료가 도착하면 차트가 열려요 — 예측 제출은 지금도 가능해요.',
    tempTitle: '시간별 기온',
    popTitle: '강수확률',
    popLegend1: ' 막대: 강수확률(%) ·',
    popLegend2: ' 막대 위 숫자: 예상 강수량(㎜)',
    skyTitle: '하늘 상태 · 강수 형태',
    auxTitle: '보조 지표',
    humidity: '습도(%)',
    wind: '풍속(m/s)',
    unit: '단위 {unit}',
    observed: '📡 오늘 실측 — 최고 {max}℃ · 최저 {min}℃ · 강수 {rain}㎜',
    observedWaiting: '📡 오늘 실측 자료는 수신 대기 중이에요.',
    recentTitle: '최근 7일 실측 추이',
    recentTemp: '최고기온(℃)',
    recentRain: '일강수량(㎜)',
    refMax: '최고 {v}℃',
    refMin: '최저 {v}℃',
    tipTempHum: '기온 {tmp}℃ · 습도 {reh}%',
    tipPop: '강수확률 {pop}%',
    tipPcp: '예상 강수량 {pcp}㎜',
    tipNoPcp: '예상 강수량 없음',
    tipMaxTemp: '최고기온 {v}℃',
    tipDayRain: '일강수량 {v}㎜',
    hour: '{h}시',
    sky1: '맑음',
    sky3: '구름많음',
    sky4: '흐림',
    pty1: '비',
    pty2: '비/눈',
    pty3: '눈',
    pty4: '소나기',
  },
  league: {
    loading: '이번 주 리그 정보를 불러오는 중...',
    loadFailed: '리그 정보를 불러오지 못했어요',
    title: '기상 리그',
    week: '{week} 주',
    thisWeek: '이번 주',
    regionDefault: '전국',
    subtitleTail: ' 날씨 예측 대결',
    submittedTitle: '이번 주 예측 제출 완료! ✅',
    submittedBody: '주간 정산 후 실제 날씨와 비교해 ELO가 반영돼요.',
    formTitle: '이번 주 날씨를 예측해보세요',
    tempMax: '최고기온(°C)',
    tempMin: '최저기온(°C)',
    rainProb: '강수확률(%)',
    submit: '예측 제출 (주 1회)',
    minOverMax: '최저기온이 최고기온보다 높을 수 없어요.',
    submitFailed: '예측 제출에 실패했어요.',
    leaderboard: '리더보드',
    leaderboardLoading: '순위표 불러오는 중...',
    myHistory: '내 리그 이력',
    accuracy: '정확도 {score}점',
    accuracyPending: '정확도 집계 중',
    // 대시보드 개편(2026-08-06 시안). 등급·주기 문구는 **실제 도메인** 기준이다 —
    // 시안의 RP·시즌·브론즈는 이 제품에 없다(구름 5단계 · ELO · 주 단위).
    dash: {
      subtitle: '예보 대결로 실력을 쌓아 더 높은 등급에 도전하세요!',
      myTier: '내 등급',
      unranked: '아직 정산 전이에요',
      unrankedBody: '이번 주 예측을 제출하면 주간 정산에서 첫 ELO가 매겨져요.',
      rankNth: '{rank}위',
      rankPending: '순위 집계 전',
      toNext: '{tier}까지 {gap}',
      topTier: '최고 등급이에요! 🎉',
      weekSummary: '이번 주 요약',
      played: '예보 대결',
      won: '승리',
      winRate: '승률',
      times: '{n}회',
      weekEmpty: '이번 주 대결 기록이 아직 없어요. 한 판 해볼까요?',
      weekTip: '대결을 많이 할수록 실력이 빨리 쌓여요.',
      goDuel: '예보 대결하러 가기 →',
      ranking: '리그 순위',
      ladder: '리그 등급',
      promoTitle: '승급 조건',
      promoNeed: '{tier}까지 ELO {gap} 남았어요',
      weekTitle: '이번 주',
      weekLeft: '{days}일 남음',
      resetNote: '리그는 매주 월요일에 새로 시작해요.',
    },
    board: {
      empty: '아직 순위표가 없어요. 첫 예측의 주인공이 되어보세요!',
      rank: '순위',
      nickname: '닉네임',
      accuracy: '정확도',
      me: '(나)',
      anonymous: '익명',
      score: '{score}점',
    },
  },
  auth: {
    login: {
      tagline: '오늘의 날씨로 배우는 기상 · 기후 학습',
      guestCta: '⚡ 계정 없이 바로 시작하기',
      guestStarting: '오늘의 하늘을 여는 중...',
      // MT-29 — 발급 실패는 **로그인 화면이 아니라** 재시도로 받는다.
      guestFailedTitle: '지금 하늘을 열지 못했어요',
      guestFailedBody: '잠시 연결이 어려웠어요. 다시 시도해 볼까요?',
      guestFailedRetry: '다시 시도하기',
      guestFailedHasAccount: '이미 계정이 있어요',
      guestNote: '가입 없이 실력 진단과 오늘의 세션을 바로 체험해요. 쌓인 진도는 나중에 30초 가입으로 저장할 수 있어요.',
      guestFailed: '시작에 실패했어요. 잠시 후 다시 시도해 주세요.',
      guestNickname: '게스트',
      haveAccount: '이미 계정이 있나요?',
      email: '이메일',
      password: '비밀번호',
      failed: '로그인에 실패했습니다.',
      submitting: '로그인 중...',
      submit: '로그인',
      noAccount: '아직 계정이 없나요?',
      register: '회원가입',
    },
    register: {
      title: '회원가입',
      elementary: '초등학생',
      middleHigh: '중·고등학생',
      adult: '성인',
      nickname: '닉네임',
      levelGroup: '학습 수준',
      failed: '회원가입에 실패했습니다.',
      submitting: '가입 중...',
      submit: '가입하고 시작하기',
      haveAccount: '이미 계정이 있나요?',
      login: '로그인',
    },
    convert: {
      alreadyTitle: '이미 정식 계정이에요',
      alreadyBody: '학습 진도는 계정에 자동으로 저장되고 있어요.',
      goHome: '학습 홈으로',
      title: '30초 가입으로 진도 저장',
      bodySeg1: '지금까지 쌓은 XP·스트릭·실력 진단이 ',
      bodyStrong: '그대로',
      bodySeg2: ' 내 계정이 돼요.',
      bodyLine2: '어느 기기에서든 이어서 학습할 수 있어요.',
      nicknameOptional: '(선택 — 비우면 지금 그대로)',
      errNotGuest: '이미 정식 계정이에요 — 진도는 계정에 안전하게 저장되고 있어요.',
      errEmailExists: '이미 가입된 이메일이에요. 다른 이메일을 입력하거나, 그 계정으로 로그인해 주세요. (로그인하면 지금 게스트 진도는 이 기기에 남지 않아요)',
      errGeneric: '계정 만들기에 실패했어요. 잠시 후 다시 시도해 주세요.',
      submitting: '진도 옮기는 중...',
      submit: '가입하고 진도 저장하기',
      later: '나중에 할게요 — 학습 계속하기',
    },
  },
};
