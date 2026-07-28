# 🀄 루미큐브 — 단일 컨테이너 이미지
# 빌드:  docker build -t rummikub .
# 실행:  docker run --rm -p 8123:8123 rummikub
#        (포트 변경: docker run --rm -e PORT=8091 -p 8091:8091 rummikub)

# ---- 1단계: 클라이언트 빌드 ----
FROM node:22-alpine AS client-build
WORKDIR /app
COPY client/package.json client/package-lock.json client/
RUN npm --prefix client ci
COPY shared/ shared/
COPY client/ client/
RUN npm --prefix client run build

# ---- 2단계: 실행 이미지 (서버 + 빌드된 정적 파일만) ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci --omit=dev
COPY shared shared
COPY server/src server/src
COPY --from=client-build /app/client/dist client/dist
EXPOSE 8123
USER node
CMD ["node", "server/src/index.js"]
