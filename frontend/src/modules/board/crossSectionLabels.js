// core만 import — index.js(zustand)를 끌면 순수 node 경로가 죽는다(i18n/core.js 주석)
import { translate, getCurrentLocale } from '../../i18n/core.js';

/**
 * 단면 장면 내부 라벨 — **SVG(CrossSectionPanel)와 WebGL(scenes.js)의 단일 소유자**
 * (MT-28).
 *
 * 왜 모듈을 따로 뒀나: 두 파일이 같은 문자열을 **각자 손으로** 들고 있었다(고유
 * 58건이 양쪽 중복, GL에만 3건 더). 종전 제외 주석은 *"부분 번역 시 SVG↔GL 표기가
 * 어긋난다"*를 이유로 외부화를 미뤘는데, **어긋남은 이미 구조적으로 존재했다** —
 * 두 벌을 손으로 맞추는 상태였기 때문이다. 키를 하나로 모으면 그 위험이 사라진다.
 *
 * `V.coldAir`처럼 **접근 시점에** 현재 로케일로 풀린다. scenes.js는 컴포넌트가
 * 아니라 데이터 모듈이라 훅을 못 쓰므로 이 형태여야 한다.
 */
const SLUGS = [
  'altitude',
  'surface',
  'strongSun',
  'clearSkyWildfire',
  'cloudCannotGrow',
  'nimbostratusWide',
  'descendCompressWarm',
  'foehnClear',
  'snowCloudDevelop',
  'convectiveRise',
  'heatAccumulates',
  'hotHumid',
  'warmedAirRises',
  'warmDry',
  'warmDryAirMass',
  'warmHumidAir',
  'warmAir',
  'warmYellowSea',
  'groundCannotAbsorb',
  'groundRadiatesCools',
  'clearCalmNight',
  'dryWarmWind',
  'condenseByWater',
  'driedLeavesTwigs',
  'lowVapourNoSea',
  'radiativeCooling',
  'northPacificMt',
  'embersRideWind',
  'rainCloudRefills',
  'monsoonCloudBand',
  'mountainRange',
  'westCoastSnow',
  'strongWind',
  'vapourShortNoCloud',
  'condenseToSeaFog',
  'condenseToFogLayer',
  'vapourKeepsArriving',
  'humidAirSupply',
  'siberianCp',
  'coolsFromBelow',
  'yangtzeAirMass',
  'heatVapourSupply',
  'clearDespiteChurn',
  'rainOnRiseLosesWater',
  'okhotskAirMass',
  'noVapourToCondense',
  'denseFogEarlyMorning',
  'cumulonimbus',
  'stationaryFront',
  'groundHeating',
  'nearSurfaceCooling',
  'coldDry',
  'coldHumidAir',
  'coldHumid',
  'coldAir',
  'coldAirRetreating',
  'coldSea',
  'coldClearWinterSky',
  'mildClearSky',
  'heatwave',
  'liftsAfterSunrise',
  'fogLowCloudToShore',
  'upglide',
  // MT-23 재난 2종 품질 개선 — 조사 문법에서 온 라벨(RESEARCH_MT23_WILDFIRE_FLOOD.md).
  // ⚠️ 여기 *"GL 전용이다 — SVG 스토리보드는 이번 소유 범위 밖이라 손대지 않았고,
  // 그쪽이 같은 문법을 그리게 되면 여기 키를 그대로 쓰면 된다"*고 적혀 있었다.
  // **그 예고대로 됐다**(2026-08-18): SVG 폴백(CrossSectionPanel)이 산불에서 산을,
  // 홍수에서 도시를 그리게 되면서 아래 13종을 **양쪽이 함께 쓴다** — 이 모듈이
  // 단일 소유자라는 전제가 그대로 성립한 사례다. 경위를 남기는 이유는 그 한 줄이
  // 「SVG는 옛 표현으로 둬도 된다」의 근거로 읽힐 수 있었기 때문이다.
  'daysOfDrying',
  'fireFrontHead',
  'spotFireAhead',
  'newCellsUpwind',
  'soilAlreadyFull',
  'runoffGathersLow',
  'forestedRidge',
  'cityImpervious',
  'fireRunsUphill',
  'crownFireInTrees',
  'drainOverwhelmed',
  'basementFloods',
  'greenGroundSoaks',
  // ㉣ 변동 기상요소 규칙 3종(2026-08-18) — 아래 셋만 새로 필요했다.
  // 나머지는 기존 어휘를 그대로 쓴다(예: 양간지풍은 `dryWarmWind`+`mountainRange`).
  'windShear',
  'organizedStorm',
  'cloudBlocksSun',
  // 태풍 씨앗·열대야(2026-08-18) — 규칙 2종이 또 장면 없이 들어와 함께 채운다.
  'latentHeatFuel',
  'lowShearColumn',
  'eyewallStrongest',
  'longwaveTrapped',
  'noWindNoMixing',
  'groundEmitsLongwave',
];

export const V = {};
for (const slug of SLUGS) {
  Object.defineProperty(V, slug, {
    enumerable: true,
    get: () => translate(getCurrentLocale(), `board.panel.viz.${slug}`),
  });
}
