import { useState } from 'react';
import Mascot from '../../components/Mascot';
import { useT } from '../../i18n';

/**
 * 첫 접속 정보 입력 화면 (2026-08-13 클라이언트 요구 ⑵⑶) — **로그인·회원가입이 아니다.**
 *
 * 왜 있나. 로그인·회원가입 화면이 제거되면서(대회 규정 「로그인 없이 열려야」)
 * **학령을 물을 자리가 통째로 사라졌다.** 남은 진입은 `App.jsx`의 자동 게스트
 * 발급 하나인데 그것이 `client.post('/auth/guest')` — 바디가 없다. 서버는
 * `POST /auth/guest {level_group?}`를 이미 받도록 확장돼 있는데(routers/auth.py
 * `guest_login`) 프론트가 그 문을 안 써서, **모든 게스트가 `middle_high`로
 * 시작**했다. 클라이언트가 세 번 지적한 「초등인데 중등이 나온다」의 남은 뿌리다.
 *
 * 그래서 이 화면의 산출물은 화면 자체가 아니라 **발급 바디에 실릴 값**이다.
 * 소비자는 `App.jsx`의 `RequireAuth`이고, 여기서는 고르기만 한다(요청을 만들지
 * 않는다 — 토큰이 아직 없어서 여기서 부를 수 있는 것도 없다).
 *
 * ⚠️ **규정 계약 3가지를 동시에 지킨다.**
 *   ① 「로그인」·「회원가입」·「Log in」·「Sign up」 문구를 쓰지 않는다. 계약은
 *      렌더 텍스트와 **리소스 값 양쪽**을 문다(`onboardingSave.contract` ③⑧).
 *      그래서 이 화면은 계정·이메일·비밀번호를 아예 언급하지 않는다.
 *   ② **건너뛸 수 있다.** 규정이 「로그인 없이 열려야」이므로 아무것도 고르지
 *      않아도 학습에 도달해야 한다 — 건너뛰면 발급 바디가 비고 서버 기본값
 *      (`middle_high`)이 그대로다(하위 호환).
 *   ③ 모달이 아니다 — 전체 화면 라우트다(배치고사·계정 전환과 같은 관례).
 *
 * ⚠️ 학습 수준 3값은 **서버 `schemas/auth.LevelGroup` Literal 그대로**여야 한다
 * (`elementary` · `middle_high` · `adult`). 밖의 값을 보내면 pydantic이 422이고,
 * 그러면 발급이 실패해 재시도 화면에 갇힌다. 라벨 키는 `/me`의 학습 수준 카드
 * (`ProgressPage`의 `LEVEL_GROUPS`)와 **같은 것을 재사용**한다 — 같은 선택을 두
 * 화면에서 다른 말로 부르지 않기 위해서다.
 */
export const ENTRY_LEVEL_GROUPS = [
  { value: 'elementary', labelKey: 'auth.register.elementary', hintKey: 'entryInfo.levelHint.elementary' },
  { value: 'middle_high', labelKey: 'auth.register.middleHigh', hintKey: 'entryInfo.levelHint.middleHigh' },
  { value: 'adult', labelKey: 'auth.register.adult', hintKey: 'entryInfo.levelHint.adult' },
];

export default function EntryInfoPage({ onSubmit }) {
  const t = useT();
  const [picked, setPicked] = useState(null);

  return (
    <div
      data-testid="entry-info"
      className="mx-auto min-h-screen max-w-xl px-4 pb-10 pt-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-base font-extrabold tracking-tight text-sky-900">⛅ WeatherMind</span>
        {/* 건너뛰기 — 규정 ②. 배치고사 화면과 같은 자리·같은 무게로 둔다. */}
        <button
          type="button"
          data-testid="entry-info-skip"
          onClick={() => onSubmit(null)}
          className="rounded-lg px-2 py-1 text-sm font-medium text-slate-400 transition hover:text-slate-600"
        >
          {t('entryInfo.skip')}
        </button>
      </div>

      <div className="mt-6 text-center">
        <span className="mx-auto grid h-[72px] w-[72px] place-items-center rounded-full bg-sky-50">
          <Mascot name="drop" className="h-[58px] w-[58px]" />
        </span>
        <h1 className="mt-3 text-xl font-extrabold tracking-tight text-slate-900">
          {t('entryInfo.title')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{t('entryInfo.body')}</p>
      </div>

      <p className="mt-7 text-sm font-extrabold text-slate-900">{t('entryInfo.levelLabel')}</p>
      <div className="mt-2 flex flex-col gap-2" data-testid="entry-info-levels">
        {ENTRY_LEVEL_GROUPS.map((g) => (
          <button
            key={g.value}
            type="button"
            data-level={g.value}
            aria-pressed={picked === g.value}
            onClick={() => setPicked(g.value)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              picked === g.value
                ? 'border-sky-600 bg-sky-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className={`block text-sm font-extrabold ${picked === g.value ? 'text-sky-700' : 'text-slate-700'}`}>
              {t(g.labelKey)}
            </span>
            <span className="mt-0.5 block text-xs text-slate-400">{t(g.hintKey)}</span>
          </button>
        ))}
      </div>

      {/* 다음 — 고른 값을 들고 배치고사로. 안 고르면 누를 수 없다(건너뛰기가 그 몫).
          ⚠️ 「선택 없이 다음」을 허용하면 건너뛰기와 구분이 없어지고, 사용자는
          자기가 무엇을 정했는지 모르는 채 진단에 들어간다. */}
      <button
        type="button"
        data-testid="entry-info-submit"
        disabled={!picked}
        onClick={() => onSubmit(picked)}
        className="mt-6 w-full rounded-2xl bg-sky-600 py-3.5 text-sm font-extrabold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {t('entryInfo.submit')}
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">{t('entryInfo.note')}</p>
    </div>
  );
}
