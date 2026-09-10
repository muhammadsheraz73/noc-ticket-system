# Single-image deployment: Express serves the API and the compiled React app.
# Works on Railway, Fly.io, Cloud Run, or any container host.
FROM node:22-alpine AS build

# Production talks to Atlas, so never download the embedded mongod binary.
ENV MONGOMS_DISABLE_POSTINSTALL=1

WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm install

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV USE_EMBEDDED_MONGO=false
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app

# Production dependencies only; the embedded-MongoDB downloader is not needed.
COPY package*.json ./
COPY server/package*.json ./server/
RUN npm install --omit=dev --workspace server --include-workspace-root

COPY server/src ./server/src
COPY --from=build /app/client/dist ./client/dist

RUN addgroup -S noc && adduser -S noc -G noc && chown -R noc:noc /app
USER noc

EXPOSE 5000
CMD ["node", "server/src/index.js"]
