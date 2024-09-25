
window.addEventListener("message", async (event) => {
    if (event.data === "setupSiteAgent") {
        if (window.browserConnect) {
            const pageUrl = window.location.href;

            if (pageUrl.startsWith("https://paleobiodb.org")) {
                window.browserConnect.enableSiteAgent("browser.paleoBioDb");
            }

            if (
                pageUrl.startsWith("https://embed.universaluclick.com") ||
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
                window.browserConnect.enableSiteAgent("browser.crossword");
            }

            if (
                pageUrl.startsWith("https://www.homedepot.com") ||
                pageUrl.startsWith("https://www.target.com") ||
                pageUrl.startsWith("https://www.walmart.com")
            ) {
                window.browserConnect.enableSiteAgent("browser.commerce");
            }
        } else {
            console.log("browserconnect not found by UI events script");
        }
    }
});