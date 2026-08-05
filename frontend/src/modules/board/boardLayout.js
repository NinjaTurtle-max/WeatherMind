/**
 * boardLayout — 대기 보드 지도 좌표계 단일 소유자 (R10-00 웨이브 0).
 *
 * 좌표 **데이터**(FALLBACK_REGIONS, 정규화 0~100)와 그 **사영**(toUser, VIEW_W/VIEW_H)을
 * 한 파일에 둔다. 웨이브 0 이전에는 데이터가 AtmosphereBoard.jsx에, 사영이
 * PeninsulaMap.jsx에 흩어져 있어 한쪽만 고치면 지도가 조용히 깨졌다
 * (렌더 테스트는 좌표를 assert하지 않는다 — defs·data-board-zone 존재만 확인).
 *
 * **웨이브 1 동안 동결 계약(추가만 허용)**: 기존 export의 이름·시그니처·값을
 * 변경하지 않는다. FE-1(단면 패널)·FE-2(지도 오버레이)·FE-4(보드 조작)가
 * 동시에 이 좌표계를 전제로 작업하므로, 값 변경은 세 작업이 병합된 뒤에 한다.
 * 새 상수·헬퍼 추가는 허용.
 */

// ── SVG userSpace 단일 좌표계 (R9-01 §3.3 선행 리팩터) ──────────────────────
// viewBox 100×80 고정 종횡비(aspect-ratio) — preserveAspectRatio="none" 왜곡과
// "SVG 안 지도 + SVG 밖 절대배치 노드" 2원화를 함께 제거한다.
// 시드 좌표(0~100 정규화)는 y만 0.8 사영해 같은 userSpace에 놓는다.
// userSpace는 등방(1unit x = 1unit y)이므로 노드·심볼은 왜곡되지 않는다.
export const VIEW_W = 100;
export const VIEW_H = 80;
/** 정규화 좌표(0~100) → SVG userSpace */
export function toUser(point, dflt = [50, 50]) {
  const [x, y] = Array.isArray(point) && point.length >= 2 ? point : dflt;
  return [x * (VIEW_W / 100), y * (VIEW_H / 100)];
}

// 지리적 폴백 좌표(정규화 0~100) — /board/regions 미로드 시 사용.
// 좌표 SSOT = database/seed/board_regions.json (R9-01 §3.3 선행 리팩터: 시드↔폴백 일치).
// 값 변경은 시드 파일에서만 — 여기는 시드 사본(드리프트 금지).
// 값 출처는 docs/design/gen_peninsula.py의 ZONES — 지형 실루엣과 같은 확대 배율을
// 타므로 지형을 다시 뽑으면 여기·시드도 같이 갱신한다.
// 존을 프레임 가장자리로 밀지 말 것: 기단 유동 화살표가 오버레이 블리드 범위
// [-20,120]를 넘어 test:overlay가 깨진다(x=8.7로 밀었다가 실제로 깨뜨렸다).
export const FALLBACK_REGIONS = [
  { name: '서해상', svg_point: [14.0, 45.8], label_anchor: [14.0, 56.8] },
  { name: '수도권', svg_point: [36.0, 32.4], label_anchor: [36.0, 21.4] },
  { name: '영서·태백', svg_point: [58.0, 47.0], label_anchor: [58.0, 58.0] },
  { name: '영동·동해', svg_point: [74.0, 39.1], label_anchor: [80.0, 28.1] },
];
