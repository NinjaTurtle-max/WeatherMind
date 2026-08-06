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
 *
 * 정렬(2026-08-06): PNG는 **알파 내용 경계로 크롭돼 있다**. 원본은 캔버스마다
 * 투명 여백이 제각각이었고(snow는 중심이 8px 어긋나 있었다) 같은 박스에 넣어도
 * 캐릭터마다 다른 위치·다른 크기로 보였다. 크롭 + 아래 object-contain + 호출부의
 * **정사각 박스** 세 가지가 같이 있어야 여섯 캐릭터가 한 자리에 맞는다.
 * ⚠️ 새 캐릭터 PNG를 추가하면 넣기 전에 여백을 깎을 것(내용 경계 = 이미지 경계).
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
      // object-contain은 호출부에 맡기지 않는다 — 빠뜨리면 세로가 정해진 박스에서
      // 그림이 늘어나고, 캐릭터마다 원본 비율이 달라(가로형 cloud ↔ 세로형 bolt)
      // 한 화면 안에서 왜곡 정도가 제각각이 된다.
      className={`object-contain ${className}`}
      // 캐릭터는 장식이다 — 정오답·진도 같은 의미는 옆의 배지·문구가 전달하므로
      // 스크린리더에서 중복해 읽지 않게 기본은 숨긴다.
      alt={decorative ? '' : (LABEL[name] ?? '')}
      aria-hidden={decorative ? 'true' : undefined}
    />
  );
}
