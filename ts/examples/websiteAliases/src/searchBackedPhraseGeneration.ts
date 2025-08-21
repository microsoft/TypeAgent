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
import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import { openPhraseGeneratorAgent } from "azure-ai-foundry";

type cachedUrls = {
    domains: {
        [key: string]: { 
            dateIndexed: number;
            urlsFound: number;
        }
    }
    urls: {
        [key: string]: {
            phrases?: string[];
            title?: string;
        };
    };
    phrases: {
        [key: string]: string[];
    };
};

export class searchResultsPhraseGenerator {
    // manually downloadable from: https://radar.cloudflare.com/domains
    private downloadUrl: string =
        "https://radar.cloudflare.com/charts/LargerTopDomainsTable/attachment?id=1257&top=";
    private topN: number = 5000;
    private topNFile: string = `examples/websiteAliases/top${this.topN}.csv`;
    private outputFile: string = "examples/websiteAliases/openPhrasesCache.json";
    private processed: cachedUrls = {
        domains: {},
        urls: {},
        phrases: {},
    };

    constructor(topN: number,) {
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
        try {
            // start over from scratch?
            if (!clear && existsSync(this.outputFile)) {
                this.processed = JSON.parse(
                    readFileSync(this.outputFile, "utf-8"),
                ) as cachedUrls;
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

        const batchSize = 20;
        const batchCount = Math.ceil(lines.length / batchSize);
        let batchNumber = 0;
        const batchPromises: Promise<void>[] = [];
        console.log(
            `${lines.length} domains. Processing in ${batchCount} batches of ${batchSize} domains each.`,
        );

        const batchSourceFile = path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            "./search_BatchWorker.js",
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

            // Spawn a worker for each domain
            const worker = new Worker(batchSourceFile, {
                workerData: {
                    domain: domain,
                },
            });

            const batchPromise = new Promise<void>((resolve) => {
                worker.on("message", async (msg) => {
                    if (msg.success) {
                        console.log(
                            chalk.grey(`Worker processed: ${domain}`),
                        );

                        // merge the results into the index
                        this.mergeResults(msg.phrases);

                        resolve();
                    } else {
                        console.error(
                            chalk.red(`Worker failed: ${msg.error}`),
                        );
                        resolve();
                    }

                    // record that we processed this domain
                    this.processed.domains[msg.domain] = {
                        urlsFound: msg.phrases?.urls.length || 0,
                        dateIndexed: Date.now(),
                    };
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

                // bump the batch number
                batchNumber++;

                console.log(chalk.bgBlueBright(`Batch ${batchNumber} of ${batchCount} completed.`));

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

        // save the output file
        writeFileSync(this.outputFile, JSON.stringify(this.processed, null, 2));
    }

    /**
     * Merges the results from the domain processing into the main index.
     * @param data - The processed domains
     * @param batchDomains - The domains processed in this batch
     */
    private mergeResults(phrases: openPhraseGeneratorAgent.openPhrases) {

        if (!phrases?.urls) {
            return;
        }

        phrases.urls.forEach((element) => {
            console.log(
                chalk.green(
                    `Generated ${element.openPhrases.length} phrases for ${element.pageUrl}:`,
                ),
            );

            // merge the aliases with existing keywords
            element.openPhrases.forEach((alias) => {

                // just in case it starts with "open", remove it
                if (alias.toLowerCase().startsWith("open ")) {
                    alias = alias.slice(5);
                }

                // record the phrase entry
                if (this.processed.phrases[alias] === undefined) {
                    this.processed.phrases[alias] = [element.pageUrl];
                } else {
                    this.processed.phrases[alias] = [
                        ...new Set([
                            ...this.processed.phrases[alias],
                            element.pageUrl,
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
            this.processed.urls[element.pageUrl] = { 
                title: element.pageTitle,
                phrases: element.openPhrases,
            };
        });
    }

    /**
     * Summarize the domain statistics.
     */
    public summarize() {
        console.log(chalk.dim("Processing..."));

        console.log(`Loading previous results from ${this.outputFile}`);
        this.processed = JSON.parse(readFileSync(this.outputFile, "utf-8"));

        let minUrlsPerDomain: number = Number.MAX_SAFE_INTEGER;
        let maxUrlsPerDomain: number = Number.MIN_SAFE_INTEGER;
        let avgUrlsPerDomain: number = 0;
        let count: number = 0;
        //let minD: string = "";
        let domainsWithMaxUrlCount: string[] = [];

        for (const [domain, stats] of Object.entries(this.processed.domains)) {
            if (stats.urlsFound < minUrlsPerDomain) {
                minUrlsPerDomain = stats.urlsFound;
            }

            if (stats.urlsFound > maxUrlsPerDomain) {
                maxUrlsPerDomain = stats.urlsFound;
                domainsWithMaxUrlCount.push(domain);
            }
            
            count++;
            avgUrlsPerDomain += stats.urlsFound;
        }

        console.log(chalk.white(`Number of domains processed: ${count}`));
        console.log(chalk.green(`Minimum URLs per domain: ${minUrlsPerDomain}`));
        console.log(chalk.yellow(`Maximum URLs per domain: ${maxUrlsPerDomain}`));
        console.log(chalk.cyan(`Average URLs per domain: ${avgUrlsPerDomain / count}`));

        let totalPhraseCount = 0;
        let minPhraseCount = Number.MAX_SAFE_INTEGER;
        let maxPhraseCount = Number.MIN_SAFE_INTEGER;
        let urlsWithMaxPhraseCount: string[] = [];

        for (const [url, info] of Object.entries(this.processed.urls)) {
            const phraseCount = info.phrases?.length ?? 0;
            totalPhraseCount += phraseCount;

            if (phraseCount < minPhraseCount) {
                minPhraseCount = phraseCount;
            }
            if (phraseCount > maxPhraseCount) {
                maxPhraseCount = phraseCount;
                urlsWithMaxPhraseCount.length = 0;
                urlsWithMaxPhraseCount.push(url);
            } else if (phraseCount === maxPhraseCount) {
                urlsWithMaxPhraseCount.push(url);
            }
        }

        const numUrlsIndexed = Object.keys(this.processed.urls).length;
        const avgPhrasesPerDomain = numUrlsIndexed > 0 ? totalPhraseCount / numUrlsIndexed : 0;

        console.log(chalk.green(`Number of URLs indexed: ${numUrlsIndexed}`));
        console.log(chalk.yellow(`Average phrases per domain: ${avgPhrasesPerDomain}`));
        console.log(chalk.cyan(`Minimum phrase count: ${minPhraseCount}`));
        console.log(chalk.magenta(`Maximum phrase count: ${maxPhraseCount}`));
        console.log(chalk.blueBright(`Number of domains with max phrase count: ${urlsWithMaxPhraseCount.length}`));
        //console.log(chalk.blue(`Urls with max phrase count: ${urlsWithMaxPhraseCount.join(", ")}`));
    }
}
