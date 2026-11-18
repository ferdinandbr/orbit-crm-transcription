// Baixa o modelo GGML do whisper.cpp (padrão: small) para ./models.
// Uso: node scripts/download-model.mjs [small|base|medium|...]
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(__dirname, "..", "models");

const model = (process.argv[2] || "small").replace(/[^a-z0-9.\-]/gi, "");
const fileName = `ggml-${model}.bin`;
const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`;
const dest = path.join(modelsDir, fileName);

async function main() {
  await mkdir(modelsDir, { recursive: true });

  try {
    const s = await stat(dest);
    if (s.size > 1_000_000) {
      console.log(`Modelo já existe: ${dest} (${(s.size / 1e6).toFixed(0)} MB). Nada a fazer.`);
      return;
    }
  } catch {
    // não existe — baixa
  }

  console.log(`Baixando ${fileName} de ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download falhou: HTTP ${res.status}`);
  }

  const total = Number(res.headers.get("content-length") || 0);
  let received = 0;
  const reader = Readable.fromWeb(res.body);
  reader.on("data", (c) => {
    received += c.length;
    if (total > 0) {
      const pct = ((received / total) * 100).toFixed(0);
      process.stdout.write(`\r  ${pct}% (${(received / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)`);
    }
  });

  await pipeline(reader, createWriteStream(dest));
  process.stdout.write("\n");
  console.log(`Pronto: ${dest}`);
}

main().catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
});
