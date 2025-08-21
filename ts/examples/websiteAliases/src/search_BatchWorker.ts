// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parentPort, workerData } from "worker_threads";
import chalk from "chalk";
import dotenv from "dotenv";
import { bingWithGrounding, openPhraseGeneratorAgent } from "azure-ai-foundry";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

async function processDomain(domain: string, groundingConfig: bingWithGrounding.ApiSettings, project: AIProjectClient) {

    try {
        const phrases: openPhraseGeneratorAgent.openPhrases | undefined | null = await openPhraseGeneratorAgent.createOpenPhrasesForDomain(domain, groundingConfig, project);
        console.log(chalk.green(`Successfully processed domain ${domain} - Found ${phrases?.urls.length} urls`));

        // send the result to the parent
        parentPort?.postMessage({
            success: true,
            phrases: phrases,
            domain: domain,
        });
    } catch (error: any) {
        console.error(chalk.red(`Error processing domain ${domain}: ${error.message}`));
        parentPort?.postMessage({ success: false, domain: domain,error: error.message });
    }
}

// This script expects workerData to contain { domains, modulePath }
(async () => {

    // Load environment variables from .env file
    const envPath = new URL("../../../.env", import.meta.url);
    dotenv.config({ path: envPath });

    const groundingConfig: bingWithGrounding.ApiSettings =
        bingWithGrounding.apiSettingsFromEnv();
    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );

    await processDomain(workerData.domain, groundingConfig, project);
})();

