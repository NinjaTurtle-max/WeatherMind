import axios from 'axios';
import { useAuthStore } from '../store/authStore';
// core만 import — index.js(zustand)를 끌면 mock의 순수 node 경로가 죽는다(core.js 주석)
import { translate, getCurrentLocale } from '../i18n/core.js';

/** 에러 정규화 시점의 현재 로케일로 폴백 문구를 푼다(§6.3 — ko 값 바이트 동일) */
function tNow(key) {
  return translate(getCurrentLocale(), key);
}

/**
 * 공통 axios 클라이언트 (02번 스펙 공통 규칙)
 * - Base URL: VITE_API_BASE_URL (기본 /api/v1 — nginx/vite 프록시가 backend:8000으로 전달)
 * - 인증: Authorization: Bearer {JWT}
 * - 에러 응답 포맷: {"detail": "메시지", "code": "ERROR_CODE"}
 * - 401 시 refresh_token으로 access_token 1회 재발급 후 원 요청 재시도
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

// ── 요청 인터셉터: JWT Bearer 부착 ──
client.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// ── 에러 정규화: {"detail","code"} → ApiError ──
export class ApiError extends Error {
  /**
   * body (CO-M4, 2026-08-08): 정규화가 detail·code·status만 남기고 **나머지 본문을
   * 버렸다**. 429 OUT_OF_CLOUDS 본문에는 `next_regen_sec`·`clouds`·`max`가 실려
   * 오는데(mock apiMockPlugin `outOfCloudsError`·서버 동일) 그 값이 화면에 도달할
   * 통로가 없어서 "몇 분 뒤에 열리는지"를 에러 화면이 말할 수 없었다.
   * 원문 본문을 그대로 달아 둔다 — 기존 3필드는 불변이라 소비처 회귀 0.
   */
  constructor({ detail, code, status, body = null }) {
    super(detail);
    this.name = 'ApiError';
    this.detail = detail;
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

function normalizeError(error) {
  if (error.response) {
    const data = error.response.data ?? {};
    // FastAPI 422 validation error는 detail이 배열로 올 수 있음
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg ?? JSON.stringify(d)).join(', ')
      : (data.detail ?? tNow('apiError.generic'));
    return new ApiError({
      detail,
      code: data.code ?? 'UNKNOWN_ERROR',
      status: error.response.status,
      body: data,
    });
  }
  return new ApiError({
    detail: tNow('apiError.network'),
    code: 'NETWORK_ERROR',
    status: 0,
  });
}

// ── 401 → refresh 처리 (동시 요청은 하나의 refresh를 공유) ──
let refreshPromise = null;

/**
 * 갱신 실패가 **되돌릴 수 없는 실패인가** — 토큰을 버려도 되는지의 판정.
 *
 * 🔴 이 판정이 없을 때 무슨 일이 있었나: 아래 인터셉터가 `refreshAccessToken()`이
 * 던지기만 하면 종류를 안 보고 `logout()`을 불렀고, `logout()`은
 * **refresh 토큰까지 지운다**. 게스트 비밀번호는 무작위 시크릿이라 그 토큰이
 * 유일한 열쇠다 — 즉 **지하철에서 잠깐 끊긴 것만으로 학습자의 계정이 영구
 * 소실**됐다. 진도는 서버에 멀쩡히 남아 있는데 다시 닿을 방법이 없어진다.
 *
 * 그래서 버리는 것은 **서버가 이 토큰을 거절했을 때뿐**이다(401·403 — 만료·폐기).
 * 네트워크 실패(`response` 없음)·5xx·타임아웃은 토큰의 유효성에 대해 아무것도
 * 말해 주지 않으므로 그대로 들고 있다가 다음 요청에서 다시 시도한다.
 *
 * `export`인 이유는 `tests/sessionExpiry.contract.test.mjs`가 경계
 * (401·403·5xx·네트워크·타임아웃)를 직접 재기 때문이다 — 인터셉터를 통째로
 * 흉내 내면 재는 것이 축소되고, 이 판정 하나가 「진도가 사라지는가」를 가른다.
 */
export function refreshIsUnrecoverable(err) {
  // refresh 토큰 자체가 없으면(스토어가 비었음) 들고 있을 것도 없다.
  if (err?.message === 'no refresh token') return true;
  const status = err?.response?.status;
  return status === 401 || status === 403;
}

async function refreshAccessToken() {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) throw new Error('no refresh token');
  if (!refreshPromise) {
    // 인터셉터 재귀를 피하기 위해 raw axios 사용 (02번: POST /auth/refresh)
    refreshPromise = axios
      .post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
      .then((res) => {
        const newToken = res.data.access_token;
        useAuthStore.getState().setAccessToken(newToken);
        return newToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config ?? {};
    const status = error.response?.status;
    const isAuthPath = (config.url ?? '').startsWith('/auth/');

    if (status === 401 && !config._retried && !isAuthPath) {
      config._retried = true;
      try {
        const newToken = await refreshAccessToken();
        config.headers = { ...config.headers, Authorization: `Bearer ${newToken}` };
        return client(config);
      } catch (refreshErr) {
        // refresh 실패 → **서버가 토큰을 거절했을 때만** 세션 만료 처리.
        // 끊긴 연결은 만료가 아니다(위 `refreshIsUnrecoverable` 주석).
        if (refreshIsUnrecoverable(refreshErr)) {
          useAuthStore.getState().logout();
        }
      }
    }
    return Promise.reject(normalizeError(error));
  },
);

export default client;
