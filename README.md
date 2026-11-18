# CRM Orbit — Serviço de Transcrição (whisper.cpp / small)

Serviço **separado** que transcreve áudio usando o **whisper.cpp** (modelo **small**),
com **fila de processamento** e retorno por job. O backend do CRM fala com ele por HTTP.

Desenhado para rodar **via CLI no Windows sem compilador** (usando binários
pré-compilados) e, depois, em **Docker na VPS** (mesmos binários no container).

## Como funciona

```
áudio (base64) ──POST /transcriptions──▶ [fila] ──ffmpeg──▶ WAV 16k mono ──whisper.cpp──▶ transcrição
                                           │
             GET /transcriptions/:id ◀─────┘  (ou callback POST quando terminar)
```

- **ffmpeg** converte qualquer formato (ogg/opus do WhatsApp, webm do navegador, mp3…)
  para WAV 16kHz mono — o único formato que o whisper.cpp aceita.
- **whisper.cpp** (`whisper-cli`) roda o modelo `ggml-small.bin` e devolve JSON.
- A **duração** sai do header do WAV (usada na regra dos 5 min do CRM).

## Pré-requisitos (uma vez)

Como esta máquina **não tem compilador C++**, use binários prontos.

### Opção A — automático (Windows)

```bash
npm install
npm run setup:binaries       # baixa whisper.cpp + ffmpeg, extrai em ./bin e grava o .env
```

O script `scripts/setup-binaries.ps1` pega o release mais recente do whisper.cpp
que tenha `whisper-bin-x64.zip` (nem todo release anexa — o `/latest` às vezes vem
sem binário), baixa o ffmpeg "release-essentials", acha os `.exe`, grava
`WHISPER_BIN`/`FFMPEG_BIN` no `.env` e baixa o modelo small. Use `-SkipModel` para pular o modelo.

### Opção B — manual

1. **whisper.cpp** — em https://github.com/ggml-org/whisper.cpp/releases, baixe o
   asset **`whisper-bin-x64.zip`** (CPU x64). Atenção: o release marcado "Latest"
   pode não ter esse zip; pegue o release recente que tiver. Extraia e aponte
   `WHISPER_BIN` para o `whisper-cli.exe` (mantenha os `.dll` ao lado).
2. **ffmpeg** — https://www.gyan.dev/ffmpeg/builds/ (`ffmpeg-release-essentials.zip`);
   aponte `FFMPEG_BIN` para o `ffmpeg.exe` (pasta `bin/`), ou coloque no PATH.
3. Modelo + .env:

```bash
npm install
npm run setup:model          # baixa models/ggml-small.bin (~465 MB)
cp .env.example .env         # ajuste WHISPER_BIN / FFMPEG_BIN
```

## Uso

### CLI (one-shot, sem HTTP) — ideal para testar local

```bash
npm run transcribe -- ./amostra.ogg
# a transcrição vai para o stdout; logs vão para o stderr
```

### Serviço HTTP com fila

```bash
npm start            # sobe em http://localhost:8090
```

- `GET  /health` — status + se o modelo foi encontrado.
- `POST /transcriptions` — body JSON `{ audioBase64, mimeType?, language?, ref?, callbackUrl? }`
  - `202` com `{ job: { id, status } }`. Consulte o resultado por GET.
  - `?wait=true` → responde **síncrono** com o job já finalizado.
- `GET  /transcriptions/:id` — `{ job: { status, transcript, durationSeconds, language, error } }`.

Se `TRANSCRIPTION_API_TOKEN` estiver definido, envie o header `x-api-token`.

## Configuração

Veja `.env.example`. Principais: `WHISPER_BIN`, `WHISPER_MODEL`, `FFMPEG_BIN`,
`WHISPER_LANGUAGE` (padrão `pt`), `QUEUE_CONCURRENCY` (padrão `1`), `PORT`.

## Docker (VPS) — depois

Na VPS, uma imagem que instale `ffmpeg` e compile/baixe o `whisper-cli` + o modelo
roda o mesmo código sem mudanças. Basta expor a porta e definir as mesmas envs.
