# CRM Orbit — Transcription (whisper.cpp + ffmpeg + Node)

# --- Stage 1: compila o whisper.cpp (binario estatico whisper-cli) ---
FROM debian:bookworm-slim AS whisper-builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Pin de versao estavel (tem o binario whisper-cli).
RUN git clone --depth 1 --branch v1.7.4 https://github.com/ggml-org/whisper.cpp.git /src
WORKDIR /src
# BUILD_SHARED_LIBS=OFF -> whisper-cli linka ggml/whisper estaticamente (1 binario).
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
 && cmake --build build -j --config Release

# --- Stage 2: runtime ---
FROM node:22-bookworm-slim
# ffmpeg converte o audio p/ WAV 16kHz mono; libgomp1 = OpenMP do whisper.cpp.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-builder /src/build/bin/whisper-cli /usr/local/bin/whisper-cli

ENV WHISPER_BIN=/usr/local/bin/whisper-cli \
    FFMPEG_BIN=ffmpeg \
    WHISPER_MODEL=ggml-small.bin \
    WHISPER_LANGUAGE=pt

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN chmod +x docker-entrypoint.sh

EXPOSE 8090
# O entrypoint baixa o modelo para /app/models (volume) se faltar, depois sobe o serviço.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
