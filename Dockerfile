# ==========================================
# STAGE 1: Builder
# ==========================================

FROM node:25-slim AS builder

WORKDIR /app

# - openssl   : required by Prisma
# - chromium  : used by puppeteer for tax-invoice PDF generation
#               (we skip puppeteer's bundled Chrome — slim image has no
#               tar/unzip to extract it, so we install the system one)
# - fonts-liberation : sane default Latin font set for invoice rendering
# - fonts-noto-core  : provides the Indian Rupee glyph (₹ / U+20B9) and other
#                      symbols Liberation lacks — Chromium falls back to it
#                      per-glyph so ₹ renders in the PDF
# - ca-certificates : HTTPS for any network calls during render
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
      openssl \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tell puppeteer NOT to download Chrome during pnpm install (slim image
# lacks tar/unzip, and we'll use the apt-installed chromium instead).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./

RUN pnpm install

COPY prisma ./prisma/
RUN pnpm exec prisma generate

COPY . .

RUN pnpm run build

# ==========================================
# STAGE 2: Production
# ==========================================

FROM node:25-slim AS production

WORKDIR /app

# Same runtime deps as the builder — invoice service needs chromium at run time.
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
      openssl \
      chromium \
      fonts-liberation \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod

COPY prisma ./prisma/
RUN pnpm exec prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 7000

CMD ["node", "dist/main"]
