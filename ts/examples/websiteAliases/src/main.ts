// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { bingWithGrounding, extractorAgent } from "azure-ai-foundry";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { MessageContentUnion, ThreadMessage } from "@azure/ai-agents";
import { writeFileSync } from "node:fs";
import puppeteer, { TimeoutError } from "puppeteer";
import { exec } from "node:child_process";
import chalk from "chalk";

// Load environment variables from .env file
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const groundingConfig: bingWithGrounding.ApiSettings = bingWithGrounding.apiSettingsFromEnv();
const project = new AIProjectClient(
    groundingConfig.endpoint!,
    new DefaultAzureCredential(),
);

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
    if (line.length > 0) {
        const parts = line.split(",");
        return parts[1].trim().replaceAll("\"", ""); // get the domain name
    }
});

// go get the aliases for each site
const aliases: Record<string, string[]> = {};

/**
 * Fetch the HTML content of a web page.
 * @param site - The URL whose HTML page to retreive
 * @returns - The HTML content of the page
 */
async function fetchURL(site: string): Promise<string | null> {
    try {
        await closeChrome();
    } catch(e) {
        console.log(e);
    }

    const browser = await puppeteer.launch({
        headless: false
    });

    const page = await browser.newPage();
    try {
        await page.goto(`https://moz.com/domain-analysis/${site}`, { waitUntil: "load" });
        await page.waitForSelector(
            'div[class="container domain-analysis"]',
            {
                timeout: 5000,
            },
        );

        const data = await page.$$eval('script[type="application/ld+json"]', `document.documentElement.outerHTML`);
        if (data) {
            console.log(`Extracted data for ${site}`);
        }
        return data as string;
    } catch (err) {
        if (err instanceof TimeoutError) {
            console.warn("Element did not appear within 5 seconds.");
        } else {
            console.warn(`Failed to scrape ${site}: ${err}`);
        }
        return null;
    } finally {
        await page.close();
    }
}

// for(let i = 0; i < 3; i++) {
//     const site = sites[i];
let processed = 0;
for(const site of sites) {
    if (site) { 
        getRandomDelay(2000, 3000);

        aliases[site] = [];

        console.info(`Extracting data for ${site}`);

        const data = await fetchURL(site);

        if (data) {
            // extract the aliases using the extractor agent
            const extracted: extractorAgent.extractedAliases | null | undefined = await extractAliases(JSON.stringify(data));

            // merge extracted keywords
            if (extracted) {
                aliases[site] = Array.from(new Set([...extracted.brandedKeyWords, ...extracted.extractedKeywordsByClick, ...extracted.topRankingKeywords]));
                console.log(`Extracted ${aliases[site].length} alises for ${site}`);
            }
        } else {
            console.error(`Failed to fetch aliases for ${site}: ${data}`);
        }
    }
    console.log(`Progress: ${chalk.green(`${++processed} out of ${sites.length} (${Math.round((processed / sites.length) * 100)}%)`)} sites processed.`);
};

const keywordToSites: Record<string, string[]> = {};

for (const [site, keywords] of Object.entries(aliases)) {
    for (const keyword of keywords) {
        if (!keywordToSites[keyword]) {
            keywordToSites[keyword] = [];
        }
        keywordToSites[keyword].push(site);
    }
}

// Serialize keywordToSites to disk in JSON format
writeFileSync("keyword_to_sites.json", JSON.stringify(keywordToSites, null, 2));

/**
 * Extract aliases from the provided HTML data using the extractor agent.
 * @param data - The HTML data to extract aliases from
 * @returns - The extracted aliases or null if content filter was triggered, or undefined if an error occurred
 */
async function extractAliases(data: string): Promise<extractorAgent.extractedAliases | undefined | null> {
    const agent = await extractorAgent.ensureKeywordExtractorAgent(groundingConfig, project);
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
        //await project.agents.messages.create(thread.id, "user", data);

        // Create run
        const run = await project.agents.runs.createAndPoll(
            thread.id,
            agent.id,
            {
                pollingOptions: {
                    intervalInMs: 250,
                },
                onResponse: (response): void => {
                    console.debug(`Received response with status: ${response.status}`);

                    const pb: any = response.parsedBody;
                    if (pb?.incomplete_details?.reason) {
                        inCompleteReason = pb.incomplete_details.reason;
                        console.warn(`Run incomplete due to: ${inCompleteReason}`);
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
                            retVal = JSON.parse(txt) as extractorAgent.extractedAliases;
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



