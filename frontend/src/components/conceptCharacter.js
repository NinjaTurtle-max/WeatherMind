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
 *
 * 2026-08-08 — 기초과학 코스(basic-science) 6종 추가. 그 전까지 이 여섯은 표에
 * 없어서 **전부 폴백(구름)으로 떨어졌다** — 홈의 복습 추천·최근 활동 줄이 기초과학
 * 개념에서는 같은 얼굴만 반복했다. 새 그림 둘(무지개·달님)이 합류해 8장이 됐고,
 * 겹치는 자리 없이 여섯을 다 채운다.
 *
 * 근거: 온도와 열→물방울(「물은 왜 천천히 데워질까」 — 비열) · 복사 균형→태양
 * (햇빛이 지구를 데운다) · 기압의 기초→구름(공기의 무게) · **밀도와 부력→무지개**
 * (두 구름 사이에서 위로 솟은 아치 = 뜨거운 공기의 상승) · 상태 변화→눈결정
 * (물↔얼음↔수증기) · **열의 이동→달님**(밤의 복사냉각 — 낮에 받은 열이 빠져나간다).
 */
const BY_CONCEPT = {
  // 날씨 코스(weather)
  pressure_front: 'cloud',
  air_mass: 'snow',
  typhoon: 'typhoon',
  heat_island: 'sun',
  co2_climate: 'drop',
  anomaly: 'bolt',
  // 기초과학 코스(basic-science)
  temperature_heat: 'drop',
  radiation_budget: 'sun',
  pressure_basics: 'cloud',
  density_buoyancy: 'rainbow',
  phase_change: 'snow',
  energy_transfer: 'moon',
};

/** 알 수 없는 태그는 메인 튜터(구름)로 떨어뜨린다 — 빈 칸을 남기지 않는다. */
export function conceptCharacter(conceptTag) {
  return BY_CONCEPT[conceptTag] ?? 'cloud';
}
