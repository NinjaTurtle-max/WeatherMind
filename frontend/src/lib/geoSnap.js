/**
 * geoSnap (R12 선행 §8.2) — 옵트인 GPS → 12도시 최근접 스냅. **클라이언트 종결.**
 *
 * 개인위치정보 미취급 설계(§8.2 계약):
 *  - 위경도는 이 파일 안에서 최근접 도시를 고르는 계산에만 쓰고 **즉시 폐기**한다.
 *    snapToNearestRegion()이 밖으로 내보내는 값은 도시명 문자열 하나뿐이며,
 *    좌표는 저장·전송·로깅 어디에도 실리지 않는다(스모크가 PUT 본문 키를 단정).
 *  - 권한 거부·타임아웃·비보안 컨텍스트·geolocation 부재는 전부 null로 조용히
 *    수렴한다 — 호출자는 픽커 수동 선택으로 폴백하고, 오류를 화면 결함으로
 *    승격하지 않는다.
 *
 * 12도시 위경도(이 파일 소유 상수):
 *  - 도시 목록은 서버 화이트리스트 backend/app/services/weather_api.py의
 *    KMA_GRID 키 12종과 1:1이다(스모크 region.smoke.test.mjs가 파일을 읽어 대조).
 *  - 좌표는 각 시청(강릉·수원 등은 시청, 서울은 시청 기준) 대표점의 소수 4자리
 *    근사값 — 도 단위 스냅 용도라 수십 m 오차는 판정에 영향이 없다.
 *  - key는 i18n 리소스 `region.city.{key}` 표시명과 짝이다(값은 서버 전송용 원문).
 */
export const REGIONS = [
  { value: '서울', key: 'seoul', lat: 37.5665, lon: 126.978 },
  { value: '부산', key: 'busan', lat: 35.1796, lon: 129.0756 },
  { value: '대구', key: 'daegu', lat: 35.8714, lon: 128.6014 },
  { value: '인천', key: 'incheon', lat: 37.4563, lon: 126.7052 },
  { value: '광주', key: 'gwangju', lat: 35.1595, lon: 126.8526 },
  { value: '대전', key: 'daejeon', lat: 36.3504, lon: 127.3845 },
  { value: '울산', key: 'ulsan', lat: 35.5384, lon: 129.3114 },
  { value: '강릉', key: 'gangneung', lat: 37.7519, lon: 128.8761 },
  { value: '제주', key: 'jeju', lat: 33.4996, lon: 126.5312 },
  { value: '수원', key: 'suwon', lat: 37.2636, lon: 127.0286 },
  { value: '청주', key: 'cheongju', lat: 36.6424, lon: 127.489 },
  { value: '전주', key: 'jeonju', lat: 35.8242, lon: 127.148 },
];

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** 하버사인 대권 거리(km) — 12도시 스냅 판정용. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * 순수 함수: 위경도 → 최근접 도시명. 입력이 숫자가 아니면 null.
 * (스모크가 12도시 자기 좌표 자기 스냅 + 경계 케이스를 단정한다 — 상수 반환
 *  변이는 여기서 문다.)
 */
export function nearestRegion(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const r of REGIONS) {
    const d = haversineKm(lat, lon, r.lat, r.lon);
    if (d < bestDist) {
      bestDist = d;
      best = r.value;
    }
  }
  return best;
}

/**
 * 옵트인 GPS 스냅: 위치 1회 조회 → 최근접 도시명 resolve. 실패는 전부 null
 * (reject 없음 — 호출자가 try/catch 없이 픽커 폴백으로 이어가게).
 * 좌표는 콜백 지역변수로만 존재하고 nearestRegion 계산 후 참조가 끊긴다(폐기).
 */
export function snapToNearestRegion({ timeoutMs = 8000 } = {}) {
  const geo = globalThis.navigator?.geolocation;
  // geolocation 부재(구형/테스트 환경) 또는 명시적 비보안 컨텍스트 → 조용히 폴백
  if (!geo?.getCurrentPosition || globalThis.isSecureContext === false) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    // 브라우저 timeout 옵션이 무시되는 구현 대비 자체 타임아웃도 건다
    const timer = setTimeout(() => settle(null), timeoutMs + 500);
    try {
      geo.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          // 좌표는 여기서만 읽고 도시명으로 축약 — 밖으로 나가는 것은 문자열뿐
          settle(nearestRegion(pos?.coords?.latitude, pos?.coords?.longitude));
        },
        () => {
          clearTimeout(timer);
          settle(null); // 권한 거부·위치 불가·타임아웃 — 전부 수동 선택 폴백
        },
        { timeout: timeoutMs, maximumAge: 60_000, enableHighAccuracy: false },
      );
    } catch {
      clearTimeout(timer);
      settle(null);
    }
  });
}
