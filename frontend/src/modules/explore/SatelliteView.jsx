import { useT } from '../../i18n';

/**
 * SatelliteView (MT-21) — **위성에서 내려다본 구름 도식**.
 *
 * 재범위 근거(`CARRYOVER_R13.md` §0.5ⓔ, 클라이언트 지시): 원 F3는 **KMA 실사 위성
 * 영상**이었고 이미지 프록시·저작권·캐싱이 선행이라 8/21까지 불가였다. 그것을
 * **우리가 그리는 도식**으로 바꾸면 선행이 0이 된다 — 이 파일이 그 결론이다.
 * ⚠️ 그래서 **실사 영상이 아니라는 표기가 이 컴포넌트의 계약**이다. 위성처럼
 * 보이는 그림에 그 한 줄이 없으면 그 자체가 허위 표시가 된다.
 *
 * **왜 `TyphoonEye`로 충분하지 않은가**: 그쪽은 이미 나선+눈을 위에서 그린다.
 * 더 예쁜 나선을 하나 더 그리는 것은 의미가 없다. 위성이 보여주는 것 중 그
 * 만화가 못 보여주는 것은 **연직 시어의 흔적**이다 —
 *   · 시어 약함 → 구름 방패가 중심 대칭, 눈이 뚜렷하게 뚫린다
 *   · 시어 강함 → 방패가 한쪽으로 밀리고 중심이 노출된다(눈 없음)
 * 실제 IR 영상 판독에서 "구름이 한쪽으로 흘렀다 = 시어가 세다"는 1차 단서이고,
 * 그 판독을 **슬라이더로 직접 만들어 보는 것**이 이 패널의 학습 목표다.
 *
 * 입력은 `typhoonIntensity()` 산출값뿐이다 — 새 물리 상수를 두지 않는다(계약 수치는
 * `lib/exploreSims.js`가 단독 소유). 시어→비대칭은 **표시 매핑**이지 모델이 아니다.
 *
 * 정지 프레임에서 읽혀야 한다: SSR 렌더 테스트는 한 프레임만 보고, reduced-motion
 * 사용자는 애니메이션을 아예 안 본다. 그래서 시어 신호를 **회전이 아니라 배치**로 준다.
 */

// 시어 → 구름 방패 중심 이동(도식 좌표, viewBox 120 기준). 값이 클수록 중심 노출.
// 물리량이 아니라 **표기 강도**다 — 실제 변위는 사례마다 다르고, 여기서 노리는 것은
// "시어가 세면 구름이 한쪽으로 쏠린다"는 형태 인지 하나다.
const SHEAR_OFFSET = { weak: 0, moderate: 9, strong: 20 };

// 구름 꼭대기 온도 색 램프(IR 관례: 차가울수록 = 높을수록 밝고 흰색).
// 3단계로만 나눈다 — 단계가 많아지면 색이 정보가 아니라 장식이 된다.
const CLOUD_RAMP = [
  { key: 'low', fill: '#94a3b8' },   // 낮은 구름 — 따뜻함
  { key: 'mid', fill: '#e2e8f0' },   // 중간
  { key: 'high', fill: '#ffffff' },  // 높은 적란운 — 가장 차가움
];

export default function SatelliteView({ intensity, shear }) {
  const t = useT();
  const offset = SHEAR_OFFSET[shear] ?? 0;
  const active = intensity > 0;
  // 강도가 셀수록 방패가 넓고 눈이 작다. 눈은 **시어가 약할 때만** 뚫린다 —
  // 시어가 세면 상층과 하층이 어긋나 눈이 닫힌다(형태 판독의 핵심 신호).
  const shieldR = 26 + (intensity / 100) * 20;
  const eyeR = Math.max(3.5, 10 - (intensity / 100) * 5.5);
  const hasEye = active && shear === 'weak' && intensity >= 40;

  return (
    <figure className="mt-4 rounded-2xl bg-slate-900 p-3 ring-1 ring-slate-700">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-extrabold text-slate-100">
          {t('explore.satellite.title')}
        </span>
        {/* 실사가 아니라는 표기 — 이 컴포넌트의 존립 조건이다(위 주석 참고) */}
        <span className="text-[10px] font-bold text-amber-300">
          {t('explore.satellite.schematicBadge')}
        </span>
      </figcaption>

      <svg
        viewBox="0 0 120 120"
        className="w-full rounded-lg"
        role="img"
        aria-label={t(
          active
            ? hasEye
              ? 'explore.satellite.ariaEye'
              : 'explore.satellite.ariaSheared'
            : 'explore.satellite.ariaNone',
        )}
      >
        {/* 바다(야간 IR 배경) */}
        <rect x="0" y="0" width="120" height="120" fill="#0f172a" />

        {/* 위경도 격자 — 위성 영상의 관례. 척도가 있어야 "쏠림"이 눈에 들어온다 */}
        <g stroke="#1e293b" strokeWidth="0.6">
          {[20, 40, 60, 80, 100].map((v) => (
            <line key={`h${v}`} x1="0" y1={v} x2="120" y2={v} />
          ))}
          {[20, 40, 60, 80, 100].map((v) => (
            <line key={`v${v}`} x1={v} y1="0" x2={v} y2="120" />
          ))}
        </g>

        {/* data-sat-* 는 테스트가 색이 아니라 **구조**로 물게 한다 — 색(#ffffff)은
            아래 범례에도 쓰여서 색 대조는 거짓 양성이 난다(실제로 한 번 났다) */}
        {active ? (
          <g data-sat-shield={shear}>
            {/* 구름 방패 3겹 — 바깥일수록 낮고 따뜻한 구름.
                시어만큼 **위층이 더 많이 밀린다**(연직으로 어긋나는 것이 시어의 정의).
                층마다 같은 거리를 밀면 그냥 통째로 이동한 그림이 되어 신호가 죽는다. */}
            {CLOUD_RAMP.map((band, i) => {
              const layer = i / (CLOUD_RAMP.length - 1); // 0=아래층, 1=위층
              return (
                <circle
                  key={band.key}
                  cx={60 + offset * layer}
                  cy={60 - offset * layer * 0.35}
                  r={shieldR * (1 - i * 0.26)}
                  fill={band.fill}
                  opacity={0.35 + layer * 0.4}
                />
              );
            })}

            {hasEye ? (
              // 눈 — 배경(바다)이 그대로 비치게 뚫는다
              <circle cx="60" cy="60" r={eyeR} fill="#0f172a" stroke="#cbd5e1" strokeWidth="1" />
            ) : (
              // 눈이 닫힌 경우: 중심이 어디였는지 십자로만 표시한다.
              // 시어가 셀 때 "중심이 구름 밖으로 드러난다"가 판독의 핵심이라
              // 중심 표식은 방패와 **함께 밀지 않는다**(고정 위치가 대비를 만든다).
              <g stroke="#f87171" strokeWidth="1.2" opacity="0.9">
                <line x1="54" y1="60" x2="66" y2="60" />
                <line x1="60" y1="54" x2="60" y2="66" />
              </g>
            )}
          </g>
        ) : (
          // 발생 없음 — 산발적인 낮은 구름만
          <g data-sat-quiet="true" fill="#334155" opacity="0.8">
            <ellipse cx="34" cy="46" rx="11" ry="5" />
            <ellipse cx="78" cy="70" rx="9" ry="4" />
            <ellipse cx="52" cy="88" rx="13" ry="5" />
          </g>
        )}
      </svg>

      {/* 색 램프 범례 — 색이 무엇을 뜻하는지 없으면 그냥 예쁜 그림이다 */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] font-bold text-slate-400">
          {t('explore.satellite.rampLow')}
        </span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full">
          {CLOUD_RAMP.map((band) => (
            <span key={band.key} className="flex-1" style={{ backgroundColor: band.fill }} />
          ))}
        </div>
        <span className="text-[10px] font-bold text-slate-200">
          {t('explore.satellite.rampHigh')}
        </span>
      </div>

      {/* 지금 화면이 무엇을 말하는지 한 줄로 — 도식만 두면 판독을 학습자가 혼자 해야 한다 */}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
        {t(
          active
            ? hasEye
              ? 'explore.satellite.readEye'
              : shear === 'weak'
                ? 'explore.satellite.readGrowing'
                : 'explore.satellite.readSheared'
            : 'explore.satellite.readNone',
        )}
      </p>
    </figure>
  );
}
