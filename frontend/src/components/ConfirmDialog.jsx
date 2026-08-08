import { useEffect, useRef } from 'react';

/**
 * ConfirmDialog — 되돌릴 수 없는 행동 앞의 확인 1단 (R13 CO-P-4).
 *
 * `SessionRunner`의 `LeaveIntentDialog`(§3.5)가 세운 관례를 그대로 따른다.
 * **브라우저 `confirm()`은 쓰지 않는다** — 문구를 못 고르고, 로케일을 못 따르고,
 * 포커스 복원이 없고, 무엇보다 대안(가입해서 저장하기)을 제시할 자리가 없다.
 *
 * 접근성 4종(그 자리에서 이미 구현된 것과 동일):
 *   1. `role="dialog"` + `aria-modal` + 제목·본문 연결(labelledby/describedby)
 *   2. 진입 시 **주 CTA에 포커스** — 주 CTA는 "안전한 쪽"(머무르기)이다
 *   3. Tab 순환(포커스 트랩) — 모달 밖으로 포커스가 새지 않는다
 *   4. Esc = 취소, 닫힐 때 **이전 포커스 복원**
 * 애니메이션 없음(reduced-motion 무관).
 *
 * 위험한 확정은 **작은 링크**로 내린다. 세션 이탈 확인과 같은 위계다:
 * 큰 버튼이 사고를 막고, 작은 링크가 의도를 확인한다.
 *
 * props:
 *   - title·body: 문구(호출측이 i18n으로 푼다 — 이 컴포넌트는 리소스를 모른다)
 *   - stayLabel·onStay: 주 CTA(안전) — Esc·배경 의미도 이쪽이다
 *   - confirmLabel·onConfirm: 위험한 확정(작은 링크)
 *   - altLabel·onAlt: 선택적 세 번째 길(예: "가입해서 저장하기") — 없으면 미렌더
 *   - testId: data-confirm-dialog 값(스모크가 문구가 아니라 역할로 집는다)
 */
export default function ConfirmDialog({
  title,
  body,
  stayLabel,
  onStay,
  confirmLabel,
  onConfirm,
  altLabel = null,
  onAlt = null,
  testId = 'confirm',
}) {
  const panelRef = useRef(null);
  const primaryRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    primaryRef.current?.focus();
    const focusables = () =>
      [...(panelRef.current?.querySelectorAll(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((el) => !el.disabled);
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onStay();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const activeEl = document.activeElement;
      const inside = panelRef.current?.contains(activeEl);
      if (e.shiftKey ? activeEl === first || !inside : activeEl === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-dialog-title`}
        aria-describedby={`${testId}-dialog-desc`}
        data-confirm-dialog={testId}
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
      >
        <p className="text-3xl" aria-hidden="true">⚠️</p>
        <h2
          id={`${testId}-dialog-title`}
          className="mt-2 text-lg font-extrabold text-slate-900"
        >
          {title}
        </h2>
        <p
          id={`${testId}-dialog-desc`}
          className="mt-1.5 text-sm leading-relaxed text-slate-500"
        >
          {body}
        </p>
        <button
          ref={primaryRef}
          type="button"
          onClick={onStay}
          className="mt-5 w-full rounded-xl bg-sky-600 py-3.5 text-base font-extrabold text-white transition hover:bg-sky-700"
        >
          {stayLabel}
        </button>
        {altLabel && onAlt && (
          <button
            type="button"
            onClick={onAlt}
            className="mt-2.5 w-full rounded-xl bg-white py-3 text-sm font-bold text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-50"
          >
            {altLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onConfirm}
          data-confirm-accept={testId}
          className="mt-3 text-xs font-medium text-slate-400 underline hover:text-slate-600"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
