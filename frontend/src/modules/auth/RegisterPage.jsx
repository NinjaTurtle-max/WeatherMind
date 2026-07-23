import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import { useAuthStore } from '../../store/authStore';

const LEVEL_GROUPS = [
  { value: 'elementary', label: '초등학생' },
  { value: 'middle_high', label: '중·고등학생' },
  { value: 'adult', label: '성인' },
];

/**
 * 회원가입 페이지 — POST /auth/register {email, password, nickname, level_group}
 * 응답에는 access_token만 있으므로(02번 스펙), 가입 직후 /auth/login을 호출해
 * refresh_token까지 확보한다.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState({
    email: '',
    password: '',
    nickname: '',
    level_group: 'middle_high',
  });
  const [errorMsg, setErrorMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const registered = await authApi.register(form);
      let accessToken = registered.access_token;
      let refreshToken = null;
      try {
        const loggedIn = await authApi.login({ email: form.email, password: form.password });
        accessToken = loggedIn.access_token;
        refreshToken = loggedIn.refresh_token;
      } catch {
        // 로그인 실패 시에도 register가 준 access_token으로 진입 가능
      }
      setTokens({ accessToken, refreshToken });
      setUser({
        user_id: registered.user_id,
        email: form.email,
        nickname: form.nickname,
        level_group: form.level_group,
      });
      // 가입 직후 온보딩 배치고사로 (R7-01 S3 — 건너뛰기 가능, 게스트 로그인은 대상 아님)
      navigate('/onboarding/placement', { replace: true });
    } catch (err) {
      setErrorMsg(err.detail ?? '회원가입에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10">
      <div className="mb-6 text-center">
        <p className="text-4xl">⛅</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">회원가입</h1>
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
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={handleChange}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          닉네임
          <input
            type="text"
            name="nickname"
            required
            maxLength={20}
            value={form.nickname}
            onChange={handleChange}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          />
        </label>
        <div className="text-sm font-semibold text-slate-700">
          학습 수준
          <div className="mt-1 grid grid-cols-3 gap-2">
            {LEVEL_GROUPS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setForm({ ...form, level_group: g.value })}
                className={`rounded-xl border px-2 py-2.5 text-sm font-medium transition ${
                  form.level_group === g.value
                    ? 'border-sky-600 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {errorMsg && (
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
        >
          {submitting ? '가입 중...' : '가입하고 시작하기'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        이미 계정이 있나요?{' '}
        <Link to="/login" className="font-bold text-sky-600 hover:underline">
          로그인
        </Link>
      </p>
    </div>
  );
}
