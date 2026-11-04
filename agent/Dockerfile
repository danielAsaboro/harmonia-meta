FROM node:22-bookworm-slim AS youtube-pot-provider
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider
WORKDIR /opt/bgutil-ytdlp-pot-provider/server
RUN npm ci && npx tsc

FROM python:3.12-slim@sha256:09f7da3bc104798d0afb40bc08d23ab2da20a76130cec1f2ef170848f5d85217

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --from=youtube-pot-provider /usr/local/bin/node /usr/local/bin/node
COPY --from=youtube-pot-provider /opt/bgutil-ytdlp-pot-provider/server /opt/bgutil-ytdlp-pot-provider/server

# ffmpeg powers clip rendering; fonts give libass a fallback for burned captions.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

# Meta MMS-TTS (open weights) speaks narrated videos and voiceovers on CPU. The
# CPU-only torch wheel keeps the image small; the voice is baked in at build time
# so a render never waits on a model download.
ENV HF_HOME=/opt/hf
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch>=2.4,<3" \
    && pip install --no-cache-dir "transformers>=4.45,<6" \
    && python -c "from transformers import AutoTokenizer, VitsModel; VitsModel.from_pretrained('facebook/mms-tts-eng'); AutoTokenizer.from_pretrained('facebook/mms-tts-eng')" \
    && chmod -R a+rX /opt/hf

COPY harmonia_agent ./harmonia_agent

RUN useradd -m worker
USER worker

EXPOSE 8080
CMD node /opt/bgutil-ytdlp-pot-provider/server/build/main.js & exec uvicorn harmonia_agent.main:app --host 0.0.0.0 --port ${PORT:-8080} --loop asyncio
