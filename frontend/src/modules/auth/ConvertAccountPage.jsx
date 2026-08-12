import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SaveProgressForm from '../../components/SaveProgressForm';
import { useAuthStore } from '../../store/authStore';
import { isGuestUser } from './guest';
import { useT } from '../../i18n';

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
 *
 * ⚠️ 2026-08-12: 폼 본체는 `components/SaveProgressForm`으로 나갔다. 같은 입력이
 * `/me`(내 정보) 안에도 서기 때문이다(클라이언트 요구 ⑴ — 「로그인 창」이 아니라
 * 「정보 입력」). 이 화면은 **껍데기와 이동**만 갖는다: 딥링크·북마크의 착지점이고,
 * 정식 계정의 직접 진입 방어도 여기 남는다.
 */
export default function ConvertAccountPage() {
  const navigate = useNavigate();
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [converted, setConverted] = useState(false);

  // 게스트가 아니면 전환할 것이 없다(배너 외 직접 진입·전환 직후 재방문 방어).
  // 전환 성공 직후의 리렌더에서 이 분기로 떨어져 화면이 번쩍이지 않도록
  // converted 플래그가 폼 화면을 유지한다(navigate가 곧 홈으로 옮긴다).
  if (!converted && !isGuestUser(user)) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10 text-center">
        <p className="text-5xl">✅</p>
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">{t('auth.convert.alreadyTitle')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('auth.convert.alreadyBody')}</p>
        <Link
          to="/"
          replace
          className="mx-auto mt-6 rounded-xl bg-sky-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-sky-700"
        >
          {t('auth.convert.goHome')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10">
      <div className="mb-6 text-center">
        <p className="text-4xl">💾</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">{t('auth.convert.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {t('auth.convert.bodySeg1')}
          <b>{t('auth.convert.bodyStrong')}</b>
          {t('auth.convert.bodySeg2')}
          <br />
          {t('auth.convert.bodyLine2')}
        </p>
      </div>

      {/* 전환 성공 직후의 리렌더에서 위 "이미 정식 계정" 분기로 떨어져 화면이
          번쩍이지 않도록 `converted`가 폼 화면을 유지한다(navigate가 곧 옮긴다). */}
      <SaveProgressForm
        onConverted={() => {
          setConverted(true);
          navigate('/', { replace: true });
        }}
        submitLabel={t('auth.convert.submit')}
        className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
      />

      <Link to="/" className="mt-4 text-center text-sm text-slate-500 hover:underline">
        {t('auth.convert.later')}
      </Link>
    </div>
  );
}
