import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * PcCurriculumPath — 학습 홈의 PC(데스크톱, md↑) 전용 경로 뷰.
 *
 * 시안 `docs/design/learn_session_mockup.html`의 구현이다. 이전의 4열 스네이크를
 * **세로 S자 경로 + 스크롤**로 교체했다. 모바일 뷰(§CurriculumHome)는 그대로 둔다.
 *
 * 캐릭터(물방울이)는 **좌측 사이드바가 소유한다**(SideNav의 화면별 튜터).
 * 예전에는 이 화면 우측 레일에도 물방울이 카드가 있었는데, 사이드바 튜터가
 * 화면별로 바뀌게 되면서 같은 캐릭터가 한 화면에 둘 떴다 — 여기서 뺐다.
 *
 * 레이아웃 계약(시안 README「검증된 동작 계약」 + 2026-08-13 클라이언트 지시):
 *   - **치수는 고정, 길이는 스크롤.** 노드 지름·간격·진폭이 상수(PATH_*_PX)이고,
 *     칸이 많은 단계는 크기를 잃는 대신 세로로 길어져 스크롤로 흐른다. 트랙만
 *     스크롤되고 페이지는 따라 움직이지 않는다.
 *     ⚠️ 종전 계약은 「한 화면에 한 단계」였고, 지름을 트랙 높이에 n칸 욱여넣어
 *     구했다. 유닛이 237개가 되면서 그 식이 하한에 걸려 노드가 다음 단계 위로
 *     최대 1368px 쏟아졌다 — 그 계산을 걷은 것이 이번 변경이다. 스냅은 단계의
 *     **시작**에 물리는 것까지만 남았다(단계 안에서는 자유 스크롤).
 *   - **노드 좌표를 상수로 박지 않는다.** 가로 흔들림은 노드 인덱스의 주기 사인
 *     하나로 구하고(weave), 연결선은 렌더 후 실측 좌표로 그린다(리사이즈 시 재계산).
 *   - **길은 꺾은선이 아니라 곡선이다**(`curvePath` — 2026-08-13 복원). 노드마다
 *     접선이 수직인 3차 베지에라, 길이 노드를 수직으로 통과했다가 그 사이에서만
 *     좌우로 눕는다. 시안은 처음부터 베지에였고 앱으로 옮기며 `L`로 회귀했던 것을
 *     되돌린 것이다 — 경위와 실측(59° 꺾임)은 `curvePath` 주석이 소유한다.
 *   - **길은 단계 경계를 넘어 이어진다.** 각 단계의 첫·끝 노드에서 위아래로 꼬리를
 *     뻗어, 단계가 나뉘어 있어도 하나의 길로 보이게 한다.
 *   - 완료(파란) 구간은 **전역 인덱스**로 판정한다. 단계별로 따로 계산하면
 *     1단계를 끝내고 2단계로 넘어갈 때 경계에서 길이 끊긴다(실제로 그랬다).
 *
 * 시안에 있으나 여기서 뺀 것 — **대응 API가 없다**:
 *   섹션 부제·예상 소요시간(`SectionOut`은 name과 units뿐) · 섹션 보상 상자 ·
 *   상단 「학습 가이드」·「뱃지 보기」 버튼. 개념 칩은 유닛의 concept_tag에서
 *   파생하므로 실데이터다.
 */
import { conceptLabel, useT } from '../../i18n';

const STATUS_ICON = { cleared: '👑', current: '⭐', unlocked: '🌀', locked: '🔒' };

/* ── 경로의 치수 — **전부 고정 px이고 소유자는 여기 하나다**(2026-08-13 클라이언트
 *    지시: "섹션마다 학습 경로 범위를 정의하지 말고 그냥 간격을 규정하고 S자 또는
 *    굴곡으로 잡고, 유닛마다의 칸을 마우스 포인트 하나에서 하나 반 정도로").
 *
 * 걷어낸 것 — **뷰포트 높이에 n칸을 욱여넣던 계산**:
 *   --dot: max(44px, min(86px, (100cqh - --chrome) / (1.18·--n - 0.18)))
 * 이 식이 있었기 때문에 `--n`(전 섹션 최대 칸 수) · `--chrome`(머리말·칩·진도 바
 * 높이) · `PATH_SIZING_FLOOR`(코스 간 크기 통일) · `PATH_SIZING_CAP`(겹침 방지
 * 상한)이 **전부 그 식 하나를 떠받치는 보정**으로 붙어 있었다. 크기가 고정되면
 * 넷 다 지킬 대상이 없어진다 — 코스가 달라도, 섹션이 몇 칸이어도, 접든 펴든
 * 지름은 `PATH_DOT_PX` 하나다.
 *
 * ⚠️ 걷어낸 계산이 **실제로 무엇을 하고 있었는지**(2026-08-13 1470×801 실측):
 * `--n`이 상한 8에서 끊긴 채 `--dot`은 하한 44px에 눌려, 노드가 트랙 높이를
 * **13칸 226px · 19칸 537px · 35칸 1368px 넘쳐** 다음 단계 위로 흘러내리고 있었다.
 * 넘침이 보이지 않은 이유는 `.wm-stage`의 `container-type: size`가 단계 높이를
 * 내용과 무관하게 고정했기 때문이다(그래서 스크롤도 안 생겼다). 아래 CSS에서
 * 그 선언을 `inline-size`로 내리고 `height: 100%`를 `min-height: 100%`로 바꿨다.
 */

/**
 * 노드 **시각** 지름(px) — "마우스 포인터 하나~하나 반".
 * 표준 화살표 커서가 세로 ≈24px이므로 계약 범위는 24~36px이고 그 가운데를 쓴다.
 * ⚠️ **클릭 표적은 이 값이 아니다** — `PATH_HIT_PX`를 볼 것.
 */
export const PATH_DOT_PX = 32;

/**
 * 노드 **클릭 표적**의 최소 한 변(px) — WCAG 2.1 AA(2.5.5 Target Size)의 44px.
 *
 * 시각 지름을 32px로 줄이면 버튼 상자도 32×32가 되어 표적이 규격 미달이 된다.
 * 그래서 `.wm-dot::before`가 `max(var(--hit), var(--dot))` 크기의 **투명 상자**를
 * 노드 중심에 겹쳐 둔다(보이는 원은 그대로 32px, 눌리는 넓이만 44px).
 * ⚠️ 이 값을 44 밑으로 내리면 `learnPath` 스모크가 운다.
 */
export const PATH_HIT_PX = 44;

/**
 * 노드 **세로 간격**(px). 규정값이지 파생값이 아니다 — 섹션이 길면 크기를 줄이는
 * 것이 아니라 **스크롤**로 흐른다.
 *
 * ⚠️ 계약: `PATH_DOT_PX + PATH_GAP_PX ≥ PATH_HIT_PX`.
 * 세로 피치가 클릭 표적보다 좁으면 위아래 노드의 **투명 표적이 겹쳐** 엉뚱한
 * 유닛이 열린다. 지금 값은 32+22 = 54 ≥ 44(여유 10px)이고, 스모크가 이 부등식을
 * 직접 단정한다.
 */
export const PATH_GAP_PX = 22;

/**
 * S자 **가로 진폭**(px, 중심에서 한쪽). 노드 x = 가운데 + weave(i)·amp.
 *
 * ⚠️ 종전에는 CSS가 `--amp: clamp(56px, 16cqw, 132px)`로 소유했고, StageLine이
 * 꼬리선 x를 구하려고 **이미 그려진 노드에서 역산**했다(등록 안 된 커스텀
 * 프로퍼티라 getComputedStyle이 clamp 토큰을 그대로 돌려줬기 때문). 역산이 안 되는
 * 칸 1개짜리 단계를 위해 CSS 식의 **사본**까지 JS에 두고 있었다. 값이 고정되면
 * 그 세 겹이 전부 없어진다 — CSS가 이 상수를 인라인으로 받고, StageLine은 그냥
 * 임포트한다.
 *
 * 값의 근거: 반주기(4칸 = 216px)에 가로로 2·amp(208px)를 움직여야 기울기가 45°
 * 언저리로 잡힌다. 더 키우면 지그재그가 눕고, 더 줄이면 굴곡이 안 보인다.
 */
export const PATH_AMP_PX = 104;

/**
 * S자 한 주기의 **칸 수**. 8칸(= 432px)마다 왼→오→왼으로 한 번 굽이친다.
 * 섹션마다 i=0에서 위상이 다시 시작하므로 **첫 노드는 늘 가운데**이고, 그래서
 * `justify-content: flex-start`(첫 노드 y 고정)와 짝이 맞는다.
 */
export const PATH_WAVE_PERIOD = 8;

// 단계 경계 너머로 뻗는 길의 꼬리 길이(px).
const TAIL = 90;

/**
 * 길의 **굵기**(px). 소유자는 이 상수 하나이고 두 path(회색·파랑)가 함께 쓴다.
 *
 * ⚠️ 10 → 6(2026-08-13). 10px은 시안(`docs/design/learn_session_mockup.html:142`)이
 * **노드 지름 86px**일 때 고른 값이라 지름의 11.6%였다. 노드가 32px로 줄면서 같은
 * 10px이 **지름의 31%**가 됐고, 길이 노드를 삼켜 구슬을 꿴 리본처럼 읽혔다.
 *
 * 이것은 취향이 아니라 **빠진 일괄 보정 1건**이다: 2026-08-13 축소 때 `LIP`(5→3) ·
 * `HALO`(8→5) · 보드 칩(24→16) · 「시작」 말풍선(34→26)이 전부 다시 재어졌는데
 * 선 굵기만 그 사슬에서 빠져 있었다.
 *
 * 값의 근거: 시안 비율(11.6%)을 그대로 옮기면 3.7px인데, 회색(#E1E8EF)이 흰
 * 배경에서 존재감을 잃기 시작한다(2026-08-13 브라우저 A/B 4px vs 6px). 6px은
 * 지름의 18.75%로, 시안 비율보다 굵되 노드 안쪽 아이콘을 건드리지 않는다.
 */
export const PATH_LINE_PX = 6;

/**
 * 노드 중심들을 잇는 **3차 베지에** path의 `d`를 만든다.
 *
 * 제어점은 두 끝점의 x를 그대로 쓰고 y만 구간 중점에 둔다 —
 *   `C a.x,midY  b.x,midY  b.x,b.y`
 * 그래서 **모든 노드에서 접선이 수직**이다. 길이 노드를 수직으로 통과했다가
 * 그 사이에서만 좌우로 눕는, 「내려가는 길」의 모양이 된다.
 *
 * ⚠️ 이 함수가 있기 전에는 `L`로 잇는 **꺾은선**이었다. 시안
 * (`docs/design/learn_session_mockup.html:529-540`)은 처음부터 베지에였고,
 * 앱으로 옮기는 과정에서 직선으로 회귀했던 것이다 — 취향 차이가 아니라 회귀다.
 * 실측(2026-08-13 1470×801): 마디 회전각이 `0°, ±24°, ±59°`로, 굽이의 극점마다
 * **59° 꺾임**이 서고 그 사이는 회전각 0°인 완전 직선이었다. "직선 → 급격한
 * 팔꿈치 → 직선"이 4칸마다 반복돼 리듬이 아니라 톱니로 읽혔다.
 *
 * 곁가지 효과가 본체만큼 크다: 접선이 수직이라 **진폭·주기를 한 글자도 건드리지
 * 않고** "옆으로 눕는 리본" 인상이 사라진다. 클라이언트가 직접 지시한 형태
 * (S자 · 32px · 고정 간격)가 그대로 유지된다.
 *
 * ⚠️ **`includes('C')`로 이 계약을 지키지 말 것.** `C`는 남긴 채 제어점만 끝점
 * 좌표로 바꾸면 다시 직선이 되는데 그런 단정은 통과한다 — 스모크는 제어점
 * **x가 각 끝점의 x와 같고 y가 구간 중점**임을 직접 잰다.
 *
 * 순수 함수로 뺀 이유는 `blueEndIndex`·`joinK`·`alignScrollTop`과 같다: jsdom에는
 * 레이아웃이 없어 실좌표로는 못 재는데, 여기는 회귀가 눈으로만 잡히는 자리다.
 */
export function curvePath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const my = a.y + (b.y - a.y) / 2;
    d += ` C${a.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  return d;
}

/**
 * 예상 **일수** — 「며칠 걸리는가」(2026-08-12 클라이언트 요구 ⑴).
 *
 * ⚠️ **「하루치」의 정의는 아직 클라이언트 판정 대기다.** 그래서 이 파일은 정의를
 * 고르지 않고 **후보 셋을 전부 구현**해 두고 스위치 한 줄(`EST_DAYS_BASIS`)만
 * 남긴다 — 판정이 오면 값만 갈아끼운다(화면·테스트·서버는 손대지 않는다).
 *
 *   'unitsPerDay'   하루에 유닛 1개(= 하루 한 세션). 2026-08-12 확정 사양
 *                   「하루의 첫 유닛 세션이 곧 데일리 세션」과 결이 같다.
 *   'minutesPerDay' `est_minutes` ÷ 하루 학습 시간(분) 가정.
 *   'itemsPerDay'   섹션 문항 수(유닛 × `UNIT_SESSION_SIZE`) ÷ 하루 문항 수
 *                   (`SESSION_RECIPE` 총합). 지금 시드에서는 `est_minutes`가
 *                   유닛당 4분이라 minutesPerDay(10분)와 **수치가 같아진다** —
 *                   우연이지 같은 산식이 아니다.
 *
 * 가정값을 여기 두는 이유: 서버 `SESSION_RECIPE`·`UNIT_SESSION_SIZE`는 env 노브라
 * 프론트가 읽을 통로가 없다. 판정이 확정되면 그 값을 서버가 내려보내게 바꾸는 것이
 * 다음 단계다(그때는 이 상수가 폴백이 된다).
 */
export const EST_DAYS_BASIS = 'unitsPerDay';
export const EST_DAYS_ASSUMPTION = Object.freeze({
  minutesPerDay: 10, // 하루 학습 시간 가정(분)
  itemsPerDay: 10, // SESSION_RECIPE 총합(live2+new4+review3+board1)
  itemsPerUnit: 4, // UNIT_SESSION_SIZE
});

/** 섹션 → 예상 일수(정수). 근거가 없으면 **null**이고 화면은 아무것도 그리지 않는다. */
export function estDaysOf(section, basis = EST_DAYS_BASIS, assume = EST_DAYS_ASSUMPTION) {
  const units = section?.units?.length ?? 0;
  const minutes = Number(section?.est_minutes) || 0;
  if (basis === 'minutesPerDay') {
    return minutes > 0 ? Math.max(1, Math.ceil(minutes / assume.minutesPerDay)) : null;
  }
  if (basis === 'itemsPerDay') {
    return units > 0
      ? Math.max(1, Math.ceil((units * assume.itemsPerUnit) / assume.itemsPerDay))
      : null;
  }
  return units > 0 ? units : null; // 'unitsPerDay'
}

/**
 * 첫 화면의 스크롤 위치 — **현재 노드가 보이는 자리**를 돌려준다.
 *
 * ⚠️ 종전에는 그냥 `stage.offsetTop`(단계의 맨 위)이었고, 그것으로 충분했다 —
 * 「한 화면에 한 단계」라 단계 맨 위로 가면 그 안의 노드가 전부 보였기 때문이다.
 * **고정 간격으로 바뀌면서 그 전제가 깨졌다**: 19칸 단계는 1069px, 35칸 단계는
 * 1987px인데 트랙은 660px이다. 25번째 유닛에 서 있는 학습자를 단계 맨 위에
 * 떨어뜨리면 자기 ⭐가 두 화면 아래에 있다 — "매번 1단계부터 스크롤하게 두지
 * 않는다"는 이 효과의 목적이 그대로 되살아난다.
 *
 * 그래서 **현재 노드를 세로 가운데**에 두되, 단계 밖으로는 나가지 않게 자른다:
 *   - 아래 한계(`hi`)는 단계의 마지막 화면. 단계가 트랙보다 짧으면 hi < lo가 되어
 *     `Math.max(lo, …)`가 lo로 눌러 준다 — 짧은 단계는 종전과 똑같이 맨 위다
 *     (그리고 그 자리가 스냅이 허용하는 유일한 정지 위치이기도 하다).
 *   - 위 한계(`lo`)는 단계의 맨 위. 앞 단계로 넘어가 버리지 않게 한다.
 *
 * 순수 함수로 뺀 이유: jsdom에는 레이아웃이 없어 실제 스크롤로는 못 재는데,
 * 이 자리는 **세 가지 경우가 갈리는 분기**(짧은 단계·긴 단계의 앞·긴 단계의 끝)라
 * 회귀를 눈으로만 잡을 수 없다. 값은 스모크가 문다.
 */
export function alignScrollTop({ stageTop, stageHeight, nodeTop, nodeHeight, viewport }) {
  const lo = stageTop;
  const hi = Math.max(lo, stageTop + stageHeight - viewport);
  const want = nodeTop + nodeHeight / 2 - viewport / 2;
  return Math.min(hi, Math.max(lo, want));
}

export function resolveStatus(unit) {
  return unit.status ?? (unit.cleared ? 'cleared' : unit.locked ? 'locked' : 'current');
}

/**
 * 파란(완료) 길이 어디까지 오는가 — **전역 노드 인덱스**를 돌려준다.
 * 마지막 완료 노드의 다음 한 칸까지 칠한다("지금 서 있는 자리까지 길이 왔다").
 * 없으면 -1.
 *
 * 단계별로 따로 계산하면 안 된다 — 1단계를 다 끝내고 2단계로 넘어갈 때 2단계는
 * 완료 노드가 0개라 파란 길이 아예 안 그려지고, 경계에서 길이 끊긴다(실제로 그랬다).
 */
export function blueEndIndex(statuses) {
  const last = statuses.lastIndexOf('cleared');
  return last < 0 ? -1 : Math.min(last + 1, statuses.length - 1);
}

/** 전역 blueTo를 한 단계(offset부터 count개) 안에서 칠할 노드 수로 환산한다. */
export function stageDoneCount(blueTo, offset, count) {
  if (blueTo < offset) return 0;
  return Math.min(blueTo - offset + 1, count);
}

/**
 * 노드 위치 → 좌우 흔들림 계수(-1~1). **주기 사인 = S자**(2026-08-13 클라이언트
 * 지시 "S자 또는 굴곡으로 잡고").
 *
 * 인자가 인덱스 하나뿐인 것이 핵심이다 — 섹션의 칸 수를 안 본다. 그래서 3칸이든
 * 35칸이든 굽이의 모양·진폭·주기가 같고, 「섹션마다 범위를 맞추는」 보정이 필요
 * 없어진다.
 *
 * ── 여기 있던 두 세대의 실패를 남긴다(같은 자리로 돌아가지 말 것) ──
 * ① `sin(((i+0.5)/n)·π)`로 **섹션 전체에 곱선을 한 번** 폈던 시절: n이 커지면
 *    인접한 같은 쪽 노드의 sin이 수렴해(13칸에서 0.71·0.89·0.99·0.99·0.89) x 차이가
 *    한 자릿수 px이 됐고, 노드가 세로로 포개졌다.
 * ② 그래서 좌우 **교대**(side = ±1)에 sin 봉투를 씌우고 주기를 8칸으로 끊었다.
 *    겹침은 풀렸지만 굽이가 아니라 톱니가 됐다 — 한 칸 내려갈 때마다 x가 진폭의
 *    두 배(264px)를 건너뛰는데 세로는 52px뿐이라 거의 수평선이었다.
 * ③ 지금: 교대를 없애고 **x 자체를 사인**으로 놓는다. sin(2πi/8) =
 *    0 · .71 · 1 · .71 · 0 · -.71 · -1 · -.71 → 오른쪽으로 부풀었다 왼쪽으로 넘어가는
 *    한 번의 S. ①의 겹침이 되살아나지 않는 이유는 x가 아니라 **y가 고정**이기
 *    때문이다 — 세로 피치가 `PATH_DOT_PX + PATH_GAP_PX`로 상수라 x가 같아져도
 *    (i와 i+8) 54px×8만큼 떨어져 있다.
 */
function weave(i) {
  return Math.sin((2 * Math.PI * i) / PATH_WAVE_PERIOD);
}

/**
 * 단계 경계에서 **두 단계가 함께 쓸** 흔들림 계수 — 위 단계의 마지막 노드와 아래
 * 단계의 첫 노드 중간값. 두 단계가 각자 자기 노드 x로 꼬리를 뻗으면 경계에서 길이
 * 좌우로 튄다(실측: 1→2 경계 11px, 2칸→4칸인 3→4 경계는 185px). 같은 값을 쓰면
 * 두 꼬리가 한 줄로 이어져 보인다.
 * 경계 밖(위/아래 끝)은 0 — 뻗을 이웃이 없다.
 */
export function joinK(stages, aboveIdx, belowIdx) {
  const above = stages[aboveIdx];
  const below = stages[belowIdx];
  if (!above || !below) return 0;
  const aK = weave(above.units.length - 1);
  const bK = weave(0);
  return (aK + bK) / 2;
}

// 입체 턱(아래 그림자)과 현재 노드 후광의 두께. 지름에 비례해 줄인다 —
// 86px 시절의 5px 턱·8px 후광을 32px 노드에 그대로 쓰면 턱이 지름의 1/6이 되어
// 아이콘보다 그림자가 먼저 읽힌다(2026-08-13 축소와 함께 5→3 · 8→5).
const LIP = 3;
const HALO = 5;

function badgeStyle(status) {
  if (status === 'cleared') {
    return { background: 'linear-gradient(160deg, #7DC9F0, #2E9BD6)', color: '#fff', boxShadow: `0 ${LIP}px 0 #1E7FB4` };
  }
  if (status === 'locked') return { background: '#E7EDF3', color: '#A6B6C5', boxShadow: `0 ${LIP}px 0 #D2DCE6` };
  const base = { background: '#0284C7', color: '#fff' };
  return status === 'current'
    ? { ...base, boxShadow: `0 ${LIP}px 0 #0369A1, 0 0 0 ${HALO}px rgba(2,132,199,0.14)` }
    : { ...base, boxShadow: `0 ${LIP}px 0 #0369A1` };
}

/**
 * 한 단계(섹션)의 연결선. 렌더 후 노드 중심을 실측해 폴리라인을 그린다.
 * `doneCount`는 이 단계에서 파란색으로 칠할 **노드 수**(꼬리 포함 판정은 호출부).
 *
 * ⚠️ **부모의 ref를 받아 쓰지 말 것.** React는 커밋 때 자식 → 부모 순으로 ref를
 * 붙이고 layout effect도 그 순서로 돌린다. 그래서 이 컴포넌트의 layout effect가
 * 도는 시점에 부모(.wm-vpath)의 ref는 아직 null이고, 측정이 그냥 빠져나간 뒤
 * 다시 그릴 계기가 없어 **선이 영영 안 그려진다**.
 * 개발 모드에서는 StrictMode가 effect를 두 번 돌려(마운트→언마운트→마운트)
 * 두 번째에 성공하는 바람에 **프로덕션 빌드에서만** 드러났다(실제로 그랬다).
 * 그래서 자기 자신(svg)에 ref를 걸고 `parentElement`로 올라간다 — 자기 DOM은
 * 자기 effect 시점에 반드시 붙어 있다.
 */
function StageLine({ nodeCount, doneCount, leadIn, leadOut, joinInK, joinOutK, layoutKey }) {
  const svgRef = useRef(null);
  const baseRef = useRef(null);
  const doneRef = useRef(null);

  const draw = useCallback(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.height === 0) return;
    const pts = [...el.querySelectorAll('[data-wm-node]')].map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    });
    if (pts.length === 0) return;

    // 위아래 꼬리 — 이웃 단계 쪽으로 뻗어 스냅 경계에서 길이 끊겨 보이지 않게 한다.
    //
    // ⚠️ 꼬리 x를 **자기 노드 x로 두면 경계에서 길이 어긋난다.** 위 단계의 아래꼬리는
    // 자기 마지막 노드 아래로, 아래 단계의 위꼬리는 자기 첫 노드 위로 뻗는데 두 노드의
    // 좌우 흔들림이 다르기 때문이다(실측: 1→2 경계에서 275.2 vs 264.3). 그래서 **두
    // 단계가 같은 x**(이웃 노드와의 중간값)로 뻗게 한다 — joinInK/joinOutK가 그 값의
    // 흔들림 계수이고, 실제 픽셀은 여기서 진폭을 역산해 만든다.
    const center = box.width / 2;
    // 진폭은 **JS 상수 하나가 소유한다**(PATH_AMP_PX). 종전에는 CSS의
    // `clamp(56px, 16cqw, 132px)`가 소유했고 여기서 두 겹으로 되찾아야 했다 —
    // getComputedStyle이 등록 안 된 커스텀 프로퍼티를 clamp 토큰 그대로 돌려줘서
    // (parseFloat → NaN) **이미 그려진 노드에서 역산**했고, 역산이 불가능한
    // 칸 1개짜리 단계(k=0뿐)를 위해 CSS 식의 **사본**을 또 뒀다. 고정값이 되면서
    // 둘 다 지웠다. 값을 바꾸려면 PATH_AMP_PX 한 줄만 고친다.
    const joinX = (k) => center + (Number.isFinite(k) ? k : 0) * PATH_AMP_PX;

    const all = [];
    if (leadIn) all.push({ x: joinX(joinInK), y: -TAIL });
    all.push(...pts);
    if (leadOut) all.push({ x: joinX(joinOutK), y: box.height + TAIL });

    // 파란 구간: 꼬리를 포함해 앞에서부터 몇 점까지인지로 자른다.
    const head = leadIn ? 1 : 0;
    let doneLen = 0;
    if (doneCount >= nodeCount) doneLen = all.length; // 이 단계 전부 + 아래 꼬리
    else if (doneCount > 0) doneLen = head + doneCount;

    // **state가 아니라 DOM에 직접 쓴다.** setState로 두면 좌표를 잰 프레임과 선이
    // 실제로 옮겨 그려지는 프레임이 갈라진다 — 그 한 프레임 동안 노드는 이미
    // 움직였는데 선만 옛 자리에 남아 흔들려 보인다(실측: 소개 스트립을 접었다
    // 펼 때마다 1프레임 13.5px). ResizeObserver 콜백은 레이아웃 뒤·페인트 전에
    // 도므로, 여기서 attribute를 바로 쓰면 같은 프레임에 함께 그려진다.
    // 파란 길을 **앞에서부터 잘라** 다시 그린다. 구간별 베지에라 `curvePath`의
    // 앞부분과 `curvePath(앞부분)`이 기하적으로 같다 — 그래서 파랑이 회색 위에
    // 정확히 겹친다(시안도 같은 성질에 기댄다).
    baseRef.current?.setAttribute('d', curvePath(all));
    doneRef.current?.setAttribute('d', doneLen >= 2 ? curvePath(all.slice(0, doneLen)) : '');
    // layoutKey는 계산에 쓰이지 않는다 — **노드를 움직이는 바깥 변화**(소개 스트립
    // 접기 등)를 의존성으로 들여와, 그 변화와 **같은 커밋**에서 다시 그리게 하는
    // 스위치다. ResizeObserver에만 맡기면 다시 그리는 시점이 브라우저의 콜백 전달
    // 순서에 달리는데, layout effect는 DOM 변경 뒤·페인트 전이 React의 계약이다.
    void layoutKey;
  }, [nodeCount, doneCount, leadIn, leadOut, joinInK, joinOutK, layoutKey]);

  useLayoutEffect(() => {
    draw();
    const el = svgRef.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  return (
    // 두 path는 **항상 그린다** — 조건부로 붙였다 떼면 그 순간 ref가 갈려서
    // draw()가 쓸 대상을 잃는다. 빈 d는 아무것도 그리지 않는다.
    <svg ref={svgRef} className="wm-line" aria-hidden="true">
      <path ref={baseRef} d="" fill="none" stroke="#E1E8EF" strokeWidth={PATH_LINE_PX} strokeLinecap="round" strokeLinejoin="round" />
      <path ref={doneRef} d="" fill="none" stroke="#9AD5F2" strokeWidth={PATH_LINE_PX} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stage({ section, index, total, offset, blueTo, introOpen, onToggleIntro, energyBlocked, regenMin, onOpenUnit, joinInK, joinOutK }) {
  const t = useT();
  const units = section.units;
  const estDays = estDaysOf(section);
  const cleared = units.filter((u) => resolveStatus(u) === 'cleared').length;

  // 세부 주제 칩 — 서버 메타(section_meta.json)의 topics가 1순위다.
  // 없으면 유닛 concept_tag로 떨어진다: concept_tag는 IRT 능력 축이라 6종뿐이고,
  // 한 섹션이 칩 1~2개로 뭉개져 설명이 되지 않는다. 그래서 topics를 따로 둔다.
  const chips =
    section.topics?.length > 0
      ? section.topics.map((tp) => ({ key: tp, label: tp }))
      : [...new Set(units.map((u) => u.concept_tag).filter(Boolean))].map((c) => ({
          key: c,
          label: conceptLabel(t, c),
        }));

  // 이 단계에서 파란색으로 칠할 노드 수 — 전역 blueTo를 단계 로컬로 환산한다.
  const doneCount = stageDoneCount(blueTo, offset, units.length);

  return (
    <section className="wm-stage flex flex-col bg-white px-6 pb-4 pt-4">
      {/* 머리말 한 줄 — 시안(2026-08-09). 종전에는 번호 배지가 붙은 머리말 아래에
          「이 단계에서 배우는 것」 슬레이트 박스가 따로 있었는데, 배너+하단 3카드가
          세로를 가져가면서 그 박스만큼(실측 56px) 노드가 작아졌다. 같은 정보를
          한 줄에 눌러 담고 칩만 아래로 흘린다. */}
      <header className="relative z-[3] flex flex-none items-center gap-3">
        <h3 className="flex-none text-[14px] font-extrabold text-slate-900">
          {t('curriculum.path.sectionEyebrow', { n: index + 1, title: section.section })}
        </h3>
        {/* 부제는 서버 메타(section_meta.json) — 없으면 줄 자체를 그리지 않는다.
            한 줄 머리말이라 제목 옆으로 붙였고, 좁아지면 여기부터 줄어든다
            (min-w-0 + truncate). 숨기지 않는 이유: 화면이 안 읽으면 서버가 메타를
            내려보낼 이유가 없어진다. */}
        {section.subtitle && (
          <p className="min-w-0 truncate text-[11.5px] text-slate-400">{section.subtitle}</p>
        )}
        <span className="flex-none text-[11.5px] font-bold tabular-nums text-slate-400">
          {t('curriculum.sectionDone', { cleared, total: units.length })}
        </span>
        <div className="h-px min-w-[16px] flex-1 bg-slate-200" />
        <button
          type="button"
          onClick={onToggleIntro}
          aria-expanded={introOpen}
          className="flex-none rounded-lg px-1.5 py-0.5 text-[11px] font-extrabold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          {introOpen ? t('curriculum.path.fold') : t('curriculum.path.unfold')}
          <span className={`ml-1 inline-block transition-transform ${introOpen ? '' : '-rotate-90'}`}>⌄</span>
        </button>
      </header>

      {introOpen && chips.length > 0 && (
        <div className="relative z-[3] mt-1.5 flex flex-none flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-extrabold tracking-[0.4px] text-sky-700">
            {t('curriculum.path.introTitle')}
          </span>
          {chips.map((c) => (
            <span key={c.key} className="rounded-full bg-sky-100 px-2 py-[3px] text-[10.5px] font-bold text-sky-700">
              {c.label}
            </span>
          ))}
          {/* 예상 **일수**만 그린다. 「예상 52분」은 2026-08-13 클라이언트 지시로
              걷었다 — 하루 리듬이 「하루에 유닛 하나」인데 분 단위를 나란히 두면
              **한 자리에서 두 가지 리듬을 말하는 꼴**이고, 칩 줄만 길어졌다.
              `est_minutes` 자체는 서버 메타에 남는다(일수 산식의 후보 하나이고
              `test_section_est_minutes`가 유닛 수 파생을 계속 문다).
              근거가 없으면 줄을 안 그린다. 산식 소유자는 `EST_DAYS_BASIS` 한 줄. */}
          {estDays ? (
            <span data-est-days={estDays} className="text-[10.5px] font-bold text-slate-400">
              · {t('curriculum.path.estDays', { days: estDays })}
            </span>
          ) : null}
        </div>
      )}

      {/* 치수 넷을 **JS 상수에서 그대로** 내려준다 — 지름·간격·진폭·클릭 표적.
          종전에는 `--n`(전 섹션 최대 칸 수)과 `--chrome`(머리말·칩·진도 바 높이)을
          넣어 CSS가 뷰포트 높이에서 지름을 **역산**했고, 그 식 하나 때문에
          「섹션마다 범위 맞추기」 보정이 겹겹이 붙었다(2026-08-13 걷어냄).
          지금은 어느 섹션이든 같은 값이고, 칸이 많으면 세로로 흘러 스크롤된다.
          ⚠️ CSS에 폴백값을 두지 않는다 — 소유자가 둘이 되는 순간 한쪽만 고쳐도
          화면이 조용히 안 따라온다(`'135px'` 리터럴로 이미 겪었다). */}
      <div
        className="wm-vpath"
        style={{
          '--dot': `${PATH_DOT_PX}px`,
          '--gap': `${PATH_GAP_PX}px`,
          '--amp': `${PATH_AMP_PX}px`,
          '--hit': `${PATH_HIT_PX}px`,
        }}
      >
        <StageLine
          layoutKey={introOpen}
          joinInK={joinInK}
          joinOutK={joinOutK}
          nodeCount={units.length}
          doneCount={doneCount}
          leadIn={index > 0}
          leadOut={index < total - 1}
        />
        {units.map((unit, i) => {
          const status = resolveStatus(unit);
          const locked = status === 'locked';
          // 선행 잠금(locked)과 자원 부족(energyBlocked)은 **사유가 다르다** —
          // 라벨은 구분해 보여주고 클릭 차단만 함께 묶는다. 모바일 UnitNode와
          // 같은 의미론이어야 한다(넘기지 않으면 구름 0에서 PC만 열린다).
          const blocked = locked || energyBlocked;
          // 배치 θ 선해제(R7-02 S4): 왕관 0인데 열려 있는 유닛
          const openedByPlacement = status === 'unlocked' && (unit.crowns ?? 0) === 0;
          const suffix = locked
            ? t('curriculum.unit.lockedSuffix')
            : energyBlocked
              ? t('curriculum.unit.energySuffix')
              : openedByPlacement
                ? ` (${t('curriculum.unit.placementOpened')})`
                : '';
          return (
            <div key={unit.id} data-wm-node className="wm-node" style={{ '--k': weave(i).toFixed(3) }}>
              {/* 「시작」 말풍선 — 지금 설 자리를 노드 위에 붙인다(시안). 데이터가
                  필요 없는 표시라 여기서 만든다.
                  ⚠️ **위로 솟는 높이가 세로 간격(PATH_GAP_PX = 22px)을 넘으면 안 된다.**
                  넘으면 바로 위 노드를 덮는다 — 노드가 86 → 32px로 작아지면서 간격도
                  22px이 됐고, 종전 치수(offset 9 + 높이 25 = 34px)로는 섹션 중간에
                  서 있는 학습자에게 **11.5px 겹침**이 생겼다(2026-08-13 실측).
                  지금은 offset 5 + 높이 16(leading-none) = 21px ≤ 22px이다.
                  간격을 줄이거나 글자를 키우면 여기부터 다시 잰다. */}
              {status === 'current' && !blocked && (
                <span className="pointer-events-none absolute bottom-[calc(100%+5px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-sky-600 px-2 py-[3px] text-[10px] font-extrabold leading-none text-white shadow-[0_2px_0_#0369A1]">
                  {t('curriculum.path.start')}
                </span>
              )}
              <button
                type="button"
                data-wm-unit
                onClick={() => !blocked && onOpenUnit(unit.id)}
                disabled={blocked}
                // 노드 옆 라벨을 다시 뺐으므로(2026-08-10 사용자 지시) 유닛명은
                // aria-label·title이 유일한 통로다.
                aria-label={`${unit.title}${suffix}`}
                title={
                  locked
                    ? t('curriculum.unit.lockedTitle')
                    : energyBlocked
                      ? t('curriculum.unit.energyTitle', { min: regenMin })
                      : unit.title
                }
                className={`wm-dot relative grid place-items-center rounded-full border-0 p-0 transition focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-sky-700 ${
                  blocked ? 'cursor-not-allowed' : 'hover:translate-y-[3px] active:scale-95'
                } ${!locked && energyBlocked ? 'opacity-60' : ''}`}
                style={badgeStyle(status)}
              >
                {STATUS_ICON[status] ?? '🌀'}
                {/* 보드 칩 — 노드가 86 → 32px이 되면서 24px(h-6) 칩이 지름의 3/4를
                    덮어 정작 상태 아이콘을 가렸다. 16px(h-4)로 줄이고 바깥으로 더
                    내보낸다. 이보다 작게 하면 🧩가 안 읽힌다(2026-08-13 확대 확인). */}
                {unit.kind === 'board' && !locked && (
                  <span
                    className="absolute -right-1.5 -bottom-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] shadow ring-1 ring-slate-200"
                    title={t('curriculum.unit.boardChip')}
                  >
                    🧩
                  </span>
                )}
              </button>

            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function PcCurriculumPath({
  sections,
  onOpenUnit,
  energyBlocked = false,
  regenMin = 1,
  onViewSection = null,
  tabs = null,
}) {
  const t = useT();
  const scrollerRef = useRef(null);
  // 접기는 전 단계에 함께 적용한다 — 단계마다 따로 접게 하면 스크롤할 때마다
  // 다시 접어야 한다.
  const [introOpen, setIntroOpen] = useState(true);
  // 스크롤 힌트의 조건 — 「아래로 더 있는가」다(2026-08-09). 종전에는 「맨
  // 위인가」였다: 힌트가 트랙 가운데 떠 있던 시절에는 처음 한 번만 알려 주면
  // 됐지만, 진도 바 안으로 들어오면서 다음 단계가 남아 있는 내내 자리를
  // 지키는 편이 맞다(그 자리가 비면 바 오른쪽 끝이 그냥 빈다).
  const [hasMore, setHasMore] = useState(true);

  const withUnits = sections.filter((s) => s.units.length > 0);

  // ⚠️ 여기 있던 `sizingN`(전 단계 중 최대 칸 수를 바닥값·상한으로 재단)은 걷었다 —
  // 노드 크기가 고정값이라 「어느 섹션에 맞출 것인가」라는 질문 자체가 없어졌다.
  // 되살리려면 --dot을 뷰포트 높이에서 역산하는 식부터 되살려야 한다.

  // 섹션별 시작 인덱스(전역) — 완료 구간을 경계 너머로 잇기 위해 필요하다.
  const offsets = [];
  let acc = 0;
  withUnits.forEach((s) => {
    offsets.push(acc);
    acc += s.units.length;
  });
  const flat = withUnits.flatMap((s) => s.units);

  const statuses = flat.map(resolveStatus);
  const blueTo = blueEndIndex(statuses);

  const clearedCount = statuses.filter((s) => s === 'cleared').length;
  const currentIdx = statuses.indexOf('current');
  const currentUnit = flat[currentIdx] ?? flat.find((_, i) => statuses[i] === 'unlocked') ?? null;
  const currentSection = withUnits.find((s) => s.units.some((u) => u.id === currentUnit?.id)) ?? null;

  /**
   * 「아래로 더 있는가」를 실제 트랙 치수로 다시 잰다 — **판정은 여기 한 곳뿐**.
   *
   * 종전에는 같은 식이 onScroll과 정렬 effect 두 곳에 복제돼 있었고, 정렬 effect가
   * `currentIdx < 0`에서 early return하는 바람에 **전 유닛을 깬 학습자에게
   * 「스크롤해서 다음 단계」 힌트가 영원히 남았다**(초깃값 true). 스크롤이 불가능한
   * 높이에서는 onScroll도 안 뜨므로 스스로 고쳐지지도 않았다. 창을 줄여 경로가
   * 다 들어오는 경우도 같았다 — 리사이즈는 이 값을 아예 안 봤다.
   */
  const syncHasMore = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 24);
  }, []);

  /**
   * **지금 보고 있는 단계**를 위로 알린다 — 배너 제목이 이걸 따라간다.
   *
   * ⚠️ 종전 식은 `Math.round(scrollTop / clientHeight)`였다. 단계 높이가 전부
   * 트랙 높이와 같다는 전제였는데, **고정 간격으로 바뀌면서 그 전제가 깨졌다** —
   * 이제 단계 높이는 칸 수에 비례하고(3칸 ≈ 한 화면 · 35칸 ≈ 네 화면), 나누기
   * 반올림은 35칸 섹션 하나를 훑는 동안 존재하지도 않는 4·5·6단계를 배너에
   * 올린다. 그래서 **실제 offsetTop을 훑는다**.
   *
   * 판정선은 뷰포트 위에서 35% 지점이다: 다음 단계의 머리말이 화면에 충분히
   * 들어왔을 때 넘어간다(0이면 1px만 스쳐도 바뀌고, 50%면 늦다).
   * (`clientHeight`가 0인 첫 프레임은 건너뛴다.)
   */
  const syncViewed = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !onViewSection || el.clientHeight === 0) return;
    const line = el.scrollTop + el.clientHeight * 0.35;
    let idx = 0;
    // offsetTop은 위치 지정 조상(.wm-track) 기준이고 스크롤에 영향받지 않는다 —
    // 아래 초깃값 정렬(`el.scrollTop = stage.offsetTop`)이 쓰는 것과 같은 좌표계다.
    for (let i = 0; i < el.children.length; i += 1) {
      if (el.children[i].offsetTop <= line) idx = i;
    }
    onViewSection(idx);
  }, [onViewSection]);

  const onScroll = useCallback(() => {
    syncHasMore();
    syncViewed();
  }, [syncHasMore, syncViewed]);

  /**
   * 트랙이 화면 어디서 시작하는지를 재서 CSS로 넘긴다(`--wm-track-top`).
   * `.wm-track`의 높이가 "화면에서 이 값과 셸 아래 여백을 뺀 나머지"이기 때문이다.
   *
   * **상수로 박으면 안 되는 이유**: 트랙 위에 붙는 것이 상황마다 다르다 —
   * 게스트 저장 배너 · 코스 탭(코스 2개 이상) · 구름 소진 경고. 하나만 떠도
   * 트랙이 화면 밖으로 밀린다(실측: 코스 탭 하나에 1440×900이 37px 넘쳤다).
   *
   * 되먹임 없음: 재는 것은 **top**이고 top은 자기 높이와 무관하다(위쪽 형제들만이
   * 정한다). 그래서 높이가 바뀌어 부모가 리사이즈돼도 같은 값이 다시 써질 뿐
   * 값이 진동하지 않는다.
   */
  const wrapRef = useRef(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const apply = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty('--wm-track-top', `${Math.round(top)}px`);
      // 트랙 **밑**은 다시 비었다(2026-08-10) — 복습·자유 세션 카드가 아래 가로
      // 줄에서 **오른쪽 세로 열**로 옮겨 갔다. 그래서 `--wm-track-tail`을 재지
      // 않고 index.css의 기본값(32px = main의 pb-8)에 맡긴다. 잰 값을 남겨 두면
      // 0을 쓰는 것이 아니라 **옆 열의 높이를 아래 여백으로 오해**해 트랙이 그만큼
      // 짧아진다. 트랙 밑에 무언가 다시 붙으면 그때 재서 넣을 것(이 파일 히스토리에
      // 그 코드가 있다).
      // 트랙 높이가 바뀌면 「아래로 더 있는가」도 바뀐다. 여기서 같이 다시 재지
      // 않으면, 창을 줄여 경로가 다 들어오는 순간 힌트가 남은 채로 굳는다
      // (스크롤이 불가능하니 onScroll이 고쳐 주지도 못한다).
      syncHasMore();
    };
    apply();
    window.addEventListener('resize', apply);
    let ro;
    if (typeof ResizeObserver !== 'undefined' && el.parentElement) {
      // 위아래 형제(배너·코스 탭·경고·하단 3카드)가 나타나거나 사라지면
      // 부모 높이가 바뀐다.
      ro = new ResizeObserver(apply);
      ro.observe(el.parentElement);
    }
    return () => {
      window.removeEventListener('resize', apply);
      ro?.disconnect();
    };
    // syncHasMore는 useCallback([])이라 안정적이다 — 마운트 1회 실행 의도는 그대로다.
  }, [syncHasMore]);

  // 현재 **유닛**이 보이는 자리로 초깃값 정렬 — 매번 1단계부터 스크롤하게 두지 않는다.
  // ⚠️ 종전에는 「현재 단계의 맨 위」였다. 단계가 트랙보다 길어질 수 있게 되면서
  //    그것만으로는 부족해졌다(위 `alignScrollTop` 주석에 경위).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 정렬은 현재 유닛이 있을 때만. **힌트 갱신은 그와 무관하게 항상** 한다 —
    // 여기서 같이 early return하면 전 유닛을 깬 학습자에게 힌트가 영원히 남는다.
    if (currentIdx >= 0) {
      let si = 0;
      for (let i = 0; i < offsets.length; i += 1) if (currentIdx >= offsets[i]) si = i;
      const stage = el.children[si];
      if (stage) {
        // 노드 좌표는 rect 차로 구한다 — `offsetTop`은 offsetParent가 `.wm-node`인지
        // `.wm-vpath`인지에 따라 기준이 갈리는데, rect 차는 스크롤 좌표계 하나뿐이다.
        const node = stage.querySelectorAll('[data-wm-node]')[currentIdx - offsets[si]];
        const box = el.getBoundingClientRect();
        const prev = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto'; // 초기 정렬은 애니메이션 없이
        el.scrollTop = node
          ? alignScrollTop({
              stageTop: stage.offsetTop,
              stageHeight: stage.offsetHeight,
              nodeTop: node.getBoundingClientRect().top - box.top + el.scrollTop,
              nodeHeight: node.offsetHeight,
              viewport: el.clientHeight,
            })
          : stage.offsetTop;
        el.style.scrollBehavior = prev;
      }
    }
    syncHasMore();
    // 정렬 직후의 단계도 알린다 — 첫 화면이 1단계가 아니라 **현재 단계**라
    // 여기서 안 알리면 배너만 1단계를 가리킨 채 남는다.
    syncViewed();
    // 트리가 바뀔 때만 다시 맞춘다(스크롤 중 재정렬 금지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, withUnits.length]);

  if (flat.length === 0) return null;

  // pb-6은 뺐다 — main이 이미 pb-8을 갖고 있어, 트랙 아래 여백이 두 겹으로
  // 쌓이면서 그만큼 페이지에 세로 스크롤이 생겼다(실측 28px).
  return (
    <div ref={wrapRef} className="hidden md:block">
      {/* 트랙이 **폭 전체**를 쓴다. 진입 카드가 위쪽 가로 배너로 가면서 옆 열이
          비었고(2026-08-09 시안), 빈 열을 남기면 트랙이 이유 없이 296px 좁아진다. */}
      <div className="grid grid-cols-[minmax(0,1fr)]">
        <div className="wm-track min-w-0 rounded-[20px] bg-white ring-1 ring-slate-200">
          {/* 코스 탭 — **경로 카드 안 맨 위**, 웹 브라우저 탭 꼴(2026-08-13
              클라이언트 지시: "섹션 변경 노드를 학습 경로 란에 넣어, 웹페이지 탭
              노드처럼"). 종전에는 카드 **밖** 위쪽에 알약 꼴로 떠 있어서, 무엇을
              바꾸는 스위치인지(= 이 경로 전체) 화면에서 안 붙어 보였다.
              ⚠️ `.wm-track`의 높이는 `--wm-track-top`(자기 위치 실측)에서 나오므로
              탭이 **안으로 들어와도** 계산이 어긋나지 않는다 — 트랙 자신의 top이
              바뀌지 않기 때문이다. 밖에 두고 높이를 빼는 식으로 만들면 그때부터
              상수 보정이 필요해진다(이 파일이 그 방식으로 겪은 실패가 헤더 주석에
              적혀 있다). */}
          {tabs}
          <div ref={scrollerRef} className="wm-scroller" onScroll={onScroll}>
            {withUnits.map((section, i) => (
              <Stage
                key={section.section}
                section={section}
                index={i}
                total={withUnits.length}
                joinInK={joinK(withUnits, i - 1, i)}
                joinOutK={joinK(withUnits, i, i + 1)}
                offset={offsets[i]}
                blueTo={blueTo}
                introOpen={introOpen}
                onToggleIntro={() => setIntroOpen((v) => !v)}
                energyBlocked={energyBlocked}
                regenMin={regenMin}
                onOpenUnit={onOpenUnit}
              />
            ))}
          </div>

          {/* 트랙 하단 진도 바 — 노드 라벨을 뺀 만큼 "지금 어디"를 여기서 말한다 */}
          <div className="absolute inset-x-0 bottom-0 z-[3] flex items-center gap-2.5 border-t border-slate-200 bg-white/95 px-3.5 py-2 backdrop-blur">
            <span className="text-[11.5px] font-extrabold text-slate-500">
              {t('curriculum.path.progressLabel')}
            </span>
            {currentUnit && (
              <span className="min-w-0 truncate text-[11.5px] font-extrabold text-sky-700">
                {currentSection ? `${currentSection.section} · ` : ''}
                {currentUnit.title}
              </span>
            )}
            <span className="h-[7px] w-[120px] flex-none overflow-hidden rounded-full bg-sky-100">
              <i
                className="block h-full rounded-full bg-sky-600"
                style={{ width: `${Math.round((clearedCount / flat.length) * 100)}%` }}
              />
            </span>
            <span className="flex-none text-[11.5px] font-bold tabular-nums text-slate-500">
              {t('curriculum.path.unitCount', { done: clearedCount, total: flat.length })}
            </span>
            {/* 「이어서 학습하기」 버튼이 있던 자리 — 스크롤 힌트가 대신 선다
                (2026-08-09 사용자 지시). 버튼을 빼도 잃는 통로가 없다: 같은 곳으로
                가는 문이 위 배너 CTA(「이어서 풀기」)와 현재 노드 자체로 둘 더 있어
                한 화면에 같은 목적지가 셋이었다. 힌트는 트랙 가운데에 떠 있었는데
                거기서는 경로를 가렸다. */}
            {hasMore && withUnits.length > 1 && (
              <span
                data-testid="path-scroll-hint"
                className="ml-auto flex-none text-[11.5px] font-bold text-slate-400"
              >
                {t('curriculum.path.scrollHint')}
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

