// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {};

declare global {
    interface Window {
        browserConnect: any;
    }
}

let siteAgent: string = "";
let siteAgentInitialized = false;
function setupSiteAgent() {
    if (window.browserConnect) {
        if (siteAgentInitialized) {
            return;
        }

        if (siteAgent === "") {
            // default to actionDiscovery
            siteAgent = "browser.actionDiscovery";
            window.browserConnect.enableSiteAgent(siteAgent);
        }

        siteAgentInitialized = true;
    } else {
        console.log("browserconnect not found by UI events script");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    setupSiteAgent();
});

window.addEventListener("beforeunload", (event) => {
    if (siteAgent !== undefined && window.browserConnect !== undefined) {
        window.browserConnect.disableSiteAgent(siteAgent);
    }
});
