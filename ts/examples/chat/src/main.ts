// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { runCodeChat } from "./codeChat/codeChat.js";
import { runKnowledgeProcessorCommands } from "./memory/knowledgeProcessorMemory.js";
import { runCodeMemoryCommands } from "./codeChat/codeMemory.js";
import { runKnowproMemory } from "./memory/knowproMemory.js";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

let areaName = process.argv[2];
if (areaName) {
    process.argv.splice(2, 1);
} else {
    areaName = "memory";
}
switch (areaName) {
    default:
        console.log("Unknown feature area name: " + areaName);
        break;
    case "memory":
        await runKnowproMemory();
        break;
    case "knowledgeProc":
        await runKnowledgeProcessorCommands();
        break;
    case "code":
        await runCodeChat();
        break;
    case "codeMemory":
        await runCodeMemoryCommands();
        break;
}
