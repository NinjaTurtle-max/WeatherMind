import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import TierBadge from '../../components/TierBadge';
import QuestList from './QuestList';
import BadgeCollection from './BadgeCollection';
import WeatherBrainPanel from './WeatherBrainPanel';
import { DailyGoalMeter, DailyGoalPicker } from './DailyGoal';
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
 * - "오늘 목표 N/M"(설정 시)·목표 선택(미설정 시 — 배치고사를 건너뛴 사용자 보정).
 * - **첫 세션 전에는 퀘스트·배지를 1개만 노출**해 인지 부하를 줄인다(collapsed).
 *   첫 세션을 마치면(게이트 단계 1) 원래대로 전체가 펼쳐진다 — 기존 사용자는
 *   부트스트랩에서 해제 상태로 계산되므로 회귀가 없다.
 */
export default function ProgressPage() {
  const user = useAuthStore((s) => s.user);
  const unlockStage = useOnboardingGate(selectUnlockStage);
  const t = useT();

  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });

  const xp = me?.xp ?? 0;
  const level = me?.level ?? 1;
  const streak = me?.streak_count ?? 0;
  const tier = me?.tier ?? 'stratus';
  // 첫 세션 전(게이트 단계 0) — 퀘스트·배지를 접어 첫 화면 정보량을 줄인다(§3.4)
  const collapsed = unlockStage < 1;

  return (
    <div className="pt-2">
      {/* 프로필 헤더 */}
      <div className="mb-4 rounded-2xl bg-sky-900 p-5 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold">
              {user?.nickname ?? t('profile.defaultNickname')}
            </p>
            <p className="mt-0.5 text-xs text-sky-300">{t('profile.levelXp', { level, xp })}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-sky-300">
              {t('profile.leagueTier')}
            </p>
            <TierBadge tier={tier} size="md" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-sky-950/50 p-2.5 text-center">
            <p className="text-lg font-extrabold text-amber-300">🔥 {streak}</p>
            <p className="text-[11px] text-sky-200">{t('profile.streakStat')}</p>
          </div>
          <div className="rounded-xl bg-sky-950/50 p-2.5 text-center">
            <p className="text-lg font-extrabold text-amber-300">Lv.{level}</p>
            <p className="text-[11px] text-sky-200">{t('profile.levelStat')}</p>
          </div>
        </div>
      </div>

      {/* 오늘 목표 (R10-01 §3.4) — 설정됐으면 N/M 진행, 미설정이면 선택 1스텝 */}
      {me?.daily_goal_items ? (
        <DailyGoalMeter className="mb-4" />
      ) : (
        <DailyGoalPicker className="mb-4" />
      )}

      {/* 스파인 카드 (R8-01 §3.7④) — spine 부재(구 백엔드) 시 미렌더 */}
      {me?.spine && <SpineCard spine={me.spine} />}

      <div className="mb-5">
        {/* 진단 입구 배너 (R7-02 S6) — placement_done=false일 때만 */}
        {me?.placement_done === false && (
          <div className="mb-3 rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-200">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden="true">🧭</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-indigo-900">{t('profile.placementBannerTitle')}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-indigo-700">
                  {t('profile.placementBannerBody')}
                </p>
              </div>
            </div>
            <Link
              to="/onboarding/placement"
              className="mt-3 block w-full rounded-xl bg-indigo-600 py-2.5 text-center text-sm font-bold text-white transition hover:bg-indigo-700"
            >
              {t('profile.placementBannerCta')}
            </Link>
          </div>
        )}
        <WeatherBrainPanel />
      </div>

      <div className="mb-5">
        <QuestList collapsed={collapsed} />
      </div>

      <BadgeCollection collapsed={collapsed} />

      {/* 설정 — 학습 지역 (R12 선행 §8): 퀴즈 실황·피드백 날씨의 기준 지역.
          대결/브리핑·리그는 서울 고정(PM 정정 2026-08-05 — 지역 예보로 예측하고
          서울 실측으로 채점되는 정합성 문제) — 대결 화면에는 칩을 달지 않는다. */}
      <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900">{t('region.settingTitle')}</p>
            <p className="mt-0.5 text-xs text-slate-500">{t('region.settingBody')}</p>
          </div>
          <RegionPicker />
        </div>
      </div>
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
    <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
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
      ) : (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-center text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
          {t('profile.spineAllCleared')}
        </p>
      )}
    </div>
  );
}
