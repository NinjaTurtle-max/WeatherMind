import { useQuery } from '@tanstack/react-query';
import { curriculumApi } from '../../api';
import { useT } from '../../i18n';

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

/**
 * @param variant  'pill'(기본) — 카드 **밖**에 뜨는 알약 꼴. 모바일 목록이 쓴다.
 *   'tab' — **경로 카드 안 맨 위**에 붙는 웹 브라우저 탭 꼴(2026-08-13 클라이언트
 *   지시: "섹션 변경 노드를 학습 경로 란에 넣어, 웹페이지 탭 노드처럼").
 *   차이는 모양만이 아니다 — 탭은 **아래 내용에 붙어** 있어야 「이 경로를 바꾸는
 *   스위치」로 읽힌다. 그래서 아래 테두리를 공유하고, 선택된 탭만 그 선을 끊는다.
 */
export default function CourseSwitcher({ selected, onSelect, variant = 'pill' }) {
  const courses = useCourses();
  const t = useT();
  if (courses.length < 2) return null; // 단일 코스 = 선택할 것이 없다(현행 화면 유지)

  // 코스 제목·설명은 서버 시드(courses.json) 파생 — 외부화 대상 아님(§6.3).
  const titleBySlug = Object.fromEntries(courses.map((c) => [c.id, c.title]));

  // 탭은 학습 경로 위에 얹히는 보조 조작이다 — 크게 잡으면 정작 트랙이 밀린다.
  // (2026-08-05) 칩 치수를 줄여 세로를 트랙에 돌려준다.
  return (
    <div
      role="tablist"
      aria-label={t('curriculum.switcher.aria')}
      className={
        variant === 'tab'
          ? 'flex flex-wrap items-end gap-1 border-b border-slate-200 px-3 pt-2.5'
          : 'mb-2.5 flex flex-wrap gap-1.5'
      }
    >
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
                ? t('curriculum.switcher.prereqTitle', { title: prereqTitle })
                : course.description ?? course.title
            }
            className={
              variant === 'tab'
                ? // 웹 탭 꼴 — 위 모서리만 둥글고, **선택된 탭이 아래 테두리를 끊어**
                  // 카드와 이어진다(`-mb-px`가 그 한 픽셀을 덮는다).
                  `-mb-px flex items-center gap-1 rounded-t-lg border border-b-0 px-3.5 py-1.5 text-[12.5px] font-bold transition ${
                    active
                      ? 'border-slate-200 bg-white text-sky-700'
                      : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`
                : `flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-bold transition ${
                    active
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`
            }
          >
            {course.title}
            {prereqTitle && (
              <span
                className={`rounded-full px-1.5 py-px text-[9.5px] font-bold ${
                  active ? 'bg-sky-500 text-sky-50' : 'bg-indigo-50 text-indigo-500'
                }`}
              >
                {t('curriculum.switcher.prereqChip')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
