// Lists every chat model wired in this checkout's ts/.env.
// Used to scope S2 (multi-model phrase corpus generation) — we want
// to know which models are actually available before committing to a
// generation run.

import { config as loadDotenv } from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoTsRoot = path.resolve(__dirname, "../../..");
loadDotenv({ path: path.join(repoTsRoot, ".env") });

import { getChatModelNames } from "aiclient";

const names = await getChatModelNames();
process.stdout.write(`Found ${names.length} chat model(s) in ts/.env:\n`);
for (const name of names) {
    process.stdout.write(`  ${name || "(default)"}\n`);
}
