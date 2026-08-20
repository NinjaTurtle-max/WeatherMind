import { useT } from '../../i18n';

/**
 * 「데모용 고정 날짜」 고지 (MT-30).
 *
 * **이 컴포넌트가 존재하는 이유가 이 항목의 정직성이다.** 과거 관측을 서버에
 * 적재하는 경로가 없어(celery 수집은 Redis 1h TTL, 과거관측은 KMA 실호출) 회차는
 * 공개 기록으로 검증된 **고정 픽스처**다. 그 사실을 화면이 숨기지 않는다 —
 * 숨기면 「과거 예보」가 아니라 「가짜 이력」이 된다.
 *
 * 문구는 서버 응답(`disclosure`)이 아니라 **i18n 리소스**에서 온다. 서버 문자열을
 * 그대로 그리면 en 모드에서 한국어가 나온다(MT-28에서 실제로 잡은 결함 유형).
 * 서버 필드는 API를 직접 보는 심사자용으로 따로 남아 있다.
 */
/**
 * `inline` — 카드가 아니라 **한 줄**로 낸다(2026-08-19). 회차 화면이 2열이 되면서
 * 이 고지가 본문에서 62px을 쓰는 노란 띠로 남아 있을 이유가 없어졌다. 탐구 실험실
 * 넷이 이미 「뒤로가기와 같은 행, 오른쪽 정렬 작은 글씨」 관례를 쓴다.
 * ⚠️ **접거나 숨기는 선택지는 없다.** 위 머리말대로 이 고지는 이 항목의 정직성
 *    자체다 — 줄이는 것은 되지만 없애는 것은 안 된다. 그래서 `hidden`이 아니라
 *    글자 크기만 줄였고, `data-testid`는 두 꼴이 같아 스모크가 양쪽을 다 잡는다.
 */
export default function DemoDataNotice({ inline = false }) {
  const t = useT();
  if (inline) {
    return (
      <p
        data-testid="hindcast-demo-notice"
        className="min-w-0 text-[10.5px] leading-snug text-amber-700 sm:text-right"
      >
        <span className="font-bold">{t('hindcast.disclosure.label')}: </span>
        {t('hindcast.disclosure.body')}
      </p>
    );
  }
  return (
    <div
      data-testid="hindcast-demo-notice"
      className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200"
    >
      <p className="text-[11px] font-extrabold text-amber-700">
        {t('hindcast.disclosure.label')}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
        {t('hindcast.disclosure.body')}
      </p>
    </div>
  );
}
