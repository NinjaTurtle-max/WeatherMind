import client from './client';

/**
 * 기후 탐정 API (/api/v1/detective — R13, 대장 CO-N-2).
 *
 * 채점 권위는 서버다. 상세 응답에는 판정(verdict)·피드백·해설이 **구조적으로
 * 없고**, 프론트가 정답을 계산할 재료 자체를 받지 못한다(보드의 correct_answer
 * 제외 관례와 동일). 판정은 오직 submitSolve의 응답으로만 온다.
 */

// GET /detective/cases → [{case_id, title, headline, concept_tag, min_clues,
//   clue_count, hypothesis_count, xp_reward, ...}]  케이스 0건이면 빈 배열(200).
export async function fetchDetectiveCases() {
  const res = await client.get('/detective/cases');
  return res.data;
}

// GET /detective/cases/{case_id} → {intro, series[], clues[], hypotheses[{hypothesis_id, text}]}
//   404 CASE_NOT_FOUND — 없는 케이스.
export async function fetchDetectiveCase(caseId) {
  const res = await client.get(`/detective/cases/${caseId}`);
  return res.data;
}

// POST /detective/cases/{case_id}/solve {hypothesis_id, opened_clue_ids}
//   → {verdict('correct'|'partial'|'incorrect'), correct, feedback, supporting_clues,
//      solution|null, xp_earned, opened_clue_count, min_clues}
//   xp_earned는 **실제 적립액**이다(2026-08-20, 918a8e8): 그 케이스를 처음 맞혔을
//     때만 xp_reward, 재제출·오답·부분정답은 0. 서버가 quiz_logs 마커로 멱등을
//     지키므로 프론트가 「이미 받았는지」를 따로 계산하지 않는다 — 0이 곧 답이다.
//     화면 표시는 CasePlayPage가 소유한다(0은 그리지 않는다).
//   422 NOT_ENOUGH_CLUES — 연 단서가 min_clues 미만. **서버가 조사 과정을 강제한다**:
//     UI가 버튼을 잠그는 것과 별개로 서버가 다시 막는다(클라이언트 우회 불가).
//   422 UNKNOWN_HYPOTHESIS — 케이스에 없는 가설 id.
export async function submitSolve(caseId, hypothesisId, openedClueIds) {
  const res = await client.post(`/detective/cases/${caseId}/solve`, {
    hypothesis_id: hypothesisId,
    opened_clue_ids: openedClueIds,
  });
  return res.data;
}
