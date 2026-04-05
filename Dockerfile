# ==========================================
# STAGE 1: Builder
# ==========================================

FROM node:25-slim AS builder

WORKDIR /app

# Prisma ko chalne ke liye OpenSSL chahiye jo slim image me nahi hota
RUN apt-get update -y && apt-get install -y openssl

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./

RUN pnpm install

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .

RUN pnpm build

# ==========================================
# STAGE 2: Production
# ==========================================

FROM node:25-slim AS production

WORKDIR /app

# Prisma ko chalne ke liye OpenSSL chahiye jo slim image me nahi hota
RUN apt-get update -y && apt-get install -y openssl

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod

COPY prisma ./prisma/
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 7000

CMD ["node", "dist/main"]
