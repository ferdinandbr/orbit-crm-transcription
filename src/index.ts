import http from "node:http";
import { promises as fs } from "node:fs";
import { config } from "./config.js";
import { TranscriptionQueue, publicJob, type Job } from "./queue.js";

const queue = new TranscriptionQueue();

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authOk(req: http.IncomingMessage): boolean {
  if (!config.apiToken) return true;
  return req.headers["x-api-token"] === config.apiToken;
}

/** Espera o job finalizar (para o modo síncrono ?wait=true). */
function waitForJob(job: Job, timeoutMs: number): Promise<Job> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (job.status === "done" || job.status === "error" || Date.now() - started > timeoutMs) {
        resolve(job);
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    let modelOk = true;
    try {
      await fs.access(config.whisperModel);
    } catch {
      modelOk = false;
    }
    return sendJson(res, 200, {
      ok: true,
      service: "crm-orbit-transcription",
      model: config.whisperModelName,
      modelAvailable: modelOk,
      language: config.language,
      queue: queue.stats(),
    });
  }

  if (!authOk(req)) {
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }

  if (req.method === "POST" && pathname === "/transcriptions") {
    let raw: string;
    try {
      raw = await readBody(req, config.maxAudioBytes * 2); // base64 ~= 1.37x
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read_error";
      return sendJson(res, msg === "payload_too_large" ? 413 : 400, { ok: false, error: msg });
    }

    let parsed: { audioBase64?: string; mimeType?: string; language?: string; ref?: string; callbackUrl?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { ok: false, error: "invalid_json" });
    }

    if (!parsed.audioBase64 || typeof parsed.audioBase64 !== "string") {
      return sendJson(res, 400, { ok: false, error: "audioBase64 é obrigatório" });
    }

    const b64 = parsed.audioBase64.includes(",")
      ? parsed.audioBase64.slice(parsed.audioBase64.indexOf(",") + 1)
      : parsed.audioBase64;
    const audio = Buffer.from(b64, "base64");
    if (audio.length === 0) {
      return sendJson(res, 400, { ok: false, error: "áudio vazio ou base64 inválido" });
    }
    if (audio.length > config.maxAudioBytes) {
      return sendJson(res, 413, { ok: false, error: "áudio acima do limite" });
    }

    const job = queue.submit({
      audio,
      mimeType: parsed.mimeType,
      language: parsed.language,
      ref: parsed.ref,
      callbackUrl: parsed.callbackUrl,
    });

    const wantsWait = url.searchParams.get("wait") === "true" || url.searchParams.get("wait") === "1";
    if (wantsWait) {
      const finished = await waitForJob(job, config.jobTimeoutMs + 5_000);
      return sendJson(res, 200, { ok: true, job: publicJob(finished) });
    }
    return sendJson(res, 202, { ok: true, job: publicJob(job) });
  }

  const getMatch = /^\/transcriptions\/([^/]+)$/.exec(pathname);
  if (req.method === "GET" && getMatch) {
    const job = queue.get(getMatch[1]!);
    if (!job) return sendJson(res, 404, { ok: false, error: "job não encontrado ou expirado" });
    return sendJson(res, 200, { ok: true, job: publicJob(job) });
  }

  return sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(config.port, () => {
  console.log(`[transcription] serviço em http://localhost:${config.port}`);
  console.log(`[transcription] modelo: ${config.whisperModelName}`);
  console.log(`[transcription] whisper: ${config.whisperBin} | ffmpeg: ${config.ffmpegBin} | lang: ${config.language}`);
  console.log(`[transcription] concorrência: ${config.concurrency}`);
});
