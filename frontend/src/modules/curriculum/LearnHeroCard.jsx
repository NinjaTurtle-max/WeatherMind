import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import { ENTRY_MASCOT } from './learnEntry';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 맨 위 **가로 진입 배너**(짙은 남색 밴드).
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 진입 카드·오늘의 목표를
 * 이 배너가 흡수했다. 복습 큐·자유 일일 세션·리그는 경로 **아래 3카드**가 받는다
 * (LearnFooterCards).
 *
 * 배치가 네 번 바뀌었다(2026-08-09, 전부 사용자 지시):
 *   ① 오른쪽 세로 레일 → ② 위쪽 가로 배너 → ③ 다시 세로 레일 → ④ **얇은 가로 배너**.
 * ②에서 배너가 세로 182px을 먹어 노드 지름이 86 → 60px로 줄었던 것이 ③으로
 * 되돌린 이유였다. ④는 시안(사용자 첨부)을 받되 **배너를 2단에서 1단으로 눌러**
 * 그 비용을 줄인 절충이다 — 시안 그대로면 배너+하단 3카드가 세로 364px을 가져가
 * 5유닛 섹션이 아예 들어가지 않는다(사용자가 선택한 안).
 *
 * 그래서 이 파일의 제1 계약은 **한 줄로 끝난다**는 것이다. 여기에 무엇을 더 넣기
 * 전에 경로 트랙의 노드 지름이 얼마나 줄어드는지 재 볼 것 — 지름은 트랙 **높이**만
 * 본다(index.css `--dot`).
 *
 * ⚠️ 바깥을 `<Link>`로 감싸지 않는다. 목표 미설정 상태가 `/me`로 가는 링크라
 * `<a>` 중첩이 된다 — 브라우저가 태그를 쪼개 React 마크업과 실제 DOM이 갈린다.
 * 누를 수 있는 것은 CTA와 (미설정일 때) 목표 링크뿐이다.
 *
 * 마스코트는 **물방울이**(learnEntry.ENTRY_MASCOT). 사이드바 튜터가 /learn에서
 * 같은 캐릭터를 그리므로 그 화면에서는 SideNav가 튜터를 접는다.
 */
export default function LearnHeroCard({ entry, copy, goalTotal, goalDone }) {
  const t = useT();
  const pct = goalTotal ? Math.min(100, Math.round((goalDone / goalTotal) * 100)) : 0;

  return (
    <div
      data-testid="learn-entry"
      data-entry-kind={entry.kind}
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[20px] bg-gradient-to-r from-[#1F3A5F] to-[#16293F] px-5 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
    >
      {/* 제목 열 — 폭이 남으면 여기가 늘어난다(min-w-0으로 긴 유닛명이 줄임표). */}
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="truncate text-[11.5px] font-bold tracking-[0.02em] text-sky-300">
          {copy.eyebrow}
        </p>
        <p className="mt-0.5 truncate text-[21px] font-extrabold leading-tight tracking-[-0.02em] text-white">
          {copy.title}
        </p>
      </div>

      {/* 진도 열 — 시안의 2단(설명 + 진도 바 + 오늘의 목표)을 한 덩이로 눌렀다.
          좁아지면 통째로 접힌다(hidden lg:block): 배너가 두 줄이 되는 순간
          "얇게 간다"는 이 배치의 전제가 깨지기 때문이다. 여기 있는 값은 전부
          아래 경로 카드의 진도 바에도 있어 접혀도 잃는 정보가 없다. */}
      <div className="hidden min-w-0 basis-[300px] lg:block">
        <p className="truncate text-[11.5px] leading-relaxed text-slate-300">
          {t('curriculum.subtitle')}
        </p>
        <div className="mt-1.5 flex items-center gap-2.5">
          <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/15">
            <i className="block h-full rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
          </span>
          {/* 오늘의 목표 — 미설정이어도 **자리를 숨기지 않는다**. 홈이 사라진 뒤로
              목표를 정하는 통로가 이 화면에 없어서, 숨기면 기능째 사라진다
              (2026-08-09 사용자 제보). 대신 내 정보(설정 통로)로 보낸다. */}
          {goalTotal ? (
            <span
              data-testid="learn-goal"
              data-goal-state="set"
              className="flex-none text-[11.5px] font-bold tabular-nums text-slate-300"
            >
              {t('home.goal.title')} {goalDone}/{goalTotal} {t('home.goal.items')}
            </span>
          ) : (
            <Link
              to="/me"
              data-testid="learn-goal"
              data-goal-state="unset"
              className="flex-none text-[11.5px] font-bold text-sky-300 hover:text-sky-200"
            >
              {t('curriculum.goalUnset')}
            </Link>
          )}
        </div>
      </div>

      {/* 마스코트 — 시안대로 CTA 왼쪽에 붙는다. 원형 배경을 깔아 남색 위에서
          캐릭터 실루엣이 뜨게 한다(투명 PNG라 배경 없이 두면 어둡게 묻힌다). */}
      <span className="hidden h-[62px] w-[62px] flex-none place-items-center rounded-full bg-white/10 sm:grid">
        <Mascot name={ENTRY_MASCOT[entry.kind] ?? 'drop'} className="h-[50px] w-[50px]" />
      </span>

      <Link
        to={entry.to}
        data-testid="learn-entry-cta"
        className="flex-none rounded-[14px] bg-sky-500 px-5 py-3 text-center text-[14px] font-extrabold tracking-[-0.01em] text-white shadow-[0_3px_0_#0369A1] transition hover:bg-sky-400"
      >
        {copy.cta}
      </Link>
    </div>
  );
}
