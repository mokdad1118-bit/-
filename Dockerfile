# بناء:  docker build -t adora .
# تشغيل: docker run -p 3000:3000 --env-file .env -v adora-data:/data adora
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV SQLITE_PATH=/data/adora.sqlite

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
