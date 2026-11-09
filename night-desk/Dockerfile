FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY research/fx/fomc-dates.json ./research/fx/fomc-dates.json
ENTRYPOINT ["npx", "tsx", "scripts/cycle.ts"]
