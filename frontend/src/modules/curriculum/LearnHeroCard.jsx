import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import { ENTRY_MASCOT } from './learnEntry';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 맨 위 **가로 진입 배너**(짙은 남색 밴드).
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 진입 카드·오늘의 목표를
 * 이 배너가 흡수했다. 복습 큐·자유 일일 세션은 경로 **오른쪽 열**이 받는다
 * (LearnFooterCards).
 *
 * 배치가 여섯 번 바뀌었다(2026-08-09~10, 전부 사용자 지시):
 *   ① 오른쪽 세로 레일 → ② 위쪽 가로 배너 → ③ 다시 세로 레일 →
 *   ④ 얇은 가로 배너(시안) → ⑤ 왼쪽 세로 카드 → ⑥ **다시 얇은 가로 배너**.
 * ⑤는 지시를 잘못 읽은 결과였다 — 「학습 세션을 왼쪽에」의 학습 세션은 이 배너가
 * 아니라 **경로 카드**였다. 배너는 ④ 그대로 맨 위에 남고, 왼쪽으로 간 것은 경로다.
 * ②에서 배너가 세로 182px을 먹어 노드 지름이 86 → 60px로 줄었던 것이 ③으로
 * 되돌린 이유였고, ④가 배너를 2단에서 1단으로 눌러 그 비용을 줄였다.
 * ⑥에서는 오른쪽 카드가 아래가 아니라 **옆**으로 서면서 세로 비용이 더 줄어,
 * 배너가 있는데도 노드가 상한(86px)에 붙는다.
 *
 * 그래서 이 파일의 제1 계약은 **한 줄로 끝난다**는 것이다. 여기에 무엇을 더 넣기
 * 전에 경로 트랙의 노드 지름이 얼마나 줄어드는지 재 볼 것 — 지름은 트랙 **높이**만
 * 본다(index.css `--dot`). 지금은 여유가 있어 한 줄 더 넣어도 86px이 유지되지만,
 * 그 여유가 얼마인지는 재 봐야 안다.
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
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[20px] bg-gradient-to-r from-[#1F3A5F] to-[#16293F] px-5 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
    >
      {/* 마스코트 — 배너 **맨 왼쪽**(2026-08-09 사용자 지시. 시안은 CTA 왼쪽이었다).
          말하는 사람이 먼저 오고 그 뒤에 말할 내용이 오는 순서다.
          원형 배경을 깔아 남색 위에서 실루엣이 뜨게 한다 — 투명 PNG라 배경 없이
          두면 어둡게 묻힌다. sm 미만에서는 접는다(배너가 두 줄이 된다). */}
      <span className="hidden h-[62px] w-[62px] flex-none place-items-center rounded-full bg-white/10 sm:grid">
        <Mascot name={ENTRY_MASCOT[entry.kind] ?? 'drop'} className="h-[50px] w-[50px]" />
      </span>

      {/* 제목 열 — 폭이 남으면 여기가 늘어난다(min-w-0으로 긴 유닛명이 줄임표). */}
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="truncate text-[11.5px] font-bold tracking-[0.02em] text-sky-300">
          {copy.eyebrow}
        </p>
        <p className="mt-0.5 truncate text-[21px] font-extrabold leading-tight tracking-[-0.02em] text-white">
          {copy.title}
        </p>
      </div>

      {/* 설명 + 진도 바 — 좁아지면 통째로 접힌다(hidden lg:block): 배너가 두 줄이
          되는 순간 "얇게 간다"는 이 배치의 전제가 깨지기 때문이다. 접혀도 잃는
          정보가 없다 — 설명은 안내문이고, 진도는 경로 카드 하단 바가 같은 값을
          보여준다.
          ⚠️ **오늘의 목표는 여기 넣지 말 것.** 아래로 따로 뺀 이유가 그것이다. */}
      <div className="hidden min-w-0 basis-[260px] lg:block">
        <p className="truncate text-[11.5px] leading-relaxed text-slate-300">
          {t('curriculum.subtitle')}
        </p>
        <span className="mt-2 block h-[6px] overflow-hidden rounded-full bg-white/15">
          <i className="block h-full rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
        </span>
      </div>

      {/* 오늘의 목표 — **항상 보인다**. 한때 위 진도 열 안에 있었는데, 그 열이
          `hidden lg:block`이라 1024px 미만에서 목표 표시와 설정 통로(`/me` 링크)가
          통째로 사라졌다(2026-08-10 코드 리뷰). 목표를 정하는 길이 이 화면에
          이것뿐이라 숨기면 기능째 없어진다 — 2026-08-09에 사용자가 제보한 바로
          그 증상이고, 접히는 열 안으로 들어가면서 조용히 되살아나 있었다.
          미설정이어도 자리를 비우지 않고 내 정보로 보낸다. */}
      {goalTotal ? (
        <span
          data-testid="learn-goal"
          data-goal-state="set"
          className="flex-none whitespace-nowrap text-[11.5px] font-bold tabular-nums text-slate-300"
        >
          {t('home.goal.title')} {goalDone}/{goalTotal} {t('home.goal.items')}
        </span>
      ) : (
        <Link
          to="/me"
          data-testid="learn-goal"
          data-goal-state="unset"
          className="flex-none whitespace-nowrap text-[11.5px] font-bold text-sky-300 hover:text-sky-200"
        >
          {t('curriculum.goalUnset')}
        </Link>
      )}

      {ctaBlocked ? (
        <span className="flex-none text-right">
          <button
            type="button"
            disabled
            aria-disabled="true"
            data-testid="learn-entry-cta"
            className="block w-full cursor-not-allowed rounded-[14px] bg-white/15 px-5 py-3 text-center text-[14px] font-extrabold tracking-[-0.01em] text-white/50"
          >
            {copy.cta}
          </button>
          <span className="mt-1 block text-[11px] font-bold text-rose-300">{blockedNote}</span>
        </span>
      ) : (
        <Link
          to={entry.to}
          data-testid="learn-entry-cta"
          className="flex-none rounded-[14px] bg-sky-500 px-5 py-3 text-center text-[14px] font-extrabold tracking-[-0.01em] text-white shadow-[0_3px_0_#0369A1] transition hover:bg-sky-400"
        >
          {copy.cta}
        </Link>
      )}
    </div>
  );
}
