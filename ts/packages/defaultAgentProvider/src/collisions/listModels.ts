// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lists every chat model wired in this checkout's `ts/.env`.
// Used to scope multi-model phrase-corpus generation runs before
// committing to one.
//
// Usage (from ts/, after building):
//   node packages/defaultAgentProvider/dist/collisions/listModels.js

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { getChatModelNames } from "@typeagent/aiclient";

const names = await getChatModelNames();
process.stdout.write(`Found ${names.length} chat model(s) in ts/.env:\n`);
for (const name of names) {
    process.stdout.write(`  ${name || "(default)"}\n`);
}
