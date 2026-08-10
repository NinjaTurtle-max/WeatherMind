import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * PcCurriculumPath — 학습 홈의 PC(데스크톱, md↑) 전용 경로 뷰.
 *
 * 시안 `docs/design/learn_session_mockup.html`의 구현이다. 이전의 4열 스네이크를
 * **섹션당 한 화면(스크롤 스냅) + 세로 지그재그**로 교체했다. 모바일 뷰
 * (§CurriculumHome)는 그대로 둔다.
 *
 * 캐릭터(물방울이)는 **좌측 사이드바가 소유한다**(SideNav의 화면별 튜터).
 * 예전에는 이 화면 우측 레일에도 물방울이 카드가 있었는데, 사이드바 튜터가
 * 화면별로 바뀌게 되면서 같은 캐릭터가 한 화면에 둘 떴다 — 여기서 뺐다.
 *
 * 레이아웃 계약(시안 README「검증된 동작 계약」):
 *   - 한 화면에 한 단계. 트랙만 스크롤되고 페이지는 따라 움직이지 않는다.
 *   - **노드 좌표를 상수로 박지 않는다.** 섹션마다 노드 수가 달라(2~5) 손으로
 *     찍으면 리듬이 어긋난다. 가로 흔들림은 노드 인덱스 사인으로 구하고,
 *     연결선은 렌더 후 실측 좌표로 그린다(리사이즈 시 다시 그린다).
 *   - **길은 스냅 경계를 넘어 이어진다.** 각 단계의 첫·끝 노드에서 위아래로 꼬리를
 *     뻗어, 한 화면 한 단계로 스냅되면서도 하나의 길로 보이게 한다.
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

// 노드 지름 계산에서 빼는 고정 영역(머리말 + 개념 칩 줄 + 진도 바)의 높이.
// 2026-08-09 210 → 135: 소개 스트립(슬레이트 박스)을 머리말 한 줄로 눌렀다.
// 실측 근거 — 흐름에 있는 크롬(머리말+칩+패딩)이 81px, 여기에 절대배치라
// 흐름에 안 잡히는 진도 바 37px을 더해 118px. 135는 그 위 17px 여유다.
// **접기 상태와 연동하지 않는다** — 접을 때마다 아이콘이 커졌다 작아지면 화면이
// 출렁인다. 스트립을 접으면 경로가 쓸 높이는 늘지만 아이콘은 그대로 두고 여백만
// 늘어난다(2026-08-05 결정).
const CHROME = 135;

/**
 * 노드 지름 계산(`--n`)의 **바닥값** — 코스가 달라도 동그라미 크기가 같게 한다.
 *
 * `--n`은 "이 코스에서 가장 긴 섹션의 칸 수"다(sizingN). 그런데 코스마다 그 값이
 * 다르다 — 날씨와 기후는 4, 기초 과학은 3이다. 화면이 넉넉하면 둘 다 상한(86px)에
 * 걸려 같아 보이지만, 트랙이 짧아지면 갈린다(1440×720 실측: 70px 대 86px).
 * 탭을 옮길 때마다 동그라미가 커졌다 작아지는 것이 그 증상이다.
 *
 * 그래서 **전 코스 통틀어 가장 긴 섹션**을 바닥으로 깐다. 반대 방향(작은 쪽에
 * 맞추기 = 날씨를 3으로)은 불가능하다 — 4칸 섹션이 트랙을 넘쳐 마지막 노드가
 * 잘린다(needed = dot*(1.18n-0.18)+chrome = 600 > 561).
 *
 * ⚠️ 값의 근거는 `database/seed/units.json`이고, 저작이 5칸 섹션을 만들면 여기가
 * 낡는다 — `learnPath` 스모크가 시드를 세어 대조한다(사람이 아니라 테스트가 감시).
 */
export const PATH_SIZING_FLOOR = 4;

// 단계 경계 너머로 뻗는 길의 꼬리 길이(px).
const TAIL = 90;

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
 * 노드 위치 → 좌우 흔들림 계수(-1~1).
 *
 * **단계 안의 인덱스와 단계의 노드 수 둘 다** 필요하다. 전역 인덱스로 계산하면
 * 어느 단계는 노드가 전부 같은 쪽에 몰린다(2칸 섹션이 둘 다 왼쪽으로 갔다).
 * 좌우를 교대시키되 진폭을 사인으로 부풀려, 노드 수와 무관하게 가운데가 가장
 * 벌어지고 양 끝이 안쪽으로 모이는 대칭 지그재그가 된다.
 */
function weave(i, n) {
  if (n <= 1) return 0;
  const side = i % 2 === 0 ? -1 : 1;
  return side * (0.55 + 0.45 * Math.sin(((i + 0.5) / n) * Math.PI));
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
  const aK = weave(above.units.length - 1, above.units.length);
  const bK = weave(0, below.units.length);
  return (aK + bK) / 2;
}

function badgeStyle(status) {
  if (status === 'cleared') {
    return { background: 'linear-gradient(160deg, #7DC9F0, #2E9BD6)', color: '#fff', boxShadow: '0 5px 0 #1E7FB4' };
  }
  if (status === 'locked') return { background: '#E7EDF3', color: '#A6B6C5', boxShadow: '0 5px 0 #D2DCE6' };
  const base = { background: '#0284C7', color: '#fff' };
  return status === 'current'
    ? { ...base, boxShadow: '0 5px 0 #0369A1, 0 0 0 8px rgba(2,132,199,0.14)' }
    : { ...base, boxShadow: '0 5px 0 #0369A1' };
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
    // 진폭은 CSS가 소유한다(`--amp`: clamp(56px, 16cqw, 132px)). 노드 좌표에서
    // 역산하지 않고 **계산된 값을 그대로 읽는다** — 역산은 흔들린 노드가 하나도
    // 없는 단계(칸 1개, k=0뿐)에서 0이 되어, 그 경계만 다시 어긋난다.
    // 진폭(px)은 CSS `--amp`가 정하는데 **읽을 수 없다** — 등록되지 않은 커스텀
    // 프로퍼티라 getComputedStyle이 `clamp(56px, 16cqw, 132px)` 토큰을 그대로
    // 돌려준다(실측: parseFloat → NaN). 그래서 이미 그려진 노드에서 역산한다:
    // 노드 x = 가운데 + k·amp 이므로 k≠0인 노드 하나면 amp가 나온다.
    let amp = 0;
    for (const node of el.querySelectorAll('[data-wm-node]')) {
      const k = parseFloat(node.style.getPropertyValue('--k'));
      if (Number.isFinite(k) && Math.abs(k) > 0.01) {
        const r = node.getBoundingClientRect();
        amp = (r.left + r.width / 2 - box.left - center) / k;
        break;
      }
    }
    // 칸이 하나뿐인 단계는 k=0밖에 없어 역산이 안 된다 — 그때만 CSS 식을 옮겨 쓴다.
    // ⚠️ 아래 수치는 index.css `.wm-vpath { --amp }`의 사본이다(둘을 같이 고칠 것).
    if (amp === 0) amp = Math.min(132, Math.max(56, box.width * 0.16));
    const joinX = (k) => center + (Number.isFinite(k) ? k : 0) * amp;

    const all = [];
    if (leadIn) all.push({ x: joinX(joinInK), y: -TAIL });
    all.push(...pts);
    if (leadOut) all.push({ x: joinX(joinOutK), y: box.height + TAIL });

    const line = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

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
    baseRef.current?.setAttribute('d', line(all));
    doneRef.current?.setAttribute('d', doneLen >= 2 ? line(all.slice(0, doneLen)) : '');
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
      <path ref={baseRef} d="" fill="none" stroke="#E1E8EF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path ref={doneRef} d="" fill="none" stroke="#9AD5F2" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stage({ section, index, total, sizingN, offset, blueTo, introOpen, onToggleIntro, energyBlocked, regenMin, onOpenUnit, joinInK, joinOutK }) {
  const t = useT();
  const units = section.units;
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
          {section.est_minutes ? (
            <span className="text-[10.5px] font-bold text-slate-400">
              · {t('curriculum.path.estMinutes', { min: section.est_minutes })}
            </span>
          ) : null}
        </div>
      )}

      {/* --n은 **이 단계의 칸 수가 아니라 전 단계 중 최대 칸 수**다(sizingN).
          자기 칸 수를 넣으면 3칸 섹션이 5칸 섹션보다 큰 동그라미를 받아, 단계를
          넘길 때마다 아이콘 크기가 들쭉날쭉했다(실측 86px ↔ 58px). 최대값으로
          통일하면 전 단계가 같은 크기를 쓰면서 가장 긴 섹션도 넘치지 않는다
          (--dot 식이 "n칸이 들어가는 크기"를 구하므로 최대 n이 곧 안전한 상한). */}
      <div
        className="wm-vpath"
        style={{ '--n': sizingN, '--chrome': `${CHROME}px` }}
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
            <div key={unit.id} data-wm-node className="wm-node" style={{ '--k': weave(i, units.length).toFixed(3) }}>
              {/* 「시작」 말풍선 — 지금 설 자리를 노드 위에 붙인다(시안). 데이터가
                  필요 없는 표시라 여기서 만든다. */}
              {status === 'current' && !blocked && (
                <span className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-sky-600 px-3 py-1 text-[11px] font-extrabold text-white shadow-[0_3px_0_#0369A1]">
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
                {unit.kind === 'board' && !locked && (
                  <span
                    className="absolute -right-0.5 bottom-0 grid h-6 w-6 place-items-center rounded-full bg-white text-[12px] shadow ring-1 ring-slate-200"
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

export default function PcCurriculumPath({ sections, onOpenUnit, energyBlocked = false, regenMin = 1 }) {
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

  // 노드 크기의 기준 칸 수 — **전 단계 중 최대**. 단계마다 자기 칸 수로 크기를
  // 정하면 아이콘이 단계를 넘길 때마다 커졌다 작아진다. 가장 긴 섹션에 맞춰
  // 통일하면 어느 단계도 넘치지 않는다. 섹션이 없을 때의 1은 0 나눗셈 방지.
  const sizingN = Math.max(PATH_SIZING_FLOOR, ...withUnits.map((s) => s.units.length));

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

  const onScroll = useCallback(() => syncHasMore(), [syncHasMore]);

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

  // 현재 유닛이 있는 단계로 초깃값 정렬 — 매번 1단계부터 스크롤하게 두지 않는다.
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
        const prev = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto'; // 초기 정렬은 애니메이션 없이
        el.scrollTop = stage.offsetTop;
        el.style.scrollBehavior = prev;
      }
    }
    syncHasMore();
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
          <div ref={scrollerRef} className="wm-scroller" onScroll={onScroll}>
            {withUnits.map((section, i) => (
              <Stage
                key={section.section}
                section={section}
                index={i}
                total={withUnits.length}
                sizingN={sizingN}
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

