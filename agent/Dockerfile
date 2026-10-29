FROM node:22-bookworm-slim AS hyperframes
WORKDIR /opt/hyperframes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS youtube-pot-provider
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider
WORKDIR /opt/bgutil-ytdlp-pot-provider/server
RUN npm ci && npx tsc

FROM python:3.12-slim@sha256:09f7da3bc104798d0afb40bc08d23ab2da20a76130cec1f2ef170848f5d85217

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HYPERFRAMES_BROWSER_PATH="/usr/bin/chromium"

WORKDIR /app

COPY --from=hyperframes /usr/local/bin/node /usr/local/bin/node
COPY --from=hyperframes /opt/hyperframes /opt/hyperframes
COPY --from=youtube-pot-provider /opt/bgutil-ytdlp-pot-provider/server /opt/bgutil-ytdlp-pot-provider/server
COPY scripts/apply-carve.mjs /opt/hyperframes/scripts/apply-carve.mjs
ENV PATH="/opt/hyperframes/node_modules/.bin:${PATH}"

# HyperFrames requires a browser at runtime; install it while the image still runs as root.
# ffmpeg powers clip rendering; fonts give libass a fallback for burned captions.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

COPY harmonia_agent ./harmonia_agent

RUN useradd -m worker
USER worker

EXPOSE 8080
CMD node /opt/bgutil-ytdlp-pot-provider/server/build/main.js & exec uvicorn harmonia_agent.main:app --host 0.0.0.0 --port ${PORT:-8080} --loop asyncio
