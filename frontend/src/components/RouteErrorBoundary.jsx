import { Component } from 'react';
import { translate, getCurrentLocale } from '../i18n/core.js';

/**
 * 라우트 상위 에러 바운더리 — **화면 전체가 백지가 되는 것**만 막는다.
 *
 * ── 왜 있나(이월 대장 §4.31) ────────────────────────────────────────────────
 * `SatelliteView`가 던진 `TypeError` 하나에 `TyphoonSimPage`가 통째로 언마운트됐다.
 * `/explore/typhoon` 진입 후 **아무 조작 없이 24초** 만에 백지 — 위성 도식 한 칸이
 * 죽었을 뿐인데 목표 카드·게이지·슬라이더·모식도가 전부 사라졌다. React가 콘솔에
 * 스스로 적는다: *"Consider adding an error boundary to your tree."*
 *
 * 🔴 **그 예외 자체는 이미 고쳐졌다**(`2381d20` — `stormSprites`의 null 두 경로 +
 * 부분 null 가드, `exploreMount.smoke`가 ①~⑦로 문다). 이 파일은 **다른 층**이다:
 * 「예외가 나지 않게」가 아니라 **「예외가 나도 화면이 백지가 되지 않게」**. 다음에
 * 다른 컴포넌트가 던지면 원인은 달라도 귀결이 같기 때문에 남긴다 — 심사 중 보험.
 *
 * ── 왜 라우트 상위 **한 곳**인가 ────────────────────────────────────────────
 * 대장 §4.31은 「라우트/카드 단위」를 그려 뒀지만, 카드마다 두르는 것은 **모든
 * 화면의 렌더 트리를 건드리는 일**이라 동결 전날의 회귀면이 아니다. 여기 있는 것은
 * **추가형 하나**다: 기존 컴포넌트의 로직을 한 줄도 옮기지 않고 `<Routes>` 위에만
 * 선다. 잃는 것은 **부분 생존**(한 칸만 죽고 나머지가 사는 것)이고 얻는 것은
 * **백지가 아닌 화면**이다. 카드 단위 경계는 대회 후의 일로 남는다.
 *
 * ── 다음 사람이 밟을 함정 ───────────────────────────────────────────────────
 * ⚠️ **경계가 라우터보다 위에 있어서, 한 번 잡히면 라우팅으로는 안 풀린다.** 그래서
 *    되돌아갈 길을 `<Link>`가 아니라 **`window.location`**으로 만들었다 — `<Link>`를
 *    쓰면 URL만 바뀌고 이 대체 화면이 그대로 남아 있는다(경계 state가 살아 있으니).
 *    상태를 리셋하는 「다시 시도」를 만들 수도 있지만, 던진 원인이 그대로면 즉시
 *    다시 던져 깜빡임만 남는다. **리로드가 정직한 재시도다.**
 * ⚠️ **class 컴포넌트라 `useT`를 못 쓴다.** `translate(getCurrentLocale(), …)`는
 *    `App.jsx`가 `LoadingSpinner` 라벨에 쓰는 것과 같은 관례다. 한국어 리터럴을
 *    여기 박지 말 것 — 문구의 소유자는 `i18n/resources/{ko,en}.js`의
 *    `errorBoundary` 블록 하나다.
 * ⚠️ **예외 객체를 화면에 렌더하지 않는다.** 스택·컴포넌트 트레이스는 학습자에게
 *    아무 뜻이 없고 내부 경로를 노출한다. 대신 `componentDidCatch`가 **콘솔에**
 *    남긴다 — 대장 §4.31이 물은 "경계가 삼킨 예외를 어디서 보는가"의 답이 이 한 줄이다.
 *    조용히 삼키면 결함이 안 보이고, 그것은 백지와 다른 종류의 손실이다.
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // 삼킨 예외의 유일한 출구. 화면에는 안 보내고 콘솔에만 남긴다.
    console.error('[RouteErrorBoundary] 화면 렌더가 실패했습니다', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const t = (key) => translate(getCurrentLocale(), key);
    return (
      <div
        role="alert"
        className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div aria-hidden="true" className="text-4xl">🌫️</div>
        <h1 className="text-lg font-bold text-slate-800">{t('errorBoundary.title')}</h1>
        <p className="text-sm leading-relaxed text-slate-500">{t('errorBoundary.body')}</p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white"
            onClick={() => window.location.reload()}
          >
            {t('errorBoundary.retry')}
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600"
            onClick={() => window.location.assign('/')}
          >
            {t('errorBoundary.home')}
          </button>
        </div>
      </div>
    );
  }
}
