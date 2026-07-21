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
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
        'xp-pop': 'xp-pop 0.5s ease-out',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
