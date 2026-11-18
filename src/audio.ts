import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

export interface PreparedAudio {
  /** Caminho do WAV 16kHz mono pronto para o whisper.cpp. */
  wavPath: string;
  /** Duração em segundos, calculada do header do WAV (precisa). */
  durationSeconds: number;
  /** Remove os arquivos temporários. Sempre chame no finally. */
  cleanup: () => Promise<void>;
}

function run(bin: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      reject(new Error(`${label}: falha ao iniciar "${bin}" (${(err as Error).message})`));
      return;
    }
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `${label}: não foi possível executar "${bin}". ` +
            `Verifique se está instalado/no PATH ou configure o caminho por ambiente. (${err.message})`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label}: "${bin}" saiu com código ${code}. ${stderr.trim().slice(-500)}`));
    });
  });
}

/**
 * Lê a duração de um WAV PCM a partir do header (bytes de dados / byte rate).
 * Evita depender de ffprobe.
 */
async function wavDurationSeconds(wavPath: string): Promise<number> {
  const fd = await fs.open(wavPath, "r");
  try {
    const head = Buffer.alloc(64);
    const { bytesRead } = await fd.read(head, 0, 64, 0);
    if (bytesRead < 44 || head.toString("ascii", 0, 4) !== "RIFF") return 0;
    const byteRate = head.readUInt32LE(28); // bytes por segundo
    const stat = await fd.stat();
    const dataBytes = stat.size - 44; // header canônico de 44 bytes
    if (byteRate <= 0 || dataBytes <= 0) return 0;
    return Math.round((dataBytes / byteRate) * 100) / 100;
  } catch {
    return 0;
  } finally {
    await fd.close();
  }
}

/**
 * Converte um buffer de áudio (qualquer formato suportado por ffmpeg: ogg/opus,
 * webm, mp3, m4a, wav...) em WAV PCM 16kHz mono — o formato que o whisper.cpp exige.
 */
export async function prepareAudio(input: Buffer, hintExt = "bin"): Promise<PreparedAudio> {
  await fs.mkdir(config.tmpDir, { recursive: true });
  const id = crypto.randomUUID();
  const srcPath = path.join(config.tmpDir, `${id}.${sanitizeExt(hintExt)}`);
  const wavPath = path.join(config.tmpDir, `${id}.wav`);

  await fs.writeFile(srcPath, input);

  const cleanup = async () => {
    await Promise.allSettled([fs.rm(srcPath, { force: true }), fs.rm(wavPath, { force: true })]);
  };

  try {
    await run(
      config.ffmpegBin,
      ["-nostdin", "-y", "-i", srcPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", wavPath],
      "ffmpeg",
    );
  } catch (err) {
    await cleanup();
    throw err;
  }

  const durationSeconds = await wavDurationSeconds(wavPath);
  return { wavPath, durationSeconds, cleanup };
}

function sanitizeExt(ext: string): string {
  const clean = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return clean.length > 0 && clean.length <= 5 ? clean : "bin";
}

/** Deriva uma extensão provável a partir do mime type (apenas dica para o ffmpeg). */
export function extFromMime(mime?: string): string {
  if (!mime) return "bin";
  const m = mime.toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("wav")) return "wav";
  return "bin";
}
