import { useEffect, useState } from 'react';
import CrossSectionGL from '../board/webgl/crossSection/CrossSectionGL';
import { usePrefersReducedMotion } from '../board/realisticEffects';
import { useT } from '../../i18n';

/**
 * SchematicPanel — 모식도 한 장을 **탐구 화면의 카드로** 놓는 껍데기 (MT-22 배선).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  2026-08-19 재제작 — **자체 렌더러를 버리고 보드 무대에 얹었다**
 * ══════════════════════════════════════════════════════════════════════════════
 * 종전에는 `schematic/SchematicGL`(MT-22 전용 입체 화살표 렌더러)을 걸었다.
 * 그 렌더러의 항목 종류가 `arrow`·`line`·`label` 셋뿐이라 **하늘도 땅도 구름도
 * 그릴 수 없었고**, 그것이 「검은 배경에 화살표만」이라는 반려의 직접 원인이었다.
 * 이제 **보드 판정 화면과 같은 렌더러**(`board/webgl/crossSection/CrossSectionGL`)를
 * 쓴다 — 무대(하늘·지면·바다·흙 앞단면·유리 상자·지표 격자)와 팔레트와 라벨
 * 문법(흰 헤일로)이 같아진다.
 *
 * 🔴 **같은 화면에 이미 그 언어가 있다**: `AtmosphereBoard`가 샌드박스 모드에서도
 * `CrossSectionPanel`을 렌더한다. 탐구 화면에 **다른 언어의 패널**을 놓으면 한
 * 화면 안에서 충돌한다 — 그것이 「보드 무대 재사용」이 옳은 결정적 이유다.
 *
 * 판단 다섯을 여기 적어 둔다.
 *  ⑴ **자동 재생을 넣었다**(보드와 같은 1.4초/단계). 종전에는 수동 전용이라
 *     *"없는 기능은 회귀하지 않는다"*고 적어 두었으나, 보드 규약이 자동 재생이므로
 *     **같아 보이려면 넘어가는 리듬도 같아야 한다.** 대신 정지 버튼을 함께 둔다.
 *  ⑵ **`prefers-reduced-motion`이면 마지막 단계 정지 화면 + 전 단계 텍스트 목록**
 *     — 보드 `CrossSectionPanel`의 기존 계약을 그대로 답습한다.
 *  ⑶ **GL 실패는 `onFail`로만 판정한다**(사전 probe 없음). `CrossSectionGL`은
 *     WebGL2가 없으면 스스로 `onFail`을 올리고, 그때 단계 제목 목록으로 내려간다 —
 *     그림이 못 떠도 **가르치려던 이야기는 읽힌다.**
 *     ⚠️ **`lazy()`로 감싸지 않는다.** 감싸면 SSR에서 Suspense 폴백만 나가고
 *     **장면 라벨이 HTML에 한 글자도 안 남는다** — `exploreSims.render.test`가
 *     「그 장면이 그 자리에 배선됐다」를 그 라벨로 확인하므로, 게으른 적재는
 *     여기서 계약을 깬다(보드 패널은 SVG 폴백이 있어 감쌀 수 있었다).
 *     💰 **대가는 실측했다**: 정적 import로 `CrossSectionGL` 청크(24.1kB · gzip 9.3kB)가
 *     메인 번들로 합쳐진다(1,200.1 → 1,224.4kB · gzip 353.5 → 362.4kB, 2026-08-19
 *     `npx vite build` 양쪽 실측). 라우트가 코드 분할돼 있지 않아 **어떤 정적 import든
 *     메인으로 간다** — 즉 이 비용은 게으른 적재를 포기한 대가가 아니라 라우트 분할이
 *     없는 대가다. 라우트를 나누면 저절로 회수된다(그 판단은 이 과업 밖).
 *  ⑷ 화면비는 `CrossSectionGL`이 260:150으로 잡는다(보드 패널과 같은 판형).
 *  ⑸ 🔴 **긴 문장은 캔버스가 아니라 여기가 그린다**(2026-08-19 2차 보정).
 *     보드 `CrossSectionPanel`이 그렇게 한다 — 단계 캡션(`steps[step]`)은 캔버스
 *     **아래 HTML**이고 캔버스 안 라벨은 `V.*`의 **짧은 명사구**뿐이다. 1차
 *     재제작은 설명 문장을 캔버스 안에 눕혀 놨고, 라벨 화면 좌표 실측에서
 *     **보드 라벨이 top 5~66%에 머무는 동안 T2만 82%까지 내려갔다** — 반려 사유였던
 *     「떠 있는 글자 목록」과 같은 형태다. 그래서 `steps[].note`를 받아 여기서
 *     캡션 둘째 줄로 뿌린다. `note`는 **없어도 된다**(있는 장면만 쓴다).
 *
 * ✅ **i18n 외부화 완료(2026-08-20 · §4.25 이월 집행).** 여기의 단계 컨트롤 라벨과
 * 호출부가 넘기는 제목·설명·aria가 전부 `explore.schematic.*`(board.ko.js·board.en.js)로
 * 나갔고, `displayLayerParity.contract`의 `HANGUL_GAPS`에서 MT-22 6건이 사라졌다.
 * **값은 한 글자도 바꾸지 않았다** — 「같은 글자를 다른 곳에서 읽게 하는 것」이다.
 */

/** 단계당 재생 시간(ms) — 보드 `CrossSectionPanel.STEP_MS`와 같은 값이다 */
const STEP_MS = 1400;

/*
 * `autoPlay=false`면 **멈춘 채로 뜬다**(2026-08-21 사용자 지시 — "애니메이션
 * 모식도 두 개가 계속 움직여서 싫은데"). 두 장을 한 화면에 놓으면 각자 1.4초
 * 마다 단계를 넘겨 **서로 다른 리듬으로 동시에 움직인다** — 어느 쪽을 봐야
 * 하는지가 사라진다. 그래서 개념 화면에서도 **한 번에 한 장만** 자동 재생하고
 * 나머지는 첫 단계에 멈춰 세운다(재생 버튼은 그대로라 언제든 돌릴 수 있다).
 * ⚠️ 기본값은 `true`다 — 기존 호출부(기후 C1)의 동작을 바꾸지 않는다.
 */
export default function SchematicPanel({ title, caption, scene, steps, ariaLabel, autoPlay = true }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [failed, setFailed] = useState(false);
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const last = steps.length - 1;

  // reduced-motion이면 최종 프레임 고정 — 애니메이션도 자동 재생도 없다
  useEffect(() => {
    if (!reduced) return;
    setPlaying(false);
    setStep(last);
  }, [reduced, last]);

  useEffect(() => {
    if (!playing || reduced || failed) return undefined;
    const id = setTimeout(() => setStep((n) => (n >= last ? 0 : n + 1)), STEP_MS);
    return () => clearTimeout(id);
  }, [playing, reduced, failed, step, last]);

  const showGl = !failed && !reduced;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-bold text-slate-700">{title}</p>
      {caption ? <p className="text-[11px] text-slate-400">{caption}</p> : null}

      {showGl ? (
        <div className="mt-2 overflow-hidden rounded-xl bg-slate-100" role="img" aria-label={ariaLabel ?? title}>
          <CrossSectionGL scene={scene} step={step} onFail={() => setFailed(true)} />
        </div>
      ) : null}

      {reduced || !showGl ? (
        /* 정지 모드·미지원 — 단계 제목과 설명을 전부 글로 남긴다(보드와 같은 계약) */
        <ol className="mt-2 list-decimal space-y-0.5 pl-4">
          {steps.map((s) => (
            <li key={s.key} className="text-[11px] leading-relaxed text-slate-600">
              {s.title}
              {s.note ? <span className="text-slate-400">{` — ${s.note}`}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            {/* 한 표현식으로 묶는다 — 조각으로 쓰면 React가 텍스트 노드를 갈라
                `1<!-- -->/<!-- -->5단계`가 되고, 문자열로 확인하는 스모크가
                "화면에 뜨는 그대로"를 못 잡는다(하네스에서 실측). */}
            <span className="font-bold text-sky-700">
              {t('explore.schematic.panel.counter', { n: step + 1, total: steps.length })}
            </span>{' '}
            {steps[step].title}
          </p>
          {/* 🔴 캔버스에 넣지 않는 긴 문장의 자리 — 판단 ⑸ 참조 */}
          {steps[step].note ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{steps[step].note}</p>
          ) : null}

          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? t('explore.schematic.panel.pause') : t('explore.schematic.panel.play')}
              className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-700"
            >
              {playing ? t('explore.schematic.panel.stop') : t('explore.schematic.panel.play')}
            </button>
            <button
              type="button"
              onClick={() => { setPlaying(false); setStep((n) => Math.max(0, n - 1)); }}
              disabled={step === 0}
              aria-label={t('explore.schematic.panel.prevAria')}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            >
              {t('explore.schematic.panel.prev')}
            </button>
            <button
              type="button"
              onClick={() => { setPlaying(false); setStep((n) => Math.min(last, n + 1)); }}
              disabled={step === last}
              aria-label={t('explore.schematic.panel.nextAria')}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            >
              {t('explore.schematic.panel.next')}
            </button>
            <div className="ml-1 flex items-center gap-1">
              {steps.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { setPlaying(false); setStep(i); }}
                  aria-label={t('explore.schematic.panel.dotAria', { n: i + 1, title: s.title })}
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
