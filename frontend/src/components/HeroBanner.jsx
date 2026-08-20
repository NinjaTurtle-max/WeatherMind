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
 *   - note     **큰 제목 바로 아래** 작은 글씨 한 줄(2026-08-19 사용자 지시 —
 *              "교육용 단순화 모델이에요~ 이건 튜터 카드 안에 넣고 큰 제목 아래에
 *              작은 글씨로"). 모델 고지처럼 **제목에 딸린 단서**를 위한 자리다.
 *              ⚠️ **`description`과 같이 쓰면 배너가 h=90을 넘는다.** 설명이 폭을
 *              가져가 제목 열이 좁아지고 이 줄이 두 줄로 접히기 때문이다.
 *              · 설명을 비우면 제목 열이 1,018px이라 한 줄 → h=90 유지(기후변화)
 *              · 둘 다 필요하면 `tightDescription`을 함께 켤 것(태풍) — 그래도
 *                h=104다. 그 8~14px은 **받아들인 값**이고, 그 화면만 배너가
 *                조금 높다. 종전에 이 자리에 "같이 쓰지 말 것"이라 적었는데
 *                2026-08-19 사용자 지시로 둘 다 요구되어 정정한다(실측 104).
 *   - right    오른쪽 끝 슬롯(배지·칩 등). 없으면 제목 열이 폭을 다 쓴다.
 *   - as       eyebrow 태그. 화면에 다른 h1이 없으면 'h1'을 줄 것 — 보드 목록
 *              배너가 배너로 바뀌면서 그 화면만 heading이 0개가 된 전례가 있다.
 */
export default function HeroBanner({
  mascot,
  eyebrow,
  title,
  description = null,
  tightDescription = false,
  note = null,
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
          원을 넘겨 배너가 다른 화면보다 높아진다.

          🔴 **폭이 `xl`(1280)에서 300 → 360px로 넓어진다**(2026-08-18 사용자
          지시 "줄 바꿈없이 일자로 쭉"). 탐구 안내문이 한 줄로 펴지는 데
          필요한 폭이 **351px**이라(실측) 300으로는 반드시 두 줄이 됐다.
          ⚠️ **`xl` 아래로는 넓히면 안 된다.** 예보·리그 배너는
          `CompeteLayout` 카드 안이라 더 좁은데, 1024·1152에서 360을 주면
          제목 열이 눌려 **제목이 «…»로 잘린다**(실측으로 확인하고 되돌렸다).
          1280부터는 셋 다 한 줄이고 제목도 안 잘린다. 배너 높이는 전 구간
          **h=90 그대로**다 — 한 줄이 되면서 오히려 여유가 늘었다.

          🔴 **`lg:block`을 같이 쓰면 안 된다**(2026-08-17 코드 리뷰가 잡았다).
          `line-clamp-2`는 `display:-webkit-box`로 동작하는데 `lg:block`이
          `display:block`을 준다. 둘은 특이도가 같고 컴파일된 CSS에서
          `.lg\:block`이 **뒤에 온다**(실측 54676 < 54779) — 그래서 block이
          이기고 **클램프가 통째로 죽는다.** 눈으로는 두 줄짜리 문구에서
          차이가 안 나므로(둘 다 두 줄) 긴 문구가 들어오는 날에야 배너가
          늘어나며 드러난다. 좁은 화면 접기는 `hidden` 하나로 충분하다:
          `.hidden`(7835)보다 `.lg\:line-clamp-2`(54676)가 뒤라 lg에서
          -webkit-box가 이겨 스스로 펴진다. */}
      {/* 🔴 `tightDescription` — **한 줄에 들어가는 작은 변형**(2026-08-19 사용자
          지시 "이 글씨 크기 줄여서 한 줄로"). 두 벌을 **완성된 문자열 리터럴**로
          적는다: Tailwind는 소스 텍스트를 훑어 클래스를 만들므로 조각을 템플릿
          문자열로 이어 붙이면 CSS가 아예 안 생긴다(보드 음수 여백에서 겪은 그것).
          차이는 셋뿐이다 — 글자 11.5 → 10 · 줄간격 relaxed → snug · xl 폭 360 →
          430(그 폭이라야 한 줄에 든다). `line-clamp-2`는 **양쪽 다 남긴다**:
          좁은 화면에서 한 줄을 고집하면 잘라야 하는데, 잘린 문장보다 두 줄이 낫다. */}
      {/* 🔴 **오른쪽 열 — 고지가 위, 설명이 아래**(2026-08-19 사용자 지시
          "교육용 단순화 모델입니다~ 이 멘트를 오른쪽 상단(튜터 카드 오른쪽 위)에").
          제목 아래에 있던 고지가 여기로 올라왔다.

          🔴 **이 이사가 h=90을 되찾아 준다.** 제목 아래에 있을 때는 제목 열이
          eyebrow 14 + 제목 26 + 고지 두 줄 29 = 71로 마스코트 원(62)을 넘겨
          태풍 배너가 104였다. 오른쪽으로 오면 제목 열은 40으로 줄고 이 열은
          고지 14 + 간격 4 + 설명 14 = 32라 둘 다 62 안이다.

          ⚠️ **고지는 `hidden`으로 접지 않는다**(설명과 다른 점) — 안내가 아니라
          고지라 좁은 화면에서 사라지면 안 된다. 그래서 열 자체는 늘 서고
          설명만 접힌다. 폭(basis)의 소유자가 `<p>`에서 이 열로 올라왔다. */}
      {(note || description) && (
        // 폭은 **변형마다 다르다** — 기본 xl 360(2026-08-18에 실측으로 고른 값
        // 「탐구 안내문이 한 줄로 펴지는 데 351px」), tight는 430(10px 문구가
        // 한 줄에 드는 폭). 기본을 430으로 올리면 예보·리그 배너(CompeteLayout
        // 카드 안이라 더 좁다)의 제목 열이 70px 더 눌린다 — 올리지 말 것.
        <div className={tightDescription
          ? 'flex min-w-0 basis-[300px] flex-col gap-1 xl:basis-[430px]'
          : 'flex min-w-0 basis-[300px] flex-col gap-1 xl:basis-[360px]'}>
          {note && (
            <p className="line-clamp-2 text-[10px] leading-snug text-sky-200/85">
              {note}
            </p>
          )}
          {description && (
            <p className={tightDescription
              ? 'hidden min-w-0 text-[10px] leading-snug text-slate-300 lg:line-clamp-2'
              : 'hidden min-w-0 text-[11.5px] leading-relaxed text-slate-300 lg:line-clamp-2'}>
              {description}
            </p>
          )}
        </div>
      )}

      {right}
    </div>
  );
}
