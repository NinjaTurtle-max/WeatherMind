import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';

/**
 * 로그인 페이지 — POST /auth/login → {access_token, refresh_token}
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState({ email: '', password: '' });
  const [errorMsg, setErrorMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [guestSubmitting, setGuestSubmitting] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const data = await authApi.login(form);
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      setUser({ email: form.email });
      navigate('/', { replace: true });
    } catch (err) {
      setErrorMsg(err.detail ?? '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // R11-01 J: 가짜 토큰 조작 제거 → POST /auth/guest 실호출(실 유저 + 실 JWT).
  // 응답 형태는 login과 동일 스키마 {access_token, refresh_token}.
  // authApi(src/api/auth.js)는 이번 웨이브 소유 밖이라 공통 client를 직접 쓴다
  // — guest() 승격은 온보딩 재배치(웨이브 2)와 함께.
  const handleGuestLogin = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setGuestSubmitting(true);
    try {
      const { data } = await client.post('/auth/guest');
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      setUser({ nickname: '게스트', is_guest: true });
      navigate('/', { replace: true });
    } catch (err) {
      setErrorMsg(err.detail ?? '게스트 시작에 실패했습니다.');
    } finally {
      setGuestSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <p className="text-5xl">⛅</p>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">WeatherMind</h1>
        <p className="mt-1 text-sm text-slate-500">오늘의 날씨로 배우는 기상 · 기후 학습</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
      >
        <label className="text-sm font-semibold text-slate-700">
          이메일
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={handleChange}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          비밀번호
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            value={form.password}
            onChange={handleChange}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          />
        </label>

        {errorMsg && (
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
        >
          {submitting ? '로그인 중...' : '로그인'}
        </button>
        <button
          type="button"
          onClick={handleGuestLogin}
          disabled={guestSubmitting}
          className="mt-2 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {guestSubmitting ? '게스트 계정 만드는 중...' : '🚀 게스트(테스트) 계정으로 바로 시작하기'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        아직 계정이 없나요?{' '}
        <Link to="/register" className="font-bold text-sky-600 hover:underline">
          회원가입
        </Link>
      </p>
    </div>
  );
}
