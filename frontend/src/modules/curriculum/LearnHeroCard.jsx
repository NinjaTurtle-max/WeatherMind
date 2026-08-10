import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import { ENTRY_MASCOT } from './learnEntry';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 **왼쪽 세로 진입 카드**(짙은 남색).
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 진입 카드·오늘의 목표를
 * 이 카드가 흡수했다. 복습 큐·자유 일일 세션은 **오른쪽 열**이 받는다
 * (LearnFooterCards).
 *
 * 배치가 다섯 번 바뀌었다(2026-08-09~10, 전부 사용자 지시):
 *   ① 오른쪽 세로 레일 → ② 위쪽 가로 배너 → ③ 다시 세로 레일 →
 *   ④ 얇은 가로 배너(시안) → ⑤ **왼쪽 세로 카드**.
 * 가로 배너는 세로를 먹어 노드 지름을 깎았다(②에서 86 → 60px. 지름은 트랙
 * **높이**만 본다). ⑤는 그 비용이 0이다 — 카드가 트랙 옆에 서므로 트랙 높이를
 * 한 픽셀도 가져가지 않고, 대신 트랙 **폭**을 나눠 쓴다.
 *
 * ⚠️ 그래서 이 카드에 세로로 무엇을 더 넣는 것은 공짜다. 반대로 **폭을 넓히면**
 * 트랙이 좁아지고, 좁아진 트랙에서는 노드 옆 유닛명 라벨이 먼저 넘친다
 * (PcCurriculumPath의 라벨 폭 참조).
 *
 * ⚠️ 바깥을 `<Link>`로 감싸지 않는다. 목표 미설정 상태가 `/me`로 가는 링크라
 * `<a>` 중첩이 된다 — 브라우저가 태그를 쪼개 React 마크업과 실제 DOM이 갈린다.
 * 누를 수 있는 것은 CTA와 (미설정일 때) 목표 링크뿐이다.
 *
 * 마스코트는 **물방울이**(learnEntry.ENTRY_MASCOT). 사이드바 튜터가 /learn에서
 * 같은 캐릭터를 그리므로 그 화면에서는 SideNav가 튜터를 접는다.
 */
export default function LearnHeroCard({
  entry,
  copy,
  goalTotal,
  goalDone,
  dailyBlocked = false,
  energyBlocked = false,
  regenMin = 1,
}) {
  const t = useT();
  const pct = goalTotal ? Math.min(100, Math.round((goalDone / goalTotal) * 100)) : 0;
  // 구름 0 차단 — **문항 진입 전**에 알린다(R10-01 §3.1). 화면에서 가장 큰 버튼이
  // 살아 있는 채로 429를 받게 두면 R10이 폐지한 "누른 뒤에 알리는" 흐름이 그대로
  // 돌아온다(2026-08-09 코드 리뷰. 경로 노드와 오른쪽 카드는 이미 막고 있었고
  // 여기만 뚫려 있었다 — 홈 시절 카드에서 그대로 옮겨온 구멍이다).
  //   unit·done  유닛 세션은 호출마다 **새 발급**이라 잔량 0이면 항상 429다.
  //   daily      오늘 세션이 살아 있으면 재조회는 200이다("풀던 것을 뺏기지
  //              않는다"). 그래서 energyBlocked가 아니라 dailyBlocked를 본다.
  const ctaBlocked = entry.kind === 'daily' ? dailyBlocked : energyBlocked && entry.to !== '/learn';

  return (
    <div
      data-testid="learn-entry"
      data-entry-kind={entry.kind}
      className="flex h-full flex-col rounded-[20px] bg-gradient-to-b from-[#1F3A5F] to-[#16293F] px-4 pb-4 pt-5 shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
    >
      {/* 마스코트 — 원형 배경을 깔아 남색 위에서 실루엣이 뜨게 한다(투명 PNG라
          배경 없이 두면 어둡게 묻힌다). */}
      <span className="mx-auto grid h-[92px] w-[92px] flex-none place-items-center rounded-full bg-white/10">
        <Mascot name={ENTRY_MASCOT[entry.kind] ?? 'drop'} className="h-[74px] w-[74px]" />
      </span>

      <p className="mt-3.5 break-keep text-center text-[11.5px] font-bold tracking-[0.02em] text-sky-300">
        {copy.eyebrow}
      </p>
      <p className="mt-1 break-keep text-center text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-white">
        {copy.title}
      </p>
      <p className="mt-2 break-keep text-center text-[11.5px] leading-relaxed text-slate-300">
        {t('curriculum.subtitle')}
      </p>

      {ctaBlocked ? (
        <div className="mt-3.5">
          <button
            type="button"
            disabled
            aria-disabled="true"
            data-testid="learn-entry-cta"
            className="block w-full cursor-not-allowed rounded-[14px] bg-white/15 px-4 py-3 text-center text-[14px] font-extrabold tracking-[-0.01em] text-white/50"
          >
            {copy.cta}
          </button>
          <p className="mt-1.5 text-center text-[11px] font-bold text-rose-300">
            {t('curriculum.daily.regen', { min: regenMin })}
          </p>
        </div>
      ) : (
        <Link
          to={entry.to}
          data-testid="learn-entry-cta"
          className="mt-3.5 block rounded-[14px] bg-sky-500 px-4 py-3 text-center text-[14px] font-extrabold tracking-[-0.01em] text-white shadow-[0_3px_0_#0369A1] transition hover:bg-sky-400"
        >
          {copy.cta}
        </Link>
      )}

      {/* 오늘의 목표 — 카드 **바닥**에 붙인다(mt-auto). 카드가 트랙 높이만큼
          늘어나므로 남는 세로는 여기 위로 간다.
          ⚠️ 미설정이어도 **자리를 숨기지 않는다** — 홈이 사라진 뒤로 목표를 정하는
          통로가 이 화면에 없어서, 숨기면 기능째 사라진다(2026-08-09 사용자 제보).
          대신 내 정보(설정 통로)로 보낸다. */}
      {goalTotal ? (
        <div
          className="mt-auto w-full border-t border-white/15 pt-3"
          data-testid="learn-goal"
          data-goal-state="set"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-[11.5px] font-bold text-slate-300">{t('home.goal.title')}</span>
            <span className="ml-auto text-[11.5px] font-bold tabular-nums text-slate-300">
              {goalDone} / {goalTotal} {t('home.goal.items')}
            </span>
          </div>
          <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-white/15">
            <i className="block h-full rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <Link
          to="/me"
          data-testid="learn-goal"
          data-goal-state="unset"
          className="mt-auto flex w-full items-center gap-2 border-t border-white/15 pt-3 text-[11.5px] font-bold text-slate-300"
        >
          {t('home.goal.title')}
          <span className="ml-auto text-sky-300">{t('curriculum.goalUnset')}</span>
        </Link>
      )}
    </div>
  );
}
