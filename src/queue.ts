import crypto from "node:crypto";
import { config } from "./config.js";
import { transcribeBuffer, type TranscriptionOutput } from "./whisper.js";

export type JobStatus = "queued" | "processing" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationSeconds?: number;
  transcript?: string;
  language?: string;
  error?: string;
  /** Metadado opaco que o chamador associa ao job (ex.: messageId). */
  ref?: string;
  callbackUrl?: string;
  // internos
  _audio: Buffer;
  _mimeType?: string;
  _requestedLanguage?: string;
}

export interface SubmitInput {
  audio: Buffer;
  mimeType?: string;
  language?: string;
  ref?: string;
  callbackUrl?: string;
}

/** Visão pública do job (sem o buffer de áudio). */
export function publicJob(job: Job) {
  return {
    id: job.id,
    status: job.status,
    transcript: job.transcript ?? null,
    language: job.language ?? null,
    durationSeconds: job.durationSeconds ?? null,
    error: job.error ?? null,
    ref: job.ref ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
  };
}
export type PublicJob = ReturnType<typeof publicJob>;

/**
 * Fila de transcrição em memória com worker(s) sequenciais. Simples e suficiente
 * para uma instância; a persistência pode ser adicionada depois sem mudar a API.
 */
export class TranscriptionQueue {
  private jobs = new Map<string, Job>();
  private pending: string[] = [];
  private active = 0;

  constructor() {
    setInterval(() => this.sweep(), 60_000).unref?.();
  }

  submit(input: SubmitInput): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      status: "queued",
      createdAt: Date.now(),
      ref: input.ref,
      callbackUrl: input.callbackUrl,
      _audio: input.audio,
      _mimeType: input.mimeType,
      _requestedLanguage: input.language,
    };
    this.jobs.set(job.id, job);
    this.pending.push(job.id);
    queueMicrotask(() => this.pump());
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  stats() {
    return {
      total: this.jobs.size,
      pending: this.pending.length,
      active: this.active,
      concurrency: config.concurrency,
    };
  }

  private pump(): void {
    while (this.active < config.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.status !== "queued") continue;
      this.active += 1;
      void this.process(job).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async process(job: Job): Promise<void> {
    job.status = "processing";
    job.startedAt = Date.now();
    try {
      const result = await withTimeout(
        transcribeBuffer(job._audio, { mimeType: job._mimeType, language: job._requestedLanguage }),
        config.jobTimeoutMs,
      );
      job.status = "done";
      job.transcript = result.transcript;
      job.language = result.language;
      job.durationSeconds = result.durationSeconds;
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finishedAt = Date.now();
      // Libera o áudio da memória assim que termina.
      job._audio = Buffer.alloc(0);
      await this.notify(job);
    }
  }

  private async notify(job: Job): Promise<void> {
    if (!job.callbackUrl) return;
    try {
      await fetch(job.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiToken ? { "x-api-token": config.apiToken } : {}),
        },
        body: JSON.stringify(publicJob(job)),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Callback é best-effort; o chamador ainda pode consultar por GET.
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if ((job.status === "done" || job.status === "error") && job.finishedAt && now - job.finishedAt > config.jobTtlMs) {
        this.jobs.delete(id);
      }
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout após ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export type { TranscriptionOutput };
