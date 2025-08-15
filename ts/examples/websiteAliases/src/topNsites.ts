// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, CompletionSettings, ChatModelWithStreaming } from "aiclient";
import chalk from "chalk";
import { existsSync, readFileSync, unlinkSync, writeFileSync, statSync } from "fs";
import { domains } from "./generateOpenCommandPhrasesSchema.js";
import { createTypeChat, loadSchema } from "typeagent";
import { Result } from "typechat";

type extractedDomains = {
    dateIndexed: number;
    domains: {
        [key: string]: {
            accessible: boolean | undefined;
            phrase_count?: number;
            phrases?: string[];
        }
    }
    phrases: {
        [key: string]: string[];
    }
}

// type crawlPages = {
//     pages: number;
//     pageSize: number;
//     blocks: number;
// }

export class topNDomainsExtractor {
    // manually downloadable from: https://radar.cloudflare.com/domains
    private downloadUrl: string = "https://radar.cloudflare.com/charts/LargerTopDomainsTable/attachment?id=1257&top=";
    private topN: number = 1000;
    private topNFile: string = `examples/websiteAliases/top${this.topN}.csv`;
    private outputFile: string = "examples/websiteAliases/phrases_to_sites.json";
    //private keywordsToSites: Record<string, string[]> = {};
    private processed: extractedDomains = {
        dateIndexed: Date.now(),
        domains: {},
        phrases: {}
    }

    constructor(topN?: number) {
        if (topN && topN > 0) {
            this.topN = topN;
        }

        const possibleOptions: number[] = [100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];

        if (!possibleOptions.includes(this.topN)) {
            console.warn(chalk.yellow(`Invalid topN value. Falling back to default: ${this.topN}`));
            this.topN = 100;
        }

        this.downloadUrl += this.topN;
    }

    /**
     * Downloads the topN sites from CloudFlare, then systematically attepmpts to resolve a keyword for each site.
     */
    public async extract(clear: boolean = false): Promise<void> {
        // get the top domains
        this.downloadTopNDomains();

        try {
            // start over from scratch?
            if (!clear && existsSync(this.outputFile)) {
                this.processed = JSON.parse(readFileSync(this.outputFile, "utf-8")) as extractedDomains;
            }
        } catch (error) {
            console.error(chalk.red(`Error reading output file ${this.outputFile}: ${error}`));
            console.warn("Deleting output file...");
            unlinkSync(this.outputFile);
        }

        // open the file, throw away the headers
        const fileContent = readFileSync(this.topNFile, "utf-8");
        const lines = fileContent.split("\n").slice(1);

        // TODO: go to the web page and see if it's something we even want to index
        // TODO: use category
        // TODO: handle when there is no category in the file

        // go through each line, get the domain from the 2nd column and then generate
        // the keyword/phrases for that domain
        const batch: Promise<void>[] = [];
        const batchSize = 4;
        const pageSize = 5;
        const batchCount = Math.ceil(lines.length / (batchSize * pageSize));                
        const domains: string[][] = new Array<string[]>(batchCount);    
        let pageNumber = 0;
        let batchNumber = 0;
        console.log(`${lines.length} domains. Processing in ${batchCount} batches of ${batchSize} domains each.`);    
        
        for(let i = 0; i < lines.length; i++) {
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

            // can we even get to this domain?
            // For CDNs, there's nothing hosted at the root domain and for those
            // we just skip them and don't try to index them cause they just pollute the cache
            let isValid: boolean | undefined = await this.isPageAvailable(domain);;
            this.processed.domains[domain] = { accessible: isValid ? isValid : false };

            if (!isValid) {
                console.warn(chalk.yellow(`Skipping domain: ${domain}`));
                continue;
            }

            // accumulate domains till will fill a page
            if (domains[pageNumber] === undefined) {
                domains[pageNumber] = [];
            }
            domains[pageNumber].push(domain);

            // once the page is full or if it's the last page, send it
            if (domains[pageNumber].length >= pageSize || i === lines.length - 1) {
                const page = pageNumber++;
                console.log(`Processing page ${page}: ${chalk.blueBright(domains[page])}`);

                batch.push(this.generateOpenPhrasesForDomains(domains[page]).catch((err) => {
                    console.error(chalk.red(`Error processing domains ${domains[page]}: ${err.message}`));
                }));

                if (batch.length >= batchSize) {
                    const batchNum = batchNumber++;
                    await Promise.all(batch).then(() => {
                        console.log(chalk.grey(`Processed batch ${batchNum} of ${batchCount}.`));
                    });

                    batch.length = 0; // reset the batch

                    // periodically save the output file so we don't have to start from scratch if we restart
                    writeFileSync(this.outputFile, JSON.stringify(this.processed, null, 2));
                    console.log(chalk.green(`Saved progress to ${this.outputFile} (${statSync(this.outputFile).size} bytes)`));

                }
            }
        }

        // save the output file
        writeFileSync(this.outputFile, JSON.stringify(this.processed, null, 2));
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
     * Checks if a page is available by making a request.
     * @param url - The URL to check
     * @returns True if there was a semi-valid response from the server, false otherwise
     */
    private async isPageAvailable(url: string): Promise<boolean> {

        let retryCount = 0;
        const MAX_RETRIES = 3;

        // HTTPS 
        do {
            try {
                const httpsResponse = await fetch(`https://${url}`);
                const httpsStatus = httpsResponse.status

                if (httpsResponse.ok || httpsStatus === 400) {
                    return true;
                }

                const httpsText = await httpsResponse.text();
                console.log(`HTTPS ${chalk.red(httpsStatus)}\n${chalk.red(httpsText.substring(0, 20))}`);

                break;

            } catch (error: any) {
                console.error(chalk.red(`Error checking page availability ${url}: ${error?.message}`));                 
                
                // name not found
                if (error.cause.code === "ENOTFOUND") {
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 500));

            } finally {
                retryCount++;
            }
        } while (retryCount < MAX_RETRIES);

        retryCount = 0;

        // fallback to HTTP
        do {
            try {
                const httpResponse = await fetch(`http://${url}`);
                const status = httpResponse.status

                if (httpResponse.ok || status === 400) {
                    return true;
                }

                const r = await httpResponse.text();
                console.log(`HTTP ${chalk.red(status)}\n${chalk.red(r.substring(0, 20))}`);

                break;

            } catch (error: any) {
                console.error(chalk.red(`Error checking page availability ${url}: ${error?.message}`));
                

                // name not found
                if (error.cause.code === "ENOTFOUND") {
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 500));
                
            } finally {
                retryCount++;
            }
        } while (retryCount < MAX_RETRIES);

        return false;        
    }

    /**
     * Downloads the topN domains from CloudFlare
     */
    private async downloadTopNDomains(): Promise<void> {

        if (existsSync(this.topNFile)) {
            console.log(`Top N domains file already downloaded to '${this.topNFile}'`);
            return;
        }

        const response = await fetch(this.downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch top N domains: ${response.statusText}.  Please download '${this.downloadTopNDomains} manually and put the file at '${this.topNFile}'`);
        }

        // save this file locally
        const data = await response.text();
        writeFileSync(this.topNFile, data);
    }

    /**
     * Generate open command phrases for a given domain.
     * @param domain - The domain to generate open phrases for (i.e. open Adidas, open three stripe brand, etc.)
     */
    private async generateOpenPhrasesForDomains(domains: string[]): Promise<void> {
        const response = await this.getTypeChatResponse(domains.join("\n"));
        if (response.success) {
            response.data.domains.forEach(element => {
                console.log(chalk.green(`Generated ${element.aliases.length} phrases for ${element.domain}:`));

                // merge the aliases with existing keywords
                element.aliases.forEach(alias => {

                    if (alias.toLowerCase().startsWith("open ")) {
                        alias = alias.slice(5);
                    }

                    // record the phrase redirection entry
                    if (this.processed.phrases[alias] === undefined) {
                        this.processed.phrases[alias] = [element.domain];
                    } else {
                        this.processed.phrases[alias] = [...new Set([...this.processed.phrases[alias], element.domain])];

                        console.log(chalk.yellow(`\t${alias} now maps to ${this.processed.phrases[alias].length} sites.`));
                    }                
                });

                // record domain stats
                this.processed.domains[element.domain].phrase_count = element.aliases.length;
                this.processed.domains[element.domain].phrases = element.aliases;
            }); 
        } else {
            console.error(chalk.red(`Failed to generate phrases for ${domains}: ${response.message}`));
        }

        return;
    }

    private async getTypeChatResponse(
        pageMarkdown: string,
    ): Promise<Result<domains>> {
        // Create Model instance
        let chatModel = this.createModel(true);

        // Create Chat History
        let maxContextLength = 8196;
        let maxWindowLength = 30;

        // create TypeChat object
        const chat = createTypeChat<domains>(
            chatModel,
            loadSchema(["generateOpenCommandPhrasesSchema.ts"], import.meta.url),
            "domains",
            `
There is a system that uses the command "Open" to open URLs in the browser.  You are helping me generate terms that I can cache such that when the user says "open apple" it goes to "https://apple.com".  You generate alternate terms/keywords/phrases/descriptions a user could use to invoke the same site. Avoid using statements that could actually refer to sub pages like (open ipad page). since those are technically different URLs.

For example: apple.com could be:

- open apple
- open iphone maker
- open ipad maker
            `,
            [],
            maxContextLength,
            maxWindowLength,
        );

        // make the request
        const chatResponse = await chat.translate(pageMarkdown);

        return chatResponse;
    }

    private createModel(fastModel: boolean = true): ChatModelWithStreaming {
        let apiSettings: openai.ApiSettings | undefined;
        if (!apiSettings) {
            if (fastModel) {
                apiSettings = openai.localOpenAIApiSettingsFromEnv(
                    openai.ModelType.Chat,
                    undefined,
                    openai.GPT_5_NANO,
                    ["websiteAliases"],
                );
            } else {
                apiSettings = openai.localOpenAIApiSettingsFromEnv(
                    openai.ModelType.Chat,
                    undefined,
                    openai.GPT_5,
                    ["websiteAliases"],
                );
            }
        }

        let completionSettings: CompletionSettings = {
            temperature: 1.0,
            // Max response tokens
            max_tokens: 1000,
            // createChatModel will remove it if the model doesn't support it
            response_format: { type: "json_object" },
        };

        const chatModel = openai.createChatModel(
            apiSettings,
            completionSettings,
            undefined,
            ["websiteAliases"],
        );

        return chatModel;
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

        console.log(chalk.blueBright(`${Object.keys(this.processed.domains).length} domains indexed. ${Object.keys(this.processed.phrases).length} phrases generated.`));
        console.log(chalk.green(`Min domain: ${minD} (${min} phrases)`));
        console.log(chalk.red(`Max domain: ${maxD} (${max} phrases)`));
        console.log(chalk.yellow(`Average phrases per domain: ${avg / count}`));
        console.log(chalk.cyan(`Average sites per phrase: ${avgPhraseCount / Object.keys(this.processed.phrases).length}`));
        console.log(chalk.magenta(`Max collisions: ${maxCollisions} (${mCollision.length} times, Last one: ${lastCollisionPhrase} - ${lastCollision})`));
    }

}