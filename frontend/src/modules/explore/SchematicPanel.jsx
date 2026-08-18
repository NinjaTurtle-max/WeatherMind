import { useState } from 'react';
import SchematicGL from './schematic/SchematicGL';

/**
 * SchematicPanel — 입체 모식도 한 장을 **탐구 화면의 카드로** 놓는 껍데기 (MT-22 배선).
 *
 * `SchematicGL`은 장면과 단계만 받는다 — 「단계를 누가 올리는가」는 정해 두지 않았고
 * (그 파일 머리 주석이 "배선은 한 줄이면 된다"고 적은 그 자리다), 그것이 이 파일이
 * 하는 일의 전부다: **카드 + 수동 단계 이동 + 실패했을 때의 글 대체**.
 *
 * 판단 셋을 여기 적어 둔다.
 *  ⑴ **자동 재생을 넣지 않는다.** 넘기는 것은 사람이 한다 — 그래서
 *     `prefers-reduced-motion` 분기가 아예 필요 없다(단면 패널은 자동 재생이 있어서
 *     그 분기를 짊어졌다). 없는 기능은 회귀하지 않는다.
 *  ⑵ **바탕이 어둡다.** 장면들의 `background`는 `null`(투명)이고 라벨 색이
 *     밝은 계열이다 — `radiationScene.js`가 "패널 배경(CSS)이 하늘 역할을 한다"고
 *     적어 둔 그 배경을 여기서 준다. 밝은 카드 위에 그대로 얹으면 글자가 사라진다.
 *  ⑶ **WebGL2가 없으면 단계 제목을 글로 남긴다.** `SchematicGL`의 폴백은 "표시할 수
 *     없습니다" 한 줄뿐이라 **가르치려던 내용이 통째로 사라진다**. 그림이 못 떠도
 *     이야기(단계 제목)는 읽히게 둔다.
 *
 * ⚠️ 문구가 한국어 리터럴이다(여기와 호출부의 제목·설명). i18n 외부화는 **이번
 * 과업 범위 밖**이라는 PM 판정이라 `i18n/resources/**`를 건드리지 않았다 — 옮길
 * 대상은 이 파일의 문자열 4개와 호출부 제목·설명, 그리고 장면 파일들의 `text`다.
 */
export default function SchematicPanel({ title, caption, scene, steps, ariaLabel }) {
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const last = steps.length - 1;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-bold text-slate-700">{title}</p>
      {caption ? <p className="text-[11px] text-slate-400">{caption}</p> : null}

      <div className="mt-2 overflow-hidden rounded-xl bg-slate-900">
        <SchematicGL
          scene={scene}
          step={step}
          className="aspect-[16/10]"
          ariaLabel={ariaLabel ?? title}
          onFail={() => setFailed(true)}
        />
      </div>

      {failed ? (
        /* 그림이 못 떴을 때 — 단계 제목만이라도 남긴다(⑶). */
        <ol className="mt-2 list-decimal space-y-0.5 pl-4">
          {steps.map((s) => (
            <li key={s.key} className="text-[11px] leading-relaxed text-slate-600">
              {s.title}
            </li>
          ))}
        </ol>
      ) : (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            {/* 한 표현식으로 묶는다 — 조각으로 쓰면 React가 텍스트 노드를 갈라
                `1<!-- -->/<!-- -->5단계`가 되고, 문자열로 확인하는 스모크가
                "화면에 뜨는 그대로"를 못 잡는다(하네스에서 실측). */}
            <span className="font-bold text-sky-700">{`${step + 1}/${steps.length}단계`}</span>{' '}
            {steps[step].title}
          </p>

          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStep((n) => Math.max(0, n - 1))}
              disabled={step === 0}
              aria-label="이전 단계"
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              onClick={() => setStep((n) => Math.min(last, n + 1))}
              disabled={step === last}
              aria-label="다음 단계"
              className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-40"
            >
              다음
            </button>
            <div className="ml-1 flex items-center gap-1">
              {steps.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-label={`${i + 1}단계 — ${s.title}`}
                  aria-current={i === step}
                  className={`h-1.5 w-4 rounded-full transition-colors ${
                    i === step ? 'bg-sky-600' : 'bg-slate-200 hover:bg-slate-300'
                  }`}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
