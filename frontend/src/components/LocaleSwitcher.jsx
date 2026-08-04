import { SUPPORTED_LOCALES, translate, useLocaleStore, useT } from '../i18n';

/**
 * LocaleSwitcher (R11-01 §3 D → §6.3 페이즈 B에서 Layout 헤더 배선) — ko/en 전환.
 *
 * 기본(풀) 모드: 버튼 그룹. 각 버튼 라벨은 현재 로케일과 무관하게 **그 언어
 * 자신의 표기**(한국어 / English)로 둔다 — 언어를 못 읽는 사용자도 자기 언어를
 * 찾을 수 있어야 하는 표준 관례. (i18n 스모크가 이 형태를 실마운트로 가드)
 *
 * compact 모드(Layout 헤더 전용): 헤더는 R10에서 겹침(XP 텍스트가 구름 배지
 * 위로 넘침)을 고친 이력이 있어 폭 예산이 빠듯하다 — 풀 그룹 대신 **버튼
 * 1개**(🌐 + 전환 대상 로케일 코드)로 아이콘화해 최협폭(360px)에서도 겹침을
 * 재발시키지 않는다. 눌리면 다음 로케일로 순환(현재 2개 = 토글).
 * 전체 언어명은 aria-label·title로 남긴다(스크린리더·호버 판독).
 */
export default function LocaleSwitcher({ compact = false }) {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useT();

  if (compact) {
    const next =
      SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(locale) + 1) % SUPPORTED_LOCALES.length];
    // 전환 "대상" 언어를 그 언어 자신의 표기로 안내한다(풀 모드와 같은 관례)
    const nextLabel = translate(next, `locale.${next}`);
    return (
      <button
        type="button"
        onClick={() => setLocale(next)}
        aria-label={`${t('locale.label')}: ${nextLabel}`}
        title={nextLabel}
        className="shrink-0 rounded-full bg-sky-950/50 px-2 py-1 text-[11px] font-bold text-sky-100 transition hover:bg-sky-950/70"
      >
        <span aria-hidden="true">🌐</span> {next.toUpperCase()}
      </button>
    );
  }

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
