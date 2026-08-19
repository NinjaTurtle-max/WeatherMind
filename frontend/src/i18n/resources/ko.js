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
 *    ↳ **2026-08-13 예외(PM 지시로 문구 검수 항목 수행)**: 아래 3종을 통일했다.
 *      이 줄이 없으면 다음 사람이 "원문 복구"로 되돌린다.
 *        ⓐ 「~합니다」체 2건(apiError.generic·network) → 화면 톤인 「~해요」체
 *        ⓑ 보조용언 띄어쓰기 — `시도해주세요`류 붙임 10건을 `시도해 주세요`(국립
 *           국어원 원칙형)로. 이 파일 안에 붙임/띄움이 섞여 있었다.
 *        ⓒ 말줄임표 `...`(19) → `…`(U+2026). 종전 `…`는 1건뿐이었다.
 *      바이트 동일 계약이 실제로 걸리지 않은 이유: 스모크들이 단정하는 것은
 *      말줄임표 앞까지의 부분 문자열이고(예: '세션을 준비하고 있어요'),
 *      바뀐 값 중 어느 것도 단정 대상이 아니었다(변경 전 전 종목 초록 실측).
 *  - 굵기 등 마크업이 문장 중간에 끼는 문구는 segN/strongN 조각 키로 나눈다
 *    (조각을 이어 붙이면 원문과 바이트 동일).
 */
export default {
  // 마스코트 이름 — `<img alt>`로 나가 **스크린리더가 읽는 사용자 문자열**이다.
  // 소유자는 `components/Mascot.jsx`의 `LABEL`(여기를 읽는다) · 그림 배정은
  // `SideNav.TUTOR_BY_PATH`. 🔴 ko 값은 원문 바이트 동일 — 스모크가 단정한다.
  mascot: {
    guidebot: '구름이',
    cloud: '구름이',
    sun: '태양이',
    drop: '물방울이',
    bolt: '번개',
    typhoon: '태풍이',
    snow: '눈결정',
    rainbow: '무지개',
    moon: '달님',
    snowcloud: '눈구름',
    raincloud: '비구름',
    fire: '불꽃이',
    thermometer: '온도계',
    wind: '바람이',
    grass: '풀',
  },
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
  // 🔴 원출처 표기 — **대회 규정 요구**(2026-08-14 감사 판정). 화면 하단 한 줄.
  // ⚠️ **기관명은 번역 대상이 아니다** — en에서도 원문이 그대로 온다. 그래도 키로
  //    두는 이유는 이 저장소가 UI 문구를 예외 없이 외부화하기 때문이고, 예외를
  //    하나 만들면 「어떤 문구가 키를 갖는가」의 규칙이 사람 판단으로 내려간다.
  // ⚠️ 값을 바꿀 때는 `tests/home.smoke.test.mjs`의 원출처 단정 3종을 먼저 볼 것 —
  //    기관명이 빠지면 요소가 남아 있어도 규정을 못 지킨다.
  attribution: {
    data: '자료: 기상청 날씨누리 · 기상청 API허브',
  },
  common: {
    save: '저장',
    cancel: '취소',
    loading: '불러오는 중…',
    retry: '다시 시도',
    retryLater: '잠시 후 다시 시도해 주세요.',
  },
  nav: {
    primary: '주 메뉴',
    learn: '학습',
    board: '보드',
    // 내비 라벨은 **화면 제목과 다르다**(2026-08-11 사용자 지시). 제목은
    // `duel.title`(「예보 대결」)이고 여기는 사이드바·탭바에 들어가는 짧은 이름이라
    // 두 글자로 줄였다 — 리그와 한 화면으로 합치면서 이 항목이 두 탭을 함께
    // 담당하게 됐고(navItems.alsoMatch), 「예보 대결」이라 적으면 리그를 보고
    // 있을 때 내비가 틀린 이름을 켜 놓은 꼴이 된다.
    duel: '예보',
    explore: '탐구',
    me: '내 정보',
    tutor: {
      // 화면 담당 마스코트(Mascot 배정표) — 보드는 태양이
      board: { name: '태양이', line: '어떤 날씨를 만들어 볼까요?' },
      learn: { name: '물방울이', line: '오늘은 어디까지 가볼까요?' },
      duel: { name: '태풍이', line: '자료를 보고 내일 날씨를 맞혀 봐요!' },
      // 탐구 담당이 구름이 → **번개**로 바뀌었다(2026-08-17 사용자 지시).
      // 같은 날 잠깐 리그와 겹쳤다가, 리그가 눈송이를 받으면서 풀렸다(아래).
      explore: { name: '번개', line: '오늘은 무엇을 살펴볼까요?' },
      // 리그 담당이 번개 → **눈송이**로 바뀌었다(2026-08-17 사용자 지시).
      league: { name: '눈송이', line: '이번 주 순위를 올려볼까요?' },
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
    numeric: '모든 값을 숫자로 입력해 주세요.',
    rainRange: '강수확률은 0~100 사이여야 해요.',
    submitting: '제출 중…',
  },
  guestBanner: {
    aria: '게스트 진도 저장 — 30초 가입으로 계정 전환',
    title: '진도가 쌓였어요 — 30초 가입으로 저장',
    body: '게스트 진도는 이 기기에만 있어요. 계정을 만들면 XP·스트릭이 그대로 옮겨져요.',
    cta: '저장하기',
  },
  // 진도 저장(2026-08-12 클라이언트 요구 ⑴⑵) — 「로그인 창」이 아니라 「정보 입력」.
  // ⚠️ 이 블록에 「로그인」·「회원가입」을 쓰지 않는다(대회 규정 — 렌더된 텍스트
  // 계약은 tests/onboardingSave.contract.test.mjs가 문다).
  // 위 guestBanner.*는 **지우지 않는다**: 학습 화면 상단 배너는 걷었지만
  // GuestSaveBanner 컴포넌트가 저장소에 남아 있고 guest-convert 스모크가 그
  // 문구를 직접 단정한다.
  saveProgress: {
    nodeAria: '진도 저장 — 내 정보에서 정보 입력하기',
    nodeTitle: '진도 저장',
    nodeBody: '정보를 입력해 진도를 저장해 주세요',
    nodeCta: '정보 입력하러 가기 →',
    cardTitle: '진도 저장',
    // 「다른 기기에서도 이어서」의 이력 — **두 번 바뀌었다. 지우지 말 것.**
    //  · ~8/13: 세 문구가 그렇게 말했는데 **돌아올 문이 없었다**(`a4a8b6f`가
    //    `/login`을 화면과 함께 걷었다). 못 지킬 약속이 실서버까지 갔다(대장 §4.14).
    //  · 8/13: 문구를 지금 참인 것으로 낮췄다 — **저장한 정보가 계정에 붙는다**.
    //  · **8/14: `/login`이 「진도 불러오기」로 돌아왔다**(클라이언트 결정 ⓑ).
    //    그래서 계약 ㉮가 **스스로 풀렸고 이제 이 문구를 써도 된다.**
    // ⚠️ **그래도 되돌리지 않았다** — 저장 **전** 화면에서 하는 약속이라, 저장을
    //    마치지 않은 사람에게는 여전히 거짓이다(그 사람은 localStorage를 지우면
    //    그대로 잠긴다). 「돌아올 문」과 「이 사람이 돌아올 수 있다」는 다르다.
    //    올리려면 저장 여부에 따라 문구를 가르는 쪽이 맞다.
    cardBody:
      '정보를 입력해 진도를 저장해 주세요. 지금 진도는 이 기기에만 있어요 — 저장하면 XP·스트릭·실력 진단이 내 계정에 함께 남아요.',
    submit: '진도 저장하기',
    done: '진도를 저장했어요 — XP·스트릭·실력 진단이 내 계정에 남아요.',
    alreadySaved: '진도는 내 정보에 이미 저장되고 있어요 — XP·스트릭·실력 진단이 내 계정에 남아요.',
  },
  // 진도 **불러오기**(2026-08-14 클라이언트 결정 ⓑ) — 「저장」의 짝이다.
  // ⚠️ **「로그인」·「회원가입」이라는 낱말을 쓰지 않는다.** 대회 규정(화면에 가입/
  //    로그인 문구 없음)이고 `onboardingSave.contract`의 금칙 목록이 en 값까지
  //    문다 — en에도 "log in"·"sign up"을 쓰지 말 것("Load my progress"가 맞다).
  // ⚠️ **주 동선(SideNav·TabBar·헤더)에 이 화면으로 가는 링크를 넣지 않는다.**
  //    MT-29가 고정한 「주 동선 링크 0건」이 규정 해석의 근거다. 진입은 「진도 저장」
  //    카드의 `fromSave` 한 줄뿐이고, 그 계약은 `onboardingSave.contract`가 문다.
  // ⚠️ **2026-08-19 오전: 이메일·비밀번호를 걷고 닉네임 하나로 바꿨다.** 사유는
  //    이랬다 — 종전 `body`가 *"저장할 때 쓴 이메일과 비밀번호를 넣으면"*이라고
  //    안내했는데, 진입 화면이 물어보는 것은 **닉네임뿐**이었고 게스트의 비밀번호는
  //    무작위 시크릿이라 **원리적으로 아무도 그 문을 못 열었다.**
  // 🔴 **2026-08-19 오후: 다시 이메일·비밀번호다**(클라이언트 결정 — 주최측 확인 후).
  //    *"닉네임을 통한 호출은 **보안의 개별성이 약하기에** 로그인을 통한 진도
  //    불러오기가 맞는 것 같다"*. 오전 판이 본 결함은 실재했지만, 맞추는 방향이
  //    반대였다 — 저장(`guest/convert`)은 **이미** 이메일+비밀번호인데 불러오기만
  //    닉네임이라 **저장과 불러오기가 서로 다른 열쇠**를 쓰고 있었다. 이제 짝이 맞다.
  //    ⚠️ 진짜 결함은 화면이 아니라 서버였다: `POST /auth/resume`가 이름 하나로
  //    토큰을 줬다(`backend/app/routers/auth.py`의 `/resume` 절이 경위를 소유한다).
  loadProgress: {
    fromSave: '이미 저장하셨나요? 진도 불러오기',
    title: '진도 불러오기',
    body: '진도를 저장할 때 쓴 이메일과 비밀번호를 넣으면 그때 진도로 돌아가요.',
    // 🔴 **아래 네 줄은 안 쓰이지만 남긴다 — 지우지 말 것.**
    //    오전 판의 닉네임 통로가 **무엇을 감당할 수 없었는지**의 증거다. 특히
    //    `ambiguous`는 그 통로의 한계를 화면 문구로 자백하고 있다: 같은 이름을 쓰는
    //    사람이 여럿이면 **어느 진도가 당신 것인지 서버가 모른다.** `users.nickname`에
    //    유니크 제약이 없고 자동 부여 이름(`게스트-{hex6}`)은 유일성 검사를 아예 안
    //    지나가기 때문이다. 이름으로 사람을 특정할 수 없다는 것을 제품이 이미
    //    알고 있었다는 기록이라, 다음에 「닉네임으로 열자」가 다시 나올 때 이 네 줄이
    //    답이 된다. 이월 대장 §4.14가 같은 사유를 문서 쪽에서 소유한다.
    nicknameLabel: '닉네임',
    nicknamePlaceholder: '예: 구름사냥꾼',
    notFound: '그 이름으로 저장된 진도를 찾지 못했어요. 닉네임을 다시 확인해 주세요.',
    ambiguous: '같은 이름을 쓰는 분이 여럿이라 진도를 찾지 못했어요. 다른 이름으로 저장해 주세요.',
    submit: '진도 불러오기',
    submitting: '진도 불러오는 중…',
    // 🔴 실패는 **한 갈래**다. 「그런 계정이 없다」와 「비밀번호가 틀렸다」를 가르면
    //    화면이 **「그 이메일은 있다」를 자백**한다(계정 열거). 서버도 401 하나로
    //    뭉치므로(`_authenticate`) 문구도 하나다 — 오전 판이 세 갈래였던 것은
    //    이름 통로가 존재 여부를 응답으로 알려 줬기 때문이고, 그것이 결함이었다.
    invalidCredentials: '이메일 또는 비밀번호가 맞지 않아요. 저장할 때 쓴 것으로 다시 넣어 주세요.',
    failed: '진도를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
    back: '← 학습으로 돌아가기',
    // 게스트에게 이 화면은 **필요 없다**(토큰이 이 기기에 남아 있다). 그런데 아무
    // 안내가 없으면 「저장한 적 없는 사람」이 자기 자격을 지어내려 한다 —
    // 대회 규정(「로그인 없이 전 기능」)이 성립한다는 것을 화면에서도 말해 준다.
    noAccountNote: '아직 저장한 적이 없다면 그냥 돌아가서 계속 배우면 돼요 — 저장은 나중에 해도 돼요.',
  },
  // 위치 안내(2026-08-12 요구 ⑶) — 접속 직후 안내 배너. 모달이 아니다.
  regionNotice: {
    title: '어느 지역 날씨로 배울까요?',
    body: '오늘의 실황 문항이 이 지역 날씨로 나와요. 나중에 내 정보에서도 바꿀 수 있어요.',
    dismiss: '나중에',
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
    gpsPending: '위치 확인 중…',
    gpsHint: '위치는 가장 가까운 도시를 고르는 데만 쓰고, 어디에도 저장하거나 보내지 않아요.',
    gpsFailed: '위치를 확인할 수 없었어요 — 아래에서 도시를 직접 골라 주세요.',
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
    saveFailed: '목표를 저장하지 못했어요. {detail} 다시 눌러 주세요.',
    meterTitle: '🎯 오늘 목표 {done}/{goal}',
    reached: '달성!',
    remaining: '{count}문항 남음',
  },
  // api/client.js 에러 정규화 폴백 2건
  apiError: {
    generic: '요청 처리 중 오류가 발생했어요.',
    network: '서버에 연결할 수 없어요. 네트워크를 확인해 주세요.',
  },
  // 온보딩 배치고사(modules/onboarding/**)
  // 첫 접속 정보 입력(modules/onboarding/EntryInfoPage.jsx — 2026-08-13 요구 ⑵⑶).
  // ⚠️ 「로그인」·「회원가입」은 규정 금칙어다(onboardingSave.contract ③⑧이 렌더
  // 텍스트와 리소스 값 양쪽을 문다) — 이 블록은 계정·이메일을 아예 언급하지 않는다.
  // 학습 수준 라벨은 새로 만들지 않고 `auth.register.*`를 재사용한다(/me의 학습
  // 수준 카드와 같은 말이어야 한다). 여기 있는 것은 그 옆에 붙는 설명뿐이다.
  entryInfo: {
    // 2026-08-14(S-12): `알려주세요` → `알려 주세요`. 이 파일의 ⓑ 규약(보조용언
    // 띄어쓰기 원칙형)이 8/13에 10건을 띄웠는데, 그 뒤에 저작된 이 블록만 붙임으로
    // 남아 파일 안에서 유일한 예외였다(다른 `~해 주세요` 18건은 전부 띄움).
    title: '반가워요! 어떻게 배울지 알려 주세요',
    body: '학습 수준에 맞춰 문항이 나와요. 지금 정하면 바로 이어서 실력 진단을 받아요.',
    levelLabel: '학습 수준',
    levelHint: {
      elementary: '쉬운 말과 그림 위주로 배워요',
      middleHigh: '교과 개념을 중심으로 배워요',
      adult: '실생활·심화 개념까지 배워요',
    },
    // 닉네임은 **선택**이다 — 라벨에 그것을 적어 두는 것이 계약의 일부다.
    // 「안 적어도 된다」가 화면에서 읽히지 않으면 사용자는 막힌 줄 알고 되돌아간다.
    nicknameLabel: '닉네임 (선택)',
    nicknamePlaceholder: '예: 구름사냥꾼',
    nicknameHint: '리그와 순위표에 보일 이름이에요. 비워 두면 자동으로 지어 드려요.',
    goalLabel: '하루 목표 (선택)',
    goalHint: '하루에 몇 문항을 풀지 정해요. 나중에 바꿀 수 있어요.',
    // 서버가 중복을 알려줄 때만 뜬다(오늘은 유일성 제약이 없어 뜨지 않는다).
    nicknameTaken: '이미 쓰고 있는 이름이에요. 다른 이름으로 바꿔 주세요.',
    submit: '다음 — 실력 진단 받기 →',
    skip: '건너뛰기 →',
    note: '나중에 내 정보에서 언제든 바꿀 수 있어요.',
    // 「돌아온 사람」의 자리(2026-08-19). 이 화면은 이름을 **적게** 하는 곳이라,
    // 이미 이름이 있는 사람이 그것을 알릴 자리가 여기 말고 없었다 — 종전에는
    // `/login` URL을 직접 아는 사람만 불러오기에 닿았다.
    // ⚠️ 「로그인」이라는 낱말을 쓰지 않는다(대회 규정 — 금칙어 계약이 값을 훑는다).
    loadProgressCta: '진도 불러오기 →',
  },
  placement: {
    skip: '건너뛰기 →',
    title: '실력 진단 — 내 수준 찾기',
    // ⚠️ 문항 수는 서버 `Settings.PLACEMENT_SIZE`가 소유한다(2026-08-12 PM 판정으로
    // 6 → **10**). 이 줄이 6에 멈춰 있어 게스트 첫 화면이 거짓을 말했다 —
    // 숫자를 바꿀 때는 아래 placementBannerBody·en.js 짝까지 함께 본다.
    hint: '🧭 딱 10문항이면 충분해요 — 틀려도 괜찮아요, 진단일 뿐!',
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
    nicknameEdit: '이름 바꾸기',
    nicknameTaken: '이미 쓰고 있는 이름이에요. 다른 이름을 넣어 주세요.',
    nicknameFailed: '이름을 바꾸지 못했어요. 잠시 뒤 다시 해 주세요.',
    levelXp: 'Lv.{level} · 누적 {xp} XP',
    streakStat: '연속 출석',
    placementBannerTitle: '아직 실력 진단 전이에요',
    placementBannerBody: '10문항 진단을 받으면 WeatherBrain이 내 수준에 맞는 문제를 골라줘요.',
    placementBannerCta: '진단 받고 내 수준 찾기 →',
    // 학습 수준 설정 (R13 P-5) — 게스트가 평생 middle_high에 갇히지 않게 하는 통로
    levelGroupTitle: '🎚️ 학습 수준',
    levelGroupBody: '문항 난이도와 보드에서 열리는 난이도가 이 설정을 따라가요. 세션은 다음 발급부터 반영돼요.',
    levelGroupSaved: '학습 수준을 바꿨어요.',
    levelGroupFailed: '학습 수준을 바꾸지 못했어요.',
    levelGroupSaving: '바꾸는 중…',
  },
  // 배지 컬렉션(modules/progress/BadgeCollection.jsx)
  badges: {
    loading: '배지를 불러오는 중…',
    loadFailed: '배지를 불러오지 못했어요. {detail}',
    title: '🏅 배지 컬렉션',
    earnedCount: '{earned}/{total} 획득',
    empty: '아직 등록된 배지가 없어요.',
    locked: '미획득',
    moreAfterFirstSession: '첫 세션을 마치면 배지 {count}개가 더 열려요.',
  },
  // 일일 퀘스트(modules/progress/QuestList.jsx)
  quests: {
    loading: '오늘의 퀘스트를 불러오는 중…',
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
    loading: '능력 분석을 불러오는 중…',
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
      radarAria: '개념별 숙련도 레이더 — {list}',
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
  // ── 홈 유래 문구 ──────────────────────────────────────────────────────────
  // ⚠️ 홈 화면(`/`)은 2026-08-09에 학습 화면으로 흡수됐다(navItems.js 머리 주석).
  // 그래서 이 블록은 **홈의 잔재가 아니라 흡수처가 쓰는 문구**만 남는다 —
  // `entry.*`는 CurriculumHome의 학습 진입 카드, `goal.*`은 LearnHeroCard,
  // `streak.*`·`brain.aria`는 내 정보(ProgressPage·AbilityRadar), `tutor.*`는
  // SideNav의 마스코트 폴백(`nav.tutor.{key}`가 없을 때)이 읽는다.
  // 2026-08-13에 읽는 곳이 없어진 27키를 걷어냈다(홈 대시보드 전용 문구).
  home: {
    tutor: { name: '구름이', line: '무엇부터 해볼까요?' },
    entry: {
      learn: '학습 세션',
      learnEmpty: '첫 유닛부터 시작해요',
      learnGo: '이어서 풀기 →',
      // R13-01 §2.5 진입 통합 — 홈의 학습 진입 카드 1개가 쓰는 문구
      todayLabel: '오늘의 학습',
      doneTitle: '오늘 몫은 다 했어요',
      doneCta: '지난 유닛 다시 보기 →',
    },
    goal: {
      title: '오늘의 목표',
      items: '문항',
    },
    streak: {
      title: '연속 출석',
      days: '월,화,수,목,금,토,일',
    },
    brain: {
      aria: '개념별 실력 레이더 차트: {list}',
    },
  },
  curriculum: {
    // 하루 목표 미설정 — 진입 카드에서 내 정보(설정 통로)로 보낸다
    goalUnset: '목표를 설정하세요!',
    loading: '학습 경로를 불러오고 있어요…',
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
    // 2026-08-14(S-11 고아 키 정리): `body`·`resume`·`regenResume` 3키를 걷었다.
    // 소유자였던 자유 일일 세션 카드·`/daily` 라우트가 2026-08-12에 통째로
    // 제거되면서 읽는 곳이 사라졌다(`tests/onboardingGating.smoke.test.mjs` §8이
    // 그 UI 단정을 걷어낸 경위를 소유한다). 남은 3키는 실사용처가 있다 —
    // title·cta는 CurriculumHome, regen은 LearnHeroCard.
    daily: {
      title: '자유 일일 세션',
      cta: '오늘의 세션 풀기 →',
      regen: '☁️ 구름 회복까지 약 {min}분',
    },
    // 세로 경로(PcCurriculumPath) — 노드 밑 라벨을 뺀 대신 진도 바가 "지금 어디"를 말한다.
    path: {
      sectionEyebrow: '섹션 {n} · {title}',
      introTitle: '이 단계에서 배우는 것',
      start: '시작',
      estDays: '예상 {days}일',
      fold: '접기',
      unfold: '펼치기',
      // 2026-08-13: 「↓ 스크롤해서 다음 단계」에서 갈았다 — 한 번에 한 섹션만
      // 펼치게 되면서 **스크롤로는 다음 단계에 갈 수 없게** 됐고(다음 단계는
      // 접힌 줄을 눌러서 간다), 종전 문구가 거짓이 됐다. 스크롤이 실제로 하는
      // 일은 펼친 섹션 안을 움직이는 것뿐이다(최장 19칸 = 트랙 2.7화면).
      scrollHint: '↓ 스크롤해서 이 섹션 더 보기',
      progressLabel: '현재 진도',
      unitCount: '{done} / {total} 유닛',
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
    // 좁은 화면에서 이 패널이 「다음」 컨트롤을 덮는다 — 닫을 수 있어야 한다.
    feedbackDismiss: '해설 닫기',
    answerHere: '답을 고르면 여기에 정답과 해설이 나와요.',
    loading: '세션을 준비하고 있어요…',
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
    // 문항의 학습 수준 배지 (2026-08-12) — **명칭표를 여기에 두지 않는다.**
    // 단계 이름은 `ability.knowledgeLevel.name` 하나가 소유하고 이 키들은
    // 그 이름을 감싸는 틀만 갖는다({name}·{level}은 그쪽에서 온다).
    // 두 번째 사본을 손으로 쓰면 10칸이 조용히 갈린다(이 저장소의 재발 유형).
    knowledgeLevel: '🪜 {name}',
    knowledgeLevelAria: '이 문항의 학습 수준 — {level}단계 {name}',
    combo: '연속 정답 {combo}',
    // 칭찬 4단 (R10-01 §3.5) — SessionRunner.COMBO_PRAISE 계약과 바이트 동일
    // (boardAssistRetention 스모크가 ko 원문 4개를 그대로 단정한다)
    praise: {
      1: '정답이에요',
      2: '좋아요',
      3: '훌륭해요',
      4: '완벽해요',
    },
    grading: 'AI가 채점하고 있어요…',
    submitFailed: '답안 제출에 실패했어요. 잠시 후 다시 시도해 주세요.',
    completeFailed: '세션 완료 처리에 실패했어요. 잠시 후 다시 시도해 주세요.',
    crownToast: '👑 왕관 획득 — {title}',
    clouds: {
      title: '구름이 모두 흩어졌어요',
      seg1: '구름은 ',
      strong1: '틀린 문항에만 1개',
      seg2: ' 줄어들어요 — 열심히 푼 만큼이 아니라 실수에만 소모돼요. ',
      strong2: '지금 풀던 세션은 끝까지 마칠 수 있고',
      seg3: ', 구름이 1개라도 회복되면 새 세션도 다시 열려요.',
    },
    finishing: '세션을 마무리하고 있어요…',
    retryAfterRegen: '구름 회복 후 다시 시도',
    finish: '세션 마치기 →',
    next: '다음 문항 →',
    bulkFailTitle: '결과 계산에 실패했어요',
    bulkFailBody: '잠시 후 다시 시도해 주세요. 푼 답안은 그대로 남아 있어요.',
    bulkFinalizing: '결과를 계산하고 있어요…',
    leave: {
      title: '지금 나가면 오늘 진도가 사라져요',
      remaining: '{remaining}문항만 더 풀면 오늘 진도와 스트릭이 기록돼요. ',
      almost: '조금만 더 하면 끝나요. ',
      // 만회 라운드 전용 (2026-08-12) — 만회 중에는 본문 `total - answered`가 **0**이라
      // 위 `almost`("조금만 더 하면 끝나요")가 떴는데, 그건 거짓이다: 남은 것은
      // 0이 아니라 **만회 큐에 남은 수**이고, 그것을 다 맞혀야 세션이 끝난다.
      retryRemaining: '아직 만회할 {remaining}문항이 남았어요. 다 맞혀야 오늘 세션이 끝나요. ',
      tail: '여기서 멈추면 지금까지 푼 만큼만 남아요.',
      stay: '계속 풀기',
      quit: '그만두기',
    },
    // 만회 라운드 (R13-01 §2.1) — 세션 마지막 문항 뒤 오답 재투입.
    // 만회는 벌도 파밍도 아니다: 구름 무소모·XP 무가산이라 화면도 그렇게 읽혀야 한다.
    // ⚠️ 상한 5는 2026-08-12 클라이언트 지시로 폐지됐다 — 다 맞힐 때까지 회전한다.
    //    그래서 `fail`이 "내일 복습으로 다시 만나요"라고 말하면 거짓이다(이번 라운드에서
    //    곧바로 다시 나온다). `capNote`도 렌더되지 않아 함께 걷었다.
    retry: {
      banner: '☂️ 만회 라운드 — 아까 놓친 {total}문항',
      note: '만회는 벌이 아니에요 — 구름도 XP도 움직이지 않아요.',
      itemCount: '만회 {current} / {total}',
      start: '놓친 {count}문항 만회하기 →',
      next: '다음 만회 문항 →',
      success: '☀️ 만회 성공! 이 문항은 해결했어요',
      fail: '🌧️ 아직이에요 — 이 문항은 조금 뒤에 다시 나와요',
      alreadyResolved: '이미 해결한 문항이에요 — 다음으로 넘어갈게요.',
      untilAllCorrect: '다 맞힐 때까지 이어져요.',
      // 탈출구 (2026-08-12 클라이언트 확정) — 상한이 없으므로 **채점이 잘못된 문항**이
      // 큐에 들어오면 세션이 영영 안 끝난다. 같은 문항을 RETRY_MERCY_ROUNDS 바퀴
      // 돌아도 못 맞히면 학습자가 **스스로 눌러** 해설을 보고 넘어간다(자동 아님).
      // ⚠️ 문구가 "해결했다"고 말하면 거짓이다 — 서버에는 미해결로 남는다.
      mercy: '해설 보고 넘어가기 →',
      mercyNote: '몇 번을 시도해도 안 풀리면 해설을 보고 넘어가도 괜찮아요 — 이 문항은 해결하지 못한 것으로 남아요.',
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
        // R13-02 §T3 — 배합에 들어온 board 블록. **아무 보드가 아니라** KMA 실황으로
        // 오늘 현상을 판정해 고른 보드다(`order_boards_for_today`). 그래서 「보드」가
        // 아니라 「오늘의 하늘」 — 학습자가 창밖과 같은 장면을 판에서 만든다.
        board: '오늘의 하늘',
      },
      blockCount: '{count}문항',
      unitBlockNote: '이 문항들은 지금 배우는 유닛에서 나왔어요.',
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
      failed: '예보 제출에 실패했어요. 잠시 후 다시 시도해 주세요.',
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
    loading: '오늘의 예보 대결을 불러오는 중…',
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
    historyLoading: '이력 불러오는 중…',
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
    loading: '브리핑 자료를 불러오는 중…',
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
    loading: '이번 주 리그 정보를 불러오는 중…',
    loadFailed: '리그 정보를 불러오지 못했어요',
    title: '기상 리그',
    // 배너 큰 문장 — 한 줄로 잘리므로 짧게(`HeroBanner` title 규약).
    heroTitle: '이번 주 등급을 올려 볼까요?',
    thisWeek: '이번 주',
    submittedTitle: '이번 주 예측 제출 완료! ✅',
    submittedBody: '주간 정산 후 실제 날씨와 비교해 ELO가 반영돼요.',
    formTitle: '이번 주 날씨를 예측해보세요',
    tempMax: '최고기온(°C)',
    tempMin: '최저기온(°C)',
    rainProb: '강수확률(%)',
    submit: '예측 제출 (주 1회)',
    minOverMax: '최저기온이 최고기온보다 높을 수 없어요.',
    submitFailed: '예측 제출에 실패했어요.',
    // 2026-08-14(S-11): `leaderboard`('리더보드') 제목 키를 걷었다 — 대시보드
    // 개편으로 그 자리의 제목은 `dash.ranking`(「리그 순위」)이 됐고 읽는 곳이
    // 없었다. `leaderboardLoading`은 LeaguePage가 그대로 쓴다.
    leaderboardLoading: '순위표 불러오는 중…',
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
      me: '(나)',
      anonymous: '익명',
    },
  },
  auth: {
    // ⚠️ **블록 이름이 화면 이름이 아니다.** 로그인·회원가입 화면은 2026-08-12에
    // 통째로 제거됐다(대회 규정 — 로그인 없이 열려야 한다). 여기 남은 것은 그
    // 화면들이 쓰던 문구가 아니라 **다른 화면이 계속 읽는 조각**뿐이다:
    //   login.guest* → App.jsx의 게스트 자동 발급·실패 재시도
    //   login.email·password → components/SaveProgressForm.jsx(내 정보 진도 저장)
    //   register.elementary·middleHigh·adult → ProgressPage 학습 수준 선택지
    //   register.nickname → SaveProgressForm
    // 2026-08-13에 화면과 함께 죽은 17키를 걷어냈다. 키 경로를 바꾸지 않은 것은
    // 소비처가 문자열 리터럴로 부르기 때문이고, 이름을 옮기려면 그 6곳을 함께
    // 고쳐야 한다(이 정리의 범위 밖).
    login: {
      guestStarting: '오늘의 하늘을 여는 중…',
      // MT-29 — 발급 실패는 **로그인 화면이 아니라** 재시도로 받는다.
      guestFailedTitle: '지금 하늘을 열지 못했어요',
      guestFailedBody: '잠시 연결이 어려웠어요. 다시 시도해 볼까요?',
      guestFailedRetry: '다시 시도하기',
      guestFailed: '시작에 실패했어요. 잠시 후 다시 시도해 주세요.',
      // 만료 화면(2026-08-14) — **발급 실패와 다른 상황**이다. 이 화면에 온
      // 사람은 계정이 이미 있었고 이 기기의 열쇠만 없어졌다. 「다시 시도」로
      // 새 계정을 조용히 만들면 그 진도가 영영 사라지므로 선택을 묻는다.
      expiredTitle: '이 기기의 연결이 끊겼어요',
      expiredBody:
        '학습 진도는 그대로 남아 있어요. 진도를 저장해 두었다면 불러올 수 있고, 아니면 새로 시작할 수 있어요.',
      expiredLoad: '진도 불러오기',
      expiredFresh: '새로 시작하기',
      expiredFreshNote: '새로 시작하면 이 기기에 남아 있던 진도로는 돌아갈 수 없어요.',
      guestNickname: '게스트',
      email: '이메일',
      password: '비밀번호',
    },
    register: {
      elementary: '초등학생',
      middleHigh: '중·고등학생',
      adult: '성인',
      nickname: '닉네임',
    },
    convert: {
      alreadyTitle: '이미 정식 계정이에요',
      alreadyBody: '학습 진도는 계정에 자동으로 저장되고 있어요.',
      goHome: '학습 홈으로',
      title: '30초 가입으로 진도 저장',
      bodySeg1: '지금까지 쌓은 XP·스트릭·실력 진단이 ',
      bodyStrong: '그대로',
      bodySeg2: ' 내 계정이 돼요.',
      // ⚠️ 종전 '어느 기기에서든 이어서 학습할 수 있어요.' — 8/13 시점에 **거짓**이라
      //    걷었다(`/login`이 없어 다른 기기로 열면 새 게스트가 됐다). 8/14에 문이
      //    돌아왔지만 되돌리지 않는다 — 경위는 `saveProgress` 블록 주석이 소유한다.
      bodyLine2: '저장한 정보는 「내 정보」에서 언제든 확인할 수 있어요.',
      nicknameOptional: '(선택 — 비우면 지금 그대로)',
      errNotGuest: '이미 정식 계정이에요 — 진도는 계정에 안전하게 저장되고 있어요.',
      // 2026-08-12(PM 승인): 종전 문구는 "그 계정으로 **로그인**해 주세요"였다.
      // 로그인 화면이 같은 날 제거돼 **갈 곳이 없는 죽은 안내**가 됐고, 규정
      // (화면에 「로그인」 문구 없음)과도 충돌했다. 지금 이 자리에서 할 수 있는
      // 유일한 행동은 다른 이메일로 다시 저장하는 것뿐이라 그것만 말한다.
      errEmailExists: '이미 사용 중인 이메일이에요. 다른 이메일로 저장해 주세요.',
      errGeneric: '계정 만들기에 실패했어요. 잠시 후 다시 시도해 주세요.',
      submitting: '진도 옮기는 중…',
      submit: '가입하고 진도 저장하기',
      later: '나중에 할게요 — 학습 계속하기',
    },
  },
};
