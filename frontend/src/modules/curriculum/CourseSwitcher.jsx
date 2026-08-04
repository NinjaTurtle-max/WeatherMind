import { useQuery } from '@tanstack/react-query';
import { curriculumApi } from '../../api';

/**
 * CourseSwitcher (R11-01 §6.2 — "코스 선택") — 학습 홈 상단 코스 탭.
 *
 * GET /courses를 소비해 코스 목록을 탭으로 렌더한다. 선택은 CurriculumHome이
 * 소유한다(선택 코스로 `?course=` 트리를 재조회해야 하므로) — 이 컴포넌트는
 * `selected`/`onSelect`만 받는 표시 계층이고, 데이터 소비는 `useCourses()`로
 * 이 파일에 둔다. CurriculumHome도 같은 훅(같은 쿼리 키)을 보므로 요청은 1회다
 * (CloudEnergyBadge ↔ 학습 홈 energy 조회와 같은 관례).
 *
 * 하위 호환(디그레이드): /courses가 없거나(구 백엔드·코스 미시드 DB·dev mock
 * 미구현) 코스가 1개뿐이면 **아무것도 렌더하지 않는다** — 학습 홈은 현행
 * weather 트리 그대로다(기존 스모크 무회귀가 판정 기준).
 *
 * prereq_course_id는 "선행 학습(권장)" **표기까지만** — 잠금이 아니다
 * (웨이브 2 PM 판정 ①: 강제 잠금은 기존 유저 하위 호환을 깬다). 탭은 항상
 * 활성이고, 권장 선행은 칩과 title 툴팁으로만 알린다.
 */

export function useCourses() {
  const { data } = useQuery({
    queryKey: ['courses'],
    queryFn: curriculumApi.fetchCourses,
    staleTime: 300_000, // 코스 목록은 시드 데이터 — 세션 내 재조회 불필요
    retry: false, // 미구현 백엔드/mock에서 재시도로 시간 끌지 않고 즉시 디그레이드
  });
  return data?.courses ?? [];
}

export default function CourseSwitcher({ selected, onSelect }) {
  const courses = useCourses();
  if (courses.length < 2) return null; // 단일 코스 = 선택할 것이 없다(현행 화면 유지)

  const titleBySlug = Object.fromEntries(courses.map((c) => [c.id, c.title]));

  return (
    <div role="tablist" aria-label="코스 선택" className="mb-4 flex flex-wrap gap-2">
      {courses.map((course) => {
        const active = course.id === selected;
        const prereqTitle = course.prereq_course_id
          ? (titleBySlug[course.prereq_course_id] ?? course.prereq_course_id)
          : null;
        return (
          <button
            key={course.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(course.id)}
            title={
              prereqTitle
                ? `선행 학습(권장): ${prereqTitle} — 권장일 뿐 잠기지 않아요`
                : course.description ?? course.title
            }
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
              active
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {course.title}
            {prereqTitle && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active ? 'bg-sky-500 text-sky-50' : 'bg-indigo-50 text-indigo-500'
                }`}
              >
                선행 학습(권장)
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
