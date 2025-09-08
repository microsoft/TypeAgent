// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parentPort, workerData } from "worker_threads";
import chalk from "chalk";
import dotenv from "dotenv";
import { bingWithGrounding, openPhraseGeneratorAgent } from "azure-ai-foundry";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { isPageAvailable } from "./common.js";

async function processDomain(
    domain: string,
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
) {
    try {
        const phrases: openPhraseGeneratorAgent.openPhrases | undefined | null =
            await openPhraseGeneratorAgent.createOpenPhrasesForDomain(
                domain,
                groundingConfig,
                project,
            );
        console.log(
            chalk.green(
                `Successfully processed domain ${domain} - Found ${phrases?.urls.length} urls`,
            ),
        );

        // make sure the that URLs we got back are accessible
        // phrases?.urls.forEach(async (sr: openPhraseGeneratorAgent.SearchResult) => {
        //     const isAvailable = await isPageAvailable(sr.pageUrl);
        //     if (!isAvailable) {
        //         console.warn(chalk.yellow(`Skipping inaccessible URL: ${sr.pageUrl}`));
        //     }
        // });

        if (phrases?.urls) {
            const availableUrls = await Promise.all(
                phrases?.urls.filter(
                    async (sr: openPhraseGeneratorAgent.SearchResult) => {
                        return await isPageAvailable(sr.pageUrl);
                    },
                ),
            );

            phrases.urls = availableUrls;
        }

        // send the result to the parent
        parentPort?.postMessage({
            success: true,
            phrases: phrases,
            domain: domain,
        });
    } catch (error: any) {
        console.error(
            chalk.red(`Error processing domain ${domain}: ${error.message}`),
        );
        parentPort?.postMessage({
            success: false,
            domain: domain,
            error: error.message,
        });
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
