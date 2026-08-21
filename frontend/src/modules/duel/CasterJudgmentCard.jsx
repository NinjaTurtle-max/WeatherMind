import { tierMeta } from '../../lib/tierMeta';
import { CASTER_NOISE_SCALE, CASTER_BASE_NOISE } from './briefingDisplay';
import { useT } from '../../i18n';

/**
 * CasterGradeBadge (R9-01 §3.2) — "🤖 {티어}급 캐스터" 등급 배지.
 * 리그 티어 메타(구름 5단계)를 재사용하되 캐스터 문맥 라벨을 붙인다.
 * meta.label(티어명)은 lib/tierMeta의 리소스 파생 getter(tier.name.*) — useT()
 * 구독이 로케일 전환 리렌더를 보장하므로 접근 시점 로케일로 풀린다(§6.3).
 */
export function CasterGradeBadge({ grade, size = 'sm' }) {
  const meta = tierMeta(grade);
  const t = useT();
  const sizeClass = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold ring-1 ${meta.chip} ${sizeClass}`}
      title={t('duel.judge.badgeTitle', { label: meta.label })}
    >
      <span aria-hidden="true">🤖</span>
      {t('duel.judge.badgeLabel', { label: meta.label })}
    </span>
  );
}

/**
 * CasterJudgmentCard (R9-01 §3.4 ④ — 주최측 예시 ⑥ 수치예보 입문 대응).
 * AI 캐스터의 예측이 나온 3단계를 공개한다:
 *   ① 기준 예보(KMA base_forecast) → ② 티어별 오차 모델(±2℃/±15%p ×
 *   noise_scale — ai_pred 스냅샷 우선, 없으면 §3.2 계약 매핑) → ③ 최종 예측.
 * base_forecast가 null(KMA 실패 — 폴백 base 비노출)이어도 단계 구조는
 * 유지하고 ①만 "수신 대기"로 표기한다.
 */
export default function CasterJudgmentCard({ baseForecast, aiPred, casterGrade }) {
  const t = useT();
  if (!aiPred) return null;
  const meta = tierMeta(casterGrade);
  const scale = typeof aiPred.noise_scale === 'number'
    ? aiPred.noise_scale
    : CASTER_NOISE_SCALE[casterGrade] ?? 1.0;
  const tempAmp = round1(CASTER_BASE_NOISE.temp * scale);
  const rainAmp = round1(CASTER_BASE_NOISE.rain * scale);

  return (
    <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">{t('duel.judge.title')}</h3>
        <CasterGradeBadge grade={casterGrade} />
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">{t('duel.judge.intro')}</p>

      <ol className="flex flex-col">
        <JudgmentStep no="1" title={t('duel.judge.step1')}>
          {baseForecast ? (
            <>
              {t('duel.judge.tempPrefix')}
              <b>{baseForecast.temp_max}{t('common.celsius')}</b>
              {t('duel.judge.rainMid')}
              <b>{baseForecast.rain_prob}%</b>
            </>
          ) : (
            <span className="text-slate-400">{t('duel.judge.step1Waiting')}</span>
          )}
        </JudgmentStep>
        <StepArrow />
        <JudgmentStep no="2" title={t('duel.judge.step2', { label: meta.label, scale })}>
          {t('duel.judge.step2Seg1', { temp: CASTER_BASE_NOISE.temp, rain: CASTER_BASE_NOISE.rain })}
          <b>{t('duel.judge.step2Strong', { tempAmp, rainAmp })}</b>
          {t('duel.judge.step2Seg2')}
        </JudgmentStep>
        <StepArrow />
        <JudgmentStep no="3" title={t('duel.judge.step3')}>
          {t('duel.judge.tempPrefix')}
          <b>{aiPred.temp_max}{t('common.celsius')}</b>
          {t('duel.judge.rainMid')}
          <b>{aiPred.rain_prob}%</b>
        </JudgmentStep>
      </ol>
    </div>
  );
}

function JudgmentStep({ no, title, children }) {
  return (
    <li className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[11px] font-bold text-white">
        {no}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold text-slate-700">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{children}</span>
      </span>
    </li>
  );
}

function StepArrow() {
  return (
    <li aria-hidden="true" className="py-0.5 text-center text-xs font-bold text-slate-300">
      ↓
    </li>
  );
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
