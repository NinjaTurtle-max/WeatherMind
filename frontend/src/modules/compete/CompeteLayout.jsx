import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { duelApi } from '../../api';
import BriefingRoom from '../duel/BriefingRoom';
import HeroBanner from '../../components/HeroBanner';
import { useT } from '../../i18n';

/**
 * CompeteLayout — 「예보 대결」과 「리그」의 **공통 껍데기**(2026-08-11 사용자 지시).
 *
 * 두 화면을 하나로 합쳤다. 합칠 수 있는 이유는 **둘이 같은 자료를 본다**는
 * 것이다: 오늘의 실황 브리핑(`GET /duel/briefing`)이 대결 예측의 근거이자 주간
 * 예측의 근거다. 종전에는 두 페이지가 각자 같은 쿼리를 걸고 각자 브리핑을 그렸고,
 * 사용자는 같은 자료를 보려고 탭을 오갔다.
 *
 * 배치(사용자 지시 그대로):
 *   왼쪽  실황 브리핑 — **두 탭 모두 고정**. 스크롤해도 따라온다(lg sticky).
 *   오른쪽 그 탭의 조작 — 대결이면 근거+예측, 리그면 내 티어+주간 예측.
 *   하단  나머지 — 대결 이력 / 순위·등급 사다리.
 *
 * ⚠️ 탭은 **URL이 소유한다**(`/duel` ↔ `/league`). 상태로 들고 있으면 새로고침·
 * 뒤로가기·딥링크가 다 깨지고, 무엇보다 두 경로가 이미 밖에서 링크돼 있다
 * (온보딩·기능 잠금 안내·내비). 탭 전환은 그냥 라우팅이다.
 *
 * ⚠️ 브리핑 쿼리는 **여기가 소유한다.** 두 페이지에 있던 같은 쿼리를 걷어 왔다 —
 * 키가 같아 react-query가 합쳐 주긴 했지만, 소유자가 둘이면 한쪽만 고치는 사고가
 * 난다(staleTime이 갈리는 식). 실패해도 예측은 막지 않는다(degraded — KMA 키
 * 부재가 기본 상태다).
 */

const TABS = [
  { to: '/duel', labelKey: 'compete.tabDuel', icon: '🌡️' },
  { to: '/league', labelKey: 'compete.tabLeague', icon: '🏆' },
];

export default function CompeteLayout({ tab, title, subtitle, headerRight, mascot = null, heroTitle = null, children, below }) {
  const t = useT();
  const briefingQ = useQuery({
    queryKey: ['duel', 'briefing'],
    queryFn: duelApi.fetchDuelBriefing,
    retry: 1,
    staleTime: 60_000,
  });

  return (
    <div className="pt-2">
      {/* 🔴 **탭 + 머리말을 한 카드에 담는다**(2026-08-17 사용자 지시 —
          "학습 세션처럼 예보/리그 탭을 카드 안에"). 프레임은 학습 경로 카드와
          같은 값이다(`PcCurriculumPath`의 `rounded-[20px] bg-white ring-1
          ring-slate-200`) — 두 화면이 같은 물건으로 보여야 하므로 여기서
          새 치수를 만들지 않는다.
          ⚠️ 카드가 **탭 분기 바깥**에 있어야 한다. 안쪽(배너 분기)에 두면
          마스코트 없는 리그 탭에서 카드가 통째로 사라져, 탭이 다시 허공에 뜬다. */}
      <div className="mb-4 overflow-hidden rounded-[20px] bg-white ring-1 ring-slate-200">
      {/* 탭바 — 학습 화면의 코스 탭(CourseSwitcher)과 같은 꼴. 같은 층위의
          조작이 화면마다 다르게 생기면 "이게 탭인지" 매번 다시 배워야 한다.
          ⚠️ `role="tablist"`/`role="tab"`을 **쓰지 않는다**(2026-08-11 코드 리뷰).
          이것은 진짜 탭 위젯이 아니라 **경로가 다른 링크 둘**이다 — tab 역할을
          붙이면 tabpanel·aria-controls·roving tabindex가 따라와야 하는데 그중
          아무것도 없어서, 스크린 리더에는 깨진 탭으로 들리고 링크라는 사실까지
          잃는다. 링크로 두고 현재 위치는 `aria-current="page"`가 말한다. */}
      <nav
        aria-label={t('compete.tabsAria')}
        // 웹 브라우저 탭 꼴 — **카드 안 맨 위**에 붙는다(2026-08-17 사용자 지시
        // "학습 세션처럼 카드 안에"). 종전에는 카드 **밖**에 알약으로 떠 있어서
        // 무엇을 바꾸는 스위치인지 화면에서 안 붙어 보였다. 학습 경로가
        // 2026-08-13에 같은 이유로 같은 꼴이 됐고(`CourseSwitcher` variant='tab'),
        // 치수·색을 그쪽과 **글자 하나까지 맞춘다** — 같은 층위의 조작이 화면마다
        // 다르게 생기면 "이게 탭인지"를 매번 다시 배워야 한다.
        className="flex flex-wrap items-end gap-1 border-b border-slate-200 px-3 pt-2.5"
      >
        {TABS.map((item) => {
          const active = item.to === tab;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              data-compete-tab={item.to}
              // 선택된 탭이 **아래 테두리를 끊어** 카드와 이어진다
              // (`-mb-px`가 그 한 픽셀을 덮는다). 이 한 줄이 「탭이 카드에
              // 붙어 있다」를 만든다 — 빼면 그냥 네모 버튼 둘이 된다.
              className={`-mb-px flex items-center gap-1 rounded-t-lg border border-b-0 px-3.5 py-1.5 text-[12.5px] font-bold transition ${
                active
                  ? 'border-slate-200 bg-white text-sky-700'
                  : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <span aria-hidden="true">{item.icon}</span>
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      {/* `mascot`을 준 탭만 **상단 배너**로 말한다(2026-08-12 사용자 지시 —
          예보는 태풍이). 배너를 쓰면 그 경로는 SideNav가 왼쪽 하단 튜터를
          접는다(HERO_PATHS) — 안 접으면 같은 캐릭터가 한 화면에 둘이 된다.
          리그는 지시 범위 밖이라 종전 제목 줄 그대로다. 한 껍데기가 두 꼴을
          갖는 것이 어색하지만, 안 시킨 화면을 같이 바꾸는 쪽이 더 나쁘다. */}
      {mascot ? (
        // 카드 안쪽 여백 — 배너가 카드 테두리에 딱 붙지 않게. 바깥 `mb-4`는
        // 카드로 올라갔다(두 겹으로 주면 탭과 배너 사이가 벌어진다).
        <div className="p-3">
          {/* 계층은 다른 배너와 같게 둔다: eyebrow=화면 이름 · title=짧은 말 ·
              description=긴 안내. 종전에는 subtitle(날짜 + 문장)을 title에
              넣었는데, title은 한 줄로 잘려 폰에서 날짜와 두 단어만 남았다
              (2026-08-12 리뷰). 날짜는 문장 앞에 그대로 붙어 있다. */}
          <HeroBanner
            testId="compete-hero"
            mascot={mascot}
            as="h1"
            eyebrow={title}
            title={heroTitle ?? title}
            description={subtitle}
            right={headerRight && <div className="flex-none">{headerRight}</div>}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-2 px-4 py-3.5">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {headerRight}
        </div>
      )}
      </div>

      {/* grid-cols-[minmax(0,1fr)]는 장식이 아니다 — 격자 항목은 기본이
          min-width:auto라, 브리핑 안의 하늘 타임라인(자체 overflow-x-auto)이
          카드를 밀어 페이지에 가로 스크롤이 생긴다(390px 실측). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {/* 왼쪽 — 브리핑. 감싸 둔다: 격자 항목 기본이 stretch라, KMA 키 없는
            degraded에서 「실황 자료 수신 대기」 한 장이 오른쪽 열 높이까지
            늘어난다(실측 570px의 빈 흰 상자). 감싸면 늘어나는 건 이 div이고
            카드는 제 높이를 지킨다. */}
        <div>
          <BriefingRoom
            briefing={briefingQ.data}
            loading={briefingQ.isLoading}
            error={briefingQ.isError}
          />
        </div>

        {/* 오른쪽 — 그 탭의 조작. **여기가 sticky다**(브리핑이 아니라).
            브리핑이 두 배 넘게 길어(1440 실측 940px ↔ 615px) 아래쪽 차트를 보러
            내려가면 입력칸이 화면 밖으로 나간다 — 나란히 놓은 이유가 사라진다.
            ⚠️ 반대로 **브리핑을 sticky로 하면 아무 일도 안 일어난다**: 격자 칸은
            줄 높이만큼 늘어나는데 그 높이를 정하는 게 브리핑 자신이라 붙어 있을
            여백이 0이다. 「왼쪽 고정」은 자리 이야기이고, 따라 내려오는 것은
            짧은 쪽이어야 한다.
            바깥 div가 왼쪽 높이만큼 늘어나 주고(grid 기본 stretch —
            items-start를 주면 따라 내려올 여백이 없어져 sticky가 죽는다)
            안쪽이 따라 내려온다. top은 고정 헤더(64px) 아래. */}
        <div>
          <div className="flex flex-col gap-4 lg:sticky lg:top-[72px]">{children}</div>
        </div>
      </div>

      {below && <div className="mt-4">{below}</div>}
    </div>
  );
}
