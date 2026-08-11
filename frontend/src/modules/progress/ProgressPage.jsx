import { useEffect, useState } from 'react';
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
import { DailyGoalPicker, GOAL_ANCHOR } from './DailyGoal';
import { selectUnlockStage, useOnboardingGate } from '../../lib/onboardingGate';
// R12 선행 §8 — 학습 지역 설정(자급 컴포넌트, 제작 FE-R)
import RegionPicker from '../../components/RegionPicker';
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
 * R8-01 §3.7④ — 스파인 카드: /progress/me의 spine(§3.3)으로 유닛 진도율·왕관·
 * current_unit을 보여주고 "이어서 학습"으로 해당 유닛 세션에 바로 진입시킨다.
 * 제품 결정(§1) "유닛 진척 1순위"에 따라 프로필 헤더 바로 아래 배치.
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start">
        {/* 왼쪽 열 — "나" */}
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-1 lg:order-none">
            <ProfileCard me={me} user={user} badges={badges} />
          </div>
          <div className="order-2 lg:order-none">
            <BadgeCollection collapsed={collapsed} />
          </div>
          {/* order-7 — lg에서는 왼쪽 열 3번째지만, 1열로 쌓이는 좁은 화면에서는
              **이 격자의 맨 뒤**로 보낸다. 배지와 스파인 사이에 끼면 「나」와
              「할 일」 사이에 설정이 하나 박힌 꼴이 된다(2026-08-11 코드 리뷰).
              ⚠️ 그렇다고 학습 수준·하루 목표와 **붙지는 않는다** — 그 둘은 격자
              바깥이고 사이에 능력 분석 판이 있다. 설정 셋을 한 덩어리로 모으려면
              카드를 격자 밖으로 빼야 하는데, 그러면 lg에서 왼쪽 열의 빈자리를
              메우지 못한다(이 이동의 목적이 그것이었다). 여기서 얻는 것은
              「중간에 안 낀다」까지다. */}
          <div className="order-7 lg:order-none">
            <RegionCard />
          </div>
        </div>

        {/* 오른쪽 열 — "할 일" */}
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          {/* 스파인 카드 (R8-01 §3.7④) — spine 부재(구 백엔드) 시 미렌더 */}
          {me?.spine && (
            <div className="order-3 lg:order-none">
              <SpineCard spine={me.spine} />
            </div>
          )}
          <div className="order-5 lg:order-none">
            <QuestList collapsed={collapsed} />
          </div>
          <div className="order-6 lg:order-none">
            <NextGoalsCard me={me} />
          </div>
        </div>
      </div>

      {/* 능력 분석 — **폭 전체 한 판**(2026-08-10 사용자 지시). 카드 안에서
          왼쪽 θ 막대 · 오른쪽 개념 숙련도로 갈린다(WeatherBrainPanel이 소유).
          설정 두 장보다 **위**에 둔다: 설정은 페이지 꼬리로 읽히는 자리라,
          그 아래에 큰 분석 판을 두면 페이지가 끝난 줄 알고 스크롤을 멈춘다. */}
      <div className="mt-4">
        <WeatherBrainPanel />
      </div>

      {/* 설정 — 학습 수준 (R13 CO-P-5) */}
      <LevelGroupCard />

      {/* 설정 — 하루 목표. 2026-08-11(사용자 지시)에 오른쪽 맨 위에서 **내려왔다**.
          지우지 않고 옮긴 이유: 이 화면이 목표를 정하는 **유일한 통로**다.
          배치고사를 건너뛴 사람(게스트 자동 발급이 주 동선이다)은 여기 말고
          정할 데가 없고, /learn 배너의 「목표 미설정」 링크도 여기로 온다.

          ⚠️ **미설정일 때만 띄우지 말 것**(2026-08-11 코드 리뷰). 저장에 성공하면
          picker의 onSuccess가 같은 캐시를 갱신하므로 카드가 그 자리에서 사라져,
          「N문항으로 정했어요」 확인 문구를 아무도 못 본다 — 누른 순간 화면에서
          지워지는 버튼이 된다. 학습 수준 카드와 같이 **늘 떠 있는 설정**으로 둔다
          (picker가 현재 선택을 강조하고 저장 문구도 스스로 띄운다).
          진행도 표시(DailyGoalMeter)는 걷었다 — /learn 배너와 세션 완료 화면이
          같은 값을 이미 보여준다.

          ⚠️ `me`는 **기다린다**(LevelGroupCard와 같은 이유). 조회 전에 그리면
          현재값을 모르는 채로 아무것도 강조되지 않아, 이미 9문항으로 정해 둔
          사람이 「미설정」으로 읽고 모르게 덮어쓴다. 저장 뒤에는 `me`가 그대로
          참이라 카드도 그대로 남는다 — 위 ⚠️와 충돌하지 않는다.

          ⚠️ 조회가 **실패하면 자리를 비우지 않는다**(2026-08-11 코드 리뷰).
          `me &&`만 두면 실패 시 카드가 조용히 사라져, 목표를 정하러 앵커를 타고
          온 사람이 빈 화면 끝을 본다 — 통로가 끊긴 것과 같은데 이유도 안 보인다.
          현재값을 모르니 선택지는 안 내주고, **왜 못 그리는지와 다시 시도**를
          같은 자리(같은 앵커 id)에 놓는다. */}
      {me ? (
        <DailyGoalPicker id={GOAL_ANCHOR} className="mt-4 scroll-mt-4" />
      ) : meFailed ? (
        <div
          id={GOAL_ANCHOR}
          className="mt-4 scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
        >
          <p className="text-sm font-extrabold text-slate-900">{t('dailyGoal.pickerTitle')}</p>
          <p className="mt-0.5 text-xs text-slate-500">{t('dailyGoal.loadFailed')}</p>
          {/* 재시도 중에는 **눌린 티가 나야 한다**(2026-08-11 코드 리뷰).
              react-query는 실패 상태를 유지한 채 다시 부르므로, 표시를 안 바꾸면
              백엔드가 죽어 있는 사람에게는 눌러도 아무 일이 없는 버튼이 된다. */}
          <button
            type="button"
            disabled={meFetching}
            onClick={() => refetchMe()}
            className="mt-3 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {meFetching ? t('common.loading') : t('common.retry')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 학습 지역 (R12 선행 §8) — 퀴즈 실황·피드백 날씨의 기준 지역.
 * 대결/브리핑·리그는 서울 고정(PM 정정 2026-08-05 — 지역 예보로 예측하고 서울
 * 실측으로 채점되는 정합성 문제) — 대결 화면에는 칩을 달지 않는다.
 *
 * 2026-08-11: 페이지 꼬리의 전폭 카드에서 **왼쪽 열**로 올라왔다. 열 폭이
 * 절반(약 552px)이라 설명과 지역 칩이 한 줄에 안 들어갈 수 있어, 좁아지면
 * 칩이 아랫줄로 내려가게 `flex-wrap`으로 둔다.
 */
function RegionCard() {
  const t = useT();
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
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

/** 학령 3값 — 서버 schemas/auth.LevelGroup Literal과 같은 순서·값 */
const LEVEL_GROUPS = [
  { value: 'elementary', labelKey: 'auth.register.elementary' },
  { value: 'middle_high', labelKey: 'auth.register.middleHigh' },
  { value: 'adult', labelKey: 'auth.register.adult' },
];

/**
 * LevelGroupCard — 학습 수준 설정 (R13 CO-P-5).
 *
 * 학령 신고 writer가 `POST /auth/register`의 필드 하나뿐이었다. R10-J 이후 주 동선은
 * **게스트 시작**이고 그 경로는 register를 아예 타지 않는다 — 전환도 학령을 안 받고,
 * 배치고사도 θ만 건드린다. 그래서 게스트로 들어온 사람은 초등학생이든 성인이든
 * **평생 middle_high**였고 배치고사로도 못 바꿨다.
 *
 * 통로를 **여기(내 정보)**에 둔 이유: 자동 게스트 발급(CO-N-1 ①) 이후 첫 화면이
 * 로그인이 아니다 — URL만 열면 곧장 홈이라, 시작 화면의 학령 선택지는 심사 5분
 * 동선에 아예 등장하지 않는다. 나중에 바꿀 수 있는 자리가 있어야 잠금이 풀린다.
 *
 * ⚠️ 종전 주석은 "학습 지역 설정이 **바로 위**에 있어 위계가 섰다"고 적었는데,
 * 2026-08-11에 학습 지역이 왼쪽 열로 올라가면서 거짓이 됐다(코드 리뷰). 지금
 * 이 카드와 붙어 있는 것은 **아래의 하루 목표**다 — 페이지 꼬리 = 설정이라는
 * 위계 자체는 그대로다.
 */
function LevelGroupCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(null);

  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    staleTime: 60_000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: authApi.updateLevelGroup,
    onSuccess: (updated) => {
      // 헤더(Layout)도 같은 키를 보고 게스트 여부를 판정한다 — 한 번에 갱신한다.
      queryClient.setQueryData(['auth', 'me'], updated);
      // 배합은 세션 발급 시점에 확정되므로 오늘 세션은 그대로다. 다음 발급이
      // 새 학령을 쓰도록 캐시만 비운다.
      queryClient.invalidateQueries({ queryKey: ['session'] });
      // 보드 잠금은 **즉시** 따라온다(2026-08-10) — 열쇠가 이 값이기 때문이다.
      // 목록 캐시는 staleTime 60초라, 비우지 않으면 수준을 올리고 보드로 가도
      // 1분간 잠긴 채로 보인다. "바꿨는데 안 열린다"가 되면 통로가 없는 것과 같다.
      queryClient.invalidateQueries({ queryKey: ['board', 'puzzles'] });
      setNotice({ ok: true, text: t('profile.levelGroupSaved') });
    },
    onError: (err) => setNotice({ ok: false, text: err?.detail ?? t('profile.levelGroupFailed') }),
  });

  // 서버가 현재 값을 알려주지 않으면 고를 수도 없다 — 조회 실패 시엔 렌더하지 않는다
  // (틀린 현재값을 보여 주고 바꾸게 하는 것보다 없는 편이 낫다).
  if (!me?.level_group) return null;

  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-extrabold text-slate-900">{t('profile.levelGroupTitle')}</p>
      <p className="mt-0.5 text-xs text-slate-500">{t('profile.levelGroupBody')}</p>
      <div className="mt-3 grid grid-cols-3 gap-2" data-level-group={me.level_group}>
        {LEVEL_GROUPS.map((g) => (
          <button
            key={g.value}
            type="button"
            disabled={mutation.isPending}
            aria-pressed={me.level_group === g.value}
            onClick={() => {
              if (me.level_group === g.value) return;
              setNotice(null);
              mutation.mutate(g.value);
            }}
            className={`rounded-xl border px-2 py-2.5 text-sm font-medium transition disabled:opacity-50 ${
              me.level_group === g.value
                ? 'border-sky-600 bg-sky-50 text-sky-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {t(g.labelKey)}
          </button>
        ))}
      </div>
      {mutation.isPending && (
        <p className="mt-2 text-xs text-slate-500">{t('profile.levelGroupSaving')}</p>
      )}
      {notice && !mutation.isPending && (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-xs font-bold ${
            notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
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
          <p className="truncate text-lg font-extrabold">
            {user?.nickname ?? t('profile.defaultNickname')}
          </p>
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
          chip={`${streak}일`}
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

/**
 * SpineCard — 스파인 집계(§3.3) 렌더: 유닛 진도율 바 + 왕관 + current_unit.
 * current_unit이 있으면 "이어서 학습" CTA로 /learn/units/{slug} 세션에 진입,
 * 전 유닛 클리어(current_unit=null)면 완주 상태를 보여준다.
 */
function SpineCard({ spine }) {
  const t = useT();
  const total = spine.units_total ?? 0;
  const cleared = spine.units_cleared ?? 0;
  const ratio = total > 0 ? Math.round((cleared / total) * 100) : 0;
  const current = spine.current_unit;

  return (
    // 바깥 여백은 배치하는 쪽(grid gap)이 갖는다 — mb-4를 여기 두면 gap과 겹쳐
    // 이 카드 아래만 32px가 된다(2열 개편 전 세로 스택 시절의 잔재였다).
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <p className="text-sm font-extrabold text-slate-900">{t('profile.spineTitle')}</p>
        <p className="text-xs font-bold text-amber-500">
          👑 {spine.crowns_earned ?? 0}
          <span className="font-medium text-amber-400">/{spine.crowns_total ?? 0}</span>
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-500 transition-all duration-500"
            style={{ width: `${ratio}%` }}
          />
        </div>
        <p className="shrink-0 text-xs font-bold text-slate-600 tabular-nums">
          {t('profile.spineProgress', { cleared, total, ratio })}
        </p>
      </div>

      {current ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2.5 ring-1 ring-sky-100">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-500">{t('profile.spineCurrentLabel')}</p>
            <p className="truncate text-sm font-bold text-sky-900">{current.title}</p>
          </div>
          <Link
            to={`/learn/units/${current.slug}`}
            className="shrink-0 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-sky-700"
          >
            {t('profile.spineContinue')}
          </Link>
        </div>
      ) : total > 0 && cleared >= total ? (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-center text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
          {t('profile.spineAllCleared')}
        </p>
      ) : (
        // CO-S-7 — `current_unit=null`의 원인은 **둘**이다. 서버 독스트링
        // (`curriculum_service.build_spine`)이 *"전부 클리어 **또는** 전부 잠금이면
        // None"*이라고 명시하는데, 프론트는 한 갈래로 접어 `0/20 · 0%`인 화면에도
        // "🌈 열린 유닛을 모두 클리어했어요!"를 띄웠다. 유닛 미시드·전건 잠금에서
        // 발현한다. cleared가 total에 못 미치면 완주가 아니라 **열린 게 없는** 것이다.
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-center ring-1 ring-slate-200">
          <p className="text-xs font-bold text-slate-600">{t('profile.spineNoneOpen')}</p>
          <Link
            to="/learn"
            className="mt-1.5 inline-block text-xs font-bold text-sky-700 underline underline-offset-4 hover:text-sky-900"
          >
            {t('profile.spineStart')}
          </Link>
        </div>
      )}
    </div>
  );
}
