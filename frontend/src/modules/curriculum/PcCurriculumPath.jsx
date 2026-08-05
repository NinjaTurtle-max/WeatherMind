import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Mascot from '../../components/Mascot';

/**
 * PcCurriculumPath — 학습 홈의 PC(데스크톱, md↑) 전용 경로 뷰.
 *
 * 시안 `docs/design/learn_session_mockup.html`의 구현이다. 이전의 4열 스네이크를
 * **섹션당 한 화면(스크롤 스냅) + 세로 지그재그**로 교체했다. 모바일 뷰
 * (§CurriculumHome)는 그대로 둔다.
 *
 * 캐릭터는 학습 세션 담당인 물방울이다(Mascot). 태양이는 게임 보드로 갔고,
 * 이전 마스코트 「썬더」는 폐기. 이름·칩 문구는 i18n `curriculum.tutor`가 소유한다
 * — 그림만 바꾸고 문구를 놔두면 물방울이 옆에 "썬더"가 뜬다(실제로 그랬다).
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

// 노드 지름 계산에서 빼는 고정 영역(머리말 + 소개 스트립 + 진도 바)의 높이.
// **접기 상태와 연동하지 않는다** — 접을 때마다 아이콘이 커졌다 작아지면 화면이
// 출렁인다. 스트립을 접으면 경로가 쓸 높이는 늘지만 아이콘은 그대로 두고 여백만
// 늘어난다(2026-08-05 결정).
const CHROME = 210;

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
function StageLine({ nodeCount, doneCount, leadIn, leadOut }) {
  const svgRef = useRef(null);
  const [d, setD] = useState({ base: '', done: '' });

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
    const all = [];
    if (leadIn) all.push({ x: pts[0].x, y: -TAIL });
    all.push(...pts);
    if (leadOut) all.push({ x: pts[pts.length - 1].x, y: box.height + TAIL });

    const line = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    // 파란 구간: 꼬리를 포함해 앞에서부터 몇 점까지인지로 자른다.
    const head = leadIn ? 1 : 0;
    let doneLen = 0;
    if (doneCount >= nodeCount) doneLen = all.length; // 이 단계 전부 + 아래 꼬리
    else if (doneCount > 0) doneLen = head + doneCount;

    setD({
      base: line(all),
      done: doneLen >= 2 ? line(all.slice(0, doneLen)) : '',
    });
  }, [nodeCount, doneCount, leadIn, leadOut]);

  useLayoutEffect(() => {
    draw();
    const el = svgRef.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <svg ref={svgRef} className="wm-line" aria-hidden="true">
      <path d={d.base} fill="none" stroke="#E1E8EF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      {d.done && (
        <path d={d.done} fill="none" stroke="#9AD5F2" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function Stage({ section, index, total, offset, blueTo, introOpen, onToggleIntro, energyBlocked, regenMin, onOpenUnit }) {
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
      <header className="relative z-[3] flex flex-none items-center gap-3">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-[9px] bg-sky-100 text-[13px] font-extrabold text-sky-700">
          {index + 1}
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-extrabold text-slate-900">{section.section}</h3>
          {/* 부제는 서버 메타(section_meta.json) — 없으면 줄 자체를 그리지 않는다 */}
          {section.subtitle && (
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{section.subtitle}</p>
          )}
        </div>
        <span className="ml-auto flex-none rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-slate-500 ring-1 ring-slate-200">
          {cleared} / {units.length}
        </span>
      </header>

      <div className="relative z-[3] mt-2 flex-none rounded-2xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-200">
        <button
          type="button"
          onClick={onToggleIntro}
          aria-expanded={introOpen}
          className="absolute right-2 top-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10.5px] font-extrabold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          {introOpen ? t('curriculum.path.fold') : t('curriculum.path.unfold')}
          <span className={`inline-block transition-transform ${introOpen ? '' : '-rotate-90'}`}>⌄</span>
        </button>
        <p className="text-[9.5px] font-extrabold tracking-[0.4px] text-sky-700">
          {t('curriculum.path.introTitle')}
          {section.est_minutes ? (
            <span className="ml-1.5 font-bold text-slate-400">
              · {t('curriculum.path.estMinutes', { min: section.est_minutes })}
            </span>
          ) : null}
        </p>
        {introOpen && chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c.key} className="rounded-full bg-sky-100 px-2 py-[3px] text-[10px] font-bold text-sky-700">
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        className="wm-vpath"
        style={{ '--n': units.length, '--chrome': `${CHROME}px` }}
      >
        <StageLine
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
                onClick={() => !blocked && onOpenUnit(unit.id)}
                disabled={blocked}
                // 노드 밑 라벨을 뺐으므로 유닛명은 aria-label·title이 유일한 통로다.
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
  const [atStart, setAtStart] = useState(true);

  const withUnits = sections.filter((s) => s.units.length > 0);

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

  const onScroll = useCallback((e) => setAtStart(e.currentTarget.scrollTop < 24), []);

  // 현재 유닛이 있는 단계로 초깃값 정렬 — 매번 1단계부터 스크롤하게 두지 않는다.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || currentIdx < 0) return;
    let si = 0;
    for (let i = 0; i < offsets.length; i += 1) if (currentIdx >= offsets[i]) si = i;
    const stage = el.children[si];
    if (!stage) return;
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto'; // 초기 정렬은 애니메이션 없이
    el.scrollTop = stage.offsetTop;
    el.style.scrollBehavior = prev;
    setAtStart(stage.offsetTop < 24);
    // 트리가 바뀔 때만 다시 맞춘다(스크롤 중 재정렬 금지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, withUnits.length]);

  if (flat.length === 0) return null;

  return (
    <div className="hidden pb-6 md:block">
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="wm-track min-w-0 rounded-[20px] bg-white ring-1 ring-slate-200">
          <div ref={scrollerRef} className="wm-scroller" onScroll={onScroll}>
            {withUnits.map((section, i) => (
              <Stage
                key={section.section}
                section={section}
                index={i}
                total={withUnits.length}
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

          {/* 스크롤 힌트 — 오른쪽 위에 두면 단계 진도 칩(n/m)을 가린다.
              진도 바 바로 위, 가운데에 둔다. */}
          {atStart && withUnits.length > 1 && (
            <div className="pointer-events-none absolute bottom-14 left-1/2 z-[4] -translate-x-1/2 rounded-full bg-slate-800/60 px-2.5 py-1 text-[10.5px] font-bold text-white">
              {t('curriculum.path.scrollHint')}
            </div>
          )}

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
            <button
              type="button"
              onClick={() => currentUnit && !energyBlocked && onOpenUnit(currentUnit.id)}
              disabled={!currentUnit || energyBlocked}
              className="ml-auto flex-none rounded-[9px] bg-sky-600 px-3.5 py-1.5 text-[11.5px] font-extrabold text-white shadow-[0_3px_0_#0369A1] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-[0_3px_0_#CBD5E1]"
            >
              {t('curriculum.path.continue')}
            </button>
          </div>
        </div>

        <TutorCard unit={currentUnit} />
      </div>
    </div>
  );
}

function TutorCard({ unit }) {
  const t = useT();
  // 튜터 코멘트 내용(사전형 기상 용어 등)은 아직 미확정 — 지금은 자리표시 문구만.
  const greeting = unit
    ? t('curriculum.tutor.greet', { title: unit.title })
    : t('curriculum.tutor.greetDefault');

  return (
    <div
      // lg 미만에서는 경로 아래로 쌓이므로, 가로로 늘어져 허전해 보이지 않게 폭을 제한한다.
      className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl p-5 lg:max-w-none"
      style={{ background: 'linear-gradient(180deg, #EFF8FE 0%, #F7FBFE 55%, #ffffff 100%)' }}
    >
      <span className="absolute left-4 top-3.5 rounded-full bg-[#0E2A42] px-2.5 py-1 text-[10.5px] font-extrabold text-white">
        {t('curriculum.tutor.chip')}
      </span>
      <div className="mt-8 flex justify-center">
        <Mascot name="drop" className="w-[180px] drop-shadow-lg" />
      </div>
      <div className="relative mt-1 rounded-2xl bg-white p-3 shadow-md">
        <p className="mb-0.5 text-[11px] font-extrabold text-[#0369A1]">{t('curriculum.tutor.name')}</p>
        <p className="text-[13.5px] font-bold leading-snug text-slate-800">{greeting}</p>
      </div>
    </div>
  );
}
