# dist는 caddy 컨테이너가 호스트에서 마운트해 서빙 — 이 이미지는 ws 서버만 담당
FROM node:22-alpine

WORKDIR /app

# package.json 먼저 → 레이어 캐시 (소스 변경 시 npm ci 재실행 안 됨)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY test-scripts ./test-scripts

EXPOSE 8791
ENV PORT=8791

CMD ["node", "server/index.mjs"]
