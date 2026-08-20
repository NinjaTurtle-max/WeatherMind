// 기후 탐정 모듈 전용 리소스(ko) — R13, 대장 CO-N-2.
//
// ⚠️ **최상위 네임스페이스는 `detective` 하나뿐이어야 한다.** core.js가 얕은
// 스프레드(`{...ko, ...boardKo, ...detectiveKo}`)로 병합하므로 여기에 `nav` 같은
// 다른 최상위 키를 두면 ko.js의 그 네임스페이스가 **통째로** 사라진다.
//
// 케이스 본문(제목·단서·가설·해설)은 여기 없다 — 서버가
// database/seed/detective_cases.json에서 내려보내는 **데이터**다. 여기 있는 것은
// 화면 껍데기 문구뿐이다.
export default {
  detective: {
    // 탐구 홈(/explore)의 진입 카드 — 탭을 8개로 늘리지 않기로 한 결과(보고서 ③).
    entry: {
      title: '기후 탐정',
      desc: '두 관측 지점의 자료가 갈린 이유를 단서를 모아 밝혀내요. 정답을 고르기 전에 조사가 먼저예요.',
      inputs: '시계열 자료 · 단서 카드 7장',
      // 🔴 2026-08-20 클라이언트 판정 — 종전 「가상 관측 자료 — 실제 기록이 아니에요」는
      //    **가상이라 현실과 무관하다**로 읽혔다. 사건 자료는 실제로 되풀이되는 날씨를
      //    닮게 지은 것이므로 「재구성」으로 뜻을 옮긴다.
      //    ⚠️ **날짜를 붙이지 않는다**(같은 판정 — 「과거 언제쯤」까지만). 관측 지점도
      //    가상 그대로다 — 값이 구성값이라 지점까지 실제로 적으면 앞뒤가 안 맞는다.
      //    ⚠️ 「관측치를 그대로 썼다」로 읽히면 실패다. 그래서 **재구성**이라 적는다.
      badge: '되풀이된 날씨를 재구성한 자료 — 그날의 관측치는 아니에요',
    },
    list: {
      title: '🔎 기후 탐정',
      subtitle: '실제 관측 자료처럼 구성된 사건 기록을 읽고, 단서를 모아 원인을 밝혀내요.',
      empty: '아직 열린 사건이 없어요',
      emptyBody: '사건 파일이 준비되는 대로 여기에 올라와요. 그동안 탐구 시뮬로 조건을 바꿔 볼 수 있어요.',
      emptyCta: '탐구로 돌아가기',
      loading: '사건 파일을 불러오고 있어요...',
      loadErrorTitle: '사건 파일을 불러오지 못했어요',
      loadErrorBody: '잠시 후 다시 시도해주세요.',
      retry: '다시 시도',
      clueCount: '단서 {count}개',
      minClues: '단서 {count}개 이상 조사 필요',
      open: '수사 시작 →',
      back: '← 탐구',
    },
    play: {
      backToList: '← 사건 목록',
      loading: '사건 자료를 여는 중이에요...',
      notFoundTitle: '사건을 찾을 수 없어요',
      notFoundBody: '주소가 바뀌었거나 사건이 닫혔어요.',
      dataNoteLabel: '자료 안내',
      fictional: '가상 자료',
      region: '관측 지점',
      period: '관측 기간',
      chartsTitle: '① 자료 살펴보기',
      chartsHint: '단서를 열면 그 시점이 차트에 표시돼요.',
      chartAria: '{label} 시계열 그래프',
      cluesTitle: '② 단서 조사하기',
      cluesHint: '카드를 눌러 단서를 하나씩 열어요. {min}개 이상 열어야 추리할 수 있어요.',
      clueLocked: '조사하기',
      clueOpened: '조사 완료',
      clueMarker: '{metric} · {x}',
      progress: '조사한 단서 {opened} / {total}',
      progressAria: '단서 {opened}개를 조사했어요. 추리하려면 {min}개가 필요해요.',
      hypothesesTitle: '③ 추리하기',
      hypothesesHint: '자료와 단서에 가장 잘 맞는 설명을 하나 고르세요.',
      lockedHint: '단서를 {remaining}개 더 조사하면 추리할 수 있어요.',
      submit: '이 추리로 결론짓기',
      submitting: '검토 중...',
      pickFirst: '먼저 가설을 하나 고르세요.',
      resultCorrect: '✅ 사건 해결! 자료가 가리키는 결론이에요.',
      resultPartial: '🟡 방향은 맞아요 — 아직 결론으로 세우기엔 근거가 부족해요.',
      resultIncorrect: '❌ 자료와 맞지 않아요. 단서를 다시 살펴볼까요?',
      verdictCorrect: '해결',
      verdictPartial: '부분 정답',
      verdictIncorrect: '오답',
      supportingTitle: '이 판단이 근거로 삼은 단서',
      solutionTitle: '사건 정리',
      takeawayLabel: '기억할 것',
      nextStepLabel: '더 해보기',
      retry: '다시 추리하기',
      backAfterSolve: '다른 사건 보기 →',
      submitFailed: '제출에 실패했어요. 잠시 후 다시 시도해주세요.',
      notEnoughClues: '단서를 더 조사해야 추리할 수 있어요.',
    },
  },
};
