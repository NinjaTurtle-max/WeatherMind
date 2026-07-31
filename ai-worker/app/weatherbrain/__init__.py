"""WeatherBrain — 자체 적응형 엔진 (IRT 기반).

03_ai_chains_spec.md §0·§5의 "IRT 파라미터(문항 난이도 b, 학습자 능력 θ) 재학습"
설계를 실제로 구현한 모듈. 외부 LLM(Gemini)과 무관한 자체 모델 레이어로,
Router Chain에 "개념별 실력 추정치(θ)"를 공급하고 신규 유저의 초기 난이도를 배정한다.

- irt.py        : 순수 파이썬 IRT 수학 (2PL 문항반응함수 · EAP θ 추정 · b 보정)
- priors.py     : level_group → θ 사전분포 · 문항 b 사전값 매핑
- placement.py  : 신규 유저 초기 난이도 배정(콜드스타트)

무상태 원칙: 이 패키지는 순수 함수만 노출한다. 영속화(θ·b 저장)는 backend가 소유하며
ai-worker는 계산만 담당한다(RUNBOOK §2.8 curriculum-validate와 동일한 무DB 계약).
"""

