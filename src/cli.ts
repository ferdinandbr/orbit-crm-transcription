import { promises as fs } from "node:fs";
import path from "node:path";
import { transcribeBuffer } from "./whisper.js";
import { config } from "./config.js";

/**
 * CLI one-shot: transcreve um arquivo de áudio sem subir o serviço HTTP.
 * Uso: npm run transcribe -- caminho/do/audio.ogg [idioma]
 */
async function main() {
  const file = process.argv[2];
  const language = process.argv[3];
  if (!file) {
    console.error("Uso: npm run transcribe -- <arquivo de áudio> [idioma]");
    console.error('Ex.:  npm run transcribe -- ./amostra.ogg pt');
    process.exit(2);
  }

  const abs = path.resolve(file);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(abs);
  } catch (err) {
    console.error(`Não foi possível ler o arquivo: ${abs} (${(err as Error).message})`);
    process.exit(2);
    return;
  }

  console.error(`[cli] transcrevendo ${abs} (modelo: ${path.basename(config.whisperModel)})...`);
  const t0 = Date.now();
  try {
    const out = await transcribeBuffer(buffer, { language });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[cli] pronto em ${elapsed}s | duração do áudio: ${out.durationSeconds}s | idioma: ${out.language}`);
    console.error("---");
    // Transcrição vai para stdout (permite redirecionar/pipe).
    process.stdout.write(out.transcript + "\n");
  } catch (err) {
    console.error(`[cli] erro: ${(err as Error).message}`);
    process.exit(1);
  }
}

void main();
