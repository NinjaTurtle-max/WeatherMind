/**
 * Mascot — 세션별 캐릭터를 그리는 단일 진입점.
 *
 * 캐릭터 배정(2026-08-04 결정):
 *   cloud   구름   메인 튜터 — 전체 안내
 *   sun     태양   학습 세션 — 개념 설명·학습 시작
 *   drop    물방울 게임 보드 — 미션·보상 안내
 *   bolt    번개   오늘의 퀴즈 — 출제·즉각 피드백
 *   typhoon 태풍   기상 리그 — 경쟁·랭킹·시즌
 *   snow    눈결정 예보 대결
 *
 * 이전 마스코트(노란 고양이 「썬더」)는 폐기됐다. 호출부가 public 경로를 직접
 * 참조하면 캐릭터가 바뀔 때마다 화면 곳곳을 고쳐야 하므로 여기 한 곳으로 모은다.
 * 파일명은 ASCII로 둔다 — 한글 파일명은 브라우저가 URL 인코딩해서 서버 설정에
 * 따라 404가 난다.
 */

const SRC = {
  cloud: '/cloud.png',
  sun: '/sun.png',
  drop: '/drop.png',
  bolt: '/bolt.png',
  typhoon: '/typhoon.png',
  snow: '/snow.png',
};

const LABEL = {
  cloud: '구름이',
  sun: '태양이',
  drop: '물방울이',
  bolt: '번개',
  typhoon: '태풍이',
  snow: '눈결정',
};

export const MASCOT_NAMES = LABEL;

export default function Mascot({ name = 'sun', className = '', decorative = true }) {
  const src = SRC[name] ?? SRC.sun;
  return (
    <img
      src={src}
      className={className}
      // 캐릭터는 장식이다 — 정오답·진도 같은 의미는 옆의 배지·문구가 전달하므로
      // 스크린리더에서 중복해 읽지 않게 기본은 숨긴다.
      alt={decorative ? '' : (LABEL[name] ?? '')}
      aria-hidden={decorative ? 'true' : undefined}
    />
  );
}
