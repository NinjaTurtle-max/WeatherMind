import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import ReviewQueueCard from '../../components/ReviewQueueCard';
import { ENTRY_MASCOT } from './learnEntry';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 오른쪽 열의 진입 카드 (2026-08-09 사용자 시안).
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 **진입 카드 + 오늘의
 * 목표 + 복습 큐**를 한 장으로 합쳤다. 흰 카드가 8장이라 화면이 지저분하다는
 * 지적에서 나온 통합이다.
 *
 * 왜 오른쪽 열의 **세로** 카드인가: 마스코트가 맨 위에 오고 카드가 세로로 길어야
 * 한다는 요구였는데, 전폭 띠로 두면 그 높이가 화면 위쪽을 통째로 먹어 학습
 * 경로(이 화면의 본체)가 눌린다. 세로 카드를 오른쪽에 세우면 경로가 왼쪽 열을
 * 온전히 쓴다.
 *
 * ⚠️ 가로 이득은 **작다**(1440 실측 780 → 810px, +30). 경로 열은 이미 `1fr`이라
 * 남는 폭을 다 먹고 있어서, 늘리려면 레일 폭(320 → 296)과 간격(20 → 14)을 줄이는
 * 수밖에 없다. 세로 쪽이 실제 이득이다 — 인사·머리말이 빠져 트랙이 화면 위로
 * 올라왔다.
 *
 * 왜 **파란 배경**인가: 나머지가 전부 흰 카드라, 진입만 색을 달리해 "여기를
 * 누르면 된다"를 한눈에 갈라내려는 것이다(사용자 지시).
 *
 * 톤 (2026-08-09, 세 번 고쳐 여기까지 왔다: 짙은 파랑 → 연한 하늘 → **거의 흰색**).
 * 지금은 흰색에 아주 옅은 하늘빛만 얹고, 구분은 **색이 아니라 테두리·여백**이 한다
 * (사용자가 「애플 느낌」이라 부른 방향).
 *   · 면은 조용하게 — 흰색~sky-50, 그림자는 거의 없고 헤어라인 테두리로 경계를 준다.
 *   · 색은 **한 곳에만** — 파란색은 CTA가 독점한다. 나머지는 무채색 위계다
 *     (제목 slate-900 · 본문 slate-500). 색이 여러 곳에 흩어지면 어디를 눌러야
 *     하는지가 다시 흐려진다.
 *   · 라운드를 키우고(20px) 자간을 좁혀(-0.02em) 제목을 큼직하게.
 * ⚠️ 대비 방향이 처음(짙은 파랑·흰 글자)과 **반대**다. 색만 되돌리면 흰 글자가
 * 흰 바탕에 얹혀 사라진다 — 톤을 바꿀 때는 글자·CTA·구분선을 같이 뒤집을 것.
 *
 * ⚠️ **카드 전체를 `<Link>`로 감싸지 않는다**(2026-08-09 구조 변경). 복습 줄이
 * 안으로 들어오면서 카드 안에 링크가 생겼는데, `<a>` 안의 `<a>`는 HTML이 허용하지
 * 않고 브라우저가 태그를 쪼개 버린다(React 마크업과 실제 DOM이 갈린다).
 * 바깥은 div이고 **누를 수 있는 것은 CTA와 복습 링크뿐**이다 — 목표 진행 바처럼
 * 읽기만 하는 자리를 눌러도 아무 일이 없어야 맞기도 하다.
 *
 * 마스코트는 **물방울이**다(learnEntry.ENTRY_MASCOT). 사이드바 튜터가 /learn에서
 * 같은 캐릭터를 그리므로, 이 카드가 뜨는 화면에서는 SideNav가 튜터를 접는다 —
 * 같은 그림이 한 화면에 둘 뜨면 어느 쪽이 말하는 건지 알 수 없다.
 */
export default function LearnHeroCard({ entry, copy, goalTotal, goalDone }) {
  const t = useT();
  const pct = goalTotal ? Math.min(100, Math.round((goalDone / goalTotal) * 100)) : 0;
  const remaining = goalTotal ? Math.max(0, goalTotal - goalDone) : 0;

  return (
    <div
      data-testid="learn-entry"
      data-entry-kind={entry.kind}
      className="group flex flex-1 flex-col items-center rounded-[20px] bg-gradient-to-b from-white to-sky-50 px-5 pb-5 pt-7 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80"
    >
      {/* 정사각 박스 — 폭만 주면 세로가 원본 비율을 따라가고, 캐릭터를 바꾸면
          카드 높이가 통째로 달라진다(가로형 cloud ↔ 세로형 bolt). */}
      <Mascot name={ENTRY_MASCOT[entry.kind] ?? 'drop'} className="h-[104px] w-[104px]" />

      <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {copy.eyebrow}
      </p>
      <p className="mt-1.5 text-center text-[21px] font-extrabold leading-snug tracking-[-0.02em] text-slate-900">
        {copy.title}
      </p>
      {/* break-keep — 카드가 좁아(296px) 기본 줄바꿈이 어절 한가운데를 끊는다.
          보드 실험 카드와 같은 처리다. */}
      <p className="mt-2 break-keep text-center text-[12.5px] leading-relaxed text-slate-500">
        {copy.body}
      </p>

      <Link
        to={entry.to}
        data-testid="learn-entry-cta"
        className="mt-5 w-full rounded-full bg-sky-600 px-4 py-3 text-center text-[14.5px] font-bold tracking-[-0.01em] text-white transition hover:bg-sky-700"
      >
        {copy.cta}
      </Link>

      {/* 복습 — 「이어서 풀기」 바로 밑(2026-08-09 지시). 화면 맨 아래 줄에 있던 것을
          올렸다. due 0건이면 컴포넌트가 스스로 null이라 자리째 빠진다. */}
      <ReviewQueueCard variant="hero" />

      {/* 오늘의 목표.
          ⚠️ **미설정일 때 줄째 숨기지 않는다**(2026-08-09 수정). 한때 숨겼는데
          ("0/0 진행 바는 목표를 못 채운 것처럼 읽힌다"), 홈이 사라진 뒤로는 목표를
          정하는 통로가 이 화면 어디에도 없어서 **목표를 안 정한 사람에게는 자리째
          사라졌다**(사용자 제보 "오늘의 목표가 사라졌어"). 0/0 바를 피하려던 것이
          기능을 감춘 셈이다.
          그래서 자리를 남기고 **설정 통로(내 정보)로 보낸다**. 여기에 3버튼 피커를
          박지 않는 이유(2026-08-09 사용자 결정): 카드가 296px로 좁아 버튼이 눌리고,
          설정은 이 화면의 일이 아니다 — 내 정보가 이미 그 통로를 갖고 있다.
          mt-auto — 튜터 한마디가 위로 올라가면서 남는 높이를 먹는 칸이 없어졌다.
          목표가 그 높이를 받아 카드 **바닥**에 붙는다. */}
      {goalTotal ? (
        <div className="mt-auto w-full border-t border-slate-200/80 pt-4" data-testid="learn-goal" data-goal-state="set">
          <div className="flex items-baseline gap-2">
            <p className="text-[12.5px] font-bold text-slate-700">🎯 {t('home.goal.title')}</p>
            <span className="ml-auto text-[12px] font-bold tabular-nums text-slate-400">{pct}%</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-[30px] font-extrabold tabular-nums tracking-[-0.03em] text-slate-900">{goalDone}</span>
            <span className="text-[13px] font-medium tabular-nums text-slate-400">
              / {goalTotal} {t('home.goal.items')}
            </span>
          </div>
          <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-slate-200/80">
            <i className="block h-full rounded-full bg-sky-600" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
            {remaining > 0 ? t('home.goal.remaining', { n: remaining }) : t('home.goal.done')}
          </p>
        </div>
      ) : (
        <Link
          to="/me"
          className="mt-auto flex w-full items-center gap-2 border-t border-slate-200/80 pt-4 text-left"
          data-testid="learn-goal"
          data-goal-state="unset"
        >
          <span className="text-[12.5px] font-bold text-slate-700">🎯 {t('home.goal.title')}</span>
          <span className="ml-auto text-[12px] font-bold text-sky-600">
            {t('curriculum.goalUnset')}
          </span>
        </Link>
      )}
    </div>
  );
}
