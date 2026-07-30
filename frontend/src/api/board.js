import client from './client';

/**
 * Board API (스프린트 R3-01 계약 §3.5 — /api/v1/board)
 * 세션 밖 단독 연습 플레이 + 규칙 로드(프론트 로컬 미리보기용 단일 진실원).
 */

// GET /board/rules → board_rules.json 원문 (§3.2 규칙 배열)
//   boardEngine이 이 규칙으로 로컬 미리보기 판정을 수행한다 — JS에 규칙 하드코딩 금지.
export async function fetchBoardRules() {
  const res = await client.get('/board/rules');
  return res.data;
}

// GET /board/regions → [{zone, name, svg_point:[x,y], label_anchor:[x,y]}] (R5-01 §3.1)
//   지도 렌더 전용 좌표(정규화 0~100). 판정에 미사용 — zone index↔지역 고정 매핑.
export async function fetchBoardRegions() {
  const res = await client.get('/board/regions');
  return res.data;
}

// GET /board/puzzles → [{content_item_id, template_json, cleared}]
//   보드 유형은 비밀 정답이 없으므로 template_json 전체 노출(힌트 단계 공개는 클라이언트 제어).
export async function fetchBoardPuzzles() {
  const res = await client.get('/board/puzzles');
  return res.data;
}

// POST /board/puzzles/{content_item_id}/attempt {board_state}
//   → {passed, phenomena, feedback, xp_earned} — 최초 클리어만 +5 XP(재도전 0)
//   + crown_award (R8-01 §3.4, additive): {unit_slug, unit_title, crowns, cleared} | null
//     — 퍼즐 최초 클리어이고 같은 concept_tag의 kind='board' 유닛이 열려 있으면 왕관 +1.
export async function submitBoardAttempt(contentItemId, boardState) {
  const res = await client.post(`/board/puzzles/${contentItemId}/attempt`, {
    board_state: boardState,
  });
  return res.data;
}
