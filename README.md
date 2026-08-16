# Energy Trail (Unity)

자국 (Energy Trail) — 네온 글로우 잔상 흡수 가속 메커니즘 술래잡기 게임.

## 플랫폼

- 모바일 (iOS, Android)
- PC (macOS, Windows, Linux)

## 빌드 환경

- **Unity 6000.0.78f1** (Unity 6)
- **URP 17.0.4** (Universal Render Pipeline)
- **Input System 1.11.2** (new + old both)
- C# (.NET Standard 2.1)

## 프로젝트 구조

```
energy-trail/
├── Assets/
│   ├── Scripts/
│   │   └── EnergyTrail/
│   │       ├── Camera/    (FollowCamera.cs)
│   │       ├── Core/      (GameManager.cs, RoundConfig.cs)
│   │       ├── Runner/    (RunnerController.cs)
│   │       └── Tagger/    (TaggerController.cs, TaggerSpeed*.cs)
│   ├── Scenes/            (Unity 씬 파일)
│   ├── Materials/
│   ├── Prefabs/
│   ├── Art/
│   ├── Audio/
│   ├── UniversalRenderPipelineGlobalSettings.asset
│   └── StreamingAssets/
├── Packages/
│   └── manifest.json
├── ProjectSettings/
└── README.md
```

## 디자인 문서

- 디자인 소스: `/Users/yoon/Documents/내 동 보관함/HOME/01_Projects/EnergyTrail/자국-술래잡기-DESIGN.md`
- 웹 프로토타입: 같은 폴더의 `web-prototype/` (Three.js, Vercel 배포)

## 빌드 & 아카이브

빌드 산출물은 SD 카드로 자동 아카이빙:

```bash
# 빌드 후
unity-archive energy-trail android v0.1.0
unity-archive energy-trail ios v0.1.0
unity-archive energy-trail mac v0.1.0
unity-archive energy-trail win v0.1.0
```

`~/bin/unity-archive` 스크립트 사용. SD 카드가 `/Volumes/SDCard`에 마운트되어야 함.

## GitHub

- 별도 레포: `github.com/dong3789/energy-trail-unity` (예정)

## 첫 오픈 시 해야 할 일

1. Unity Hub에서 `~/Projects/energy-trail/` 열기
2. URP 렌더 에셋 설정: Project Settings → Graphics → URP Asset 선택
   - 기본값 사용 또는 새로 만들기 (Create → Rendering → URP Asset)
3. 새 씬 만들기: File → New Scene → "Game" 저장
4. GameManager.cs를 빈 GameObject에 붙이고 시작
