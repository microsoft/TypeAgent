// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import {
    existsSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
    statSync,
} from "fs";
import { domains } from "./generateOpenCommandPhrasesSchema.js";
import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";

type extractedDomains = {
    dateIndexed: number;
    domains: {
        [key: string]: {
            accessible: boolean | undefined;
            phrase_count?: number;
            phrases?: string[];
        };
    };
    phrases: {
        [key: string]: string[];
    };
};

// type crawlPages = {
//     pages: number;
//     pageSize: number;
//     blocks: number;
// }

export class topNDomainsExtractor {
    // manually downloadable from: https://radar.cloudflare.com/domains
    private downloadUrl: string =
        "https://radar.cloudflare.com/charts/LargerTopDomainsTable/attachment?id=1257&top=";
    private topN: number = 50000;
    private topNFile: string = `examples/websiteAliases/top${this.topN}.csv`;
    private outputFile: string =
        "examples/websiteAliases/phrases_to_sites.json";
    //private keywordsToSites: Record<string, string[]> = {};
    private processed: extractedDomains = {
        dateIndexed: Date.now(),
        domains: {},
        phrases: {},
    };

    constructor(topN?: number) {
        if (topN && topN > 0) {
            this.topN = topN;
        }

        const possibleOptions: number[] = [
            100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
            200_000, 500_000, 1_000_000,
        ];

        if (!possibleOptions.includes(this.topN)) {
            console.warn(
                chalk.yellow(
                    `Invalid topN value. Falling back to default: ${this.topN}`,
                ),
            );
            this.topN = 100;
        }

        this.downloadUrl += this.topN;
    }

    /**
     * Downloads the topN sites from CloudFlare, then systematically attepmpts to resolve a keyword for each site.
     */
    public async index(clear: boolean = false): Promise<void> {
        // get the top domains
        await this.downloadTopNDomains();

        try {
            // start over from scratch?
            if (!clear && existsSync(this.outputFile)) {
                this.processed = JSON.parse(
                    readFileSync(this.outputFile, "utf-8"),
                ) as extractedDomains;
            }
        } catch (error) {
            console.error(
                chalk.red(
                    `Error reading output file ${this.outputFile}: ${error}`,
                ),
            );
            console.warn("Deleting output file...");
            unlinkSync(this.outputFile);
        }

        // open the file, throw away the headers
        const fileContent = readFileSync(this.topNFile, "utf-8");
        const lines = fileContent.split("\n").slice(1);

        const batchSize = 1;
        const pageSize = 1;
        const batchCount = Math.ceil(lines.length / (batchSize * pageSize));
        const domains: string[][] = new Array<string[]>(batchCount);
        let pageNumber = 0;
        let batchNumber = 0;
        const batchPromises: Promise<void>[] = [];
        console.log(
            `${lines.length} domains. Processing in ${batchCount} batches of ${batchSize} domains each.`,
        );

        for (let i = 0; i < lines.length; i++) {
            const columns = lines[i].split(",");
            let domain = lines[i];

            // get the domain from the 2nd column if we have one
            if (columns.length === 3) {
                domain = columns[1].trim();
            }

            // skip empty domains or domains that are already processed
            if (!domain || this.processed.domains[domain] !== undefined) {
                console.warn(chalk.yellowBright(`Skipping domain: ${domain}`));
                continue;
            }

            // accumulate domains till will fill a page
            if (domains[pageNumber] === undefined) {
                domains[pageNumber] = [];
            }
            domains[pageNumber].push(domain);

            // once the page is full or if it's the last page, send it
            if (
                domains[pageNumber].length >= pageSize ||
                i === lines.length - 1
            ) {
                const page = pageNumber++;
                console.log(
                    `Processing page ${page}: ${chalk.blueBright(domains[page])}`,
                );

                // Spawn a worker for the batch
                const batchDomains = domains[page];
                const batchSourceFile = path.join(
                    path.dirname(fileURLToPath(import.meta.url)),
                    "./batchWorker.js",
                );
                const worker = new Worker(batchSourceFile, {
                    workerData: {
                        domains: batchDomains,
                    },
                });

                const batchPromise = new Promise<void>((resolve) => {
                    worker.on("message", async (msg) => {
                        if (msg.success) {
                            console.log(
                                chalk.grey(`Batch processed: ${batchDomains}`),
                            );

                            // merge the results into the index
                            this.mergeResults(msg, batchDomains);

                            resolve();
                        } else {
                            console.error(
                                chalk.red(`Batch failed: ${msg.error}`),
                            );
                            // Retry each domain individually
                            for (const domain of batchDomains) {
                                const singleWorker = new Worker(
                                    "./batchWorker.js",
                                    {
                                        workerData: {
                                            domains: [domain],
                                        },
                                    },
                                );
                                await new Promise<void>((res) => {
                                    singleWorker.on("message", (singleMsg) => {
                                        if (singleMsg.success) {
                                            console.log(
                                                chalk.green(
                                                    `Domain processed: ${domain}`,
                                                ),
                                            );

                                            // merge the results into the index
                                            this.mergeResults(msg, [domain]);
                                        } else {
                                            console.error(
                                                chalk.red(
                                                    `Domain failed: ${domain} - ${singleMsg.error}`,
                                                ),
                                            );
                                            // Optionally mark as failed in processed
                                            this.processed.domains[
                                                domain
                                            ].accessible = false;
                                            this.processed.domains[
                                                domain
                                            ].phrase_count = 0;
                                            this.processed.domains[
                                                domain
                                            ].phrases = [];
                                        }
                                        res();
                                    });
                                });
                            }
                            resolve();
                        }
                    });
                    worker.on("error", (err) => {
                        console.error(
                            chalk.red(`Worker error: ${err.message}`),
                        );
                        resolve();
                    });
                });

                // add the promise
                batchPromises.push(batchPromise);

                // wait for all of the promises to complete once the batch size is full, then continue
                if (
                    batchPromises.length >= batchSize ||
                    i >= lines.length - 1
                ) {
                    await Promise.all(batchPromises);

                    // reset the batch promises
                    batchPromises.length = 0;

                    batchNumber++;

                    // periodically save the output file so we don't have to start from scratch if we restart
                    writeFileSync(
                        this.outputFile,
                        JSON.stringify(this.processed, null, 2),
                    );
                    console.log(
                        chalk.green(
                            `Saved progress to ${this.outputFile} (${statSync(this.outputFile).size} bytes)`,
                        ),
                    );
                }
            }
        }

        // save the output file
        writeFileSync(this.outputFile, JSON.stringify(this.processed, null, 2));
    }

    /**
     * Merges the results from the domain processing into the main index.
     * @param data - The processed domains
     * @param batchDomains - The domains processed in this batch
     */
    private mergeResults(data: domains | undefined, batchDomains: string[]) {
        if (!data) {
            return;
        }

        data.domains.forEach((element) => {
            console.log(
                chalk.green(
                    `Generated ${element.aliases.length} phrases for ${element.domain}:`,
                ),
            );

            // merge the aliases with existing keywords
            element.aliases.forEach((alias) => {
                if (alias.toLowerCase().startsWith("open ")) {
                    alias = alias.slice(5);
                }

                // record the phrase redirection entry
                if (this.processed.phrases[alias] === undefined) {
                    this.processed.phrases[alias] = [element.domain];
                } else {
                    this.processed.phrases[alias] = [
                        ...new Set([
                            ...this.processed.phrases[alias],
                            element.domain,
                        ]),
                    ];

                    console.log(
                        chalk.yellow(
                            `\t${alias} now maps to ${this.processed.phrases[alias].length} sites.`,
                        ),
                    );
                }
            });

            // record domain stats
            this.processed.domains[element.domain] = { accessible: true };
            this.processed.domains[element.domain].phrase_count =
                element.aliases.length;
            this.processed.domains[element.domain].phrases = element.aliases;
        });

        // domains that were in the batch but were not processed were not accessible so we should mark that here
        const availableDomains: string[] = data.domains.map(
            (domain) => domain.domain,
        );
        const unavailableDomains: string[] = batchDomains.filter((domain) => {
            return !availableDomains.includes(domain);
        });

        unavailableDomains.forEach((domain: string) => {
            this.processed.domains[domain] = { accessible: false };
        });
    }

    // /**
    //  * Determines if the supplied URL is in the common crawl dataset
    //  * @param url - The URL to determine if it's in the common crawl
    //  */
    // private async isPageInCommonCrawl(url: string): Promise<boolean> {
    //     // https://index.commoncrawl.org/CC-MAIN-2025-30-index?url=google.com&showNumPages=true
    //     // {"pages": 1, "pageSize": 5, "blocks": 1}

    //     const response = await fetch(`https://index.commoncrawl.org/CC-MAIN-2025-30-index?url=${url}&showNumPages=true`, {
    //         method: "GET",
    //         headers: {
    //             "User-Agent": "TypeAgent/1.0/WebSiteAliases"
    //         }
    //     });

    //     console.log(`${chalk.dim(response)}`);
    //     if (response.ok) {
    //         const pages: crawlPages = JSON.parse(await response.text()) as crawlPages;
    //         if (pages && pages.pages > 0) {
    //             return true;
    //         }
    //     } else {
    //         console.log(`${chalk.dim(JSON.stringify(await response.text()))}`);
    //     }

    //     return false;
    // }

    /**
     * Downloads the topN domains from CloudFlare
     */
    private async downloadTopNDomains(): Promise<void> {
        if (existsSync(this.topNFile)) {
            console.log(
                `Top N domains file already downloaded to '${this.topNFile}'`,
            );
            return;
        }

        const response = await fetch(this.downloadUrl);
        if (!response.ok) {
            throw new Error(
                `Failed to fetch top N domains: ${response.statusText}.  Please download '${this.downloadTopNDomains} manually and put the file at '${this.topNFile}'`,
            );
        }

        // save this file locally
        const data = await response.text();
        writeFileSync(this.topNFile, data);
    }

    /**
     * Summarize the domain statistics.
     */
    public summarize() {
        console.log(chalk.dim("Processing..."));

        console.log(`Loading previous results from ${this.outputFile}`);
        this.processed = JSON.parse(readFileSync(this.outputFile, "utf-8"));

        let min: number = Number.MAX_SAFE_INTEGER;
        let max: number = Number.MIN_SAFE_INTEGER;
        let avg: number = 0;
        let count: number = 0;
        let minD: string = "";
        let maxD: string = "";

        for (const [domain, stats] of Object.entries(this.processed.domains)) {
            if (!stats.phrase_count) {
                continue;
            }

            if (stats.phrase_count < min) {
                min = stats.phrase_count;
                minD = domain;
            }

            if (stats.phrase_count > max) {
                max = stats.phrase_count;
                maxD = domain;
            }

            count++;
            avg += stats.phrase_count;
        }

        let avgPhraseCount: number = 0;
        let maxCollisions: number = 0;
        let mCollision: string[] = [];
        let lastCollision: string[] = [];
        let lastCollisionPhrase: string = "";
        for (const [phrase, sites] of Object.entries(this.processed.phrases)) {
            avgPhraseCount += sites.length;

            if (sites.length >= maxCollisions) {
                if (sites.length > maxCollisions) {
                    mCollision.length = 0;
                }

                mCollision.push(phrase);
                maxCollisions = sites.length;

                lastCollision = sites;
                lastCollisionPhrase = phrase;
            }
        }

        console.log(
            chalk.blueBright(
                `${Object.keys(this.processed.domains).length} domains indexed. ${Object.keys(this.processed.phrases).length} phrases generated.`,
            ),
        );
        console.log(chalk.green(`Min domain: ${minD} (${min} phrases)`));
        console.log(chalk.red(`Max domain: ${maxD} (${max} phrases)`));
        console.log(chalk.yellow(`Average phrases per domain: ${avg / count}`));
        console.log(
            chalk.cyan(
                `Average sites per phrase: ${avgPhraseCount / Object.keys(this.processed.phrases).length}`,
            ),
        );
        console.log(
            chalk.magenta(
                `Max collisions: ${maxCollisions} (${mCollision.length} times, Last one: ${lastCollisionPhrase} - ${lastCollision})`,
            ),
        );
    }
}
