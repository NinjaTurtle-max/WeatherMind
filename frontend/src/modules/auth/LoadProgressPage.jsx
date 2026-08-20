import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../i18n';

/**
 * 진도 불러오기 — **저장할 때 쓴 이메일과 비밀번호로 받는다**
 * (2026-08-19 **오후** 클라이언트 결정, 주최측 확인 후).
 *
 * ## 왜 또 고쳤나 — 같은 날 오전 판을 뒤집는다
 * 오전에 이 화면은 **닉네임 하나**가 됐다. 그 판이 본 결함은 실재했다: 진입
 * 화면(`EntryInfoPage`)이 묻는 것은 닉네임뿐인데 이 화면은 이메일·비밀번호를
 * 요구했고, 게스트 비밀번호는 무작위 시크릿이라 **원리적으로 아무도 못 여는 문**
 * 이었다. 바뀐 것은 *고쳐야 한다*가 아니라 **어느 쪽에 맞추는가**다.
 *
 * 클라이언트 원문: *"로그인이 있어도 되나 게스트모드와의 기능적·체험적 부분에
 * 있어 차가 나타나지 않으면 된다. 닉네임을 통한 호출은 **보안의 개별성이 약하기에**
 * 로그인을 통한 진도 불러오기가 맞는 것 같다"*.
 *
 * 🔴 **짝이 맞는다는 것이 요지다.** 진도 **저장**은 이미
 * `POST /auth/guest/convert {email, password}`(`SaveProgressForm`)다 — 오전 판은
 * 저장과 불러오기가 **서로 다른 열쇠**를 쓰게 두었다. 이제 저장할 때 정한 것으로
 * 불러온다. 그래서 이 화면은 `auth.login.email`·`auth.login.password` 라벨을
 * `SaveProgressForm`과 **같은 키로** 쓴다(같은 것을 두 화면에서 다르게 부르지 않는다).
 *
 * 🔴 **진짜 결함은 이 화면이 아니라 서버에 있었다.** 화면만 바꾸면
 * `curl -d '{"nickname":"…"}' …/auth/resume`가 그대로 남아 이름 하나로 남의 계정
 * 토큰이 나온다. 그래서 `backend/app/routers/auth.py`의 `/resume`가 함께 바뀌었고,
 * 계약도 화면이 아니라 **서버**를 문다(`backend/tests/test_auth_resume.py`의
 * `TestNicknameDoorIsClosed`). 이 파일의 계약만으로는 그 결함을 못 잡는다.
 *
 * ## 🔴 게스트는 이 문을 못 연다 — 알고 그렇게 뒀다
 * 게스트 비밀번호는 무작위 시크릿이다. 그래도 대회 규정(「로그인·결제 없이
 * 열려야」)은 안 깨진다 — **게스트는 이 화면이 필요 없다.** 토큰이 이 기기의
 * localStorage에 남아 있어 전 기능을 그대로 쓰고, 이 화면은 **선택 경로**다.
 * 그것을 화면에서도 말해 준다(`loadProgress.noAccountNote`) — 안내가 없으면
 * 저장한 적 없는 사람이 자기 자격을 지어내려 한다.
 *
 * ## ⚠️ 지켜야 하는 계약 — 되살리면서 같이 되살아나면 안 되는 것들
 * ① **주 동선(SideNav·TabBar·헤더)에 링크를 넣지 않는다.** 진입은 셋이다:
 *    「진도 저장」 카드의 한 줄(`loadProgress.fromSave`) · 진입 화면의
 *    「이미 저장하셨나요?」 · 만료 화면(`SessionExpired`)의 버튼. 2026-08-19에
 *    **대문 복귀 화면**이 넷째로 붙었다(⑫-b — 재방문 `/`에서만 뜨는 부 CTA).
 *    `tests/onboardingSave.contract.test.mjs`가 nav 표면 0건을 단정한다.
 * ② **「로그인」·「회원가입」이라는 낱말을 쓰지 않는다.** 이름은 「진도 불러오기」다.
 *    금칙어 계약이 ko·en **값 전체**를 훑는다(en은 `login` 부분문자열까지).
 *    ⚠️ 라벨이 「이메일」·「비밀번호」인 것은 규정과 **충돌하지 않는다** — 계약이
 *    무는 것은 필드 이름이 아니라 **렌더된 텍스트의 금칙어**이고,
 *    `SaveProgressForm`이 같은 라벨로 이미 서 있다.
 * ③ **게스트 발급 실패 폴백을 여기로 되돌리지 않는다.** 실패는 `App.jsx`의 재시도
 *    화면이 받는다 — 연결 나쁜 심사위원에게 계정 화면을 보이지 않기 위해서다.
 * ④ 🔴 **닉네임 입력란을 되살리지 않는다.** `tests/loadProgress.contract`가
 *    `input[name="nickname"]`의 **부재**와 나가는 바디 키가 정확히
 *    `['email','password']`임을 단정한다 — 있는 것만 세는 계약은 필드가 되살아나도
 *    조용하기 때문이다. ⚠️ **이 단정은 오전 판의 정반대다**(그때는 password·email의
 *    부재를 쟀다). **단정의 형태는 그대로 두고 전제만 뒤집었다** — 「없음을 문다」가
 *    옳은 형태였고 틀린 것은 무엇이 없어야 하는지였다.
 *
 * ## ⚠️ 인증 가드를 씌우지 말 것
 * 지금은 **모든 방문자가 게스트 토큰을 들고 있다**(`App.jsx`가 진입에서 발급한다).
 * 「이미 로그인했으면 튕긴다」류의 래퍼를 붙이면 **이 화면이 필요한 사람만 정확히
 * 못 들어온다** — 조용히 죽는다.
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

  /**
   * 실패 문구 — **한 갈래**다.
   *
   * 🔴 오전 판은 여기서 `NICKNAME_NOT_FOUND`·`NICKNAME_AMBIGUOUS`를 갈라
   * 각각 다르게 말했다. 그 분기는 **없어져야 하는 것**이었다: 「그 이름은 있다/
   * 없다」를 화면이 알려 주는 것은 계정 열거이고, 서버도 이제 401 하나로 뭉친다.
   *
   * ⚠️ 모르는 코드에서는 저장소 관례대로 서버 `detail`로 되돌아간다(`api/client.js`)
   * — 그래야 새 서버 오류가 조용히 뭉개지지 않는다. 아는 코드에서만 리소스 문구를
   * 앞세우는 이유는 서버 문구가 한국어 한 벌뿐이라 로케일을 못 따르고 「그래서 뭘
   * 하면 되나」가 빠져 있기 때문이다.
   */
  const messageFor = (err) => {
    if (err?.code === 'INVALID_CREDENTIALS') return t('loadProgress.invalidCredentials');
    return err?.detail ?? t('loadProgress.failed');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const data = await authApi.resume({ email: form.email, password: form.password });
      // 게스트 토큰을 **덮어쓴다** — 이 화면에 온 사람은 이미 게스트다.
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      // ⚠️ **`is_guest`를 여기서 지어내지 않는다.** 종전 코드가
      //    `setUser({ email, is_guest: false })`로 못박았는데, 그 값의 소유자는
      //    서버다. 지금은 자격으로 여는 문이라 대개 정식 계정이 맞지만, 화면이
      //    서버 대신 판정하기 시작하면 그 판정이 갈리는 날 저장 배너와 계정 전환
      //    게이트가 함께 어긋난다. 서버가 답하는 유일한 경로(`GET /auth/me`)로 묻는다.
      //    실패해도 진입은 막지 않는다(토큰은 이미 유효하다).
      authApi
        .me()
        .then(setUser)
        .catch(() => {});
      // 🔴 **`/learn`으로 간다 — `/`가 아니다**(2026-08-19 ⑫-b와 한 쌍).
      //    `/`는 이제 재방문자에게 **복귀 화면**이 서는 자리다. 거기로 보내면 방금
      //    불러오기를 마친 사람이 「진도 불러오기」를 다시 권하는 화면을 만난다.
      //    목적지는 「학습을 이어서 한다」이므로 그 자리를 직접 가리킨다.
      navigate('/learn', { replace: true });
    } catch (err) {
      // 실패는 **이 자리에서** 말한다. 다른 화면으로 보내지 않는다(계약 ③과 같은
      // 뿌리 — 사용자를 튕기면 자기가 무엇을 잘못했는지 볼 자리가 사라진다).
      setErrorMsg(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4">
      <div
        data-testid="load-progress"
        className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
      >
        <h1 className="text-base font-extrabold text-slate-900">
          <span aria-hidden="true">💾</span> {t('loadProgress.title')}
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{t('loadProgress.body')}</p>

        <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-slate-600">{t('auth.login.email')}</span>
            {/* ⚠️ `name`을 바꾸지 말 것 — `loadProgress.contract`가 나가는 바디 키와
                함께 `input[name="email|password"]`를 문서 전역 선택자로 집는다
                (`SaveProgressForm`과 같은 관례). */}
            <input
              type="email"
              name="email"
              data-testid="load-progress-email"
              autoComplete="email"
              maxLength={255}
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
            {/* ⚠️ `minLength`를 걸지 않는다 — 저장 폼은 새 비밀번호를 **정하는**
                자리라 8자 하한이 맞지만, 여기는 **이미 정해진 것을 넣는** 자리다.
                하한을 걸면 옛 규칙으로 저장한 사람이 브라우저 단계에서 막혀
                서버 401조차 못 받는다(무엇이 틀렸는지 알 수 없게 된다). */}
            <input
              type="password"
              name="password"
              data-testid="load-progress-password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={handleChange}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
          </label>

          {errorMsg && (
            <p role="alert" data-testid="load-progress-error" className="text-[11.5px] font-bold text-rose-600">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            data-testid="load-progress-submit"
            disabled={submitting}
            className="mt-1 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
          >
            {submitting ? t('loadProgress.submitting') : t('loadProgress.submit')}
          </button>
        </form>

        {/* 🔴 규정이 성립한다는 것을 화면에서도 말한다 — 저장한 적 없는 사람에게
            이 화면은 **필요 없다.** 안내가 없으면 자기 자격을 지어내려 한다. */}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          {t('loadProgress.noAccountNote')}
        </p>

        <button
          type="button"
          onClick={() => navigate('/learn', { replace: true })}
          className="mt-2 w-full text-[11.5px] font-bold text-slate-400"
        >
          {t('loadProgress.back')}
        </button>
      </div>
    </div>
  );
}
