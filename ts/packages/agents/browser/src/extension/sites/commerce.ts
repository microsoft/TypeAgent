// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommerceWebAgent } from "../webagent/commerce/CommerceWebAgent";
import { WebAgent } from "../webagent/WebAgentContext";

declare global {
    interface Window {
        __webAgentRegister?: (agent: WebAgent) => void;
    }
}

const agent = new CommerceWebAgent();

function register() {
    if (window.__webAgentRegister) {
        window.__webAgentRegister(agent);
    } else {
        console.warn("[sites/commerce] __webAgentRegister not available");
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        register();
    });
} else {
    register();
}
