import { useEffect, useRef, useState } from 'react';
import { progressApi } from '../api';
import { useProgressStore } from '../store/progressStore';

/** KST 오프셋(+09:00). 목(apiMockPlugin.KST_OFFSET_MS)·백엔드
 *  (session_service.kst_day_start_utc)와 같은 관례의 프론트 사본이다 —
 *  목을 import하면 프로덕션 번들이 목을 끌고 들어가므로 값만 맞춘다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 출석 중복 호출 방지 키에 쓸 **KST 날짜**(YYYY-MM-DD) — 순수 함수(CO-T-8).
 *
 * `toISOString().slice(0,10)`은 **UTC 날짜**라 서버의 하루(KST)와 어긋난다.
 * 재현: 8/6 22:00 KST에 탭을 열어 둔 채 8/7 02:00 KST에 다시 오면 UTC 날짜가
 * 둘 다 8/6이라 키가 같고 → 출석 호출을 건너뛰어 출석·+5 XP·스트릭이 통째로
 * 기록되지 않는다. **00:00~09:00 KST 창 전체**가 그 상태였다.
 *
 * now를 인자로 받으므로 테스트가 시각을 목 없이 직접 넣어 검증한다.
 */
export function kstDateKey(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 출석 체크 훅 (04번 스펙: 로그인 후 메인 페이지 최초 진입 시 자동,
 * 오늘의 퀴즈 로딩과 동시에 POST /progress/attendance 호출)
 * 세션 내 중복 호출을 막기 위해 **KST 날짜** 기준으로 1회만 호출한다.
 */
export function useAttendance(enabled = true) {
  const setStreak = useProgressStore((s) => s.setStreak);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!enabled || calledRef.current) return;
    const today = kstDateKey();
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
