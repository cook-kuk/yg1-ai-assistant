import type { InfoToggleContent } from "../../shared/info-toggle"

/**
 * Central DB for every InfoToggle in AI Research Lab + Machine Impact Lab.
 * 한국어 초보자 친화. 각 항목은 { title, whatIsIt, whyMatters, howComputed?,
 * productionReqs?, relatedFeatures?, level? } 구조.
 *
 * TODO: PRODUCTION — 실제 배포 시 도메인 전문가 검토 + 다국어 번역 필요.
 */
export const FEATURE_EXPLANATIONS: Record<string, InfoToggleContent> = {
  "ai-research-lab-overview": {
    title: "AI Research Laboratory",
    whatIsIt:
      "ARIA가 앞으로 5년간 구축할 AI 기반 기능들을 미리 체험해볼 수 있는 실험실입니다. 현재는 데모 모드로, 표시되는 수치는 예시입니다.",
    whyMatters:
      "MIDAS IT가 구조해석을 장악했듯, ARIA는 절삭가공 분야에서 AI 네이티브 플랫폼이 되는 것을 목표로 합니다. 이 탭에서 그 비전을 미리 확인할 수 있습니다.",
    howComputed:
      "7개 섹션으로 구성: ML 예측, 불확실성 분석, 센서 이상탐지, 개인화, 인과추론, DOE, 생존분석. 각각 실제 프로덕션화될 때의 UI/UX를 정확히 구현했습니다.",
    productionReqs: {
      dataNeeded:
        "YG-1 SpeedLab 가공 로그 10,000+ 건, 현장 센서 데이터 6개월+, 공구 파손 레코드 1,000+ 건",
      modelType: "섹션별 상이 (XGBoost, Bayesian NN, Isolation Forest, Contextual Bandit 등)",
      infra: "Azure ML + MLflow + Kafka (센서 스트림) + Grafana (모니터링)",
      accuracy: "섹션별 MAPE 10~20% 목표",
      timeline: "Phase 1 (6개월) → Phase 2 (1년) → Phase 3 (2년)",
    },
    level: "beginner",
  },

  // ───────── 섹션 1: ML 공구 수명 예측 ─────────
  "ml-tool-life-prediction": {
    title: "ML 공구 수명 예측",
    whatIsIt:
      "Sandvik 공식이 주는 평균값을 공장별 과거 데이터로 보정해서 더 정확한 공구 수명을 예측합니다. 예: 공식 60분 → 우리 공장 실측 보정 58.3분.",
    whyMatters:
      "공구 교체 타이밍이 너무 빠르면 낭비, 너무 늦으면 파손. ML 보정으로 교체 주기를 최적화하면 연간 수천만원 절감 가능합니다.",
    howComputed:
      "XGBoost 회귀 모델. 입력 12개 피처 (공구·재질·조건·기계·환경) → 출력 보정 배수 (0.85 ~ 1.15). SHAP 값으로 각 피처의 기여도 계산.",
    productionReqs: {
      dataNeeded: "가공 로그 10,000+ 건 (조건 + 실제 측정 수명)",
      modelType: "XGBoost 또는 LightGBM (gradient boosted trees)",
      infra: "Python 추론 서버 · CPU 4 cores · RAM 8GB · 모델 크기 <500MB",
      accuracy: "MAPE 15% 이하 목표 (현재 Sandvik 공식은 MAPE 25~30%)",
      timeline: "데이터 수집 3개월 + 모델 개발 2개월 + 배포 1개월",
    },
    relatedFeatures: ["feature-importance", "shap-values", "model-confidence"],
    level: "intermediate",
  },
  "feature-importance": {
    title: "Feature Importance (피처 중요도)",
    whatIsIt:
      "ML 모델이 예측을 할 때 어느 입력 변수를 얼마나 중요하게 여겼는지 보여줍니다. 예: 쿨런트 종류가 32% 기여, TIR이 24% 기여.",
    whyMatters:
      "'AI가 왜 이렇게 예측했는지' 이해할 수 있어야 엔지니어가 신뢰하고 사용합니다. 단순 블랙박스 AI는 B2B에서 채택되지 않습니다.",
    howComputed:
      "SHAP (SHapley Additive exPlanations) 값 또는 gradient-boosted trees의 내장 feature_importance_. 각 피처가 예측에 기여한 절댓값의 평균.",
    productionReqs: {
      dataNeeded: "훈련 데이터 전체 (모델과 함께 저장)",
      modelType: "SHAP 라이브러리 (XGBoost 호환)",
      infra: "추가 계산 비용 ~10% 증가 (TreeExplainer 사용 시)",
      accuracy: "값 자체는 정확 (해석은 도메인 전문가 검증 필요)",
      timeline: "모델 개발과 동시 (+1주)",
    },
    level: "intermediate",
  },
  "shap-values": {
    title: "SHAP 값",
    whatIsIt:
      "각 피처가 이 특정 예측을 '몇 분' 늘리거나 줄였는지 정량화. 예: TIR 20μm → 수명 -4.3분, 쿨런트 Through → +6.1분.",
    whyMatters:
      "개별 예측을 분해해서 보여주므로, '왜 이 수치가 나왔는지' 수치 단위로 설명 가능. 규제 대응에 필수.",
    howComputed:
      "게임이론의 Shapley value를 ML 예측에 적용. TreeExplainer(XGBoost) 또는 DeepExplainer(NN).",
    level: "expert",
  },
  "model-confidence": {
    title: "Model Confidence (모델 신뢰도)",
    whatIsIt:
      "이 예측이 얼마나 믿을 만한지를 나타내는 지표 (0~100%). 과거 유사한 조건의 데이터가 많으면 높고, 완전 새로운 조건이면 낮습니다.",
    whyMatters:
      "신뢰도 낮은 예측은 경고 표시하여 엔지니어가 추가 검증하도록 유도. 잘못된 예측을 '확신 있게' 내놓는 것보다 '불확실합니다'가 안전.",
    howComputed:
      "훈련 데이터 분포에서 입력 샘플의 거리 (isolation forest 기반) + 앙상블 예측 분산.",
    productionReqs: {
      dataNeeded: "훈련 시점 데이터 분포 스냅샷",
      modelType: "Isolation Forest + Monte Carlo Dropout 앙상블",
      infra: "기존 인프라 재활용",
      accuracy: "정성적 지표 (사용자 실험으로 calibration)",
      timeline: "+2주",
    },
    level: "intermediate",
  },

  // ───────── 섹션 2: 베이지안 불확실성 ─────────
  "bayesian-uncertainty": {
    title: "베이지안 불확실성 분석",
    whatIsIt:
      "단일 예측값 대신 신뢰구간을 제공합니다. 예: 공구 수명 60분 → '45~75분 사이 (95% 확률)'. 범위가 좁으면 확신, 넓으면 불확실.",
    whyMatters:
      "의료 AI에서 표준. 제조 AI에서도 필수. '60분'이라고 했다가 40분에 파손되면 고객 불신. '45~75분'으로 알려주면 하한 이탈로 납득.",
    howComputed:
      "Gaussian Process Regression 또는 Bayesian Neural Network. 각 예측에 대해 사후 분포의 평균과 분산 출력.",
    productionReqs: {
      dataNeeded: "ML 예측과 동일 (10,000+ 가공 로그)",
      modelType: "GP Regression 또는 MC Dropout BNN",
      infra: "GP: 메모리 집약적 (N² scaling), 10k 데이터까지 OK. BNN: GPU 권장",
      accuracy: "Coverage probability 95% ± 2%",
      timeline: "+1개월",
    },
    relatedFeatures: ["ml-tool-life-prediction", "model-confidence", "monte-carlo"],
    level: "expert",
  },
  "confidence-interval": {
    title: "95% 신뢰구간",
    whatIsIt:
      "이 범위 안에 진짜 값이 있을 확률이 95%라는 뜻입니다. 예: '45~75분' = 100번 중 95번은 이 사이에 있습니다.",
    whyMatters:
      "의사결정의 근거. 하한(45분)을 기준으로 공구 교체 주기를 잡으면 안전. 상한(75분)까지 사용하면 생산성 최대.",
    howComputed: "Posterior distribution에서 2.5% ~ 97.5% quantile을 잘라냅니다.",
    level: "intermediate",
  },
  "monte-carlo": {
    title: "Monte Carlo 샘플링",
    whatIsIt:
      "확률 분포를 수많은 샘플로 근사하는 방법. 예: 1000번 예측을 뽑아서 평균·분산을 계산하면 실제 분포에 가까워집니다.",
    whyMatters:
      "해석적으로 풀기 어려운 베이지안 추론을 '시뮬레이션'으로 대체. 딥러닝에서 MC Dropout이 대표적.",
    howComputed:
      "각 inference 시 dropout을 유지한 채 N번 forward pass. N개 예측의 평균·분산이 posterior 근사.",
    level: "expert",
  },

  // ───────── 섹션 3: 센서 이상탐지 ─────────
  "sensor-anomaly-detection": {
    title: "실시간 센서 이상탐지",
    whatIsIt:
      "공작기계의 스핀들 부하·진동·온도 센서 데이터를 실시간 분석해서 공구 파손·채터·품질 불량을 가공 중에 경고합니다.",
    whyMatters:
      "공구 파손 전 30초~3분 전에 예측 가능 → 비상 정지 → 가공물·공구·기계 모두 보호. 연간 수억원 손실 방지.",
    howComputed:
      "1D-CNN + LSTM으로 시계열 패턴 학습. Isolation Forest로 실시간 이상 스코어링. Autoencoder 재구성 오차로 미세 이상 감지.",
    productionReqs: {
      dataNeeded:
        "시계열 센서 데이터 (10Hz+ 샘플링, 6개월+, 파손 레이블 포함)",
      modelType: "1D-CNN-LSTM + Isolation Forest + Autoencoder 앙상블",
      infra: "Edge inference (NVIDIA Jetson급) + Kafka + TimescaleDB",
      accuracy: "Precision 90%+, Recall 85%+ (오경보 최소화 중요)",
      timeline: "센서 설치 2개월 + 데이터 수집 6개월 + 모델 개발 3개월 = 총 11개월",
    },
    relatedFeatures: ["remaining-useful-life", "chatter-detection"],
    level: "expert",
  },
  "remaining-useful-life": {
    title: "RUL (Remaining Useful Life · 남은 수명)",
    whatIsIt:
      "현재 공구가 앞으로 몇 분 더 사용 가능한지 실시간 추정. 예: '현재 공구 RUL 23분'.",
    whyMatters:
      "가공 도중 공구 교체 시점을 정확히 알 수 있어 예정된 교체보다 낭비 없고 파손보다 안전.",
    howComputed:
      "시계열 센서 데이터 + 과거 파손 패턴 학습. LSTM이 '건강 지표'를 출력하고 임계값 대비 감소 속도로 RUL 계산.",
    productionReqs: {
      dataNeeded:
        "Run-to-failure 데이터 1,000+ 건 (공구가 완전 파손될 때까지의 전체 시계열)",
      modelType: "LSTM + Survival Analysis hybrid",
      infra: "실시간 추론 서버 + 상태 저장 (stateful)",
      accuracy: "RMSE 5분 이내",
      timeline: "run-to-failure 데이터 수집이 가장 어려움 (실험실 환경 6개월)",
    },
    level: "expert",
  },
  "chatter-detection": {
    title: "실시간 채터 감지",
    whatIsIt:
      "가공 중 '끼익' 진동(chatter)이 발생하면 자동 감지해서 경고. 심하면 CNC에 자동 감속 명령.",
    whyMatters:
      "채터는 표면 품질 불량의 주원인. 사람이 소리로 판단하는 것을 자동화 → 야간 무인 가공 가능.",
    howComputed:
      "진동 센서 FFT → 채터 주파수 대역(200Hz~2kHz) 에너지 추적. 안정성 로브 다이어그램 실시간 생성.",
    productionReqs: {
      dataNeeded: "가속도계 데이터 (1kHz+ 샘플링), 채터/정상 레이블",
      modelType: "Spectral feature + Random Forest or CNN",
      infra: "DSP 기능 있는 edge device",
      accuracy: "F1 score 0.9+",
      timeline: "3~6개월",
    },
    level: "expert",
  },

  // ───────── 섹션 4: 공장 개인화 ─────────
  "factory-personalization": {
    title: "공장 맞춤 개인화 추천",
    whatIsIt:
      "각 공장의 과거 선택·피드백·결과를 학습해서 그 공장에 최적화된 조건을 추천합니다. 예: 'A공장은 보수적이니 SFM -5% 추천'.",
    whyMatters:
      "동일 공구·재질이라도 공장마다 선호가 다름. 일반 추천보다 개인화 추천의 채택률이 3배+ 높음 (Netflix, Amazon 학습).",
    howComputed:
      "Contextual Bandit (LinUCB, Thompson Sampling) 또는 Collaborative Filtering + Content-Based 하이브리드.",
    productionReqs: {
      dataNeeded:
        "공장별 사용자 interaction log (추천·채택·피드백) 최소 1,000건/공장",
      modelType: "Contextual Bandit (초기) → Deep RL (후기)",
      infra: "실시간 온라인 학습 (Redis + Kafka), 공장별 모델 저장소",
      accuracy: "추천 채택률 Baseline 대비 +50%",
      timeline: "Cold-start 해결 3개월 + 개인화 학습 6개월",
    },
    relatedFeatures: ["cold-start", "reinforcement-learning"],
    level: "expert",
  },
  "cold-start": {
    title: "Cold-Start 문제",
    whatIsIt:
      "신규 공장은 데이터가 없어서 개인화 추천 불가. 이를 해결하는 전략이 필요합니다.",
    whyMatters:
      "대부분 공장은 ARIA 도입 첫 달에 데이터가 거의 없음. 그 동안에도 양질의 추천을 해야 이탈 방지.",
    howComputed:
      "Transfer learning (유사 공장 모델 재사용) + 메타 러닝 + 초기 탐색 전략 (ε-greedy exploration).",
    level: "expert",
  },
  "reinforcement-learning": {
    title: "강화학습 (Reinforcement Learning)",
    whatIsIt:
      "추천·피드백을 주고받으며 점점 좋아지는 AI. 게임 AI (AlphaGo)와 같은 원리.",
    whyMatters:
      "정답이 없는 문제(어떤 조건이 최적?)에 가장 적합. 각 공장 고유 최적점을 자동 발견.",
    howComputed:
      "Reward = 수명+생산성+품질 가중합. PPO 또는 SAC 알고리즘. 시뮬레이터에서 사전 학습 후 실전 fine-tune.",
    level: "expert",
  },

  // ───────── 섹션 5: 인과추론 xAI ─────────
  "causal-xai": {
    title: "인과추론 & xAI 설명",
    whatIsIt:
      "AI가 왜 이렇게 예측했는지 인과관계로 설명합니다. '상관관계'가 아닌 '원인→결과'. 예: '쿨런트 농도가 원인이 되어 공구 수명이 감소'.",
    whyMatters:
      "B2B 의사결정은 설명 책임이 필수. 규제 (EU AI Act, 한국 AI 기본법)에서 설명 가능성 의무화 추세. 지금부터 준비해야 경쟁력.",
    howComputed:
      "SHAP (피처 기여도) + DoWhy (인과 그래프) + LLM (자연어 생성). 여기서 LLM은 실제 Anthropic API 호출.",
    productionReqs: {
      dataNeeded: "도메인 전문가가 정의한 인과 그래프 (DAG)",
      modelType: "SHAP + DoWhy + Claude API",
      infra: "기존 ML 인프라 + Anthropic API (API 키 관리, rate limit)",
      accuracy: "정성적 (도메인 전문가 A/B 평가)",
      timeline: "인과 그래프 수립 2개월 + 통합 1개월",
    },
    relatedFeatures: ["shap-values", "counterfactual-reasoning"],
    level: "expert",
  },
  "counterfactual-reasoning": {
    title: "반사실 추론 (Counterfactual)",
    whatIsIt:
      "'만약 ~했다면 어떻게 됐을까?'를 계산합니다. 예: '쿨런트가 정상이었다면 공구 수명이 82분이었을 것'.",
    whyMatters:
      "단순 '상관관계'를 넘어 진짜 '원인'을 찾는 방법. 개선 포인트를 정확히 지목 가능.",
    howComputed:
      "인과 그래프에서 do-operator 적용. 실제 관찰값과 반사실 시뮬레이션의 차이 계산.",
    level: "expert",
  },

  // ───────── 섹션 6: DOE ─────────
  "doe-design": {
    title: "DOE 실험 설계 (Design of Experiments)",
    whatIsIt:
      "어떤 조건이 최적인지 찾기 위한 실험을 자동으로 계획합니다. 예: '3가지 변수 × 3수준을 9번 실험으로 최적점 찾기' (Taguchi L9).",
    whyMatters:
      "무작정 실험하면 수백 번 필요. DOE 쓰면 9~27번으로 충분. 실험 비용·시간 80% 절감.",
    howComputed:
      "Taguchi orthogonal array, Fractional Factorial, Response Surface Methodology. 통계적 실험 계획법.",
    productionReqs: {
      dataNeeded: "실험 결과 입력 (사용자가 실제 실험 후 입력)",
      modelType: "통계 패키지 (scipy.stats, pyDOE2)",
      infra: "기존 서버 재활용",
      accuracy: "실험 1회차 후 최적점 예측 오차 10% 이내",
      timeline: "1~2개월",
    },
    relatedFeatures: ["taguchi-method", "response-surface"],
    level: "intermediate",
  },
  "taguchi-method": {
    title: "Taguchi 방법",
    whatIsIt: "일본의 타구치 박사가 개발한 실험설계법. 변수가 3개면 27번 실험 대신 9번으로 충분.",
    whyMatters: "현장 실험 비용이 엄청남. Taguchi로 최소 실험으로 최적점 찾기.",
    howComputed: "Orthogonal array로 실험 조합 생성 → S/N 비로 최적 수준 결정.",
    level: "intermediate",
  },
  "response-surface": {
    title: "Response Surface Methodology",
    whatIsIt:
      "실험 결과를 다차원 곡면으로 피팅해서 '언덕의 정상(최적점)'을 찾는 방법.",
    whyMatters: "Taguchi가 '어느 수준이 좋은지' 찾아준 후 RSM이 '정확한 최적값' 추출.",
    howComputed: "2차 다항식 회귀 → 편미분 0 지점 = 최적점.",
    level: "expert",
  },

  // ───────── 섹션 7: 생존분석 ─────────
  "survival-analysis": {
    title: "생존분석 (Survival Analysis)",
    whatIsIt:
      "공구가 시간에 따라 '살아있을 확률'을 곡선으로 보여줍니다. 의료에서 환자 생존률을 보는 것과 똑같은 방법.",
    whyMatters:
      "'평균 수명 60분'보다 '60분 시점 생존률 85%, 90분 시점 50%'가 훨씬 유용. 조기 파손과 마모 파손을 구분 가능.",
    howComputed:
      "Kaplan-Meier 곡선 (비모수) + Cox Proportional Hazards (각 조건의 hazard ratio) + Weibull 분포 피팅.",
    productionReqs: {
      dataNeeded: "Event data (공구 교체 또는 파손 시점), censoring 플래그",
      modelType: "Lifelines 라이브러리 (Python)",
      infra: "기존 인프라 재활용",
      accuracy: "Concordance index 0.75+",
      timeline: "1개월 (데이터 있으면)",
    },
    relatedFeatures: ["kaplan-meier", "cox-regression", "weibull"],
    level: "expert",
  },
  "kaplan-meier": {
    title: "Kaplan-Meier 곡선",
    whatIsIt:
      "시간 경과에 따른 생존 확률을 보여주는 곡선. 계단 형태로 '각 교체/파손 이벤트에서 확률이 떨어짐'.",
    whyMatters: "의학 연구의 표준. 제조에도 그대로 적용 가능. 통계적으로 검증된 방법.",
    howComputed: "S(t) = ∏ (1 - d_i / n_i). 각 시점에서 파손 수 / 위험 노출 수.",
    level: "expert",
  },
  "cox-regression": {
    title: "Cox Proportional Hazards",
    whatIsIt:
      "각 조건(SFM·IPT 등)이 공구 파손 위험에 얼마나 영향을 주는지 정량화. 예: 'SFM 10% 증가 → 파손 위험 1.5배'.",
    whyMatters: "어떤 조건이 수명에 진짜 영향 주는지 통계적으로 증명. 공식만으로는 알 수 없음.",
    howComputed: "h(t|x) = h₀(t) × exp(β'x). β 값이 각 조건의 log hazard ratio.",
    level: "expert",
  },
  weibull: {
    title: "Weibull 분포",
    whatIsIt:
      "공구 수명의 모양을 잡아주는 수학적 분포. 형상모수 k로 '조기 파손형', '무작위 파손형', '마모 파손형' 구분.",
    whyMatters: "k=2 = 마모 파손 (정상), k<1 = 제조 불량, k>3 = 피로 누적. 진단에 활용.",
    howComputed: "S(t) = exp(-(t/λ)^k). MLE로 k, λ 추정.",
    level: "expert",
  },

  // ───────── Machine Impact Lab ─────────
  "machine-impact-overview": {
    title: "Machine Impact Lab",
    whatIsIt:
      "공구는 고정하고 기계 설정(스핀들·홀더·쿨런트 등)을 바꾸면 결과가 어떻게 달라지는지 실시간으로 비교하는 실험실입니다.",
    whyMatters:
      "같은 공구라도 머신 세팅에 따라 생산성이 2~5배 차이. 신입 엔지니어가 머신의 중요성을 체감할 수 있는 최고의 교육 도구.",
    howComputed:
      "Sandvik 공식 + 각 머신 컴포넌트의 derate 배수 (Stickout L/D, TIR, 쿨런트 vcMul, 강성). 실시간 계산 <100ms.",
    productionReqs: {
      dataNeeded: "이미 완성 (현재 탭)",
      modelType: "결정론적 수식",
      infra: "클라이언트 사이드 JS",
      accuracy: "Sandvik 공식 수준",
      timeline: "완료됨",
    },
    level: "beginner",
  },
  "stickout-ld": {
    title: "Stickout과 L/D 비율",
    whatIsIt:
      "Stickout은 홀더에서 공구가 튀어나온 길이. L/D는 이 길이를 공구 직경으로 나눈 값입니다. L/D가 클수록 공구가 '길고 가늘다'는 뜻.",
    whyMatters: "L/D 5를 넘으면 공구가 흔들리기 시작 → 진동·표면불량·파손. 가능하면 L/D ≤ 3 유지.",
    howComputed: "Stickout 길이 ÷ 공구 직경 = L/D. ARIA는 이 비율로 SFM을 자동 감속.",
    level: "beginner",
  },
  "tir-total-indicator-runout": {
    title: "TIR (Total Indicator Runout)",
    whatIsIt:
      "공구 홀더의 진원도 오차. 공구가 완벽한 원을 그리며 회전하지 못하고 '흔들리는 정도'를 μm 단위로 측정.",
    whyMatters:
      "TIR 25μm인 Side-Lock 쓰면 공구 날 3개 중 한 개가 더 깊이 깎고 다른 건 덜 깎음 → 한 날만 과부하 → 수명 1/3 감소.",
    howComputed:
      "다이얼 게이지로 측정. Side-Lock 20~30μm, ER 콜릿 10~20μm, Shrink-fit 3~5μm.",
    level: "intermediate",
  },
  "coolant-vc-multiplier": {
    title: "쿨런트 vcMultiplier",
    whatIsIt:
      "쿨런트 종류에 따른 절삭속도 보정 배수. Flood가 기준(×1.0)이고, Through-Spindle은 ×1.15, Dry는 ×0.7.",
    whyMatters: "쿨런트 선택만 바꿔도 생산성 15%~30% 변동. 많은 공장이 이걸 간과.",
    howComputed: "Sandvik Handbook 기준 경험 계수. 재질·코팅별 미세 조정.",
    level: "intermediate",
  },
  "workholding-security": {
    title: "Workholding Security (고정 강성)",
    whatIsIt:
      "가공물이 테이블에 얼마나 단단히 고정되어 있는지. 느슨하면 전체 시스템에 진동 전파.",
    whyMatters:
      "얇은 판·복잡한 부품은 느슨할 수밖에 없음. ARIA가 이 변수를 반영해서 SFM 자동 감속.",
    howComputed: "사용자가 0~100% 슬라이더로 입력. ARIA는 0.85 ~ 1.00 배수로 보정.",
    level: "beginner",
  },

  // ───────── Copilot / Tour ─────────
  "cutting-copilot": {
    title: "CuttingCopilot AI 어시스턴트",
    whatIsIt:
      "현재 화면의 모든 내용을 이해하고 자연어로 설명해주는 AI 챗봇. 'SFM이 뭐야?'부터 '지금 내 설정이 왜 채터 위험 HIGH야?'까지.",
    whyMatters: "신입 엔지니어가 혼자서도 ARIA를 100% 활용 가능. 교육 비용 1/10.",
    howComputed:
      "Anthropic Claude API 실제 호출. 현재 화면 state + 관련 설명 콘텐츠를 컨텍스트로 전달. SSE 스트리밍.",
    productionReqs: {
      dataNeeded: "시스템 프롬프트 DB (섹션별), ARIA 도메인 지식 RAG",
      modelType: "Claude (Anthropic API)",
      infra: "Next.js API Route + SSE 스트리밍 + API 키 관리",
      accuracy: "정성적 평가 (사용자 만족도)",
      timeline: "2주 (MVP), 2개월 (RAG 고도화)",
    },
    level: "beginner",
  },
  "tour-mode": {
    title: "투어 모드",
    whatIsIt:
      "처음 방문자를 위한 단계별 가이드. 각 기능을 스포트라이트로 강조하면서 3분 안에 전체 흐름 파악 가능.",
    whyMatters: "첫 방문자의 이탈률 최소화. 온보딩 성공 여부가 제품 채택의 70% 결정.",
    howComputed:
      "첫 방문 자동 감지 (localStorage) + 시나리오 JSON + 스포트라이트 오버레이 + 진행 상황 저장.",
    productionReqs: {
      dataNeeded: "투어 시나리오 (각 섹션당 3~5 steps)",
      modelType: "없음 (결정론적)",
      infra: "클라이언트 사이드",
      accuracy: "완주율 70%+ 목표",
      timeline: "완료됨 (이번 작업)",
    },
    level: "beginner",
  },
}

export function getByLevel(level: "beginner" | "intermediate" | "expert") {
  return Object.entries(FEATURE_EXPLANATIONS).filter(([, v]) => v.level === level)
}

export function validateRelated(): string[] {
  const missing: string[] = []
  for (const [id, content] of Object.entries(FEATURE_EXPLANATIONS)) {
    for (const ref of content.relatedFeatures || []) {
      if (!FEATURE_EXPLANATIONS[ref]) missing.push(`${id} → ${ref}`)
    }
  }
  return missing
}
