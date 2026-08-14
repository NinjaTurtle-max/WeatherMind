import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import RegionPicker from './RegionPicker';
import { progressApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { useT } from '../i18n';

/**
 * 위치 안내 배너 (2026-08-12 클라이언트 요구 ⑶) — 접속 직후 한 번, 안내로만.
 *
 * 왜: 실황 문항이 지역 기반이다(`{today.*}` 슬롯 → `weather_api.user_region`).
 * 지역을 안 고른 사람은 서버 폴백(서울)의 날씨로 오늘을 배우고, 그게 자기 하늘과
 * 다르다는 것을 화면 어디서도 듣지 못한다. 픽커는 `/me`와 학습 화면 오른쪽에
 * 있었지만 **찾아 들어가야** 보이는 자리였다.
 *
 * ⚠️ **모달이 아니다.** 규정이 「로그인 없이 열려야」이므로 아무것도 안 눌러도
 * 서비스가 그대로 보여야 한다 — `fixed inset-0`도, 백드롭도, `aria-modal`도 쓰지
 * 않는다. 본문 흐름 맨 위에 한 줄로 얹고 닫기를 준다. 계약은
 * `tests/onboardingSave.contract.test.mjs`가 문다(「길을 막지 않는다」).
 *
 * 뜨는 조건 (셋 다 참일 때만):
 *   1. `GET /progress/me`가 **도착했고** — 도착 전에 그리면 이미 고른 사람에게도
 *      한 프레임 번쩍인다.
 *   2. `region == null` — 서버가 저장 원본을 그대로 준다(schemas/progress.py:59는
 *      "프론트가 미설정과 서울로 설정을 구분해야 하므로"라고 이유까지 적어 둔다).
 *      **`?? '서울'` 폴백을 여기 쓰면 안 된다** — 그 순간 안내가 영영 안 뜬다.
 *   3. 이 기기에서 닫은 적이 없다(localStorage). 안내를 매 화면 이동마다 다시
 *      들이밀면 그것도 길을 막는 것이다.
 * 지역을 고르면 픽커가 같은 `['progress','me']` 캐시를 갱신하므로 2가 거짓이 되어
 * 스스로 사라진다 — 별도 배선이 없다.
 *
 * 여는 컨트롤을 따로 만들지 않고 `RegionPicker`(칩+시트)를 그대로 얹는다.
 * 시트·GPS 옵트인·좌표 즉시 폐기 계약은 전부 그 컴포넌트가 이미 갖고 있다.
 */
const DISMISS_KEY = 'weathermind.regionNotice.dismissed';

function readDismissed() {
  try {
    return globalThis.localStorage?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // 프라이빗 모드·저장소 차단 — 안내를 못 여는 것보다 뜨는 편이 낫다
  }
}

/**
 * @param persistent  true면 **항상 뜨고 닫기 버튼이 없다**(2026-08-13 클라이언트
 *   지시: "흰색 지역 노드 너무 이상해, 그냥 파랑 날씨 노드를 「나중에」 없이 흰색
 *   대신으로 고정해줘"). 학습 화면 오른쪽 열이 이 모드를 쓴다 — 거기서는 이 칸이
 *   **지역을 고르는 유일한 통로**라 닫히면 통로가 사라진다.
 *   기본값 false는 종전 온보딩 동작(미설정일 때만 · 닫으면 이 기기에서 끝).
 * @param onboarding  false면 `region == null` 조건을 안 본다(설정 뒤에도 남는다).
 *   persistent와 짝이다 — 설정한 사람에게도 「지금 어디로 배우는지」와 바꾸는
 *   통로를 보여 주는 것이 이 칸의 새 역할이다.
 */
export default function RegionOnboardingNotice({
  persistent = false,
  onboarding = true,
  'data-testid': testId = 'region-notice',
  className = 'flex flex-col gap-2 rounded-2xl bg-sky-50 p-3.5 ring-1 ring-sky-200',
}) {
  const t = useT();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [dismissed, setDismissed] = useState(readDismissed);

  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });

  // ⚠️ 조건을 셋 다 「끌 수 있게」 갈랐다 — persistent 모드는 닫힘도 미설정도 안 본다.
  //    `!me`(응답 도착 전)만은 두 모드가 공유한다: 도착 전에 그리면 이미 고른
  //    사람에게 빈 칩이 한 프레임 번쩍인다.
  if (!me) return null;
  if (!persistent && dismissed) return null;
  if (onboarding && me.region != null) return null;

  const close = () => {
    try {
      globalThis.localStorage?.setItem(DISMISS_KEY, '1');
    } catch {
      /* 저장에 실패해도 이번 세션에서는 닫힌다 */
    }
    setDismissed(true);
  };

  return (
    <div
      data-testid={testId}
      // 2026-08-13: 본문 맨 위 **가로 띠**에서 학습 화면 **오른쪽 세로 열**로
      // 옮겨졌다(클라이언트 지시 ⑴ — 소유자는 `LearnFooterCards`). 그래서
      //   · 바깥 여백(`mb-3.5`)을 뗐다 — 이제 열의 `gap-3.5`가 간격을 소유한다.
      //     둘 다 있으면 안내 밑만 두 배로 벌어진다.
      //   · 가로 flex(basis-[220px])를 세로 쌓기로 바꿨다. 248px 열에서는 어차피
      //     전부 줄바꿈됐고, wrap에 맡기면 닫기 버튼이 칩 옆에 끼거나 혼자
      //     다음 줄로 떨어지는 것이 폭에 따라 갈렸다.
      // ⚠️ `fixed`·`inset-0`·`aria-modal`·`role="dialog"`는 **여기 쓰지 않는다** —
      // 「길을 막지 않는다」가 규정 계약이고 `onboardingSave.contract` ⑤가 문다.
      className={className}
    >
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none" aria-hidden="true">
          📍
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-extrabold text-sky-900">{t('regionNotice.title')}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-sky-700">{t('regionNotice.body')}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RegionPicker />
        {/* 「나중에」는 **persistent 모드에서 그리지 않는다** — 그 모드에서는 이
            칸이 지역을 고르는 유일한 통로라, 닫으면 통로가 화면에서 사라진다. */}
        {!persistent && (
          <button
            type="button"
            data-testid="region-notice-close"
            onClick={close}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-sky-700 transition hover:bg-sky-100"
          >
            {t('regionNotice.dismiss')}
          </button>
        )}
      </div>
    </div>
  );
}
