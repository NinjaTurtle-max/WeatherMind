import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReviewQueueCard from '../../components/ReviewQueueCard';
import RegionPicker from '../../components/RegionPicker';
import RegionOnboardingNotice from '../../components/RegionOnboardingNotice';
import GuestSaveNode from '../../components/GuestSaveNode';
import { progressApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../i18n';

/**
 * LearnFooterCards — 학습 화면 **오른쪽 세로 열**(2026-08-10 사용자 지시).
 *
 * 이름에 footer가 남아 있는 것은 하루 전까지 경로 **아래** 가로 3카드였기
 * 때문이다 — 옆으로 세우면서 자리가 바뀌었다.
 *
 * **자유 일일 세션 카드는 제거됐다**(2026-08-12 클라이언트 지시 — `/daily` 라우트
 * 폐지). 학습(유닛) 세션이 오늘 날씨를 직접 받게 되면서 「오늘 몫」을 따로 파는
 * 입구가 필요 없어졌다. 카드가 갖고 있던 3상태(dailyBlocked·energyBlocked·평소)
 * 분기도 함께 사라졌다 — 구름 잔량 게이트는 경로 노드와 진입 배너
 * (`LearnHeroCard`의 `learn-entry-cta`)가 계속 소유한다.
 *
 * **리그 칸은 그 전에 뺐다**(사용자 지시). 리그는 내비 탭이 이미 갖고 있어 같은
 * 목적지가 한 화면에 두 벌이었다. 리그 성적 파생(`lib/leagueStanding`)은
 * LeaguePage가 계속 쓰므로 남는다.
 *
 * ⚠️ `RegionPicker`는 **남긴다.** 없어진 카드의 머리에 얹혀 있었지만 자유 세션에
 * 딸린 것이 아니다 — 학습 지역은 실황 주입(`today.*` 슬롯)의 입력이고, 유닛
 * 세션이 오늘 날씨를 받게 되는 지금 오히려 더 붙어 있어야 한다.
 *
 * ⚠️ 이 열의 **폭**이 경로 트랙에서 빠진다 — 옆으로 세운 뒤로 바뀐 계산이다
 * (아래에 있을 때는 높이가 빠졌고, 그건 노드 지름을 깎았다). 폭을 넓히기 전에
 * 트랙의 지그재그 진폭(`--amp`: 16cqw)을 재 볼 것 — 트랙이 좁아지면 노드가
 * 가운데로 모여 길이 일직선처럼 보인다.
 *
 * 호출자(`CurriculumHome`)는 아직 `dailyBlocked`·`energyBlocked`·`regenMin`·
 * `dailyIsPrimary`를 넘긴다. 받지 않고 무시한다 — React가 조용히 버리므로
 * 무해하고, 호출자 파일은 이 작업의 소유 밖이다.
 */
export default function LearnFooterCards() {
  const t = useT();
  const accessToken = useAuthStore((s) => s.accessToken);

  /**
   * 배치고사 진입 (2026-08-12 신설 — **진입 경로 0개 회귀 복구**).
   *
   * ⚠️ 경위를 남긴다. 로그인·회원가입 제거로 `LoginPage`가 삭제되면서, 신규
   * 학습자를 `/onboarding/placement`로 보내던 **유일한 UI 동선이 사라졌다**
   * (가입 직후 배치고사 진입이 그 통로였다). 라우트·시작 호출은 멀쩡히 살아
   * 있는데 아무도 그 문을 열어 주지 않는 상태였다 — 규정상 심사위원은 계정
   * 없이 열어 보므로, 온보딩 진단이 통째로 도달 불가였다.
   *
   * `/me`에 같은 배너가 있고(`ProgressPage` — `placement_done === false` 게이트)
   * 그것도 살아 있다. 그런데도 여기에 하나 더 두는 이유: 콜드 오픈의 착지점은
   * `/learn`이고, 진단은 **학습을 시작하기 전에** 받아야 값이 있다. 내 정보
   * 탭까지 스스로 찾아 들어간 사람만 진단받는 구조는 온보딩이 아니다.
   *
   * 쿼리 키는 `Layout`과 **같은 `['progress','me']`**다 — React Query 캐시를
   * 공유하므로 요청이 추가로 나가지 않는다(스토어에 담지 않는 이유는
   * `progressStore`가 xp·level·streak·spine만 화이트리스트로 보관해서
   * `placement_done`을 버리기 때문이다. 그 파일은 소유 밖이다).
   *
   * 이 진입점이 또 조용히 사라지지 않도록 계약으로 물린다 —
   * `frontend/tests/placementEntry.smoke.test.mjs`의 「진입 경로 최소 1개」 시나리오.
   */
  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });
  const needsPlacement = me?.placement_done === false;

  return (
    // ⚠️ **카드 한 장씩 떨어진 형상으로 되돌린다**(2026-08-13 클라이언트 판정:
    //    "이전의 카드 형상 디자인이 낫다. 그 대신 서브 노드들을 흰색으로").
    //    한 장으로 묶는 시안(B)을 만들어 보였고 클라이언트가 원래 쪽을 골랐다.
    //    **다만 색은 통일한다** — 종전에는 칸마다 다른 음영(indigo·sky·그라데이션)을
    //    갖고 있어 넷이 서로 주목을 다퉜다. 전부 흰색으로 두면 색을 가진 것은
    //    「이어서 풀기」(진한 남색) 하나뿐이라 **주버튼이 혼자 튄다.**
    //    ⚠️ **자식은 직계로 유지한다** — `home.smoke`가 이 열의 직계 자식 testid
    //    순서로 「지역이 복습보다 위」를 문다. 감싸면 indexOf가 -1이 되어 그 계약이
    //    공허하게 죽는다.
    <div data-testid="learn-footer" className="flex flex-col gap-3.5 md:h-full">
      {/* 진단 입구 — 아직 안 받은 사람에게만. 받고 나면 영구히 사라진다.
          문구는 `/me` 배너와 **같은 키**를 쓴다(profile.placementBanner*) —
          같은 행동을 두 화면에서 다른 말로 부르지 않기 위해서다. */}
      {needsPlacement && (
        <Link
          to="/onboarding/placement"
          data-testid="learn-placement-entry"
          className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true">🧭</span>
            <p className="text-[13px] font-extrabold text-slate-900">
              {t('profile.placementBannerTitle')}
            </p>
          </div>
          <p className="mt-1 text-[11.5px] font-bold text-sky-700">
            {t('profile.placementBannerCta')}
          </p>
        </Link>
      )}

      {/* 학습 지역 — **파란 안내 하나가 지역 칸을 통째로 소유한다**
          (2026-08-13 클라이언트 지시: "흰색 지역 노드 너무 이상해, 그냥 파랑 날씨
          노드를 「나중에」 없이 흰색 대신으로 고정해줘").

          ⚠️ 무엇이 바뀌었나 — 이 자리에는 **두 칸이 겹쳐 있었다**:
            ⓐ `RegionOnboardingNotice` — 지역 **미설정일 때만** 뜨는 파란 안내
              (안에 지역 칩이 들어 있다). 「나중에」로 닫으면 사라진다.
            ⓑ `learn-region` — 지역 칩만 얹은 **흰 줄**. 항상 떴다.
          미설정 동안 칩이 두 개로 보이고, 설정한 뒤에는 ⓑ만 남아 **머리말도 설명도
          없는 흰 칸**이 됐다. 클라이언트가 「이상하다」고 한 것이 그 상태다.

          이제 파란 안내가 **상시** 뜨고 흰 줄은 없앴다. 그래서 「나중에」(닫기)도
          함께 걷었다 — 닫을 수 있게 두면 **지역을 고르는 통로가 화면에서 통째로
          사라진다**(종전에 흰 줄을 조건부로 숨기지 않았던 이유가 정확히 그것이다).
          안내가 상시가 됐으므로 그 걱정이 구조적으로 없어졌다.

          ⚠️ **형제로 끼운다 — 감싸지 말 것.** `home.smoke`가 이 열의 **직계 자식**
          testid 순서로 「지역이 복습보다 위」를 문다. 감싸는 순간 indexOf가 -1이
          되어 그 계약이 공허하게 죽는다. */}
      <RegionOnboardingNotice
        data-testid="learn-region"
        persistent
        onboarding={false}
        className="flex flex-col gap-2 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200"
      />

      {/* 복습 — due 0건이면 컴포넌트가 스스로 null이라 카드째 빠진다.
          자유 일일 세션 카드가 없어져 이제 이 열의 세로를 혼자 쓴다.
          종전의 `md:max-h-[340px]`는 두 카드가 트랙 높이를 나눠 쓰던 시절의
          상한이었다 — 소유자가 하나가 됐으므로 카드 본연의 높이에 맡긴다. */}
      <ReviewQueueCard variant="tile" />

      {/* 게스트 진도 저장(2026-08-12 요구 ⑵) — 화면 맨 위를 가로로 덮던 배너가
          여기 여백으로 내려왔다. **맨 아래**에 둔다: 오늘 할 일(진단·지역·복습)이
          먼저고, 이것은 하다가 눈에 들어오면 되는 안내다.
          ⚠️ 열의 세로 순서를 무는 계약이 있다(`home.smoke` — 학습 지역이 복습보다
          위). 사이에 끼우지 말 것. 게스트가 아니면 컴포넌트가 스스로 null이라
          정식 계정에서는 칸이 아예 없다. */}
      <GuestSaveNode />
    </div>
  );
}
