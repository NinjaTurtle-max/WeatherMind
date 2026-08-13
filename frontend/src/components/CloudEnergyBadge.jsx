import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { progressApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { useT } from '../i18n';

/**
 * CloudEnergyBadge (R5-01 §3.3) — 상단 헤더의 구름 에너지 표시.
 *   ☁️ n/5 잔량 + 다음 회복까지 카운트다운(가득 차면 생략).
 * 스트릭 프리즈("구름 방패")와 시각적으로 구분한다:
 *   구름 = 플레이 에너지(하늘색), 방패 = 스트릭 방어(주황 StreakBadge).
 * 소진(0) 시 붉은 강조 + 회복 ETA로 재방문을 유도한다(리텐션 훅).
 *
 * R10-01 §3.1: 소모 규칙이 "시도당 1"에서 **"틀린 문항에만 1"**로 바뀌었다.
 * 툴팁 문구를 새 규칙(노력이 아니라 실수에 소모)과 진입 차단(새 세션은 구름이
 * 있어야 열림)에 맞춘다. 수치·회복 모델(만렙 5·20분당 1)은 불변.
 *
 * GET /progress/energy를 조회하고, next_regen_sec를 로컬에서 1초씩 카운트다운한다.
 * 0에 도달하면 재조회로 잔량·다음 ETA를 갱신한다.
 */
export default function CloudEnergyBadge() {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const t = useT();

  const { data } = useQuery({
    queryKey: ['progress', 'energy'],
    queryFn: progressApi.fetchEnergy,
    enabled: Boolean(accessToken),
    staleTime: 10_000,
    refetchInterval: 60_000, // 서버 지연 회복과 주기적 동기화
  });

  const clouds = data?.clouds ?? null;
  const max = data?.max ?? 10;  // 조회 전 첫 페인트용 — 권위는 서버 `max`
  const isFull = clouds != null && clouds >= max;
  const isEmpty = clouds === 0;

  // next_regen_sec를 로컬 카운트다운으로 감소시키고, 0에서 재조회한다.
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    setRemaining(data?.next_regen_sec ?? 0);
  }, [data?.next_regen_sec, data?.updated_at]);

  useEffect(() => {
    if (isFull || remaining <= 0) return undefined;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, isFull]);

  useEffect(() => {
    if (!isFull && remaining === 0 && data?.next_regen_sec > 0) {
      queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, isFull]);

  if (clouds == null) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-sm font-bold text-sky-400">
        <span aria-hidden="true">☁️</span>–/{max}
      </span>
    );
  }

  const countdown = !isFull && remaining > 0 ? formatClock(remaining) : null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${
        isEmpty ? 'bg-rose-100 text-rose-600' : 'bg-sky-100 text-sky-700'
      }`}
      title={
        isFull
          ? t('energy.full')
          : isEmpty
            ? t('energy.empty', { min: Math.max(1, Math.ceil(remaining / 60)) })
            : t('energy.regen', { countdown })
      }
    >
      <span aria-hidden="true">☁️</span>
      {clouds}/{max}
      {countdown && (
        <span className={`ml-0.5 text-xs font-medium ${isEmpty ? 'text-rose-500' : 'text-sky-500'}`}>
          {countdown}
        </span>
      )}
    </span>
  );
}

/** 초 → M:SS */
function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
