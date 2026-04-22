# YG-1 ARIA Simulator v3 — 개념 사전

> CNC 가공조건 시뮬레이터의 모든 용어·개념을 한국어로 정리한 사전
> 출처: Sandvik Coromant Handbook · Harvey Performance MAP · ASM Metals Handbook · ISO 표준 · 학술 문헌

**총 112개 entry, 3단계 난이도별 설명 (초급/중급/고급) + 공식 + 실전 예시 + 흔한 함정**

## 📚 목차

- ① 속도·이송 (Speeds & Feeds) (10 entry)
- ② 절입 깊이·치수 (Depth / Dimensions) (8 entry)
- ③ 공구 형상 (Tool Shape) (12 entry)
- ④ 재질 (Material, ISO P/M/K/N/S/H) (15 entry)
- ⑤ 코팅 (Coating) (12 entry)
- ⑥ 기계·홀더 (Machine / Holder) (10 entry)
- ⑦ 가공 공정 (Operation) (12 entry)
- ⑧ 쿨런트 (Coolant) (7 entry)
- ⑨ 결과 지표 (Result Metrics) (10 entry)
- ⑩ 가공 현상 (Phenomena) (8 entry)
- ⑪ 가공 기법 (Techniques) (8 entry)

---

## ① 속도·이송 (Speeds & Feeds)

### 절삭속도 SFM (Surface Feet per Minute)
*Surface Feet per Minute* · id: `sfm`

**초급 (Beginner)**
> 공구 날 끝이 1분 동안 재료 표면을 몇 피트(약 30cm) 스치는지 나타내는 속도. 재료마다 적정 걸음 속도가 정해져 있음.

**중급 (Intermediate)**
> 표면속도(영미식). 공구 외주가 가공물 표면을 스치는 선속도(ft/min). 재질·코팅이 결정하는 1차 절삭 변수.

**고급 (Expert)**
> SFM = π·D·RPM / 12 (D in inch). Al 6061 ~1000 SFM, 1018 탄소강 ~350 SFM, SUS304 ~300 SFM, Ti-6Al-4V ~150 SFM, Inconel 718 ~80 SFM (코팅 초경 기준). 경도·냉각·공구수명 목표에 따라 Taylor 식 V·T^n=C로 보정. 출처: Machinery's Handbook 30th ed., Sandvik Coromant Handbook Ch.2.

**공식 / Formula**

```
SFM = π·D(inch)·RPM / 12
```

**왜 중요?** SFM이 권장치 대비 너무 높으면 공구 수명 급락·열화 마모, 너무 낮으면 BUE(구성인선) 발생으로 표면조도와 치수가 깨진다.

**실전 예시.** ⌀0.5in(12.7mm) 초경 엔드밀로 1018강 가공 시 SFM 350 → RPM ≈ 2675. Al 6061이면 SFM 1000 → RPM ≈ 7640.

**⚠ 흔한 함정.** HSS 권장치(SFM)를 초경 공구에 그대로 쓰면 공구 성능의 1/3만 쓰는 셈. 공구 재질·코팅별 표를 분리해서 봐야 한다.

**관련 개념:** `rpm` · `vc` · `ipt` · `mrr`

*출처: Machinery's Handbook 30th ed. / Sandvik Coromant Handbook Ch.2*

---

### 회전수 RPM (Revolutions Per Minute)
*Revolutions Per Minute* · id: `rpm`

**초급 (Beginner)**
> 공구(또는 공작물)가 1분 동안 몇 바퀴 도는지. 선풍기 단수처럼 스핀들이 얼마나 빨리 돌고 있는지를 나타냄.

**중급 (Intermediate)**
> 스핀들 회전속도(rev/min). SFM/Vc와 공구 직경 D로부터 역산해서 설정하는 종속 변수.

**고급 (Expert)**
> RPM = 12·SFM / (π·D_inch) = 1000·Vc / (π·D_mm). 머신 스핀들 정격 RPM·토크 곡선의 한계 내에서만 유효. 고속 스핀들의 저 RPM 구간은 토크 부족으로 실질 MRR이 떨어진다. 출처: Kennametal NOVO / ASM Metals Handbook Vol.16.

**공식 / Formula**

```
RPM = 12·SFM / (π·D_inch) = 1000·Vc / (π·D_mm)
```

**왜 중요?** RPM은 직접 설정하는 값이지만 본질은 SFM(Vc)의 종속 변수다. 공구 직경을 바꾸면 같은 SFM이라도 RPM을 다시 계산해야 한다.

**실전 예시.** ⌀10mm 초경 엔드밀로 SUS304 가공 시 Vc=120 m/min → RPM ≈ 3820. ⌀6mm로 바꾸면 같은 Vc에서 RPM ≈ 6366.

**⚠ 흔한 함정.** 공구 바꾸고 RPM을 그대로 두면 작은 공구는 실제 Vc가 절반으로 떨어져 BUE가 난다.

**관련 개념:** `sfm` · `vc` · `n` · `ipm`

*출처: Kennametal NOVO Technical Guide*

---

### 날당 이송 IPT (Inches Per Tooth)
*Inches Per Tooth* · id: `ipt`

**초급 (Beginner)**
> 날 하나가 한 번 지나갈 때 공구가 앞으로 나아가는 거리(inch). 칼질 한 번에 도마 위 재료를 얼마나 미는가와 같음.

**중급 (Intermediate)**
> 날당 이송량(chip load per tooth, in/tooth). 칩 두께를 결정하는 핵심 변수.

**고급 (Expert)**
> IPT = IPM / (RPM·Z). 초경 엔드밀 기준: Al ⌀10mm 0.003~0.006in, 강 ⌀10mm 0.002~0.004in, SUS 0.0015~0.003in. RDOC&lt;D/2일 때 chip thinning 보정 필요(h_ex = IPT·2·√(RDOC/D - (RDOC/D)^2)). 출처: Harvey Performance MAP User Guide §Chip Thinning.

**공식 / Formula**

```
IPT = IPM / (RPM·Z)
```

**왜 중요?** IPT가 너무 작으면 날이 재료를 깎지 못하고 문질러서 마모(rubbing)하고, 너무 크면 날 결손(chipping). 공구수명의 가장 큰 지배 변수.

**실전 예시.** ⌀10mm 4날 엔드밀, RPM 3820, IPT 0.003in(≈0.076mm) → IPM = 3820·4·0.003 ≈ 45.8 in/min.

**⚠ 흔한 함정.** 측면 가공(RDOC ≪ D)에서 chip thinning 보정 없이 카탈로그 IPT를 그대로 쓰면 실제 칩이 너무 얇아 rubbing이 일어난다.

**관련 개념:** `ipm` · `fz` · `ipr` · `rpm`

*출처: Harvey Performance MAP User Guide*

---

### 분당 이송 IPM (Inches Per Minute)
*Inches Per Minute* · id: `ipm`

**초급 (Beginner)**
> 공구가 1분 동안 몇 inch 나아가는지. 가공 테이블이 움직이는 실제 속도. G코드 F값에 그대로 들어감.

**중급 (Intermediate)**
> 테이블 이송속도(feed rate, in/min). CAM이 포스트에서 F 워드로 출력하는 최종 값.

**고급 (Expert)**
> IPM = RPM · Z · IPT. 기계 가감속(look-ahead)·서보 대역폭·스핀들 파워의 한계로 상한이 제한됨. 고 IPM에서는 코너에서 가공기 jerk·공구 deflection이 치수 오차의 주범. 출처: Sandvik Coromant Handbook Ch.3.

**공식 / Formula**

```
IPM = RPM · Z · IPT
```

**왜 중요?** IPM은 사이클타임에 직접 비례. 단 기계 동특성 한계를 넘으면 값만 크고 실제로는 못 따라가서 코너 언더컷·진동이 난다.

**실전 예시.** ⌀10mm 4날, RPM 3820, IPT 0.003in → IPM ≈ 45.8 in/min(≈ 1164 mm/min, 즉 Vf ≈ 1164).

**⚠ 흔한 함정.** 작은 공구의 IPM을 크게 설정하고 소형 포켓에 넣으면 look-ahead가 끊겨 실이송이 설정치의 절반도 못 나온다.

**관련 개념:** `ipt` · `vf` · `rpm` · `mrr`

*출처: Sandvik Coromant Handbook Ch.3*

---

### 회전당 이송 IPR (Inches Per Revolution)
*Inches Per Revolution* · id: `ipr`

**초급 (Beginner)**
> 공구가 한 바퀴 도는 동안 얼마나 앞으로 나가는지(inch). 드릴·선삭에서 주로 쓰는 이송 단위.

**중급 (Intermediate)**
> 회전당 이송량(in/rev). 드릴링·보링·선삭에서 F를 지정하는 방식. 밀링 IPT와는 Z(날수) 배만큼 차이.

**고급 (Expert)**
> IPR = IPT · Z = IPM / RPM. ⌀10mm HSS 드릴 on 1018강 IPR 0.005~0.008 in/rev. 드릴은 IPR이 칩 두께를 결정하고, 과소 시 csp(중심부) 마찰 발열·파손. 출처: Kennametal Drilling Application Guide.

**공식 / Formula**

```
IPR = IPM / RPM = IPT · Z
```

**왜 중요?** 드릴링에서 IPR이 너무 작으면 chisel edge가 재료를 문질러 드릴이 소부(burn)되고, 크면 웹(web)이 부러진다.

**실전 예시.** ⌀10mm 탄소강 드릴링, RPM 1500, IPR 0.006in → IPM = 1500·0.006 = 9 in/min(≈ 229 mm/min).

**⚠ 흔한 함정.** 밀링 IPT 감각으로 드릴 IPR을 잡으면 지나치게 작아서 드릴 날이 타버린다. 드릴은 원래 IPR이 크다.

**관련 개념:** `ipt` · `ipm` · `rpm`

*출처: Kennametal Drilling Application Guide*

---

### 날당 이송 fz (metric)
*Feed per Tooth (metric)* · id: `fz`

**초급 (Beginner)**
> IPT의 미터 버전. 날 하나가 지나갈 때 공구가 앞으로 몇 mm 나아가는지. 칩 두께를 정하는 값.

**중급 (Intermediate)**
> 날당 이송량 fz [mm/tooth]. Vf·n·z로부터 역산. ISO/메트릭 카탈로그의 표준 표기.

**고급 (Expert)**
> fz = Vf / (n·z) [mm/tooth]. ⌀10mm 초경 4날 기준: Al 0.08~0.15, 강 0.05~0.10, SUS304 0.04~0.08, Inconel 0.03~0.05. 측면 가공 시 chip thinning 보정 hex = fz·2·√(ae/D − (ae/D)^2). 출처: Sandvik Coromant Handbook Ch.3 / ISO 3002-1.

**공식 / Formula**

```
fz = Vf / (n · z)
```

**왜 중요?** fz가 권장 범위 밖이면 날이 문지르거나 결손. 공구수명 그래프의 가장 가파른 기울기를 가진 변수.

**실전 예시.** ⌀10mm 4날 엔드밀로 SUS304 슬로팅, n=3820 RPM, fz=0.05 mm/tooth → Vf = 3820·4·0.05 = 764 mm/min.

**⚠ 흔한 함정.** 얇은 측면절삭(ae=0.1D)에서 hex 보정 없이 카탈로그 fz를 그대로 입력하면 실칩이 1/3 두께라 rubbing.

**관련 개념:** `ipt` · `vc` · `vf` · `n`

*출처: Sandvik Coromant Handbook Ch.3 / ISO 3002-1*

---

### 절삭속도 Vc (metric)
*Cutting Speed (metric)* · id: `vc`

**초급 (Beginner)**
> SFM의 미터 버전. 공구 날 끝이 1분 동안 표면을 몇 m 스치는지(m/min). 재료마다 정해진 걸음 속도.

**중급 (Intermediate)**
> 절삭속도 Vc [m/min]. ISO 표기. 공구 재질·피삭재·코팅이 결정하는 1차 변수.

**고급 (Expert)**
> Vc = π·D·n / 1000 [m/min]. 초경 코팅 기준: Al 6061 ~300, 1018 ~120, SUS304 ~120, Ti-6Al-4V ~60, Inconel 718 ~30. Taylor V·T^n=C, n(초경)=0.2~0.4. 고속절삭(HSM)은 이 값을 2~5배까지 끌어올림. 출처: Sandvik Coromant Handbook Ch.2 / ASM Vol.16.

**공식 / Formula**

```
Vc = π·D·n / 1000
```

**왜 중요?** Vc가 너무 높으면 공구 날이 적열되어 수명이 지수적으로 감소(Taylor 식), 너무 낮으면 BUE·표면조도 악화.

**실전 예시.** ⌀10mm 엔드밀로 SUS304 가공 시 Vc=120 m/min → n = 1000·120 / (π·10) ≈ 3820 RPM.

**⚠ 흔한 함정.** Vc 권장치를 공구 수명 15min 기준으로 잡은 표를 60min 장시간 가공에 그대로 쓰면 수명이 급락한다.

**관련 개념:** `sfm` · `n` · `fz` · `vf`

*출처: Sandvik Coromant Handbook Ch.2 / Taylor's Tool Life Equation (1907)*

---

### 테이블 이송 Vf (metric)
*Feed Rate (metric)* · id: `vf`

**초급 (Beginner)**
> IPM의 미터 버전. 테이블이 1분 동안 몇 mm 움직이는지(mm/min). G코드 F값으로 들어가는 값.

**중급 (Intermediate)**
> 이송속도 Vf [mm/min]. CAM 포스트의 F 워드. 기계 가감속·서보 응답의 한계 안에서 유효.

**고급 (Expert)**
> Vf = fz · z · n [mm/min]. 상한은 머신 가감속(look-ahead)·스핀들 토크·공구 deflection으로 결정. 소형 공구는 deflection으로 실제 경로가 F값보다 안쪽으로 들어간다. 출처: Sandvik Coromant Handbook Ch.3.

**공식 / Formula**

```
Vf = fz · z · n
```

**왜 중요?** Vf는 사이클타임에 직선 비례하지만, 기계 동특성 한계를 넘으면 실이송이 설정치보다 작아 ROI가 떨어진다.

**실전 예시.** ⌀10mm 4날, n=3820 RPM, fz=0.05 → Vf = 3820·4·0.05 = 764 mm/min.

**⚠ 흔한 함정.** F값만 올리고 가감속·look-ahead 파라미터를 건드리지 않으면 코너에서 실제 이송이 절반 이하로 떨어진다.

**관련 개념:** `ipm` · `fz` · `n` · `mrr`

*출처: Sandvik Coromant Handbook Ch.3*

---

### 회전수 n (metric RPM)
*Spindle Speed (metric)* · id: `n`

**초급 (Beginner)**
> RPM과 똑같은 말. 미터계 카탈로그에서 쓰는 기호. 스핀들이 1분에 몇 바퀴 도는지.

**중급 (Intermediate)**
> 스핀들 회전속도 n [rev/min, min^-1]. ISO 표기. Vc와 D에서 유도되는 종속 변수.

**고급 (Expert)**
> n = 1000·Vc / (π·D) [min^-1]. 스핀들 정격 RPM·출력 곡선에 종속. 저RPM 대역은 토크는 크지만 Vc가 부족해 BUE, 고RPM 대역은 Vc는 충분하지만 토크가 부족해 MRR이 제한. 출처: ISO 3002-1.

**공식 / Formula**

```
n = 1000·Vc / (π·D)
```

**왜 중요?** 공구 직경이 바뀔 때마다 같은 Vc를 유지하려면 n을 다시 계산해야 한다. 이걸 놓치면 작은 공구가 느리게, 큰 공구가 너무 빠르게 돈다.

**실전 예시.** SUS304, Vc=120 m/min. ⌀10mm → n ≈ 3820 RPM. ⌀6mm → n ≈ 6366 RPM. ⌀20mm → n ≈ 1910 RPM.

**⚠ 흔한 함정.** 다중 공구 프로그램에서 공구별 n을 재계산하지 않고 공통 S값을 쓰면 일부 공구는 극단적 Vc에서 돈다.

**관련 개념:** `rpm` · `vc` · `vf`

*출처: ISO 3002-1 / Sandvik Coromant Handbook Ch.2*

---

### 금속제거율 MRR (Material Removal Rate)
*Material Removal Rate* · id: `mrr`

**초급 (Beginner)**
> 1분 동안 깎아낸 재료의 부피(cm³/min 또는 in³/min). 가공 생산성을 한 숫자로 나타낸 값.

**중급 (Intermediate)**
> 금속제거율 Q [cm³/min]. 밀링에서 Q = ae·ap·Vf / 1000. 스핀들 파워·공구 수명과 맞바꾸는 KPI.

**고급 (Expert)**
> Q = ae·ap·Vf / 1000 [cm³/min]. 필요 스핀들 파워 Pc = Q·kc / (60·10^3·η), kc는 비절삭력(강 2000~3000 N/mm², Al 800 N/mm²). HSM/트로코이달은 ap 크고 ae 작게 가서 동일 Q를 공구수명↑로 달성. 출처: Sandvik Coromant Handbook Ch.A / Kienzle 식.

**공식 / Formula**

```
Q = ae · ap · Vf / 1000  [cm³/min]
```

**왜 중요?** MRR은 곧 돈. 단 스핀들 파워·공구 수명과 맞바꿔야 하는 값이라, 무작정 올리면 공구가 1개 분에 1개씩 나간다.

**실전 예시.** ap=10mm, ae=2mm, Vf=800 mm/min → Q = 10·2·800 / 1000 = 16 cm³/min. SUS304 kc≈2500이면 Pc ≈ 0.67 kW.

**⚠ 흔한 함정.** MRR만 보고 파라미터를 뽑으면 공구 수명이 수십 분의 일로 떨어져 툴 교체시간 포함 실질 생산성은 오히려 감소.

**관련 개념:** `vf` · `vc` · `fz`

*출처: Sandvik Coromant Handbook Ch.A / Kienzle-Victor 비절삭력 모델*

---

## ② 절입 깊이·치수 (Depth / Dimensions)

### 축방향 절입 ADOC / ap (Axial Depth of Cut)
*Axial Depth of Cut* · id: `adoc`

**초급 (Beginner)**
> 엔드밀을 공작물에 얼마나 깊게(아래로) 꽂고 가공하는지(mm). 빵칼을 얼마나 깊이 누르는가와 같음.

**중급 (Intermediate)**
> 축방향 절입량 ap [mm]. 공구 축 방향으로 재료에 잠기는 깊이. LOC의 일부만 쓰는 것이 원칙.

**고급 (Expert)**
> ap ≤ LOC. 슬로팅 기준 일반가공 ap ≤ 1·D, HSM 트로코이달은 ap ≤ 2~3·D 가능(단 ae ≤ 0.1·D). 과대 ap는 공구 편심 deflection과 채터의 1차 원인. 출처: Harvey Performance MAP / Sandvik Coromant Handbook Ch.3.

**공식 / Formula**

```
ap = Axial Depth (mm)  ·  ap ≤ LOC
```

**왜 중요?** ap가 크면 MRR은 직선적으로 커지지만, 공구 비틀림·채터 위험은 ap²~ap³로 커진다. 트레이드오프가 가장 큰 변수.

**실전 예시.** ⌀10mm 4날 엔드밀로 SUS304 트로코이달: ap=25mm(2.5D), ae=1mm(0.1D), Vf=1500 mm/min.

**⚠ 흔한 함정.** LOC를 ap로 착각해서 공구 전체 날 길이를 꽂으면 flute 상단이 칩을 못 배출해 채터·파손.

**관련 개념:** `rdoc` · `loc` · `engagement-angle` · `axial`

*출처: Harvey Performance MAP User Guide*

---

### 경방향 절입 RDOC / ae (Radial Depth of Cut)
*Radial Depth of Cut* · id: `rdoc`

**초급 (Beginner)**
> 엔드밀이 옆으로 재료를 얼마나 넓게 베어먹고 지나가는지(mm). 공구 지름 대비 몇 %를 먹느냐로 본다.

**중급 (Intermediate)**
> 경방향 절입량 ae [mm]. Stepover라고도 함. ae/D 비율이 접촉각과 칩 두께를 결정.

**고급 (Expert)**
> ae [mm]. 슬로팅 ae=D, 일반 측면 ae=0.3~0.5·D, HSM 트로코이달 ae ≤ 0.1·D. ae&lt;D/2에서 chip thinning: hex = fz·2·√(ae/D − (ae/D)^2), fz 보정 필수. 출처: Harvey Performance MAP §Radial Chip Thinning.

**공식 / Formula**

```
ae = Radial Depth (mm)
```

**왜 중요?** ae가 작을수록 접촉각·발열이 작아 공구 수명↑, 대신 같은 MRR에 이송을 크게 올려야 해서 기계 동특성이 중요해진다.

**실전 예시.** ⌀10mm HSM: ae=1mm(10%), ap=20mm(2D), fz_보정=0.08mm → 카탈로그 fz 0.05의 1.6배까지 올려야 정상 칩 두께.

**⚠ 흔한 함정.** ae를 줄이면서 fz를 그대로 두면 실제 칩이 너무 얇아져 rubbing·경화 발생. chip thinning 보정은 필수.

**관련 개념:** `adoc` · `engagement-angle` · `radial` · `fz`

*출처: Harvey Performance MAP User Guide §Radial Chip Thinning*

---

### 절삭날 길이 LOC (Length of Cut)
*Length of Cut* · id: `loc`

**초급 (Beginner)**
> 공구 끝부터 날(플루트)이 새겨진 부분까지의 길이(mm). 이 길이 안에서만 실제로 깎을 수 있음.

**중급 (Intermediate)**
> 절삭날 유효 길이 LOC [mm]. Flute length라고도 함. ap의 상한이자 칩 배출 공간의 지표.

**고급 (Expert)**
> LOC [mm]. ap ≤ LOC가 원칙이나 실무는 ap ≤ 0.8·LOC 권장(상단 칩 충돌 방지). LOC가 길수록 강성은 급감(deflection ∝ L³), 대신 깊은 포켓 가공 가능. 출처: Kennametal NOVO / Harvey Performance Tool Selection Guide.

**공식 / Formula**

```
ap_max ≈ 0.8 · LOC
```

**왜 중요?** 긴 LOC 공구는 깊이 파지만 강성이 L^3로 떨어져 채터와 치수오차가 급증. 필요한 최소 LOC만 골라야 한다.

**실전 예시.** ⌀10mm · LOC 30mm 스터브 vs LOC 50mm 롱넥. 같은 조건에서 롱넥은 deflection이 약 4.6배 크다.

**⚠ 흔한 함정.** 가공 깊이보다 훨씬 긴 LOC 공구를 선택해 강성을 불필요하게 낭비하는 케이스가 가장 흔하다.

**관련 개념:** `adoc` · `oal` · `stick-out`

*출처: Kennametal NOVO Technical Guide*

---

### 공구 전장 OAL (Overall Length)
*Overall Length* · id: `oal`

**초급 (Beginner)**
> 공구 맨 끝부터 섕크 끝까지의 전체 길이(mm). 공구 한 자루의 총 길이.

**중급 (Intermediate)**
> 전장 OAL [mm]. 홀더에 물리는 구간과 돌출 구간 모두 포함. Stick-out(LSO) = OAL − 섕크 파지 길이.

**고급 (Expert)**
> OAL [mm]. 공구 강성은 LSO(돌출)로 결정되며 deflection ∝ LSO³. 같은 OAL이라도 홀더 파지 깊이를 최대화(섕크 길이의 3D 이상 파지)하면 강성 대폭 상승. 출처: Sandvik Coromant Holder Handbook.

**공식 / Formula**

```
LSO = OAL − 홀더 파지 길이
```

**왜 중요?** OAL 자체보다 stick-out이 강성의 본질. 같은 OAL도 얕게 파지하면 공구가 한참 더 흔들린다.

**실전 예시.** ⌀10mm 엔드밀 OAL 75mm. 섕크 25mm 파지 시 LSO=50mm, 섕크 35mm 파지 시 LSO=40mm → deflection 약 2배 차이.

**⚠ 흔한 함정.** 깊은 포켓 때문에 OAL 긴 공구를 쓰면서 홀더 파지 길이를 늘리지 않아 과도한 채터가 나는 경우.

**관련 개념:** `loc` · `stick-out` · `shank`

*출처: Sandvik Coromant Holder & Adaptive Tooling Handbook*

---

### 접촉각 (Engagement Angle)
*Radial Engagement Angle* · id: `engagement-angle`

**초급 (Beginner)**
> 공구 날 하나가 공작물을 지나가는 동안 재료와 맞닿는 각도(도). 슬로팅은 180°, 얇게 치면 작아짐.

**중급 (Intermediate)**
> 경방향 접촉각 φ [deg]. ae/D에 의해 결정. 발열·절삭력·칩 두께 프로필을 지배.

**고급 (Expert)**
> φ = arccos(1 − 2·ae/D) [rad] · 180/π. 슬로팅 ae=D → 180°, ae=0.5D → 120°, ae=0.1D → 53°. HSM/트로코이달은 φ ≤ 60° 유지가 원칙(발열·공구수명 최적점). 출처: Harvey Performance MAP §Dynamic Milling.

**공식 / Formula**

```
φ = arccos(1 − 2·ae/D)
```

**왜 중요?** 접촉각이 크면 한 날이 재료에 오래 잠겨 열 부하↑·공구수명↓. HSM의 핵심 원리는 이 각을 작게 유지하는 것.

**실전 예시.** ⌀10mm, ae=1mm → φ ≈ 53°. ae=3mm → φ ≈ 93°. ae=5mm → φ = 180°(슬로팅).

**⚠ 흔한 함정.** CAM에서 stepover(ae)만 보고 접촉각을 고려하지 않으면 코너에서 실제 접촉각이 급격히 커져 공구가 깨진다.

**관련 개념:** `rdoc` · `radial` · `adoc`

*출처: Harvey Performance MAP User Guide §Dynamic Milling*

---

### 축방향 (Axial Direction)
*Axial Direction* · id: `axial`

**초급 (Beginner)**
> 공구 회전축 방향(보통 Z축, 위아래). 엔드밀에서 '깊이' 방향을 말함.

**중급 (Intermediate)**
> 공구 회전축과 평행한 방향. 밀링에서 ap(ADOC)가 이 방향의 절입. 드릴링의 이송 방향도 축방향.

**고급 (Expert)**
> Axial direction. 3축 밀링 스탠다드 좌표에서 일반적으로 −Z. 축방향 절삭력 Fz는 공구 당김(pulling)이나 밀어냄(pushing)을 유발하며 helix angle과 up/down cut에 의해 부호가 바뀜. 출처: ISO 841 / Sandvik Coromant Handbook Ch.A.

**공식 / Formula**

```
— (방향 정의)
```

**왜 중요?** 축방향 절삭력의 부호(up/down)가 클램핑 방식과 맞지 않으면 공작물이 들려 정밀도가 무너진다.

**실전 예시.** ⌀10mm 30° helix 엔드밀 다운컷: Fz가 아래로 작용해 공작물을 테이블에 눌러줌 → 얇은 판재 가공에 유리.

**⚠ 흔한 함정.** 헬릭스 방향과 up/down cut을 고려 안 하면 축방향 힘이 공작물을 들어올려 바이스에서 빠진다.

**관련 개념:** `adoc` · `radial` · `loc`

*출처: ISO 841 Machine Tool Axis Convention*

---

### 경방향 (Radial Direction)
*Radial Direction* · id: `radial`

**초급 (Beginner)**
> 공구 회전축과 직각 방향(옆 방향). 엔드밀이 옆으로 얼마나 먹는지를 이 방향으로 잰다.

**중급 (Intermediate)**
> 공구 회전축에 수직인 방향. ae(RDOC)가 이 방향 절입. 측면 가공에서 주로 논의되는 축.

**고급 (Expert)**
> Radial direction. 경방향 절삭력 Fr은 공구를 공작물에서 밀어내려 함 → deflection의 주원인. 측면 가공에서 다운컷은 Fr이 벽쪽으로, 업컷은 공구 쪽으로 작용해 표면조도·치수에 반대 효과. 출처: ASM Metals Handbook Vol.16.

**공식 / Formula**

```
— (방향 정의)
```

**왜 중요?** 경방향 deflection은 벽면 치수 오차(예: 10mm 폭이 9.95mm)의 1차 원인. 공구 강성·ae 선택이 중요.

**실전 예시.** ⌀10mm LSO=40mm 엔드밀, ae=5mm(슬롯 절반)에서 경방향 deflection 약 20~40μm 발생 가능.

**⚠ 흔한 함정.** 경방향 deflection을 감안하지 않고 한 번에 마무리 패스를 하면 벽이 테이퍼지거나 치수가 덜 나온다. 마무리 패스는 ae를 작게.

**관련 개념:** `rdoc` · `axial` · `engagement-angle`

*출처: ASM Metals Handbook Vol.16 Machining*

---

### 공구 돌출 Stick-out (LSO)
*Tool Stick-out (Overhang)* · id: `stick-out`

**초급 (Beginner)**
> 홀더에서 공구가 얼마나 바깥으로 튀어나와 있는지(mm). 길게 튀어나올수록 흔들리기 쉬움.

**중급 (Intermediate)**
> Stick-out, Overhang LSO [mm]. 홀더 끝에서 공구 팁까지의 길이. 공구 유효 강성의 1차 지표.

**고급 (Expert)**
> LSO [mm]. 공구 끝 변형 δ ∝ F·LSO³ / (E·I), I = π·D^4/64. LSO 4D 초과 시 deflection·채터 급증, 6D 이상은 HSM/트로코이달 전용 파라미터 필수. 출처: Kennametal NOVO Technical / Altintas, Manufacturing Automation (2012).

**공식 / Formula**

```
δ ∝ LSO³ / D⁴  (deflection)
```

**왜 중요?** LSO가 2배면 deflection은 8배. 공구 선정의 1순위는 '가공 깊이 + 여유'로 LSO를 최소화하는 것.

**실전 예시.** ⌀10mm, LSO 30mm(3D)에서 deflection 10μm이면 LSO 60mm(6D)에서는 80μm.

**⚠ 흔한 함정.** 넥이 가는 long-reach 공구(reduced neck)를 일반 ap로 쓰면 LSO³ 효과로 치수가 전혀 안 맞음. 필요한 reach 이상은 절대 쓰지 말 것.

**관련 개념:** `oal` · `loc` · `axial`

*출처: Altintas, Manufacturing Automation, Cambridge Univ. Press (2012)*

---

## ③ 공구 형상 (Tool Shape)

### 스퀘어 엔드밀 (Square Endmill / Flat Endmill)
*Square (Flat) Endmill* · id: `square-endmill`

**초급 (Beginner)**
> 끝이 평평한(직각) 엔드밀. 바닥이 평면인 홈이나 단(shoulder)을 깎을 때 쓰는 가장 기본 공구.

**중급 (Intermediate)**
> 플랫 엔드밀. 바닥 평면·직각 숄더·슬롯 가공용 표준 공구. 코너는 날카로워 응력집중이 큼.

**고급 (Expert)**
> Square endmill, corner radius ≈ 0. 유효 직경 D_eff = D(절입 깊이 무관). 직각 코너로 인한 응력집중으로 코너 치핑이 최빈 고장모드, 경가공·내열합금에는 corner-radius 공구가 권장됨. 출처: Sandvik Coromant Handbook Ch.3 / Harvey Performance Catalog.

**공식 / Formula**

```
D_eff = D
```

**왜 중요?** 바닥 평면·직각 어깨를 만드는 유일한 표준 공구. 하지만 코너가 약해 고부하 가공에서는 코너R 공구로 교체해야 한다.

**실전 예시.** ⌀10mm 4날 스퀘어로 Al 6061 슬롯 ap=10mm, ae=10mm(슬로팅), Vc=300 m/min, fz=0.08mm.

**⚠ 흔한 함정.** 경질 재료(SUS·Inconel)에서 스퀘어로 숄더링하면 코너가 2~3패스 만에 치핑. 이런 경우 corner-radius 0.5mm를 선택.

**관련 개념:** `corner-radius` · `ball-nose` · `flutes` · `cutter-diameter`

*출처: Harvey Performance Endmill Catalog*

---

### 볼노즈 엔드밀 (Ball Nose)
*Ball Nose Endmill* · id: `ball-nose`

**초급 (Beginner)**
> 끝이 동그란(반구) 엔드밀. 곡면·금형처럼 둥근 표면을 깎을 때 쓰는 공구.

**중급 (Intermediate)**
> 볼엔드밀, R = D/2. 3D 곡면·금형 마무리·컨투어링에 사용. 중심부(팁)는 절삭속도가 0이라 절삭이 어려움.

**고급 (Expert)**
> Ball nose endmill. 유효 직경 D_eff = 2·√(D·ap − ap²) (ap ≤ R). 팁 중심 Vc=0이라 정삭 시 경사면 가공(축 기울임)으로 D_eff를 키워 Vc 확보 필수. scallop height h = ae²/(8·R). 출처: Sandvik Coromant Die & Mould Application Guide.

**공식 / Formula**

```
D_eff = 2·√(D·ap − ap²),  scallop h = ae²/(8R)
```

**왜 중요?** 곡면 가공 표준이지만 팁 중심 Vc=0이 치명적. 수직 가공 시 팁이 문지르기만 하고 안 깎여 공구가 망가진다.

**실전 예시.** ⌀10mm 볼로 금형 마무리 ap=0.5mm → D_eff = 2·√(10·0.5 − 0.25) ≈ 4.36mm. Vc 설정은 이 값 기준.

**⚠ 흔한 함정.** 수직 컨투어링(축 기울기 0°)에서 카탈로그 Vc 그대로 쓰면 실 Vc는 0 근방. 경사 가공이나 tilt 5°~15° 필수.

**관련 개념:** `d-eff` · `corner-radius` · `square-endmill`

*출처: Sandvik Coromant Die & Mould Application Guide*

---

### 코너 R 엔드밀 (Corner Radius / Bull Nose)
*Corner Radius Endmill* · id: `corner-radius`

**초급 (Beginner)**
> 끝 모서리에만 작은 동그라미(R)가 있는 엔드밀. 스퀘어와 볼노즈의 중간 형태.

**중급 (Intermediate)**
> Corner radius endmill (Bull nose). 코너에 R 0.2~2mm가 있어 응력집중 감소, 공구수명·표면조도에 유리.

**고급 (Expert)**
> Corner radius Rc [mm], 일반적으로 0.1D ~ 0.3D. 코너 응력을 분산시켜 공구수명 1.5~3배 증가(대비 스퀘어). 바닥면에 R 자국이 남으므로 완전 직각 숄더가 필요하면 부적합. 출처: Kennametal NOVO / Harvey Performance MAP.

**공식 / Formula**

```
Rc ≈ 0.1·D ~ 0.3·D (권장)
```

**왜 중요?** 경질 재료 고부하 가공에서 공구 수명의 핵심. 스퀘어 → 코너R로 바꾸는 것만으로 수명이 2배 이상 느는 경우가 많다.

**실전 예시.** ⌀10mm · Rc=1mm 엔드밀로 SUS304 shouldering: ap=10mm, ae=3mm, fz=0.06mm, 수명 스퀘어 대비 약 2.2배.

**⚠ 흔한 함정.** 바닥 완전 직각이 필요한 도면에 코너R 공구를 써 바닥 R 자국이 남아 검사 탈락.

**관련 개념:** `square-endmill` · `ball-nose` · `edge-hone`

*출처: Harvey Performance MAP / Kennametal NOVO*

---

### 챔퍼 공구 (Chamfer Mill / 모따기)
*Chamfer Mill* · id: `chamfer-tool`

**초급 (Beginner)**
> 모서리를 비스듬히 깎는(모따기) 공구. 날 끝이 원뿔처럼 생긴 엔드밀.

**중급 (Intermediate)**
> Chamfer mill. 일반 각도 45°·60°·82° 등. 모따기·디버링(deburring)·스팟 가공에 사용.

**고급 (Expert)**
> Chamfer mill with included angle 2α (흔히 90°, 즉 α=45°). 절입 깊이 z에서 유효 직경 D_eff = D_tip + 2·z·tan(α). Vc 설정은 D_eff 기준, 깊이에 따라 실질 Vc가 변하는 것이 함정. 출처: Harvey Performance Chamfer Mill Application Guide.

**공식 / Formula**

```
D_eff(z) = D_tip + 2·z·tan(α)
```

**왜 중요?** 깊이에 따라 유효 직경이 달라져서 동일 RPM에서도 Vc가 2~3배 변한다. 조건 설정 실수가 가장 많은 공구.

**실전 예시.** 45° 챔퍼 D_tip=2mm, 0.5mm 모따기 → D_eff = 2 + 2·0.5·1 = 3mm. 1mm 모따기 → D_eff = 4mm.

**⚠ 흔한 함정.** D_tip으로 RPM 계산 후 큰 모따기를 주면 실 Vc가 2배로 뛰어 공구 소부. D_eff 기준으로 다시 계산해야 함.

**관련 개념:** `d-eff` · `square-endmill` · `cutter-diameter`

*출처: Harvey Performance Chamfer Mill Application Guide*

---

### 플루트 / 절삭날 수 (Flutes, Z)
*Flutes (Number of Teeth, Z)* · id: `flutes`

**초급 (Beginner)**
> 엔드밀 몸통에 파인 나선홈(=절삭날)의 개수. 2날, 3날, 4날, 6날 등이 있음.

**중급 (Intermediate)**
> 플루트 수 Z. 날수↑면 Vf↑ 가능하지만 칩 배출 공간↓. 재질·가공모드에 따라 선택.

**고급 (Expert)**
> Z [-]. Vf = fz·Z·n이므로 날수↑는 Vf↑·MRR↑. 그러나 flute 단면적↓ → 칩 배출 저하. 권장: Al Z=2~3(큰 칩 공간), 강 Z=4, SUS/Inconel Z=5~7(안정·고이송), 고경도강(HRC&gt;50) Z=6~9. 출처: Sandvik Coromant Handbook Ch.3.

**공식 / Formula**

```
Vf = fz · Z · n
```

**왜 중요?** 같은 fz라도 Z를 늘리면 이송이 비례 증가. 단 알루미늄 같은 긴 칩 재료는 Z↑ 시 칩이 막혀 공구가 깨진다.

**실전 예시.** ⌀10mm SUS304 측면: Z=4 → Vf=764, Z=6 → Vf=1146 mm/min(같은 fz=0.05).

**⚠ 흔한 함정.** Al에 6날 엔드밀을 쓰면 flute 공간 부족으로 칩 재절삭(recutting) 발생 → 공구·표면 다 망가짐.

**관련 개념:** `variable-helix` · `ipt` · `fz` · `vf`

*출처: Sandvik Coromant Handbook Ch.3*

---

### Variable Helix / 불균일 나선
*Variable Helix / Variable Pitch Endmill* · id: `variable-helix`

**초급 (Beginner)**
> 날마다 나선 각도나 간격이 살짝 다른 엔드밀. 진동(채터)을 깨뜨려 더 조용하고 오래 가는 공구.

**중급 (Intermediate)**
> Variable helix / variable pitch. 날 간격이나 helix angle이 불균일(예: 35°/37°/38°/36°)해서 규칙적 진동 주파수를 분산.

**고급 (Expert)**
> Variable helix·variable pitch. 규칙 피치는 toothpassing frequency ω_tp = Z·n/60에서 채터 lobe와 공진, 불규칙 피치는 이 공진 에너지를 주파수 분산시켜 안정 lobe 폭 확대. 깊은 ap·긴 stick-out·내열합금에서 특히 유효. 출처: Altintas, Manufacturing Automation (2012) Ch.4.

**공식 / Formula**

```
ω_tp = Z·n / 60  (채터 분산 대상 주파수)
```

**왜 중요?** 긴 돌출·깊은 절입에서 regular pitch 공구가 우는 조건이라도 variable helix로 바꾸면 말끔히 들어간다.

**실전 예시.** ⌀10mm LSO=50mm · SUS304 · ap=15mm 조건에서 regular 38° helix는 채터, 35/37/38/36° variable은 안정.

**⚠ 흔한 함정.** Variable 공구는 고가라 일반 얕은 가공에 쓰면 손해. 채터가 실제로 문제가 되는 긴 돌출·깊은 가공에만 투입.

**관련 개념:** `flutes` · `stick-out` · `adoc`

*출처: Altintas, Manufacturing Automation, Cambridge Univ. Press (2012)*

---

### 섕크 (Shank)
*Shank* · id: `shank`

**초급 (Beginner)**
> 공구에서 홀더(척)가 잡는 매끈한 부분. 손잡이에 해당하는 영역.

**중급 (Intermediate)**
> Shank. 홀더가 클램핑하는 원통 구간. 규격(h6 등) 공차로 가공되어 홀더와 정밀 정합.

**고급 (Expert)**
> Shank diameter·tolerance (보통 h6, ⌀6/8/10/12/16/20mm 스탠다드). 열박음(shrink-fit)은 h6 섕크 필수, milling chuck는 h5 선호. Weldon flat(평탄부)·Whistle Notch는 고토크 전용 인터페이스. 출처: DIN 1835 / ISO 5413.

**공식 / Formula**

```
섕크 공차: h6 (일반), h5 (열박음 고정밀)
```

**왜 중요?** 섕크 공차가 h6이 아니거나 상처가 나면 홀더 정합이 깨져 T.I.R.↑·공구수명↓·표면조도 악화.

**실전 예시.** ⌀10h6 섕크 엔드밀을 열박음(shrink-fit) 홀더에 장착 시 T.I.R. &lt; 3μm @ 3×D 돌출 달성 가능.

**⚠ 흔한 함정.** 드로우바로 섕크를 조이다 평탄부(Weldon flat) 없는 공구에 흠집을 내면 이후 정합 불가능해짐.

**관련 개념:** `stick-out` · `oal` · `cutter-diameter`

*출처: DIN 1835 / ISO 5413 Tool Shank Standard*

---

### 에지혼 / 날끝 반경 (Edge Hone / Edge Prep)
*Edge Hone (Edge Preparation)* · id: `edge-hone`

**초급 (Beginner)**
> 날 끝에 아주 작게(수 μm) 둥근 처리를 해놓은 것. 너무 날카로우면 쉽게 깨지기 때문에 일부러 둥글게 만든다.

**중급 (Intermediate)**
> Edge hone, edge prep. 날 끝 반경 rβ [μm]. 코팅 밀착·치핑 방지 목적. 재질·가공모드에 따라 최적값 다름.

**고급 (Expert)**
> Edge radius rβ [μm]. 코팅 초경 일반 10~25μm, 고이송·황삭 30~50μm, 정삭·Al 2~8μm (sharp edge). rβ &lt; fz가 일반적, rβ &gt; fz이면 ploughing(문지름)으로 burr·가공경화. 출처: Denkena & Biermann, CIRP Annals 2014 'Cutting edge geometries'.

**공식 / Formula**

```
조건: rβ < fz (ploughing 회피)
```

**왜 중요?** 너무 날카로우면 치핑, 너무 둥글면 rubbing. 재질·fz에 맞는 에지혼이 공구수명의 숨은 1등 변수.

**실전 예시.** Ti-6Al-4V 가공 fz=0.05mm(50μm)인데 rβ=30μm 공구 선택. rβ=8μm sharp edge 쓰면 치핑 발생.

**⚠ 흔한 함정.** 알루미늄 전용 sharp-edge(rβ&lt;5μm) 공구로 강·SUS를 깎으면 즉시 치핑. 재질 대응 에지혼 스펙 확인 필수.

**관련 개념:** `corner-radius` · `flutes` · `fz`

*출처: Denkena & Biermann, CIRP Annals — Manufacturing Technology, 2014*

---

### 공구 직경 D (Cutter Diameter)
*Cutter Diameter* · id: `cutter-diameter`

**초급 (Beginner)**
> 공구 날 부분의 지름(mm 또는 inch). ⌀10mm면 직경 10mm라는 뜻.

**중급 (Intermediate)**
> Cutter diameter D [mm]. 공구 선정의 1차 스펙. Vc·n·deflection·MRR 모두 D에 강하게 의존.

**고급 (Expert)**
> D [mm]. n = 1000·Vc/(π·D) (∝1/D), 강성 I ∝ D^4 (deflection ∝ 1/D^4). D 2배 → n 절반, deflection 1/16. 카탈로그 D는 공칭, 실측 허용 공차는 보통 −0.01~−0.03mm(주로 −측 offset). 출처: DIN 6527 / ISO 1641.

**공식 / Formula**

```
n ∝ 1/D,  deflection ∝ 1/D⁴
```

**왜 중요?** 공구 하나 바꿀 때 D가 바뀌면 RPM·이송·deflection 전부 재계산 필요. 같은 F값을 돌리면 실 Vc가 완전히 달라진다.

**실전 예시.** ⌀10 → ⌀6으로 교체: 같은 Vc=120이면 n은 3820 → 6366, 같은 fz면 Vf는 1.67배로 올려야 동일 칩두께.

**⚠ 흔한 함정.** 소형 D 공구에 대형 공구 파라미터를 그대로 두면 Vc는 낮고 deflection은 폭증 → 치수·수명 모두 파국.

**관련 개념:** `d-eff` · `shank` · `square-endmill`

*출처: DIN 6527 / ISO 1641 Solid Endmill Dimensions*

---

### 유효 직경 D_eff (Effective Diameter)
*Effective Cutting Diameter* · id: `d-eff`

**초급 (Beginner)**
> 공구 전체 직경이 아니라, 실제로 재료를 깎고 있는 부분의 직경(mm). 볼노즈·챔퍼에서 중요한 개념.

**중급 (Intermediate)**
> Effective diameter D_eff [mm]. 실제 절삭이 일어나는 지점의 직경. 볼·챔퍼·코너R에서 깊이에 따라 변함.

**고급 (Expert)**
> 볼노즈: D_eff = 2·√(D·ap − ap²) (ap ≤ R). 챔퍼(2α): D_eff = D_tip + 2·z·tan(α). Vc_실제 = π·D_eff·n/1000. 기울임(tilt) β 적용 시 ball: D_eff = 2·R·sin(arccos(1 − ap/R) + β). 출처: Sandvik Coromant Die & Mould Guide / Harvey Performance MAP.

**공식 / Formula**

```
Vc_real = π · D_eff · n / 1000
```

**왜 중요?** 볼·챔퍼에서 공칭 D로 RPM을 잡으면 실 Vc가 엉뚱한 값이 된다. 공구수명·표면조도·발열 모두 D_eff에서 결정.

**실전 예시.** ⌀10 볼노즈, ap=1mm → D_eff ≈ 6mm. Vc=120 m/min 원하면 n = 1000·120/(π·6) ≈ 6366, ⌀10 기준 3820이 아님.

**⚠ 흔한 함정.** 금형 정삭에서 공칭 D로 RPM 설정 → 팁 근방은 Vc가 0에 가까워 공구가 문지르기만 하고 표면이 거칠어짐.

**관련 개념:** `ball-nose` · `chamfer-tool` · `cutter-diameter`

*출처: Sandvik Coromant Die & Mould Application Guide*

---

### 시리즈 (Series, 공구 명명법)
*Tool Series* · id: `series`

**초급 (Beginner)**
> 공구 카탈로그에서 '이 공구는 어떤 용도·어떤 재료용인지'를 나타내는 계열 이름. YG-1의 Alu-Power, Sandvik CoroMill 등.

**중급 (Intermediate)**
> Tool series. 재질·가공모드(rough/finish)·피삭재군(P/M/K/N/S/H)·코팅조합을 묶은 제품군 분류.

**고급 (Expert)**
> ISO 피삭재 분류: P(강), M(스테인리스), K(주철), N(비철/Al), S(내열합금 Ti·Ni), H(경화강 HRC&gt;45). 각 제조사 시리즈명은 이 구간별로 최적화된 기하·코팅·에지혼 조합. 예: YG-1 Alu-Power(N), X-Power(P/M 범용), V7(S), Sandvik CoroMill Plura·GC1630. 출처: ISO 513 / YG-1·Sandvik 제품 카탈로그.

**공식 / Formula**

```
ISO 513: P · M · K · N · S · H
```

**왜 중요?** 피삭재에 맞지 않는 시리즈를 쓰면 수명·표면이 2~5배 차이. 카탈로그의 ISO 컬러코드(P=파랑, N=녹색 등)부터 맞춰야 한다.

**실전 예시.** Ti-6Al-4V 가공에 P계 범용(X-Power) 쓰면 수명 20분, S계 전용(V7)이면 60~90분 달성.

**⚠ 흔한 함정.** '잘 깎이는 공구'라는 평판만 듣고 P계를 S계 재료에 사용 → 비용은 더 쓰는데 수명은 훨씬 짧음.

**관련 개념:** `edp` · `cutter-diameter` · `flutes`

*출처: ISO 513 Classification of Hard Cutting Materials*

---

### EDP 번호 (EDP / Catalog Number)
*EDP Number* · id: `edp`

**초급 (Beginner)**
> 공구 하나하나에 붙어있는 고유 번호. 주문할 때 이 숫자로 '정확히 이 공구 주세요'라고 지정함.

**중급 (Intermediate)**
> EDP(Electronic Data Processing) number. 제조사별 SKU 코드. 직경·날수·LOC·코팅·코너R을 하나의 번호로 인코딩.

**고급 (Expert)**
> EDP #. 제조사마다 체계 상이. 예: YG-1 EMB EDP '01234'는 직경·플루트·코팅 조합을 고유 식별. Kennametal NOVO·Sandvik CoroPlus는 EDP 기반으로 가공조건을 DB 매칭. 구매·재고·CAM tool library·ERP 연결의 키. 출처: 각 제조사 Master Catalog.

**공식 / Formula**

```
— (식별자)
```

**왜 중요?** 동일 스펙이라도 코팅·에지혼 세부가 다르면 EDP가 다르다. EDP 없이 '⌀10 4날'만 말하면 다른 공구가 온다.

**실전 예시.** YG-1 'EMB89100' vs 'GMH89100' — 직경/플루트는 같아도 코팅·시리즈 달라 SUS304 수명 차이 2배.

**⚠ 흔한 함정.** CAM 라이브러리에서 EDP 없이 '동급 공구'로 치환하면 실가공 조건이 카탈로그와 어긋나 수명 급락.

**관련 개념:** `series` · `cutter-diameter` · `flutes`

*출처: YG-1 Master Catalog / Kennametal NOVO / Sandvik CoroPlus*

---

## ④ 재질 (Material, ISO P/M/K/N/S/H)

### ISO P — 탄소·합금강
*ISO P (Steel, Carbon & Alloy)* · id: `iso-p`

**초급 (Beginner)**
> 가장 흔한 쇠. 자동차 차축이나 기계 부품에 쓰인다. 깎기 무난해서 CNC 입문자도 다루기 쉬움.

**중급 (Intermediate)**
> ISO 513의 P군. 탄소강·합금강·주강 포함. 칩 형성 연속형이라 칩브레이커 필수. 권장 Vc 150-250 m/min (HSS 공구 기준 25-40).

**고급 (Expert)**
> 탄소강 C 0.1-0.6% / 합금강 Cr·Mo·Ni 첨가. HBW 150-300, HRC 25-35 구간. 권장 Vc 150-300 m/min (코팅 초경), fz 0.08-0.25 mm/tooth. 권장 코팅: TiAlN, AlTiN, nACo. 금기: Diamond/PCD (탄소 확산 → 공구 흑연화). 응용: 자동차 크랭크샤프트·기어·금형 베이스. 출처: ISO 513:2012, Sandvik Coromant Rotating Tools Ch.A.

**왜 중요?** 전 세계 절삭 가공의 약 40%를 차지하는 기준 재질군. 모든 SFM 차트의 베이스라인.

**실전 예시.** SM45C (C 0.45%) 블록에 ⌀12 4날 AlTiN 엔드밀로 Vc 220 m/min, fz 0.12 mm, ap 6 mm 슬롯가공이 표준.

**⚠ 흔한 함정.** 저탄소강(SM10C 등)은 연질이라 오히려 칩이 공구에 엉겨붙음 — BUE(구성인선) 주의.

**관련 개념:** `sfm` · `ipt` · `altin-coating` · `iso-h` · `kc`

*출처: ISO 513:2012 Table 1 / ASM Metals Handbook Vol.1*

---

### ISO M — 스테인리스 강
*ISO M (Stainless Steel)* · id: `iso-m`

**초급 (Beginner)**
> 스테인리스 강. 자석에 잘 안 붙고 녹슬지 않지만 끈적해서 깎기 까다롭다. 공구가 빨리 닳음.

**중급 (Intermediate)**
> 오스테나이트·페라이트·마르텐사이트계 포함. 가공경화성 높고 열전도율 낮아 (15 W/m·K, 강의 1/3) 날끝 온도 급상승. 권장 Vc 120-180 m/min.

**고급 (Expert)**
> Cr ≥10.5% 필수, 대표 304/316/17-4PH. HBW 150-250, 가공 후 표층 HV +30-50 증가 (work-hardening). 권장 Vc 120-200 m/min, fz 0.05-0.15 mm, ap 최소 0.3 mm (경화층 아래 진입 필수). 권장 코팅: AlTiN, AlCrN, nACo. 금기: TiN 단층 (내열성 부족). 응용: 의료기기·식품설비·화학플랜트. 출처: Sandvik Coromant Material Classification.

**왜 중요?** 가공경화 특성으로 '얕게 긁으면 더 단단해짐' — 올바른 진입전략 없으면 공구 수명이 1/5로 떨어진다.

**실전 예시.** SUS304 파이프 페이싱 시 Vc 150 m/min, fz 0.12 mm, ap 1.5 mm로 경화층을 확실히 아래부터 자른다.

**⚠ 흔한 함정.** fz가 너무 작으면(&lt;0.05) 공구가 표면을 '문지르며' 경화층만 두껍게 만들어 다음 패스가 더 힘들어짐.

**관련 개념:** `sus-304` · `sus-316` · `altin-coating` · `alcrn-coating` · `work-hardening`

*출처: ISO 513:2012 / Sandvik Coromant Stainless Application Guide*

---

### ISO K — 주철
*ISO K (Cast Iron)* · id: `iso-k`

**초급 (Beginner)**
> 주철. 엔진 블록이나 맨홀 뚜껑에 쓰이는 회색 쇠. 부서지는 칩이 나와서 절삭유 없이도 깎인다.

**중급 (Intermediate)**
> 회주철(GC)·구상흑연주철(GGG)·가단주철 포함. 칩 형성 불연속형(단편칩). 흑연이 내부 윤활 역할 → Vc 높게 가능. 권장 Vc 180-350 m/min.

**고급 (Expert)**
> 회주철 GC250: C 3.2-3.5%, Si 1.8-2.2%, HBW 180-230 / 구상흑연주철 GCD500: HBW 170-241. 권장 Vc 200-400 m/min (세라믹공구는 800까지), fz 0.15-0.40 mm. 권장 코팅: Al2O3 CVD, TiCN. 금기: 습식 + 고속 (열충격으로 세라믹 공구 파손). 응용: 자동차 엔진블록·실린더헤드·기계 베드. 출처: ASM Handbook Vol.1 'Cast Irons'.

**왜 중요?** 드라이가공 가능한 거의 유일한 재질군. 절삭유 없어도 흑연이 윤활 → 비용·환경 양쪽 절감.

**실전 예시.** 엔진블록 GC250 면삭 시 Vc 300 m/min, fz 0.25 mm, ap 2 mm 드라이 가공으로 공구수명 500 min 확보.

**⚠ 흔한 함정.** 표면의 주조 스킨(경도 HV 500+)을 얕은 ap로 긁으면 공구 치핑 — 첫 패스는 ap 2 mm 이상으로 스킨 아래 진입.

**관련 개념:** `ticn-coating` · `sfm` · `cast-al` · `iso-p`

*출처: ISO 513:2012 / ASM Metals Handbook Vol.1 Ch.'Cast Irons'*

---

### ISO N — 비철·알루미늄
*ISO N (Non-ferrous, Aluminum & Copper alloys)* · id: `iso-n`

**초급 (Beginner)**
> 알루미늄·구리처럼 무른 금속. 엄청 빠르게 깎을 수 있고 칩이 길게 나와 감겨 올라옴.

**중급 (Intermediate)**
> 가공용 Al(2xxx-7xxx) / 주조 Al(A356 등) / 구리·황동 포함. 높은 열전도율로 날끝 냉각 유리. 권장 Vc 500-3000 m/min.

**고급 (Expert)**
> Wrought Al: HBW 60-150, Cast Al (Si 함유): HBW 70-120, Si ≥9%는 고실리콘 — PCD 필수. 권장 Vc 1000-3500 m/min (Helical 고속 알루미늄 3날 기준), fz 0.08-0.25 mm at ⌀10. 권장 코팅: Uncoated polished, ZrN, DLC. 금기: TiN·AlTiN (Al 응착). 응용: 항공기 스킨·자동차 휠·전자기기 하우징. 출처: Helical Solutions Aluminum SFM Chart.

**왜 중요?** HSM(고속가공)의 주 대상. 날수 2-3으로 줄이고 나선각 35-45°로 칩 배출 극대화.

**실전 예시.** Al6061 포켓 ⌀8 3날 미코팅 엔드밀 Vc 1500 m/min, fz 0.12 mm, ap 8 mm(=1×D) 풀슬롯 가공.

**⚠ 흔한 함정.** 일반 엔드밀(날수 4+)로 Al 가공 시 칩포켓 부족 → 칩이 재절삭되며 공구 파단. 3날 전용품 사용할 것.

**관련 개념:** `wrought-al` · `cast-al` · `al-6061` · `al-7075` · `dlc-coating` · `uncoated`

*출처: ISO 513:2012 / Helical Solutions Technical Data Sheet (Aluminum)*

---

### ISO S — 초내열합금·티타늄
*ISO S (Superalloys & Titanium)* · id: `iso-s`

**초급 (Beginner)**
> 제트엔진용 특수 금속. 700°C에서도 강도 유지. 깎기 엄청 어려워 공구 수명이 강 대비 1/10.

**중급 (Intermediate)**
> Ni-base(Inconel, Hastelloy) / Co-base / Ti-base 포함. 낮은 열전도(Ti: 7 W/m·K) + 가공경화 + 화학적 반응성 3중고. 권장 Vc 30-80 m/min.

**고급 (Expert)**
> Inconel 718: HBW 330-400, Ti6Al4V: HBW 300-350. 권장 Vc 30-60 m/min (Ni-base), 40-90 m/min (Ti), fz 0.05-0.12 mm, radial chip thinning 고려 필수 ae ≤ 0.3×D. 권장 코팅: AlTiN nano-layer, nACRo, TiAlSiN. 금기: 고속 드라이 + Ti (발화 위험). 응용: 항공 터빈 블레이드·우주 엔진·인공관절. 출처: Sandvik Coromant Aerospace Application Guide.

**왜 중요?** 항공·의료 고부가가치 가공의 핵심. 공구비가 총가공비의 30% 이상 차지 — 파라미터 실수 1회로 $500+ 손실.

**실전 예시.** Inconel 718 임펠러 황삭 ⌀16 4날 AlTiN 엔드밀 Vc 45 m/min, fz 0.08 mm, ae 2.4 mm(0.15×D) 트로코이달.

**⚠ 흔한 함정.** 일반 강 파라미터로 진입하면 1패스에 공구 파손. Vc를 강 대비 1/4-1/5로 낮추는 것이 출발점.

**관련 개념:** `inconel-718` · `altin-coating` · `naco-coating` · `iso-h` · `trochoidal`

*출처: ISO 513:2012 / Sandvik Coromant Aerospace Machining Guide*

---

### ISO H — 경화강
*ISO H (Hardened Steel, HRC 45-65)* · id: `iso-h`

**초급 (Beginner)**
> 열처리로 아주 단단하게 만든 쇠. 금형에 많이 쓰임. 연삭 대신 깎을 수 있으면 시간 대폭 절감.

**중급 (Intermediate)**
> HRC 45-65 담금질강·고속도강·콜드워크 금형강. Hard milling으로 연삭 대체. 권장 Vc 80-180 m/min (CBN/세라믹은 200+).

**고급 (Expert)**
> 대표 재질 STD61 HRC 50-52, SKD11 HRC 58-62, D2 HRC 60-62. 권장 Vc 80-200 m/min, fz 0.05-0.15 mm, ap ≤0.3×D (공구 휨 최소화). 권장 코팅: AlTiN, TiAlSiN, CBN 인서트. 금기: 습식 (열충격으로 미세 크랙). 응용: 금형 코어·핀·다이 인서트. 출처: Harvey Tool Hardened Steel Guide.

**왜 중요?** 연삭공정을 절삭으로 대체하면 리드타임 50% 단축. 금형산업의 패러다임 시프트 주도.

**실전 예시.** STD61 HRC 52 금형코어 ⌀6 2날 AlTiN 볼 엔드밀 Vc 150 m/min, fz 0.08 mm, ap 0.15 mm 드라이 다듬질.

**⚠ 흔한 함정.** HRC 55 이상에서는 돌출 길이 L/D ≤ 3 필수. 공구 휨 = 치수 오차 = 금형 수정 비용.

**관련 개념:** `iso-p` · `altin-coating` · `hbw-hrc-scales`

*출처: ISO 513:2012 / Harvey Performance Hardened Steel Machining Guide*

---

### 가공용 알루미늄 (Wrought)
*Wrought Aluminum Alloys* · id: `wrought-al`

**초급 (Beginner)**
> 판재·봉재로 압연·압출한 알루미늄. 6061/7075가 대표. 항공기 부품에 많이 쓰임.

**중급 (Intermediate)**
> 2xxx(Cu계)·6xxx(Mg-Si계)·7xxx(Zn계). T6 시효경화 상태가 가장 흔함. 권장 Vc 800-2500 m/min.

**고급 (Expert)**
> 6061-T6: Si 0.6%, Mg 1.0%, HBW 95±5 / 7075-T6: Zn 5.6%, Mg 2.5%, HBW 150±10. 권장 Vc 1000-3000 m/min, fz 0.08-0.20 mm at ⌀10, 3날 하이헬릭스(40-45°). 권장 코팅: Uncoated polished, ZrN, DLC. 금기: AlTiN/TiAlN (Al 응착). 응용: 항공 스킨·프레임·자동차 스티어링 너클. 출처: ASM Metals Handbook Vol.2 'Aluminum Alloys'.

**왜 중요?** 주조 알루미늄과 파라미터 체계가 다름. Si 함량 1% 이하라 공구 마모가 낮고 HSM 최적 대상.

**실전 예시.** 7075-T6 블록 포켓 가공 ⌀10 3날 미코팅 엔드밀 Vc 1800 m/min, fz 0.15 mm, ap 10 mm(=1×D) 풀슬롯.

**⚠ 흔한 함정.** 7075는 6061보다 단단해서 같은 파라미터로 시작하면 공구 수명 2배 차이 — T6 상태 경도 반드시 확인.

**관련 개념:** `al-6061` · `al-7075` · `iso-n` · `cast-al` · `uncoated`

*출처: ASM Metals Handbook Vol.2 / Helical Solutions Aluminum Speeds&Feeds*

---

### 주조 알루미늄 (Cast)
*Cast Aluminum Alloys* · id: `cast-al`

**초급 (Beginner)**
> 녹여서 틀에 부어 만든 알루미늄. 자동차 엔진블록·휠이 대표. 실리콘이 섞여 약간 거칠게 깎임.

**중급 (Intermediate)**
> A356·A380·ADC12 등. Si 7-12%로 내마모성 확보했지만 Si 입자가 공구 마모 주범. 권장 Vc 300-900 m/min.

**고급 (Expert)**
> A356-T6: Si 7%, Mg 0.3%, HBW 75-85 / A380: Si 8.5%, Cu 3.5%, HBW 80 / 고실리콘 A390 Si 17%는 PCD 필수. 권장 Vc 500-1200 m/min (일반 주조 Al), fz 0.08-0.18 mm. 권장 코팅: Diamond CVD, PCD (Si≥9%), DLC. 금기: AlTiN (응착), Uncoated (Si 연삭성 마모). 응용: 엔진블록·트랜스미션 하우징·휠. 출처: ASM Metals Handbook Vol.2.

**왜 중요?** Si 함량이 코팅 선택을 좌우. 일반(7%)은 DLC, 고실리콘(≥9%)은 PCD — 잘못 고르면 공구수명 10배 차이.

**실전 예시.** A380 엔진블록 페이싱 ⌀80 PCD 페이스밀 Vc 1000 m/min, fz 0.15 mm, ap 3 mm 드라이 가공.

**⚠ 흔한 함정.** 재활용 Al(ADC12) 사용 시 Si·Fe 변동 크고 경질 개재물 포함 — 공구수명 예측 어려워 안전계수 1.5 적용.

**관련 개념:** `wrought-al` · `pcd` · `diamond-cvd` · `iso-n` · `dlc-coating`

*출처: ASM Metals Handbook Vol.2 'Aluminum Alloys' Ch.Casting*

---

### SUS304 / AISI 304
*SUS304 / AISI 304 Austenitic Stainless* · id: `sus-304`

**초급 (Beginner)**
> 주방용 싱크대나 주전자에 쓰는 가장 흔한 스테인리스. 깎을 때 끈적하고 공구가 잘 무뎌짐.

**중급 (Intermediate)**
> 오스테나이트계 대표. 18Cr-8Ni. 비자성, 우수한 내식성, 그러나 낮은 열전도·높은 가공경화. 권장 Vc 130-200 m/min.

**고급 (Expert)**
> 조성: Cr 18%, Ni 8%, C ≤0.08%. HBW 150-200, 가공경화 후 표층 HV 400+. 권장 Vc 150-220 m/min, fz 0.08-0.18 mm at ⌀10, ap ≥0.5 mm. 권장 코팅: AlTiN, AlCrN. 금기: TiN 단층, Diamond. 응용: 식품설비·건축외장·화학배관. 출처: Sandvik Coromant Stainless Handbook.

**왜 중요?** 전 세계 스테인리스 수요의 50%. 오스테나이트계 기준 파라미터 — 다른 SS는 여기서 ±10% 보정.

**실전 예시.** SUS304 파이프 이면 다듬질 ⌀8 4날 AlTiN 엔드밀 Vc 180 m/min, fz 0.10 mm, ap 0.5 mm, ae 0.4 mm.

**⚠ 흔한 함정.** 316과 헷갈리기 쉬움 — 304에 316 파라미터(-15%) 적용하면 생산성 손실. 자석·성분 확인 필수.

**관련 개념:** `sus-316` · `iso-m` · `altin-coating` · `work-hardening`

*출처: AISI 304 / JIS G 4303 / Sandvik Coromant Material Card P-M-N-S*

---

### SUS316 / AISI 316
*SUS316 / AISI 316 Molybdenum-bearing Stainless* · id: `sus-316`

**초급 (Beginner)**
> SUS304보다 녹 더 잘 안 스는 스테인리스. 바닷물·약품에 강함. 의료기기·선박에 쓰임. 더 깎기 힘듦.

**중급 (Intermediate)**
> Mo 2-3% 추가로 내공식성 향상. 가공성은 304 대비 -10~-15%. 권장 Vc 120-180 m/min.

**고급 (Expert)**
> 조성: Cr 17%, Ni 10-14%, Mo 2-3%, C ≤0.08%. HBW 160-210. 권장 Vc 130-200 m/min, fz 0.07-0.15 mm, ap ≥0.5 mm. 권장 코팅: AlTiN nano-layer, nACo. 금기: TiN, Diamond. 응용: 해양플랜트·의료 임플란트·제약설비. 출처: Sandvik Coromant Stainless Guide.

**왜 중요?** 의료·식품 산업 필수. 가격은 304 대비 1.5배이지만 재작업 비용이 더 크므로 파라미터 보수적으로.

**실전 예시.** 316L 의료임플란트 드릴링 ⌀5 고압 쿨런트 40bar Vc 150 m/min, fz 0.08 mm, peck 1×D.

**⚠ 흔한 함정.** Mo 때문에 절삭저항 kc가 304보다 높음 (2700 → 2900 N/mm²) — 공구 강성 부족 시 채터 빈발.

**관련 개념:** `sus-304` · `iso-m` · `naco-coating` · `kc`

*출처: AISI 316 / ASTM A240 / Sandvik Coromant Material Card*

---

### Inconel 718
*Inconel 718 (UNS N07718)* · id: `inconel-718`

**초급 (Beginner)**
> 제트엔진 터빈용 극한 금속. 700°C에서도 강철만큼 단단. 깎기 극악 난이도. 공구 수명이 보통 강의 1/10.

**중급 (Intermediate)**
> 니켈-크롬 초내열합금. 가스터빈/제트엔진 터빈 블레이드용. 일반 탄소강 대비 Vc 1/4~1/5로 매우 느림.

**고급 (Expert)**
> 조성: Ni 50-55%, Cr 17-21%, Fe balance, Nb 4.75-5.5%, Mo 2.8-3.3%, Ti 0.65-1.15%. HBW 330-400 (시효후), Rm 1240 MPa. 권장 Vc 30-60 m/min (황삭), 40-80 m/min (다듬질), fz 0.05-0.12 mm, ae ≤0.3×D + chip thinning. 권장 코팅: AlTiN nano-multilayer, nACRo, TiAlSiN. 금기: PCD (Ni 확산), 고속 드라이. 응용: 제트엔진 터빈 디스크·로켓 노즐. 출처: Special Metals Inconel 718 Datasheet + Sandvik Aerospace Guide.

**왜 중요?** 항공엔진 고부가가치 부품의 80% 사용. 파라미터 1회 실수 = 공구 $300+ 파손 + 블랭크 $5000+ 폐기.

**실전 예시.** IN718 터빈디스크 포켓 황삭 ⌀12 4날 AlTiN 엔드밀 Vc 45 m/min, fz 0.08 mm, ap 12 mm, ae 1.8 mm 트로코이달.

**⚠ 흔한 함정.** fz를 낮추는 것이 안전하다고 오해 — 0.05 이하로 가면 오히려 공구가 경화층만 문질러 수명 급감.

**관련 개념:** `iso-s` · `altin-coating` · `naco-coating` · `trochoidal` · `work-hardening`

*출처: Special Metals Corp. Inconel 718 Data Sheet / Sandvik Coromant Aerospace*

---

### Al 6061-T6
*Aluminum 6061-T6* · id: `al-6061`

**초급 (Beginner)**
> 가장 흔한 가공용 알루미늄. 항공·자전거 프레임·방열판에 사용. 빠르게 깎기 좋음.

**중급 (Intermediate)**
> 6xxx계(Mg-Si). T6는 용체화+인공시효로 강도 극대화. 우수한 가공성·용접성 겸비. 권장 Vc 800-2500 m/min.

**고급 (Expert)**
> 조성: Si 0.6%, Mg 1.0%, Cu 0.28%, Cr 0.2%. T6 시효경화 완료상태. HBW 95±5, Rm 310 MPa. 권장 Vc 1000-2500 m/min (Helical Aluminum 3날), fz 0.10-0.20 mm at ⌀10, ap 1×D 풀슬롯 가능. 권장 코팅: Uncoated polished 또는 ZrN/DLC (응착 방지). 금기: AlTiN (Al 응착). 응용: 항공기 2차 구조·광학 마운트·자동차 섀시. 출처: ASM Metals Handbook Vol.2 + Helical Speeds&Feeds Chart.

**왜 중요?** CNC 샵의 70% 이상이 만지는 기준 재질. 모든 Al 파라미터의 출발점.

**실전 예시.** 6061-T6 브라켓 포켓 ⌀10 3날 미코팅 Vc 2000 m/min (RPM 63,700), fz 0.15 mm, ap 10 mm 풀슬롯 1패스.

**⚠ 흔한 함정.** O(어닐링) 재료에 T6 파라미터 적용 시 끈적한 BUE 발생. 열처리 기호 확인 필수.

**관련 개념:** `wrought-al` · `al-7075` · `uncoated` · `dlc-coating` · `iso-n`

*출처: ASM Metals Handbook Vol.2 / Helical Solutions Aluminum Technical Data*

---

### Al 7075-T6
*Aluminum 7075-T6* · id: `al-7075`

**초급 (Beginner)**
> 6061보다 훨씬 단단한 항공용 알루미늄. '알루미늄 중의 강철'. 전투기·군수에 쓰임.

**중급 (Intermediate)**
> 7xxx계(Zn-Mg). 고강도 항공용. HBW 150 수준으로 6061의 1.6배. 권장 Vc 700-2000 m/min.

**고급 (Expert)**
> 조성: Zn 5.6%, Mg 2.5%, Cu 1.6%, Cr 0.23%. T6 상태. HBW 150±10, Rm 570 MPa (6061의 1.8배). 권장 Vc 900-2200 m/min, fz 0.08-0.15 mm at ⌀10. 권장 코팅: ZrN, DLC (6061 대비 열부하 큼). 금기: AlTiN, 습식 저압 (칩 감김). 응용: 전투기 날개 스파·사격용 총열 블록·고응력 항공부품. 출처: ASM Metals Handbook Vol.2.

**왜 중요?** 항공 1차 구조재. 6061 대비 강도 1.8배지만 내식성 낮아 애노다이징 필수 — 치수공차 엄격.

**실전 예시.** 7075-T6 항공 리브 포켓 ⌀10 3날 ZrN Vc 1800 m/min, fz 0.12 mm, ap 10 mm, 고압 쿨런트 70bar.

**⚠ 흔한 함정.** 6061 파라미터 그대로 적용 시 공구수명 50% 단축. Vc -10%, fz -20% 보정 출발.

**관련 개념:** `al-6061` · `wrought-al` · `zrn-coating` · `dlc-coating` · `iso-n`

*출처: ASM Metals Handbook Vol.2 / Helical Solutions 7075 Application Note*

---

### 비절삭저항 kc
*Specific Cutting Force (kc)* · id: `kc`

**초급 (Beginner)**
> 재료를 1 mm² 단면으로 깎을 때 필요한 힘(N). 재료마다 다르고 값이 클수록 힘센 기계가 필요.

**중급 (Intermediate)**
> kc [N/mm²] = 절삭력 / (ap × fz). 재료별 고유값으로 스핀들 동력·토크 계산의 핵심. Kienzle 공식의 기본 파라미터.

**고급 (Expert)**
> Kienzle 공식: Fc = kc1.1 × b × h^(1-mc). kc1.1은 h=b=1mm 기준 비저항, mc는 경화지수. 대표값: Al 6061 kc=750, Steel S45C kc=2100, SUS304 kc=2700, SUS316 kc=2900, Inconel 718 kc=3500-4200, Ti6Al4V kc=2000, GC250 kc=1100, A380 kc=700 N/mm². 공칭 Pc[kW] = (kc × ap × ae × fz × z × n) / (60 × 10^6 × η). 출처: Sandvik Coromant Rotating Tools Handbook Ch.B / Kienzle DIN 6584.

**공식 / Formula**

```
Fc [N] = kc × ap × h_m,  Pc [kW] = Fc × Vc / (60 × 1000 × η)
```

**왜 중요?** 스핀들 동력 부족 판정의 유일한 정량 지표. kc를 무시하면 과부하로 스핀들 베어링 조기 손상.

**실전 예시.** Inconel 718에서 ⌀12 4날 ap 12 ae 2 fz 0.08로 가공 시 Pc = 3500×12×2×0.08×4×1200/(60e6×0.8) ≈ 13.4 kW — 15 kW 스핀들 거의 한계.

**⚠ 흔한 함정.** kc는 상수가 아님. 가공 두께 h가 작아지면 kc 증가(Kienzle mc 효과) — 다듬질에서 의외로 동력 부족.

**관련 개념:** `iso-p` · `iso-m` · `iso-s` · `inconel-718` · `sfm`

*출처: DIN 6584 / Sandvik Coromant Rotating Tools Handbook / Kienzle 1952*

---

### 경도 스케일 HBW/HBS/HRB/HRC
*Hardness Scales (Brinell / Rockwell B / Rockwell C)* · id: `hbw-hrc-scales`

**초급 (Beginner)**
> 재료가 얼마나 단단한지 나타내는 숫자. 종류가 여러 개라 스케일 이름을 꼭 같이 봐야 함.

**중급 (Intermediate)**
> HBW: 초경볼 Brinell / HBS: 강구 Brinell(구식) / HRB: 록웰 B(연질) / HRC: 록웰 C(경질 HRC 20-65). 재질별 적합 스케일 다름 — HRC는 담금질강, HBW는 주철·비철·연강 공용.

**고급 (Expert)**
> HBW 10/3000 = ⌀10mm 초경볼 + 3000kgf 하중, d[mm] 측정 후 HBW = 2F / (πD(D-√(D²-d²))). HRC = 100 - (e/0.002mm) where e는 브레일 침투깊이. 환산: HRC 20 ≈ HBW 225, HRC 30 ≈ HBW 285, HRC 40 ≈ HBW 375, HRC 50 ≈ HBW 475(외삽), HRC 60 ≈ HBW 620(외삽, 부정확). Vickers HV 환산은 HV ≈ HBW × 1.05 (HBW&lt;400). ISO 18265 환산표 권장. 출처: ISO 6506(HBW), ISO 6508(HRC), ISO 18265(환산).

**왜 중요?** Vc 결정의 1차 입력값. 'SM45C HBW 200'인지 'HBW 280'인지에 따라 Vc 권장이 20% 이상 차이.

**실전 예시.** 금형 STD61 '경도 HRC 52' 사양 → HBW 환산 500 → AlTiN 권장 Vc 130 m/min (연강 220의 60%).

**⚠ 흔한 함정.** HBW 값이 400 초과면 Brinell 신뢰도 저하 — 경화강은 반드시 HRC로 표기할 것. HB와 HBW 혼용 주의 (HB=구식 강구).

**관련 개념:** `iso-h` · `iso-p` · `iso-s` · `kc`

*출처: ISO 6506-1:2014 (Brinell), ISO 6508-1:2016 (Rockwell), ISO 18265:2013 (Conversion)*

---

## ⑤ 코팅 (Coating)

### Uncoated (코팅 없음)
*Uncoated Carbide* · id: `uncoated`

**초급 (Beginner)**
> 코팅을 입히지 않은 맨 초경 공구. 알루미늄 같은 무른 금속을 빠르게 깎을 때 오히려 유리.

**중급 (Intermediate)**
> 폴리싱만 한 초경 모재. 열전도율 높고 매끈한 면 덕에 Al 응착 최소화. vcMultiplier ×1.0 기준.

**고급 (Expert)**
> WC-Co 초경 모재 노출, 표면거칠기 Ra ≤0.05 μm 미러폴리싱. 내열 800°C (초경 자체). vcMultiplier ×1.0 (기준). 권장 재질군: Wrought Aluminum(6061/7075), Brass, Copper. 금기: Steel (급격한 crater wear), SUS (응착·용착 폭증), 주철(연마성 마모). 출처: Harvey Performance Coating Selection Guide.

**왜 중요?** Al HSM의 표준. 코팅이 오히려 표면거칠기를 높이므로 미러폴리싱 미코팅이 최선.

**실전 예시.** 6061-T6 광학마운트 다듬질 ⌀6 3날 미코팅 폴리싱 Vc 2200 m/min, Ra 0.4 μm 달성.

**⚠ 흔한 함정.** 미코팅을 Steel에 쓰면 10분 내 크레이터 마모로 공구 파단. Al 전용으로만 사용.

**관련 개념:** `wrought-al` · `al-6061` · `al-7075` · `iso-n` · `dlc-coating`

*출처: Harvey Performance Coating Guide / Helical Solutions Tooling Catalog*

---

### TiN (황금색)
*Titanium Nitride (TiN)* · id: `tin-coating`

**초급 (Beginner)**
> 황금색 코팅. 가장 오래된 PVD 코팅으로 탭·드릴에 흔함. 저속·연강용 범용. 지금은 구세대.

**중급 (Intermediate)**
> TiN 단층 PVD. 경도 HV 2300, 내열 600°C. vcMultiplier ×1.1. 연강·연질 비철용. 중·고속에서는 AlTiN에 밀림.

**고급 (Expert)**
> 조성 TiN stoichiometric, 두께 2-4 μm, 마찰계수 μ 0.4, HV 2300±200, 내열 600°C. vcMultiplier ×1.05-1.15. 권장 재질군: 연강(HBW&lt;200), Brass, Bronze, 저속 탭가공. 금기: SS 고속, 경화강, 난삭재 (600°C 초과 시 산화분해). 출처: Oerlikon Balzers BALINIT A Datasheet.

**왜 중요?** 가격이 가장 싸고 식별 쉬워(황금색) 탭·리머 기본 코팅. 고속 밀링에는 시대에 뒤떨어짐.

**실전 예시.** M10 SM45C 탭가공 TiN 코팅 HSS 탭 Vc 10 m/min, 절삭유 1:20 수용성.

**⚠ 흔한 함정.** AlTiN으로 바꿔야 할 SS 가공에 TiN 그대로 쓰면 공구수명 1/3. '금색이면 다 좋다' 오해 주의.

**관련 개념:** `altin-coating` · `ticn-coating` · `iso-p`

*출처: Oerlikon Balzers BALINIT A / Harvey Performance Coating Guide*

---

### TiCN (티타늄 카보나이트라이드)
*Titanium Carbonitride (TiCN)* · id: `ticn-coating`

**초급 (Beginner)**
> TiN에 탄소를 더한 청회색 코팅. TiN보다 단단하고 차갑게 써도 됨. 주철·강용.

**중급 (Intermediate)**
> Ti(C,N) PVD 다층. HV 3000, 내열 400°C(저내열이 약점). vcMultiplier ×1.15. 저-중속 습식가공에 최적.

**고급 (Expert)**
> 조성 Ti(C,N) with C/N ratio 0.6-0.8, 두께 3-5 μm, HV 3000±300, μ 0.4, 내열 400°C(중간 수준). vcMultiplier ×1.10-1.20. 권장 재질군: 연·중경 강, 주철(GC, GCD), 습식 드릴링. 금기: 고속 건식 밀링 (400°C 초과 시 산화), SS 고속. 출처: Oerlikon Balzers BALINIT B.

**왜 중요?** 주철 면삭·드릴링의 주력. AlTiN이 침범하기 전 전통적 주철 챔피언.

**실전 예시.** GC250 엔진블록 드릴 ⌀10 TiCN Vc 120 m/min, fz 0.2 mm, 습식 내부쿨런트.

**⚠ 흔한 함정.** 내열 400°C 한계로 드라이 고속가공에 쓰면 급격한 산화박리. 습식 또는 저속 전용.

**관련 개념:** `tin-coating` · `altin-coating` · `iso-k` · `iso-p`

*출처: Oerlikon Balzers BALINIT B / Sandvik Coromant PVD Guide*

---

### AlTiN (보라색)
*Aluminum Titanium Nitride (AlTiN)* · id: `altin-coating`

**초급 (Beginner)**
> 보라색 코팅. 현대 CNC 엔드밀의 기본. 열에 강해서 빠르게 깎거나 드라이 가공에 최적.

**중급 (Intermediate)**
> Al-rich AlTiN (Al&gt;Ti). HV 3300, 내열 900°C로 고속·건식 적합. vcMultiplier ×1.25. 강·스테인리스·주철 범용.

**고급 (Expert)**
> 조성 Al0.67Ti0.33N (Al-rich 조성이 내열성 결정), 두께 3-4 μm, HV 3300±200, μ 0.7, 내열 900°C (절삭중 Al2O3 패시베이션층 생성). vcMultiplier ×1.20-1.30. 권장 재질군: Steel(P), SS(M), Cast Iron(K), 난삭재(S, nano-multilayer 변형). 금기: 알루미늄 (Al 친화성으로 응착 폭증), Diamond 영역. 출처: Oerlikon Balzers BALINIT ALCRONA Pro Datasheet.

**왜 중요?** 고속가공의 기준 코팅. 한 가지만 고른다면 AlTiN — 강·SS·주철 80% 커버.

**실전 예시.** SM45C 몰드 포켓 ⌀10 4날 AlTiN Vc 250 m/min, fz 0.12 mm, ap 10 mm 드라이 트로코이달.

**⚠ 흔한 함정.** Al 가공에 AlTiN 그대로 쓰면 Al이 코팅에 녹아 붙음 — Al 전용 미코팅/DLC로 교체.

**관련 개념:** `alcrn-coating` · `naco-coating` · `iso-p` · `iso-m` · `iso-k`

*출처: Oerlikon Balzers BALINIT ALCRONA Pro / Harvey Performance AlTiN Spec*

---

### AlCrN (알루미늄 크롬 나이트라이드)
*Aluminum Chromium Nitride (AlCrN)* · id: `alcrn-coating`

**초급 (Beginner)**
> AlTiN의 사촌. 열에 더 강하고 충격에도 강해 황삭·단속가공에 유리.

**중급 (Intermediate)**
> Al-Cr-N 조성. 내열 1100°C로 AlTiN보다 +200°C. 인성 우수 → 단속절삭 챔피언. vcMultiplier ×1.25.

**고급 (Expert)**
> 조성 Al0.7Cr0.3N, 두께 3-4 μm, HV 3200±200, μ 0.35, 내열 1100°C (Cr2O3 패시베이션). vcMultiplier ×1.20-1.30. 권장 재질군: SS(M), 고속황삭 강(P), 페이스밀 단속절삭. 금기: Al, 순수 Diamond 영역. 출처: Oerlikon Balzers BALINIT ALCRONA EVO.

**왜 중요?** 페이스밀·단속절삭의 표준. 충격하중 반복에 AlTiN보다 20% 긴 수명.

**실전 예시.** SUS304 페이스밀 ⌀80 인서트 AlCrN Vc 200 m/min, fz 0.15 mm, ap 3 mm, ae 60 mm 단속.

**⚠ 흔한 함정.** 엔드밀에 AlCrN을 다 쓰면 과도 — 엔드밀은 AlTiN, 페이스밀·인서트는 AlCrN로 구분.

**관련 개념:** `altin-coating` · `naco-coating` · `iso-m` · `iso-p`

*출처: Oerlikon Balzers BALINIT ALCRONA EVO / Platit Coating Portfolio*

---

### nACo / nACRo (나노 복합)
*nACo / nACRo Nanocomposite* · id: `naco-coating`

**초급 (Beginner)**
> 나노 단위 다층 신형 코팅. 극한 재질(인코넬·티타늄) 전용. 비싸지만 수명 2-3배.

**중급 (Intermediate)**
> AlTiN + Si3N4 nano-grain composite. HV 4500+로 PVD 최고등급. 내열 1200°C. vcMultiplier ×1.30. 난삭재 S군 전용.

**고급 (Expert)**
> 조성 (Al,Ti,Si)N nanocrystalline + amorphous Si3N4 매트릭스, grain size 3-5 nm. 두께 2-3 μm, HV 4500±300, 내열 1200°C, μ 0.45. vcMultiplier ×1.25-1.35. 권장 재질군: 초내열합금(Inconel, Hastelloy), Ti6Al4V, 경화강 HRC 55+. 금기: Al, 연강 고속(오버스펙). 출처: Platit nACo Technical Brief / Oerlikon BALINIT PERTURA.

**왜 중요?** 항공엔진 가공의 게임체인저. Inconel에서 AlTiN 대비 수명 2배 → 항공 생산성 핵심.

**실전 예시.** IN718 터빈블레이드 루트 ⌀8 4날 nACo Vc 55 m/min, fz 0.08 mm, 수명 90분(AlTiN의 2배).

**⚠ 흔한 함정.** 연강에 nACo 쓰면 원가만 3배. S·H군 전용으로 한정 — 가격대비 효과 영역 좁음.

**관련 개념:** `altin-coating` · `alcrn-coating` · `inconel-718` · `iso-s` · `iso-h`

*출처: Platit nACo Technical Brief / Oerlikon Balzers BALINIT PERTURA*

---

### DLC (다이아몬드 유사)
*Diamond-Like Carbon (DLC)* · id: `dlc-coating`

**초급 (Beginner)**
> 다이아몬드처럼 미끌미끌한 검은 코팅. 알루미늄이 공구에 붙지 않게 해줌.

**중급 (Intermediate)**
> sp3-rich amorphous carbon (a-C:H). 초저마찰 μ 0.1, 내열 400°C(약점). vcMultiplier ×1.15. Al·비철 응착 방지.

**고급 (Expert)**
> 조성 sp3-rich a-C:H (hydrogenated DLC), 두께 1-2 μm, HV 2500-3500, μ 0.1-0.15 (초저마찰), 내열 350-450°C. vcMultiplier ×1.10-1.20. 권장 재질군: Wrought Al, 저실리콘 Cast Al, Cu, 플라스틱, 복합재. 금기: Steel/SS/주철 (내열 부족 + 탄소 확산), 습식 고압 (박리). 출처: Oerlikon Balzers BALINIT DLC / Harvey Performance DLC Guide.

**왜 중요?** Al HSM에서 미코팅 이상의 내응착성 제공. 복합재·플라스틱에도 ideal.

**실전 예시.** A380 저실리콘 (Si 7%) 다듬질 ⌀6 3날 DLC Vc 1800 m/min, fz 0.10 mm, Ra 0.8 달성.

**⚠ 흔한 함정.** DLC를 강에 쓰면 탄소가 철로 확산(FeC 형성) → 수초 내 박리. Al/비철 전용.

**관련 개념:** `uncoated` · `zrn-coating` · `wrought-al` · `cast-al` · `iso-n`

*출처: Oerlikon Balzers BALINIT DLC STAR / Harvey Performance DLC Spec*

---

### ZrN (지르코늄 나이트라이드)
*Zirconium Nitride (ZrN)* · id: `zrn-coating`

**초급 (Beginner)**
> 연한 금색/연황색 코팅. 비철·Al용 대안. TiN보다 Al 친화성이 낮아 응착 덜함.

**중급 (Intermediate)**
> ZrN PVD. HV 2800, 내열 600°C. Al·Cu·Ti 저온 응착 억제. vcMultiplier ×1.10. Al 전용 스페셜.

**고급 (Expert)**
> 조성 ZrN stoichiometric, 두께 2-3 μm, HV 2800±200, μ 0.5, 내열 600°C. vcMultiplier ×1.05-1.15. 권장 재질군: Wrought Al(특히 7075), Ti(저속), Cu, 귀금속. 금기: Steel, SS, 주철 (경도 부족). 출처: Oerlikon Balzers BALINIT ZIRENA.

**왜 중요?** 7075처럼 단단한 Al에서 미코팅보다 수명 30% 연장. Ti 저속 다듬질에도 유용.

**실전 예시.** 7075-T6 항공 포켓 ⌀10 3날 ZrN Vc 1800 m/min, fz 0.12 mm, 미코팅 대비 수명 +35%.

**⚠ 흔한 함정.** 강에 잘못 쓰면 수명 TiN 수준. Al/Ti 전용으로 한정.

**관련 개념:** `uncoated` · `dlc-coating` · `al-7075` · `iso-n`

*출처: Oerlikon Balzers BALINIT ZIRENA / Platit Zirconium Coating Data*

---

### CrN (크롬 나이트라이드)
*Chromium Nitride (CrN)* · id: `crn-coating`

**초급 (Beginner)**
> 은회색 코팅. 탭·성형공구에 흔함. 부식·응착에 강하고 생체 친화성도 좋음.

**중급 (Intermediate)**
> CrN PVD 단층/다층. HV 1800, 내열 700°C, 낮은 내부응력으로 두껍게(8-20μm) 코팅 가능. vcMultiplier ×1.05.

**고급 (Expert)**
> 조성 CrN, 두께 2-20 μm (성형공구는 후막), HV 1800±150, μ 0.5, 내열 700°C, 잔류응력 낮음. vcMultiplier ×1.00-1.10. 권장 재질군: 탭가공 전반, 연·중경강, Cu, 식품설비(비독성). 금기: 고속 밀링 (경도 부족), 난삭재. 출처: Oerlikon Balzers BALINIT C.

**왜 중요?** 탭·성형(프레스) 공구의 표준. 연성·인성 중시 응용에 AlTiN 대신.

**실전 예시.** SM45C M12 탭 CrN 코팅 HSS Vc 12 m/min, 수명 2000 hole (TiN의 2배).

**⚠ 흔한 함정.** 엔드밀 고속가공에 쓰면 경도 부족으로 금방 마모. 탭·드로잉 등 저속 전용.

**관련 개념:** `tin-coating` · `altin-coating` · `alcrn-coating`

*출처: Oerlikon Balzers BALINIT C / Sandvik Coromant Thread Tooling*

---

### Diamond CVD (다이아몬드 CVD)
*CVD Diamond Coating* · id: `diamond-cvd`

**초급 (Beginner)**
> 진짜 다이아몬드를 공구에 입힘. 고실리콘 알루미늄·복합재 전용. 강에 쓰면 절대 안 됨.

**중급 (Intermediate)**
> Microcrystalline or nanocrystalline CVD diamond 6-30 μm. HV 9000+, 내열 600°C(공기중). vcMultiplier ×1.40. 초연마성 재료 전용.

**고급 (Expert)**
> 조성 폴리크리스탈 sp3 carbon, 두께 6-30 μm, HV 9000-10000 (PVD 대비 3배), 내열 600°C 공기중 (진공에선 1500°C+), μ 0.1. vcMultiplier ×1.30-1.50. 권장 재질군: 고실리콘 Al(A390, Si≥9%), CFRP/GFRP 복합재, 흑연, 세라믹. 금기: Steel/SS/Ni-base (탄소 확산으로 공구 흑연화·순간 파손), 단속절삭(취성 파괴). 출처: Sumitomo CVD Diamond Datasheet / Sandvik Coromant CoroMill 390 Catalog.

**왜 중요?** CFRP 항공복합재·고실리콘 주조 Al의 유일한 경제적 해답. 코팅 공구가 PCD 솔리드보다 저렴.

**실전 예시.** CFRP 항공스킨 트리밍 ⌀6 2날 CVD Diamond Vc 300 m/min, fz 0.05 mm, 수명 100m (AlTiN의 20배).

**⚠ 흔한 함정.** 강에 쓰면 즉시 탄소 확산으로 공구 흑연화 — 문자 그대로 수초. 재질 확인 절대 실수 금지.

**관련 개념:** `pcd` · `cast-al` · `uncoated` · `iso-n`

*출처: Sumitomo Diamond Coating Datasheet / Sandvik Coromant Composite Machining Guide*

---

### PCD (다결정 다이아몬드)
*Polycrystalline Diamond (PCD)* · id: `pcd`

**초급 (Beginner)**
> 공구 인서트 자체가 다이아몬드 결정. 코팅이 아니라 팁에 다이아몬드 덩어리를 브레이징.

**중급 (Intermediate)**
> Co-bonded 다결정 다이아몬드 팁(0.5-1.5 mm). HV 8000, 내열 700°C. vcMultiplier ×1.50 이상. 고실리콘 Al·복합재 전용.

**고급 (Expert)**
> 조성 입도 2-25 μm 다이아몬드 + Co 5-10% 결합제, HPHT 소결. 두께 0.5-1.5 mm 팁을 WC 모재에 브레이징. HV 7000-9000, 내열 700°C(공기), μ 0.05-0.1. vcMultiplier ×1.40-1.60. 권장 재질군: 고실리콘 Al(A390, Si 17%), CFRP, Cu·Brass 대량생산, MMC. 금기: Fe계(즉시 확산마모), Ni-base, 단속절삭 중충격. 출처: Element Six PCD Grade Guide / Sandvik Coromant CoroMill PCD.

**왜 중요?** 자동차 Al 엔진블록 대량생산의 핵심. 수명 CVD 대비 +50%, 재연마 가능 → 장기 TCO 유리.

**실전 예시.** A380 엔진블록 페이스밀 ⌀125 PCD 인서트 6매 Vc 1200 m/min, fz 0.15 mm, 수명 20,000 parts.

**⚠ 흔한 함정.** PCD는 재연마 가능하지만 전용 EDM 연삭기 필요 — 일반 그라인더에선 다이아몬드 연삭 불가.

**관련 개념:** `diamond-cvd` · `cast-al` · `wrought-al` · `iso-n`

*출처: Element Six PCD Grade Selection Guide / Sandvik Coromant CoroMill PCD Catalog*

---

### TiB2 (티타늄 디보라이드)
*Titanium Diboride (TiB2)* · id: `tib2-coating`

**초급 (Beginner)**
> Al 응착을 막는 은색 세라믹 코팅. 알루미늄에 미코팅·DLC 대안으로 점점 인기.

**중급 (Intermediate)**
> TiB2 PVD 단층. HV 3500, 내열 900°C, 낮은 Al 친화성. vcMultiplier ×1.15. Al/Mg 고속가공 스페셜.

**고급 (Expert)**
> 조성 TiB2 hexagonal, 두께 2-3 μm, HV 3500±300, μ 0.5, 내열 900°C (공기 중 산화 시작), 화학적으로 Al과 비반응. vcMultiplier ×1.10-1.20. 권장 재질군: Wrought Al(2xxx, 7xxx 포함), Mg 합금, 저-중실리콘 Cast Al. 금기: Steel(경제성 낮음), 난삭재. 출처: Platit TiB2 Technical Brief / Kennametal Aluminum Tooling.

**왜 중요?** DLC보다 내열 2배 + Al 응착성 DLC 수준. 고속 Al 드라이가공의 차세대 옵션.

**실전 예시.** 7075-T6 항공 리브 포켓 ⌀10 3날 TiB2 Vc 2200 m/min, fz 0.15 mm, 드라이 에어블라스트.

**⚠ 흔한 함정.** 강에 쓰면 경제적 의미 없음 — AlTiN 대비 비싸고 수명도 떨어짐. Al/Mg 전용으로 명확히.

**관련 개념:** `dlc-coating` · `uncoated` · `zrn-coating` · `al-7075` · `iso-n`

*출처: Platit TiB2 Technical Brief / Kennametal Aluminum Application Guide*

---

## ⑥ 기계·홀더 (Machine / Holder)

### 스핀들 프리셋 (머신 스핀들 규격)
*Spindle Preset* · id: `spindle-preset`

**초급 (Beginner)**
> 공구를 잡는 머신 팔의 규격 모음. BT40·HSK63·CAT40 같은 '표준 사이즈'를 고르면 맞는 척/RPM 한계가 따라옴.

**중급 (Intermediate)**
> 테이퍼 규격(BT/HSK/CAT), 최대 RPM, 최대 파워(kW), 토크 커브(Low/High-gear)를 한 세트로 묶은 프리셋. 시뮬레이터 계산 시 RPM/IPM 상한과 드로바 풀링력이 이 값에 제한된다.

**고급 (Expert)**
> 스핀들 프리셋 = {taperType, maxRPM, peakPowerKW, continuousPowerKW, pullStudForceN, torqueCurve(n)}. 일반 머시닝센터 BT40 8-12k rpm / 15-22 kW, HSK63A 15-24k rpm / 25-40 kW, 고속 HSK63F 30-42k rpm / 15-20 kW. 선택 프리셋의 maxRPM이 n_target(=1000·Vc/πD)보다 낮으면 Vc 재계산 필요. 정밀도 IT5-IT7 범위. 출처: ISO 15488 (HSK), JIS B 6339 (BT).

**왜 중요?** 아무리 공구 스펙이 좋아도 머신 스핀들 한계를 넘으면 계산된 RPM/IPM이 물리적으로 나오지 않는다. 프리셋은 시뮬레이션을 실제 현장 능력에 묶는 앵커.

**실전 예시.** Φ6 엔드밀 Al7075 Vc=400 m/min → n=21,220 rpm. BT40 프리셋(12k rpm)에서는 불가 → HSK63F 프리셋(30k rpm)으로 전환해야 스펙대로 가공 가능.

**⚠ 흔한 함정.** 카탈로그 SFM만 보고 RPM을 계산한 뒤 머신 상한을 잊는 실수. 특히 소경(&lt;Φ3) 고속가공에서 BT40으로는 카탈로그 Vc의 30-50%밖에 못 낸다.

**관련 개념:** `bt40` · `hsk63` · `cat40` · `max-rpm-ipm` · `workholding-security`

*출처: ISO 15488 / JIS B 6339 / Sandvik Coromant Manufacturing Handbook Ch.12*

---

### BT40 (일본 표준 테이퍼)
*BT40 Taper (JIS B 6339)* · id: `bt40`

**초급 (Beginner)**
> 일본식 스핀들 규격. 게이지라인 지름 44.45mm. 전세계 범용 머시닝센터에서 가장 흔함. 저속-중속에 적합.

**중급 (Intermediate)**
> 7/24 테이퍼(경사 3.5°), 드로바가 당겨서 고정. 최대 RPM 8-15k, 연속파워 11-22 kW. 플랜지-스핀들 접촉이 없어 고속에서 원심 팽창으로 공구 길이 오차 발생.

**고급 (Expert)**
> BT40: 게이지 Ø44.45mm, 7/24 taper, pull-stud force 12-18 kN, 정밀도 IT6-IT7 (AT3 등급), 스핀들 원심 팽창으로 20k rpm 이상에서 Z축 drift +20-50 µm. 대표 머신: Doosan DNM 시리즈, Mazak VCN, Makino V33, DMG Mori NVX. 최대 RPM 12,000 / peak 22 kW가 업계 표준 스펙. 출처: JIS B 6339-2 / Smid Machining Handbook §8.

**왜 중요?** BT40은 공장 자산의 60% 이상을 차지하는 가장 흔한 규격. 이걸 기준으로 공구 스펙과 Vc를 잡아야 고객사 현장에서 재현 가능하다.

**실전 예시.** Doosan DNM 5700 (BT40, 12k rpm, 18.5 kW) + Φ10 4날 엔드밀 + SKD11 가공 시 Vc 100 m/min → n=3,183 rpm, IPT 0.05, Fz=637 mm/min. 머신 한계 내 여유 3.8배.

**⚠ 흔한 함정.** BT40에서 Φ3 이하 초소경 공구로 Al 고속가공 시도 → 12k rpm × π × 3 = 113 m/min밖에 안 되어 카탈로그 500 m/min의 22%. 이 경우 HSK63F 권장.

**관련 개념:** `spindle-preset` · `hsk63` · `cat40` · `max-rpm-ipm`

*출처: JIS B 6339-2 / Smid Tool & Manufacturing Engineers Handbook §8*

---

### HSK63 (독일 고속 테이퍼)
*HSK63 Hollow Shank Taper (DIN 69893)* · id: `hsk63`

**초급 (Beginner)**
> 독일식 고속 스핀들 규격. 속이 빈 짧은 테이퍼 + 플랜지 밀착 이중 접촉. 고속에서도 안 흔들림. 고정밀·고속가공 표준.

**중급 (Intermediate)**
> 1/10 short taper + face contact (이중면 밀착). 원심 팽창에도 플랜지가 눌러줘서 Z 길이 안정. HSK63A 일반용, HSK63E 고속, HSK63F 초고속(42k rpm까지).

**고급 (Expert)**
> HSK63: 중공 구조 + face-and-taper dual contact, 드로바 내부 세그먼트 클램핑력 25-40 kN (BT40의 2배). 원심 확장 시 오히려 밀착력 증가 (self-energizing). 정밀도 IT5-IT6, A형 25k rpm · E형 30k rpm · F형 42k rpm. 대표 머신: Makino U6/V33i, DMG Mori HSC 시리즈, Mikron MILL S. 고파워 연속 25-40 kW. 출처: DIN 69893 / ISO 12164.

**왜 중요?** 20k rpm 이상에서 BT40은 원심 팽창으로 공구 길이가 변하고 흔들리지만, HSK는 face contact 덕에 Z 정확도 ±5 µm 유지. 금형/항공 정밀가공 필수.

**실전 예시.** Makino V33i (HSK63A, 30k rpm, 35 kW) + Φ2 볼엔드밀 + STAVAX 하드밀링 Vc 200 m/min → n=31,830 rpm. 머신 30k 상한 근접 → 실제 Vc=188 m/min 사용.

**⚠ 흔한 함정.** HSK63 척을 BT40 스핀들에 어댑터로 물리면 face contact가 사라져 HSK 이점이 소멸. 고속가공 효과 없음.

**관련 개념:** `spindle-preset` · `bt40` · `cat40` · `shrink-fit` · `max-rpm-ipm`

*출처: DIN 69893 / ISO 12164 / Sandvik Coromant Manufacturing Handbook Ch.12*

---

### CAT40 (미국 V-플랜지 표준)
*CAT40 / ANSI B5.50 V-Flange* · id: `cat40`

**초급 (Beginner)**
> 미국 Caterpillar가 정한 스핀들 규격. BT40과 치수는 거의 같은데 드로바 나사/플랜지 각이 다름. 북미 공장에서 주류.

**중급 (Intermediate)**
> 7/24 taper, BT40과 플랜지 외경은 호환되지만 pull-stud 규격(5/8-11 또는 3/4-16)이 달라 상호 교체 불가. 최대 RPM 10-15k, 파워 15-22 kW.

**고급 (Expert)**
> CAT40: ANSI/ASME B5.50, 7/24 taper, Ø44.45mm gauge, pull-stud thread 5/8-11 UNC (retention knob 45°). 정밀도 IT6-IT7 (AT3). 대표 머신: Haas VF/UMC, Hurco VM, Fadal VMC. RPM 12k / peak 22 kW 일반. BT40와의 차이: (1) pull-stud geometry, (2) keyway 위치, (3) 드로바 clamping force 12-15 kN. 출처: ANSI B5.50-1985.

**왜 중요?** 북미 고객사(GE Aviation, Boeing 협력사, Tier-1 automotive)는 CAT40이 기본. 같은 BT40용 홀더 못 씀. 영업 시 견적 전 반드시 확인.

**실전 예시.** Haas VF-2SS (CAT40, 12k rpm, 22.4 kW) + Φ12 인덱서블 엔드밀 + 6061-T6 Al 페이싱 Vc 300 m/min → n=7,958 rpm, Fz 2,547 mm/min.

**⚠ 흔한 함정.** 한국 공장 BT40 홀더 재고를 미국 CAT40 머신에 그대로 쓰려다 pull-stud 미호환으로 전량 재구매. 수출 프로젝트 견적 시 초기 확인 필수.

**관련 개념:** `spindle-preset` · `bt40` · `hsk63` · `max-rpm-ipm`

*출처: ANSI/ASME B5.50-1985 / Smid Tool & Manufacturing Engineers Handbook §8*

---

### ER 콜릿 척
*ER Collet Chuck (DIN 6499)* · id: `er-collet`

**초급 (Beginner)**
> 스프링 같은 얇은 통(콜릿)으로 공구 섕크를 조이는 범용 척. 싸고 종류 많아서 공방의 기본. 대신 흔들림(런아웃)이 좀 있음.

**중급 (Intermediate)**
> ER11/16/20/25/32/40 시리즈, 조임 범위 각 Ø0.5-1 mm 스텝. 런아웃 10-20 µm (카탈로그), 실측 20-40 µm. 토크 전달 섕크 마찰에 의존 → 깊은 절삭 시 공구 슬립 위험. 정밀도 IT8-IT9 수준.

**고급 (Expert)**
> ER collet: 8° taper slotted sleeve, 유효 클램핑 길이 1.0-1.5×D, 정밀도 IT8-IT9, TIR 10-25 µm (AA 등급 5-10 µm). 최대 RPM ~30k (Ø6 기준). 드라이브 토크는 μ(0.15)×F_clamp×D/2, 고토크 작업엔 부족. 대표 공급사: Rego-Fix ER, BIG Kaiser Mega-ER, YG-1 ER. 대표 머신 호환: Doosan/Mazak/Haas 범용 BT40/CAT40. 교체 빈도 높은 범용 라인에 최적. 출처: DIN 6499-1.

**왜 중요?** 가장 저렴하고 공구 Ø 변경 대응이 즉시 가능해 시제품·금형 수리에 압도적 점유. 단점(런아웃·슬립)을 알고 써야 공구수명 판단을 그르치지 않는다.

**실전 예시.** ER25 + Φ10 엔드밀로 SS400 슬로팅 시 런아웃 25 µm → IPT 편차 ±15% → 공구 1날에 부하 몰려 코너 치핑. 열박음으로 교체 시 수명 2.3배.

**⚠ 흔한 함정.** 콜릿과 너트에 칩/오일 끼면 실제 TIR 50 µm까지 증가. 매 교체 시 세정·토크 렌치 사용 필수. 손힘 체결은 언더토크로 슬립 유발.

**관련 개념:** `shrink-fit` · `hydraulic-chuck` · `spindle-preset` · `l-over-d-ratio`

*출처: DIN 6499-1 / Rego-Fix Technical Manual §3*

---

### 열박음 척 (Shrink-Fit)
*Shrink-Fit Holder* · id: `shrink-fit`

**초급 (Beginner)**
> 척을 불(유도가열)로 달궈서 구멍이 커지면 공구를 넣고 식히면 꽉 조여짐. 일체형처럼 붙어서 런아웃이 거의 없음.

**중급 (Intermediate)**
> induction heater로 홀더 ID를 300-400°C 가열, 공구 섕크 h6 공차와 I/D 0.02-0.05 mm 간섭. 런아웃 &lt;3 µm, 강성 ER 대비 1.5-2배. 고속·고정밀용. 최대 RPM 40-50k, 정밀도 IT5.

**고급 (Expert)**
> Shrink-fit: interference fit 20-50 µm/Ø, clamping force 30-40 kN (ER의 1.5배), TIR ≤3 µm, 균형 G2.5@25k rpm. 최대 RPM 40-50k. Slim-line 타입 노즈 Ø≤공구Ø+2mm로 협소 가공 유리. 단점: 공구 길이 고정, 세팅 2-3분 소요, 초경 전용(HSS 불가, 열팽창 계수 차이). 대표: BIG Kaiser Mega EA, Nikken NC Shrink, Haimer Power Shrink. 대표 머신: Makino HSK63A / DMG Mori HSC. 출처: VDI 3376.

**왜 중요?** 흑연/CFRP/하드밀링처럼 공구 런아웃이 수명에 지배적인 공정에서 열박음은 ER 대비 수명 2-4배. HSK63+Shrink-fit은 고속가공 '정답'.

**실전 예시.** STAVAX 52HRC 금형 Ø6 볼엔드밀 하드밀링: ER TIR 20 µm → 수명 80분 / Shrink-fit TIR 2 µm → 수명 240분. 3배 연장으로 무인가공 1 shift 가능.

**⚠ 흔한 함정.** HSS 공구를 열박음에 끼우려다 홀더 냉각 중 섕크가 영구 변형. 초경(HSS보다 열팽창 ⅓) 전용임을 잊지 말 것.

**관련 개념:** `er-collet` · `hydraulic-chuck` · `hsk63` · `l-over-d-ratio`

*출처: VDI 3376 / Haimer Technical Handbook / Sandvik Coromant Manufacturing Handbook Ch.12*

---

### 유압 척
*Hydraulic Chuck* · id: `hydraulic-chuck`

**초급 (Beginner)**
> 척 안에 기름이 차 있어서 렌치로 돌리면 기름 압력이 얇은 벽을 안쪽으로 눌러 공구를 잡음. 교체 30초, 런아웃 낮음.

**중급 (Intermediate)**
> 내부 피스톤이 membrane(얇은 슬리브)을 유압으로 균일 압박 → TIR 3-5 µm, 진동 감쇠 효과 있어 thin-wall 가공에 유리. 최대 RPM 25-30k, 정밀도 IT6.

**고급 (Expert)**
> Hydraulic chuck: 내부 pressure chamber → expansion sleeve (두께 0.3-0.5 mm) 균일 수축, clamping force 20-30 kN (열박음의 70-80%), TIR 3-6 µm, 진동 감쇠 ~2배 (vs shrink-fit, 내부 오일이 댐퍼 역할). 최대 RPM 25k @ balance G2.5. 세팅 torque 렌치만 있으면 30초, 열 필요 없음. 대표: Schunk Tendo, Kennametal HydroForce, BIG Kaiser Hydro. 대표 머신: Mazak VCN / DMG Mori DMU. 섕크 Weldon 플랫 허용 여부는 모델별 상이. 출처: Schunk Technical Catalogue §4.

**왜 중요?** 열박음만큼 정밀하면서 현장 교체 빠름 + 진동 감쇠로 thin-wall/잔류응력 부품 가공 시 재생(regeneration) 채터 억제에 유리.

**실전 예시.** Ti-6Al-4V thin-wall rib 가공: ER TIR 15 µm·채터 발생 / Hydraulic TIR 4 µm·진동 -6 dB → 표면조도 Ra 3.2 → 1.6 개선.

**⚠ 흔한 함정.** 척 내부 오일 누설 시 clamping force 50% 이하로 급감 → 공구 슬립. 6개월마다 누유/압력 점검, 정기 교체.

**관련 개념:** `er-collet` · `shrink-fit` · `workholding-security`

*출처: Schunk Technical Catalogue §4 / Smid Machining Handbook §9*

---

### Workholding Security (고정 강성)
*Workholding Security / Rigidity* · id: `workholding-security`

**초급 (Beginner)**
> 공작물을 얼마나 단단하게 잡았는지. 흔들리면 깊게 못 깎는다. 바이스·클램프·지그로 꽉 잡아야 공구가 자기 실력 발휘.

**중급 (Intermediate)**
> 공작물·지그·테이블 시스템 강성(N/µm). 낮으면 채터·치수 불량. 시뮬레이터는 Security Factor (0.5-1.2)로 MRR·ADOC 상한 조정.

**고급 (Expert)**
> Security factor k_ws: Poor=0.6 (single-point clamp, 긴 overhang), Fair=0.8 (vise, 표준), Good=1.0 (dedicated fixture + 3-point), Excellent=1.2 (rigid fixture + damping). 실효 Fz_max = Fz_catalog × k_ws, ADOC_max 비례. 정량 지표: 시스템 정적 강성 20-200 N/µm, dynamic stiffness at chatter freq &gt; 50 N/µm 권장. 테이블 정밀도 IT7 이상, 대표 머신 base rigidity: Makino V33i 150 N/µm급 / Doosan DNM 80 N/µm급. 측정: 해머 임팩트 테스트 → FRF. 출처: Tobias 'Machine Tool Vibration' / Altintas 'Manufacturing Automation' §4.

**왜 중요?** 같은 공구·같은 머신이라도 공작물 고정이 부실하면 카탈로그 MRR의 50%도 못 낸다. Vc·IPT보다 먼저 확보할 기본 변수.

**실전 예시.** Al 블록 바이스 단일 고정(k_ws=0.7) → HEM 시도 시 채터 / 저면 3점 볼트 + side support(k_ws=1.0) → 동일 파라미터에서 채터 소멸, MRR 1.4배.

**⚠ 흔한 함정.** thin-wall/오버행 부품을 바이스만 믿고 고정 → 외력에 진동, 치수 ±50 µm 편차. Form-fit 지그 또는 low-melt 고정재 필요.

**관련 개념:** `l-over-d-ratio` · `spindle-preset` · `hydraulic-chuck`

*출처: Altintas 'Manufacturing Automation' §4 / Sandvik Coromant Manufacturing Handbook Ch.11*

---

### 머신 최대 RPM/IPM 한계
*Machine Max RPM / Feedrate Limit* · id: `max-rpm-ipm`

**초급 (Beginner)**
> 머신이 낼 수 있는 최고 회전수와 최고 이송속도. 계산된 값이 이 한계를 넘으면 '현실에선 불가능'.

**중급 (Intermediate)**
> maxRPM(스핀들 상한)·maxIPM(축 이송 상한, 보통 X/Y 30-60 m/min, Z 20-40 m/min)·rapid_traverse 별도. 실제 허용은 accel 제한으로 짧은 구간에선 이론치의 50-70%. 위치결정 정밀도 IT5-IT6.

**고급 (Expert)**
> 한계 요소: (1) 스핀들 maxRPM — 베어링·밸런스·드로바, (2) servo axis max feed (rapid) — ballscrew pitch × motor rpm, (3) linear accel 0.3-2 g (리니어축 5-20 m/s²), (4) look-ahead block buffer. 고속가공에선 programmed F가 나오려면 segment 길이 ≥ F²/(2·a). 예: F=10 m/min, a=5 m/s² → min segment 5.6 mm. 아래면 코너 감속. 대표 스펙: Makino iQ500 40k rpm / 60 m/min · 20 kW, Doosan DNM 5700 12k rpm / 36 m/min · 18.5 kW, DMG Mori DMU 65 18k rpm / 50 m/min, Mazak Variaxis 12k rpm / 42 m/min. 출처: Sandvik Manufacturing Handbook Ch.12 / Smid §8.

**왜 중요?** 카탈로그상 Vc=500, Fz=5,000 mm/min이라도 머신 30 m/min 상한에서 잘린다. 시뮬레이터가 'machine-limited' 경고를 띄우는 이유.

**실전 예시.** Al7075 Φ8 Z3 Vc 500 → n=19,894 rpm, Fz 0.08×3×19,894=4,775 mm/min. 머신 maxIPM 30,000 mm/min 여유. 하지만 maxRPM 15k인 머신에선 n=15k 제한, Vc 실효 377 m/min.

**⚠ 흔한 함정.** tool path에 G0 rapid 구간이 많으면 rapid traverse(보통 48-60 m/min)로 속도 나오지만, G1 cutting feed는 별도 한계. 혼동하면 사이클 타임 견적 오차 ±20%.

**관련 개념:** `spindle-preset` · `bt40` · `hsk63` · `workholding-security`

*출처: Sandvik Coromant Manufacturing Handbook Ch.12 / Smid §8*

---

### L/D 비율 (공구 돌출 대 직경)
*L/D Ratio (Overhang-to-Diameter)* · id: `l-over-d-ratio`

**초급 (Beginner)**
> 공구가 척 밖으로 얼마나 길게 나왔나 / 공구 지름. 숫자 크면 휘청거려 깊게 못 깎음. 3 이하가 안전, 5 넘으면 위험.

**중급 (Intermediate)**
> L/D=3: rigid, 카탈로그 파라미터 100%. L/D=4: SFM/IPT 70-80%. L/D=5: 50-60%. L/D&gt;6: 30% 이하 + chatter-tuned 절삭. 공구 편향 δ = F·L³/(3·E·I) → L³에 비례. 정밀도 IT 유지엔 L/D≤4 권장.

**고급 (Expert)**
> Cantilever deflection δ = F·L³/(3·E·I), I=π·D⁴/64 → δ ∝ (L/D)³. 초경 E=600 GPa. 표준 보정: L/D≤3 → 100%, 4 → 80%, 5 → 60%, 6 → 40%, 7+ → 25% (Vc·Fz 둘 다). 정적 강성 k_tool = 3·E·I/L³. 동적: 공구 1차 고유진동수 f₁ = (1.875²/2π)·√(E·I/(ρ·A·L⁴)) → 고L/D에서 낮아져 저RPM 채터 발생. 대응: 초경 H/W 섕크, 진동 감쇠 홀더(damped boring bar: Sandvik Silent Tools, Kennametal KM), 경량 절삭(light HEM). 대표 머신: Makino/Mazak 5-axis에서 L/D 6+ 딥캐비티 가공 시 damped holder 필수. 출처: Altintas 'Manufacturing Automation' §3 / Harvey Performance Deep Cavity Guide.

**왜 중요?** L/D는 3제곱으로 편향을 증폭하는 가장 강력한 절삭력 변수. 딥캐비티/긴 리브 가공 시 Vc/IPT 수정보다 L/D 자체를 줄이는 게 우선.

**실전 예시.** Φ10 엔드밀, L/D=3 → δ=8 µm @ 300N, 정상 MRR. L=60 (L/D=6) → δ=64 µm, 채터 발생. 대응: 공구 스텝 피치 다운 + Fz 40%로 + trochoidal 전환.

**⚠ 흔한 함정.** 깊은 포켓 가공 시 stick-out만 늘려 한번에 해결하려다 L/D=7 초과 → 공구 파손. 2-step(긴 roughing + 짧은 finishing) 분할이 정답.

**관련 개념:** `workholding-security` · `shrink-fit` · `er-collet` · `spindle-preset`

*출처: Altintas 'Manufacturing Automation' §3 / Harvey Performance Deep Cavity Milling Guide*

---

## ⑦ 가공 공정 (Operation)

### 슬로팅 (홈가공)
*Slotting* · id: `slotting`

**초급 (Beginner)**
> 공구 지름 그대로 홈을 파는 가공. 공구의 양쪽 날이 모두 재료와 닿아서 힘이 두 배. 가장 힘든 공정.

**중급 (Intermediate)**
> RDOC=100%D (full slot). 칩 배출 공간 부족으로 재칩핑(re-cutting) 발생 가능. 권장 ADOC 0.5-1.0×D, SFM -30% 보정, IPT -20% 보정. 탄소강/스테인리스/공구강 일반적.

**고급 (Expert)**
> Slotting: RDOC=100%D, ADOC≤1.0×D (일반강), ≤0.5×D (Inconel/Ti). Chip load 양쪽 대칭 → Fz 2배 부하. 파라미터 보정: Vc×0.7, IPT×0.8 (대비 side milling), power ≈ 2× side milling. 적합 재질: low-C steel, 304 SS, Al. 기피: hardened steel &gt;50 HRC (trochoidal 대체), Inconel (HEM 권장). Chip evacuation 필수 → through-spindle coolant 또는 air blast. 출처: Sandvik Coromant Turning & Milling Handbook §5.

**왜 중요?** 슬로팅은 가장 가혹한 밀링 조건이라 공구 수명·파손 판단의 벤치마크가 된다. 슬롯을 가능하다면 trochoidal/HEM으로 회피하는 게 현대 전략.

**실전 예시.** SCM440 Ø10 Z4 엔드밀 슬로팅: Vc 80 m/min(사이드 120의 67%), IPT 0.04, ADOC 8 mm. Fz=510 mm/min, MRR 40.8 cm³/min.

**⚠ 흔한 함정.** 슬로팅에서 IPT를 사이드밀링과 동일하게 잡으면 공구 치핑. 반드시 -20% 보정. 또한 ADOC를 1×D 넘기면 칩 배출 막혀 공구 파손.

**관련 개념:** `side-milling` · `trochoidal` · `hem` · `adaptive-clearing` · `through-spindle`

*출처: Sandvik Coromant Turning & Milling Handbook §5*

---

### 사이드 밀링 (측면가공)
*Side / Peripheral Milling* · id: `side-milling`

**초급 (Beginner)**
> 공구 옆면으로 재료 측면을 깎는 가공. 한쪽 날만 일하니까 슬로팅보다 훨씬 편함. 가장 일반적인 형태.

**중급 (Intermediate)**
> RDOC &lt; 공구 Ø(보통 10-50%D). ADOC 크게 가능(1-3×D). climb/conventional 선택에 따라 표면 조도·공구수명 차이. 카탈로그 '기준' 조건이 side milling.

**고급 (Expert)**
> Side milling: RDOC 0.1-0.5×D (표준), ADOC 1-3×D. Climb (상향절삭) 권장: Fz 감소, 표면 Ra 개선, 공구수명 1.3배. Conventional (하향) 시 표면 경화층에 먼저 닿아 work-hardening 리스크. Chip thinning 보정: hex = IPT·√(1-(1-2RDOC/D)²), RDOC&lt;D/2에서 실효 chip load↓. 보정 적용 시 IPT×1.3-1.8 상향. 적합 재질: 전 재질 범용. SFM 100% (기준). 출처: Sandvik Milling Handbook §6 / ISO 3685.

**왜 중요?** 카탈로그의 Vc/Fz는 'RDOC 50% 사이드밀' 전제. 다른 공정은 여기서 보정해서 쓴다. 시뮬레이터의 '기준점'.

**실전 예시.** 6061-T6 Al Ø12 Z3 사이드밀 Vc 350 m/min, RDOC 3 mm (25%D), ADOC 20 mm, IPT 0.10 × chip-thinning ×1.5=0.15. Fz=4,178 mm/min.

**⚠ 흔한 함정.** RDOC를 5%D 이하로 좁히면 chip thinning으로 실효 chip load 극저 → 공구와 재료 '스치기' → rubbing/glazing 마모 가속. IPT 상향 필수.

**관련 개념:** `slotting` · `hem` · `finishing` · `trochoidal` · `profiling`

*출처: Sandvik Coromant Milling Handbook §6 / ISO 3685*

---

### HEM (High Efficiency Milling)
*HEM — High Efficiency Milling* · id: `hem`

**초급 (Beginner)**
> 공구를 깊게 꽂고 얇게 옆으로 가는 기법. 공구 전체가 고르게 닳아서 오래 쓸 수 있음. 같은 시간에 더 많이 깎음.

**중급 (Intermediate)**
> ADOC 크게(2-3×D), RDOC 작게(5-15%D). Chip-thinning으로 IPT 상향. MRR 3-5배·공구수명 3-5배 동시 달성. 현대 CAM(HSM, Adaptive)의 기본 전략.

**고급 (Expert)**
> HEM: RDOC 5-15%D, ADOC 2-3×D. Chip thinning RCTF = √(1-(1-2·RDOC/D)²), 적용하여 IPT_program = IPT_cat / RCTF 상향 보정. 결과: MRR×3-5 + Tool Life×3-5 동시 달성 (열부하 분산 + 절삭 아크 짧음). SFM +20-30% 허용. 적합 재질: 전 재질 특히 SS/Inconel/Ti/hardened steel (≤55 HRC)에서 효과 극대. 머신: rigid high-feed, 룩어헤드 buffer 충분해야. 출처: Harvey Performance HEM Guidebook / Makino High Feed Milling Technical Bulletin.

**왜 중요?** 같은 공구·같은 머신으로 MRR 3배·공구수명 3배. 현대 가공 생산성의 게임체인저. 시뮬레이터의 'HEM 모드'는 항상 먼저 검토할 옵션.

**실전 예시.** Inconel 718 Ø10 Z5: 전통 슬로팅 Vc 30, IPT 0.04, ADOC 3, MRR 7.2 cm³/min / HEM Vc 40, IPT 0.08(×1.8 RCTF), ADOC 25, RDOC 1, MRR 25 cm³/min. 3.5배.

**⚠ 흔한 함정.** 머신 강성 부족(soft BT40 + 긴 스틱아웃) + HEM → 채터로 오히려 공구 파손. 반드시 rigid 환경(HSK+짧은 L/D) 확인 후 적용.

**관련 개념:** `trochoidal` · `adaptive-clearing` · `dynamic-milling` · `slotting` · `side-milling`

*출처: Harvey Performance HEM Guidebook / Makino High Feed Milling Technical Bulletin*

---

### 피니싱 (마감가공)
*Finishing* · id: `finishing`

**초급 (Beginner)**
> 마지막에 표면을 예쁘게 다듬는 가공. 얇게, 빠르게, 살살. 공구 새것 쓰고 치수 정확하게 맞춤.

**중급 (Intermediate)**
> 얕은 ADOC(0.1-0.5 mm)·좁은 RDOC(&lt;10%D)·높은 Vc(+20%)·낮은 IPT(0.02-0.05). 목표: Ra &lt; 1.6 µm, 치수 IT6-7. 볼·코너 R 엔드밀 위주.

**고급 (Expert)**
> Finishing: ADOC 0.1-0.5 mm, RDOC 2-10%D (stepover), Vc ×1.2 (카탈로그 대비), IPT 0.02-0.05 mm/tooth. Surface roughness: Ra_theoretical = (stepover)²/(8·R_tip) for 볼엔드밀. 예: Ø6 볼, stepover 0.15 → Ra=0.47 µm. Cusp height h = R - √(R²-(s/2)²). 적합 재질: 전 재질, 특히 하드밀링(50-65 HRC)·금형강. 공구: 코팅 AlTiN/TiSiN, 볼·코너R, TIR &lt;5 µm 필수 (shrink-fit). 출처: Smid §14 / Sandvik Surface Finish Handbook.

**왜 중요?** 최종 품질(치수/조도)이 결정되는 단계. 앞 공정 대비 0.1-0.5 mm만 남기는 stock 관리가 핵심. 너무 많이 남기면 편향, 너무 적으면 프리 쿨런트 마모.

**실전 예시.** STAVAX 54HRC Ø4 볼엔드밀 하드밀링 피니싱: Vc 150, RPM 11,937, IPT 0.03, stepover 0.08, MRR 1.1 cm³/min, Ra 0.4 µm (mirror-like).

**⚠ 흔한 함정.** 피니싱에 rough 공구를 그대로 써서 마모된 날끝으로 진행 → 치수 편차 ±20 µm. 반드시 finishing 전용 공구(TIR &lt;5 µm) 교체.

**관련 개념:** `profiling` · `side-milling` · `shrink-fit` · `altin-coating`

*출처: Smid §14 / Sandvik Surface Finish Handbook*

---

### 프로파일링 (윤곽가공)
*Profiling / Contouring* · id: `profiling`

**초급 (Beginner)**
> 벽이나 외곽 곡선을 따라가며 깎는 가공. 부품 옆모습을 완성시키는 단계. 코너에서 속도가 순간적으로 느려짐.

**중급 (Intermediate)**
> 2D/3D 윤곽을 따라 공구가 이동. RDOC 10-30%D, ADOC 0.5-1.5×D 일반. 코너 감속(deceleration) 발생 → 공구 부하 변동. climb 원칙.

**고급 (Expert)**
> Profiling: RDOC 0.1-0.3×D, ADOC 0.5-1.5×D. 코너 진입 시 '효과적 engagement' 순간 증가(내측 코너) → Fz 스파이크 1.5-2배. 대응: (1) arc-in/arc-out, (2) 코너 feed override 50-70%, (3) CAM trochoidal corner. SFM 기준의 ±10%, IPT는 climb 카탈로그값. 적합 재질: 전 재질. 공구: 4-6 날 엔드밀(표면), 2-3 날(러핑). 머신 look-ahead buffer 충분해야 코너 정밀 확보. 출처: Sandvik Milling Handbook §7 / Mastercam Profile Strategy Guide.

**왜 중요?** 부품 외관·치수를 결정하는 윤곽 공정. 코너 부하 스파이크를 이해 못하면 공구 치핑 반복. CAM 전략에서 arc-in/out이 기본.

**실전 예시.** 6061 Ø8 Z4 프로파일링 외곽 800 mm: Vc 280 m/min, n 11,141 rpm, IPT 0.08, RDOC 2, ADOC 12, Fz 3,565 mm/min. 사이클 13.5 초.

**⚠ 흔한 함정.** 내측 코너에서 feed override 미적용 → 공구 코너 치핑 → 치수 불량 ±30 µm. CAM에서 코너 smoothing 필수 설정.

**관련 개념:** `side-milling` · `finishing` · `pocketing` · `adaptive-clearing`

*출처: Sandvik Milling Handbook §7 / Mastercam Profile Strategy Guide*

---

### 포켓팅 (포켓가공)
*Pocketing* · id: `pocketing`

**초급 (Beginner)**
> 블록 안에 박스 모양 구멍을 파는 가공. 안에 들어간 공구가 빠져나올 수 없어서 칩 빼내기가 어려움.

**중급 (Intermediate)**
> closed pocket을 가공. 진입은 ramping/helical/plunging, 내부는 zigzag/spiral/adaptive. 칩 배출·coolant 접근성이 제일 중요.

**고급 (Expert)**
> Pocketing: 표준 RDOC 40-60%D (zigzag), ADOC 0.5-1.5×D. 현대 방식: adaptive(RDOC 10-15%D·ADOC 2×D) + trochoidal 코너. 진입 전략: (1) ramping angle 2-5° (가장 범용), (2) helical bore 1×D 구멍 후 plunge, (3) pre-drill hole 후 plunge. 적합 재질: 전 재질. SFM ±0 (표준), IPT 표준. Chip evacuation 난이도↑ → through-spindle coolant 강력 권장. 출처: Sandvik Coromant Pocketing Guide / Mastercam HSM.

**왜 중요?** 금형/항공/자동차 부품의 40% 이상이 포켓 형상. 진입·칩 배출 전략이 사이클 타임과 공구 수명의 80%를 결정.

**실전 예시.** Al6061 100×60×25 포켓 Ø10 Z3: 전통 zigzag 45 sec + 공구수명 3 pc/life / Adaptive(RDOC 1.5, ADOC 20) 18 sec + 12 pc/life. 2.5배 단축·4배 수명.

**⚠ 흔한 함정.** closed 포켓에서 plunge 진입 시 non-center cutting 엔드밀 사용 → 날 중심부 충돌·파손. helical 진입 또는 center-cutting 스펙 확인 필수.

**관련 개념:** `adaptive-clearing` · `trochoidal` · `ramping` · `plunging` · `through-spindle`

*출처: Sandvik Coromant Pocketing Guide / Mastercam Dynamic Milling Documentation*

---

### 페이싱 (면삭)
*Facing* · id: `facing`

**초급 (Beginner)**
> 재료 윗면을 평평하게 깎아내는 가공. 소재 표면의 녹·스케일 제거하고 기준면 만들기. 큰 면삭 커터로 한 번에.

**중급 (Intermediate)**
> Ø 50-125 mm face mill, RDOC 60-80%D, ADOC 1-5 mm (1회), IPT 0.1-0.3. 중복율 70% 권장. 표면 마감도 겸비.

**고급 (Expert)**
> Facing: face mill Ø 50-160 mm (주로 인덱서블), RDOC 60-80%D of cutter, ADOC 0.5-5 mm, IPT 0.10-0.25. 진입·이탈 arc 적용으로 치핑 방지 (inserted cutter는 entry angle critical). SFM 카탈로그 기준 ±10%, entry angle 45° 페이스밀은 chip thinning 1.4배 → IPT 상향. 적합 재질: 전 재질. 목적: (1) 기준면, (2) 스케일 제거, (3) 마감. 대표 공구: Sandvik 345 face mill, Mitsubishi WNEU, Kennametal KSHP. Ra 1.6-3.2 달성. 출처: Sandvik Face Milling Handbook / ISO 6462.

**왜 중요?** 첫 공정 '기준면 만들기'는 이후 모든 치수의 origin. 비뚤거나 스케일이 남으면 후속 공정 누적오차로 이어져 치수 불량 다발.

**실전 예시.** SS400 300×200 블록 기준면: Ø80 인덱서블 Z6, Vc 250 m/min, n 995 rpm, IPT 0.20, Fz 1,194 mm/min, RDOC 56 (70%), ADOC 2. 1패스 30 sec.

**⚠ 흔한 함정.** 인덱서블 페이스밀 날 중 1개만 마모·손상 → 표면에 일정 간격 scratch stripe. 매 교체 전 인서트 전수 검사 필수.

**관련 개념:** `side-milling` · `finishing` · `profiling`

*출처: Sandvik Face Milling Handbook / ISO 6462*

---

### Trochoidal (트로코이달)
*Trochoidal Milling* · id: `trochoidal`

**초급 (Beginner)**
> 공구가 원을 그리면서 슬슬 앞으로 나가는 기법. 공구와 재료가 잠깐만 닿아서 열이 덜 나고 오래 씀.

**중급 (Intermediate)**
> 슬로팅에서 공구 직경보다 좁은 폭으로 원호 진입. RDOC 5-15% × LOC 전체 활용. Inconel/경화강 슬롯가공 표준.

**고급 (Expert)**
> Trochoidal: circular/epicycloidal 진동 경로, RDOC 5-15%D, ADOC 1-3×D (LOC 전체), step_forward = RDOC·k (k=0.5-1). SFM +30-50%, IPT_prog = IPT/RCTF 상향. 한 사이클 arc engagement ≤90° → heat sink 시간 충분. 적합 재질: Inconel 718, 300M steel, SKD11, Stavax 55-62HRC, Ti-6Al-4V (슬로팅 조건에서 특히 유리). 공구수명 전통 슬로팅 대비 3-10배. CAM: Mastercam Dynamic Mill, Fusion Adaptive, Siemens NX Adaptive. 출처: Volumill Technical Whitepaper / Sandvik HRSA Machining Guide.

**왜 중요?** Inconel·경화강에서 전통 슬로팅은 공구 수명 5-10분. Trochoidal로 바꾸면 30-50분. 경제성의 본질적 격변.

**실전 예시.** Inconel 718 Ø10 Z5 슬롯 폭 12mm: 전통 슬롯 Vc 25, IPT 0.04, 5분에 공구 치핑 / Trochoidal Vc 40, IPT 0.06, ADOC 25, RDOC 1.5, 수명 42분.

**⚠ 흔한 함정.** CAM에서 trochoidal step-over를 RDOC의 100%로 잡으면 각 회전 간 재료 겹침 없음 → 가공 안 됨. step-over/RDOC = 0.3-0.7 유지 필수.

**관련 개념:** `slotting` · `hem` · `adaptive-clearing` · `dynamic-milling`

*출처: Volumill Technical Whitepaper / Sandvik HRSA Machining Application Guide*

---

### Adaptive Clearing (적응 가공)
*Adaptive Clearing* · id: `adaptive-clearing`

**초급 (Beginner)**
> CAM이 공구 부하를 일정하게 유지하면서 길을 만들어주는 똑똑한 가공. 코너에서도 속도 안 떨어짐.

**중급 (Intermediate)**
> 일정 engagement angle(보통 30°)을 유지하는 경로 생성. HEM의 CAM 구현. Fusion 360/HSMWorks의 'Adaptive' 전략.

**고급 (Expert)**
> Adaptive Clearing: CAM engine이 공구와 재료의 tool engagement angle(TEA)을 상수(일반 30-60°)로 유지하는 경로 계산. RDOC 5-15%D·ADOC 2-3×D로 HEM 조건을 자동 생성. Chip thinning 보정 자동 IPT 상향. 전통 pocket(RDOC 50%)대비 MRR 2-4배, 공구수명 3-5배. CAM 구현: Autodesk HSM/Fusion 'Adaptive', Mastercam Dynamic, Siemens NX HSC, PowerMill Vortex. 적합 재질: 전 재질, 특히 Inconel/Ti/hardened. SFM +20-30%. 출처: Autodesk HSM Documentation / CAM Industry Review.

**왜 중요?** HEM의 이점을 CAM이 자동으로 만들어줘서 프로그래머가 수작업으로 chip thinning 계산 안 해도 된다. 현대 CAM의 표준 기능.

**실전 예시.** P20 금형강 200×150 포켓 Ø10 Z4: 전통 zigzag 4분 + 공구 2 pc / Adaptive(TEA 45°, RDOC 1.2, ADOC 20) 1분 40초 + 공구 5 pc. 2.4배·2.5배.

**⚠ 흔한 함정.** Adaptive 경로는 G-code block 수 5-10배 증가. 구형 컨트롤러(FANUC 0i 이전) look-ahead 부족으로 programmed feed 못 냄 → 실 사이클 2배.

**관련 개념:** `hem` · `trochoidal` · `dynamic-milling` · `pocketing`

*출처: Autodesk HSM Documentation / Mastercam Dynamic Milling Technical Guide*

---

### Dynamic Milling (다이나믹 밀링)
*Dynamic Milling (Mastercam)* · id: `dynamic-milling`

**초급 (Beginner)**
> Mastercam이 만든 똑똑한 가공 전략. Adaptive와 비슷한데 더 정교하게 칩 두께를 관리. 경로가 부드럽고 공구가 오래 감.

**중급 (Intermediate)**
> engagement 제어 + micro-lifts(순간 떼기)로 잔열 제거. ADOC 2-3×D, RDOC 5-10%D. Mastercam 전용 용어지만 개념은 HEM과 동일.

**고급 (Expert)**
> Dynamic Milling: Mastercam의 HEM 구현. 특징: (1) micro-lift motion (공구가 0.1mm 순간 떨어져 재접촉, 열 해소), (2) peel/core mill 옵션 분리, (3) back-feed motion (비절삭 구간 high feed rapid). 표준 파라미터 RDOC 5-10%D, ADOC 2-3×D, stepdown 2-3×D, entry helical. Chip thinning 자동. SFM +30%, IPT 1.5-2× 상향. 적합 재질: 전 재질 (특히 스테인리스 17-4PH, Inconel, Ti, 하드밀링 55HRC 이하). 대표 머신: rigid BT40/HSK 머시닝센터 룩어헤드 600+ block. 출처: Mastercam Dynamic Motion Technical White Paper (2019).

**왜 중요?** Mastercam 점유율 한국 40%+, 한국 영업에선 'Dynamic' 용어가 사실상 HEM의 대명사. 고객 대화 시 호환 용어로 숙지 필수.

**실전 예시.** 17-4PH SS Ø8 Z4 포켓 100×80×15: 전통 contour 3:20 + 공구 2 pc / Dynamic(RDOC 0.6, ADOC 14, Vc 180, IPT 0.10) 1:10 + 5 pc. 2.9배 단축.

**⚠ 흔한 함정.** Dynamic 경로를 구형 컨트롤러(FANUC 0i Mate-D 등)에서 실행 시 block 과다로 feed 50% drop. 최신 31i/MB 또는 Siemens 840D 권장.

**관련 개념:** `hem` · `trochoidal` · `adaptive-clearing` · `pocketing`

*출처: Mastercam Dynamic Motion Technical White Paper (2019) / Harvey Performance HEM Guidebook*

---

### Ramping (나선 진입)
*Ramping / Helical Entry* · id: `ramping`

**초급 (Beginner)**
> 공구가 비스듬하게 또는 나선을 그리며 재료로 들어가는 방식. 수직 찍기보다 부드러워서 공구가 안 부러짐.

**중급 (Intermediate)**
> ramp angle 1-5° (linear ramp) 또는 helical (0.3-0.7×D 직경 나선). non-center cutting 엔드밀에서도 사용 가능. 포켓 진입의 기본.

**고급 (Expert)**
> Ramping: (1) linear ramp angle 2-5° (일반강), 1-2° (Inconel), 5-8° (Al), (2) helical bore: diameter 0.5-0.7×D_tool, pitch (Z 하강)/rev = ramp_angle·π·D_helix. ADOC_effective = full LOC, RDOC 50%D. 진입 Fz: IPT_ramp = IPT_side × cos(ramp_angle). 적합: 모든 closed pocket 진입, 비관통 hole bore. 대안 plunging(수직)은 center-cutting 엔드밀만, non-center 엔드밀은 반드시 ramping. 출처: Sandvik Milling Entry Strategy Guide / Harvey Performance Tool Engagement Guide.

**왜 중요?** 포켓 가공 100% 진입 단계이며, 진입 실수는 공구 파손 #1 원인. Ramp angle 선택이 CAM 프로그래밍의 기본.

**실전 예시.** SCM440 closed pocket Ø10 4날: helical bore Ø5 진입, pitch 0.3 mm/rev, Vc 120, n 3,820 rpm, Fz 1,146 mm/min, ADOC 15mm 진입 시간 3.9 sec.

**⚠ 흔한 함정.** non-center cutting 엔드밀(일반 4날 square)로 수직 plunge → 중심부 날 없어 rubbing → 1-2초 내 공구 파손. ramp 또는 pre-drill 필수.

**관련 개념:** `plunging` · `pocketing` · `adaptive-clearing`

*출처: Sandvik Milling Entry Strategy Guide / Harvey Performance Tool Engagement Guide*

---

### Plunging (수직 진입)
*Plunging / Z-Axis Drilling* · id: `plunging`

**초급 (Beginner)**
> 드릴처럼 공구를 재료에 수직으로 찍는 방식. center-cutting 엔드밀만 가능. 빠르지만 부하가 큼.

**중급 (Intermediate)**
> Z축 방향 직진 진입. center-cutting 엔드밀(중심 날 있음) 또는 plunge mill 전용 공구 필요. ADOC/rev=IPT·Z_teeth. RDOC=100%(slot).

**고급 (Expert)**
> Plunging: Z-axis only 진입, Vc (sfm) 드릴링 조건 적용(카탈로그 Vc×0.5-0.7), IPT_plunge = 0.02-0.05 mm/tooth (IPT_side의 30-50%). 공구 요건: center-cutting end mill 또는 전용 plunge mill (2-4 flute, 반경 0.5°-1° relief). 칩 배출 위해 peck cycle (G83) 권장: peck depth 0.5-1×D. ADOC_max 1.5-2×D. 적합: pre-drill 없는 포켓 진입, 깊은 hole bore. 기피: long-reach (L/D&gt;4) tool 파손 위험↑. 출처: Harvey Performance Plunge Milling Guide / Smid §11.

**왜 중요?** pre-drill 없이 포켓 진입 가능해 CAM setup 시간 절약. 다만 공구·파라미터 잘못 선택 시 ramping보다 파손율 3배.

**실전 예시.** A5052 Ø10 4F center-cutting plunge, Vc 100 m/min, n 3,183, IPT 0.04, Fz(Z) 509 mm/min, peck 5mm × 3 → 15mm 홀 1.8sec + retract.

**⚠ 흔한 함정.** 카탈로그에 'center cutting'이라고 해도 실제 중심부 직경 ≠ 전체 Ø → chip load 계산 시 유효 날수 효과적으로 2날로 봐야함. IPT 과대 → 파손.

**관련 개념:** `ramping` · `slotting` · `pocketing`

*출처: Harvey Performance Plunge Milling Guide / Smid Tool Engineers Handbook §11*

---

## ⑧ 쿨런트 (Coolant)

### Flood (대량 범람)
*Flood Coolant* · id: `flood-coolant`

**초급 (Beginner)**
> 공작기계 위에 쿨런트를 마구 쏟아붓는 방식. 가장 확실한 냉각. 바닥에 떨어진 쿨런트를 펌프로 순환시킴.

**중급 (Intermediate)**
> 수용성 절삭유 5-10% 에멀전, 20-100 L/min, 압력 2-10 bar. 열 제거 효율 80-90%, 칩 배출·윤활·냉각 3역할. 범용 표준.

**고급 (Expert)**
> Flood: water-soluble emulsion 5-10% (Blasocut, Hysol, Houghton), 유량 20-100 L/min, 압력 2-10 bar, 열 제거 효율 ~85% (vs dry). Vc multiplier = 1.0 (기준). 환경/비용: 수질오염 폐수 처리 필요 (kg당 폐기비 ₩200-500), 관리 비용 연간 머신당 ₩500k-1M (농도 관리·박테리아 방지). 적합 재질: 전 재질 범용 (Ti는 flood 금기 — 화재 위험으로 WC-Co 전용 수용성 or dry). 노동자 피부염·호흡기 이슈 있어 유럽 EHS 규제 강화. 출처: ISO 6743-7 / Harvey Performance Coolant Application Guide.

**왜 중요?** Vc 카탈로그 값의 '기본 전제'가 flood 쿨런트. 다른 방식은 여기서 multiplier로 보정. 시뮬레이터 coolant multiplier의 기준점(1.0).

**실전 예시.** SUS304 Ø10 4F 슬로팅 Vc 90(flood 기준) / mist 80 / dry 60. Flood 없으면 공구수명 45분 → 15분 (dry) → 30분 (mist).

**⚠ 흔한 함정.** 농도 부족(&lt;3%) → 윤활 부실, 박테리아 증식, 악취, 공구수명 20-30% 저하. 주 1회 굴절계 측정 필수. 과도(&gt;10%) → 거품·경제적 낭비.

**관련 개념:** `mql` · `mist-coolant` · `dry-machining` · `through-spindle` · `coolant-multiplier`

*출처: ISO 6743-7 / Harvey Performance Coolant Application Guide / Blaser Swisslube Handbook*

---

### MQL (Minimum Quantity Lubrication)
*MQL — Minimum Quantity Lubrication* · id: `mql`

**초급 (Beginner)**
> 기름 한 방울을 공기에 실어 공구로 쏘는 방식. 쿨런트를 거의 안 씀. 친환경이고 쓰레기가 안 나옴. 칩이 말라서 재활용도 쉬움.

**중급 (Intermediate)**
> 식물성 에스테르유 5-50 mL/hr + 압축공기 4-6 bar. 열 제거는 공기가, 윤활은 극미량 오일이. 항공 Al·Ti 가공에서 보급.

**고급 (Expert)**
> MQL: vegetable ester oil 5-50 mL/hr (flood 대비 1/1000-1/10000), compressed air 4-6 bar, aerosol droplet 2-5 µm. 열 제거 효율 40-60% (flood 대비), 윤활 효율 100+% (극압제 포함). Vc multiplier 0.85-0.95 (Al에서 1.0 가능). 환경/비용: 친환경 (오일 칩과 함께 소각 or 재활용), 폐수 제로, 비용 flood 대비 1/5-1/10, EU RoHS/REACH 친화적. 적합 재질: Al (특히 Al2024, 6061, 7075) 최적, Ti/CFRP 2순위, 스테인리스·Inconel 부적합(열부하 과다). 대표: MQL 펌프 Bielomatik, Unist, Lubrix. 출처: Harvey Performance MQL Study / SAE 2020-01-1304.

**왜 중요?** 친환경+비용절감+칩 재활용 3박자. Airbus/Boeing 등 항공 Al 가공은 MQL 표준. 탄소중립 공장 요건 만족. 미래형 주류.

**실전 예시.** Al7075 항공 부품 Ø12 4F 러핑 Vc 450(flood) → Vc 430(MQL), IPT 동일, 공구수명 -5%. 연간 쿨런트 비용 ₩800만 → ₩90만, 폐수 처리 0.

**⚠ 흔한 함정.** 스테인리스/Inconel에 MQL 적용 시 열부하 과다로 공구수명 flood 대비 50% 감소. MQL은 재료별 상성 엄격 — Al·Ti·공구강 일부에 한정.

**관련 개념:** `flood-coolant` · `mist-coolant` · `air-blast` · `dry-machining` · `coolant-multiplier`

*출처: Harvey Performance MQL Application Study / SAE Technical Paper 2020-01-1304*

---

### Mist (분무)
*Mist Coolant* · id: `mist-coolant`

**초급 (Beginner)**
> 쿨런트를 안개처럼 뿌리는 방식. Flood보다 적게, MQL보다 많이. 중간 단계. 작은 공작기계에서 흔함.

**중급 (Intermediate)**
> 수용성 쿨런트 50-500 mL/hr, 압력 3-5 bar. 열 제거 효율 60-70%. Flood 폐수 설비 없는 소형 공장에서 대안.

**고급 (Expert)**
> Mist: water-based 또는 straight oil, flow 50-500 mL/hr, air pressure 3-5 bar, droplet 20-100 µm. 열 제거 효율 ~65%, Vc multiplier 0.90-0.95. 환경/비용: mid-tier (flood의 1/5 사용량, MQL보다 5-10배), 호흡기 유해 aerosol 배출 → OSHA PEL 5 mg/m³ 주의, 집진기 필수. 적합 재질: 중경도 강, 주철, Al 범용. 기피: Ti (화재 위험), 정밀가공(droplet이 측정 센서·표면에 잔류). 대표: Noga MC1700, Fog Buster, Kool Mist. 출처: OSHA 29 CFR 1910.1000 / Harvey Performance Coolant Guide.

**왜 중요?** 소형 머시닝센터·CNC 수작업에 주로. Flood 설비 없이도 80% 냉각 효과. 다만 작업장 공기질·보건 리스크 설계 필요.

**실전 예시.** SS400 Ø8 2F 엔드밀 사이드밀링 Vc 140(flood) → Vc 128(mist), IPT 동일, 공구수명 -10%, 쿨런트 소비 20 L/shift → 0.3 L/shift.

**⚠ 흔한 함정.** 작업장 환기·집진기 없이 mist 장시간 사용 → PEL 초과 → 폐 질환. 반드시 local exhaust ventilation (LEV) 설치 (EN 626).

**관련 개념:** `flood-coolant` · `mql` · `air-blast` · `coolant-multiplier`

*출처: OSHA 29 CFR 1910.1000 / Harvey Performance Coolant Application Guide*

---

### Air Blast (공기)
*Air Blast / Compressed Air* · id: `air-blast`

**초급 (Beginner)**
> 오일 없이 압축공기만 훅훅 부는 방식. 냉각 효과는 약하지만 칩을 날려줘서 재절삭을 막음. 흑연·세라믹 가공에 필수.

**중급 (Intermediate)**
> 4-7 bar compressed air, nozzle Ø3-5 mm. 열 제거 효율 20-30%, 칩 배출 효과가 주 목적. 흑연/CFRP/세라믹 가공 표준.

**고급 (Expert)**
> Air blast: 압축공기 4-7 bar, flow 200-1,000 L/min, nozzle 3-10 mm. 열 제거 효율 ~25% (flood 대비), Vc multiplier 0.70-0.85. 환경/비용: 매우 친환경 (배출 없음), 에너지 비용만 발생 (컴프레서 전력 ₩0.3-0.5 /m³), 친환경성 MQL과 동급. 적합 재질: 흑연 (쿨런트 흡수로 금기), CFRP (박리 방지), Al 박판 (warp 방지), 세라믹. 기피: 일반강·스테인리스(열부하 해소 불가). 쿨드 에어(Cold Air Gun, Exair vortex tube) 사용 시 -20~-30°C 공기로 효율 +40%. 출처: Exair Technical Bulletin / Harvey Performance Dry Machining Guide.

**왜 중요?** 흑연/CFRP/세라믹은 쿨런트 접촉 시 제품 오염·강도 저하. Air blast가 유일한 '쿨링' 옵션. 복합재·전극 가공 필수.

**실전 예시.** 흑연 EDM 전극 Ø6 볼엔드밀 Vc 500(air+dust collector), n 26,525 rpm, IPT 0.03. 공구수명 180분(air) vs 20분(flood — 흑연이 쿨런트 흡수로 공구 clogging).

**⚠ 흔한 함정.** 압축공기 내 수분·오일 미제거 → 공구 표면 부식 또는 재료 오염 (특히 Al·금형강). 반드시 refrigerated dryer + coalescing filter 경유.

**관련 개념:** `dry-machining` · `mql` · `mist-coolant` · `coolant-multiplier`

*출처: Exair Compressed Air Technical Bulletin / Harvey Performance Dry Machining Guide*

---

### Dry (건식)
*Dry Machining* · id: `dry-machining`

**초급 (Beginner)**
> 쿨런트·공기 다 없이 그냥 깎는 방식. 공구 코팅이 좋아야 함. 주철·하드밀링에 흔함. 제일 친환경.

**중급 (Intermediate)**
> 코팅(TiAlN/AlTiN/TiSiN)+WC 공구의 내열성에 의존. Vc 카탈로그 대비 30-40% 감. 주철·하드밀링 표준, 일부 강재 가능.

**고급 (Expert)**
> Dry machining: no coolant, no air. 열 제거 효율 0% (공구·칩·공기 자연대류만), Vc multiplier 0.60-0.75. 환경/비용: 최고 (쿨런트·폐수·필터 zero), 폐기 칩 완전 건조로 즉시 재활용 가능(₩가치 +10-15%). 필요 조건: (1) 코팅 AlTiN/TiSiN (내산화 900-1200°C), (2) rigid machine, (3) 열전도 낮은 재료 (주철 최적, 담금질강 가능, Al·Ti·SS 부적합). 적합 재질: 주철(GG25, GGG60), 담금질강 55-65HRC (하드밀링), 흑연 (air blast 병용). 출처: ISO 8688 / Sandvik Coromant Dry Machining Application Guide.

**왜 중요?** 친환경 + 폐기 칩 100% 재활용 + 설비비 최저. 주철 가공은 dry가 표준(쿨런트 시 오히려 cast iron 균열). 하드밀링 금형업계 보편.

**실전 예시.** GG25 주철 Ø16 인덱서블 페이스밀 Vc 250(dry) + 코팅 AlTiN Z6, IPT 0.20, Fz 4,974 mm/min, 공구수명 90분. Flood 적용 시 Vc 270 but 공구수명 60분(열충격).

**⚠ 흔한 함정.** 코팅 없는 HSS 공구로 dry 시도 → 공구 날 적열(600°C 이상) → 즉시 소프트닝·파손. Dry는 초경+코팅 전제 조건.

**관련 개념:** `air-blast` · `flood-coolant` · `mql` · `altin-coating` · `coolant-multiplier`

*출처: ISO 8688 / Sandvik Coromant Dry Machining Application Guide*

---

### Through-Spindle (스핀들 관통 내부 급유)
*Through-Spindle Coolant (TSC) / High-Pressure Coolant* · id: `through-spindle`

**초급 (Beginner)**
> 공구 안에 구멍이 뚫려 있어서 쿨런트가 그 안으로 고압으로 쏘아져 나오는 방식. 깊은 구멍·포켓에서 칩 확실히 빼줌.

**중급 (Intermediate)**
> 쿨런트가 스핀들 중심 → 공구 내부 채널 → 날끝 직접 분사. 압력 20-70 bar, 유량 10-30 L/min. 딥홀 드릴·Inconel 가공 필수.

**고급 (Expert)**
> Through-spindle coolant (TSC): 스핀들 rotary union + tool internal channel (Ø1-3 mm), 압력 20-70 bar (고압 타입 100-300 bar), 유량 10-30 L/min. 열 제거 효율 ~95% (flood +10%p), Vc multiplier 1.10-1.25 (고압 타입 1.30까지). 환경/비용: flood와 동일 폐수 처리 + 고압 펌프(₩500만-2000만) 초기 투자, ROI 공구수명 향상으로 1-2년. 적합 재질: Inconel/Ti/SS 딥홀(L/D&gt;4), 포켓 deep(closed), 드릴 Ø5-20 모든 재질. 머신 요건: through-spindle 옵션 + rotary union, HSK63 ≥70 bar 대응 일반. 출처: Sandvik CoroDrill TSC White Paper / Makino High-Pressure Coolant Technical Bulletin.

**왜 중요?** Inconel/Ti 딥드릴 L/D&gt;5에서 chip packing으로 공구 파손이 주 문제. TSC는 유일한 해결책. 공구수명 3-10배 향상.

**실전 예시.** Inconel 718 Ø10 deep hole drill 50mm(L/D=5): 외부 coolant Vc 20·수명 12 홀 / TSC 70bar Vc 28·수명 85 홀. 7배 수명 + Vc 40% 상승.

**⚠ 흔한 함정.** TSC 공구를 외부 쿨런트 머신에 쓰면 내부 채널로 칩 역류 → 채널 막힘·공구 파손. 머신 TSC 옵션 확인 후 공구 선택.

**관련 개념:** `flood-coolant` · `coolant-multiplier` · `slotting` · `pocketing` · `hsk63`

*출처: Sandvik CoroDrill Through-Spindle Coolant Technical Paper / Makino High-Pressure Coolant Bulletin*

---

### Coolant Multiplier (Vc 보정 계수)
*Coolant Multiplier — Vc Adjustment Factor* · id: `coolant-multiplier`

**초급 (Beginner)**
> 쿨런트 방식마다 공구가 낼 수 있는 속도가 달라짐. 이걸 숫자로 나타낸 '보정 값'. Flood=1.0 기준, 건식은 0.7 같은 식.

**중급 (Intermediate)**
> Vc_effective = Vc_catalog × k_coolant. Flood 1.0, TSC 1.15, Mist 0.92, MQL 0.90, Air 0.80, Dry 0.70. 시뮬레이터 계산식에 곱셈 진입.

**고급 (Expert)**
> Coolant multiplier k_coolant (flood=1.0 기준): Through-spindle high-pressure(70bar+) 1.20-1.30, Through-spindle standard(20-40bar) 1.10-1.15, Flood 1.00, Mist 0.90-0.95, MQL 0.85-0.95 (Al 0.95, SS 0.80), Air blast 0.70-0.85 (흑연 1.0 — dry보다 유리), Dry 0.60-0.75. 계산: Vc_eff = Vc_cat × k_coolant × k_material × k_L/D... 누적 multiplicative. 열 제거 효율 η_heat [%]: TSC 95, Flood 85, Mist 65, MQL 50, Air 25, Dry 0. 환경 부하 순위 (저→고): MQL ≈ Air &lt; Dry &lt; Mist &lt; Flood &lt; TSC. 출처: Sandvik Coromant Multiplier Tables §3.4 / Kennametal Machining Performance Guide.

**왜 중요?** 카탈로그 Vc 값은 'flood 조건'이라 다른 쿨런트 환경 현장에선 보정 없이 그대로 쓰면 공구 수명 50% 감소. 시뮬레이터가 이 multiplier를 자동 적용하는 이유.

**실전 예시.** Ti-6Al-4V Ø10 카탈로그 Vc 60 (flood): TSC 적용 시 Vc_eff = 60×1.20 = 72 m/min. MQL 적용 시 Vc_eff = 60×0.85 = 51 m/min. 공구수명 편차 ±35%.

**⚠ 흔한 함정.** multiplier를 SFM에만 곱하고 IPT는 그대로 두는 실수. 열부하 변화는 IPT에도 영향 → Dry 전환 시 IPT도 10-15% 낮춰야 열균열 방지.

**관련 개념:** `flood-coolant` · `mql` · `mist-coolant` · `air-blast` · `dry-machining` · `through-spindle`

*출처: Sandvik Coromant Multiplier Tables §3.4 / Kennametal Machining Performance Guide*

---

## ⑨ 결과 지표 (Result Metrics)

### Pc — 소요 동력 (kW)
*Cutting Power (Pc)* · id: `pc-power`

**초급 (Beginner)**
> 가공하면서 기계가 실제로 써야 하는 힘(전기). 두껍게 깊게 빠르게 깎을수록 커진다. 기계 스펙을 넘으면 스핀들이 주저앉는다.

**중급 (Intermediate)**
> Pc = (ap · ae · fz · z · n · kc) / (60 · 10^6) [kW]. kc는 비절삭저항(N/mm²)이며 재료·칩두께 의존. 실제는 스핀들 효율 η(0.7~0.85)로 나눠 Pm = Pc/η 로 여유를 본다.

**고급 (Expert)**
> Pc [kW] = MRR [cm³/min] · kc [N/mm²] / (60 · 10³ · η). kc = kc1.1 · hm^(-mc) (Kienzle 식). 예: SM45C kc1.1 ≈ 2100 N/mm², mc ≈ 0.26. MRR = ap · ae · vf / 1000. 스핀들 연속정격의 80% 이내에서 운용, 100% 초과 시 토크 리미트·열변형·스핀들 수명 급감. Sandvik Tool Life Curves Handbook §4.

**공식 / Formula**

```
Pc [kW] = MRR [cm³/min] × kc [N/mm²] / (60 × 10³ × η)
```

**왜 중요?** 기계의 물리적 한계를 결정. Pc가 스핀들 연속정격을 넘으면 RPM이 떨어지고 Fz가 감소해 표면이 뭉개진다.

**실전 예시.** BT40 11kW 스핀들로 SM45C를 ap=10 ae=20 fz=0.12 D=20 z=4 vc=150 으로 치면 Pc ≈ 7.2 kW. η=0.8 가정 시 Pm ≈ 9 kW → 정격 82%로 한계선.

**⚠ 흔한 함정.** 스핀들 피크 정격(S6-10%)과 연속 정격(S1)을 헷갈리는 것. 장시간 가공은 S1 기준으로 보수적으로 잡아야 한다.

**관련 개념:** `fc-cutting-force` · `torque` · `mrr` · `vc` · `kc`

*출처: Sandvik Tool Life Curves Handbook §4, Kienzle (1952)*

---

### Fc — 주절삭력 (N)
*Main Cutting Force (Fc)* · id: `fc-cutting-force`

**초급 (Beginner)**
> 공구가 재료를 밀어낼 때 드는 힘. 두꺼운 칩·딱딱한 재료일수록 커진다. 너무 크면 공구가 휘고 부러진다.

**중급 (Intermediate)**
> Fc = ap · hm · kc [N]. hm은 평균 칩두께(= fz · sin κr · √(ae/D) for 측면가공). 공구 편향·채터·파손의 1차 원인.

**고급 (Expert)**
> Fc = b · h · kc1.1 · h^(-mc), b=ap/sin κr, h=hm. 정상 범위: 엔드밀 Ø10 기준 100~400N, Ø20 기준 300~1200N. 경고: 공구 허용 횡력(제조사 데이터, 예 Ø10 초경 ≈ 800N) 초과 시 파손. ISO 3685 Annex F 참조.

**공식 / Formula**

```
Fc [N] = ap × hm × kc, hm = fz × sin(κr) × √(ae/D)
```

**왜 중요?** 공구 편향(δ = FL³/3EI), 채터, 파손을 직접 결정. Fc를 모르면 공구수명·정밀도 예측 불가.

**실전 예시.** Ø10 4날 초경 엔드밀로 SM45C ap=10 ae=3 fz=0.08: hm≈0.035, kc≈3200 → Fc ≈ 1100N. 허용 횡력 초과 → ap/2로 낮춰야 함.

**⚠ 흔한 함정.** Fc만 보고 Ff(이송력)·Fp(배분력)를 무시. 드릴·보링은 Ff가 결정적, 엔드밀은 Fc가 결정적.

**관련 개념:** `pc-power` · `torque` · `deflection` · `hex-chip-thickness` · `kc`

*출처: ISO 3685 Annex F, MJ Jackson (2006) Ch.3*

---

### 토크 (N·m)
*Spindle Torque* · id: `torque`

**초급 (Beginner)**
> 스핀들이 공구를 돌리는 '회전 힘'. 저속에서 크고, 고속에서 작다. 대구경 공구·깊은 절삭일수록 많이 든다.

**중급 (Intermediate)**
> M = Fc · D / 2000 [N·m] (D=공구경 mm). 또는 M = 9550 · Pc / n [N·m]. 저속 가공에서 스핀들 토크 곡선 한계가 RPM 하한을 결정.

**고급 (Expert)**
> M [N·m] = 9.55 · 10³ · Pc[kW] / n[rpm]. BT40 급 스핀들 연속 토크 100~150 N·m (저속 기어), 고속 영역에서는 50% 이하로 감쇠. 정상: 정격의 60~80%, 경고: 100% 초과 시 스핀들 모터 과열·가속 실패. Sandvik Handbook §4.2.

**공식 / Formula**

```
M [N·m] = 9550 × Pc [kW] / n [rpm] = Fc × D / 2000
```

**왜 중요?** 저속 대구경 가공(face mill Ø80+)에서 kW보다 토크가 먼저 한계에 걸린다. RPM 하한선을 결정.

**실전 예시.** Ø80 페이스밀 n=400 vc=100 Pc=7kW → M = 9550·7/400 ≈ 167 N·m. BT40 연속토크 150 N·m → 초과, 저속기어 전환 또는 vc 상향 필요.

**⚠ 흔한 함정.** 스핀들 파워곡선의 저속 토크 상한(constant torque zone)을 무시하고 kW만 보는 것. 1000rpm 이하는 별도 확인.

**관련 개념:** `pc-power` · `fc-cutting-force` · `rpm` · `spindle-preset`

*출처: Sandvik Tool Life Curves Handbook §4.2, ASME B5.54*

---

### δ — 공구 편향 (μm)
*Tool Deflection* · id: `deflection`

**초급 (Beginner)**
> 공구가 옆에서 받는 힘 때문에 휘어지는 양. 얇고 길면 많이 휜다. 편향이 크면 벽이 비뚤어지고 치수가 틀어진다.

**중급 (Intermediate)**
> δ = F · L³ / (3 · E · I) [mm]. 캔틸레버 모델. L=돌출, E=탄성계수(초경 ≈ 600GPa), I=단면 2차모멘트. 50μm 초과 시 정밀도 심각 손상.

**고급 (Expert)**
> δ [mm] = Fc · L³ / (3 · E · Ieff). 엔드밀 Ieff ≈ π·Deff⁴/64, Deff ≈ 0.8·D (홈 고려). 정상 ≤ 20μm, 경고 ≥ 50μm, 파괴 ≥ 100μm. L/D = 3 기준 → L/D = 4일 때 편향 2.37배. Sandvik 권고: L/D &gt; 4는 네크 다운 공구 또는 진동방지 홀더.

**공식 / Formula**

```
δ [mm] = Fc × L³ / (3 × E × Ieff), Ieff ≈ π × (0.8D)⁴ / 64
```

**왜 중요?** 정밀도(IT 등급)·표면품질·채터 발생의 핵심 변수. L³에 비례하므로 돌출 2배면 편향 8배.

**실전 예시.** Ø10 초경 엔드밀 L=40 (L/D=4), Fc=400N → δ ≈ 42μm. IT7 공차(±18μm) 초과 → L=30으로 줄이면 δ ≈ 18μm로 급감.

**⚠ 흔한 함정.** 캔틸레버 모델은 공구만 고려. 실제로는 홀더·스핀들 강성도 직렬로 더해져 실측 편향은 계산값의 1.3~1.8배.

**관련 개념:** `fc-cutting-force` · `stick-out` · `chatter-risk` · `l-over-d-ratio`

*출처: MJ Jackson (2006) Ch.5, Sandvik Handbook §5.3*

---

### Ra — 표면거칠기 (μm)
*Surface Roughness (Ra)* · id: `ra-roughness`

**초급 (Beginner)**
> 가공면의 울퉁불퉁한 정도. 값이 작을수록 매끈함. 거울면 Ra 0.1, 일반 기계가공 Ra 1.6~3.2.

**중급 (Intermediate)**
> Ra = fz² / (8·rε) [mm] (이론값, 볼·코너R 절삭). 실제는 채터·마모·떨림으로 2~3배 커짐. ISO 4287 중심선 평균.

**고급 (Expert)**
> Ra_theoretical = f² / (31.25 · rε) [μm] (f=mm/rev, rε=mm). 정상: 황삭 Ra 3.2~6.3, 중삭 Ra 1.6~3.2, 정삭 Ra 0.4~1.6, 경면 Ra ≤ 0.2. 경고: 이론값 대비 3배 초과 시 채터·마모 진행 중. ISO 4287 / JIS B 0601.

**공식 / Formula**

```
Ra [μm] ≈ fz² × 1000 / (31.25 × rε)  (fz·rε in mm)
```

**왜 중요?** 도면 공차(예 Ra 1.6 ▽▽▽)를 충족해야 출하 가능. 이송·코너R·공구마모가 1차 인자.

**실전 예시.** 볼엔드밀 R4로 fz=0.08: Ra ≈ 0.08²·1000/(31.25·4) ≈ 0.051μm 이론. 실측 Ra 0.3μm → 마모·떨림 포함 현실.

**⚠ 흔한 함정.** 이론 Ra만 보고 만족하는 것. 실제는 공구 마모(VB &gt; 0.2mm)·진동·빌트업 에지로 이론의 3~10배. 실측 필수.

**관련 개념:** `fz` · `corner-radius` · `tool-wear` · `chatter-risk`

*출처: ISO 4287, JIS B 0601, Sandvik Handbook §7*

---

### 채터 위험도 (%)
*Chatter Risk Index* · id: `chatter-risk`

**초급 (Beginner)**
> 가공 중 '끼익' 떨리는 현상이 일어날 가능성. 100%에 가까울수록 위험. 얇고 길고 빠른 가공이 위험하다.

**중급 (Intermediate)**
> SLD(Stability Lobe Diagram)에서 현재 (n, ap)가 안정 영역에서 얼마나 가까운지 % 지표화. ap_lim · fn · κ로 산출.

**고급 (Expert)**
> Risk% = ap_actual / ap_lim × 100. ap_lim = -1 / (2·Kc·Re[G(ω)]) (Altintas SLD). 정상 ≤ 50%, 주의 50~80%, 경고 ≥ 80% → 주파수 이동 필수. Tobias (1961), Altintas (2000) Manufacturing Automation Ch.3.

**공식 / Formula**

```
Risk% = ap_actual / ap_lim × 100, ap_lim ∝ 1/(2·Kc·|G(ω)|)
```

**왜 중요?** 채터는 공구 즉사·표면 파괴·스핀들 베어링 손상을 일으킴. 정량 위험도로 조건 재설계 트리거.

**실전 예시.** Ø10 L/D=4 엔드밀 ap=15 fz=0.1 n=3000 → Risk 85%. n을 3400 또는 2600으로 ±13% 시프트하면 로브 간 안정점 진입, Risk 40%로 하강.

**⚠ 흔한 함정.** RPM 소폭 조정으로 해결된다고 믿기. 사실 L/D·홀더 강성이 근본. 10% 시프트로 안 되면 구조적 문제.

**관련 개념:** `chatter` · `deflection` · `stick-out` · `rpm`

*출처: Altintas (2000) Manufacturing Automation Ch.3, Tobias (1961)*

---

### 공구 수명 (min)
*Tool Life (T)* · id: `tool-life`

**초급 (Beginner)**
> 공구가 '못 쓸 정도'로 닳기까지 걸리는 시간(분). 빠르게·뜨겁게 돌릴수록 수명이 짧아진다.

**중급 (Intermediate)**
> Taylor: V · T^n = C. 마모 한계 VB = 0.3mm (ISO 3685) 도달까지. n=0.25(초경), C는 재료/코팅/냉각으로 결정.

**고급 (Expert)**
> T [min] = (C/V)^(1/n). 정상: 황삭 30~60 min, 정삭 60~240 min. 경고: &lt; 15 min → Vc/fz 재검토. ISO 3685: VB_avg = 0.3mm 또는 VB_max = 0.6mm 또는 crater depth KT = 0.06 + 0.3f 도달 시점. V 10% ↑ → T 약 40% ↓ (n=0.25).

**공식 / Formula**

```
T [min] = (C/Vc)^(1/n), n=0.25 (초경), VB_limit = 0.3 mm (ISO 3685)
```

**왜 중요?** 공구비가 전체 가공비의 3~15%. 수명 예측 없이 스케줄·원가 계산 불가.

**실전 예시.** Ø10 TiAlN 초경으로 SM45C Vc=150 → T ≈ 60 min. Vc=180(+20%)로 올리면 T ≈ 30 min(-50%). 교체 주기 2배 빨라짐.

**⚠ 흔한 함정.** Taylor식의 C값을 아무거나 쓰는 것. C는 재료·코팅·냉각·공구 형상마다 다름. 제조사 카탈로그 또는 실측으로 교정.

**관련 개념:** `taylor-equation` · `tool-wear` · `economic-vc` · `vc`

*출처: ISO 3685 Tool Life Testing, F.W. Taylor (1907)*

---

### RCTF — 반경방향 칩 박막화 계수
*Radial Chip Thinning Factor* · id: `rctf`

**초급 (Beginner)**
> 측면가공에서 ae(옆으로 먹는 깊이)가 작으면 실제 칩이 설정값보다 얇아진다. 그 얇아진 비율을 보정해주는 값.

**중급 (Intermediate)**
> RCTF = 1 / sin(θ), θ = acos(1 − 2·ae/D). ae &lt; D/2일 때 hex = fz · sin θ &lt; fz. 박막화 → 마찰·경화·공구수명 악화.

**고급 (Expert)**
> RCTF = 1/sin(acos(1−2·ae/D)) = 1/√(1−(1−2·ae/D)²). 보정 이송: fz_corrected = fz_target · RCTF. 정상: ae ≥ D/2 → RCTF ≈ 1. 경고: ae = 0.1·D → RCTF ≈ 1.67, ae = 0.05·D → RCTF ≈ 2.29. HSM(트로코이달) 필수 보정. Sandvik Handbook §3.6.

**공식 / Formula**

```
RCTF = 1 / sin(acos(1 − 2·ae/D)), fz_corrected = fz_target × RCTF
```

**왜 중요?** ae를 줄여 공구 편향을 낮추려다 오히려 rubbing·조기마모 유발. RCTF 보정 없이는 HSM 불가능.

**실전 예시.** Ø10 엔드밀 ae=1 (0.1D), fz_target=0.08 → RCTF 1.67 → fz=0.134 mm/tooth로 올려야 실제 칩두께 0.08 유지.

**⚠ 흔한 함정.** RCTF 보정 후 fz를 올렸는데 Fc·편향도 함께 오른다는 걸 잊는 것. 보정 후 재점검 필수.

**관련 개념:** `hex-chip-thickness` · `fz` · `rdoc` · `trochoidal`

*출처: Sandvik Handbook §3.6, Iscar HSM Guide*

---

### hex — 실제 최대 칩두께
*Maximum Chip Thickness (hex)* · id: `hex-chip-thickness`

**초급 (Beginner)**
> 공구가 한 번 지나갈 때 실제로 벗겨내는 가장 두꺼운 칩. 너무 얇으면 문지르고, 너무 두꺼우면 부러진다.

**중급 (Intermediate)**
> hex = fz · sin(κr) · sin(θ_exit), θ_exit = acos(1−2·ae/D). 평균 hm ≈ hex · 2/π (대략). 공구 카탈로그의 fz는 hex 기준.

**고급 (Expert)**
> hex [mm] = fz · sin(κr) · √(1 − (1 − 2·ae/D)²) (측면 ae &lt; D/2). 정상: 0.05~0.15 mm (초경 엔드밀). 경고: &lt; 0.02 → rubbing/work hardening, &gt; 0.2 → 칩 체적 과다·파손. Sandvik 권장 hex_min ≈ 0.5 · rε · (1−cos κr) 로 rubbing 회피.

**공식 / Formula**

```
hex [mm] = fz × sin(κr) × √(1 − (1 − 2·ae/D)²)
```

**왜 중요?** 칩 두께는 공구 수명·표면거칠기·가공경화의 모든 것. 설정 fz가 아닌 실제 hex를 관리해야 함.

**실전 예시.** Ø12 엔드밀 κr=90° ae=2 (0.17D) fz=0.1 → hex ≈ 0.075. ae=6 (0.5D)로 올리면 hex=fz=0.1. 같은 fz라도 ae에 따라 완전히 다른 절삭.

**⚠ 흔한 함정.** fz = 칩두께 라고 오해. 실제 hex는 ae·κr로 최대 50% 작아짐. 얇은 ae에서 공구 카탈로그 fz를 그대로 쓰면 rubbing.

**관련 개념:** `rctf` · `fz` · `rubbing`

*출처: Sandvik Handbook §3.5, ISO 3002-1*

---

### Taylor 공구수명 방정식
*Taylor Tool Life Equation* · id: `taylor-equation`

**초급 (Beginner)**
> 속도를 올리면 공구가 훨씬 빨리 닳는다는 걸 수학으로 정리한 공식. 100년 넘게 쓰는 가공의 기본 법칙.

**중급 (Intermediate)**
> V · T^n = C. V 10%↑ → T 약 40%↓ (n=0.25). 확장형: V · T^n · f^a · d^b = C 로 이송·절입 반영.

**고급 (Expert)**
> V·T^n = C. n: 공구재 지수 — HSS 0.125, 초경 0.20~0.30, 세라믹 0.40~0.60, CBN/PCD 0.50~0.70. C: 재료·냉각 의존 상수(SM45C 초경 ≈ 200~300). 확장: V·T^n·f^a·d^b = C, 통상 a ≈ 0.5n, b ≈ 0.2n. Vc 10% 상승 시 수명 ~40% 감소. Frederick W. Taylor (1907) 'On the Art of Cutting Metals' §§14~19. 확장형은 Colding (1959).

**공식 / Formula**

```
V × T^n = C  (확장: V × T^n × f^a × d^b = C)
```

**왜 중요?** 모든 공구수명 예측·경제속도 계산의 출발점. 이 식 없이 원가 최적화 불가.

**실전 예시.** SM45C 초경 n=0.25, C=250 → Vc=150 m/min → T ≈ (250/150)^4 ≈ 7.7 min. Vc=120 → T ≈ (250/120)^4 ≈ 18.8 min. 속도 20% 낮추면 수명 2.4배.

**⚠ 흔한 함정.** 단순 V·T^n=C만 믿고 f·ap를 무시. 고이송/심절입 시 확장형 필수. 또한 VB 한계값(0.3mm)이 응용에 따라 달라짐(정삭은 0.15).

**관련 개념:** `tool-life` · `economic-vc` · `taylor-curve` · `tool-wear`

*출처: F.W. Taylor (1907) On the Art of Cutting Metals §14-19, Colding (1959)*

---

## ⑩ 가공 현상 (Phenomena)

### 채터 — 공진 진동
*Chatter (Regenerative Vibration)* · id: `chatter`

**초급 (Beginner)**
> 공구와 가공물이 공진해 '끼익' 소리 나면서 떨림. 표면이 파도 치듯 울퉁불퉁해진다. 공구가 순식간에 깨질 수 있다.

**중급 (Intermediate)**
> 재생형 진동(regenerative chatter). 이전 날이 남긴 파상면을 다음 날이 물려 절삭력 변동이 누적. 원인: L/D 큼·ap 과다·RPM이 SLD 불안정 로브. 증상: 특정 주파수 비명, 줄무늬 표면, Ra 5~10배 악화. 대응: RPM ±10~15%, ap 절반, stick-out 단축.

**고급 (Expert)**
> 원인: 절삭력 변동 ΔF가 구조 FRF G(ω)와 양성 피드백 ap_lim = -1/(2·Kc·Re[G(ω)]). 증상: 가속도계 PSD에서 구조 고유진동수 근처 피크, Ra &gt; 이론값 5배, 공구 VB 비정상 증가. 대응: ① Altintas SLD 안정점으로 n 이동(통상 ±10~20%) ② ap 50% 감소(로브 회피) ③ stick-out 0.7x 단축 → 강성 k∝1/L³로 3배 향상 ④ 변동피치 공구 사용. 출처: Tobias (1961), Altintas (2000) Manufacturing Automation Ch.3.

**왜 중요?** 채터는 단순 떨림이 아니라 공구 즉사·스핀들 베어링 손상·치수불량으로 직결. 자율 가공의 최대 적.

**실전 예시.** Ø10 L/D=4.5 엔드밀 ap=15 n=3200 → 980Hz 비명 + Ra 3.2→25. 대응: n을 3600(+12%) 이동 + ap 8로 감소 → Ra 2.1 복원.

**⚠ 흔한 함정.** 볼륨 키우지 말고 먼저 stick-out을 확인. L 20%↓ = k 80%↑로 가장 효과적. RPM만 만지면 근본 미해결.

**관련 개념:** `chatter-risk` · `tool-deflection` · `deflection` · `stick-out` · `speed-dial`

*출처: Tobias (1961), Altintas (2000) Manufacturing Automation Ch.3*

---

### Rubbing — 긁힘
*Rubbing (Insufficient Chip Load)* · id: `rubbing`

**초급 (Beginner)**
> 칩이 너무 얇아서 공구가 재료를 '깎지' 않고 '문지르는' 현상. 열만 잔뜩 나고 공구가 쑥쑥 닳는다.

**중급 (Intermediate)**
> 원인: hex &lt; 최소 칩두께(통상 rε의 5~10%). fz 너무 작거나 ae 너무 작아 RCTF 미보정 시 발생. 증상: 반짝이는 번쩍한 표면, 공구 발갛게 달아오름, VB 급증. 대응: fz 1.5~2배 증가, 또는 ae 증가, 트로코이달 전환.

**고급 (Expert)**
> 원인: 날 에지 반경 rε보다 칩두께 h가 작으면 전단(shearing) 대신 소성변형/마찰 지배. 임계: h_min ≈ 0.3~0.5 · rε_edge (초경 ≈ 5~15μm). 증상: 플랭크면 광택, 온도 ΔT +200~400°C, 가공경화 표면층, Ra 역설적 상승. 대응: fz를 hex_min = 0.5·rε·(1−cos κr) 이상으로. 통상 fz 0.05→0.1 (+100%). Sandvik: '얇게 많이' 대신 '두껍게 적게'. 출처: Shaw (2005) Metal Cutting Principles §20.

**왜 중요?** '천천히 살살' 가공이 공구수명을 늘린다는 오해 1위. 실제로는 rubbing으로 수명 1/3 이하.

**실전 예시.** Ø8 엔드밀로 STS304 ae=0.8 fz=0.03 → 공구 5분 만에 VB 0.4. fz=0.08 + ae 4로 올리니 T = 45 min 복원.

**⚠ 흔한 함정.** '안전하게' fz 낮추는 것. 초경은 fz를 과감히 올려야 살아남는다. 특히 스테인리스·내열합금.

**관련 개념:** `hex-chip-thickness` · `work-hardening` · `tool-wear` · `fz` · `rctf`

*출처: Shaw (2005) Metal Cutting Principles §20, Sandvik Handbook §3.6*

---

### Chip Welding — 칩 응착 (BUE)
*Chip Welding / Built-Up Edge (BUE)* · id: `chip-welding`

**초급 (Beginner)**
> 칩이 공구 날에 녹아붙는 현상. 날이 더러워져서 표면이 지저분해지고 칩이 잘 안 떨어진다. 알루미늄·스테인리스가 특히 잘 생긴다.

**중급 (Intermediate)**
> 원인: 저속 고온 + 친화성 높은 재료(Al, 저탄소강, STS). 날-칩 계면에서 확산·용접. 증상: 날 앞면에 은백색 혹(BUE), 뜯긴 표면, Ra 악화, 칩 색 변화. 대응: Vc 증가(임계속도 돌파) 또는 날카로운 연마날 + 고압 쿨런트.

**고급 (Expert)**
> 원인: 칩-레이크면 접촉부 온도 T_BUE (Al ≈ 200°C, 저탄소강 ≈ 500°C)에서 주기적 응착-탈락-재응착. 증상: BUE 층두께 10~100μm, 레이크면 거친 마찰흔, 표면 뜯김, 칩 색 황색→청색 경계. 대응: ① Vc를 BUE 임계 위로 (Al ≥ 300 m/min, 강 ≥ 80 m/min) ② 연마날 + 양각 경사 ③ DLC/TiCN 코팅(친화성 낮음) ④ MQL 또는 고압 쿨런트(&gt;20bar). 출처: Trent & Wright (2000) Metal Cutting Ch.6.

**왜 중요?** 표면품질·치수정밀도·공구수명 모두 악화. 특히 정삭에서 치명적.

**실전 예시.** Al6061 Vc=80 m/min 비코팅 HSS → BUE 발생, Ra 3.2. Vc=400 m/min + DLC 코팅 + 연마날로 전환 → Ra 0.4, BUE 소실.

**⚠ 흔한 함정.** Vc를 오히려 낮추면 악화. BUE는 저속 현상 → 임계속도 위로 올려야 해결. 냉각 강화만으론 부족.

**관련 개념:** `heat-build-up` · `tool-wear` · `vc` · `altin-coating`

*출처: Trent & Wright (2000) Metal Cutting Ch.6*

---

### Heat Build-up — 열 축적
*Heat Build-up* · id: `heat-build-up`

**초급 (Beginner)**
> 가공 중 생긴 열이 다 빠져나가지 못하고 쌓여서 공구·가공물이 뜨거워지는 현상. 공구가 물러지고 재료가 변형된다.

**중급 (Intermediate)**
> 원인: 절삭열(Vc·fz·ap의 함수)이 냉각 용량 초과. 특히 드라이·MQL + 고속 + 저열전도 재료(Ti, Inconel). 증상: 칩 변색(청→보라), 공구 레이크면 열 크랙, 가공물 치수 팽창(ΔL = αLΔT). 대응: Vc -20%, 고압 쿨런트, 공기 블로우, 트로코이달로 공구 휴식.

**고급 (Expert)**
> 원인: Q = Pc·(1−η_heat) ≈ Pc·0.85 (85%가 열로). 칩이 열의 75%를 가져가야 건강. 저열전도 재료(Ti λ≈7, Inconel λ≈11 W/mK)는 열이 공구로 역류. 증상: 칩 색 청색=550°C, 보라=600°C, 회색=700°C+. 공구 플랭크에 평행 열크랙(thermal fatigue). 대응: ① Vc 0.7~0.8x ② 쿨런트 압력 &gt; 20bar 내부급유 ③ trochoidal로 공구 접촉시간 &lt;30% ④ 공구 코팅 내열(AlTiN 900°C, AlCrN 1100°C). 출처: Astakhov (2006) Tribology of Metal Cutting Ch.4.

**왜 중요?** 열은 공구수명의 1차 결정 인자. 모든 마모 메커니즘이 T에 지수적으로 의존(Arrhenius).

**실전 예시.** Ti6Al4V Vc=120 드라이 → 칩 보라, 공구 10 min 만에 크레이터. Vc=80 + 고압 쿨런트 70bar로 T=75 min 복원.

**⚠ 흔한 함정.** 쿨런트 플러드만 뿌려서 해결된다고 믿기. 실제론 고압 내부급유 아니면 칩 아래까지 못 닿음. 드라이+MQL이 더 나을 때도 있음.

**관련 개념:** `tool-wear` · `vc` · `flood-coolant` · `altin-coating`

*출처: Astakhov (2006) Tribology of Metal Cutting Ch.4*

---

### Work Hardening — 가공경화
*Work Hardening* · id: `work-hardening`

**초급 (Beginner)**
> 재료가 가공 중에 스스로 단단해지는 현상. 스테인리스·Inconel에서 심하다. 살살 깎으면 오히려 표면이 더 단단해져서 다음 날이 못 자른다.

**중급 (Intermediate)**
> 원인: 소성변형 → 전위 밀도 증가 → 경도 상승. 오스테나이트계 STS·Ni기 초합금에서 현저. 트리거: rubbing, 여러 패스 겹침, 얇은 칩. 증상: 표면경도 HRC +10~20, 다음 공구 급속마모. 대응: '두껍게 한 번에' 원칙, fz↑, 패스 수↓, 날카로운 날.

**고급 (Expert)**
> 원인: 전위 포화(dislocation saturation)로 σ_y 상승. STS304: 가공 후 표면층 HV200→HV450, 심도 50~200μm. Inconel718: HV350→HV550. 트리거: h &lt; h_critical ≈ 2·rε → 소성역만 통과. 증상: 2차 가공 시 VB 3~5배 급증, 표면 백색층(white layer) SEM 관찰. 대응: ① fz를 경화층 두께의 2배 이상으로 (통상 fz ≥ 0.1mm) ② 양각 경사 +10~15° ③ 패스 수 최소화 ④ 경화층 완전 제거까지 1회 절삭. 출처: M'Saoubi et al. (2014) CIRP Ann. 63/2.

**왜 중요?** 스테인리스/슈퍼알로이 가공의 최대 난제. 가공경화를 모르면 공구비가 2~5배 뛴다.

**실전 예시.** STS304 ap=5 fz=0.05로 3패스 → 마지막 날이 표면 HV450 층을 긁다 10분 만에 사망. ap=15 fz=0.12 1패스로 바꾸니 T=90 min.

**⚠ 흔한 함정.** '정삭은 얇게' 공식을 그대로 적용. 오스테나이트계는 역설적으로 '정삭도 두껍게'. fz &lt; 0.05는 금기.

**관련 개념:** `rubbing` · `hex-chip-thickness` · `tool-wear` · `pass-plan`

*출처: M'Saoubi et al. (2014) CIRP Annals 63/2, ASM Handbook Vol.16*

---

### 공구 변형 현상
*Tool Deflection (Physical Phenomenon)* · id: `tool-deflection`

**초급 (Beginner)**
> 공구가 힘을 받아 휘어지는 현상. 길고 얇은 공구일수록 많이 휜다. 눈에 보이지 않아도 수십 μm 휘어져 있다.

**중급 (Intermediate)**
> 원인: 측면 절삭력 Fc·Ff가 공구에 캔틸레버 모멘트 부과. L/D &gt; 3일 때 심각. 증상: 벽 테이퍼·바닥 언더컷·치수 산포. 대응: stick-out 0.5~0.7x, 네크다운 공구, ap·ae 분할, 강성 홀더(수축 끼움·유압).

**고급 (Expert)**
> 원인: δ = F·L³/(3EI). L³ 의존성으로 L/D 3→4 시 편향 2.37배. E_초경 ≈ 600GPa, E_HSS ≈ 210GPa (초경이 3배 강성). 증상: 벽 상부-하부 치수차 10~80μm, 정삭면 떨림 마크. 대응: ① stick-out 최소화(k∝1/L³) ② L/D &gt; 4 시 네크다운/스텁렝스 ③ ap 분할로 Fc 감소 ④ HSK/유압 홀더(반복정밀 &lt;3μm) ⑤ 편향 역보정 오프셋. 출처: MJ Jackson (2006) Ch.5, ASME B5.54.

**왜 중요?** 채터의 전 단계. 편향이 누적되면 결국 진동으로 발산. 정밀도의 숨은 주범.

**실전 예시.** Ø8 L=40 초경 엔드밀로 25mm 벽 정삭 → 상부 정치수, 하부 +35μm 부풀음. L=25로 줄이니 편향 Δ=5μm로 공차 이내.

**⚠ 흔한 함정.** '공구는 안 휜다'고 믿는 초보 실수. 초경도 FEM 하면 수십 μm 휘어진다. 보정 또는 조건 축소 필수.

**관련 개념:** `deflection` · `chatter` · `stick-out` · `l-over-d-ratio`

*출처: MJ Jackson (2006) Ch.5, ASME B5.54*

---

### 공구 마모 — Flank/Crater Wear
*Tool Wear (Flank & Crater)* · id: `tool-wear`

**초급 (Beginner)**
> 공구의 날이 시간이 지나며 닳는 현상. 옆면이 닳으면 flank 마모, 윗면에 구덩이가 파이면 crater 마모. 한계까지 가면 공구를 교체해야 한다.

**중급 (Intermediate)**
> 원인: 기계적 마모(abrasion) + 화학적 확산(diffusion) + 응착(adhesion) + 산화. VB(flank wear land)·KT(crater depth) 측정. 한계: VB = 0.3mm (ISO 3685). 증상: 절삭력 증가, 치수 변화, 표면 악화, 소음.

**고급 (Expert)**
> 원인: ① Abrasive wear (경질 개재물 알갱이 긁힘, 저속) ② Adhesive wear (BUE 반복, 중저속) ③ Diffusion wear (C·Co가 칩으로 확산, 고속 고온) ④ Oxidation wear (800°C+ 공기 산화). 기준: ISO 3685 VB_avg=0.3mm, VB_max=0.6mm, KT=0.06+0.3f, 노치마모 VN=1mm. 증상: Fc +20~50%, 표면 Ra 2~5배, 치수 드리프트, 청색 열발광. 대응: ① Vc -15% (마모 ∝ V^4) ② 내열 코팅 (AlTiN/AlCrN) ③ 쿨런트 강화 ④ 조기교체 예방보전. 출처: ISO 3685, Trent & Wright (2000) Ch.8.

**왜 중요?** 공구교체 시점을 놓치면 불량률·파손이 기하급수적. 예측·모니터링이 스마트 가공의 핵심.

**실전 예시.** Ø12 AlTiN 초경 SCM440 Vc=180 → VB 40분에 0.2, 55분에 0.3(교체), 65분에 0.6(파손). 50분 교체 규칙으로 파손 0건.

**⚠ 흔한 함정.** VB만 보고 KT를 무시. 고속 가공은 크레이터가 먼저 무너져 급파손. 양쪽 다 측정 또는 시간 기반 교체.

**관련 개념:** `tool-life` · `taylor-equation` · `edge-chipping` · `heat-build-up`

*출처: ISO 3685 Tool Life Testing, Trent & Wright (2000) Ch.8*

---

### 에지 치핑 — 날 결손
*Edge Chipping* · id: `edge-chipping`

**초급 (Beginner)**
> 공구 날이 조금씩 깨져 나가는 현상. 단속절삭·딱딱한 재료에서 잘 생긴다. 한 번 깨지면 가속적으로 망가진다.

**중급 (Intermediate)**
> 원인: 충격 하중(단속절삭, 경계 진입/이탈), 과대 fz, 경질 개재물, 재료 경도 불균일. 증상: 날 연속 요철, 표면 뜯김, Fc 불규칙 피크. 대응: fz 감소, 경사 진입(ramp/roll-in), 강인성 높은 공구재(K20→K30) + 인성 코팅.

**고급 (Expert)**
> 원인: ① 진입 충격 σ_peak &gt; 공구 굴곡강도(TRS 초경 2500~4500 MPa) ② 경질 개재물(탄화물·산화물) 충돌 ③ 열충격(단속절삭 ΔT 400°C+ 반복) ④ 과대 fz로 칩 부하 급증. 증상: 날 에지에 0.05~0.5mm 결손, 불규칙 간격, 가속도계 임펄스 피크. 대응: ① roll-in/ramp 진입 (충격 5x 감소) ② fz를 25~50% 감소 (단속부) ③ 서브마이크론 초경 또는 세라믹/CBN 부적합 → 서멧 ④ 양각 10~15° 대신 0°/음각으로 에지 보강 ⑤ T-land (0.1mm × −15°) 에지 보강. 출처: Byrne et al. (2003) CIRP Ann. 52/2.

**왜 중요?** 플랭크 마모보다 훨씬 빠른 공구사망. 예측 어렵고, 한 번 시작되면 분 단위로 악화.

**실전 예시.** SCM440 단조면 (HB280) 경계 가공, 초경 Ø16 fz=0.15 진입 → 3분 만에 날 결손 0.3mm. roll-in 5°로 바꾸고 fz=0.1로 감소 → 날 40분 유지.

**⚠ 흔한 함정.** '더 강한 공구'를 찾는 것. 강인성과 경도는 트레이드오프. 단속절삭은 C2→C6급 서브마이크론 초경 + T-land가 정답.

**관련 개념:** `tool-wear` · `fz` · `slotting` · `altin-coating`

*출처: Byrne, Dornfeld, Denkena (2003) CIRP Annals 52/2*

---

## ⑪ 가공 기법 (Techniques)

### Climb vs Conventional — 다운컷 vs 업컷
*Climb vs Conventional Milling* · id: `climb-vs-conventional`

**초급 (Beginner)**
> 공구 회전 방향과 이송 방향이 같으면 클라임(다운컷), 반대면 컨벤셔널(업컷). 다운컷은 칩이 두꺼운 데서 시작해 얇게 끝남. 현대 CNC 표준.

**중급 (Intermediate)**
> Climb(다운컷): 칩두께 h_max → 0, 공구 아래로 누르는 힘, 표면 좋음, 공구수명 ↑. Conventional(업컷): h 0 → h_max, 공구 위로 들어올림, rubbing 진입, 백래시 있으면 위험. CNC 볼스크류는 Climb 기본.

**고급 (Expert)**
> Climb: 칩 진입 h=h_max → 이탈 h=0. 장점: 공구수명 +30~50%, Ra 30% 개선, 가공경화 층 얇게 이탈. 단점: 첫 접촉 충격(단조 스킨에 치명). Conventional: h=0 진입 → 임계 h_min 이하 구간에서 rubbing 불가피. 사용: 리지드 CNC(백래시&lt;5μm)는 climb 99%. 업컷은 주철 스킨·단조 흑피·수동밀·백래시 있는 머신에만. 출처: Sandvik Handbook §3.2, Shaw (2005) Ch.2.

**왜 중요?** 같은 조건에서 공구수명·표면·정밀도가 모두 30~50% 차이. CNC에서 업컷 쓰면 비용 손해.

**실전 예시.** SM45C 사이드 밀링 Climb: Ra 1.2, T=60 min. 같은 조건 Conventional: Ra 2.1, T=40 min. 경제적으로 Climb 우세.

**⚠ 흔한 함정.** 백래시 있는 수동 범용 밀링에서 Climb 쓰면 공구가 끌려가 사망. 머신 강성 먼저 확인.

**관련 개념:** `hex-chip-thickness` · `rubbing` · `tool-life`

*출처: Sandvik Handbook §3.2, Shaw (2005) Ch.2*

---

### Speed dial ±% — 속도 미세조정
*Spindle Speed Override Dial* · id: `speed-dial`

**초급 (Beginner)**
> RPM을 가공 중에 ±10~20% 조정하는 다이얼. 채터가 나면 속도를 조금 바꿔 진동 주파수를 틀어준다.

**중급 (Intermediate)**
> 언제: 채터 징후(소음·줄무늬)·표면 악화·공구수명 미달. 얼마나: 통상 ±5~15%, SLD 로브 간 이동용. 주의: 20% 이상은 Taylor에 의해 공구수명 급변(Vc+20% → T −60%).

**고급 (Expert)**
> 언제: ① 채터 risk &gt; 70% ② 로브 로컬 최적점 탐색 ③ Vc를 Economic 값으로 미세 조정. 얼마나: SLD 로브 주기 Δn ≈ f_chatter·60/z·(1±1/k), 통상 ±10~15%. 주의: ① V·T^n=C로 +10%는 T −35% ② Pc = f(n)이므로 스핀들 kW·토크 재확인 ③ 이송 f=fz·z·n 연동 변경 ④ 이송은 Feed dial로 별도 조정. 출처: Altintas (2000) Ch.3.3, Tlusty (2000).

**왜 중요?** 현장에서 '채터 나면 RPM 바꿔봐'가 통하는 이유. 근본 변경 없이 즉시 안정화 가능한 1차 대응책.

**실전 예시.** Ø10 엔드밀 n=3000에서 채터. +12%(3360)로 이동 시 안정. 반대로 -8%(2760)도 안정. 사이 영역은 여전히 불안정.

**⚠ 흔한 함정.** ±20% 이상 감소로 '안전하게' 가려다 오히려 rubbing·BUE 진입. 또는 +20% 상승으로 수명 절반 희생.

**관련 개념:** `chatter` · `chatter-risk` · `taylor-equation` · `vc`

*출처: Altintas (2000) Manufacturing Automation Ch.3.3*

---

### Feed dial ±% — 이송 미세조정
*Feed Override Dial* · id: `feed-dial`

**초급 (Beginner)**
> 이송속도를 가공 중에 ±퍼센트로 바꾸는 다이얼. 떨리면 줄이고, 여유 있으면 올려서 시간을 줄인다.

**중급 (Intermediate)**
> 언제: 절삭력 피크·공구 편향 관찰·신규 재료 탐색 첫 커트. 얼마나: 황삭 ±20% 허용, 정삭 ±10%. 주의: fz 감소는 rubbing, 증가는 Fc·파손.

**고급 (Expert)**
> 언제: ① 신규 공정 ramp-up 시 안전마진 확보 ② 실시간 Fc 모니터링 피드백 ③ 코너·진입부 동적 감소. 얼마나: 범위 50~150% (머신 표준), 권장 80~120%. 주의: ① fz ↓ → hex &lt; h_min → rubbing·경화 ② fz ↑ → Fc ∝ fz^0.75 → 편향·파손 ③ Ra ∝ fz² → 정삭 영향 큼 ④ 공구수명 ∝ fz^−a, a ≈ 0.5n (Taylor 확장형). 출처: Colding (1959), Sandvik Handbook §3.4.

**왜 중요?** 가공시간의 직접 지배 변수. 안전한 상한을 실시간으로 탐색하는 유일한 수단.

**실전 예시.** SCM440 황삭 시작 fz=0.08 (override 100%). 5분 모니터링 후 Fc 여유 확인, override 125%로 올려 사이클 4분 단축.

**⚠ 흔한 함정.** Feed override 100% 고정. 소재 편차·공구 마모 미반영. 실시간 적응 제어가 생산성의 핵심.

**관련 개념:** `fz` · `rubbing` · `fc-cutting-force` · `corner-adjustment`

*출처: Colding (1959), Sandvik Handbook §3.4*

---

### Corner Adjustment — 코너 이송 보정
*Corner Feed Reduction* · id: `corner-adjustment`

**초급 (Beginner)**
> 공구가 코너를 돌 때는 살짝 더 깊이 먹히게 된다. 그래서 코너에서만 이송을 줄여줘야 공구가 안 부러진다.

**중급 (Intermediate)**
> 언제: 내측 코너(in-corner) 진입 시 실질 ae 증가. 얼마나: 통상 fz의 50~70%로 감소. 또는 R_tool &lt; R_corner 조건 확보(R_tool ≤ 0.7·R_corner).

**고급 (Expert)**
> 언제: 내측 코너에서 engagement angle 순간 증가 → ae_eff 최대 2x, Fc 2x, 공구 편향 급증·파손 빈발. 얼마나: ae_corner = ae_straight · (1 + R_tool/(R_corner−R_tool)). fz 감소비 = √(ae_straight/ae_corner), 통상 0.5~0.7x. 또는 CAM에서 arc-fitting, smoothing R, 또는 ae 자체를 직선부 70%로 낮추고 코너 통과. 주의: 외측 코너는 반대로 engagement 감소 → 이송 유지 가능. 출처: Sandvik Handbook §3.8, Mastercam Dynamic Mill.

**왜 중요?** 현장 공구 파손 원인 #1. 직선부만 최적화하고 코너를 잊으면 공구비 폭증.

**실전 예시.** Ø10 엔드밀 ae=5 (0.5D)로 R6 내측 코너 진입 시 ae_eff = 10 (=D, full slot!). fz 65% 감소 + CAM 트로코이달로 평탄화.

**⚠ 흔한 함정.** CAM에 'Corner feed reduction' 옵션 체크 안 하고 바로 가공. 첫 내측코너에서 공구 직행.

**관련 개념:** `rdoc` · `fz` · `feed-dial` · `trochoidal`

*출처: Sandvik Handbook §3.8, Iscar Hi-Feed Guide*

---

### Pass Plan — 다단 패스 계획
*Multi-Pass Planning* · id: `pass-plan`

**초급 (Beginner)**
> 한 번에 깊게 깎을지, 여러 번에 걸쳐 얕게 깎을지 결정하는 계획. 황삭-중삭-정삭 단계로 나누는 것이 기본.

**중급 (Intermediate)**
> 언제: 전체 제거 체적 &gt; 공구 1패스 한계(ap_max·ae_max). 얼마나: 황삭 ap=D·1~2, 정삭 ap=D·0.2, 정삭 여유 0.2~0.5mm. 주의: 가공경화 재료는 패스 수 최소화.

**고급 (Expert)**
> 언제: ① Pc·Fc가 기계·공구 한계 초과 ② 변형·잔류응력 제어 필요 ③ 공차/표면 요구 상이. 얼마나: 황삭 ap_rough = 1~2·D, ae_rough = 0.5~1·D / 중삭 stock 0.5~1mm / 정삭 ap_finish = 0.05~0.2·D, ae_finish = 0.1~0.3·D, stock 0.1~0.3mm. 주의: ① 오스테나이트계 STS는 패스 수 ↓ (가공경화 회피), fz 유지 ② 변형 큰 얇은 벽은 대칭 제거 + 2~3회 반복 ③ 열처리 전/후 분리 ④ 정삭 Ra ∝ fz² 이므로 패스 수가 아닌 fz가 지배. 출처: Sandvik Handbook §6, Smith (2008) Cutting Tool Technology.

**왜 중요?** 사이클타임·공구수명·정밀도·변형 모두를 결정. 잘못된 패스 계획은 좋은 조건을 무의미하게 만듦.

**실전 예시.** SCM440 30mm 깊이 포켓: 황삭 ap=15 2패스 + 정삭 ap=0.3 1패스. 사이클 18분, Ra 1.6 / 잘못된 계획: ap=3 10패스 = 45분, Ra 3.2.

**⚠ 흔한 함정.** '안전하게' 얕은 ap로 패스 많이 나누기. 총 시간 ↑ + rubbing + 가공경화 + 공구수명 ↓. 역효과.

**관련 개념:** `adoc` · `rdoc` · `work-hardening` · `tool-life`

*출처: Sandvik Handbook §6, Smith (2008) Cutting Tool Technology*

---

### Economic Vc — Taylor-Ackoff 최저원가 속도
*Economic Cutting Speed (Taylor-Ackoff)* · id: `economic-vc`

**초급 (Beginner)**
> 가공원가(기계비 + 공구비)가 최저가 되는 속도. 너무 느리면 시간이 오래 걸리고, 너무 빠르면 공구비가 폭증한다. 그 중간의 황금점.

**중급 (Intermediate)**
> V_econ = C · [(1−n)/n · Ct/Co · 1/Tc]^n. 원가 함수의 dCost/dV=0 점. n=0.25 초경 기준 Vc_max_production(생산성)보다 약 30% 낮음.

**고급 (Expert)**
> V_econ = C / T_econ^n, 여기서 T_econ = (1/n − 1) · (Ct + t_ct·Co) / Co. Co = 기계+인건비(원/min), Ct = 공구비/인서트(원), t_ct = 교체시간(min). n=0.25, C=250 (SM45C 초경) 예: Co=1000원/min, Ct=5000원, t_ct=2min → T_econ = 3·(5000 + 2000)/1000 = 21min → V_econ = 250/21^0.25 ≈ 117 m/min. 대비 V_max_MRR = 150 m/min은 T=7.7min, 공구비 3배. 출처: Taylor (1907) §20, Ackoff (1956) Operations Research.

**왜 중요?** '빠를수록 좋다'는 본능을 뒤엎는 정량 근거. 공장 원가의 직접 최적화 지표.

**실전 예시.** SCM440 n=0.25, C=240, Co=1200, Ct=8000, t_ct=3 → T_econ = 3·(8000+3600)/1200 ≈ 29min → V_econ ≈ 103 m/min. 현장 기본 140을 103으로 내리니 월 공구비 42% 감소, 사이클 12% 증가, 순이익 +18%.

**⚠ 흔한 함정.** n·C 상수를 추정값으로 쓰기. 실측 없이 공식만 쓰면 오차 ±30%. 1주일 실가공 로그로 Co·Ct·t_ct 교정 필수.

**관련 개념:** `taylor-equation` · `tool-life` · `taylor-curve` · `optimization-mode`

*출처: Taylor (1907) §20, Ackoff (1956), Gilbert (1950)*

---

### Taylor Curve — 수명곡선
*Taylor Tool Life Curve* · id: `taylor-curve`

**초급 (Beginner)**
> 속도(가로축)에 따라 공구수명(세로축)이 어떻게 변하는지 그린 곡선. 로그로 그리면 직선이 된다. 기울기가 공구재 성질을 말해준다.

**중급 (Intermediate)**
> log T = (1/n)·log C − (1/n)·log V. log-log 평면에서 직선, 기울기 = −1/n. 제조사 카탈로그 곡선 = 특정 재료·조건의 실측 피팅.

**고급 (Expert)**
> V·T^n=C를 log 변환: log V = log C − n·log T → V-T log-log 평면 직선, 기울기 m = −n (절대값 n). HSS: n=0.125 (기울기 완만, 속도 영향 작음) / 초경 0.25 / 세라믹 0.5 / CBN/PCD 0.6~0.7. Taylor 확장형 V·T^n·f^a·d^b = C 는 3D 표면. 곡선 사용법: 제조사 V-T 그래프에서 원하는 T(예 60min)의 V 읽기 → Vc 설정. 주의: 그래프 조건(재료·냉각)과 실제 일치 여부 확인. 출처: Taylor (1907) §15, Sandvik Tool Life Curves Handbook.

**왜 중요?** 공구 선정·속도 설정의 정량적 출발점. 카탈로그의 V-T 곡선이 실제 결정 자료.

**실전 예시.** Sandvik TiAlN 초경 엔드밀 P재(강) 수명곡선: Vc=200→T=45min, Vc=250→T=20min, Vc=300→T=10min. n≈0.25, C≈260 피팅.

**⚠ 흔한 함정.** log-log가 아닌 선형 스케일로 보고 '속도-수명이 직선적'이라 오해. 실제는 지수적 감소.

**관련 개념:** `taylor-equation` · `tool-life` · `economic-vc`

*출처: Taylor (1907) §15, Sandvik Tool Life Curves Handbook*

---

### 최적화 모드 — 생산성/균형/공구수명
*Optimization Mode (Productivity / Balanced / Tool Life)* · id: `optimization-mode`

**초급 (Beginner)**
> 무엇을 더 중요하게 볼지 고르는 스위치. '빨리 끝내기'(생산성), '공구 아끼기'(공구수명), 가운데(균형) 3가지.

**중급 (Intermediate)**
> Productivity: V_max_MRR ≈ V_econ·(1/n)^n 로 속도 상향 → T 짧음. Tool life: V = 0.7~0.8 · V_econ, T 길고 안정. Balanced: V_econ 기준.

**고급 (Expert)**
> 세 모드의 선택: ① Productivity — V = C/(T_min)^n, T_min = 공구 교체 허용 최소시간(예 15min). MRR 최대, 공구비 최대. 긴급 납기·공구 충분 시. ② Balanced — V = V_econ (Taylor-Ackoff). 원가 최소. 표준 양산. ③ Tool Life — V = 0.75·V_econ, T ≈ 2·T_econ. 공구조달 어려움·무인 야간가공·정밀 정삭. 얼마나: 모드 간 Vc 차이 통상 20~35%. 주의: ① 모드 전환 시 Fc·Pc·Ra·채터 risk 모두 재계산 ② 사이클타임 변화 ±20~40% ③ 공구비 ±50~200%. 출처: Sandvik Handbook §2, Gilbert (1950).

**왜 중요?** 고객 상황(납기 vs 원가 vs 무인운전)에 따라 정답이 다름. 일관된 정량 프레임이 필요.

**실전 예시.** SCM440 Ø12 기본 V_econ=115: Productivity Vc=150 T=12min, Balanced Vc=115 T=30min, Tool Life Vc=90 T=75min. 야간 8시간 무인운전 → Tool Life 선택.

**⚠ 흔한 함정.** 항상 Productivity만 선택. 인력·공구조달·품질 요구를 무시. 모드 선택이 공정설계의 전제조건.

**관련 개념:** `economic-vc` · `taylor-equation` · `taylor-curve` · `tool-life`

*출처: Sandvik Handbook §2, Gilbert (1950), Ackoff (1956)*

---
