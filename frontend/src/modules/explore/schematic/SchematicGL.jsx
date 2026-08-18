/**
 * SchematicGL — 입체 화살표 모식도 한 칸 (MT-22).
 *
 * 하는 일은 셋뿐이다: 캔버스를 걸고, `mountSchematic`에 생명주기를 맡기고,
 * **글자를 GL 대신 DOM으로 겹쳐** 그린다(`labelsFor` — 드로우콜이 늘지 않는다).
 *
 * ⚠️ **아직 어느 화면에도 배선하지 않았다.** MT-22는 「1종만 세우고 실기기로 확인」으로
 * 잘렸고, 어디에 놓을지는 제품 판단이라 이 세션의 소유가 아니다. 이 파일은 놓을 때
 * 필요한 최소 껍데기이고, 배선은 `<SchematicGL scene={RADIATION_SCENE} step={n} />`
 * 한 줄이면 된다.
 *
 * ⚠️ **문구가 한국어 리터럴이다**(여기와 `radiationScene.js`). i18n 외부화는 별도
 * 담당 소유라 `i18n/resources/**`를 건드리지 않았다 — 옮길 대상은 이 파일의
 * 폴백 문구 1개와 장면의 `text` 문자열들이다.
 *
 * 실패는 「아무 일도 안 일어남」으로 수렴한다: WebGL2가 없거나 컨텍스트를 잃으면
 * 캔버스를 감추고 한 줄짜리 대체 문구만 남으며 `onFail`이 올라간다.
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { mountSchematic, labelsFor } from './renderer.js';

export default function SchematicGL({
  scene, step = 0, className = '', ariaLabel = '모식도', onFail,
}) {
  const canvasRef = useRef(null);
  const handleRef = useRef(null);
  const [ok, setOk] = useState(true);
  const [aspect, setAspect] = useState(16 / 10);

  // 마운트는 **장면이 바뀌어도 다시 하지 않는다** — 컨텍스트를 새로 만드는 것이
  // R10-06이 물린 자리다. 장면·단계는 아래 두 이펙트가 얹기만 한다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handle = mountSchematic(canvas, {
      onFail: () => { setOk(false); onFail?.(); },
    });
    handleRef.current = handle;
    if (!handle) return undefined;
    setAspect(handle.renderer.aspect);
    return () => { handle.dispose(); handleRef.current = null; };
    // onFail은 의도적으로 의존에서 뺀다(부모가 인라인 함수를 넘겨도 재마운트 금지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = handleRef.current;
    if (!h || !scene) return;
    h.setScene(scene);
    h.setStep(step);
    setAspect(h.renderer.aspect);
    // step은 아래 이펙트가 따로 본다 — 여기서는 장면 교체 직후 한 번만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  useEffect(() => {
    handleRef.current?.setStep(step);
  }, [step]);

  const labels = useMemo(() => (ok && scene ? labelsFor(scene, step, aspect) : []), [ok, scene, step, aspect]);

  return (
    <div className={`relative w-full ${className}`} role="img" aria-label={ariaLabel}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ display: ok ? 'block' : 'none' }}
      />
      {ok && labels.map((l) => (
        <span
          key={l.key}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap drop-shadow"
          style={{ left: `${l.left}%`, top: `${l.top}%`, color: l.color, fontSize: l.size, fontWeight: l.weight }}
        >
          {l.text}
        </span>
      ))}
      {!ok && (
        <p className="p-4 text-sm text-slate-400">이 기기에서는 입체 모식도를 표시할 수 없습니다.</p>
      )}
    </div>
  );
}
