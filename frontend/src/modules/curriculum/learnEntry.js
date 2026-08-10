/**
 * 학습 화면의 진입 1개를 고른다 (R13-01 §2.5).
 *
 * 2026-08-09까지 이 함수는 `modules/home/HomePage.jsx`가 갖고 있었다. 홈 화면을
 * 지우고 학습 화면 하나로 합치면서(사용자 지시) 순수 로직만 여기로 옮겼다 —
 * 화면이 사라져도 "무엇을 눌러야 하는가"의 규칙은 남아야 하고, 스모크가 이
 * 규칙을 화면 없이 직접 단정할 수 있어야 한다.
 *
 * 왜 하나인가: 「바로 시작하기」에 학습·보드·대결·리그 네 칸이 같은 격으로 서 있어서
 * 처음 온 사람은 무엇부터 눌러야 하는지 알 수 없었다(사전 교육 Mo2의 "진입 실패"
 * 신호 그대로 — 뭘 눌러야 할지 모른 채 스크롤). 첫 화면에는 **눌러야 할 것 하나**만
 * 둔다. 나머지 셋은 보조 링크로 내린다.
 *
 * 우선순위 — 위에서부터 처음 맞는 것 하나:
 *   1. unit  진행 중 유닛이 있다  → 이어서 푼다
 *   2. daily 오늘 일일 세션을 아직 안 했다 → 오늘 몫을 시작한다
 *   3. done  둘 다 없다 → 완료 축하
 *
 * "진행 중 유닛"의 판정 근거는 **서버가 준 유닛 status**다. 백엔드
 * `build_curriculum`이 트리 전체에서 잠기지 않은 첫 미클리어 유닛 정확히 1개를
 * `current`로 승격해 내려준다 — 프론트가 진도를 다시 계산하지 않는다(계산하면
 * 선행 잠금·배치 θ 선해제 규칙 사본을 프론트가 갖게 된다). `current`가 없고
 * `unlocked`만 있는 응답(구 서버·부분 트리)도 진행 중으로 본다.
 *
 * "오늘 일일 세션 미발급"의 근거는 `/progress/me`의 `today_answered_count`다.
 * 서버가 answered_at 날짜로 매번 재계산하고 **배치고사는 이미 빼고** 준다.
 * 목표(daily_goal_items)가 설정돼 있으면 목표 도달을, 아니면 "오늘 한 문항이라도
 * 풀었는가"를 완료로 본다. 세션 발급 여부를 직접 알려주는 엔드포인트는 없다 —
 * 있으면 그걸 쓰는 게 맞다(이월 참조).
 */
export const unitStatus = (u) =>
  u.status ?? (u.cleared ? 'cleared' : u.locked ? 'locked' : 'current');

export function pickLearnEntry({ units = [], todayAnswered = 0, dailyGoal = null } = {}) {
  const current =
    units.find((u) => unitStatus(u) === 'current')
    ?? units.find((u) => unitStatus(u) === 'unlocked')
    ?? null;
  // 목적지는 **유닛 플레이**다(`/learn/units/{id}`). 홈 시절에는 `/learn`이었는데
  // 그때는 학습 화면이 별도였다 — 지금은 이 카드가 학습 화면 위에 있어서 `/learn`은
  // 제자리걸음이 된다. id가 없는 응답(구 서버·부분 트리)만 `/learn`으로 떨어뜨린다.
  if (current) {
    return {
      kind: 'unit',
      unit: current,
      to: current.id ? `/learn/units/${current.id}` : '/learn',
    };
  }

  const goal = Number(dailyGoal) > 0 ? Number(dailyGoal) : 0;
  const dailyDone = goal > 0 ? todayAnswered >= goal : todayAnswered > 0;
  if (!dailyDone) return { kind: 'daily', unit: null, to: '/daily' };

  // 완료 축하 — 「지난 유닛 다시 보기」다. `/learn`으로 두면 **제자리걸음**이라
  // 눌러도 아무 일이 없었다(카드가 학습 화면 위로 올라온 뒤로 그렇다. 위 unit
  // 분기가 같은 이유로 이미 고쳐졌는데 여기만 남아 있었다 — 2026-08-09 코드 리뷰).
  // 전 유닛이 클리어된 상태이므로 **마지막으로 깬 유닛**을 다시 열어 주는 것이
  // 문구와도 맞는다. id 없는 응답(구 서버)만 `/learn`으로 떨어진다.
  const lastCleared = [...units].reverse().find((u) => unitStatus(u) === 'cleared') ?? null;
  return {
    kind: 'done',
    unit: lastCleared,
    to: lastCleared?.id ? `/learn/units/${lastCleared.id}` : '/learn',
  };
}

/**
 * 진입 카드의 화자.
 *
 * ⚠️ **학습은 물방울이(drop)다.** 홈 시절에는 태양이(sun)로 적혀 있었는데 그건
 * `Mascot.jsx` 배정표의 보드 담당이라 화면 담당과 어긋났다(2026-08-09 사용자
 * 지적). 사이드바 튜터(SideNav TUTOR_BY_PATH: /learn → drop)와 같은 값이어야
 * 한다 — 두 곳이 갈리면 같은 화면에서 캐릭터가 둘이 된다.
 */
export const ENTRY_MASCOT = { unit: 'drop', daily: 'bolt', done: 'cloud' };

/**
 * **보고 있는 섹션**의 진입 지점 — 경로를 스크롤하면 배너가 이걸 따라간다
 * (2026-08-10 사용자 지시).
 *
 * ⚠️ 제목만 따라가게 하면 안 된다. 배너 CTA가 그대로면 "3섹션 제목 + 1섹션으로
 * 가는 버튼"이 되어, 누른 사람이 엉뚱한 데로 간다. 그래서 목적지도 같이 낸다.
 *
 * 고르는 순서는 pickLearnEntry와 같은 정신이다 — 지금 할 수 있는 것 우선:
 *   진행 중(current) → 열림(unlocked) → 마지막 클리어(다시 보기) → 첫 유닛(잠김).
 * 마지막 경우만 `locked`가 참이고, 그때 CTA는 눌리면 안 된다(눌러도 서버가
 * 403 UNIT_LOCKED로 막는다 — 누르기 전에 알리는 것이 R10의 규칙이다).
 */
export function pickSectionEntry(section) {
  const units = section?.units ?? [];
  const open =
    units.find((u) => unitStatus(u) === 'current')
    ?? units.find((u) => unitStatus(u) === 'unlocked')
    ?? [...units].reverse().find((u) => unitStatus(u) === 'cleared')
    ?? null;
  if (open) {
    return {
      kind: 'unit',
      unit: open,
      to: open.id ? `/learn/units/${open.id}` : '/learn',
      locked: false,
    };
  }
  const first = units[0] ?? null;
  return { kind: 'unit', unit: first, to: '/learn', locked: Boolean(first) };
}
