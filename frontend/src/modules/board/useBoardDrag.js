/**
 * useBoardDrag — Pointer Events 기반 팔레트→존 드래그 (R9-01 §3.3 ③).
 *
 * HTML5 Drag&Drop은 터치를 지원하지 않아(모바일 드래그 0) Pointer Events로
 * 자체 구현한다. 마우스·터치·펜을 단일 코드 경로로 처리하며, 기존 탭-탭
 * 배치 경로(접근성·키보드)는 그대로 병행한다.
 *
 * 동작:
 *  - pointerdown: 후보 등록만 (이동 임계값 전에는 클릭/탭으로 취급)
 *  - 이동 ≥ 6px: 드래그 시작(setPointerCapture) — 고스트 표시
 *  - pointermove: document.elementFromPoint로 [data-board-zone] 히트 테스트,
 *    존 위에 오면 overZone + 존 중심 좌표(snap)로 고스트 스냅
 *  - pointerup: overZone이면 onDropZone(zone, item) 배치, 직후 click 1회 억제
 *    (드래그가 탭-선택으로 오인되지 않게)
 *  - pointercancel/비활성(enabled=false): 드래그 폐기
 *
 * 주의: 드래그 핸들에는 CSS touch-action: none이 필요하다(터치 스크롤 차단).
 */
import { useEffect, useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 6;

export default function useBoardDrag({ enabled, onDropZone }) {
  // drag: {item, x, y, overZone, snap:{x,y}|null} | null — 고스트·하이라이트 렌더용
  const [drag, setDrag] = useState(null);
  const pendingRef = useRef(null); // {item, startX, startY, pointerId, target}
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const onDropZoneRef = useRef(onDropZone);
  onDropZoneRef.current = onDropZone;

  const endDrag = () => {
    pendingRef.current = null;
    draggingRef.current = false;
    setDrag(null);
  };

  // 비활성 전환(제출·판정 중) 시 진행 중 드래그 폐기
  useEffect(() => {
    if (!enabled) endDrag();
  }, [enabled]);

  useEffect(() => {
    /** 좌표의 존 히트 테스트 — 고스트는 pointer-events:none이라 걸리지 않는다 */
    const hitTestZone = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const zoneEl = el?.closest?.('[data-board-zone]');
      if (!zoneEl) return { overZone: null, snap: null };
      const zone = Number(zoneEl.getAttribute('data-board-zone'));
      if (!Number.isInteger(zone)) return { overZone: null, snap: null };
      const r = zoneEl.getBoundingClientRect();
      return { overZone: zone, snap: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
    };

    const onMove = (e) => {
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!draggingRef.current) {
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        draggingRef.current = true;
        try {
          p.target?.setPointerCapture?.(p.pointerId);
        } catch {
          /* 캡처 실패해도 window 리스너로 계속 추적 */
        }
      }
      const { overZone, snap } = hitTestZone(e.clientX, e.clientY);
      setDrag({ item: p.item, x: e.clientX, y: e.clientY, overZone, snap });
    };

    const onUp = (e) => {
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (draggingRef.current) {
        suppressClickRef.current = true; // 드래그 종료 직후 click 1회 무시
        const { overZone } = hitTestZone(e.clientX, e.clientY);
        if (overZone != null) onDropZoneRef.current?.(overZone, p.item);
      }
      endDrag();
    };

    const onCancel = (e) => {
      if (pendingRef.current && e.pointerId === pendingRef.current.pointerId) endDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, []);

  /** 팔레트 칩에 걸 핸들러 — <button onPointerDown={handlePointerDown(item)}> */
  const handlePointerDown = (item) => (e) => {
    if (!enabled || !e.isPrimary) return;
    pendingRef.current = {
      item,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      target: e.currentTarget,
    };
    suppressClickRef.current = false;
  };

  /** 칩 onClick 첫 줄에서 호출 — 드래그 직후의 합성 click을 1회 소비 */
  const shouldSuppressClick = () => {
    const s = suppressClickRef.current;
    suppressClickRef.current = false;
    return s;
  };

  return { drag, dragging: drag != null, handlePointerDown, shouldSuppressClick };
}
