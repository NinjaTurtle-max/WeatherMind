import client from './client';

/** Quiz API (02번 스펙 — /api/v1/quiz) */

// GET /quiz/today → QuizQuestion[]
export async function fetchTodayQuiz() {
  const res = await client.get('/quiz/today');
  return res.data;
}

// POST /quiz/{quiz_id}/answer {answer: string} → AnswerResult
export async function submitAnswer(quizId, answer) {
  const res = await client.post(`/quiz/${quizId}/answer`, { answer: String(answer) });
  return res.data;
}

// GET /quiz/history?limit=20 → QuizLog[]
export async function fetchQuizHistory(limit = 20) {
  const res = await client.get('/quiz/history', { params: { limit } });
  return res.data;
}
