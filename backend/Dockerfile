# ── Builder stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# ── Production stage ───────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nodeuser -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# curl for healthcheck
RUN apk add --no-cache curl

RUN chown -R nodeuser:nodejs /app
USER nodeuser

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "server.js"]
