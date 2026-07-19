import { useMemo, useState } from 'react';
import VariableSlider from './VariableSlider';
import ClimateChart from './ClimateChart';

/**
 * SimulatorPage (04번 스펙 섹션 3 — 축소판)
 * 단일 화면, 상태머신 없음 — 순수 반응형 UI.
 * 슬라이더 3개(CO2, 기온 민감도, 강수 반응) 값 변경 → 그래프 즉시 재계산.
 * 기상청 API·AI 체인·백엔드 호출 없음 (사전 정의된 단순 기후 모델 계수로 클라이언트 계산).
 * "시나리오 저장"은 MVP 제외 (스펙상 선택 기능).
 */
const BASE_YEAR = 2026;
const END_YEAR = 2100;
const BASE_CO2 = 425; // 현재 대기 중 CO2 농도(ppm) 근사값

function projectClimate({ co2Target, sensitivity, rainResponse }) {
  const data = [];
  for (let year = BASE_YEAR; year <= END_YEAR; year += 2) {
    const t = (year - BASE_YEAR) / (END_YEAR - BASE_YEAR); // 0~1 진행률
    // CO2 농도: 현재값에서 목표값까지 완만한 곡선(비선형)으로 수렴
    const co2 = BASE_CO2 + (co2Target - BASE_CO2) * (1 - Math.pow(1 - t, 2));
    // 기온 편차: 단순화한 복사강제력 근사 ΔT = S * log2(CO2/기준농도)
    const temp = sensitivity * Math.log2(co2 / BASE_CO2);
    // 강수량 변화율: 기온 1도당 rainResponse% (클라우지우스-클라페이론 단순화)
    const rain = temp * rainResponse;
    data.push({
      year,
      temp: Number(temp.toFixed(2)),
      rain: Number(rain.toFixed(1)),
    });
  }
  return data;
}

export default function SimulatorPage() {
  const [co2Target, setCo2Target] = useState(560); // 2100년 CO2 농도 목표(ppm)
  const [sensitivity, setSensitivity] = useState(3.0); // 기후 민감도(°C / CO2 배증)
  const [rainResponse, setRainResponse] = useState(7); // 강수 반응(%/°C)

  const data = useMemo(
    () => projectClimate({ co2Target, sensitivity, rainResponse }),
    [co2Target, sensitivity, rainResponse],
  );

  const final = data[data.length - 1];

  return (
    <div className="pt-2">
      <h1 className="mb-1 text-lg font-extrabold text-slate-900">기후 시뮬레이터</h1>
      <p className="mb-4 text-sm text-slate-500">
        슬라이더를 움직여 2100년까지의 기후 변화를 직접 실험해 보세요.
      </p>

      <ClimateChart data={data} />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-sky-900 p-3 text-center text-white">
          <p className="text-xs text-sky-200">2100년 기온 편차</p>
          <p className="text-xl font-extrabold">+{final.temp}°C</p>
        </div>
        <div className="rounded-xl bg-amber-500 p-3 text-center text-white">
          <p className="text-xs text-amber-100">2100년 강수 변화</p>
          <p className="text-xl font-extrabold">
            {final.rain >= 0 ? '+' : ''}
            {final.rain}%
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <VariableSlider
          label="2100년 CO₂ 농도"
          unit="ppm"
          min={350}
          max={900}
          step={5}
          value={co2Target}
          onChange={setCo2Target}
          hint="현재 약 425ppm. 산업화 이전은 280ppm이었어요."
        />
        <VariableSlider
          label="기후 민감도 (CO₂ 2배당 기온 상승)"
          unit="°C"
          min={1.5}
          max={4.5}
          step={0.1}
          value={sensitivity}
          onChange={setSensitivity}
          hint="IPCC 추정 범위는 약 2.5~4°C예요."
        />
        <VariableSlider
          label="강수 반응 (기온 1°C당 강수량 변화)"
          unit="%"
          min={0}
          max={14}
          step={1}
          value={rainResponse}
          onChange={setRainResponse}
          hint="따뜻한 공기는 수증기를 더 많이 머금어요 (약 7%/°C)."
        />
      </div>
    </div>
  );
}
