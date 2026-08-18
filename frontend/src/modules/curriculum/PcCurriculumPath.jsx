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
 *     하나로 구한다(weave).
 *   - **연결선을 그리지 않는다**(2026-08-13). 선행 학습 앱 실측에서 길을 아예
 *     그리지 않는 것이 확인됐고, 그것이 우리 화면과의 여섯 차이 중 **가장 큰 시각
 *     신호**로 판정됐다(관찰표: `docs/Observation_Report_02_Benchmarking.md` §4.6).
 *     진도는 선이 아니라 **노드 상태**가 나른다(👑 완료 · ⭐ 현재 · 🔒 잠금).
 *     ⚠️ 아래 세 계약은 **선을 되살리는 날 함께 되살아난다** — `StageLine`·
 *     `curvePath`·`joinK`가 그 때문에 파일에 남아 있다(경위는 StageLine 주석):
 *       · 길은 꺾은선이 아니라 **곡선**이다(노드마다 접선이 수직인 3차 베지에)
 *       · 길은 **단계 경계를 넘어** 꼬리로 이어진다
 *       · 완료(파란) 구간은 **전역 인덱스**로 판정한다(단계별로 재면 경계에서 끊긴다)
 *   - **길이 옆으로 눕지 않는다** — `PATH_AMP_PX / (PATH_DOT_PX + PATH_GAP_PX) ≤ 0.9`.
 *     이 비율이 1.93이던 것이 「부자연스럽다」의 정체였다(참고 앱 0.82).
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
 * 노드 **시각** 지름(px) — 선행 학습 앱 실측 스케일.
 *
 * ⚠️ **32 → 64(2026-08-13). 「마우스 포인터 하나~하나 반」 지시를 뒤집는 값이라
 * 경위를 남긴다.**
 * 그 지시는 지름이 **44~86px 가변으로 겹치던 시점**에 나왔다 — 겹침을 멈추라는
 * 뜻이 「작게」로 실현된 것이지, 32px 자체가 목표였던 적은 없다. 클라이언트는 그
 * 32px 결과를 **보고 나서** "형태는 좋은데 부자연스럽다" → "선행 학습 앱 경로를
 * 크롬으로 봐라" → "전혀 반영이 안 됐다"를 연속으로 냈다. **나중 지시가 앞
 * 지시를 대체**한 것으로 판정됐고, 참고 화면의 가장 두드러진 특징이 큰 노드다.
 *
 * 값의 근거: 참고 앱 실측 지름 **70px**(관찰표는
 * `docs/Observation_Report_02_Benchmarking.md` §4.6가 소유한다). 64는 그 스케일에
 * 들면서 아이콘이 `0.55 × 64 = 35px`이 되어 🔒·👑·⭐·🌀가 확대 없이 읽힌다 —
 * 32px 시절에는 17.6px이라 판독성이 한계였다.
 *
 * ⚠️ **클릭 표적은 이 값이 아니다** — `PATH_HIT_PX`를 볼 것. 표적은 CSS에서
 * `max(var(--hit), var(--dot))`이라 64 ≥ 44인 지금은 **정확히 같은 64px**이고,
 * 그래서 보이는 원이 곧 표적이다. 종전 주석이 "표적이 노드보다 **작아**"라고
 * 적고 있었는데 거짓이다 — `max()`라 표적이 노드보다 작아지는 일은 없고,
 * 지름을 44 아래로 되돌리면 표적은 44에 멈춘다(노드를 따라 줄지 않는다).
 * 코드 리뷰가 잡았다(2026-08-13).
 */
export const PATH_DOT_PX = 64;

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
 * ⚠️ 계약 ①: `PATH_DOT_PX + PATH_GAP_PX ≥ PATH_HIT_PX`.
 * 세로 피치가 클릭 표적보다 좁으면 위아래 노드의 **투명 표적이 겹쳐** 엉뚱한
 * 유닛이 열린다. 지금 값은 64+22 = 86 ≥ 44이고, 스모크가 이 부등식을 직접 단정한다.
 *
 * ⚠️ 계약 ②: 「시작」 말풍선이 **위로 솟는 높이 ≤ 이 값**. 지금 rise는
 * offset 5 + 글자 10 + 세로 패딩 3×2 = **21px**이라 22에 마진 1px이다.
 *
 * ⚠️ **2026-08-13 판정은 20이었고 22로 유지했다 — 경위를 남긴다.**
 * 20이면 계약 ②가 21 ≤ 20으로 깨진다. 그 계약은 노드 축소 때 말풍선이 위 노드를
 * **11.5px 덮은 실제 사고**(클라이언트 제보)로 생긴 것이라 마진을 0으로 깎지
 * 않는다. 그리고 22가 판정 근거에도 더 맞는다: 판정의 이유가 "피치를 참고 앱
 * 평균에 맞춘다"인데, 실측 평균이 **85.2px**이므로 64+22 = **86**(차 0.8)이
 * 64+20 = 84(차 1.2)보다 가깝다. 진폭/피치도 64/86 = 0.744로 계약(≤0.9) 안이다.
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
 * ⚠️ **104 → 64(2026-08-13).** 종전 값은 "기울기 45° 언저리"를 노렸는데, 그것이
 * 바로 클라이언트가 "부자연스럽다"고 한 것의 정체였다. 실측 대조
 * (`docs/Observation_Report_02_Benchmarking.md` §4.6):
 *
 *   진폭/피치 — 선행 학습 앱 **0.82** · 종전 우리 **1.93**(104/54)
 *
 * 즉 우리 길은 한 칸 내려가는 동안 **2.4배 더 옆으로 눕고** 있었다. 참고 앱의
 * 길은 압도적으로 수직이고(최대 각도 28°) 좌우 흔들림은 곁들임이다.
 *
 * 값의 근거: 64/86 = **0.744**로 참고 비율 0.82 대역에 들고, 노드당 가로 이동이
 * 최대 45px(참고 실측 ±25~45px과 같은 대역), 총 폭 128px(참고 140px)이 된다.
 * ⚠️ **리터럴로 외우지 말 것** — 지켜야 하는 것은 값이 아니라 **비율 ≤ 0.9**이고,
 * 스모크가 `PATH_AMP_PX / (PATH_DOT_PX + PATH_GAP_PX)`로 직접 잰다.
 */
export const PATH_AMP_PX = 64;

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

/**
 * 「아래로 **이 섹션이** 더 있는가」 — 스크롤 힌트의 판정 (대장 §4.13, 2026-08-14)
 *
 * ⚠️ **재는 대상은 스크롤러가 아니라 「펼친 단계」다.** 접기 이후 스크롤러 안에는
 * 펼친 `.wm-stage` 말고 **접힌 줄들**(각 52px)이 함께 산다. `el.scrollHeight`를
 * 그대로 보면 그 줄들까지 「더 있는 것」으로 세어 힌트 문구(「이 섹션 더 보기」)가
 * 거짓이 된다 — 3칸짜리 섹션을 펼치면 정렬이 `scrollTop = stageTop`으로 두는데
 * 기상 코스는 아래에 접힌 줄이 9개(≈468px) 더 있어 판정이 **항상 참**이었다.
 * 맨 끝 섹션을 펼쳤을 때만 우연히 맞았다(`#72` 코드리뷰 medium).
 *
 * 순수 함수로 뺀 이유는 `alignScrollTop`과 같다 — **jsdom에는 레이아웃이 없어
 * 전부 0으로 재므로** 컴포넌트 안에 두면 회귀를 무는 방법이 없다. 실제로 §4.13은
 * 「고쳤지만 계약을 못 세웠다」로 하루 열려 있었고, 그동안 **되돌려도 우는 것이
 * 없었다.** 값은 스모크가 문다.
 *
 * `.wm-stage`가 `min-height: 100%`라 다 들어오는 섹션에서는 `stageHeight`가 정확히
 * `viewport`가 되고, 그때 `scrollTop === stageTop`이면 아래 식이 거짓이 된다.
 *
 * @param slack 바닥 근처를 「더 없음」으로 보는 여유(px). 스크롤이 끝에 닿았을 때
 *   소수점 오차로 힌트가 깜빡이는 것을 막는다.
 */
export function hasMoreBelow({ scrollTop, viewport, stageTop, stageHeight, slack = 24 }) {
  return scrollTop + viewport < stageTop + stageHeight - slack;
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

// 입체 턱(아래 그림자)과 현재 노드 후광의 두께.
//
// 유래: 86px 시절 5px 턱·8px 후광이었고, 지름이 32px으로 줄었을 때 그대로 쓰면
// 턱이 지름의 1/6이 되어 아이콘보다 그림자가 먼저 읽혔다 → 5→3 · 8→5.
//
// ⚠️ **지름은 그 뒤 64px로 되돌아왔는데 이 값들은 32px 시절 그대로다.**
// 상대 두께로 보면 3/64 ≈ 1/21로, 기준으로 삼았던 86px 시절의 5/86 ≈ 1/17보다
// **오히려 얇다.** 「참고 앱의 두툼한 노드 스케일에 맞춘다」가 64px 복귀의 목적이었으므로
// 깊이 단서가 그만큼 미달이다. 비례를 되찾으려면 LIP 4 · HALO 6쯤이 된다.
// 값을 안 바꾼 이유: **시각 판단이라 시안을 아는 담당의 몫**이고, 지금은 배포
// 직전이라 눈으로 확인할 창이 없다. 코드 리뷰가 잡았고(2026-08-13) 다음 판으로
// 넘긴다 — 지금 상태가 「의도」가 아니라 「미처 못 따라온 값」임을 남겨 둔다.
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
 * ⚠️ **2026-08-13부터 마운트되지 않는다 — 지우지 말고 남겨 둔 것이다.**
 *
 * 선행 학습 앱 실측에서 **연결선을 아예 그리지 않는다**는 것이 확인됐고
 * (관찰표: `docs/Observation_Report_02_Benchmarking.md` §4.6), 그것이 우리 화면과의
 * 다섯 가지 차이 중 **가장 큰 시각 신호**로 판정돼 마운트만 걷었다. 진도는 선이
 * 아니라 **노드 상태가 나른다**(👑 완료 · ⭐ 현재 · 🔒 잠금) — 참고 앱과 같은 방식이다.
 *
 * 파일과 `curvePath` export를 남기는 이유: **당일 번복이 실재한다.** 같은 날
 * 시안이 이미 한 번 뒤집혔고(우측 열 B안 → 원복), 오늘 오전에 이 곡선을 복원한
 * 것도 "시안에 있던 것이 앱으로 옮겨지며 사라진" 회귀를 되돌린 작업이었다.
 * 지워 버리면 되살릴 때 같은 발굴을 처음부터 반복해야 한다.
 * 되살리려면 `Stage`에서 `<StageLine …>`을 다시 마운트하고 `joinInK`·`joinOutK`
 * 배선을 되돌리면 된다(`joinK`는 export로 살아 있다).
 *
 * ── 이하 원래 설명 ──
 * 한 단계(섹션)의 연결선. 렌더 후 노드 중심을 실측해 곡선을 그린다.
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

// ⚠️ `offset`·`blueTo`·`joinInK`·`joinOutK`는 **연결선 전용 입력이라 함께 걷었다**
// (2026-08-13). 되살릴 때는 이 넷을 같이 되돌린다 — 파생 함수(`blueEndIndex`·
// `stageDoneCount`·`joinK`)는 export로 살아 있고 스모크가 계속 문다.
/**
 * 접힌 섹션 한 줄 — 머리말 + 가로 진도 바(2026-08-13 클라이언트 확정 「B안」).
 *
 * ⚠️ **`.wm-stage`를 쓰지 않는다.** 그 클래스에는 `min-height: 100%`가 걸려 있어
 * 접힌 줄 **하나가 트랙 한 화면(실측 641px)으로 부푼다** — 접는 의미가 사라진다.
 * 여기는 자기 내용 높이(실측 52px)만 차지한다.
 *
 * 진도 바는 **새로 만들지 않고 트랙 하단 진도 바의 어휘를 그대로 쓴다**
 * (`h-[7px] w-[120px]` 껍데기 + `bg-sky-600` 속). 같은 화면에서 같은 뜻의 막대가
 * 두 가지 모양이면 읽는 사람이 다른 지표로 오해한다.
 *
 * 줄 전체가 버튼이다 — 섹션 전환에 **새 조작 표면을 만들지 않는다**(2026-08-13
 * 확정). 카드 맨 위 코스 탭이 이미 「탭 꼴」을 쓰고 있어서, 섹션 전환까지 탭으로
 * 만들면 같은 카드 안에 탭 줄이 둘이 된다. 줄 높이 52px이라 클릭 표적 44px
 * (WCAG 2.5.5)은 자연히 넘는다 — 노드처럼 별도 표적 상자를 겹칠 필요가 없다.
 */
function CollapsedSectionRow({ section, index, panelId, onOpen }) {
  const t = useT();
  const units = section.units;
  const cleared = units.filter((u) => resolveStatus(u) === 'cleared').length;
  return (
    <button
      type="button"
      data-wm-collapsed
      onClick={onOpen}
      aria-expanded={false}
      // ⚠️ 펼침 패널은 접힌 동안 **마운트되지 않는다**(그것이 이 구조의 목적이다).
      // 그래서 이 id는 지금 화면에 없는 요소를 가리킨다 — 접힘/펼침 패널을 언마운트
      // 하는 disclosure에서는 일반적인 절충이고, 대안(패널을 늘 그려 두고 감추기)은
      // 12,836px을 그대로 두는 것이라 목적과 정면으로 어긋난다.
      aria-controls={panelId}
      className="flex w-full flex-none items-center gap-3 border-b border-slate-100 px-6 py-4 text-left hover:bg-slate-50"
    >
      <span className="flex-none text-[14px] font-extrabold text-slate-900">
        {t('curriculum.path.sectionEyebrow', { n: index + 1, title: section.section })}
      </span>
      {section.subtitle && (
        <span className="min-w-0 truncate text-[11.5px] text-slate-400">{section.subtitle}</span>
      )}
      <span className="h-px min-w-[16px] flex-1 bg-slate-200" />
      <span className="h-[7px] w-[120px] flex-none overflow-hidden rounded-full bg-sky-100">
        <i
          className="block h-full rounded-full bg-sky-600"
          style={{ width: `${units.length > 0 ? Math.round((cleared / units.length) * 100) : 0}%` }}
        />
      </span>
      <span className="flex-none text-[11.5px] font-bold tabular-nums text-slate-500">
        {t('curriculum.sectionDone', { cleared, total: units.length })}
      </span>
    </button>
  );
}

function Stage({ section, index, panelId, introOpen, onToggleIntro, energyBlocked, regenMin, onOpenUnit }) {
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

  // (연결선이 없어지면서 `doneCount = stageDoneCount(blueTo, offset, …)` 계산도
  //  함께 걷었다 — 파란 길이 없으니 칠할 대상이 없다. 2026-08-13)

  return (
    // `tabIndex={-1}` — Tab 순서에는 안 들어가지만 **스크립트로 포커스는 받는다**.
    // 접힌 줄을 눌러 이 패널이 그 자리를 대신할 때 부모가 여기로 포커스를 옮긴다
    // (그 줄이 언마운트되면서 포커스가 `<body>`로 떨어지는 것을 막는다).
    <section
      id={panelId}
      tabIndex={-1}
      className="wm-stage flex flex-col bg-white px-6 pb-4 pt-4 focus:outline-none"
    >
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
        {/* ⚠️ 연결선(`<StageLine …>`)이 있던 자리 — 2026-08-13에 **마운트만** 걷었다.
            선행 학습 앱은 길을 아예 그리지 않고 노드 상태로만 진도를 말한다
            (근거표: `docs/Observation_Report_02_Benchmarking.md` §4.6).
            컴포넌트와 `curvePath`는 파일에 그대로 있다 — 경위는 StageLine 주석이
            소유한다. 되살릴 때는 `joinInK`·`joinOutK` 배선도 함께 되돌릴 것. */}
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
  // 접힌 줄을 눌러 펼친 **직후 한 번만** 포커스를 옮기기 위한 표시. 조건 없이
  // 옮기면 첫 렌더에서 페이지가 포커스를 빼앗아 간다(들어오자마자 경로로 튄다).
  const focusPendingRef = useRef(false);
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
  // (`const blueTo = blueEndIndex(statuses)`가 있던 자리 — 연결선과 함께 걷었다.
  //  `blueEndIndex`는 export로 남아 스모크가 계속 문다. 2026-08-13)

  const clearedCount = statuses.filter((s) => s === 'cleared').length;
  const currentIdx = statuses.indexOf('current');

  /**
   * **펼친 섹션 하나**(2026-08-13 클라이언트 확정 — 아코디언).
   *
   * ⚠️ **`introOpen`을 전용하지 않았다.** 모델이 다르다: `introOpen`은 전 단계에
   * 함께 걸리는 boolean 하나(칩 줄 전용)이고, 여기 필요한 것은 **어느 섹션인가**
   * 라는 인덱스다. 칩 접기는 별개 기능으로 그대로 남는다.
   *
   * 초깃값이 `null`인 이유: 「지금 서 있는 섹션」은 서버 응답(status)에서 나오고
   * 그 값은 렌더마다 바뀔 수 있다. state에 복사해 두면 진도가 나갔을 때 낡은
   * 섹션이 펼쳐진 채 굳는다 — **아직 아무도 안 눌렀으면 현재 섹션을 따라간다.**
   */
  const currentSectionIdx = (() => {
    if (currentIdx < 0) return 0;
    let si = 0;
    for (let i = 0; i < offsets.length; i += 1) if (currentIdx >= offsets[i]) si = i;
    return si;
  })();
  /**
   * ⚠️ **펼침 인덱스는 「어느 섹션 목록에 대한 인덱스인가」와 함께 들고 다닌다.**
   *
   * 종전에는 인덱스만 state에 두고 범위 초과만 잘랐다(`Math.min(openIdx, len-1)`).
   * 그것으로는 **코스 전환이 안 잡힌다** — `CurriculumHome`이 `PcCurriculumPath`를
   * `key` 없이 마운트하고 `CourseSwitcher`를 `tabs`로 **이 안에** 넣기 때문에,
   * 코스를 바꿔도 리마운트가 일어나지 않고 `sections` prop만 갈린다. 그러면 앞
   * 코스에서 눌러 둔 인덱스가 그대로 살아남는다:
   *   기상(10섹션)에서 5섹션을 펼쳐 두고 → 기초과학(3섹션) 탭 →
   *   `min(5, 2) = 2`라 **엉뚱하게 마지막 섹션**이 펼쳐지고, 아래 effect가 그 2를
   *   `onViewSection`으로 올려 배너 제목·CTA까지 잠긴 섹션을 가리켰다.
   * 범위 안이면 클램프가 아예 발화하지 않으므로 「잘랐으니 안전하다」도 거짓이다.
   *
   * 그래서 **목록의 신원(`sectionKey`)이 달라지면 눌러 둔 값을 버린다.** effect로
   * 되돌리지 않고 **렌더 중 파생**으로 처리하는 이유: effect는 한 프레임 늦어서
   * 그 사이 잘못된 `openSection`이 `onViewSection`으로 한 번 새어 나간다.
   */
  // 구분자는 **섹션 이름에 못 들어가는 문자**를 쓴다. 공백으로 이으면
  // ["큰 바람","이 온다"]와 ["큰","바람 이 온다"]가 같은 키가 되어, 서로 다른
  // 목록을 같은 것으로 보고 인덱스를 살려 둔다. 길이도 앞에 붙여 한 번 더 가른다.
  // ⚠️ 이스케이프로 적을 것 — 소스에 생 NUL 바이트를 박으면 화면에서 공백과
  //    구분되지 않아 다음 사람이 읽을 수 없다(실제로 한 번 그렇게 들어갔다).
  const sectionKey = `${withUnits.length}\u0000${withUnits.map((s) => s.section).join('\u0000')}`;
  const [open, setOpen] = useState({ key: null, idx: null });
  const openIdx = open.key === sectionKey ? open.idx : null;
  // 범위 클램프는 **그대로 둔다** — 같은 코스 안에서 섹션이 줄어드는 응답(진도
  // 초기화 등)은 위 신원 비교로는 안 잡힌다. 둘은 다른 사고를 막는다.
  const openSection = Math.min(openIdx ?? currentSectionIdx, Math.max(0, withUnits.length - 1));
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
   *
   * ⚠️ **재는 대상은 스크롤러 전체가 아니라 「펼친 단계」다**(2026-08-13 정정).
   * 접기가 들어오면서 스크롤러 안에 펼친 `.wm-stage` **말고도 접힌 줄들**(각 52px)이
   * 함께 산다. `el.scrollHeight`를 그대로 보면 그 줄들까지 「더 있는 것」으로 세어,
   * 힌트 문구(「이 섹션 더 보기」)가 거짓이 된다:
   *   1섹션(3칸, 트랙에 다 들어옴)을 펼치면 정렬 effect가 `scrollTop = 0`으로 두는데,
   *   기상 코스는 아래에 접힌 줄이 9개(≈468px) 더 있어 `0 + clientHeight <
   *   scrollHeight - 24`가 **항상 참**이다 → 더 볼 것이 없는 섹션에서 힌트가 상주했다.
   *   맨 끝 섹션을 펼쳤을 때만 우연히 맞았다.
   * 물어야 할 것은 「스크롤러가 넘치는가」가 아니라 **「펼친 단계가 화면을 넘치는가」**다.
   * `.wm-stage`는 `min-height: 100%`라 다 들어오는 섹션에서는 높이가 정확히 트랙
   * 높이가 되고, 그때 아래 식이 거짓이 된다.
   */
  const syncHasMore = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const stage = el.querySelector('.wm-stage');
    if (!stage) {
      setHasMore(false);
      return;
    }
    // 단계의 아래끝을 **스크롤 좌표계**로 환산한다 — `offsetTop`은 위치 지정 조상
    // 기준이라 42px 어긋난다(정렬 effect가 같은 이유로 rect 차를 쓴다).
    // 여기는 **재기만** 하고 판정은 `hasMoreBelow`가 소유한다(순수 함수라 스모크가
    // 문다 — 대장 §4.13). 식을 여기에 인라인으로 되돌리면 그 계약이 죽는다.
    const stageTop = stage.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    setHasMore(
      hasMoreBelow({
        scrollTop: el.scrollTop,
        viewport: el.clientHeight,
        stageTop,
        stageHeight: stage.offsetHeight,
      }),
    );
  }, []);

  /**
   * **지금 보고 있는 단계**를 위로 알린다 — 배너 제목과 CTA가 이걸 따라간다.
   *
   * ⚠️ **스크롤에서 유도하던 계산은 걷었다**(2026-08-13). 한 번에 한 섹션만
   * 펼치게 되면서 「보고 있는 섹션」이 **펼친 섹션 그 자체**가 됐다 — 스크롤은
   * 이제 섹션 **안**을 움직일 뿐이라 위치에서 섹션을 되짚을 이유가 없다.
   * 걷어낸 식의 경위를 남긴다(같은 자리로 돌아가지 말 것):
   *   ① `Math.round(scrollTop / clientHeight)` — "단계 높이 = 트랙 높이" 전제.
   *      노드가 고정 크기가 되면서 깨졌고, 35칸 섹션 하나를 훑는 동안 존재하지도
   *      않는 4·5·6단계를 배너에 올렸다.
   *   ② `offsetTop`을 훑어 뷰포트 35% 선과 대는 식 — ①의 후속. 단계가 하나뿐인
   *      지금은 언제나 0을 돌려준다.
   *
   * ⚠️ **제목만 올리면 안 된다** — 배너 CTA가 그대로면 "3섹션 제목 + 1섹션으로
   * 가는 버튼"이 된다. 목적지까지 함께 가는 계약의 소유자는 `learnEntry.js`의
   * `pickSectionEntry`이고 소비자는 `CurriculumHome`이다. 여기는 **인덱스만**
   * 올리며, 그 쌍은 그대로 유지된다.
   */
  useEffect(() => {
    onViewSection?.(openSection);
  }, [openSection, onViewSection]);

  // 스크롤이 알려 주는 것은 이제 「아래로 더 있는가」 하나뿐이다.
  const onScroll = syncHasMore;

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
    // 펼친 섹션은 하나뿐이므로 `.wm-stage`도 하나뿐이다 — 인덱스로 children을
    // 세지 않는다(접힌 줄이 섞여 있어 자리 계산이 두 종류가 된다).
    const stage = el.querySelector('.wm-stage');
    if (stage) {
      const box = el.getBoundingClientRect();
      // ⚠️ 단계의 top도 **rect 차**로 잰다(2026-08-13). 종전에는 `stage.offsetTop`
      // 이었는데 그것은 위치 지정 조상(`.wm-track`) 기준이라 스크롤러 좌표와
      // **42px 어긋나 있었다**(1470×745 실측: 1단계 offsetTop 42 ↔ 참값 0).
      // 아래 nodeTop이 이미 rect 차를 쓰므로 두 입력의 좌표계가 갈려 있었다.
      // rect 차는 스크롤 좌표계 하나뿐이라 둘이 같은 자를 쓴다.
      const stageTop = Math.round(stage.getBoundingClientRect().top - box.top + el.scrollTop);
      // 현재 유닛이 **펼친 섹션 안에** 있을 때만 그 노드로 맞춘다. 다른 섹션을
      // 펼쳐 놓고 보는 중이면 맞출 노드가 화면에 없다 — 그때는 섹션 맨 위다.
      const from = offsets[openSection] ?? 0;
      const count = withUnits[openSection]?.units.length ?? 0;
      const local = currentIdx >= from && currentIdx < from + count ? currentIdx - from : -1;
      const node = local >= 0 ? stage.querySelectorAll('[data-wm-node]')[local] : null;
      el.scrollTop = node
        ? alignScrollTop({
            stageTop,
            stageHeight: stage.offsetHeight,
            nodeTop: node.getBoundingClientRect().top - box.top + el.scrollTop,
            nodeHeight: node.offsetHeight,
            viewport: el.clientHeight,
          })
        : stageTop;
    }
    // **힌트 갱신은 정렬과 무관하게 항상** 한다 — 여기서 같이 early return하면
    // 전 유닛을 깬 학습자에게 힌트가 영원히 남는다.
    syncHasMore();
    // 섹션을 갈아탈 때도 다시 맞춘다(`openSection`) — 안 넣으면 새 섹션을 펼쳐도
    // 스크롤이 앞 섹션에서 서 있던 자리에 그대로 남는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, withUnits.length, openSection]);

  /**
   * 펼친 직후 **새 패널로 포커스를 옮긴다** — 키보드 사용자가 자리를 잃지 않게.
   *
   * 접힌 줄 자체가 버튼이고, 누르는 순간 그 버튼이 `<Stage>`로 **교체(언마운트)**
   * 된다. React는 포커스를 옮겨 주지 않으므로 `document.activeElement`가 `<body>`로
   * 떨어진다 — 4섹션까지 Tab으로 내려가 Enter를 누른 사용자가 **문서 맨 처음으로**
   * 되돌아가고, 패널이 열렸다는 안내도 없다.
   *
   * ⚠️ `preventScroll: true`가 필수다. 위 정렬 effect가 `scrollTop`의 소유자인데,
   * 브라우저 기본 포커스 스크롤이 그 값을 덮어써 정렬이 무효가 된다.
   * ⚠️ 조건 없이 옮기면 안 된다 — 첫 진입에서도 발화해 페이지가 열리자마자
   * 경로로 포커스가 튄다. 그래서 `onOpen`이 세우는 표시를 본다.
   */
  useEffect(() => {
    if (!focusPendingRef.current) return;
    focusPendingRef.current = false;
    scrollerRef.current?.querySelector('.wm-stage')?.focus?.({ preventScroll: true });
  }, [openSection]);

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
          {/* 한 번에 **한 섹션만** 펼친다(2026-08-13 클라이언트 확정). 전 섹션을
              펼쳐 두면 콘텐츠가 12,836px(1470×745 실측)이 되고, 그 길이가
              스크롤 스냅을 부르고 스냅이 상위 섹션을 못 가게 만들었다.
              ⚠️ 접는다고 스크롤이 0이 되지는 **않는다** — 단계 높이가
              `97 + 86 × 유닛수`라 최장 19칸 섹션 혼자 1,731px(트랙의 2.7화면)이다.
              그래서 아래 힌트·`alignScrollTop`·`hasMore`가 전부 그대로 필요하다. */}
          <div ref={scrollerRef} className="wm-scroller" onScroll={onScroll}>
            {withUnits.map((section, i) =>
              i === openSection ? (
                <Stage
                  key={section.section}
                  section={section}
                  index={i}
                  panelId={`wm-stage-${i}`}
                  introOpen={introOpen}
                  onToggleIntro={() => setIntroOpen((v) => !v)}
                  energyBlocked={energyBlocked}
                  regenMin={regenMin}
                  onOpenUnit={onOpenUnit}
                />
              ) : (
                <CollapsedSectionRow
                  key={section.section}
                  section={section}
                  index={i}
                  panelId={`wm-stage-${i}`}
                  onOpen={() => {
                    // 누른 줄이 곧 언마운트되므로 포커스를 새 패널로 옮겨야 한다.
                    // 그 이동을 **사용자 조작일 때만** 하도록 여기서 표시한다.
                    focusPendingRef.current = true;
                    setOpen({ key: sectionKey, idx: i });
                  }}
                />
              ),
            )}
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
            {/* ⚠️ 조건에서 `withUnits.length > 1`을 뺐다(2026-08-13). 그것은
                「스크롤하면 다음 **단계**가 나온다」가 참이던 시절의 조건이다 —
                이제 스크롤은 펼친 섹션 **안**을 움직이므로, 섹션이 하나뿐이어도
                그 섹션이 트랙보다 길면(19칸 = 2.7화면) 힌트가 필요하다.
                판정은 `hasMore` 하나가 소유한다(실제 트랙 치수를 재는 쪽). */}
            {hasMore && (
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

