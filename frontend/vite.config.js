import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import apiMockPlugin from './mock/apiMockPlugin.js';

// 개발 시(vite dev server)에는 /api/v1 요청을 로컬 backend(8000)로 프록시한다.
// 운영 빌드에서는 nginx가 동일한 경로를 backend:8000으로 프록시한다 (nginx.conf 참고).
export default defineConfig(() => {
  const isMock = process.env.VITE_MOCK === '1';

  return {
    plugins: [
      react(),
      isMock && apiMockPlugin(),
    ].filter(Boolean),
    server: {
      port: 5173,
      proxy: !isMock ? {
        '/api/v1': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      } : undefined,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});

