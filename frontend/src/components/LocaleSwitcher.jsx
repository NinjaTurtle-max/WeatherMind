import { SUPPORTED_LOCALES, translate, useLocaleStore, useT } from '../i18n';

/**
 * LocaleSwitcher (R11-01 §3 D — i18n 골격) — ko/en 전환 토글.
 *
 * 골격 단계라 아직 어느 화면에도 배선하지 않는다(기존 컴포넌트 수정 금지 —
 * Layout 편입은 웨이브 2 전면 외부화와 함께). 각 버튼 라벨은 현재 로케일과
 * 무관하게 **그 언어 자신의 표기**(한국어 / English)로 둔다 — 언어를 못 읽는
 * 사용자도 자기 언어를 찾을 수 있어야 하는 표준 관례.
 */
export default function LocaleSwitcher() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useT();

  return (
    <div
      role="group"
      aria-label={t('locale.label')}
      className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5"
    >
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
          className={
            locale === code
              ? 'rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-sm'
              : 'rounded-full px-2.5 py-1 text-xs font-medium text-slate-500'
          }
        >
          {translate(code, `locale.${code}`)}
        </button>
      ))}
    </div>
  );
}
