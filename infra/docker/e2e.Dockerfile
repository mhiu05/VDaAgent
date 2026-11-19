# Playwright runner for `make e2e` (doc 17 "End-to-end (Playwright, fake mode)").
# Browsers ship with the base image; the build context is `e2e/`.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /e2e
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . ./

ENV CI=1
CMD ["npx", "playwright", "test"]
