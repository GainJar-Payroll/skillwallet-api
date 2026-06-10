# ============================================================
# Stage 1: Build — install all deps + compile with SWC
# ============================================================
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Lock files first for Docker layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source + build config
COPY tsconfig.json .swcrc nest-cli.json ./
COPY src ./src

# Build (SWC via nest-cli)
RUN bun run build:swc

# ============================================================
# Stage 2: Production — minimal runtime
# ============================================================
FROM oven/bun:1-alpine

WORKDIR /app

# Production dependencies only (no devDeps)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Compiled output from builder
COPY --from=builder /app/dist ./dist

# Health check against Swagger docs endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://localhost:4000/docs-json').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 4000

USER 1000

CMD ["bun", "dist/main.js"]