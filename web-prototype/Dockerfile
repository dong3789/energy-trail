# 정적 파일 서빙용 nginx (다른 정적 게임들 (tetris, samgukji)과 동일 패턴)
# Build: docker build -t energy-trail .
# Run:   docker run -d --name energy-trail --network proxy_net --restart unless-stopped \
#          -v /abs/path/to/dist:/usr/share/nginx/html:ro energy-trail
FROM nginx:alpine

# SPA routing — 모든 경로를 index.html로 (Vite SPA fallback)
# 640KB 게임이라 캐시 적극 활용 (1년 immutable)
COPY nginx.conf /etc/nginx/conf.d/default.conf
