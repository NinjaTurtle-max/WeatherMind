import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../i18n';

/**
 * 진도 불러오기 — **닉네임 하나로 받는다**(2026-08-19 클라이언트 지시).
 *
 * ## 왜 다시 고쳤나 — 이름을 적게 해 놓고 그 이름으로 못 돌아왔다
 * 8/14에 이 화면이 되살아났지만 **이메일과 비밀번호**를 요구했다. 그런데 진입
 * 화면(`EntryInfoPage`)이 묻는 것은 **닉네임뿐**이고, 게스트 계정의 비밀번호는
 * `guest_login`이 만드는 **무작위 시크릿**이다 — 즉 이 폼은 **원리적으로 아무도
 * 못 여는 문**이었고 그 상태로 실서버까지 갔다(실측). 안내 문구까지 *"저장할 때
 * 쓴 이메일과 비밀번호"*라고 말하고 있어, 사용자는 자기가 적은 적 없는 것을
 * 요구받았다.
 *
 * 그래서 서버에 짝을 만들었다: `POST /auth/resume {nickname}`. 이 화면은 그 하나만
 * 부른다. `authApi.login`(이메일·비밀번호)은 **프론트에서 호출부가 0**이 됐다.
 *
 * ## 🔴 확인 절차가 없다 — 알고 그렇게 뒀다
 * **남의 닉네임을 적으면 그 사람의 진도로 들어간다.** 대회 규정이 「로그인·결제
 * 없이 열려야」이고, 클라이언트가 8/14에 *"닉네임 기반 진도 저장은 허용 —
 * 회원가입 메커니즘이 아니다"*로 확정한 해석 위에 서 있다. 확인 수단(4자리 코드
 * 같은 것)을 붙일지는 **클라이언트 결정**이고, 여기서 임의로 인증을 붙이면 규정
 * 해석을 담당자가 바꾸는 것이 된다. 억제는 서버 `LIMIT_AUTH` 하나다.
 *
 * ## ⚠️ 지켜야 하는 계약 — 되살리면서 같이 되살아나면 안 되는 것들
 * ① **주 동선(SideNav·TabBar·헤더)에 링크를 넣지 않는다.** 진입은 둘뿐이다:
 *    「진도 저장」 카드의 한 줄(`loadProgress.fromSave`)과 **진입 화면의
 *    「이미 저장하셨나요?」**(2026-08-19 추가 — 「건너뛰기」와 같은 층위).
 *    `tests/onboardingSave.contract.test.mjs`가 nav 표면 0건을 단정한다.
 * ② **「로그인」·「회원가입」이라는 낱말을 쓰지 않는다.** 이름은 「진도 불러오기」다.
 *    금칙어 계약이 ko·en **값 전체**를 훑는다(en은 `login` 부분문자열까지).
 * ③ **게스트 발급 실패 폴백을 여기로 되돌리지 않는다.** 실패는 `App.jsx`의 재시도
 *    화면이 받는다 — 연결 나쁜 심사위원에게 계정 화면을 보이지 않기 위해서다.
 * ④ 🔴 **이메일·비밀번호 입력란을 되살리지 않는다.** `tests/loadProgress.contract`
 *    가 `input[type="password"]`·`input[type="email"]`의 **부재**를 단정한다 —
 *    있는 것만 세는 계약은 필드가 추가돼도 조용하기 때문이다.
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

  const [nickname, setNickname] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * 서버가 왜 못 찾았는지를 **갈라서** 말한다. 코드 문자열은 서버
   * `resume_by_nickname`의 분기 키와 1:1이다(`ApiError.code` — `api/client.js`가
   * `{detail, code}`를 정규화해 실어 준다).
   *
   * ⚠️ 한 문구로 뭉치면 동명이인(할 일: 다른 이름으로 저장)과 오타(할 일: 이름
   * 다시 확인)가 같은 안내를 받아, 학습자가 할 수 있는 행동이 사라진다.
   *
   * ⚠️ **이 화면은 아는 코드에서 서버 `detail`보다 리소스 문구를 앞세운다.**
   * 저장소 관례는 서버 문구 우선인데(`api/client.js`), 그 문구는 한국어 한 벌뿐이라
   * 로케일을 못 따르고 **「그래서 뭘 하면 되나」가 빠져 있다.** 모르는 코드에서는
   * 관례대로 `detail`로 되돌아간다 — 그래야 새 서버 오류가 조용히 뭉개지지 않는다.
   */
  const messageFor = (err) => {
    if (err?.code === 'NICKNAME_NOT_FOUND') return t('loadProgress.notFound');
    if (err?.code === 'NICKNAME_AMBIGUOUS') return t('loadProgress.ambiguous');
    return err?.detail ?? t('loadProgress.failed');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const data = await authApi.resume(nickname.trim());
      // 게스트 토큰을 **덮어쓴다** — 이 화면에 온 사람은 이미 게스트다.
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      // ⚠️ **`is_guest`를 여기서 지어내지 않는다.** 종전 코드가
      //    `setUser({ email, is_guest: false })`로 못박았는데, 불러온 계정은
      //    대개 **게스트**다 — 거짓 false는 저장 배너를 숨기고 계정 전환 게이트를
      //    어긋나게 한다. 서버가 답하는 유일한 경로(`GET /auth/me`)로 묻는다.
      //    실패해도 진입은 막지 않는다(토큰은 이미 유효하다).
      authApi
        .me()
        .then(setUser)
        .catch(() => {});
      navigate('/', { replace: true });
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
            <span className="text-[11.5px] font-bold text-slate-600">
              {t('loadProgress.nicknameLabel')}
            </span>
            {/* ⚠️ `type="text"`다 — 계약 ④가 password·email 입력란의 **부재**를 잰다.
                서버 `ResumeRequest.nickname`과 같은 상한 50. */}
            <input
              type="text"
              name="nickname"
              data-testid="load-progress-nickname"
              autoComplete="off"
              maxLength={50}
              required
              placeholder={t('loadProgress.nicknamePlaceholder')}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
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
