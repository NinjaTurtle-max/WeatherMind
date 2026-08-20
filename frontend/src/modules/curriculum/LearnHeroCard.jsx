import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import { ENTRY_MASCOT } from './learnEntry';
import { GOAL_ANCHOR } from '../progress/DailyGoal';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 **오른쪽 세로 열의 첫 칸**(짙은 남색 카드).
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 진입 카드·오늘의 목표를
 * 이 카드가 흡수했다. 복습 큐·지역·저장 노드는 같은 열의 아래쪽이 받는다
 * (LearnFooterCards).
 *
 * 배치가 일곱 번 바뀌었다(2026-08-09~13, 전부 클라이언트 지시):
 *   ① 오른쪽 세로 레일 → ② 위쪽 가로 배너 → ③ 다시 세로 레일 →
 *   ④ 얇은 가로 배너(시안) → ⑤ 왼쪽 세로 카드 → ⑥ 다시 얇은 가로 배너 →
 *   ⑦ **오른쪽 세로 열의 첫 칸**(2026-08-13).
 * ⑤는 지시를 잘못 읽은 결과였다 — 「학습 세션을 왼쪽에」의 학습 세션은 이 배너가
 * 아니라 **경로 카드**였다.
 *
 * ⑦로 온 이유와 그 대가를 적어 둔다. 이유는 「가로로 눕는 것을 오른쪽 세로 열로」
 * 이고, 얻은 것은 **학습 경로의 세로**다(가로 띠 두 개가 통째로 빠졌다). 대가는
 * **폭**이다 — 248~264px 안에서 끝나야 하므로 ④~⑥이 한 줄에 늘어놓던 다섯 덩어리
 * (마스코트·제목·부제+진도·목표·CTA)를 세로로 쌓았다. `hidden lg:block`으로 접던
 * 열도 없앴다: 열 안에서는 접을 폭이 애초에 없고, 접으면 부제·진도가 1024px 미만
 * 에서 통째로 사라진다(같은 함정을 오늘의 목표가 이미 한 번 밟았다 — 아래 참조).
 *
 * ⚠️ 그래서 이 파일의 제1 계약이 「한 줄로 끝난다」에서 **「한 열 폭 안에서
 * 끝난다」**로 바뀌었다. 여기에 무엇을 더 넣기 전에, 그것이 248px에서 줄바꿈 없이
 * 읽히는지와 이 열의 세로가 얼마나 길어지는지를 함께 볼 것 — 열이 트랙보다 길어
 * 지면 경로 밑에 빈 공간이 생긴다.
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
  lockedNote = null,
}) {
  const t = useT();
  const pct = goalTotal ? Math.min(100, Math.round((goalDone / goalTotal) * 100)) : 0;
  // 구름 0 차단 — **문항 진입 전**에 알린다(R10-01 §3.1). 화면에서 가장 큰 버튼이
  // 살아 있는 채로 429를 받게 두면 R10이 폐지한 "누른 뒤에 알리는" 흐름이 그대로
  // 돌아온다(2026-08-09 코드 리뷰. 경로 노드와 하단 카드는 이미 막고 있었고 여기만
  // 뚫려 있었다 — 홈 시절 카드에서 그대로 옮겨온 구멍이다).
  //   unit·done  유닛 세션은 호출마다 **새 발급**이라 잔량 0이면 항상 429다.
  //   daily      오늘 세션이 살아 있으면 재조회는 200이다("풀던 것을 뺏기지
  //              않는다"). 그래서 energyBlocked가 아니라 dailyBlocked를 본다.
  //   lockedNote  스크롤로 **선행 잠긴 섹션**을 보고 있을 때. 목적지가 아직
  //              열리지 않았으니 눌리면 안 된다(서버도 403 UNIT_LOCKED로 막는다).
  const ctaBlocked =
    Boolean(lockedNote)
    || (entry.kind === 'daily' ? dailyBlocked : energyBlocked && entry.to !== '/learn');
  // 막힌 이유를 그대로 말한다 — 잠금인데 "구름 회복까지"라고 하면 기다리면 열리는
  // 줄 안다(기다려도 안 열린다).
  const blockedNote = lockedNote ?? t('curriculum.daily.regen', { min: regenMin });

  return (
    <div
      data-testid="learn-entry"
      data-entry-kind={entry.kind}
      // 세로 여백 `py-5`(20) → `py-6`(24) → **`py-7`(28)**(사용자 지시 두 번 —
      // 2026-08-19 "아주 조금만 더" · 2026-08-20 "아주 약간 더"). 카드 257 → 265 → 273px.
      // ⚠️ **가로(`px-[18px]`)는 건드리지 않는다.** 이 열은 248~264px로 고정이고
      //    안쪽 폭이 줄면 부제·유닛명이 한 글자씩 더 접힌다(이 파일 제1 계약 —
      //    「한 열 폭 안에서 끝난다」).
      // ⚠️ 늘린 만큼 오른쪽 열이 길어지고, 그만큼 **왼쪽 경로 트랙 밑에 빈
      //    자리**가 생긴다(머리말의 그 경고다). 실측으로 8px이라 눈에 안 띄는
      //    범위에서 멈췄다 — 더 키우려면 트랙 높이와 함께 봐야 한다.
      className="rounded-[20px] bg-gradient-to-b from-[#1F3A5F] to-[#16293F] px-[18px] py-7 shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
    >
      {/* 머리 — 마스코트 + 머리글/제목. 화자가 먼저 오고 그 뒤에 말할 내용이 온다.
          원형 배경을 깔아 남색 위에서 실루엣이 뜨게 한다(투명 PNG라 배경 없이
          두면 어둡게 묻힌다). 종전의 `hidden … sm:grid`는 뗐다 — 배너가 가로로
          누워 있을 때 두 줄이 되는 것을 막던 장치였고, 세로 카드에서는 접을
          이유가 없다. */}
      <div className="flex items-center gap-3">
        <span className="grid h-[56px] w-[56px] flex-none place-items-center rounded-full bg-white/10">
          <Mascot name={ENTRY_MASCOT[entry.kind] ?? 'drop'} className="h-[44px] w-[44px]" />
        </span>
        {/* min-w-0이 없으면 긴 유닛명이 카드를 밀어낸다(줄임표가 안 걸린다). */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-bold tracking-[0.02em] text-sky-300">
            {copy.eyebrow}
          </p>
          <p className="mt-0.5 break-keep text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-white">
            {copy.title}
          </p>
        </div>
      </div>

      {/* 설명 + 진도 바 — **항상 보인다.** 가로 배너 시절에는 `hidden lg:block`으로
          접었지만(두 줄이 되는 것을 막으려고), 세로 열에서는 접을 폭이 없고 접으면
          부제가 화면에서 사라진다. 진도 값 자체는 경로 카드 하단 바도 갖는다.
          ⚠️ **오늘의 목표는 여기 넣지 말 것.** 아래로 따로 뺀 이유가 그것이다. */}
      {/* 11.5 → **10.5px**(2026-08-18 사용자 지시 "글씨 크기 살짝만 줄여줘").
          이 부제만 줄인다 — 아래 진도 수치·설정 링크(11.5px)는 짧은 한 줄이라
          답답하지 않았고, 같이 줄이면 카드 전체가 흐릿해진다. */}
      <p className="mt-4 text-[10.5px] leading-relaxed text-slate-300">
        {t('curriculum.subtitle')}
      </p>
      <span className="mt-3 block h-[7px] overflow-hidden rounded-full bg-white/15">
        <i className="block h-full rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
      </span>

      {/* 오늘의 목표 — **항상 보인다**. 한때 위 진도 열 안에 있었는데, 그 열이
          `hidden lg:block`이라 1024px 미만에서 목표 표시와 설정 통로(`/me` 링크)가
          통째로 사라졌다(2026-08-10 코드 리뷰). 목표를 정하는 길이 이 화면에
          이것뿐이라 숨기면 기능째 없어진다 — 2026-08-09에 사용자가 제보한 바로
          그 증상이고, 접히는 열 안으로 들어가면서 조용히 되살아나 있었다.
          ⚠️ 조상에 `hidden`을 달지 말 것 — `home.smoke`가 진입 카드까지의 조상
          사슬을 훑어 그 회귀를 문다.
          미설정이어도 자리를 비우지 않고 내 정보로 보낸다. */}
      {goalTotal ? (
        <span
          data-testid="learn-goal"
          data-goal-state="set"
          className="mt-3.5 block whitespace-nowrap text-[11.5px] font-bold tabular-nums text-slate-300"
        >
          {t('home.goal.title')} {goalDone}/{goalTotal} {t('home.goal.items')}
        </span>
      ) : (
        <Link
          // 목표 설정 카드는 내 정보 **꼬리**에 있다 — 해시 없이 `/me`로 보내면
          // 능력 분석 판 두 화면 위에 떨어져 목표를 정하러 온 사람이 목표 카드를
          // 못 본다(2026-08-11 코드 리뷰). 앵커 문자열은 DailyGoal이 소유한다.
          to={`/me#${GOAL_ANCHOR}`}
          data-testid="learn-goal"
          data-goal-state="unset"
          className="mt-3.5 block whitespace-nowrap text-[11.5px] font-bold text-sky-300 hover:text-sky-200"
        >
          {t('curriculum.goalUnset')}
        </Link>
      )}

      {ctaBlocked ? (
        <span className="mt-4 block">
          <button
            type="button"
            disabled
            aria-disabled="true"
            data-testid="learn-entry-cta"
            className="block w-full cursor-not-allowed rounded-[14px] bg-white/15 px-4 py-3 text-center text-[13.5px] font-extrabold tracking-[-0.01em] text-white/50"
          >
            {copy.cta}
          </button>
          <span className="mt-1 block text-[11px] font-bold text-rose-300">{blockedNote}</span>
        </span>
      ) : (
        <Link
          to={entry.to}
          data-testid="learn-entry-cta"
          className="mt-4 block rounded-[14px] bg-sky-500 px-4 py-3 text-center text-[13.5px] font-extrabold tracking-[-0.01em] text-white shadow-[0_3px_0_#0369A1] transition hover:bg-sky-400"
        >
          {copy.cta}
        </Link>
      )}
    </div>
  );
}
