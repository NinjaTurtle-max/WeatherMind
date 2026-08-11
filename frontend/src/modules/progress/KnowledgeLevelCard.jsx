import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import {
  KNOWLEDGE_LEVEL_NAME,
  KNOWLEDGE_LEVEL_SUB,
  selectKnowledgeLevel,
} from '../../lib/abilityDisplay';
import { useT } from '../../i18n';


/**
 * KnowledgeLevelCard (R13) — **현재 지식 단계**(knowledge_level) 카드.
 *
 * 2026-08-10에 지식 단계를 6 → 10칸으로 넓히고 문항 1,000건을 그 축으로 분류했는데
 * 화면에는 4밴드(초급/중급/고급/최상급)만 떴다. 이 카드가 그 구멍을 메운다.
 *
 * ⚠️ 두 축은 **대체가 아니라 병기**다(2축 분리 계약):
 *   - level_group(4밴드) = 표현 톤 → 기존 WeatherBrainPanel의 레벨 칩이 그대로 남는다
 *   - knowledge_level(N단계) = 난이도 → 이 카드
 * 그래서 LEVEL_KO·THETA_BAND_BOUNDS는 건드리지 않았다.
 *
 * 데이터: **GET /progress/me**의 `knowledge_level`·`knowledge_level_max`.
 * ⚠️ /progress/mastery·/abilities에도 같은 이름의 필드가 있지만 그것은 **개념별**
 * θ 파생 단계다(스키마 주석이 "축이 다르다"고 못박는다). 이 카드가 말하는 "현재
 * 단계"는 사용자 1인을 대표하는 값이라 /me만 본다 — mastery는 숙련 낮은 순 정렬이라
 * 첫 행을 집으면 **가장 약한 개념**을 현재 단계라고 말하게 된다.
 *
 * **필드가 없거나 null이면 카드 자체가 렌더되지 않는다** — 깨지지 않는 쪽이 우선이다.
 * null은 콜드스타트(θ 행 없음)를 뜻하고, 서버가 신고 학령에서 숫자를 지어내지 않기로
 * 한 자리다(schemas/progress.py 주석). 쿼리 키는 ProgressPage와 같은 것을 써서 요청이
 * 늘지 않는다(react-query 캐시 공유).
 *
 * 분모(N)를 하드코딩하지 않는다 — `knowledge_level_max`만 쓴다. 없으면 진행 막대와
 * "다음 단계" 줄만 빠지고 단계 자체는 뜬다.
 */
export default function KnowledgeLevelCard() {
  const t = useT();
  const me = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });

  const picked = selectKnowledgeLevel(me.data);
  if (!picked) return null; // 서버 필드 미도착·콜드스타트(null) — 카드째 감춘다

  const { level, max } = picked;
  const name = KNOWLEDGE_LEVEL_NAME[level] ?? t('ability.knowledgeLevel.lv', { level });
  const sub = KNOWLEDGE_LEVEL_SUB[level] ?? '';
  const nextName =
    max && level < max
      ? KNOWLEDGE_LEVEL_NAME[level + 1] ?? t('ability.knowledgeLevel.lv', { level: level + 1 })
      : null;
  const percent = max ? Math.round((level / max) * 100) : 0;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-base font-extrabold text-slate-900">
        🪜 {t('ability.knowledgeLevel.cardTitle')}
      </h2>

      <div
        className="mt-2 flex items-center gap-3 rounded-xl bg-sky-50 px-3 py-2.5 ring-1 ring-sky-100"
        aria-label={max ? t('ability.knowledgeLevel.aria', { level, max, name }) : undefined}
      >
        <span className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1 text-sm font-extrabold tabular-nums text-white">
          {t('ability.knowledgeLevel.lv', { level })}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-sky-900">{name}</p>
          {sub && <p className="truncate text-xs text-sky-700">{sub}</p>}
        </div>
      </div>

      {max && (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-sky-600 transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="tabular-nums">
              {t('ability.knowledgeLevel.ofMax', { level, max })}
            </span>
            <span className="truncate">
              {nextName
                ? t('ability.knowledgeLevel.next', { name: nextName })
                : t('ability.knowledgeLevel.top')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
