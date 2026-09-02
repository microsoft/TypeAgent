// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import {
    mergeTranslationBenchCheckpoints,
    readTranslationBenchCheckpoint,
} from "../synthesizer/generationSupport.js";

const files = new Command().argument("<checkpoints...>").parse().args;
const merged = mergeTranslationBenchCheckpoints(
    files.map((filePath) => readTranslationBenchCheckpoint(filePath)),
);
process.stdout.write(`${JSON.stringify(merged.rows, null, 2)}\n`);
