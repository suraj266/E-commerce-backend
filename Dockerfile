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

# Run as the built-in non-root `node` user (uid 1000). Own /app so the process
# can read its own files but not escalate.
RUN chown -R node:node /app
USER node

EXPOSE 7000

# node:slim has no curl/wget, so the healthcheck is a Node one-liner hitting the
# terminus /health endpoint. Marks the container healthy only once the app serves 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||7000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main"]
