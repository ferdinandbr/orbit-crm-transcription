import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(__dirname, "..");

/** Carrega .env (zero dependência). Não sobrescreve vars já definidas no ambiente. */
function loadDotEnv(): void {
  try {
    const raw = fs.readFileSync(path.join(serviceRoot, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Sem .env: segue com process.env e defaults.
  }
}

loadDotEnv();

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v.trim() : fallback;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve o modelo: um NOME puro (ex.: "ggml-small.bin") vira ./models/<nome>;
 * um caminho (absoluto ou com barra) e usado como esta. Assim o WHISPER_MODEL no
 * .env fica so com o nome, sem expor o caminho da maquina.
 */
function resolveModelPath(value: string): string {
  if (path.isAbsolute(value) || value.includes("/") || value.includes("\\")) return value;
  return path.join(serviceRoot, "models", value);
}

const whisperModelPath = resolveModelPath(envStr("WHISPER_MODEL", "ggml-small.bin"));

/**
 * Configuração do serviço de transcrição. Tudo resolvido por ambiente, com
 * defaults seguros para rodar via CLI no Windows (binários externos) e, depois,
 * em Docker na VPS (mesmos nomes de binário no PATH do container).
 */
export const config = {
  /** Porta HTTP do serviço de fila. (8080 é o default da Evolution → usamos 8090) */
  port: envInt("PORT", 8090),

  /** Token compartilhado opcional: se definido, exige header x-api-token. */
  apiToken: envStr("TRANSCRIPTION_API_TOKEN", ""),

  /**
   * Binário do whisper.cpp. Baixe um build pré-compilado (Windows: whisper-cli.exe
   * das releases do whisper.cpp) para NÃO precisar de compilador local.
   */
  whisperBin: envStr("WHISPER_BIN", "whisper-cli"),

  /** Caminho resolvido do modelo GGML (interno). Padrão: small em ./models. */
  whisperModel: whisperModelPath,

  /** Apenas o NOME do modelo — usado para exibir sem expor o caminho completo. */
  whisperModelName: path.basename(whisperModelPath),

  /** Idioma fixo do negócio (pt). "auto" habilita autodetecção. */
  language: envStr("WHISPER_LANGUAGE", "pt"),

  /** Threads do whisper.cpp. Padrão: nº de CPUs. */
  threads: envInt("WHISPER_THREADS", Math.max(1, os.cpus().length)),

  /** Binário do ffmpeg para converter qualquer formato → WAV 16kHz mono. */
  ffmpegBin: envStr("FFMPEG_BIN", "ffmpeg"),

  /** Jobs processados em paralelo. whisper.cpp é pesado de CPU → padrão 1. */
  concurrency: envInt("QUEUE_CONCURRENCY", 1),

  /** Limite de tamanho do áudio recebido (base64 decodificado). */
  maxAudioBytes: envInt("MAX_AUDIO_BYTES", 25 * 1024 * 1024),

  /** Quanto tempo um job finalizado fica consultável antes de ser limpo. */
  jobTtlMs: envInt("JOB_TTL_MS", 10 * 60 * 1000),

  /** Timeout de uma transcrição individual (ms). */
  jobTimeoutMs: envInt("JOB_TIMEOUT_MS", 10 * 60 * 1000),

  /** Diretório temporário para os arquivos de áudio intermediários. */
  tmpDir: envStr("TRANSCRIPTION_TMP_DIR", path.join(os.tmpdir(), "crm-orbit-transcription")),

  serviceRoot,
};

export type AppConfig = typeof config;
