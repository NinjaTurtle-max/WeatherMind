/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // 다크/라이트 OS 설정과 무관하게 일관된 스타일을 유지하기 위해
  // 'class' 전략을 사용하고 dark 클래스를 부여하지 않는다 (명시적 색상만 사용).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sky: {
          950: '#082f49',
        },
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'xp-pop': {
          '0%': { transform: 'scale(0.5)', opacity: '0' },
          '60%': { transform: 'scale(1.15)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        // 학습 홈 현재 유닛 노드 강조 (단계형 유닛 경로의 맥동 링)
        'pulse-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(14,165,233,0.5)' },
          '50%': { boxShadow: '0 0 0 6px rgba(14,165,233,0)' },
        },
        // 배치 "내 난이도를 찾는 중" 전환 화면 (R7-02 S1) — 구름·기압계 모티프
        'cloud-drift': {
          '0%, 100%': { transform: 'translateX(-6px)' },
          '50%': { transform: 'translateX(6px)' },
        },
        // 기압계 바늘 스윕 — translate로 다이얼 중심에 바늘 밑을 고정한 뒤 회전
        'gauge-sweep': {
          '0%, 100%': { transform: 'translate(-50%, -100%) rotate(-55deg)' },
          '50%': { transform: 'translate(-50%, -100%) rotate(55deg)' },
        },
        // 불확정 진행 바(좌→우 스캔)
        'scan-x': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        // ── 보드 2.0 현상 애니메이션 프리셋 프리미티브 (R9-01 §3.3 ④) ──
        // SVG 내부에서 CSS px = userUnit. 애니메이션 대상 <g>는 .svg-anim
        // (transform-box: fill-box) 필요 — index.css 참고.
        // 빗줄기 낙하(무한) — 정적 대체 시 기본 위치(공중)에 정지
        'board-rain': {
          '0%': { transform: 'translateY(-6px)', opacity: '0' },
          '15%': { opacity: '1' },
          '80%': { opacity: '0.9' },
          '100%': { transform: 'translateY(24px)', opacity: '0' },
        },
        // 눈송이 낙하(좌우 흔들림 포함, 무한)
        'board-snow': {
          '0%': { transform: 'translate(0, -4px)', opacity: '0' },
          '20%': { opacity: '1' },
          '55%': { transform: 'translate(3px, 12px)', opacity: '1' },
          '100%': { transform: 'translate(-2px, 26px)', opacity: '0' },
        },
        // 전선 진입(1회, 좌→우) — 판정 리플레이 시작 연출
        'board-front-advance': {
          '0%': { transform: 'translateX(-34px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        // 상승기류 화살표(무한)
        'board-updraft': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '30%': { opacity: '1' },
          '100%': { transform: 'translateY(-16px)', opacity: '0' },
        },
        // 구름 발달(1회 성장)
        'board-grow': {
          '0%': { transform: 'scale(0.45) translateY(8px)', opacity: '0' },
          '100%': { transform: 'scale(1) translateY(0)', opacity: '1' },
        },
        // 지면 열기 아지랑이(무한)
        'board-shimmer': {
          '0%, 100%': { opacity: '0.25', transform: 'translateY(0)' },
          '50%': { opacity: '0.9', transform: 'translateY(-2px)' },
        },
        // 태양 맥동(무한)
        'board-sun-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.12)', opacity: '0.85' },
        },
        // 번개 플래시(무한, 대부분 꺼짐)
        'board-flash': {
          '0%, 90%, 100%': { opacity: '0' },
          '92%': { opacity: '1' },
          '94%': { opacity: '0.2' },
          '96%': { opacity: '0.9' },
        },
        // ── 보드 실사화 (R9-08) ──
        // 구름 덩어리 부풀기(무한, 미세)
        'cloud-billow': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.06)' },
        },
        // 기단 색 번짐 확산 맥동(무한)
        'tint-spread': {
          '0%, 100%': { transform: 'scale(0.94)', opacity: '0.8' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
        // 유동 화살표 중심선 대시 흐름(무한) — stroke-dashoffset
        'flow-dash': {
          '0%': { strokeDashoffset: '15' },
          '100%': { strokeDashoffset: '0' },
        },
        // 전선 곡선 미세 숨쉬기(무한)
        'front-breathe': {
          '0%, 100%': { opacity: '0.85' },
          '50%': { opacity: '1' },
        },
        // 주석 라벨 등장(1회)
        'annot-in': {
          '0%': { opacity: '0', transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // 단면 모식도 단계 캡션/요소 등장(1회)
        'cs-step': {
          '0%': { opacity: '0', transform: 'translateY(3px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
        'xp-pop': 'xp-pop 0.5s ease-out',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
        'cloud-drift': 'cloud-drift 2.4s ease-in-out infinite',
        'cloud-drift-slow': 'cloud-drift 3.6s ease-in-out infinite',
        'gauge-sweep': 'gauge-sweep 1.6s ease-in-out infinite',
        'scan-x': 'scan-x 1.4s ease-in-out infinite',
        // 보드 2.0 (R9-01 §3.3 ④)
        'board-rain': 'board-rain 1.1s linear infinite',
        'board-rain-slow': 'board-rain 1.7s linear infinite',
        'board-snow': 'board-snow 2.6s linear infinite',
        'board-front': 'board-front-advance 1.2s ease-out forwards',
        'board-updraft': 'board-updraft 1.6s ease-out infinite',
        'board-grow': 'board-grow 0.9s ease-out forwards',
        'board-shimmer': 'board-shimmer 1.8s ease-in-out infinite',
        'board-sun-pulse': 'board-sun-pulse 2.2s ease-in-out infinite',
        'board-flash': 'board-flash 3.2s linear infinite',
        // 보드 실사화 (R9-08)
        'cloud-billow': 'cloud-billow 7s ease-in-out infinite',
        'tint-spread': 'tint-spread 5s ease-in-out infinite',
        'flow-dash': 'flow-dash 1.6s linear infinite',
        'front-breathe': 'front-breathe 3.4s ease-in-out infinite',
        'annot-in': 'annot-in 0.5s ease-out both',
        'cs-step': 'cs-step 0.45s ease-out both',
      },
    },
  },
  plugins: [],
};
