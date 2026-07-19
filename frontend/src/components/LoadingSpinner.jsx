/**
 * LoadingSpinner (04번 스펙 공통 컴포넌트)
 */
export default function LoadingSpinner({ label = '불러오는 중...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
