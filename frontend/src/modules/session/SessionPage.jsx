import { sessionApi } from '../../api';
import SessionRunner from './SessionRunner';

/**
 * SessionPage (R2-01 S7 · R5-01 §3.4) — 자유 일일 세션(하루 1세션 5문항).
 * R5-01에서 기본 진입(/)은 학습 홈(커리큘럼)으로 바뀌고, 이 자유 세션은 별도 진입(/daily)으로
 * 유지된다(계약 §3.4: 유닛 경로와 자유 일일 세션 병존). 상태머신은 공용 SessionRunner를 쓴다.
 *
 * 출석 체크는 학습 홈(기본 진입)으로 옮겼으므로 여기서는 호출하지 않는다.
 */
export default function SessionPage() {
  return (
    <SessionRunner
      queryKey={['session', 'today']}
      loadSession={sessionApi.fetchTodaySession}
      staleTime={5 * 60 * 1000}
      title="오늘의 기상 세션"
    />
  );
}
