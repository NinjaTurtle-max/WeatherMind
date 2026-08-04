import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { isGuestUser } from './guest';

/**
 * 게스트 → 정식 계정 전환 페이지 (R11-01 웨이브 2 §6.2 — R10-J "투자 후 계정 유도")
 *
 * POST /auth/guest/convert (Bearer 필수 — client 인터셉터가 부착):
 *   {email, password, nickname?} → 200 LoginResponse(토큰 재발급).
 *   **같은 user_id 유지** — XP·θ·스트릭·진도 전부 보존이 이 API의 존재 이유.
 * 실패 계약: 게스트 아님 → 409 NOT_GUEST · 이메일 중복 → register와 동일 의미론
 *   (409 EMAIL_ALREADY_EXISTS). 둘 다 사용자 언어로 안내한다.
 *
 * 성공 시: 토큰 교체 + 게스트 표식 해제(setUser is_guest:false + 실 이메일) →
 * 학습 홈 복귀. 라우트는 Layout 밖 전체 화면(/account/convert — 배치고사 관례).
 */
export default function ConvertAccountPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState({ email: '', password: '', nickname: '' });
  const [errorMsg, setErrorMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [converted, setConverted] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const payload = { email: form.email, password: form.password };
      if (form.nickname.trim()) payload.nickname = form.nickname.trim();
      const { data } = await client.post('/auth/guest/convert', payload);
      // 전환 성공 — 같은 user_id로 토큰만 재발급되므로 진도는 그대로다.
      setConverted(true);
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      setUser({
        ...user,
        email: form.email,
        ...(payload.nickname ? { nickname: payload.nickname } : {}),
        is_guest: false,
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err.code === 'NOT_GUEST') {
        // 다른 탭·기기에서 이미 전환된 뒤의 재시도 등 — 진도는 이미 안전하다.
        setErrorMsg('이미 정식 계정이에요 — 진도는 계정에 안전하게 저장되고 있어요.');
      } else if (err.code === 'EMAIL_ALREADY_EXISTS') {
        setErrorMsg(
          '이미 가입된 이메일이에요. 다른 이메일을 입력하거나, 그 계정으로 로그인해 주세요. ' +
            '(로그인하면 지금 게스트 진도는 이 기기에 남지 않아요)',
        );
      } else {
        setErrorMsg(err.detail ?? '계정 만들기에 실패했어요. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 게스트가 아니면 전환할 것이 없다(배너 외 직접 진입·전환 직후 재방문 방어).
  // 전환 성공 직후의 리렌더에서 이 분기로 떨어져 화면이 번쩍이지 않도록
  // converted 플래그가 폼 화면을 유지한다(navigate가 곧 홈으로 옮긴다).
  if (!converted && !isGuestUser(user)) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10 text-center">
        <p className="text-5xl">✅</p>
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">이미 정식 계정이에요</h1>
        <p className="mt-2 text-sm text-slate-500">
          학습 진도는 계정에 자동으로 저장되고 있어요.
        </p>
        <Link
          to="/"
          replace
          className="mx-auto mt-6 rounded-xl bg-sky-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-sky-700"
        >
          학습 홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10">
      <div className="mb-6 text-center">
        <p className="text-4xl">💾</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">30초 가입으로 진도 저장</h1>
        <p className="mt-2 text-sm text-slate-500">
          지금까지 쌓은 XP·스트릭·실력 진단이 <b>그대로</b> 내 계정이 돼요.
          <br />
          어느 기기에서든 이어서 학습할 수 있어요.
        </p>
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
          닉네임 <span className="font-normal text-slate-400">(선택 — 비우면 지금 그대로)</span>
          <input
            type="text"
            name="nickname"
            maxLength={20}
            value={form.nickname}
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
          {submitting ? '진도 옮기는 중...' : '가입하고 진도 저장하기'}
        </button>
      </form>

      <Link to="/" className="mt-4 text-center text-sm text-slate-500 hover:underline">
        나중에 할게요 — 학습 계속하기
      </Link>
    </div>
  );
}
