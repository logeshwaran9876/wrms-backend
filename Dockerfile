# ==========================================
# Stage 1: Install production dependencies
# ==========================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install production-only dependencies based on lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ==========================================
# Stage 2: Lightweight Node.js API runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Copy production dependencies and application source
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

# Run as non-root user for container security
USER node

# Expose Express API port
EXPOSE 5000

# Readiness/health check (HTTP 200 only when MongoDB is connected)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:5000/api/health || exit 1

# Start Node.js Express server
CMD ["node", "index.js"]
