FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/index.mjs ./
# 2026-08-26: 멀티플레이어 통합 테스트 (test-scripts/multiplayer.cjs)
# CI/배포 후 회귀 검증용. prod에서도 실행 가능 (수동 docker exec).
COPY test-scripts ./test-scripts
ENV PORT=8791
EXPOSE 8791
CMD ["node", "index.mjs"]
