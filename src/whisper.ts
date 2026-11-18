import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { prepareAudio, extFromMime } from "./audio.js";

export interface TranscriptionOutput {
  transcript: string;
  language: string;
  /** Duração do áudio em segundos (do WAV). */
  durationSeconds: number;
}

interface WhisperJson {
  result?: { language?: string };
  transcription?: Array<{ text?: string; offsets?: { from?: number; to?: number } }>;
}

export async function assertModelAvailable(): Promise<void> {
  try {
    await fs.access(config.whisperModel);
  } catch {
    throw new Error(
      `Modelo whisper "${config.whisperModelName}" não encontrado. ` +
        `Rode "npm run setup:model" ou configure WHISPER_MODEL.`,
    );
  }
}

function runWhisper(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let child;
    try {
      child = spawn(config.whisperBin, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      reject(new Error(`whisper: falha ao iniciar "${config.whisperBin}" (${(err as Error).message})`));
      return;
    }
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", (err) =>
      reject(
        new Error(
          `whisper: não foi possível executar "${config.whisperBin}". ` +
            `Baixe um build do whisper.cpp (whisper-cli) e aponte WHISPER_BIN. (${err.message})`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`whisper: saiu com código ${code}. ${stderr.trim().slice(-500)}`));
    });
  });
}

/**
 * Transcreve um buffer de áudio: converte p/ WAV 16k mono (ffmpeg) e roda o
 * binário do whisper.cpp com o modelo configurado (small), lendo o JSON de saída.
 */
export async function transcribeBuffer(
  input: Buffer,
  opts: { mimeType?: string; language?: string } = {},
): Promise<TranscriptionOutput> {
  await assertModelAvailable();

  const prepared = await prepareAudio(input, extFromMime(opts.mimeType));
  const outBase = path.join(config.tmpDir, `out-${crypto.randomUUID()}`);
  const jsonPath = `${outBase}.json`;
  const language = (opts.language ?? config.language).trim() || "pt";

  try {
    await runWhisper([
      "-m", config.whisperModel,
      "-f", prepared.wavPath,
      "-l", language,
      "-t", String(config.threads),
      "-oj",
      "-of", outBase,
      "-nt",
    ]);

    let parsed: WhisperJson;
    try {
      parsed = JSON.parse(await fs.readFile(jsonPath, "utf8")) as WhisperJson;
    } catch (err) {
      throw new Error(`whisper: não foi possível ler a saída JSON (${(err as Error).message})`);
    }

    const segments = parsed.transcription ?? [];
    const transcript = segments
      .map((s) => (s.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Duração: preferir o header do WAV; se vier 0, usar o último offset do JSON.
    let durationSeconds = prepared.durationSeconds;
    if (durationSeconds <= 0 && segments.length > 0) {
      const lastTo = segments[segments.length - 1]?.offsets?.to ?? 0;
      durationSeconds = Math.round((lastTo / 1000) * 100) / 100;
    }

    return {
      transcript,
      language: parsed.result?.language ?? language,
      durationSeconds,
    };
  } finally {
    await Promise.allSettled([prepared.cleanup(), fs.rm(jsonPath, { force: true })]);
  }
}
