// 과거 예보 모듈 전용 리소스(ko) — MT-30.
//
// ⚠️ **최상위 네임스페이스는 `hindcast` 하나뿐이어야 한다.** core.js가 얕은
// 스프레드로 병합하므로 여기에 `nav` 같은 다른 최상위 키를 두면 ko.js의 그
// 네임스페이스가 **통째로** 사라진다(detective.ko.js와 같은 주의).
//
// 회차 본문(제목·지문·해설·출처)은 여기 없다 — 서버가
// hindcast_service.HINDCAST_CASES에서 내려보내는 **데이터**다. 여기 있는 것은
// 화면 껍데기 문구뿐이다.
//
// ⚠️ 서버도 `disclosure`를 응답에 담지만 **화면은 이 리소스를 쓴다.** 서버 문자열을
// 그대로 그리면 en 모드에서 한국어가 나온다 — MT-28에서 실제로 그 결함을 잡았다
// (존 이름 4종이 서버 값이라 리소스에 넣어도 화면에는 원문이 그려졌다).
// 서버 필드는 API를 직접 보는 심사자용으로 남긴다(다른 청중).
export default {
  hindcast: {
    // 탐구 홈(/explore)의 진입 카드 — 내비 탭을 늘리지 않고 여기 세운다
    // (detective가 세운 선례).
    entry: {
      title: '과거 예보 도전',
      desc: '실제로 있었던 어느 하루로 돌아가 그날의 예보자가 돼요. 평년값만 아는 AI 캐스터보다 정확할 수 있을까요?',
      inputs: '평년값 · 기압계 배경 설명',
      badge: '데모용 고정 날짜 — 실제 공개 기록',
    },
    list: {
      title: '🕰️ 과거 예보 도전',
      heroTitle: '그날의 예보자가 되어 볼까요?',
      subtitle: '실제로 있었던 하루의 관측을 서버가 이미 알고 있어요. 그날의 예보자가 되어 맞혀 보세요.',
      back: '← 탐구',
      loading: '회차를 불러오고 있어요...',
      loadErrorTitle: '회차를 불러오지 못했어요',
      loadErrorBody: '잠시 후 다시 시도해주세요.',
      retry: '다시 시도',
      empty: '아직 열린 회차가 없어요',
      emptyBody: '과거 관측 자료가 준비되는 대로 여기에 올라와요.',
      emptyCta: '탐구로 돌아가기',
      played: '완료',
      open: '예보하기 →',
      review: '결과 다시 보기 →',
      station: '관측 지점 {station}',
      normalLabel: '평년값',
    },
    play: {
      // 판정 뒤 잠긴 입력칸의 한 줄(2026-08-19). ⚠️ **「다시 도전」이라고 쓰지
      // 말 것** — 서버가 회차당 1회라(409 ALREADY_SUBMITTED) 그 말은 거짓이 된다.
      lockedNote: '🔒 제출한 예보예요 — 회차당 한 번만 낼 수 있어요',
      otherCase: '다른 회차 도전하기 →',
      backToList: '← 회차 목록',
      loading: '회차 자료를 여는 중이에요...',
      notFoundTitle: '회차를 찾을 수 없어요',
      notFoundBody: '주소가 바뀌었거나 회차가 닫혔어요.',
      normalTitle: '이 날짜의 평년값',
      normalHint: 'AI 캐스터는 이 평년값을 기준으로 예보해요. 기록적인 날이면 평년값은 크게 틀려요.',
      tempLabel: '최고기온 (℃)',
      rainLabel: '강수확률 (%)',
      submit: '예보 제출',
      submitting: '채점 중...',
      alreadyTitle: '이미 예보한 회차예요',
      alreadyBody: '회차마다 한 번만 예보할 수 있어요. 아래에서 지난 결과를 확인하세요.',
      invalidBody: '기온은 -60~60℃, 강수확률은 0~100% 사이여야 해요.',
      errorTitle: '제출하지 못했어요',
    },
    result: {
      title: '판정 결과',
      you: '나의 예보',
      caster: 'AI 캐스터',
      actual: '실제 관측',
      score: '정확도',
      win: '🎉 캐스터를 이겼어요!',
      lose: '아쉬워요 — 캐스터가 더 정확했어요',
      draw: '무승부예요',
      rained: '비 옴',
      noRain: '비 안 옴',
      rainfall: '일강수량 {mm}mm',
      explanationTitle: '무슨 일이 있었나',
      sourcesTitle: '이 값의 출처',
      sourceTemp: '기온',
      sourceRain: '강수',
    },
    // 「데모용 고정 날짜」 고지 — 화면이 이 사실을 숨기지 않는다.
    disclosure: {
      label: '자료 안내',
      body: '과거 관측을 서버에 적재하는 경로가 아직 없어, 공개 기록으로 검증된 고정 날짜만 제공하는 데모예요. 각 값의 출처는 결과 화면에 함께 표시돼요.',
      short: '데모용 고정 날짜',
    },
    history: {
      title: '내 과거 예보 기록',
      empty: '아직 도전한 회차가 없어요.',
    },
  },
};
