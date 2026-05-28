// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";
import { runCodeChat } from "./codeChat/codeChat.js";
import { runKnowledgeProcessorCommands } from "./knowledgeProc/knowledgeProcessorMemory.js";
import { runCodeMemoryCommands } from "./codeChat/codeMemory.js";
import { runKnowproMemory } from "./memory/knowproMemory.js";

loadConfigSync();

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
