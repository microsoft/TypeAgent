// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CrosswordWebAgent } from "../webagent/crossword/CrosswordWebAgent";
import { WebAgent } from "../webagent/WebAgentContext";

declare global {
    interface Window {
        __webAgentRegister?: (agent: WebAgent) => void;
    }
}

const agent = new CrosswordWebAgent();

function register() {
    if (window.__webAgentRegister) {
        window.__webAgentRegister(agent);
    } else {
        console.warn("[sites/crossword] __webAgentRegister not available");
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        register();
    });
} else {
    register();
}
