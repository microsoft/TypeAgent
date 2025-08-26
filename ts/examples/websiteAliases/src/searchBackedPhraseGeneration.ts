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
import { openPhraseGeneratorAgent, UrlResolverCache, domainCache, urlCache } from "azure-ai-foundry";

type cachedUrls_compact = {
    domains: {
        [key: string]: { 
        }
    }
    phrases: {
        [key: string]: number[];
    };
};

export class searchResultsPhraseGenerator {
    // manually downloadable from: https://radar.cloudflare.com/domains
    private downloadUrl: string =
        "https://radar.cloudflare.com/charts/LargerTopDomainsTable/attachment?id=1257&top=";
    private topN: number = 1000;
    private topNFile: string = `examples/websiteAliases/data/top${this.topN}.csv`;
    private outputCacheFile: string = "examples/websiteAliases/cache/openPhrasesCache.json";
    private outputDomainFile: string = "examples/websiteAliases/cache/domains.json";
    private outputURLFile: string = "examples/websiteAliases/cache/urls.json";
    private cache: UrlResolverCache = new UrlResolverCache();

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
            if (!clear && existsSync(this.outputCacheFile)) {
                this.cache.load(this.outputCacheFile);
            }
        } catch (error) {
            console.error(
                chalk.red(
                    `Error reading output file ${this.outputCacheFile}: ${error}`,
                ),
            );
            console.warn("Deleting output file...");
            unlinkSync(this.outputCacheFile);
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
            if (!domain || this.cache.domains[domain] !== undefined) {
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
                    this.cache.domains[msg.domain] = {
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
                this.saveOutput();
                console.log(
                    chalk.green(
                        `Saved progress to ${this.outputCacheFile} (${statSync(this.outputCacheFile).size} bytes)`,
                    ),
                );
            }
        }

        // save the output file
        this.saveOutput();
    }

    /**
     * Saves the cache to the output files
     */
    private saveOutput() {
        writeFileSync(
            this.outputCacheFile,
            JSON.stringify(this.cache.phrases, null, 2),
        );
        writeFileSync(
            this.outputDomainFile,
            JSON.stringify(this.cache.domains, null, 2),
        );
        writeFileSync(
            this.outputURLFile,
            JSON.stringify(this.cache.urls, null, 2),
        );
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
                if (this.cache.phrases[alias] === undefined) {
                    this.cache.phrases[alias] = [element.pageUrl];
                } else {
                    this.cache.phrases[alias] = [
                        ...new Set([
                            ...this.cache.phrases[alias],
                            element.pageUrl,
                        ]),
                    ];

                    console.log(
                        chalk.yellow(
                            `\t${alias} now maps to ${this.cache.phrases[alias].length} sites.`,
                        ),
                    );
                }
            });

            // record domain stats
            this.cache.urls[element.pageUrl] = { 
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

        console.log(`Loading previous results from ${this.outputCacheFile}`);
        this.cache = JSON.parse(readFileSync(this.outputCacheFile, "utf-8"));

        let minUrlsPerDomain: number = Number.MAX_SAFE_INTEGER;
        let maxUrlsPerDomain: number = Number.MIN_SAFE_INTEGER;
        let avgUrlsPerDomain: number = 0;
        let count: number = 0;
        //let minD: string = "";
        let domainsWithMaxUrlCount: string[] = [];

        for (const [domain, stats] of Object.entries(this.cache.domains)) {
            const dd: domainCache = stats as domainCache;
            if (dd.urlsFound < minUrlsPerDomain) {
                minUrlsPerDomain = dd.urlsFound;
            }

            if (dd.urlsFound > maxUrlsPerDomain) {
                maxUrlsPerDomain = dd.urlsFound;
                domainsWithMaxUrlCount.push(domain);
            }
            
            count++;
            avgUrlsPerDomain += dd.urlsFound;
        }

        console.log(chalk.white(`Number of domains processed: ${count}`));
        console.log(chalk.green(`Minimum URLs per domain: ${minUrlsPerDomain}`));
        console.log(chalk.yellow(`Maximum URLs per domain: ${maxUrlsPerDomain}`));
        console.log(chalk.cyan(`Average URLs per domain: ${avgUrlsPerDomain / count}`));

        let totalPhraseCount = 0;
        let minPhraseCount = Number.MAX_SAFE_INTEGER;
        let maxPhraseCount = Number.MIN_SAFE_INTEGER;
        let urlsWithMaxPhraseCount: string[] = [];

        for (const [url, info] of Object.entries(this.cache.urls)) {
            const ii: urlCache = info as urlCache;
            const phraseCount = ii.phrases?.length ?? 0;
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

        const numUrlsIndexed = Object.keys(this.cache.urls).length;
        const avgPhrasesPerDomain = numUrlsIndexed > 0 ? totalPhraseCount / numUrlsIndexed : 0;

        console.log(chalk.green(`Number of URLs indexed: ${numUrlsIndexed}`));
        console.log(chalk.yellow(`Average phrases per domain: ${avgPhrasesPerDomain}`));
        console.log(chalk.cyan(`Minimum phrase count: ${minPhraseCount}`));
        console.log(chalk.magenta(`Maximum phrase count: ${maxPhraseCount}`));
        console.log(chalk.blueBright(`Number of domains with max phrase count: ${urlsWithMaxPhraseCount.length}`));
        //console.log(chalk.blue(`Urls with max phrase count: ${urlsWithMaxPhraseCount.join(", ")}`));
    }

    /**
     * Compact the output file
     */
    public compact() {

        // do we have a compressable file?
        if (!existsSync(this.outputCacheFile)) {
            console.error(`Output file ${this.outputCacheFile} does not exist.`);
            return;
        }

        // Load the data
        console.log(chalk.blueBright("Loading uncompressed file."));
        this.cache.load(this.outputCacheFile);

        console.log(chalk.dim("Processing..."));
        const compressed: cachedUrls_compact = {
            domains: this.cache.domains,
            phrases: {},
        };     

        console.log(chalk.blueBright("Indexing Domains"));
        const domainMap: Map<string, any> = new Map<string, any>();
        for(const [domain] of Object.entries(this.cache.domains)) {
            domainMap.set(domain, { });
        }

        // collapse URLs into domains
        console.log(chalk.blueBright("Collapsing URLs into domains."));
        const urlToIdMap: Map<string, number> = new Map<string, number>();
        for (const [url, value] of Object.entries(this.cache.urls)) {
            const domain = new URL(url).hostname;

            // crate the domain entry for this URL if we need to
            if (!domainMap.has(domain)) {
                domainMap.set(domain, { });
            }

            // move the URL into the domain
            urlToIdMap.set(url, urlToIdMap.size);

            delete (value as any).phrases;
            delete (value as any).title;

            domainMap.get(domain).urls = {};
            domainMap.get(domain).urls[url] = value;
            domainMap.get(domain).urls[url].id = urlToIdMap.get(url);
        }

        compressed.domains = Object.fromEntries(domainMap);

        console.log(chalk.greenBright("Processing URLs."));
        Object.entries(this.cache.phrases).forEach(([phrase, urls]) => {
            const urlIds: number[] = [];
            (urls as urlCache).forEach((value: string) => {
                urlIds.push(urlToIdMap.get(value)!);
            });
            compressed.phrases[phrase] = urlIds;
        });

        // console.log(chalk.yellowBright("Performing phrase compression"));
        // const phraseTree: any = {};
        // Object.entries(compressed.phrases).forEach(([phrase, urls]) => {
        //     // make a heirarchical tree of phrases
        //     const lPhrase = phrase.toLowerCase();
        //     const parts = lPhrase.split(" ");
        //     let currentLevel = phraseTree;

        //     parts.forEach((part) => {
        //         if (!currentLevel[part]) {
        //             currentLevel[part] = {};
        //         }
        //         currentLevel = currentLevel[part];
        //     });

        //     currentLevel.urls = urls;
        // });
        // compressed.phrases = phraseTree;

        const small: string[] = [];
        Object.entries(this.cache.phrases).forEach(([phrase, urls]) => {
            const ids: string[] = [];
            (urls as urlCache).forEach((url: string) => {
                ids.push(`${urlToIdMap.get(url)}`);
            })
            small.push(`${phrase}\t${ids.join("\t")}`);
        });

        writeFileSync(this.outputCacheFile.replace(".json", ".compact.tsv"), small.join("\n"));


        console.log(chalk.redBright("Writing compressed file."));
        writeFileSync(
            this.outputCacheFile.replace(".json", ".compact.json"),
            JSON.stringify(compressed, null, 2),
        );


    }
}
