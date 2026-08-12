import { conceptLabel, useT } from '../../i18n';

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

export default function AbilityRadar({ abilities = [], className = '' }) {
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
    .map((a, i) => at(i, thetaToRatio(a.theta)).map((v) => v.toFixed(1)).join(','))
    .join(' ');

  return (
    <svg
      viewBox="0 0 200 200"
      data-testid="ability-radar"
      className={`flex-none ${className}`}
      role="img"
      // 그림은 스크린리더에 안 보이므로 **읽을 수 있는 요약**을 준다.
      // 옆 막대 목록과 같은 내용이지만, 막대는 li 단위라 "전체 모양"에 해당하는
      // 문장이 따로 필요하다.
      aria-label={t('home.brain.aria', {
        list: abilities
          .map((a) => `${conceptLabel(t, a.concept_tag)} ${t(`ability.level.${a.level_label}`)}`)
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
      <polygon points={shape} fill="rgba(2,132,199,.22)" stroke="#0284C7" strokeWidth="2" strokeLinejoin="round" />
      <g fill="#0284C7">
        {abilities.map((a, i) => {
          const [x, y] = at(i, thetaToRatio(a.theta));
          return <circle key={a.concept_tag} cx={x} cy={y} r="3" />;
        })}
      </g>
    </svg>
  );
}
