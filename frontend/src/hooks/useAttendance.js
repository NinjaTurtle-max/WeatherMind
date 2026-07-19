import { useEffect, useRef, useState } from 'react';
import { progressApi } from '../api';
import { useProgressStore } from '../store/progressStore';

/**
 * 출석 체크 훅 (04번 스펙: 로그인 후 메인 페이지 최초 진입 시 자동,
 * 오늘의 퀴즈 로딩과 동시에 POST /progress/attendance 호출)
 * 세션 내 중복 호출을 막기 위해 날짜 기준으로 1회만 호출한다.
 */
export function useAttendance(enabled = true) {
  const setStreak = useProgressStore((s) => s.setStreak);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!enabled || calledRef.current) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = 'weathermind-attendance-date';
    if (sessionStorage.getItem(key) === today) return;

    calledRef.current = true;
    progressApi
      .checkAttendance()
      .then((res) => {
        sessionStorage.setItem(key, today);
        if (typeof res?.streak_count === 'number') setStreak(res.streak_count);
        setIsNewRecord(Boolean(res?.is_new_record));
      })
      .catch(() => {
        // 출석 실패는 퀴즈 플로우를 막지 않는다.
        calledRef.current = false;
      });
  }, [enabled, setStreak]);

  return { isNewRecord };
}
