import { useState } from 'react';
import Mascot from '../../components/Mascot';
import client from '../../api/client';
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
 * 2026-08-14로 산출물이 둘이 됐다 — **학령과 닉네임**. 닉네임은 `onSubmit`을 타지
 * 못해서(아래 `pendingNickname` 주석) 발급 요청에 얹는 방식으로 실린다. 둘 다
 * **선택**이고, 둘 다 안 정해도 이 화면을 통과할 수 있어야 한다.
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

/** 서버 `RegisterRequest.nickname` / `ConvertRequest.nickname`과 같은 상한(50자). */
const NICKNAME_MAX = 50;

/**
 * 신고한 닉네임 — **발급 바디에 실릴 값**이고, 이 모듈 밖으로는 나가지 않는다.
 *
 * 왜 인터셉터인가. 이 화면의 산출물은 `onSubmit(level)` 하나인데 그 시그니처는
 * `App.jsx`의 `finishEntryInfo(level)`가 소유한다 — 거기에 객체를 실으면
 * `POST /auth/guest {level_group: {...}}`가 되어 pydantic 422로 **발급 자체가
 * 깨진다**. 학령과 달리 닉네임은 그 통로를 못 쓴다. 그래서 값이 흐르는 곳을
 * 바꾸지 않고 **요청이 나가는 순간에 얹는다**: 발급을 부르는 주체(App.jsx)는
 * 그대로 두고, 바디에 필드 하나가 더 붙는다.
 *
 * ⚠️ **한 번 쓰면 지운다.** 안 지우면 건너뛰기·딥링크 발급까지 앞 시도의 닉네임을
 * 물고 간다(entryFlow ⑤⑥이 바디가 비어 있음을 단정한다).
 * ⚠️ **빈 문자열은 보내지 않는다.** 서버가 나중에 `min_length=1`을 걸면 빈 값이
 * 발급을 422로 떨어뜨리고 사용자가 재시도 화면에 갇힌다 — 「안 적음」의 서버 표현은
 * 학령과 마찬가지로 **필드 부재**다.
 * ⚠️ 값은 오늘 서버에서 **조용히 무시된다**: `GuestStartRequest`에 `nickname`이 없고
 * pydantic 기본이 extra=ignore라 201 그대로다(목도 `level_group`만 본다). 유일성은
 * 서버 몫이라 이번 범위 밖이고, 여기는 「값을 싣는 데」까지다.
 */
let pendingNickname = null;

/**
 * 닉네임 중복 통보 걸쇠 — 서버가 발급을 409/422로 되돌려줄 때 켜진다.
 *
 * ⚠️ **오늘은 켜지지 않는다.** 서버에 유일성 제약이 없고(게스트들이 같은 자동
 * 닉네임을 공유해 unique 인덱스가 만들어지지 않는다) 그 상태에서 발급은 201이다.
 * 발화해도 화면까지 닿으려면 `App.jsx` 배선이 한 번 더 필요하다 — 발급 실패는
 * `guestFailed` → 재시도 화면으로 가고 이 화면은 이미 언마운트된 뒤라, 다시
 * 들어왔을 때에야 읽힌다. 그 배선은 소유 밖이라 손대지 않고 보고로 남긴다.
 */
let nicknameRejected = false;
const takeNicknameRejection = () => {
  const was = nicknameRejected;
  nicknameRejected = false;
  return was;
};

const GUEST_ISSUE_URL = '/auth/guest';

client.interceptors.request.use((config) => {
  // `/auth/guest/convert`가 아니라 발급 그 자체만 — 정확 일치로 문다.
  if (config.url === GUEST_ISSUE_URL && pendingNickname) {
    config.data = { ...(config.data ?? {}), nickname: pendingNickname };
    pendingNickname = null;
  }
  return config;
});

client.interceptors.response.use(undefined, (error) => {
  const status = error?.response?.status;
  if (error?.config?.url === GUEST_ISSUE_URL && (status === 409 || status === 422)) {
    nicknameRejected = true;
  }
  return Promise.reject(error);
});

export default function EntryInfoPage({ onSubmit }) {
  const t = useT();
  const [picked, setPicked] = useState(null);
  const [nickname, setNickname] = useState('');
  const [nicknameTaken] = useState(takeNicknameRejection);

  /**
   * 화면을 떠나는 **모든** 출구가 여기를 지난다 — 「다음」도 「건너뛰기」도.
   * 닉네임은 학령과 독립이라 건너뛰기에 적어 둔 이름도 버리지 않는다.
   * 안 적었으면 `null`이고 그러면 인터셉터가 아무것도 얹지 않는다.
   */
  const leave = (level) => {
    pendingNickname = nickname.trim() || null;
    onSubmit(level);
  };

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
          onClick={() => leave(null)}
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

      {/* 닉네임 — **선택 항목**이다(2026-08-14 클라이언트 결정).
          🔴 어떤 버튼도 이 값으로 잠그지 않는다. 규정이 「로그인·결제 없이 열려야」
          이고 이 화면의 원칙이 「조작 최소·건너뛰기 상시」라, 이름을 물어보는 것이
          진입을 막는 순간 둘 다 깨진다 — 「다음」은 학령만 보고, 「건너뛰기」는
          언제나 눌린다. 계약은 `entryFlow.smoke` ⑦이 문다.
          ⚠️ `type="text"`다 — 이메일·비밀번호 입력란이 없어야 한다는 규정 계약을
          `entryFlow` ②가 입력 타입으로 재고 있다. */}
      <label
        className="mt-7 block text-sm font-extrabold text-slate-900"
        htmlFor="entry-info-nickname"
      >
        {t('entryInfo.nicknameLabel')}
      </label>
      <input
        id="entry-info-nickname"
        data-testid="entry-info-nickname"
        type="text"
        value={nickname}
        maxLength={NICKNAME_MAX}
        autoComplete="off"
        placeholder={t('entryInfo.nicknamePlaceholder')}
        onChange={(e) => setNickname(e.target.value)}
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-sky-600"
      />
      <p className="mt-1.5 text-xs text-slate-400">{t('entryInfo.nicknameHint')}</p>
      {nicknameTaken && (
        <p data-testid="entry-info-nickname-taken" className="mt-1.5 text-xs font-bold text-rose-500">
          {t('entryInfo.nicknameTaken')}
        </p>
      )}

      {/* 다음 — 고른 값을 들고 배치고사로. 안 고르면 누를 수 없다(건너뛰기가 그 몫).
          ⚠️ 「선택 없이 다음」을 허용하면 건너뛰기와 구분이 없어지고, 사용자는
          자기가 무엇을 정했는지 모르는 채 진단에 들어간다. */}
      <button
        type="button"
        data-testid="entry-info-submit"
        disabled={!picked}
        onClick={() => leave(picked)}
        className="mt-6 w-full rounded-2xl bg-sky-600 py-3.5 text-sm font-extrabold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {t('entryInfo.submit')}
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">{t('entryInfo.note')}</p>
    </div>
  );
}
