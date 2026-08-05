import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { REGIONS, snapToNearestRegion } from '../lib/geoSnap';
import { useT } from '../i18n';

/**
 * RegionPicker (R12 선행 §8) — 학습 지역 칩 + 12도시 선택 시트.
 * props 없는 자급 컴포넌트(ReviewQueueCard 선례) — 마운트는 1줄 import로 한다
 * (학습 홈 세션 카드 · 프로필 설정 섹션).
 *
 * 지역의 의미 경계(PM 정정 2026-08-05): 이 설정은 **퀴즈 실황·학습 피드백 날씨**의
 * 기준 지역이다. 예보 대결/브리핑·리그는 서울 고정(지역 예보로 예측하고 서울
 * 실측으로 채점되는 정합성 문제 + ASOS 지점 3/12) — 대결 화면에는 이 칩을 달지
 * 않고, 안내 문구(region.body)가 이 경계를 밝힌다.
 *
 * 계약(§8.2):
 *  - 현재 지역은 GET /progress/me의 region — **null이면 서울**(NULL=서울 하위 호환).
 *  - 선택 즉시 PUT /progress/region {region} → 200 {region}. 화이트리스트 밖은
 *    422 VALIDATION_ERROR(daily-goal과 동일 의미론 — UI는 12도시만 노출하므로
 *    정상 경로에서 나올 수 없고, 나오면 문구로 보여주고 칩은 유지).
 *  - 저장 성공 시 me 캐시 부분 반영 + 무효화(DailyGoalPicker 선례). 실황 문항은
 *    다음 발급분부터 새 지역을 탄다(발급된 세션은 불변 — 서버 소유).
 *  - GPS는 옵트인 버튼 1개: 위경도는 lib/geoSnap이 최근접 도시 계산에만 쓰고
 *    즉시 폐기한다(서버 전송·저장 금지). 실패(거부·타임아웃·부재)는 오류가 아니라
 *    "직접 골라주세요" 안내로 조용히 수동 선택에 합류한다.
 */

const ME_KEY = ['progress', 'me'];

/** 서버 원문(한국어 도시명) → 로케일 표시명. 미지 값은 원문 그대로(폴백). */
function regionLabel(t, region) {
  const meta = REGIONS.find((r) => r.value === region);
  return meta ? t(`region.city.${meta.key}`) : region;
}

export default function RegionPicker() {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [gpsState, setGpsState] = useState('idle'); // idle | pending | failed

  const { data: me } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => (await client.get('/progress/me')).data,
    staleTime: 30_000,
  });
  const region = me?.region ?? '서울'; // NULL=서울 (§8.2)

  const mutation = useMutation({
    mutationFn: async (next) => (await client.put('/progress/region', { region: next })).data,
    onSuccess: (data) => {
      // 응답은 {region} 하나뿐(daily-goal 선례) — me 캐시 부분 반영 후 재검증
      queryClient.setQueryData(ME_KEY, (prev) =>
        prev ? { ...prev, region: data?.region ?? prev.region } : prev,
      );
      queryClient.invalidateQueries({ queryKey: ME_KEY });
      setOpen(false);
      setGpsState('idle');
    },
  });

  const close = () => {
    setOpen(false);
    setGpsState('idle');
    mutation.reset();
  };

  const onGps = async () => {
    setGpsState('pending');
    const snapped = await snapToNearestRegion();
    if (!snapped) {
      // 조용한 폴백(§8.2) — 시트는 열린 채, 수동 선택 안내만 띄운다
      setGpsState('failed');
      return;
    }
    setGpsState('idle');
    mutation.mutate(snapped);
  };

  return (
    <>
      {/* 트리거 칩 — 현재 지역 표시, 탭하면 선택 시트 */}
      <button
        type="button"
        data-testid="region-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t('region.chipAria', { region: regionLabel(t, region) })}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200 transition hover:ring-sky-400"
      >
        <span aria-hidden="true">📍</span>
        {regionLabel(t, region)}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          {/* 백드롭 — 탭하면 닫힘 */}
          <button
            type="button"
            aria-label={t('region.close')}
            onClick={close}
            className="absolute inset-0 bg-slate-900/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('region.title')}
            data-testid="region-picker"
            className="relative w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
          >
            <p className="text-base font-extrabold text-slate-900">{t('region.title')}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{t('region.body')}</p>

            {/* 옵트인 GPS 스냅 — 좌표는 최근접 계산에만 쓰고 즉시 폐기(geoSnap) */}
            <button
              type="button"
              data-testid="region-gps"
              disabled={gpsState === 'pending' || mutation.isPending}
              onClick={onGps}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <span aria-hidden="true">📍</span>
              {gpsState === 'pending' ? t('region.gpsPending') : t('region.gps')}
            </button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{t('region.gpsHint')}</p>
            {gpsState === 'failed' && (
              <p data-testid="region-gps-fallback" className="mt-1.5 text-xs font-bold text-slate-500">
                {t('region.gpsFailed')}
              </p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
              {REGIONS.map((r) => {
                const active = r.value === region;
                return (
                  <button
                    key={r.value}
                    type="button"
                    data-region={r.value}
                    aria-pressed={active}
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate(r.value)}
                    className={`rounded-xl px-2 py-2.5 text-sm font-bold ring-1 transition disabled:cursor-not-allowed ${
                      active
                        ? 'bg-sky-600 text-white ring-sky-600'
                        : 'bg-white text-slate-700 ring-slate-200 hover:ring-sky-300'
                    }`}
                  >
                    {t(`region.city.${r.key}`)}
                  </button>
                );
              })}
            </div>

            {mutation.isError && (
              <p data-testid="region-save-error" className="mt-2 text-xs font-bold text-rose-600">
                {t('region.saveFailed', { detail: mutation.error?.detail ?? '' })}
              </p>
            )}

            <button
              type="button"
              onClick={close}
              className="mt-4 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
            >
              {t('region.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
