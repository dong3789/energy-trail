# Vercel 배포 가이드 (1회만)

## 1단계: Vercel 계정 (1분)

1. 브라우저에서 https://vercel.com/signup 접속
2. **"Continue with GitHub"** 클릭 → GitHub 계정 `dong3789` 인증
3. Vercel이 GitHub 접근권 요청 → **"All repositories"** 또는 **`Only select repositories` → dong3789/energy-trail** 선택

## 2단계: 프로젝트 Import (1분)

1. https://vercel.com/new 접속
2. **`dong3789/energy-trail`** 옆 **"Import"** 클릭
3. 프로젝트 설정:
   - **Project Name**: `energy-trail` (또는 원하는 이름)
   - **Framework Preset**: `Vite` ← 자동 감지됨
   - **Root Directory**: **`web-prototype`** ← 클릭 후 `Edit` → `web-prototype` 입력 ⚠️
   - **Build Command**: `npm run build` (기본값 OK)
   - **Output Directory**: `dist` (기본값 OK)
   - **Install Command**: `npm ci` (기본값 OK)
   - **Environment Variables**: 없음 (게임은 클라이언트 전용)

4. **"Deploy"** 클릭 → 1~2분 빌드 후 라이브 URL 발급

## 3단계: 결과

배포 완료되면:
- **Production URL**: `https://energy-trail.vercel.app` (또는 `https://energy-trail-<hash>.vercel.app`)
- GitHub repo 페이지에도 자동 표시
- 향후 `main`에 push할 때마다 자동 production 배포
- 모든 PR에는 자동 preview URL (`https://energy-trail-git-<branch>-<user>.vercel.app`)

## 4단계 (선택): 커스텀 도메인

1. Vercel 프로젝트 페이지 → **Settings** → **Domains**
2. 본인 도메인 입력 (예: `trail.yoon-dev.com`)
3. DNS에 CNAME 추가 (Vercel이 안내)

## 5단계 (선택): GitHub Actions와 Vercel 통합

- 별도 설정 불필요
- PR push → GitHub Actions (CI: lint+type+test+build) + Vercel preview 자동
- main 머지 → GitHub Actions + Vercel production 자동

## 트러블슈팅

### Build failed: "Could not resolve entry"
- `Root Directory`가 `web-prototype`로 설정됐는지 확인
- Vercel 프로젝트 Settings → General → Root Directory

### Build failed: "npm ci can only install when package-lock.json is present"
- `package-lock.json`이 Git에 포함됐는지 확인
- `git ls-files | grep package-lock` 으로 검증

### 404 on routes (SPA routing)
- 이 게임은 SPA라 `vercel.json`의 `rewrites`로 모든 경로를 `index.html`로 라우팅
- 이미 설정됨 (web-prototype/vercel.json)

### Vercel build 환경에서 테스트 실패
- `npm run build`만 실행되며 테스트는 GitHub Actions가 별도 실행
- Vercel 빌드는 빠르고 가벼움 (테스트는 GitHub Actions에 위임)
