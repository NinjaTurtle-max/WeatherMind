import { useT } from '../../i18n';

/**
 * PlacementFinalizing (R7-02 S1) — 배치고사 마지막 문항 제출 후 전환 화면.
 * "내 난이도를 찾는 중…" 전체 화면 — 이 화면 뒤에서 submit-all → complete가
 * 순차 호출된다(SessionRunner bulkMode의 finalizeBulk).
 *
 * 애니메이션은 구름·기압계 모티프의 결정적 CSS 애니메이션(tailwind keyframes,
 * 외부 에셋·JS 타이머 없음): 구름 좌우 표류 + 기압계 바늘 스윕 + 진행 바 스캔.
 */
export default function PlacementFinalizing() {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-sky-100 via-white to-white px-6"
    >
      <div className="relative h-32 w-48" aria-hidden="true">
        <span className="absolute left-2 top-0 animate-cloud-drift text-4xl">☁️</span>
        <span className="absolute right-0 top-8 animate-cloud-drift-slow text-3xl opacity-80">☁️</span>
        <span className="absolute left-8 top-14 animate-cloud-drift-slow text-2xl opacity-60">☁️</span>

        {/* 기압계 다이얼 + 스윕 바늘 */}
        <div className="absolute bottom-0 left-1/2 h-16 w-16 -translate-x-1/2 rounded-full bg-white shadow-md ring-4 ring-sky-200">
          <div className="absolute left-1/2 top-1/2 h-6 w-1 origin-bottom animate-gauge-sweep rounded-full bg-sky-600" />
          <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-700" />
        </div>
      </div>

      <h2 className="mt-6 text-lg font-extrabold text-slate-900">{t('placement.finalizingTitle')}</h2>
      <p className="mt-1 text-center text-sm text-slate-500">
        {t('placement.finalizingBody')}
      </p>

      <div className="mt-5 h-1.5 w-48 overflow-hidden rounded-full bg-sky-100">
        <div className="h-full w-1/3 animate-scan-x rounded-full bg-sky-500" />
      </div>
    </div>
  );
}
