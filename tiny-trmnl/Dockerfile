ARG NODE_VERSION
FROM node:${NODE_VERSION}-trixie-slim

WORKDIR /app

# Install project dependencies first to leverage Docker layer caching.
COPY package*.json ./
RUN npm ci

# Install Playwright browsers and required system dependencies.
RUN npx playwright install --with-deps firefox

RUN apt install -yy imagemagick

COPY . .

CMD ["node", "--experimental-transform-types", "src/server.ts"]
