// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { bingWithGrounding, extractorAgent } from "azure-ai-foundry";
import { MessageContentUnion, ThreadMessage } from "@azure/ai-agents";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer, { TimeoutError } from "puppeteer";
import chalk from "chalk";
import { urlResolver } from "azure-ai-foundry";
import { closeChrome, getRandomDelay, keywordSiteMapFile, resolvedKeyWordFile } from "./common.js";
import { AIProjectClient } from "@azure/ai-projects";


export class searchKeywordExtractor {
    project: AIProjectClient;
    groundingConfig: bingWithGrounding.ApiSettings;

    constructor(project: AIProjectClient, groundingConfig: bingWithGrounding.ApiSettings) {
        this.project = project;
        this.groundingConfig = groundingConfig;
    }

    keywordToSites: Record<string, string[]> = {};
    aliases: Record<string, string[]> = {};

    /**
     * Fetch the HTML content of a web page.
     * @param site - The URL whose HTML page to retreive
     * @returns - The HTML content of the page
     */
    private async fetchURL(site: string): Promise<string | null> {
        try {
            await closeChrome();
        } catch (e) {
            console.log(e);
        }

        const browser = await puppeteer.launch({
            headless: false,
        });

        const page = await browser.newPage();
        try {
            await page.goto(`https://moz.com/domain-analysis/${site}`, {
                waitUntil: "load",
            });
            await page.waitForSelector('div[class="container domain-analysis"]', {
                timeout: 5000,
            });

            const data = await page.$$eval(
                'script[type="application/ld+json"]',
                `document.documentElement.outerHTML`,
            );
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

    private async getKeywords(sites: string[]): Promise<void> {
        let processed = 0;
        for (const site of sites) {
            if (site && site.length > 0) {
                getRandomDelay(2000, 3000);

                this.aliases[site] = [];

                console.info(`Extracting data for ${site}`);

                const data = await this.fetchURL(site);

                if (data) {
                    // extract the aliases using the extractor agent
                    const extracted:
                        | extractorAgent.extractedAliases
                        | null
                        | undefined = await this.extractAliases(JSON.stringify(data));

                    // merge extracted keywords
                    if (extracted) {
                        this.aliases[site] = Array.from(
                            new Set([
                                ...extracted.brandedKeyWords,
                                ...extracted.extractedKeywordsByClick,
                                ...extracted.topRankingKeywords,
                            ]),
                        );
                        console.log(
                            `Extracted ${this.aliases[site].length} alises for ${site}`,
                        );
                    }
                } else {
                    console.error(`Failed to fetch aliases for ${site}: ${data}`);
                }
            }
            console.log(
                `Progress: ${chalk.green(`${++processed} out of ${sites.length} (${Math.round((processed / sites.length) * 100)}%)`)} sites processed.`,
            );
        }

        for (const [site, keywords] of Object.entries(this.aliases)) {
            for (const keyword of keywords) {
                if (!this.keywordToSites[keyword]) {
                    this.keywordToSites[keyword] = [];
                }
                this.keywordToSites[keyword].push(site);
            }
        }

        // Serialize keywordToSites to disk in JSON format
        writeFileSync(keywordSiteMapFile, JSON.stringify(this.keywordToSites, null, 2));
    }

    public async extract() {
        if (!existsSync(keywordSiteMapFile)) {
            // go get top 500 sites
            const topSitesUrl = "https://moz.com/top-500/download/?table=top500Domains";
            const response = await fetch(topSitesUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch top sites: ${response.statusText}`);
            }

            // extract the site names from the response
            const csv_domains = await response.text();
            const lines = csv_domains.split("\n").slice(1); // skip header
            const sites: string[] = lines.map((line) => {
                if (line.length > 0) {
                    const parts = line.split(",");
                    return parts[1].trim().replaceAll('"', ""); // get the domain name
                } else {
                    return "";
                }
            });

            this.getKeywords(sites);
        } else {
            this.keywordToSites = JSON.parse(readFileSync(keywordSiteMapFile, "utf-8"));
        }

        // Now go through the keywords and use the URLResolver to get the URLs for each keyword
        const keywordToSiteWithURLResolver: Record<string, string | null | undefined> =
            {};
        const keyCount = Object.keys(this.keywordToSites).length;
        let processed = 0;
        for (const keyword of Object.keys(this.keywordToSites)) {
            console.log(`Resolving URL for keyword: ${keyword}`);
            const sites = await urlResolver.resolveURLWithSearch(
                keyword,
                this.groundingConfig,
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
    }

    /**
     * Extract aliases from the provided HTML data using the extractor agent.
     * @param data - The HTML data to extract aliases from
     * @returns - The extracted aliases or null if content filter was triggered, or undefined if an error occurred
     */
    private async extractAliases(
        data: string,
    ): Promise<extractorAgent.extractedAliases | undefined | null> {
        const agent = await extractorAgent.ensureKeywordExtractorAgent(
            this.groundingConfig,
            this.project,
        );
        let inCompleteReason;
        let retVal: extractorAgent.extractedAliases | undefined | null;

        if (!agent) {
            throw new Error(
                "No agent found for extracting web site aliases. Please check your configuration.",
            );
        }

        try {
            const thread = await this.project.agents.threads.create();

            // create the HTML message (chunk it)
            const chunkSize = 128 * 1024; // 128k chunks
            for (let i = 0; i < data.length; i += chunkSize) {
                const chunk = data.slice(i, i + chunkSize);
                await this.project.agents.messages.create(thread.id, "user", chunk);
            }

            // Create run
            const run = await this.project.agents.runs.createAndPoll(
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
                    const messages = await this.project.agents.messages.list(thread.id, {
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
            this.project.agents.threads.delete(thread.id);
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
}
