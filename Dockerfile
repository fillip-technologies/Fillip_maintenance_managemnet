# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- Dependencies (with dev deps for prisma generate) ----
FROM base AS deps
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# ---- Production dependencies only ----
FROM base AS prod-deps
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runner ----
FROM base AS runner
# Copy production node_modules, then overlay the generated Prisma client.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY . .


USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
