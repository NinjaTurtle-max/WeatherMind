import client from './client';

/**
 * Session API (스프린트 R2-01 계약 §3.1 — /api/v1/session)
 * SessionItem = 기존 QuizQuestion + {source: "bank"|"generated", slot_filled: bool}
 */

// GET /session/today
//   → {session_id, session_date, mode:"daily", items: SessionItem[], progress:{answered,total}}
//   멱등: 당일 재호출 시 동일 세션을 돌려준다.
export async function fetchTodaySession() {
  const res = await client.get('/session/today');
  return res.data;
}

// POST /session/{session_id}/answer {quiz_id, answer, elapsed_sec?}
//   → AnswerResult + {session_progress: {answered, total}}
export async function submitSessionAnswer(sessionId, { quizId, answer, elapsedSec }) {
  const body = { quiz_id: quizId, answer: String(answer) };
  if (typeof elapsedSec === 'number') body.elapsed_sec = elapsedSec;
  const res = await client.post(`/session/${sessionId}/answer`, body);
  return res.data;
}

// POST /session/{session_id}/complete
//   → {xp_total, correct_count, total, streak_count} — 전 문항 응답 시에만 성공, 미완료 시 409
export async function completeSession(sessionId) {
  const res = await client.post(`/session/${sessionId}/complete`);
  return res.data;
}
