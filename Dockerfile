FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=80

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=false

COPY . .

RUN chmod +x scripts/start.sh

EXPOSE 80

CMD ["./scripts/start.sh"]
