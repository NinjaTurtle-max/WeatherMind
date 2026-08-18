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
  // GL 전용이다: SVG 스토리보드(CrossSectionPanel)는 이번 소유 범위 밖이라 손대지
  // 않았고, 그쪽이 같은 문법을 그리게 되면 여기 키를 그대로 쓰면 된다.
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
];

export const V = {};
for (const slug of SLUGS) {
  Object.defineProperty(V, slug, {
    enumerable: true,
    get: () => translate(getCurrentLocale(), `board.panel.viz.${slug}`),
  });
}
