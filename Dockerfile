# بناء:  docker build -t adora .
# تشغيل: docker run -p 3000:3000 --env-file .env adora  (يجب أن يحتوي .env على DATABASE_URL)
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# عيّن DATABASE_URL عند التشغيل (رابط PostgreSQL، مثل Render External Database URL)
# ENV DATABASE_URL=

EXPOSE 3000

CMD ["node", "server.js"]
