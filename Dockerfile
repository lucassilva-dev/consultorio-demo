FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/app.db
ENV UPLOAD_DIR=/app/uploads

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data /app/uploads \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
