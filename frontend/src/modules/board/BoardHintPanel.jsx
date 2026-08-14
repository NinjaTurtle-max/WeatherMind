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
 * 화자는 **태양이 하나**다(2026-08-11 사용자 지시 — 힌트를 왼쪽 아래로 내리면서
 * "태양이가 힌트를 말해 주는 것처럼"). 태양이가 보드 담당이다(SideNav
 * TUTOR_BY_PATH `/board` → sun. 담당표 소유자는 거기다).
 *
 * ⚠️ 종전에는 단계마다 화자를 갈랐다(R13-01 §2.6 — 0단 구름이 · 1단 물방울이 ·
 * 2단 태양이). "한 걸음 더 들어갔다"를 그림으로 보이려던 것인데, 그 대가로
 * **한 화면에서 말하는 사람이 세 번 바뀌었고** 그중 둘은 다른 화면 담당이었다.
 * 단계가 올랐다는 것은 「힌트 1:/2:」 번호와 칩이 이미 말한다. 같은 판단을
 * 학습 세션 피드백(FeedbackPanel)에도 같은 날 적용했다 — 화면 하나에 화자 하나.
 */
export const HINT_SPEAKER = 'sun';

/** 화자 — 단계와 무관하게 보드 담당(태양이)이다. 단계 인자는 더 받지 않는다. */
export function hintStageMascot() {
  return HINT_SPEAKER;
}

/**
 * `stack` — 캐릭터를 말풍선 **위**로 올린다(가로가 좁은 칸 전용).
 *
 * 보드 플레이의 힌트는 2026-08-12부터 조절값 열(168px) 아래에 붙는다. 가로로
 * 두면 마스코트 44 + 간격 8 + 말풍선 안여백 24를 빼고 **글자 폭이 92px**밖에
 * 안 남아 두 단짜리 힌트가 15줄짜리 리본이 된다(코드 리뷰 실측). 세로로 쌓으면
 * 같은 칸에서 글자 폭이 144px가 된다. 세션 안 보드(stacked)는 칸이 넓으므로
 * 기본값 false 그대로 가로 배치다 — 한쪽 때문에 양쪽을 바꾸지 않는다.
 */
export default function BoardHintPanel({
  steps = [],
  level = 0,
  kindLabels = [],
  interactive = false,
  onReveal,
  stack = false,
  explain = null,
}) {
  const t = useT();
  if (steps.length === 0 && !explain) return null;

  // stage는 **표시 단계**로만 남는다(화자를 고르지 않는다) — 스모크가
  // data-hint-stage로 단계 진행을 확인한다.
  const stage = Math.min(Math.max(level, 0), 2);
  const speaker = HINT_SPEAKER;

  return (
    <div
      data-testid="board-hint"
      data-hint-level={level}
      data-hint-stacked={stack ? '1' : '0'}
      className={`flex gap-2 ${stack ? 'flex-col items-start' : 'items-start'}`}
    >
      <span
        data-testid="board-hint-mascot"
        data-hint-stage={stage}
        data-mascot={speaker}
        className={`grid flex-none place-items-center rounded-full bg-amber-100 ${
          stack ? 'h-9 w-9' : 'h-11 w-11'
        }`}
      >
        <Mascot name={speaker} className={stack ? 'h-7 w-7' : 'h-9 w-9'} />
      </span>

      {/* 말풍선 — 꼬리가 캐릭터를 가리켜 "이 캐릭터가 말한다"를 만든다.
          쌓은 배치에서는 캐릭터가 위에 있으므로 꼬리도 **위**를 가리킨다. */}
      <div className={`relative rounded-2xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200 ${
        stack ? 'w-full' : 'min-w-0 flex-1'
      }`}>
        <span
          aria-hidden="true"
          className={`absolute h-2.5 w-2.5 rotate-45 border-amber-200 bg-amber-50 ${
            stack ? '-top-[5px] left-3 border-l border-t' : '-left-[5px] top-4 border-b border-l'
          }`}
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
        {/* 「힌트는 정답 배치를 알려주지 않아요」 — 해설이 열린 뒤에는 **거짓말이
            된다**. 사다리를 다 밟았을 때만, 그리고 3단이 아직 안 열렸을 때만 쓴다. */}
        {level >= steps.length && !explain && (
          <p className="mt-1 text-[11px] text-amber-700">{t('board.atmosphere.hintNoAnswer')}</p>
        )}
        {/* ①안 3단(N-3) — N회 미통과 후 열리는 현상 해설. 사다리 **다음 단**이라
            맨 아래에 오고, 위 선 하나로 1·2단과 갈라 놓는다.
            ⚠️ **「힌트 3:」으로 번호를 붙이지 않는다.** boardAssistRetention이
            '힌트 2:' **이후 문자열 전체**에 숫자가 없을 것을 단정한다
            (`!/\d/.test(hint2.replace('힌트 2:', ''))`). 번호를 붙이면 그 계약이
            깨지므로 번호 없는 단으로 얹고, 라벨 문구에도 숫자를 넣지 않는다
            (규칙 15건의 explain 전건에 숫자가 없음을 실측 확인했다). */}
        {explain && (
          <div data-testid="board-hint-explain" className="mt-2 border-t border-amber-200 pt-2">
            <p className="text-xs font-bold text-amber-900">{t('board.atmosphere.explainLabel')}</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">{explain}</p>
          </div>
        )}
      </div>
    </div>
  );
}
