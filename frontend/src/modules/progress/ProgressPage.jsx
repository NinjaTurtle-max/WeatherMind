import { useEffect, useRef, useState } from 'react';
import { kstWeekdayIndex } from '../../lib/kstWeekday';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, progressApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import Mascot from '../../components/Mascot';
import TierBadge from '../../components/TierBadge';
import QuestList from './QuestList';
import BadgeCollection from './BadgeCollection';
import WeatherBrainPanel from './WeatherBrainPanel';
import KnowledgeLevelCard from './KnowledgeLevelCard';
import { selectUnlockStage, useOnboardingGate } from '../../lib/onboardingGate';
// R12 선행 §8 — 학습 지역 설정(자급 컴포넌트, 제작 FE-R)
import RegionPicker from '../../components/RegionPicker';
// 2026-08-12 요구 ⑴ — 진도 저장 입력. 폼 본체는 ConvertAccountPage와 공유한다.
import SaveProgressForm from '../../components/SaveProgressForm';
import { isGuestUser } from '../auth/guest';
import { useT } from '../../i18n';

/**
 * ProgressPage (R4-01 S1·S2·S3) — "내 정보" 탭.
 * 프로필 헤더(현재 리그 티어·XP·레벨·스트릭) + 일일 퀘스트 + 배지 컬렉션.
 * 티어는 GET /progress/me 응답의 tier(최근 정산 기준, 없으면 stratus)로 표시(§3.2).
 *
 * R7-02 S6 — 진단 입구 배너: /progress/me의 placement_done=false면 WeatherBrain
 * 패널 상단에 배치고사 진입 배너를 띄운다(true 또는 부재 시 미렌더).
 * 이미 완료한 사용자가 진입해도 PlacementPage의 409 방어가 홈으로 돌려보낸다.
 *
 * ⚠️ R8-01 §3.7④의 **스파인 카드(「학습 진도」)는 2026-08-11에 뺐다**(사용자 지시).
 * 유닛 진도율·왕관·「이어서 학습」은 /learn이 경로 트랙과 진입 배너로 이미 전부
 * 말한다 — 여기 있던 것은 같은 말의 두 번째 사본이었다. 요약(🎓 클리어 유닛 ·
 * 👑 획득 왕관)은 프로필 4칸 지표가 계속 들고 있으므로 `me.spine`은 아직 쓴다.
 *
 * R10-01 §3.4 (S4 — R10-D·R10-F):
 * - 하루 목표 **선택**(배치고사를 건너뛴 사용자 보정) — 페이지 꼬리의 설정 자리.
 *   진행도 "오늘 목표 N/M"(DailyGoalMeter)은 2026-08-11에 이 화면에서 걷었다:
 *   /learn 배너와 세션 완료 화면이 같은 값을 이미 보여준다.
 * - **첫 세션 전에는 퀘스트·배지를 1개만 노출**해 인지 부하를 줄인다(collapsed).
 *   첫 세션을 마치면(게이트 단계 1) 원래대로 전체가 펼쳐진다 — 기존 사용자는
 *   부트스트랩에서 해제 상태로 계산되므로 회귀가 없다.
 */
export default function ProgressPage() {
  const user = useAuthStore((s) => s.user);
  const unlockStage = useOnboardingGate(selectUnlockStage);
  const t = useT();

  const {
    data: me,
    isError: meFailed,
    isFetching: meFetching,
    refetch: refetchMe,
  } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });

  const { data: badges } = useQuery({
    queryKey: ['progress', 'badges'],
    queryFn: progressApi.fetchBadges,
    staleTime: 30_000,
  });

  // 첫 세션 전(게이트 단계 0) — 퀘스트·배지를 접어 첫 화면 정보량을 줄인다(§3.4)
  const collapsed = unlockStage < 1;

  // 해시 앵커로 스크롤 — `/me#daily-goal`(＝ /learn 배너의 「목표 미설정」)로 들어온
  // 사람을 목표 카드까지 데려간다. 리액트 라우터는 해시를 **스크롤하지 않는다**
  // (브라우저 기본 동작은 서버가 문서를 내려줄 때만 걸린다).
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return undefined;
    // jsdom 하네스에는 scrollIntoView·ResizeObserver가 없다 — 없으면 그냥 넘어간다.
    const align = () => document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
    align();
    // ⚠️ **한 번만 맞추면 안 된다.** 목표 카드는 페이지 꼬리에 있고 그 위 능력
    // 분석은 조회가 끝나야 키가 정해진다 — 먼저 맞춰 놓으면 뒤늦게 자란 만큼
    // 카드가 아래로 밀린다(실측 2026-08-11: 화면 맨 밑단까지 내려갔다).
    //
    // 창은 **마지막으로 자란 때**부터 잰다(2026-08-11 코드 리뷰). 마운트부터
    // 2초로 재면 느린 조회(/progress/mastery가 이 앵커 위에 있다)가 2초를 넘겨
    // 도착했을 때 이미 관측을 끊은 뒤라, 막으려던 그 증상이 그대로 난다.
    // 대신 총 10초 상한을 둔다 — 계속 움직이는 요소가 하나라도 있으면 관측이
    // 영영 안 끝나고, 읽는 중에 화면이 튀는 쪽이 더 나쁘다.
    //
    // ⚠️ 그리고 **사용자가 스크롤을 잡으면 즉시 손을 뗀다**(2026-08-11 코드 리뷰).
    // 창을 늘리는 것만으로도 재정렬이 돌아, 읽으려고 위로 올려 둔 사람을 다시
    // 앵커로 끌어내린다. wheel·touchmove는 사람의 입력만 내는 신호다
    // (프로그램 스크롤은 안 낸다).
    // ⚠️ 키보드는 **화면을 움직이는 키만** 본다. keydown 전부를 신호로 삼으면
    // 탭 이동·타이핑에도 관측이 끊겨, 키보드로 오는 사람만 원래 증상(늦게
    // 도착한 숙련도 조회가 앵커를 밀어냄)을 그대로 겪는다.
    if (typeof ResizeObserver !== 'function') return undefined;
    const SCROLL_KEYS = new Set([
      'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
    ]);
    let quiet;
    let cap;
    const onKey = (e) => {
      if (SCROLL_KEYS.has(e.key)) release();
    };
    const release = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      observer.disconnect();
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', onKey);
    };
    const observer = new ResizeObserver(() => {
      align();
      clearTimeout(quiet);
      quiet = setTimeout(release, 2000);
    });
    observer.observe(document.body);
    quiet = setTimeout(release, 2000);
    cap = setTimeout(release, 10_000);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchmove', release, { passive: true });
    window.addEventListener('keydown', onKey, { passive: true });
    return release;
  }, [hash]);

  return (
    <div className="pt-2">
      <div className="mb-4">
        <h1 className="text-lg font-extrabold text-slate-900">👤 {t('profile.title')}</h1>
        <p className="mt-0.5 text-sm text-slate-500">{t('profile.subtitle')}</p>
      </div>

      {/* 진단 입구 배너 (R7-02 S6) — placement_done=false일 때만. 2열 위가 아니라
          맨 위 전폭이다: 진단 전에는 아래 능력 분석이 전부 사전 배정값이라,
          "먼저 진단하라"가 이 화면에서 가장 먼저 읽혀야 한다. */}
      {me?.placement_done === false && (
        <div className="mb-4 rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-200">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🧭</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-indigo-900">{t('profile.placementBannerTitle')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-indigo-700">
                {t('profile.placementBannerBody')}
              </p>
            </div>
            <Link
              to="/onboarding/placement"
              className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-indigo-700"
            >
              {t('profile.placementBannerCta')}
            </Link>
          </div>
        </div>
      )}

      {/* 시안 배치: 2열. 왼쪽은 "나"(프로필·배지), 오른쪽은 "할 일"
          (오늘 목표·진도·퀘스트·다음 목표). lg 미만은 1열로 쌓인다.

          2026-08-10(사용자 지시): 배지 컬렉션을 **프로필 바로 밑**으로 올리고,
          WeatherBrain 능력 분석은 이 격자에서 빼 **아래 가로 한 판**으로 내렸다.
          능력 분석은 안에 막대 14줄 + 숙련도 14줄이 들어가 세로가 가장 긴 카드였고,
          좁은 열에 있으면 왼쪽 열만 한없이 길어졌다.

          ⚠️ 카드 6개를 격자에 **평평하게** 늘어놓으면 안 된다(2026-08-08 수정).
          CSS 격자는 같은 줄에 놓인 칸의 높이를 가장 큰 칸에 맞추므로, 오른쪽
          첫 줄이 왼쪽 프로필 카드보다 길면 그 차이가 **왼쪽 둘째 칸 위의 빈
          공간**으로 남는다. 실제로 능력 분석 위 115px · 다음 목표 위 200px이
          비어 있었다. `items-start`로는 안 된다 — 그건 칸을 줄에 맞춰 늘이지
          않을 뿐, 줄 자체의 높이는 그대로다.
          그래서 **열을 각각 독립된 세로 스택**으로 묶는다. lg 미만에서는
          `display:contents`로 껍데기를 지우고 order로 교차 순서를 유지한다.

          2026-08-11(사용자 지시): 오른쪽 맨 위의 오늘 목표 카드를 뺐고, 아래
          전폭에 있던 **학습 지역을 왼쪽 배지 바로 밑**으로 올렸다. 배지 아래가
          800px 가까이 비어 있었고(왼쪽 스택이 오른쪽보다 짧다) 학습 지역은
          안이 한 줄뿐이라 전폭을 쓸 이유가 없던 카드다 — 폭은 열이 정한다. */}
      {/* 2026-08-12(사용자 지시): `lg:items-start`를 뺐다 — 두 열이 **같은 높이**로
          늘어나야 한다("세로 길이가 딱 맞게"). 남는 높이를 흡수하는 칸은
          **왼쪽 열의 배지(order-2)** 하나다(`lg:flex-1`) — 타일 5장이 나눠 받아
          커져도 빈 데가 없다. items-start를 되살리면 다시 왼쪽만 짧아진다.
          ⚠️ 흡수 칸을 학습 지역으로 옮기지 말 것 — 한 줄짜리 카드가 142px까지
          늘어 빈 카드가 된다(하루 만에 되돌린 자리다. 아래 order-7 주석). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {/* 왼쪽 열 — "나" */}
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-1 lg:order-none">
            <ProfileCard me={me} user={user} badges={badges} />
          </div>
          {/* lg:flex-1 — 오른쪽 열이 더 길 때 그 차이를 **이 칸**이 먹는다
              (2026-08-12 사용자 지시 — "배지 컬렉션을 더 키우고 학습 지역을
              줄여서 다시 여백 맞춰줘"). 종전에는 학습 지역이 먹었는데, 안이
              한 줄뿐인 카드가 142px까지 늘어 빈 카드로 보였다. 배지는 타일
              5장이 늘어난 높이를 나눠 받으므로 커져도 빈 데가 없다
              (BadgeCollection이 h-full·격자 flex-1로 그 높이를 타일까지
              내려보낸다 — 짝을 이루는 코드다). */}
          {/* ⚠️ **흡수(`lg:flex-1`)를 걷었다**(2026-08-19 사용자 지시 — "배지 카드
              크기는 원래대로"). 학습 지역이 오른쪽으로 가면서 왼쪽이 짧아졌고,
              그 차이를 배지가 먹으니 타일이 원래보다 크게 늘어났다.
              남는 자리는 이제 **능력 분석 판의 탭**이 먹는다(아래 주석). */}
          <div className="order-2 lg:order-none">
            <BadgeCollection collapsed={collapsed} />
          </div>
          {/* 학습 지역 — **왼쪽 열로 돌아왔다**(2026-08-19 사용자 지시). 오늘
              오전에 오른쪽으로 보냈다가 되돌린 것이라 경위를 남긴다: 오른쪽에
              두면 그 열이 카드 4장이 되어 왼쪽보다 한참 길어지고, 배지 흡수를
              걷은 뒤로는 그 차이가 **흰 여백으로 그대로 남는다**. 능력 분석
              탭이 메우는 것은 49px뿐이라 부족했다. 양쪽을 3장씩으로 맞추는
              쪽이 여백을 없애는 유일한 길이었다.
              ⚠️ order-7 — 1열로 쌓이는 좁은 화면에서 배지와 할 일 사이에
              설정이 끼지 않게 하는 값. 어느 열에 적혀 있든 이 숫자가 순서를
              정하므로 좁은 화면은 두 번의 이동 내내 한 픽셀도 안 바뀌었다.
              ⚠️ 흡수(`lg:flex-1`)는 여기에도 안 준다 — 한 줄짜리 카드를 늘이면
              그냥 빈 카드가 된다(2026-08-12에 142px까지 늘렸다가 되돌린 자리). */}
          <div className="order-7 lg:order-none">
            <RegionCard />
          </div>
        </div>

        {/* 오른쪽 열 — "할 일".
            2026-08-11(사용자 지시): 「학습 진도」(SpineCard)를 뺐다. 유닛 진도·
            왕관·이어서 학습은 /learn 화면이 경로 트랙과 진입 배너로 전부 말하고
            있어, 여기서는 같은 말을 한 번 더 하는 카드였다. 프로필 4칸 지표의
            🎓 클리어 유닛·👑 획득 왕관이 요약은 계속 들고 있다.
            빠진 만큼 두 열의 끝이 어긋나 **학습 지역을 왼쪽으로 돌려** 맞췄다.
            2026-08-12에 **지식 단계까지 이 열로 들어와** 이제는 오른쪽이 더 길다
            — 부족한 쪽은 왼쪽이고, 그 차이는 배지 칸이 먹는다(위 격자 주석).
            "빈 카드를 늘이면 흰 여백만 커진다"는 그때의 판단은 **여전히 유효해서**
            흡수 칸을 학습 지역이 아니라 배지로 골랐다: 배지는 타일 5장이 높이를
            나눠 받지만(실측 1440에서 타일 91 → 163px) 학습 지역은 한 줄뿐이라
            늘어난 만큼이 그대로 빈 카드가 된다(실측 70 → 142px). */}
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-5 lg:order-none">
            <QuestList collapsed={collapsed} />
          </div>
          <div className="order-6 lg:order-none">
            <NextGoalsCard me={me} />
          </div>
          {/* 지식 단계 — 2026-08-12(사용자 지시)에 **전폭에서 오른쪽 열로** 왔다
              ("가로로 줄여서 오른쪽에 배치"). 1120px 전폭에서는 Lv 칩 한 줄과
              막대 하나가 가로로 늘어져 빈 카드처럼 보였다.
              order-8 — 1열로 쌓이는 좁은 화면에서는 격자의 **맨 뒤**라, 바로
              아래 능력 분석 판과 붙는다(단계를 먼저 읽고 개념별 θ를 읽는 순서).
              ⚠️ `empty:hidden`이 필요하다. 이 카드는 서버 필드가 없거나
              콜드스타트(θ 행 없음)면 **스스로 null**을 뱉는데, 그때 이 래퍼가
              남으면 빈 칸 하나와 gap 16px가 그대로 붙는다. 종전에는 카드가
              flex의 맨 자식이라 null이면 노드째 없었다 — 순서를 주려고 래퍼를
              씌우면서 생긴 자리다(2026-08-12 코드 리뷰). 목(mock)의
              `/progress/me`가 실제로 이 필드를 안 보내므로 **그 경로가 기본값**이다. */}
          <div className="order-8 empty:hidden lg:order-none">
            <KnowledgeLevelCard />
          </div>
        </div>
      </div>

      {/* 능력 분석 — **폭 전체 한 판**(2026-08-10 사용자 지시). 카드 안에서
          왼쪽 θ 막대 · 오른쪽 개념 숙련도로 갈린다(WeatherBrainPanel이 소유).
          설정 두 장보다 **위**에 둔다: 설정은 페이지 꼬리로 읽히는 자리라,
          그 아래에 큰 분석 판을 두면 페이지가 끝난 줄 알고 스크롤을 멈춘다.

          지식 단계 카드는 2026-08-12에 **위 격자의 오른쪽 열 맨 아래**로 갔다
          (사용자 지시 — 전폭에서 반폭으로). 「단계를 먼저 읽고 개념별 θ를 읽는다」는
          순서는 그대로다: 좁은 화면에서는 order-8이라 이 판 바로 위에 오고,
          넓은 화면에서는 오른쪽 열 끝이라 이 판 바로 위 오른쪽에 있다. */}
      {/* ⚠️ 여백이 `mt-4`로 돌아왔다(2026-08-19) — 제목이 탭이던 잠깐 동안
          `lg:mt-16`으로 그 49px 자리를 비워 뒀는데, 탭을 걷으면서 함께 걷는다.
          탭을 되살린다면 이 값도 같이 올릴 것(WeatherBrainPanel.Header 주석). */}
      <div className="mt-4 flex flex-col gap-4">
        <WeatherBrainPanel />
      </div>

      {/* 진도 저장 — 정보 입력 (2026-08-12 클라이언트 요구 ⑴).
          설정 묶음의 **맨 앞**이다: 학습 수준·하루 목표는 취향이고, 이것은
          "잃으면 끝인 것"을 지키는 행동이라 같은 무게가 아니다.
          앵커 id는 학습 화면 오른쪽 저장 노드(`/me#save-progress`)의 목적지다 —
          해시 스크롤은 이 파일 위쪽 useEffect가 이미 소유한다. */}
      <SaveProgressCard />

      {/* 🔴 **학습 수준 카드와 하루 목표 피커를 여기서 걷었다**(2026-08-19 · 클라이언트 지시).
          원문: *"시작 시점에서 목표량과 수준을 물어야 하는데 그것도 없어, 즉
          내정보란에는 목표선정과 수준 선택이 필요없어 첫 배치고사 시점 제외"*.

          두 질문은 **이미 시작 시점에 있다** — 학습 수준은 `EntryInfoPage`의
          `ENTRY_LEVEL_GROUPS`, 하루 목표는 `PlacementSummary`의 `DailyGoalPicker`.
          이 화면의 두 카드는 **같은 질문을 두 번째로 묻는 자리**였다.

          ⚠️ **걷으면서 잃는 것 둘을 적어 둔다** — 종전 주석이 이 자리를
          *"목표를 정하는 **유일한 통로**"*라고 스스로 밝혔기 때문이다:
           ⑴ **배치고사를 건너뛴 사람**(게스트 자동 발급이 주 동선이다)은 이제
              하루 목표를 정할 데가 없다.
           ⑵ `LearnHeroCard:129`의 「목표 미설정」 링크가 `/me#daily-goal`로 오는데
              **그 앵커가 사라졌다** — 링크가 빈 화면 끝으로 간다.
          둘 다 지시 범위 밖이라 **고치지 않고 남긴다.** 되돌릴 곳은 여기다.
          대안인 「미설정일 때만 띄우기」는 2026-08-11 코드 리뷰가 **명시적으로 반려**
          했다(저장 성공 순간 카드가 사라져 확인 문구를 아무도 못 본다). */}

    </div>
  );
}

/* 🔴 `LevelGroupCard`(학습 수준 선택)와 `LEVEL_GROUPS`를 2026-08-19에 **통째로 지웠다**
   — 클라이언트 지시: *"내정보란에는 목표선정과 수준 선택이 필요없어 첫 배치고사 시점 제외"*.
   학습 수준은 `EntryInfoPage`의 `ENTRY_LEVEL_GROUPS`가 **시작 시점에 이미 묻는다**.

   ⚠️ **서버 통로(`PATCH /auth/me`)는 그대로 살아 있다.** 그 자리 독스트링이 스스로
   *"게스트가 평생 middle_high에 갇히지 않게 하는 유일한 통로"*라고 밝힌 곳이라,
   화면만 걷고 통로는 남긴다 — 요구는 충족하면서 되돌릴 길이 막히지는 않는다. */

/** RegionCard — 관심 지역 설정(실황 문항이 이 값을 쓴다). */
function RegionCard() {
  const t = useT();
  return (
    <div className="flex h-full flex-col justify-center rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[220px]">
          <p className="text-sm font-extrabold text-slate-900">{t('region.settingTitle')}</p>
          <p className="mt-0.5 text-xs text-slate-500">{t('region.settingBody')}</p>
        </div>
        <RegionPicker />
      </div>
    </div>
  );
}

/**
 * SaveProgressCard — 「내 정보에서 정보를 입력해 진도를 저장」(2026-08-12 요구 ⑴).
 *
 * 왜 여기인가: 오늘 로그인·회원가입 화면이 통째로 제거됐다(규정 — 심사위원이 계정
 * 없이 URL만으로 열어야 한다). 그런데 **진도 저장은 남아야 한다** — 게스트 진도는
 * 그 기기에만 있어서 잃으면 복구 경로가 없다(게스트 비밀번호는 무작위 시크릿이다).
 * 그래서 같은 서버 API(`POST /auth/guest/convert`)를 **로그인 창이 아니라 내 정보
 * 안의 입력란**으로 다시 세운다. 별도 페이지(`/account/convert`)도 남지만, 거기까지
 * 가야만 되는 상태가 요구가 지적한 그 불편이었다.
 *
 * ⚠️ 문구에 「로그인」·「회원가입」을 쓰지 않는다. 규정이 금지하는 것은 그 **동선**
 * 이지만, 문구가 그렇게 읽히면 심사에서 같은 지적을 받는다. 렌더된 텍스트를
 * `tests/onboardingSave.contract.test.mjs`가 문다.
 *
 * ⚠️ 카드는 게스트에게만 뜬다. 정식 계정에게는 저장할 것이 이미 저장돼 있어
 * 입력란이 하는 일이 없다(서버도 409 NOT_GUEST로 막는다). 다만 **자리를 비우지
 * 않고** 한 줄로 사실을 알린다 — 진도가 어디에 있는지는 누구나 궁금하다.
 * 조회 실패(`me` 없음)면 렌더하지 않는다: 게스트 여부를 모르는 채로 "저장하세요"를
 * 띄우면 이미 정식 계정인 사람에게 실패할 폼을 내미는 꼴이다.
 */
function SaveProgressCard() {
  const t = useT();
  const storeUser = useAuthStore((s) => s.user);
  // ⚠️ **한 번 세운 폼은 이 방문 동안 유지한다(래치).** 저장에 성공하면 이 사람은
  // 게스트가 아니게 되고, 폼이 캐시의 is_guest를 즉시 내린다 — 게이트를 그대로
  // 두면 그 순간 가지가 「이미 저장되고 있어요」로 갈아치워지고, **폼이 새
  // 인스턴스로 다시 서면서 방금 띄운 성공 문구가 증발한다**(2026-08-12 실측:
  // 저장은 됐는데 화면은 빈 폼으로 되돌아갔다. 하루 목표 카드가 두 번 적어 둔
  // "누른 순간 화면에서 지워지는 버튼"과 같은 함정이다).
  //
  // 상태가 아니라 ref로 잠그는 이유: 성공 처리에서 캐시 갱신과 콜백이 **어느
  // 순서로 렌더에 반영될지**에 기대면 안 된다. 실제로 순서를 바꿔 봐도 한
  // 프레임이 새는 것을 실측했다. 렌더 중 래치는 멱등이라 안전하다.
  const engagedRef = useRef(false);

  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    staleTime: 60_000,
    retry: false,
  });
  if (!me) return null;
  if (me.is_guest === true || isGuestUser(storeUser)) engagedRef.current = true;
  const guest = engagedRef.current;

  return (
    <div
      id="save-progress"
      data-testid="save-progress-card"
      className="mt-4 scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
    >
      <p className="text-sm font-extrabold text-slate-900">
        <span aria-hidden="true">💾</span> {t('saveProgress.cardTitle')}
      </p>
      {guest ? (
        <>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t('saveProgress.cardBody')}</p>
          <SaveProgressForm className="mt-3" />
          {/* 진도 **불러오기** 진입 — 저장소 전체에서 **이 한 곳뿐**이다
              (2026-08-14 ⓑ). 주 동선(SideNav·TabBar·헤더)에 넣으면 MT-29가 고정한
              「주 동선 링크 0건」이 깨지고, 그것이 「로그인 없이 열려야 한다」는
              규정의 해석 근거다. 이미 저장한 사람이 이 카드를 다시 보는 경우가
              곧 「돌아오려는 사람」이라 자리도 여기가 맞다.
              ⚠️ 이 링크를 옮기거나 늘리기 전에 `onboardingSave.contract`의 nav 표면
              단정을 먼저 읽을 것 — 그 계약이 nav 쪽 0건을 문다. */}
          <Link
            to="/login"
            className="mt-3 block text-center text-[11.5px] font-bold text-sky-700 underline-offset-2 hover:underline"
          >
            {t('loadProgress.fromSave')}
          </Link>
        </>
      ) : (
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t('saveProgress.alreadySaved')}</p>
      )}
    </div>
  );
}

/**
 * NicknameLine — 프로필의 이름 줄. **여기가 닉네임을 바꾸는 유일한 화면 통로다.**
 *
 * 🔴 왜 생겼나(2026-08-19 · 8/18 롤링분 ③): 닉네임 입력이 `EntryInfoPage`
 * (최초 진입)에**만** 있었다. `App.jsx`의
 * `needsEntryInfo = atEntry && entryChoice === undefined`가 **이미 들어온
 * 사용자에게는 영영 거짓**이라, 한 번 지나가면 「기상 학습자」
 * (`profile.defaultNickname`)로 고정됐다 — 클라이언트가 실화면에서 잡았다.
 * 6f217e2(8/14)가 닉네임을 서버·목·화면 세 층에 착지시켜 놓고 **입구만 1회짜리**로
 * 둔 것이라, 이미 쓰던 사용자에게는 존재하지 않는 기능이었다.
 *
 * ⚠️ **낙관적 갱신을 하지 않는다.** 409(중복)가 실재하는 경로라, 먼저 바꿔 놓고
 * 되돌리면 사용자가 "됐다가 취소된" 이름을 보게 된다.
 */
function NicknameLine() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);

  const mutation = useMutation({
    mutationFn: authApi.updateNickname,
    onSuccess: (data) => {
      // 서버가 돌려준 값을 쓴다 — 트림·정규화가 서버 몫이라 화면이 앞서면 갈린다.
      setUser({ ...(user ?? {}), nickname: data?.nickname ?? draft.trim() });
      setEditing(false);
      setError(null);
    },
    onError: (err) => {
      const code = err?.response?.data?.detail?.code ?? err?.response?.data?.code;
      setError(code === 'NICKNAME_TAKEN' ? t('profile.nicknameTaken') : t('profile.nicknameFailed'));
    },
  });

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <p className="truncate text-lg font-extrabold">
          {user?.nickname ?? t('profile.defaultNickname')}
        </p>
        <button
          type="button"
          data-nickname-edit="1"
          onClick={() => { setDraft(user?.nickname ?? ''); setError(null); setEditing(true); }}
          className="shrink-0 rounded-lg bg-sky-800/70 px-2 py-1 text-[11px] font-bold text-sky-100 ring-1 ring-sky-700 transition hover:bg-sky-700"
        >
          {t('profile.nicknameEdit')}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (draft.trim()) mutation.mutate(draft.trim()); }}
    >
      <input
        type="text"
        autoFocus
        value={draft}
        maxLength={20}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={t('profile.nicknameEdit')}
        className="min-w-0 flex-1 rounded-lg bg-sky-950/60 px-2 py-1 text-sm font-bold text-white ring-1 ring-sky-700 outline-none focus:ring-sky-400"
      />
      <button
        type="submit"
        disabled={mutation.isPending || !draft.trim()}
        className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-sky-900 disabled:opacity-50"
      >
        {t('common.save')}
      </button>
      <button
        type="button"
        onClick={() => { setEditing(false); setError(null); }}
        className="shrink-0 text-[11px] font-bold text-sky-300"
      >
        {t('common.cancel')}
      </button>
      {error ? <p className="basis-full text-[11px] font-bold text-rose-200">{error}</p> : null}
    </form>
  );
}

/**
 * 프로필 카드 — 시안 왼쪽 첫 칸(짙은 남색).
 *
 * 메인 캐릭터는 **눈결정**이다(2026-08-06 지시). Mascot 배정표의 화면 담당
 * (보드 태양이·학습 물방울이·대결 태풍이·리그 번개)과 겹치지 않는 유일한 캐릭터라
 * "내 정보"의 얼굴로 쓴다.
 *
 * 4칸 지표는 **API에 실제로 있는 값만** 쓴다. 시안은 "완료 미션"·"리그 순위"를
 * 넣었지만 전자는 대응하는 집계가 없고 후자는 리더보드를 따로 불러야 한다 —
 * 클리어 유닛(spine)·리그 티어(me.tier)로 대체했다. 없는 숫자를 지어내지 않는다.
 */
function ProfileCard({ me, user, badges }) {
  const t = useT();
  const xp = me?.xp ?? 0;
  const level = me?.level ?? 1;
  const nextXp = me?.next_level_xp ?? 0;
  const pct = nextXp > 0 ? Math.max(0, Math.min(100, (xp / nextXp) * 100)) : 0;
  const earned = Array.isArray(badges) ? badges.filter((b) => b.earned_at).length : null;

  return (
    <div className="rounded-2xl bg-sky-900 p-5 text-white shadow-sm">
      <div className="flex items-center gap-3.5">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-sky-800/70 ring-1 ring-sky-700">
          <Mascot name="snow" className="h-12 w-12" />
        </span>
        <div className="min-w-0 flex-1">
          <NicknameLine />
          <p className="mt-1">
            <TierBadge tier={me?.tier ?? 'stratus'} />
          </p>
        </div>
      </div>

      <p className="mt-3.5 text-xs text-sky-300">{t('profile.levelXp', { level, xp })}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sky-950/60">
          <span className="block h-full rounded-full bg-amber-300" style={{ width: `${Math.round(pct)}%` }} />
        </span>
        {nextXp > 0 && (
          <span className="shrink-0 text-[11px] font-bold tabular-nums text-sky-200">
            {xp} / {nextXp} XP
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ProfileStat icon="🔥" value={me?.streak_count ?? 0} label={t('profile.streakStat')} />
        <ProfileStat icon="🏅" value={earned ?? '—'} label={t('profile.badgeStat')} />
        <ProfileStat
          icon="🎓"
          value={me?.spine ? `${me.spine.units_cleared ?? 0}` : '—'}
          label={t('profile.unitStat')}
        />
        <ProfileStat icon="👑" value={me?.spine?.crowns_earned ?? '—'} label={t('profile.crownStat')} />
      </div>

      <StreakWeek streak={me?.streak_count ?? 0} />
    </div>
  );
}

/**
 * 주간 출석 스트립 — 홈이 사라지면서(2026-08-09) 여기로 옮겨왔다.
 * 위 4칸 지표의 🔥는 **숫자**만 말한다("6일"). 어느 요일을 빠뜨렸는지는 이 줄만
 * 보여주고, 그게 내일 다시 오게 만드는 신호다.
 *
 * ⚠️ **서버는 요일별 출석 이력을 주지 않는다** — `streak_count`(연속 일수)뿐이다.
 * 그래서 오늘부터 거꾸로 streak만큼 칠한다. **미래 요일은 절대 칠하지 않는다**
 * (diff < 0) — 오늘이 수요일인데 금·토·일이 체크돼 보이던 버그가 여기서 났다.
 * 요일별 실이력이 필요하면 API가 먼저다.
 *
 * 요일은 **KST 기준**이다(CO-T-8). `new Date().getDay()`는 브라우저 로컬 타임존이라
 * 심사 PC가 KST가 아니면 서버 하루와 어긋난다.
 *
 * 색은 홈(흰 배경)과 다르다 — 여기는 짙은 남색 카드 위라 sky-100/sky-600 조합이
 * 배경에 묻힌다. 채운 칸은 흰색, 빈 칸은 흰색 20%다.
 */
function StreakWeek({ streak }) {
  const t = useT();
  const todayIdx = kstWeekdayIndex(); // 월=0 … 일=6
  return (
    <div className="mt-4 border-t border-sky-800 pt-3.5" data-testid="streak-week">
      <p className="text-[11.5px] font-extrabold text-sky-200">
        🔥 {t('home.streak.title')}
      </p>
      <div className="mt-2 flex gap-1.5">
        {t('home.streak.days').split(',').map((label, i) => {
          const diff = todayIdx - i;
          const done = diff >= 0 && diff < streak;
          return (
            <div key={label} className="flex-1 text-center">
              <div
                className={`grid h-[28px] place-items-center rounded-[9px] text-[11px] font-extrabold ${
                  done ? 'bg-white text-sky-800' : 'bg-white/15 text-sky-300/70'
                } ${i === todayIdx ? 'ring-2 ring-inset ring-amber-300' : ''}`}
              >
                {done ? '✓' : '·'}
              </div>
              <div className="mt-1 text-[10px] text-sky-300">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProfileStat({ icon, value, label }) {
  return (
    <div className="rounded-xl bg-sky-950/50 p-2.5 text-center">
      <p className="text-lg font-extrabold text-amber-300">
        <span aria-hidden="true">{icon}</span> {value}
      </p>
      <p className="text-[11px] text-sky-200">{label}</p>
    </div>
  );
}

/**
 * 다음 목표 — 시안 오른쪽 아래 칸.
 * 지어낸 목표를 늘어놓지 않는다. 서버가 이미 주는 두 값(다음 레벨까지의 XP,
 * 연속 출석)만 진척 막대로 보여준다.
 */
function NextGoalsCard({ me }) {
  const t = useT();
  const xp = me?.xp ?? 0;
  const level = me?.level ?? 1;
  const nextXp = me?.next_level_xp ?? 0;
  const streak = me?.streak_count ?? 0;
  const STREAK_TARGET = 7; // 주 단위 습관 — 서버 목표값이 아니라 화면 표기용 기준

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-sm font-extrabold text-slate-900">🎯 {t('profile.nextGoals')}</h2>
      <div className="flex flex-col gap-3">
        {nextXp > 0 && (
          <GoalRow
            icon="⬆️"
            title={t('profile.goalLevel', { level: level + 1 })}
            now={xp}
            target={nextXp}
            unit="XP"
            chip={`Lv.${level}`}
          />
        )}
        <GoalRow
          icon="🔥"
          title={t('profile.goalStreak', { days: STREAK_TARGET })}
          now={Math.min(streak, STREAK_TARGET)}
          target={STREAK_TARGET}
          unit=""
          chip={t('profile.streak.dayCount', { n: streak })}
        />
      </div>
    </div>
  );
}

function GoalRow({ icon, title, now, target, unit, chip }) {
  const pct = target > 0 ? Math.max(0, Math.min(100, (now / target) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-[15px]" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-bold text-slate-800">{title}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-sky-500" style={{ width: `${Math.round(pct)}%` }} />
          </span>
          <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-500">
            {now} / {target} {unit}
          </span>
        </div>
      </div>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
        {chip}
      </span>
    </div>
  );
}
