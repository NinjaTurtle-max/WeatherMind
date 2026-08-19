import { useState } from 'react';
import { DAILY_GOAL_CHOICES } from '../../lib/onboardingGate';
import { useNavigate } from 'react-router-dom';
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
 * 2026-08-14로 산출물이 둘이 됐다 — **학령과 닉네임**. 둘 다 `onSubmit({level,
 * nickname})` 한 통로로 나가고 발급 바디는 `App.jsx`가 만든다. 둘 다 **선택**이고,
 * 둘 다 안 정해도 이 화면을 통과할 수 있어야 한다.
 * (같은 날 잠깐 axios 인터셉터로 얹는 우회를 썼다가 걷었다 — 그 경위는 아래
 *  「인터셉터는 걷었다」 주석이 소유한다. 409를 화면에 되돌릴 수 없는 구조였다.)
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
 * ⚠️ **여기 있던 axios 인터셉터 2개는 걷었다**(2026-08-14). 경위를 남긴다.
 *
 * 처음 만들 때 이 화면의 산출물이 `onSubmit(level)` 하나였다 — 그 시그니처는
 * `App.jsx`의 `finishEntryInfo`가 소유하는데 담당이 그 파일을 소유 밖으로
 * 받았다. 객체를 실으면 `POST /auth/guest {level_group:{...}}`가 되어 pydantic
 * 422로 **발급 자체가 깨지므로**, 값이 흐르는 곳을 안 바꾸고 **요청이 나가는
 * 순간 바디에 얹는** 우회를 썼다.
 *
 * 🔴 **그 우회로는 409를 화면에 되돌릴 수가 없다.** 인터셉터는 요청만 알고
 * 응답의 종류를 화면에 알릴 통로가 없다 — 발급 실패는 `guestFailed` →
 * 재시도 화면으로 가고 이 화면은 이미 언마운트된 뒤라, 재시도가 **이름 없이**
 * 나가 성공한다. 사용자는 오류가 아니라 **자기 이름의 증발**을 겪는다.
 *
 * 그래서 배선을 하나로 모았다: `onSubmit({level, nickname})`로 올려 보내고,
 * `App.jsx`가 발급 바디를 만들고 `NICKNAME_TAKEN`이면 이 화면을 다시 띄운다
 * (적어 둔 이름은 `nickname` prop으로 돌아온다). 대장 §4.16.
 *
 * ⚠️ **인터셉터를 되살리지 말 것.** 모듈 스코프 인터셉터는 이 화면이 언마운트된
 * 뒤에도 `client`에 남아, 나중의 어떤 발급 요청에도 계속 끼어든다.
 */
/**
 * @param nickname      되돌아왔을 때 다시 채워 넣을 이름(`App.jsx`가 보관한다).
 *                      비우고 다시 적게 하면 학습자가 방금 친 것을 또 쳐야 한다.
 * @param nicknameTaken 그 이름이 이미 쓰이고 있어 되돌아왔는가.
 */
export default function EntryInfoPage({
  onSubmit,
  nickname: initialNickname = '',
  nicknameTaken = false,
}) {
  const t = useT();
  const navigate = useNavigate();
  const [picked, setPicked] = useState(null);
  const [nickname, setNickname] = useState(initialNickname);
  // 🔴 하루 목표도 **여기서** 받는다(2026-08-19 · 클라이언트 지시의 앞 문장).
  // 값을 직접 적지 않고 `DAILY_GOAL_CHOICES`를 읽는다 — 서버가 그 밖의 값을
  // 422로 막고, 상한이 세션 길이 정합으로 움직이는 중이기 때문이다.
  const [goal, setGoal] = useState(null);

  /**
   * 화면을 떠나는 **모든** 출구가 여기를 지난다 — 「다음」도 「건너뛰기」도.
   * 닉네임은 학령과 독립이라 건너뛰기에 적어 둔 이름도 버리지 않는다.
   * 안 적었으면 `null`이고 그러면 인터셉터가 아무것도 얹지 않는다.
   *
   * ⚠️ **출구가 셋이 됐다**(2026-08-19). 「진도 불러오기」는 여기를 지나지 **않는다** —
   * 학령·닉네임은 *새로 시작하는 사람*의 신고이고, 돌아온 사람의 이름은 이미 서버에
   * 있기 때문이다. 그쪽은 `navigate('/login')`으로 곧장 나간다(`SessionExpired`의
   * 「진도 불러오기」 버튼과 같은 관례).
   */
  const leave = (level) => {
    onSubmit({ level, nickname: nickname.trim(), goal });
  };

  return (
    <div
      data-testid="entry-info"
      className="mx-auto min-h-screen max-w-xl px-4 pb-10 pt-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-base font-extrabold tracking-tight text-sky-900">⛅ WeatherMind</span>
        <div className="flex items-center gap-1">
          {/* 🔴 진도 불러오기 — **「돌아온 사람」의 자리**(2026-08-19 클라이언트 지시).
              왜 여기인가:
                · 「건너뛰기」와 **같은 층위**다(같은 줄·같은 텍스트 버튼 무게) —
                  둘 다 「이 화면을 채우지 않고 나가는 출구」이고, 지시가 그 층위를
                  지목했다.
                · **첫 화면 맨 위**라 아무것도 적기 전에 보인다. 돌아온 사람은 폼을
                  읽을 이유가 없는 사람이라, 폼 아래에 두면 「이름을 새로 정하라」는
                  요구를 먼저 통과해야 자기 문을 본다.
                · 종전에는 진입점이 **하나도 없었고** `/login` URL을 아는 사람만
                  닿았다 — 이름을 적게 해 놓고 그 이름으로 못 돌아오는 상태였다.
              ⚠️ **주 동선이 아니다.** SideNav·TabBar·헤더에는 여전히 0건이고
                 (`onboardingSave.contract` ㉯), 여기는 건너뛸 수 있는 진입 화면이다.
              ⚠️ **이것이 관문이 되면 규정 위반**이다 — 「건너뛰기」와 「다음」은
                 이 버튼과 무관하게 계속 동작해야 한다. `loadProgress.contract` ④가
                 그 반대 방향을 함께 문다. */}
          <button
            type="button"
            data-testid="entry-info-load"
            onClick={() => navigate('/login')}
            className="rounded-lg px-2 py-1 text-sm font-bold text-sky-700 transition hover:text-sky-900"
          >
            {t('entryInfo.loadProgressCta')}
          </button>
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

      {/* 🔴 하루 목표 — **시작 시점에 묻는 자리**(2026-08-19 클라이언트 지시).
          원문 앞 문장: *"시작 시점에서 목표량과 수준을 물어야 하는데 그것도 없어"*.

          왜 여기인가: `PlacementSummary`에도 같은 피커가 있지만 그것은 **배치고사를
          본 사람만** 지난다. 게스트 자동 발급이 주 동선이라 **건너뛴 사람은 목표를
          정할 데가 없었다** — `/me`의 피커를 걷으면서 그 공백이 드러났다.
          이 화면은 배치를 보든 안 보든 **모두가 지나는 유일한 시작점**이다.

          ⚠️ **선택 항목이다.** 필수로 만들면 진입이 막혀 대회 규정(주 동선이
          입력을 요구하면 안 된다)에 걸린다 — 「건너뛰기」와 「다음」은 목표를
          안 골라도 동작해야 한다.
          ⚠️ 값을 여기 적지 않는다 — `DAILY_GOAL_CHOICES`가 소유자이고 서버가
          그 밖의 값을 422로 막는다. */}
      <p className="mt-5 text-sm font-extrabold text-slate-900">{t('entryInfo.goalLabel')}</p>
      <p className="mt-0.5 text-xs text-slate-500">{t('entryInfo.goalHint')}</p>
      <div className="mt-2 grid grid-cols-3 gap-2" data-testid="entry-info-goals">
        {DAILY_GOAL_CHOICES.map((choice) => (
          <button
            key={choice.items}
            type="button"
            aria-pressed={goal === choice.items}
            onClick={() => setGoal(goal === choice.items ? null : choice.items)}
            className={`rounded-xl border px-2 py-2.5 text-sm font-bold transition ${
              goal === choice.items
                ? 'border-sky-600 bg-sky-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            <span className="block">{choice.label}</span>
            <span className="mt-0.5 block text-[11px] font-medium opacity-80">{choice.caption}</span>
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
        onClick={() => leave(picked)}
        className="mt-6 w-full rounded-2xl bg-sky-600 py-3.5 text-sm font-extrabold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {t('entryInfo.submit')}
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">{t('entryInfo.note')}</p>
    </div>
  );
}
