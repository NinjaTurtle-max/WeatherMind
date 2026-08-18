/**
 * Mascot — 세션별 캐릭터를 그리는 단일 진입점.
 *
 * ⚠️ **이 표는 2026-08-11까지 실제 화면과 거꾸로 적혀 있었다.** 2026-08-04
 * 초안(sun=학습 세션 · drop=게임 보드 · bolt=오늘의 퀴즈 · typhoon=리그 ·
 * snow=예보 대결)이 그대로 남아 있었는데, 화면은 그 뒤로 여러 번 바뀌었고
 * 「오늘의 퀴즈」 화면은 아예 없어졌다. 표를 믿고 고치면 화면이 뒤집힌다 —
 * 실제 배정으로 맞춘다.
 *
 * **화면 담당의 소유자는 `SideNav.TUTOR_BY_PATH`다**(여기가 아니다). 아래는
 * 그 표를 읽기 쉽게 옮긴 사본이므로, 담당을 바꿀 일이 있으면 그쪽을 고치고
 * 여기를 따라 고칠 것.
 *   cloud   구름   폴백 — 담당이 없는 화면의 메인 튜터
 *   sun     태양   대기 보드(/board) — 판 설명·미션 안내
 *   drop    물방울 학습 세션(/learn/* · /daily) — 개념 설명·정답/해설 화자
 *   typhoon 태풍   예보 대결(/duel)
 *   bolt    번개   탐구(/explore) — 2026-08-17에 구름이에서 바뀌었다
 *   snow    눈결정 기상 리그(/league) — 2026-08-17에 번개에서 바뀌었다
 *                 (내 정보 프로필 카드도 같은 그림을 쓴다 — 화면 담당은 아니다)
 *   rainbow 무지개 화면 담당 없음 — 개념 전용(밀도와 부력). 2026-08-08 합류
 *   moon    달님   화면 담당 없음 — 개념 전용(열의 이동). 2026-08-08 합류
 *   snowcloud   눈구름 개념 전용(물의 상태변화). 2026-08-10 합류
 *   raincloud   비구름 개념 전용(홍수 대응). 2026-08-10 합류
 *   fire        불     개념 전용(산불 기상). 2026-08-10 합류
 *   thermometer 온도계 개념 전용(온도와 열). 2026-08-10 합류
 *
 * 뒤의 여섯은 **화면이 아니라 개념에 붙는다**. 기초과학 코스가 들어오면서 개념
 * 태그가 6종 늘었는데 그림은 6장뿐이라 전부 구름으로 떨어졌다(conceptCharacter의
 * 폴백) — 홈의 복습·최근 활동 줄이 전부 같은 얼굴이었다. 배정표는
 * `conceptCharacter.js`가 소유한다.
 * 2026-08-10에 넷이 더 합류해 12장이 됐다: 표에 아예 없던 산불 기상·홍수 대응이
 * 자기 얼굴을 갖고, 두 뜻을 지고 있던 눈결정·물방울에서 겹침이 하나씩 풀렸다.
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
  // 안내봇 전용(MT-26). 유일하게 **3D 모델에서 렌더한** 캐릭터다 —
  // 소스는 `weathermind-bot.glb`(텍스처·애니메이션 0 · 단색 재질 5종)이고
  // 정면 직교 뷰를 소프트웨어 래스터라이저로 뽑았다. 표정을 바꾸거나 각도를
  // 돌릴 일이 있으면 PNG를 손보지 말고 **원본 glb에서 다시 렌더**할 것.
  // `cloud`와 갈라 둔 이유: cloud는 담당 없는 화면의 폴백 튜터이자 개념
  // 캐릭터라 12종 체계에 묶여 있고, 그것을 바꾸면 홈·복습 줄이 함께 바뀐다.
  guidebot: '/guidebot.png',
  cloud: '/cloud.png',
  sun: '/sun.png',
  drop: '/drop.png',
  bolt: '/bolt.png',
  typhoon: '/typhoon.png',
  snow: '/snow.png',
  rainbow: '/rainbow.png',
  moon: '/moon.png',
  snowcloud: '/snowcloud.png',
  raincloud: '/raincloud.png',
  fire: '/fire.png',
  thermometer: '/thermometer.png',
};

const LABEL = {
  guidebot: '구름이',
  cloud: '구름이',
  sun: '태양이',
  drop: '물방울이',
  bolt: '번개',
  typhoon: '태풍이',
  snow: '눈결정',
  rainbow: '무지개',
  moon: '달님',
  snowcloud: '눈구름',
  raincloud: '비구름',
  fire: '불꽃이',
  thermometer: '온도계',
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
