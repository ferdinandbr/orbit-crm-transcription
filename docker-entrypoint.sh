#!/bin/sh
set -e

# Baixa o modelo GGML para /app/models (volume) se ainda nao existir.
MODEL_NAME="${WHISPER_MODEL:-ggml-small.bin}"
MODEL_PATH="/app/models/${MODEL_NAME}"

if [ ! -f "$MODEL_PATH" ]; then
  # Extrai o "size" do nome do arquivo: ggml-small.bin -> small
  SIZE=$(echo "$MODEL_NAME" | sed -E 's/^ggml-(.*)\.bin$/\1/')
  [ -z "$SIZE" ] && SIZE="small"
  echo "[entrypoint] modelo ${MODEL_NAME} ausente, baixando (${SIZE})..."
  node scripts/download-model.mjs "$SIZE"
fi

exec "$@"
