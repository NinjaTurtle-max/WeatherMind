import Mascot from '../../components/Mascot';
import { useT } from '../../i18n';

/**
 * BoardHintPanel (R13-01 §2.6) — 보드의 점진적 힌트를 **교사 캐릭터의 말**로 옮긴다.
 *
 * 이전에는 힌트가 캐릭터 없이 노란 텍스트 상자로만 떴다. 같은 문장이라도 "화면이
 * 알려주는 것"과 "누가 말해 주는 것"은 다르게 읽힌다 — 보드 화면이 이미 쓰고 있던
 * 관례(FeedbackPanel의 마스코트 + 말풍선)를 힌트에도 그대로 쓴다. **새 패턴을
 * 만들지 않는다.**
 *
 * ⚠️ **문구는 한 글자도 바꾸지 않았다.** 힌트 문구·칩·CTA는 전부 기존 i18n 키를
 * 그대로 쓴다(`board.atmosphere.hint*`). 기존 스모크(boardAssistRetention)가
 * '힌트 1:'·'힌트 2:'·'필요한 요소 종류'·'힌트 보기 (n/total)' 원문과, **'힌트 2:'
 * 이후 문자열에 숫자가 없을 것**을 단정한다. 이 패널에 무엇을 더 붙이든
 * 2단 힌트 뒤에는 숫자를 넣지 말 것(캐릭터 이름·설명도 마찬가지).
 *
 * 표정 전환: 여섯 마스코트는 "표정 6종"으로 쓰인다(자산 신규 제작 없음).
 * 단계가 오를수록 화자가 바뀌어 "한 걸음 더 들어갔다"가 그림으로도 보인다.
 *   0단(아직 안 봄) 구름이  — 메인 튜터가 권한다
 *   1단(지역 지목)  물방울이 — 보드 담당이 미션을 좁혀 준다
 *   2단(요소 종류)  태양이  — 개념 설명 담당이 마지막 한 걸음을 남긴다
 */
export const HINT_STAGE_MASCOT = Object.freeze(['cloud', 'drop', 'sun']);

/** 공개한 힌트 수 → 화자. 범위를 벗어나면 양 끝으로 고정한다. */
export function hintStageMascot(level) {
  const i = Math.min(Math.max(Number(level) || 0, 0), HINT_STAGE_MASCOT.length - 1);
  return HINT_STAGE_MASCOT[i];
}

export default function BoardHintPanel({
  steps = [],
  level = 0,
  kindLabels = [],
  interactive = false,
  onReveal,
}) {
  const t = useT();
  if (steps.length === 0) return null;

  const stage = Math.min(Math.max(level, 0), HINT_STAGE_MASCOT.length - 1);
  const speaker = hintStageMascot(level);

  return (
    <div data-testid="board-hint" data-hint-level={level} className="flex items-start gap-2">
      <span
        data-testid="board-hint-mascot"
        data-hint-stage={stage}
        data-mascot={speaker}
        className="grid h-11 w-11 flex-none place-items-center rounded-full bg-amber-100"
      >
        <Mascot name={speaker} className="h-9 w-9" />
      </span>

      {/* 말풍선 — 꼬리가 캐릭터를 가리켜 "이 캐릭터가 말한다"를 만든다 */}
      <div className="relative min-w-0 flex-1 rounded-2xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
        <span
          aria-hidden="true"
          className="absolute -left-[5px] top-4 h-2.5 w-2.5 rotate-45 border-b border-l border-amber-200 bg-amber-50"
        />
        {steps.slice(0, level).map((h, i) => (
          <div key={i} className="mb-1 text-xs text-amber-800 last:mb-0">
            <p>
              {t('board.atmosphere.hintPrefix', { n: i + 1 })} {h}
            </p>
            {/* 2단에서만 "필요한 요소 종류"를 칩으로 — subtype(정답 요소)은 없다 */}
            {i === 1 && kindLabels.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-1">
                <span className="font-bold">{t('board.atmosphere.hintNeedsLabel')}</span>
                {kindLabels.map((label) => (
                  <span key={label} className="rounded-full bg-amber-200 px-2 py-0.5 font-bold text-amber-900">
                    {label}
                  </span>
                ))}
              </p>
            )}
          </div>
        ))}
        {level < steps.length && interactive && (
          <button
            type="button"
            onClick={onReveal}
            className="text-xs font-bold text-amber-600 hover:text-amber-700"
          >
            {t('board.atmosphere.hintCta', { n: level, total: steps.length })}
          </button>
        )}
        {level >= steps.length && (
          <p className="mt-1 text-[11px] text-amber-700">{t('board.atmosphere.hintNoAnswer')}</p>
        )}
      </div>
    </div>
  );
}
