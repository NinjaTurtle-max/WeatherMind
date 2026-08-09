import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import RegionPicker from '../../components/RegionPicker';
import ReviewQueueCard from '../../components/ReviewQueueCard';
import { ENTRY_MASCOT } from './learnEntry';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 오른쪽 **세로 레일**.
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 진입 카드·오늘의 목표·
 * 복습 큐·자유 일일 세션·학습 지역을 이 한 장이 흡수했다. 흰 카드가 8장이라
 * 화면이 지저분하다는 지적에서 나온 통합이다.
 *
 * 배치가 세 번 바뀌었다(2026-08-09, 전부 사용자 지시):
 *   ① 오른쪽 세로 레일 → ② 위쪽 가로 배너(시안 1c) → ③ **다시 세로 레일**.
 * ②는 트랙 폭을 810 → 1120px로 넓혔지만 세로를 182px 가져가 노드 지름이
 * 86 → 60px로 줄었다(지름은 트랙 **높이**만 본다). ③으로 돌아오면서 그 반대다 —
 * 폭은 810px로 좁아지고 노드가 다시 커진다.
 *
 * 카드가 세로로 길어지면 남는 여백이 생기는데(②로 가기 전 110px), 이번에는
 * **학습 설명을 튜터가 말하는 말풍선**이 그 자리를 채운다(사용자 지시).
 * 그래서 페이지 머리말(🎓 학습 + 설명)은 없앴다 — 같은 문장이 화면에 두 벌이면
 * 튜터가 읽어 주는 의미가 사라진다. 문구는 `curriculum.subtitle` 그대로다.
 *
 * 톤: 흰색~sky-50에 헤어라인 테두리. 파란색은 **CTA가 독점**하고 나머지는 무채색
 * 위계다(제목 slate-900 · 본문 slate-500).
 *
 * 남는 세로 여백은 **한 곳에 몰지 않고 이음매마다 나눈다**(사용자 지시 "여백 없이
 * 꽉 차게"). 바닥에 `mt-auto` 하나만 두면 그 슬랙이 전부 목표 위에 고여 실측
 * 170px 구멍이 났다. 플렉스는 **auto 마진이 여러 개면 남는 공간을 똑같이 나눠
 * 갖는다** — 복습·자유 세션·목표 세 이음매에 걸어 3등분한다. 공간이 없거나
 * 모자라면 auto 마진은 0으로 접히므로 좁은 화면에서 넘치지 않는다
 * (`justify-between`은 이 경우 넘친다 — 그래서 안 쓴다).
 *
 * ⚠️ 바깥을 `<Link>`로 감싸지 않는다. 안에 복습·자유 세션 링크와 지역 픽커
 * (버튼)가 있어 `<a>` 중첩·버튼 중첩이 된다 — 브라우저가 태그를 쪼개 React
 * 마크업과 실제 DOM이 갈린다. 누를 수 있는 것은 CTA·복습·세션·지역뿐이다.
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

  return (
    <div
      data-testid="learn-entry"
      data-entry-kind={entry.kind}
      className="flex flex-1 flex-col items-center rounded-[20px] bg-gradient-to-b from-white to-sky-50 px-4 pb-4 pt-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80"
    >
      {/* 정사각 박스 — 폭만 주면 세로가 원본 비율을 따라가고, 캐릭터를 바꾸면
          카드 높이가 통째로 달라진다(가로형 cloud ↔ 세로형 bolt). */}
      <Mascot name={ENTRY_MASCOT[entry.kind] ?? 'drop'} className="h-[112px] w-[112px]" />

      {/* 튜터 말풍선 — 페이지 머리말에 있던 학습 설명을 여기로 옮겼다(사용자 지시).
          꼬리는 **위**(마스코트)를 향한다. 아래로 두면 밑의 유닛 제목이 말하는
          것처럼 읽힌다.
          줄바꿈 위치는 리소스 값이 소유한다(`whitespace-pre-line`) — 자동 줄바꿈은
          카드 폭이 조금만 달라져도 어색한 데서 끊긴다. `break-keep`은 그래도 남긴다:
          en처럼 개행이 없는 값은 여전히 자동으로 접히고, 그때 한국어 단어 중간이
          갈라지지 않아야 한다. */}
      <p
        data-testid="learn-tutor-line"
        className="relative mt-2.5 whitespace-pre-line break-keep rounded-2xl bg-white px-3 py-2.5 text-center text-[13.5px] font-medium leading-relaxed text-slate-600 ring-1 ring-slate-200/80"
      >
        <span
          aria-hidden="true"
          className="absolute -top-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-l border-t border-slate-200/80 bg-white"
        />
        {t('curriculum.subtitle')}
      </p>

      <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {copy.eyebrow}
      </p>
      <p className="mt-1 break-keep text-center text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-slate-900">
        {copy.title}
      </p>
      <p className="mt-1.5 break-keep text-center text-[12px] leading-relaxed text-slate-500">
        {copy.body}
      </p>

      <Link
        to={entry.to}
        data-testid="learn-entry-cta"
        className="mt-3.5 w-full rounded-full bg-sky-600 px-4 py-2.5 text-center text-[14px] font-bold tracking-[-0.01em] text-white transition hover:bg-sky-700"
      >
        {copy.cta}
      </Link>

      {/* 복습 — due 0건이면 컴포넌트가 스스로 null이라 자리째 빠진다.
          그래서 감싼 div가 **빈 요소**가 되고, 그때는 `empty:mt-0`으로 자기 몫의
          여백까지 반납한다(비어 있는데 간격만 남으면 위아래가 벌어진다). */}
      <div className="mt-auto w-full empty:mt-0">
        <ReviewQueueCard variant="hero" />
      </div>

      {/* 자유 일일 세션 — 카드가 아니라 한 줄이다. 카드로 두면 위 CTA와 무게가
          비슷해져 "무엇을 누를지 모름"이 돌아온다(§2.5).

          상태가 **셋**이다(둘로 줄이면 안 된다 — 실제로 줄였다가 스모크가 잡았다):
            dailyBlocked  잔량 0 + 오늘 세션 없음 → 발급이 429로 막힌다.
                          **진짜 disabled 버튼**이어야 한다: 회색 링크는 눌리고,
                          누르면 서버가 막는다(R10이 폐지한 흐름).
            energyBlocked 잔량 0인데 **오늘 세션이 살아 있다** → 재조회는 200이다
                          ("풀던 것을 뺏기지 않는다" 불변식). 링크로 남기고
                          문구를 「풀던 세션 이어서 풀기」로 바꾼다.
            그 외          평소. */}
      <div
        data-testid="learn-secondary"
        className="mt-auto w-full border-t border-slate-200/80 pt-3 text-[11.5px] text-slate-400"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{t('curriculum.daily.title')}</span>
          <span className="ml-auto">
            <RegionPicker />
          </span>
        </div>
        {dailyBlocked ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="cursor-not-allowed font-bold text-slate-300"
            >
              {t('curriculum.daily.cta')}
            </button>
            <span className="text-[11px] font-bold text-rose-500">
              {t('curriculum.daily.regen', { min: regenMin })}
            </span>
          </div>
        ) : (
          <div className="mt-1.5">
            <Link to="/daily" className="font-bold text-sky-600 hover:text-sky-700">
              {energyBlocked ? t('curriculum.daily.resume') : t('curriculum.daily.cta')}
            </Link>
            {energyBlocked && (
              <span className="ml-2 text-[11px] font-bold text-rose-500">
                {t('curriculum.daily.regenResume', { min: regenMin })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 오늘의 목표 — 카드 **바닥**에 붙인다(mt-auto). 남는 높이가 있으면 위
          내용과 목표 사이로 가고, 없으면 그냥 이어 붙는다.
          ⚠️ 미설정이어도 **자리를 숨기지 않는다** — 홈이 사라진 뒤로 목표를 정하는
          통로가 이 화면에 없어서, 숨기면 기능째 사라진다(2026-08-09 사용자 제보).
          대신 내 정보(설정 통로)로 보낸다. */}
      {goalTotal ? (
        <div
          className="mt-auto w-full border-t border-slate-200/80 pt-3"
          data-testid="learn-goal"
          data-goal-state="set"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-bold text-slate-500">{t('home.goal.title')}</span>
            <span className="ml-auto text-[12px] font-bold tabular-nums text-slate-500">
              {goalDone} / {goalTotal} {t('home.goal.items')}
            </span>
          </div>
          <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-slate-200/80">
            <i className="block h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <Link
          to="/me"
          data-testid="learn-goal"
          data-goal-state="unset"
          className="mt-auto flex w-full items-center gap-2 border-t border-slate-200/80 pt-3 text-[12px] font-bold text-slate-500"
        >
          {t('home.goal.title')}
          <span className="ml-auto text-sky-600">{t('curriculum.goalUnset')}</span>
        </Link>
      )}
    </div>
  );
}
