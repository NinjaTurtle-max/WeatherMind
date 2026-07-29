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
        // 학습 홈 현재 유닛 노드 강조 (듀오링고식 맥동 링)
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
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
        'xp-pop': 'xp-pop 0.5s ease-out',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
        'cloud-drift': 'cloud-drift 2.4s ease-in-out infinite',
        'cloud-drift-slow': 'cloud-drift 3.6s ease-in-out infinite',
        'gauge-sweep': 'gauge-sweep 1.6s ease-in-out infinite',
        'scan-x': 'scan-x 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
