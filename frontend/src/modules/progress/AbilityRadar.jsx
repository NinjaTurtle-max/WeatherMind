import { conceptLabel, useT } from '../../i18n';
import { knowledgeLevelLabel } from '../../lib/abilityDisplay';

/**
 * AbilityRadar — 개념별 실력(θ) 레이더 차트.
 *
 * 2026-08-09에 홈 화면이 사라지면서(학습 화면에 흡수) 갈 곳을 잃은 그림이다.
 * 홈의 「WeatherBrain 분석」 카드가 이걸 왼쪽에, 개념 목록을 오른쪽에 두고 있었다.
 * 내 정보의 WeatherBrainPanel은 **가로 막대**를 쓰는데(그건 그대로 두라는 지시),
 * 막대는 개념을 하나씩 읽게 하고 레이더는 **모양 전체**를 한 번에 보여준다 —
 * "어느 쪽으로 치우쳤나"는 막대로는 안 보인다. 둘을 같이 둔다.
 *
 * 개념 3종 미만이면 null이다 — 다각형이 그려지지 않는다(선분 2개는 면이 아니다).
 * 그 경우 호출부가 빈 자리를 남기지 않게 사유 문구로 대체한다.
 *
 * θ → 반지름: 대략 -3..+3을 0.12..1로 편다(schemas/progress.py의 실사용 범위).
 * 하한이 0(중심)이 아니라 0.12인 이유는, 갓 시작한 학습자의 도형이 점 하나로
 * 뭉개져 "아무것도 없다"로 보이기 때문이다.
 */
export function thetaToRatio(theta) {
  return Math.min(1, Math.max(0.12, (theta + 3) / 6));
}

/**
 * 다각형이 그려지는 최소 개념 수 — **이 파일이 소유한다.** 셋 미만이면 면이
 * 생기지 않아 그림이 아니라 선이 된다. 소비처(WeatherBrainPanel)가 감싼 여백까지
 * 같이 걷어야 하므로 밖에서도 읽을 수 있게 내보낸다(2026-08-11 코드 리뷰:
 * 한쪽에 3을 박아 두면 이 수가 바뀔 때 빈 줄이 조용히 되살아난다).
 */
export const RADAR_MIN_CONCEPTS = 3;

/**
 * 색조 — **왼쪽 θ는 파랑, 오른쪽 숙련도는 초록**(2026-08-18 사용자 지시).
 * 한 카드 안에 같은 모양이 둘 뜨므로 색이 유일한 구분이다: 「지금 실력」과
 * 「이 개념을 익혔을 확률」은 축도 범위도 다른 값이라, 같은 파랑으로 그리면
 * 두 그림을 겹쳐 읽게 된다.
 */
export const RADAR_TONES = {
  sky: { fill: 'rgba(2,132,199,.22)', stroke: '#0284C7' },
  emerald: { fill: 'rgba(5,150,105,.22)', stroke: '#059669' },
};

/**
 * 0~1 비율을 반지름으로 — θ와 **같은 하한 0.12**를 쓴다. 갓 시작한 학습자의
 * 도형이 점 하나로 뭉개져 "아무것도 없다"로 보이는 것을 막는 값이고, 두 그림이
 * 같은 하한을 써야 나란히 놓았을 때 크기 감각이 어긋나지 않는다.
 */
export function unitToRatio(v) {
  return Math.min(1, Math.max(0.12, Number(v) || 0));
}

/**
 * 빈 자리 표시 — **레이더가 앉을 자리**를 점선으로 그린다.
 *
 * 데이터가 없을 때 문구 한 줄만 남기면 열이 통째로 빈다. 숙련도(BKT)는 응답이
 * 하나도 없으면 행이 0건인데, θ 쪽은 **응답 0회여도 사전분포로 개념 전건이
 * 뜬다** — 그래서 갓 가입한 학습자에게는 왼쪽이 레이더+행 여럿, 오른쪽이 한
 * 줄인 상태가 **기본값**이다(2026-08-20). 그 상태가 "고장"이 아니라 "여기
 * 채워집니다"로 읽히게 하는 것이 이 부품의 일이다.
 *
 * ⚠️ 치수(cx·cy·R·링 비율)는 본체와 **같은 값을 쓴다** — 자리 표시가 실제
 * 레이더보다 크거나 작으면, 데이터가 들어찬 순간 그림이 튀어 보인다.
 * ⚠️ 다각형이 아니라 **원**이다. 각을 그리면 그 각의 수가 "개념 몇 종"으로
 * 읽히는데, 아직 아무 개념도 없다는 것이 이 그림의 내용이다.
 */
export function AbilityRadarPlaceholder({
  className = '',
  ariaLabel = null,
  testId = 'ability-radar-placeholder',
}) {
  const t = useT();
  const cx = 100;
  const cy = 100;
  const R = 80;
  return (
    <svg
      viewBox="0 0 200 200"
      data-testid={testId}
      className={`flex-none ${className}`}
      role="img"
      aria-label={ariaLabel ?? t('weatherBrain.mastery.emptyAria')}
    >
      <g fill="none" stroke="#DDE8F1" strokeWidth="1" strokeDasharray="4 4">
        {[1, 0.66, 0.33].map((r) => (
          <circle key={r} cx={cx} cy={cy} r={R * r} />
        ))}
      </g>
      <g stroke="#E8EFF5" strokeWidth="1">
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={(cx + Math.cos(a) * R).toFixed(1)}
              y2={(cy + Math.sin(a) * R).toFixed(1)}
            />
          );
        })}
      </g>
      <circle cx={cx} cy={cy} r="3" fill="#DDE8F1" />
    </svg>
  );
}

export default function AbilityRadar({
  abilities = [],
  className = '',
  tone = RADAR_TONES.sky,
  ratio = (a) => thetaToRatio(a.theta),
  ariaLabel = null,
  testId = 'ability-radar',
}) {
  const t = useT();
  const n = abilities.length;
  if (n < RADAR_MIN_CONCEPTS) return null;
  const cx = 100;
  const cy = 100;
  const R = 80;
  const at = (i, r) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r];
  };
  const ring = (r) =>
    abilities.map((_, i) => at(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
  const shape = abilities
    .map((a, i) => at(i, ratio(a)).map((v) => v.toFixed(1)).join(','))
    .join(' ');

  return (
    <svg
      viewBox="0 0 200 200"
      data-testid={testId}
      className={`flex-none ${className}`}
      role="img"
      // 그림은 스크린리더에 안 보이므로 **읽을 수 있는 요약**을 준다.
      // 옆 막대 목록과 같은 내용이지만, 막대는 li 단위라 "전체 모양"에 해당하는
      // 문장이 따로 필요하다.
      //
      // 난이도 표기는 **교과 단계**다(2026-08-19 사용자 지적 — /me가 한 화면에서
      // 「고등학교 진로선택」과 「중급」을 동시에 말하고 있었다). 여기가 옆 막대 칩과
      // **같은 함수**를 읽는 것이 계약이다: 눈으로 보는 문구와 스크린리더가 읽는
      // 문구가 갈리면 같은 그림을 두 사람이 다르게 듣는다.
      // `knowledge_level`이 null·부재면 knowledgeLevelLabel이 4밴드로 내려앉는다 —
      // 종전 `ability.level.*`가 n=0에서도 라벨을 줬으므로 **빈칸은 회귀**다.
      aria-label={ariaLabel ?? t('home.brain.aria', {
        list: abilities
          .map((a) => `${conceptLabel(t, a.concept_tag)} ${knowledgeLevelLabel(a)}`)
          .join(', '),
      })}
    >
      <g fill="none" stroke="#DDE8F1" strokeWidth="1">
        {[1, 0.66, 0.33].map((r) => (
          <polygon key={r} points={ring(r)} />
        ))}
      </g>
      <g stroke="#DDE8F1" strokeWidth="1">
        {abilities.map((a, i) => {
          const [x, y] = at(i, 1);
          return <line key={a.concept_tag} x1={cx} y1={cy} x2={x} y2={y} />;
        })}
      </g>
      <polygon points={shape} fill={tone.fill} stroke={tone.stroke} strokeWidth="2" strokeLinejoin="round" />
      <g fill={tone.stroke}>
        {abilities.map((a, i) => {
          const [x, y] = at(i, ratio(a));
          return <circle key={a.concept_tag} cx={x} cy={y} r="3" />;
        })}
      </g>
    </svg>
  );
}
