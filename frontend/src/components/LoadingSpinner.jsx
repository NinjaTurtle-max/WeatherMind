import { useT } from '../i18n';

/**
 * LoadingSpinner (04번 스펙 공통 컴포넌트)
 * label 미지정 시 공통 문구(common.loading) — 호출부가 넘기는 label은 그대로 렌더.
 */
export default function LoadingSpinner({ label }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
      <p className="text-sm text-slate-500">{label ?? t('common.loading')}</p>
    </div>
  );
}
