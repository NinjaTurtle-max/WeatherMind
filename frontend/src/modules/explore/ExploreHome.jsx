import { Link } from 'react-router-dom';

/**
 * 탐구 홈 (R9-01 §3.5 S5) — 라우트 /explore. 탐구 시뮬 v1 2종 카드 목록.
 *
 * 각 카드에 "교육용 단순화 모델" 고지를 명시한다 — 수치 예보/기후 모델이 아니라
 * 결정적 교육 근사 위의 체험 레이어(R3 시뮬레이터 폐지 원칙과 정합).
 * 순수 클라이언트(서버·채점 무관), 문구 전부 자체 제작.
 */

const SIMS = [
  {
    to: '/explore/typhoon',
    icon: '🌪️',
    title: '태풍 만들기',
    description: '바다 온도와 바람 시어를 조절해 태풍이 언제, 얼마나 강하게 발달하는지 직접 확인해요.',
    inputs: 'SST 24~32℃ · 연직시어 약/중/강',
  },
  {
    to: '/explore/climate',
    icon: '🌡️',
    title: '기후변화 체험',
    description: 'CO₂ 농도를 움직여 지구 평균기온·해수면·폭염일수가 어떻게 반응하는지 살펴봐요.',
    inputs: 'CO₂ 280~560ppm',
  },
];

export default function ExploreHome() {
  return (
    <div className="space-y-4 py-4">
      <div>
        <h1 className="text-lg font-extrabold text-slate-800">🔭 탐구</h1>
        <p className="mt-1 text-xs text-slate-500">
          조건을 직접 움직여 보며 날씨와 기후의 원리를 체험하는 공간이에요.
        </p>
      </div>

      {SIMS.map((sim) => (
        <Link
          key={sim.to}
          to={sim.to}
          className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md"
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl">{sim.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-slate-800">{sim.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{sim.description}</p>
              <p className="mt-1.5 text-[10px] font-bold text-sky-600">{sim.inputs}</p>
              <p className="mt-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                교육용 단순화 모델 — 실제 예측이 아니에요
              </p>
            </div>
            <span className="text-slate-300">›</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
