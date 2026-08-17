import Mascot from './Mascot';

/**
 * HeroBanner — 화면 맨 위 **가로 진입 배너**(짙은 남색 밴드).
 *
 * 2026-08-12 사용자 지시: 탐구·예보도 왼쪽 하단 사이드바 튜터를 걷고 학습·보드처럼
 * 상단 배너로 말한다(탐구 구름이 · 예보 태풍이). 그 둘을 만들면서 같은 밴드가
 * 네 번째·다섯 번째가 되어 **공용 컴포넌트로 뽑았다**.
 *
 * ⚠️ 기존 셋(LearnHeroCard · 보드 목록 배너 · 보드 미션 배너)은 아직 각자
 * 그린다. 치수·색은 같지만 내부가 다르기 때문이다 — 학습은 CTA·목표·진도 바를,
 * 보드 미션은 실화 배지·타이머·가이드 팝오버를 들고 있다. 여기로 합치려면 그
 * 슬롯들을 전부 prop으로 받아야 하고, 그러면 "얇게 간다"는 각 배너의 제1 계약을
 * 한 파일이 동시에 지켜야 한다. **치수만 같으면 되는 화면**이 이 컴포넌트를 쓰고,
 * 나머지는 각자 남는다. 치수의 소유자는 여기다 — 새 배너는 여기서 시작할 것.
 *
 * props
 *   - mascot   말하는 캐릭터(SideNav TUTOR_BY_PATH의 그 화면 담당과 **같아야**
 *              한다. 다르면 한 화면에서 말하는 사람이 둘이 된다)
 *   - eyebrow  제목 위 한 줄. `as`가 'h1'이면 이쪽이 페이지 제목 역할을 겸한다.
 *   - title    큰 문장 — **한 줄로 잘린다**(truncate). 짧은 문구만 넣을 것.
 *   - description 긴 설명. 좁은 화면에서는 통째로 접힌다(`hidden lg:block`) —
 *              LearnHeroCard·보드 목록 배너와 같은 관례다. 여기에 문장을 넣고
 *              title에는 짧은 말을 넣는 것이 이 배너의 사용법이다: 문장을
 *              title에 넣으면 1440에서도 잘린다(2026-08-12 리뷰 실측).
 *              **최대 두 줄까지 접힌다**(2026-08-17) — 한 문장은 다 보인다.
 *              그보다 길면 잘리니, 넘치면 배너가 아니라 문구를 줄일 것.
 *   - right    오른쪽 끝 슬롯(배지·칩 등). 없으면 제목 열이 폭을 다 쓴다.
 *   - as       eyebrow 태그. 화면에 다른 h1이 없으면 'h1'을 줄 것 — 보드 목록
 *              배너가 배너로 바뀌면서 그 화면만 heading이 0개가 된 전례가 있다.
 */
export default function HeroBanner({
  mascot,
  eyebrow,
  title,
  description = null,
  right = null,
  as: Eyebrow = 'p',
  testId,
}) {
  return (
    <div
      data-testid={testId}
      data-hero-mascot={mascot}
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[20px] bg-gradient-to-r from-[#1F3A5F] to-[#16293F] px-5 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
    >
      {/* 원형 배경을 깔아 남색 위에서 실루엣이 뜨게 한다 — 투명 PNG라 배경 없이
          두면 어둡게 묻힌다. sm 미만에서는 접는다(배너가 두 줄이 된다). */}
      <span className="hidden h-[62px] w-[62px] flex-none place-items-center rounded-full bg-white/10 sm:grid">
        <Mascot name={mascot} className="h-[50px] w-[50px]" />
      </span>

      <div className="min-w-0 flex-1 basis-[220px]">
        {/* truncate — en 문구가 두 줄로 접히면 배너가 다른 화면보다 높아진다
            ("같은 치수"가 깨진다). */}
        <Eyebrow className="truncate text-[11.5px] font-bold tracking-[0.02em] text-sky-300">
          {eyebrow}
        </Eyebrow>
        <p className="mt-0.5 truncate text-[21px] font-extrabold leading-tight tracking-[-0.02em] text-white">
          {title}
        </p>
      </div>

      {/* 설명 — 좁아지면 접는다. 접혀도 잃는 정보가 없어야 한다(안내문 전용).
          ⚠️ **한 줄 자르기(`truncate`)가 아니라 두 줄 접기(`line-clamp-2`)다**
          (2026-08-17 사용자 지시 — "안 짤리게"). 종전에는 300px에서 한 줄로
          잘려 탐구·예보 둘 다 문장 끝이 «…»로 사라졌다.

          **배너 높이는 그대로다.** 이 행의 높이를 정하는 것은 설명이 아니라
          마스코트 원(62px)이고, 두 줄은 11.5px × leading-relaxed ≈ 36px라
          그 안에 들어간다. 그래서 「배너 치수는 어디서나 같다」는 계약
          (`duelLayout`·`mascotAssets`가 무는 그것)이 깨지지 않는다 —
          실측 1440에서 전후 모두 h=90.
          ⚠️ 세 줄(≈54px)까지도 62px 안이지만 `2`로 묶는다: 안내문이 그보다
          길어지면 배너가 아니라 **문구가 잘못된 것**이고, 네 줄이 되는 순간
          원을 넘겨 배너가 다른 화면보다 높아진다. */}
      {description && (
        <p className="hidden min-w-0 basis-[300px] text-[11.5px] leading-relaxed text-slate-300 lg:line-clamp-2 lg:block">
          {description}
        </p>
      )}

      {right}
    </div>
  );
}
