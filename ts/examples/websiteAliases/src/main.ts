// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { bingWithGrounding } from "azure-ai-foundry";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { pageContentKeywordExtractor } from "./pageContentKeywords.js";
import { topNDomainsExtractor } from "./topNsites.js";
import { searchResultsPhraseGenerator } from "./searchBackedPhraseGeneration.js";

// Load environment variables from .env file
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const groundingConfig: bingWithGrounding.ApiSettings =
    bingWithGrounding.apiSettingsFromEnv();
const project = new AIProjectClient(
    groundingConfig.endpoint!,
    new DefaultAzureCredential(),
);

const topN = parseInt(
    process.argv[process.argv.indexOf("--topN") + 1],
    100,
);

// go get top websites and keywords from Moz
if (process.argv.includes("--pageContent")) {
    console.log("Website search keyword extractor selected.");
    const ee = new pageContentKeywordExtractor(project, groundingConfig);
    await ee.extract();
} else if (process.argv.includes("--topN")) {
    // go get top NNN sites from CloudFlare
    console.log("Top N sites extractor selected.");

    const topNExtractor = new topNDomainsExtractor(topN);

    if (process.argv.includes("--summary")) {
        await topNExtractor.summarize();
    } else {
        await topNExtractor.index(process.argv.includes("--clear"));
    }
} else {
    // search engine based phrase generation
    console.log("Search results phrase generator selected.");

    const searchResultsExtractor = new searchResultsPhraseGenerator(topN);

    if (process.argv.includes("--summary")) {
        await searchResultsExtractor.summarize();
    } else if (process.argv.includes("--compact")) {
        await searchResultsExtractor.compact();
    } else {
        await searchResultsExtractor.index(process.argv.includes("--clear"));
    }    
}
