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

        const pageUrl = window.location.href;
        const host = new URL(pageUrl).host;

        if (host === "paleobiodb.org" || host === "www.paleobiodb.org") {
            siteAgent = "browser.paleoBioDb";
            window.browserConnect.enableSiteAgent(siteAgent);
        }

        if (
            pageUrl.startsWith("https://embed.universaluclick.com/") ||
            pageUrl.startsWith("https://data.puzzlexperts.com/puzzleapp") ||
            pageUrl.startsWith("https://nytsyn.pzzl.com/cwd_seattle") ||
            pageUrl.startsWith("https://www.wsj.com/puzzles/crossword") ||
            pageUrl.startsWith(
                "https://www.seattletimes.com/games-nytimes-crossword",
            ) ||
            pageUrl.startsWith(
                "https://www.denverpost.com/games/daily-crossword",
            ) ||
            pageUrl.startsWith(
                "https://www.denverpost.com/puzzles/?amu=/iwin-crossword",
            ) ||
            pageUrl.startsWith(
                "https://www.bestcrosswords.com/bestcrosswords/guestconstructor",
            )
        ) {
            siteAgent = "browser.crossword";
            window.browserConnect.enableSiteAgent(siteAgent);
        }

        const commerceHosts = [
            "www.homedepot.com",
            "www.target.com",
            "www.walmart.com",
        ];

        if (commerceHosts.includes(host)) {
            siteAgent = "browser.commerce";
            window.browserConnect.enableSiteAgent(siteAgent);
        }

        if (host === "instacart.com" || host === "www.instacart.com") {
            siteAgent = "browser.instacart";
            window.browserConnect.enableSiteAgent(siteAgent);
        }

        if (siteAgent === "") {
            // default to schemaFinder
            siteAgent = "browser.schemaFinder";
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
