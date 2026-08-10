import { Link } from 'react-router-dom';
import ReviewQueueCard from '../../components/ReviewQueueCard';
import RegionPicker from '../../components/RegionPicker';
import { useT } from '../../i18n';

/**
 * LearnFooterCards — 학습 화면 **오른쪽 세로 열**(2026-08-10 사용자 지시).
 *
 * 자유 일일 세션(위) · 복습(아래). 이름에 footer가 남아 있는 것은 하루 전까지
 * 경로 **아래** 가로 3카드였기 때문이다 — 옆으로 세우면서 자리가 바뀌었다.
 *
 * **리그 칸은 뺐다**(사용자 지시). 리그는 내비 탭이 이미 갖고 있어 같은 목적지가
 * 한 화면에 두 벌이었고, 정산 전에는 「순위 집계 전」 한 줄이라 칸값을 못 했다.
 * 리그 성적 파생(`lib/leagueStanding`)은 LeaguePage가 계속 쓰므로 남는다.
 *
 * ⚠️ 이 열의 **폭**이 경로 트랙에서 빠진다 — 옆으로 세운 뒤로 바뀐 계산이다
 * (아래에 있을 때는 높이가 빠졌고, 그건 노드 지름을 깎았다). 폭을 넓히기 전에
 * 트랙의 지그재그 진폭(`--amp`: 16cqw)을 재 볼 것 — 트랙이 좁아지면 노드가
 * 가운데로 모여 길이 일직선처럼 보인다.
 */
export default function LearnFooterCards({
  dailyBlocked = false,
  energyBlocked = false,
  regenMin = 1,
  dailyIsPrimary = false,
}) {
  const t = useT();

  return (
    <div data-testid="learn-footer" className="flex flex-col gap-3.5 md:h-full">
      {/* 자유 일일 세션이 **위**다(사용자 지시). 복습이 아래인 것은 맞기도 하다 —
          due 0건이면 통째로 사라지는데, 위에 두면 사라질 때마다 아래 카드가
          위로 튄다.

          자유 일일 세션.
          상태가 **셋**이다(둘로 줄이면 안 된다 — 실제로 줄였다가 스모크가 잡았다):
            dailyBlocked  잔량 0 + 오늘 세션 없음 → 발급이 429로 막힌다.
                          **진짜 disabled 버튼**이어야 한다: 회색 링크는 눌리고,
                          누르면 서버가 막는다(R10이 폐지한 흐름).
            energyBlocked 잔량 0인데 **오늘 세션이 살아 있다** → 재조회는 200이다
                          ("풀던 것을 뺏기지 않는다" 불변식). 링크로 남기고
                          문구를 「풀던 세션 이어서 풀기」로 바꾼다.
            그 외          평소. */}
      {/* 두 카드가 트랙 높이를 나눠 쓴다(2026-08-10 사용자 지시 "더 세로로").
          `md:flex-1`이 남는 세로를 반씩 가져가고, 카드 안의 링크는 `mt-auto`라
          늘어난 높이만큼 바닥으로 내려간다.
          ⚠️ `max-h`가 필요하다 — 복습이 due 0건이면 자유 일일 세션 **혼자**
          flex-1을 다 먹어 세 줄짜리 카드가 600px이 된다. */}
      <div
        data-testid="learn-secondary"
        className="flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:max-h-[340px] md:flex-1"
      >
        <div className="flex items-center gap-2">
          <p className="text-[13.5px] font-extrabold text-slate-800">
            {t('curriculum.daily.title')}
          </p>
          <span className="ml-auto">
            <RegionPicker />
          </span>
        </div>
        {/* CO-S-9 — 위 배너가 이미 일일 세션일 때는(kind='daily') 본문·CTA를
            **글자 그대로 두 번** 그렸다. 같은 문장·같은 목적지가 한 화면에 두 벌이면
            §2.5가 없앤 "무엇을 누를지 모름"이 돌아온다. 주 진입(배너)을 남기고 이
            칸의 중복분만 내린다 — 지역 픽커는 여기 말고 자리가 없으므로 남는다.
            (홈 화면에 있던 가드인데 학습으로 옮기며 빠졌다. 2026-08-09 코드 리뷰) */}
        {dailyIsPrimary ? null : (
        <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
          {t('curriculum.daily.body')}
        </p>
        )}
        {dailyIsPrimary ? null : dailyBlocked ? (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="cursor-not-allowed text-[12px] font-bold text-slate-300"
            >
              {t('curriculum.daily.cta')}
            </button>
            <span className="text-[11px] font-bold text-rose-500">
              {t('curriculum.daily.regen', { min: regenMin })}
            </span>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
            <Link to="/daily" className="text-[12px] font-bold text-sky-600 hover:text-sky-700">
              {energyBlocked ? t('curriculum.daily.resume') : t('curriculum.daily.cta')}
            </Link>
            {energyBlocked && (
              <span className="text-[11px] font-bold text-rose-500">
                {t('curriculum.daily.regenResume', { min: regenMin })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 복습 — due 0건이면 컴포넌트가 스스로 null이라 카드째 빠진다. */}
      <ReviewQueueCard variant="tile" />
    </div>
  );
}
