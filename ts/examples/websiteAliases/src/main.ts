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
    keywordToSites = JSON.parse(readFileSync(keywordSiteMapFile, "utf-8"));
}

// Now go through the keywords and use the URLResolver to get the URLs for each keyword
const keywordToSiteWithURLResolver: Record<string, string | null | undefined> =
    {};
const keyCount = Object.keys(keywordToSites).length;
let processed = 0;
for (const keyword of Object.keys(keywordToSites)) {
    console.log(`Resolving URL for keyword: ${keyword}`);
    const sites = await urlResolver.resolveURLWithSearch(
        keyword,
        groundingConfig,
    );

    if (sites) {
        keywordToSiteWithURLResolver[keyword] = sites[0];
    }
    console.log(
        `\tResolved URL for keyword ${keyword}: ${keywordToSiteWithURLResolver[keyword]}`,
    );

    // if we don't get a hit for the keyword, remove it from the map
    if (!keywordToSiteWithURLResolver[keyword]) {
        delete keywordToSiteWithURLResolver[keyword];
    }

    console.log(
        `Progress: ${chalk.green(`${++processed} out of ${keyCount} (${Math.round((processed / keyCount) * 100)}%)`)} keywords processed.`,
    );
}

// Serialize keywordToSites to disk in JSON format
writeFileSync(
    resolvedKeyWordFile,
    JSON.stringify(keywordToSiteWithURLResolver, null, 2),
);

/**
 * Extract aliases from the provided HTML data using the extractor agent.
 * @param data - The HTML data to extract aliases from
 * @returns - The extracted aliases or null if content filter was triggered, or undefined if an error occurred
 */
async function extractAliases(
    data: string,
): Promise<extractorAgent.extractedAliases | undefined | null> {
    const agent = await extractorAgent.ensureKeywordExtractorAgent(
        groundingConfig,
        project,
    );
    let inCompleteReason;
    let retVal: extractorAgent.extractedAliases | undefined | null;

    if (!agent) {
        throw new Error(
            "No agent found for extracting web site aliases. Please check your configuration.",
        );
    }

    try {
        const thread = await project.agents.threads.create();

        // create the HTML message (chunk it)
        const chunkSize = 128 * 1024; // 128k chunks
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            await project.agents.messages.create(thread.id, "user", chunk);
        }

        // Create run
        const run = await project.agents.runs.createAndPoll(
            thread.id,
            agent.id,
            {
                pollingOptions: {
                    intervalInMs: 250,
                },
                onResponse: (response): void => {
                    console.debug(
                        `Received response with status: ${response.status}`,
                    );

                    const pb: any = response.parsedBody;
                    if (pb?.incomplete_details?.reason) {
                        inCompleteReason = pb.incomplete_details.reason;
                        console.warn(
                            `Run incomplete due to: ${inCompleteReason}`,
                        );
                    }
                },
            },
        );

        const msgs: ThreadMessage[] = [];
        if (run.status === "completed") {
            if (run.completedAt) {
                // Retrieve messages
                const messages = await project.agents.messages.list(thread.id, {
                    order: "asc",
                });

                // accumulate assistant messages
                for await (const m of messages) {
                    if (m.role === "assistant") {
                        // TODO: handle multi-modal content
                        const content: MessageContentUnion | undefined =
                            m.content.find(
                                (c) => c.type === "text" && "text" in c,
                            );
                        if (content) {
                            msgs.push(m);
                            let txt: string = (content as any).text
                                .value as string;
                            txt = txt
                                .replaceAll("```json", "")
                                .replaceAll("```", "");
                            retVal = JSON.parse(
                                txt,
                            ) as extractorAgent.extractedAliases;
                        }
                    }
                }
            }
        }

        // delete the thread we just created since we are currently one and done
        project.agents.threads.delete(thread.id);
    } catch (e) {
        console.error(`Error resolving URL with search: ${e}`);

        if (inCompleteReason === "content_filter") {
            retVal = null;
        } else {
            retVal = undefined;
        }
    }

    // return assistant messages
    return retVal;
}

async function closeChrome(): Promise<void> {
    return new Promise<void>((resolve) => {
        let command = "";

        // Determine the command based on the operating system
        if (process.platform === "win32") {
            command = "taskkill /F /IM chrome.exe /T";
        } else if (process.platform === "darwin") {
            command = 'pkill -9 "Google Chrome"';
        } else {
            command = "pkill -9 chrome";
        }

        console.log(`Attempting to close Chrome with command: ${command}`);

        exec(command, (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.log(
                    `Chrome may not be running or couldn't be closed: ${error.message}`,
                );
            }

            if (stderr) {
                console.log(`Chrome close error output: ${stderr}`);
            }

            if (stdout) {
                console.log(`Chrome closed successfully: ${stdout}`);
            }

            resolve();
        });
    });
}

function getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
