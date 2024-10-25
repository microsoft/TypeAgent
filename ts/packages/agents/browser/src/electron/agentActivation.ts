// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {};

declare global {
    interface Window {
        browserConnect: any;
    }
}

let siteAgent: string = "";
function setupSiteAgent() {
    if (window.browserConnect) {
        const pageUrl = window.location.href;
        const host = new URL(pageUrl).host;

        if (host === "paleobiodb.org" || host === "www.paleobiodb.org") {
            siteAgent = "browser.paleoBioDb";
            window.browserConnect.enableSiteAgent("browser.paleoBioDb");
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
                "https://www.bestcrosswords.com/bestcrosswords/guestconstructor",
            )
        ) {
            siteAgent = "browser.crossword";
            window.browserConnect.enableSiteAgent("browser.crossword");
        }

        const commerceHosts = [
            "www.homedepot.com",
            "www.target.com",
            "www.walmart.com",
            "www.instacart.com",
        ];

        if (commerceHosts.includes(host)) {
            siteAgent = "browser.commerce";
            window.browserConnect.enableSiteAgent("browser.commerce");
        }
    } else {
        console.log("browserconnect not found by UI events script");
    }
}

window.addEventListener("message", (event) => {
    if (event.data === "setupSiteAgent") {
        setupSiteAgent();
    }
    if (
        event.data === "disableSiteAgent" &&
        siteAgent &&
        window.browserConnect
    ) {
        window.browserConnect.disableSiteAgent(siteAgent);
    }
});
