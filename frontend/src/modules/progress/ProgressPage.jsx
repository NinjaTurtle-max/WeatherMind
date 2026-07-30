import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import TierBadge from '../../components/TierBadge';
import QuestList from './QuestList';
import BadgeCollection from './BadgeCollection';
import WeatherBrainPanel from './WeatherBrainPanel';

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
 */
export default function ProgressPage() {
  const user = useAuthStore((s) => s.user);

  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });

  const xp = me?.xp ?? 0;
  const level = me?.level ?? 1;
  const streak = me?.streak_count ?? 0;
  const tier = me?.tier ?? 'stratus';

  return (
    <div className="pt-2">
      {/* 프로필 헤더 */}
      <div className="mb-4 rounded-2xl bg-sky-900 p-5 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold">
              {user?.nickname ?? '기상 학습자'}
            </p>
            <p className="mt-0.5 text-xs text-sky-300">Lv.{level} · 누적 {xp} XP</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-sky-300">
              리그 티어
            </p>
            <TierBadge tier={tier} size="md" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-sky-950/50 p-2.5 text-center">
            <p className="text-lg font-extrabold text-amber-300">🔥 {streak}</p>
            <p className="text-[11px] text-sky-200">연속 출석</p>
          </div>
          <div className="rounded-xl bg-sky-950/50 p-2.5 text-center">
            <p className="text-lg font-extrabold text-amber-300">Lv.{level}</p>
            <p className="text-[11px] text-sky-200">현재 레벨</p>
          </div>
        </div>
      </div>

      {/* 스파인 카드 (R8-01 §3.7④) — spine 부재(구 백엔드) 시 미렌더 */}
      {me?.spine && <SpineCard spine={me.spine} />}

      <div className="mb-5">
        {/* 진단 입구 배너 (R7-02 S6) — placement_done=false일 때만 */}
        {me?.placement_done === false && (
          <div className="mb-3 rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-200">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden="true">🧭</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-indigo-900">아직 실력 진단 전이에요</p>
                <p className="mt-0.5 text-xs leading-relaxed text-indigo-700">
                  6문항 진단을 받으면 WeatherBrain이 내 수준에 맞는 문제를 골라줘요.
                </p>
              </div>
            </div>
            <Link
              to="/onboarding/placement"
              className="mt-3 block w-full rounded-xl bg-indigo-600 py-2.5 text-center text-sm font-bold text-white transition hover:bg-indigo-700"
            >
              진단 받고 내 수준 찾기 →
            </Link>
          </div>
        )}
        <WeatherBrainPanel />
      </div>

      <div className="mb-5">
        <QuestList />
      </div>

      <BadgeCollection />
    </div>
  );
}

/**
 * SpineCard — 스파인 집계(§3.3) 렌더: 유닛 진도율 바 + 왕관 + current_unit.
 * current_unit이 있으면 "이어서 학습" CTA로 /learn/units/{slug} 세션에 진입,
 * 전 유닛 클리어(current_unit=null)면 완주 상태를 보여준다.
 */
function SpineCard({ spine }) {
  const total = spine.units_total ?? 0;
  const cleared = spine.units_cleared ?? 0;
  const ratio = total > 0 ? Math.round((cleared / total) * 100) : 0;
  const current = spine.current_unit;

  return (
    <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <p className="text-sm font-extrabold text-slate-900">🎓 학습 진도</p>
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
          {cleared}/{total} 유닛 · {ratio}%
        </p>
      </div>

      {current ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2.5 ring-1 ring-sky-100">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-500">지금 배울 유닛</p>
            <p className="truncate text-sm font-bold text-sky-900">{current.title}</p>
          </div>
          <Link
            to={`/learn/units/${current.slug}`}
            className="shrink-0 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-sky-700"
          >
            이어서 학습 →
          </Link>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-center text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
          🌈 열린 유닛을 모두 클리어했어요!
        </p>
      )}
    </div>
  );
}
