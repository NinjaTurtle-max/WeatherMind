import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { runStaleBundleGuard } from './lib/staleBundleGuard';
import './styles/index.css';

// 스테일 번들 자가 복구(R8-01 B②) — 운영 빌드에서만, 앱 시작 시 1회.
// 캐시된 옛 index.html이 옛 번들을 참조하면 no-store 재조회로 감지해 1회 리로드
// (sessionStorage 가드로 루프 방지, 실패는 조용히 무시). dev 서버(vite)는 비활성.
if (!import.meta.env.DEV) {
  runStaleBundleGuard();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
