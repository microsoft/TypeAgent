// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";

// Load environment variables from .env file
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

// go get top 500 sites
const topSitesUrl = "https://moz.com/top-500/download/?table=top500Domains";
const response = await fetch(topSitesUrl);
if (!response.ok) {
    throw new Error(`Failed to fetch top sites: ${response.statusText}`);
}

// extract the site names from the response
const csv_domains = await response.text();
const lines = csv_domains.split("\n").slice(1); // skip header
const sites = lines.map((line) => {
    const parts = line.split(",");
    return parts[1].trim(); // get the domain name
});

// go get the aliases for each site
const aliases: Record<string, string[]> = {};
sites.forEach(async (site) => {
    aliases[site] = [];

    response = await fetch(`https://moz.com/domain-analysis/${site}`);

    if (response.ok) {
        
    }

});


