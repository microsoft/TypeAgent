// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { runTests } from "./tests/test.js";
import { runCodeChat } from "./codeChat/codeChat.js";
import { runPlayChat } from "./memory/chatMemory.js";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

let chatName = process.argv[2];
if (!chatName) {
    chatName = "play";
}
switch (chatName) {
    default:
        console.log("Unknown chat type: " + chatName);
        break;
    case "code":
        await runCodeChat();
        break;
    case "play":
        await runPlayChat();
        break;
    case "tests":
        await runTests();
        break;
}
