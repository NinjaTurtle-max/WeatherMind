import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useT } from '../i18n';

/**
 * 진도 저장 폼 (2026-08-12 클라이언트 지시 — 「로그인 창」이 아니라 「정보 입력」).
 *
 * 왜 뽑아냈나: 같은 입력이 이제 **두 자리**에 선다.
 *   · `/me`(내 정보) 안의 카드 — 클라이언트 요구 ⑴의 본체. 진도를 지키는 행동을
 *     설정 옆에 두어 "계정을 만든다"가 아니라 "내 정보를 채운다"로 읽히게 한다.
 *   · `/account/convert` 전체 화면 — 기존 라우트. 배너·노드에서 오는 딥링크와
 *     북마크가 여기로 들어오므로 없애지 않는다.
 * 폼을 두 벌 쓰면 한쪽만 고쳐지는 순간 두 화면이 다른 계약을 갖는다 — 서버 계약
 * (POST /auth/guest/convert)은 하나뿐이므로 폼도 하나다.
 *
 * ⚠️ 서버 계약은 그대로다(백엔드 무변경): Bearer 필수 ·
 *   {email, password, nickname?} → 200 LoginResponse(같은 user_id, 토큰 재발급).
 *   409 NOT_GUEST · 409 EMAIL_ALREADY_EXISTS를 사용자 언어로 안내한다.
 *
 * ⚠️ **input name·label 키를 바꾸지 말 것.** `tests/guest-convert.smoke.test.mjs`
 * 시나리오 3·4가 `input[name="email|password|nickname"]`과 페이지 유일 `<form>`을
 * 문서 전역 선택자로 집는다. 라벨 값은 '이메일·비밀번호·닉네임'이라 규정(화면에
 * 「로그인」·「회원가입」 문구 금지)과 충돌하지 않는다 — 키 이름이 아니라 **렌더된
 * 텍스트**가 계약이다.
 *
 * ⚠️ 성공 상태는 **이 자리에 남는다**(`done`). 전환에 성공하면 사용자는 더 이상
 * 게스트가 아니라, 호출자가 "게스트일 때만 렌더"로 감싸 두면 성공 문구가 뜨는
 * 순간 카드째 사라진다 — 누른 사람이 결과를 못 본다(ProgressPage가 하루 목표
 * 카드에서 같은 함정을 두 번 적어 두었다). 그래서 성공 화면을 폼이 직접 들고,
 * 전체 화면(ConvertAccountPage)은 `onConverted`로 이동을 가져간다.
 */
export default function SaveProgressForm({ onConverted, submitLabel, className = '' }) {
  const t = useT();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState({ email: '', password: '', nickname: '' });
  const [errorMsg, setErrorMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

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
      setDone(true);
      setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
      setUser({
        ...user,
        email: form.email,
        ...(payload.nickname ? { nickname: payload.nickname } : {}),
        is_guest: false,
      });
      // ⚠️ **캐시도 같이 넘긴다**(2026-08-12). 게스트 판정의 1순위는 스토어가 아니라
      // `GET /auth/me`의 is_guest이고, 그 조회는 staleTime 60초다. 캐시를 그대로
      // 두면 전환에 성공한 사람이 최대 1분간 화면에서는 게스트로 남아 — 학습
      // 화면 오른쪽에 「정보를 입력해 진도를 저장해주세요」가 계속 떠 있고, 다시
      // 누르면 폼이 나와 제출 시 409 NOT_GUEST를 받는다. 「정식 계정에는 저장
      // 노드가 안 뜬다」 계약이 그 창 동안 깨진다. 선례는 LevelGroupCard.
      // ⚠️ **순서가 계약이다.** 호출자에게 먼저 알리고(`onConverted`), 그 다음에
      // 캐시의 게스트 표식을 내린다. 뒤집으면 호출자(`/me`의 저장 카드)가 "게스트가
      // 아니다"를 **자기가 전환을 알기 전에** 보고, 폼이 든 가지를 한 프레임 접었다
      // 편다 — 폼이 새 인스턴스로 다시 서면서 방금 띄운 성공 문구가 사라진다
      // (2026-08-12 실측: 저장은 됐는데 화면은 빈 폼으로 되돌아갔다).
      onConverted?.();
      // ⚠️ **prev가 없어도 객체를 쓴다.** `prev ? … : prev`로 두면 캐시가 비어 있는
      // 순간(gcTime 경과·첫 조회 미도착)에 `undefined`를 써넣게 되고, 소비처의
      // "`me`가 없으면 렌더하지 않는다" 가드에 걸려 카드가 통째로 사라진다.
      queryClient.setQueryData(['auth', 'me'], (prev) => ({
        ...(prev ?? {}),
        is_guest: false,
        email: payload.email,
      }));
    } catch (err) {
      if (err.code === 'NOT_GUEST') {
        // 다른 탭·기기에서 이미 전환된 뒤의 재시도 등 — 진도는 이미 안전하다.
        setErrorMsg(t('auth.convert.errNotGuest'));
      } else if (err.code === 'EMAIL_ALREADY_EXISTS') {
        setErrorMsg(t('auth.convert.errEmailExists'));
      } else {
        setErrorMsg(err.detail ?? t('auth.convert.errGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <p
        data-testid="save-progress-done"
        className={`rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700 ${className}`}
      >
        {t('saveProgress.done')}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${className}`}>
      <label className="text-sm font-semibold text-slate-700">
        {t('auth.login.email')}
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
        {t('auth.login.password')}
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
        {t('auth.register.nickname')}{' '}
        <span className="font-normal text-slate-400">{t('auth.convert.nicknameOptional')}</span>
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
        {submitting ? t('auth.convert.submitting') : (submitLabel ?? t('saveProgress.submit'))}
      </button>
    </form>
  );
}
