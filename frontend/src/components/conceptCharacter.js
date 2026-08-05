/**
 * 개념 태그 → 캐릭터 매핑 (2026-08-05 결정).
 *
 * 시안(`Soft Cloud 홈`)은 개념 6종 자리를 점선으로 비워 두고 "개념 전용 캐릭터"를
 * 기다렸지만, 지금 있는 그림은 **화면 담당 마스코트 6종**뿐이다. 개념도 6종이라
 * 1:1로 붙여 쓴다.
 *
 * ⚠️ **같은 그림이 두 뜻을 지고 있다.** 태양이는 `Mascot.jsx` 배정표에서 "게임 보드"
 * 담당인데 여기서는 "열섬 현상"을 뜻한다. 개념 전용 캐릭터가 생기면 이 파일의
 * 값만 갈아끼우면 되도록 매핑을 한 곳에 모아 둔다 — 호출부는 여기만 본다.
 *
 * 근거: 기압과 전선→구름(전선이 구름을 만든다) · 기단→눈(시베리아 기단은 차고
 * 건조) · 태풍→태풍 · 열섬 현상→태양(도시가 만든 더위) · CO₂와 기후→물방울
 * (온실효과·수증기) · 이상 기후→번개(극한 현상).
 */
const BY_CONCEPT = {
  pressure_front: 'cloud',
  air_mass: 'snow',
  typhoon: 'typhoon',
  heat_island: 'sun',
  co2_climate: 'drop',
  anomaly: 'bolt',
};

/** 알 수 없는 태그는 메인 튜터(구름)로 떨어뜨린다 — 빈 칸을 남기지 않는다. */
export function conceptCharacter(conceptTag) {
  return BY_CONCEPT[conceptTag] ?? 'cloud';
}
