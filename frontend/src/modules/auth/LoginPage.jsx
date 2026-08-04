import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';

/**
 * 로그인/시작 페이지 (R11-01 웨이브 2 §6.2 — R10-J 온보딩 재배치)
 *
 * "투자 후 계정 유도"(Observation_Report_03 §3.1 R10-J): 가입이 첫 관문이 아니라
 * **계정 없이 즉시 체험**이 주 동선이다. 게스트 CTA가 첫 시선, 이메일 로그인·가입은
 * 보조 동선으로 내린다. 진도 저장(계정 전환) 유도는 진도가 쌓인 뒤 GuestSaveBanner →
 * ConvertAccountPage가 맡는다.
 *
 * 게스트 시작 = POST /auth/guest 실호출(실 유저 + 실 JWT, R11-01 J) 후 배치고사로 —
 * 가입 동선과 동일하게 "배치고사 → 첫 세션"을 게스트로 완주할 수 있어야 한다(§6.2).
 * authApi(src/api/auth.js)는 이번 페이즈 소유 밖이라 공통 client를 직접 쓴다.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const setPostAuthRoute = useAuthStore((s) => s.setPostAuthRoute);

  const [form, setForm] = useState({ email: '', password: '' });
  const [errorMsg, setErrorMsg] = useState(null);
  const [guestErrorMsg, setGuestErrorMsg] = useState(null);
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

  const handleGuestStart = async () => {
    setGuestErrorMsg(null);
    setGuestSubmitting(true);
    try {
      const { data } = await client.post('/auth/guest');
      // 가입 동선과 동일한 경합 해소(R9-09): 목적지 의도를 토큰 반영 "전에" 실어,
      // RedirectIfAuthed의 <Navigate>가 먼저 발화해도 같은 곳(배치고사)으로 간다.
      setPostAuthRoute('/onboarding/placement');
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      setUser({ nickname: '게스트', is_guest: true });
      navigate('/onboarding/placement', { replace: true });
    } catch (err) {
      setGuestErrorMsg(err.detail ?? '시작에 실패했어요. 잠시 후 다시 시도해 주세요.');
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

      {/* ── 주 동선: 계정 없이 즉시 체험 (R10-J) ── */}
      <button
        type="button"
        onClick={handleGuestStart}
        disabled={guestSubmitting}
        className="rounded-2xl bg-sky-600 px-6 py-4 text-base font-extrabold text-white shadow-md transition hover:bg-sky-700 disabled:opacity-50"
      >
        {guestSubmitting ? '오늘의 하늘을 여는 중...' : '⚡ 계정 없이 바로 시작하기'}
      </button>
      <p className="mt-2 text-center text-xs text-slate-500">
        가입 없이 실력 진단과 오늘의 세션을 바로 체험해요. 쌓인 진도는 나중에 30초 가입으로
        저장할 수 있어요.
      </p>
      {guestErrorMsg && (
        <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-center text-sm text-orange-700">
          {guestErrorMsg}
        </p>
      )}

      {/* ── 보조 동선: 기존 계정 로그인 ── */}
      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium text-slate-400">이미 계정이 있나요?</span>
        <span className="h-px flex-1 bg-slate-200" />
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
          className="mt-1 rounded-xl bg-white py-3 text-sm font-bold text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-50 disabled:opacity-50"
        >
          {submitting ? '로그인 중...' : '로그인'}
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
