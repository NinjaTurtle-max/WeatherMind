import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../i18n';

/**
 * 진도 불러오기 (2026-08-14 클라이언트 결정 ⓑ — MT-29 이후 복구)
 *
 * ## 왜 다시 생겼나
 * MT-29(8/12)가 「주 동선 로그인 링크 0건」을 계약으로 세웠고, 그 다음 커밋
 * `a4a8b6f`(8/13 00:06)가 **화면과 라우트를 함께** 걷었다. 그런데 진도 저장 안내는
 * 「다른 기기에서도 이어서 배울 수 있어요」라고 계속 말하고 있었다 — **돌아올 문이
 * 없는데 하는 약속**이었고 실서버까지 갔다(대장 §4.14).
 * 클라이언트가 8/14에 복구를 정했다: *"진도 불러오는 기능이 없는 결함"*.
 *
 * ## ⚠️ 지켜야 하는 계약 3개 — 되살리면서 같이 되살아나면 안 되는 것들
 *
 * ① **주 동선에 링크를 넣지 않는다.** `SideNav`·`TabBar`·헤더 어디에도 없다.
 *    진입은 「진도 저장」 카드의 한 줄(`loadProgress.fromSave`)뿐이다. 대회 규정은
 *    「로그인 **없이** 열려야 한다」이고 MT-29의 계약이 그 해석이다 — 라우트가 있는
 *    것과 주 동선이 가입을 요구하는 것은 다르다.
 *    `tests/onboardingSave.contract.test.mjs`가 nav 표면 0건을 단정한다.
 * ② **「로그인」·「회원가입」이라는 낱말을 쓰지 않는다.** 이름은 「진도 불러오기」다
 *    (「진도 저장」의 짝). 금칙어 계약이 ko·en **값 전체**를 훑는다.
 * ③ **게스트 발급 실패 폴백을 여기로 되돌리지 않는다.** `a4a8b6f` 이전에는 발급이
 *    실패하면 이 화면으로 보냈는데, 그것이 *"규정이 요구하는 그 화면을 연결 나쁜
 *    심사위원에게 보여 주는"* 결함이었다(MT-29 본문). 실패는 `App.jsx`의 재시도
 *    화면이 계속 받는다.
 *
 * ## ⚠️ 인증 가드를 씌우지 말 것
 * 종전 `LoginPage`에는 「이미 로그인했으면 튕긴다」류의 래퍼가 붙어 있었다. 지금은
 * **모든 방문자가 게스트 토큰을 들고 있다**(`App.jsx`가 진입에서 발급한다). 그런
 * 가드를 붙이면 **이 화면이 필요한 사람만 정확히 못 들어온다** — 조용히 죽는다.
 *
 * 서버 엔드포인트(`POST /auth/login`)와 `authApi.login`은 한 번도 지워진 적이 없다.
 * 없던 것은 화면과 라우트뿐이라 이 파일은 「새로 만들기」가 아니라 「되살리기」다.
 */
export default function LoadProgressPage() {
  const navigate = useNavigate();
  const t = useT();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState({ email: '', password: '' });
  const [errorMsg, setErrorMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const data = await authApi.login(form);
      // 게스트 토큰을 **덮어쓴다** — 이 화면에 온 사람은 이미 게스트다.
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      setUser({ email: form.email, is_guest: false });
      navigate('/', { replace: true });
    } catch (err) {
      // 실패는 **이 자리에서** 말한다. 다른 화면으로 보내지 않는다(계약 ③과 같은 뿌리 —
      // 사용자를 튕기면 자기가 무엇을 잘못했는지 볼 자리가 사라진다).
      setErrorMsg(err.detail ?? t('loadProgress.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-base font-extrabold text-slate-900">
          <span aria-hidden="true">💾</span> {t('loadProgress.title')}
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{t('loadProgress.body')}</p>

        <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-slate-600">{t('auth.login.email')}</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={handleChange}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-slate-600">
              {t('auth.login.password')}
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={handleChange}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
          </label>

          {errorMsg && (
            <p role="alert" className="text-[11.5px] font-bold text-rose-600">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
          >
            {submitting ? t('loadProgress.submitting') : t('loadProgress.submit')}
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="mt-3 w-full text-[11.5px] font-bold text-slate-400"
        >
          {t('loadProgress.back')}
        </button>
      </div>
    </div>
  );
}
