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

export default function RegionOnboardingNotice() {
  const t = useT();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [dismissed, setDismissed] = useState(readDismissed);

  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });

  if (dismissed || !me || me.region != null) return null;

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
      data-testid="region-notice"
      className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-sky-50 p-3.5 ring-1 ring-sky-200"
    >
      <span className="text-xl" aria-hidden="true">
        📍
      </span>
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="text-sm font-extrabold text-sky-900">{t('regionNotice.title')}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-sky-700">{t('regionNotice.body')}</p>
      </div>
      <RegionPicker />
      <button
        type="button"
        data-testid="region-notice-close"
        onClick={close}
        className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-sky-700 transition hover:bg-sky-100"
      >
        {t('regionNotice.dismiss')}
      </button>
    </div>
  );
}
