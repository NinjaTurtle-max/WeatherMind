import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { devApi } from '../../api';
import { CONCEPT_KO } from '../../lib/abilityDisplay';

/**
 * DevPanel (R7-03) — 개발자 모드 플로팅 패널.
 *
 * 노출 게이트: 로그인 상태에서 GET /dev/state 를 1회 조회해 200이면 우하단
 * 플로팅 ⚙️ 버튼을 렌더한다. DEV_MODE가 꺼진 서버는 404 — 그 경우(및 기타
 * 에러) 패널 자체를 렌더하지 않는다(재시도 없음, 프론트 env 불필요).
 *
 * 인스펙터(θ 테이블·상태 뱃지)와 조작 6종(θ·배치·구름·커리큘럼·스트릭·계정
 * 리셋)을 제공하고, 각 조작 후 관련 react-query 키를 invalidate 해 실제
 * 화면(헤더 뱃지·학습 홈·세션 등)에 즉시 반영한다. 조작 POST의 응답 본문
 * 계약은 백엔드 병렬 구현 중이라 미확정 — 본문에 의존하지 않는다.
 */

// 구름 최대치 — 계약값(R5-01 §3.3 CLOUD_MAX=5). /dev/state에 max가 없어 상수 사용.
const CLOUD_MAX = 5;

// 조작별 invalidate 대상 (['dev']는 항상 포함 — 패널 인스펙터 갱신)
const KEYS = {
  theta: [['dev'], ['progress'], ['session'], ['curriculum'], ['board']],
  placement: [['dev'], ['progress'], ['curriculum'], ['placement']],
  clouds: [['dev'], ['progress']],
  curriculum: [['dev'], ['curriculum'], ['progress']],
  streak: [['dev'], ['progress']],
};

function useDevMutation(mutationFn, keys) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
  });
}

const sectionTitle = 'text-[11px] font-bold uppercase tracking-wider text-slate-400';
const btn =
  'rounded-lg bg-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40';
const btnDanger =
  'rounded-lg bg-rose-700 px-2 py-1 text-xs font-semibold text-rose-50 transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40';

function Badge({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-200 ring-slate-600',
    green: 'bg-emerald-900/70 text-emerald-200 ring-emerald-700',
    amber: 'bg-amber-900/70 text-amber-200 ring-amber-700',
  };
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${tones[tone]}`}>
      <span className="opacity-60">{label}</span> {value}
    </span>
  );
}

export default function DevPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // θ 조작 폼
  const [thetaTarget, setThetaTarget] = useState('all'); // 'all' = 전체 동일값 모드
  const [thetaValue, setThetaValue] = useState(0);
  // 스트릭 폼
  const [streakInput, setStreakInput] = useState('7');
  const [yesterdayLogin, setYesterdayLogin] = useState(true);
  // 계정 리셋 2단계 확인 (브라우저 confirm 금지 — 인라인)
  const [resetArmed, setResetArmed] = useState(false);

  // 노출 게이트: 1회 조회, 404(DEV_MODE off)면 재시도 없이 비활성.
  const { data, isError, refetch, isFetching } = useQuery({
    queryKey: ['dev', 'state'],
    queryFn: devApi.fetchDevState,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const thetaMut = useDevMutation(devApi.setTheta, KEYS.theta);
  const placementMut = useDevMutation(devApi.setPlacement, KEYS.placement);
  const cloudsMut = useDevMutation(devApi.setClouds, KEYS.clouds);
  const curriculumMut = useDevMutation(devApi.setCurriculum, KEYS.curriculum);
  const streakMut = useDevMutation(devApi.setStreak, KEYS.streak);
  const resetMut = useMutation({
    mutationFn: devApi.resetMe,
    onSuccess: () => {
      // 계정 전체 초기화 — 캐시된 쿼리 전부 무효화 후 홈으로
      queryClient.invalidateQueries();
      setResetArmed(false);
      navigate('/', { replace: true });
    },
  });

  if (isError || !data?.dev_mode) return null;

  const mutations = [thetaMut, placementMut, cloudsMut, curriculumMut, streakMut, resetMut];
  const busy = mutations.some((m) => m.isPending);
  const lastError = mutations.map((m) => m.error).find(Boolean);

  const applyTheta = () => {
    const abilities =
      thetaTarget === 'all'
        ? data.abilities.map((a) => ({ concept_tag: a.concept_tag, theta: thetaValue }))
        : [{ concept_tag: thetaTarget, theta: thetaValue }];
    thetaMut.mutate(abilities);
  };

  const setCloudsClamped = (value) =>
    cloudsMut.mutate(Math.max(0, Math.min(CLOUD_MAX, value)));

  const applyStreak = () => {
    const streakCount = Math.max(0, Number(streakInput) || 0);
    streakMut.mutate({
      streakCount,
      ...(yesterdayLogin ? { lastLoginDaysAgo: 1 } : {}),
    });
  };

  return (
    <div className="fixed bottom-16 right-3 z-[60] flex flex-col items-end gap-2">
      {open && (
        <section
          aria-label="개발자 모드 패널"
          className="max-h-[70vh] w-80 overflow-y-auto rounded-2xl bg-slate-900/90 p-4 text-slate-100 shadow-2xl ring-1 ring-slate-700 backdrop-blur"
        >
          {/* ── 헤더 ── */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-extrabold tracking-tight">
              🛠️ <span className="rounded bg-amber-400 px-1 text-[11px] font-black text-slate-900">DEV</span>{' '}
              개발자 모드
            </h2>
            <button
              type="button"
              className={btn}
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? '…' : '새로고침'}
            </button>
          </div>

          {/* ── 인스펙터: 상태 뱃지 ── */}
          <div className="mb-2 flex flex-wrap gap-1">
            <Badge label="θ평균" value={data.overall_theta?.toFixed?.(2) ?? data.overall_theta} />
            <Badge label="레벨그룹" value={data.target_level_group} />
            <Badge label="선해제" value={data.unlock_floor} />
            <Badge label="구름" value={`${data.clouds}/${CLOUD_MAX}`} tone={data.clouds === 0 ? 'amber' : 'slate'} />
            <Badge label="스트릭" value={data.streak_count} />
            <Badge
              label="배치"
              value={data.placement_done ? '완료' : '미완'}
              tone={data.placement_done ? 'green' : 'amber'}
            />
          </div>
          {data.weak_tags?.length > 0 && (
            <p className="mb-2 text-[11px] text-slate-400">
              약점 태그: {data.weak_tags.map((t) => CONCEPT_KO[t] ?? t).join(' · ')}
            </p>
          )}

          {/* ── 인스펙터: 개념별 θ 테이블 ── */}
          <table className="mb-3 w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-0.5 font-semibold">개념</th>
                <th className="py-0.5 text-right font-semibold">θ</th>
                <th className="py-0.5 text-right font-semibold">SE</th>
                <th className="py-0.5 text-right font-semibold">n</th>
              </tr>
            </thead>
            <tbody>
              {data.abilities.map((a) => (
                <tr key={a.concept_tag} className="border-t border-slate-800">
                  <td className="py-0.5">{CONCEPT_KO[a.concept_tag] ?? a.concept_tag}</td>
                  <td className="py-0.5 text-right font-mono">{Number(a.theta).toFixed(2)}</td>
                  <td className="py-0.5 text-right font-mono text-slate-400">
                    {Number(a.theta_se).toFixed(2)}
                  </td>
                  <td className="py-0.5 text-right font-mono text-slate-400">{a.num_responses}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── θ 조작 ── */}
          <div className="mb-3">
            <p className={sectionTitle}>θ 조작</p>
            <div className="mt-1 flex items-center gap-2">
              <select
                value={thetaTarget}
                onChange={(e) => setThetaTarget(e.target.value)}
                className="min-w-0 flex-1 rounded-lg bg-slate-800 px-2 py-1 text-xs ring-1 ring-slate-700"
              >
                <option value="all">전체 동일값</option>
                {data.abilities.map((a) => (
                  <option key={a.concept_tag} value={a.concept_tag}>
                    {CONCEPT_KO[a.concept_tag] ?? a.concept_tag}
                  </option>
                ))}
              </select>
              <span className="w-10 text-right font-mono text-xs">{thetaValue.toFixed(1)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={-3}
                max={3}
                step={0.1}
                value={thetaValue}
                onChange={(e) => setThetaValue(Number(e.target.value))}
                className="min-w-0 flex-1 accent-sky-400"
                aria-label="θ 값"
              />
              <button type="button" className={btn} onClick={applyTheta} disabled={busy}>
                적용
              </button>
            </div>
          </div>

          {/* ── 배치고사 ── */}
          <div className="mb-3">
            <p className={sectionTitle}>배치고사</p>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className={btn}
                onClick={() => placementMut.mutate('reset')}
                disabled={busy}
              >
                초기화
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => placementMut.mutate('complete')}
                disabled={busy}
              >
                즉시완료
              </button>
            </div>
          </div>

          {/* ── 구름 에너지 ── */}
          <div className="mb-3">
            <p className={sectionTitle}>구름 에너지</p>
            <div className="mt-1 flex items-center gap-2">
              <button type="button" className={btn} onClick={() => setCloudsClamped(CLOUD_MAX)} disabled={busy}>
                리필
              </button>
              <button type="button" className={btn} onClick={() => setCloudsClamped(0)} disabled={busy}>
                소진
              </button>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  className={btn}
                  onClick={() => setCloudsClamped(data.clouds - 1)}
                  disabled={busy || data.clouds <= 0}
                  aria-label="구름 1 감소"
                >
                  −
                </button>
                <span className="w-8 text-center font-mono text-xs">{data.clouds}</span>
                <button
                  type="button"
                  className={btn}
                  onClick={() => setCloudsClamped(data.clouds + 1)}
                  disabled={busy || data.clouds >= CLOUD_MAX}
                  aria-label="구름 1 증가"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* ── 커리큘럼 ── */}
          <div className="mb-3">
            <p className={sectionTitle}>커리큘럼</p>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className={btn}
                onClick={() => curriculumMut.mutate({ action: 'unlock_all' })}
                disabled={busy}
              >
                전체 해제
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => curriculumMut.mutate({ action: 'reset' })}
                disabled={busy}
              >
                진도 리셋
              </button>
            </div>
          </div>

          {/* ── 스트릭 ── */}
          <div className="mb-3">
            <p className={sectionTitle}>스트릭</p>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={streakInput}
                onChange={(e) => setStreakInput(e.target.value)}
                className="w-16 rounded-lg bg-slate-800 px-2 py-1 text-xs ring-1 ring-slate-700"
                aria-label="스트릭 일수"
              />
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={yesterdayLogin}
                  onChange={(e) => setYesterdayLogin(e.target.checked)}
                  className="accent-sky-400"
                />
                어제 로그인
              </label>
              <button type="button" className={`${btn} ml-auto`} onClick={applyStreak} disabled={busy}>
                적용
              </button>
            </div>
          </div>

          {/* ── 계정 리셋 (인라인 2단계 확인) ── */}
          <div>
            <p className={sectionTitle}>계정 리셋</p>
            {resetArmed ? (
              <div className="mt-1 rounded-lg bg-rose-950/60 p-2 ring-1 ring-rose-800">
                <p className="mb-1.5 text-[11px] text-rose-200">
                  진도·θ·배치·자원이 모두 초기화됩니다. 계속할까요?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnDanger}
                    onClick={() => resetMut.mutate()}
                    disabled={busy}
                  >
                    {resetMut.isPending ? '초기화 중…' : '초기화 실행'}
                  </button>
                  <button
                    type="button"
                    className={btn}
                    onClick={() => setResetArmed(false)}
                    disabled={resetMut.isPending}
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={`${btnDanger} mt-1`}
                onClick={() => setResetArmed(true)}
                disabled={busy}
              >
                계정 진행 전체 초기화…
              </button>
            )}
          </div>

          {lastError && (
            <p className="mt-2 text-[11px] text-rose-300" role="alert">
              요청 실패: {lastError.message}
            </p>
          )}
        </section>
      )}

      {/* 플로팅 토글 버튼 — 눈에 띄되 방해 없게(탭바 위 우하단, DEV 라벨 명시) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="개발자 모드 패널 열기/닫기"
        className="flex items-center gap-1 rounded-full bg-slate-900/90 px-3 py-2 text-sm text-white shadow-lg ring-1 ring-amber-400/70 backdrop-blur transition-transform hover:scale-105"
      >
        ⚙️
        <span className="rounded bg-amber-400 px-1 text-[10px] font-black text-slate-900">DEV</span>
      </button>
    </div>
  );
}
