// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { bingWithGrounding } from "azure-ai-foundry";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { searchKeywordExtractor } from "./searchEngineKeywords.js";
import { topNDomainsExtractor } from "./topNsites.js";

// Load environment variables from .env file
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const groundingConfig: bingWithGrounding.ApiSettings =
    bingWithGrounding.apiSettingsFromEnv();
const project = new AIProjectClient(
    groundingConfig.endpoint!,
    new DefaultAzureCredential(),
);

// go get top websites and keywords from Moz
if (process.argv.includes("--moz")) {
    console.log("Website search keyword extractor selected.");
    const ee = new searchKeywordExtractor(project, groundingConfig);
    await ee.extract();
} else {
    // go get top NNN sites from CloudFlare
    console.log("Top N sites extractor selected.");
    
    const topN = parseInt(process.argv[process.argv.indexOf("--topN") + 1], 10);
    const topNExtractor = new topNDomainsExtractor(topN);
    await topNExtractor.extract();
}

