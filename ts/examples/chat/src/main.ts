// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { runTests } from "./tests/test.js";
import { runCodeChat } from "./codeChat/codeChat.js";
import { runChatMemory } from "./memory/chatMemory.js";
import { runCodeMemory } from "./codeChat/codeMemory.js";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

let chatName = process.argv[2];
if (chatName) {
    process.argv.splice(2, 1);
} else {
    chatName = "memory";
}
switch (chatName) {
    default:
        console.log("Unknown chat type: " + chatName);
        break;
    case "code":
        await runCodeChat();
        break;
    case "memory":
        await runChatMemory();
        break;
    case "codeMemory":
        await runCodeMemory();
        break;
    case "tests":
        await runTests();
        break;
}
