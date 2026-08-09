import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import { ENTRY_MASCOT } from './learnEntry';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 오른쪽 열의 진입 카드 (2026-08-09 사용자 시안).
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 **진입 카드 + 오늘의
 * 목표**를 한 장으로 합쳤다. 흰 카드가 8장이라 화면이 지저분하다는 지적에서
 * 나온 통합이다.
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
 * 누르면 된다"를 한눈에 갈라내려는 것이다(사용자 지시). 그래서 이 카드 안의
 * 대비는 흰 바탕 기준이 아니라 파란 바탕 기준으로 잡혀 있다 — 본문 글자는
 * white/80, CTA는 흰 채움에 sky-700 글자다.
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
    <Link
      to={entry.to}
      data-testid="learn-entry"
      data-entry-kind={entry.kind}
      // flex-1 + mt-auto(아래 목표 블록) — 레일이 트랙 높이만큼 늘어나면 카드도
      // 같이 늘고, 남는 높이는 마스코트와 목표 **사이**로 간다. 목표를 위로
      // 끌어올리면 카드 아래가 비어 "덜 채운 카드"로 보인다.
      className="group flex flex-1 flex-col items-center rounded-[18px] bg-gradient-to-b from-sky-400 via-sky-600 to-sky-800 px-5 pb-5 pt-6 text-white shadow-lg shadow-sky-600/25 transition hover:shadow-xl hover:shadow-sky-600/35"
    >
      {/* 정사각 박스 — 폭만 주면 세로가 원본 비율을 따라가고, 캐릭터를 바꾸면
          카드 높이가 통째로 달라진다(가로형 cloud ↔ 세로형 bolt). */}
      <Mascot name={ENTRY_MASCOT[entry.kind] ?? 'drop'} className="h-[104px] w-[104px]" />

      <p className="mt-3 text-[11px] font-extrabold uppercase tracking-[0.1em] text-white/70">
        {copy.eyebrow}
      </p>
      <p className="mt-1.5 text-center text-[20px] font-extrabold leading-snug tracking-tight">
        {copy.title}
      </p>
      {/* break-keep — 카드가 좁아(316px) 기본 줄바꿈이 어절 한가운데를 끊는다.
          보드 실험 카드와 같은 처리다. */}
      <p className="mt-2 break-keep text-center text-[12.5px] leading-relaxed text-white/80">
        {copy.body}
      </p>

      <span className="mt-4 w-full rounded-[14px] bg-white px-4 py-3 text-center text-[14.5px] font-extrabold text-sky-700 shadow-md shadow-sky-900/20 transition group-hover:bg-sky-50">
        {copy.cta}
      </span>

      {/* 오늘의 목표 — 미설정(goalTotal 없음)이면 줄째 생략한다. 0/0 바를 그리면
          "목표를 못 채웠다"로 읽혀, 아직 정하지 않은 상태를 실패처럼 보이게 한다. */}
      {goalTotal ? (
        <div className="mt-auto w-full border-t border-white/25 pt-4" data-testid="learn-goal">
          <div className="flex items-baseline gap-2">
            <p className="text-[12.5px] font-extrabold text-white/90">🎯 {t('home.goal.title')}</p>
            <span className="ml-auto text-[12px] font-extrabold tabular-nums text-white/75">{pct}%</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-[30px] font-extrabold tabular-nums tracking-tight">{goalDone}</span>
            <span className="text-[13px] font-bold tabular-nums text-white/75">
              / {goalTotal} {t('home.goal.items')}
            </span>
          </div>
          <div className="mt-1.5 h-[9px] overflow-hidden rounded-full bg-white/30">
            <i className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/80">
            {remaining > 0 ? t('home.goal.remaining', { n: remaining }) : t('home.goal.done')}
          </p>
        </div>
      ) : (
        // 목표 미설정 — 늘어난 높이를 먹어 CTA가 카드 가운데에 남게 한다.
        <span className="mt-auto" aria-hidden="true" />
      )}
    </Link>
  );
}
