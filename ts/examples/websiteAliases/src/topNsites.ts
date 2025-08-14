// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, CompletionSettings, ChatModelWithStreaming } from "aiclient";
import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { domains } from "./generateOpenCommandPhrasesSchema.js";
import { createTypeChat, loadSchema } from "typeagent";
import { Result } from "typechat";

export class topNDomainsExtractor {
    // manually downloadable from: https://radar.cloudflare.com/domains
    private downloadUrl: string = "https://radar.cloudflare.com/charts/LargerTopDomainsTable/attachment?id=1257&top=";
    private topN: number = 100;
    private topNFile: string = "examples/websiteAliases/top100_000.csv";
    private outputFile: string = "examples/websiteAliases/phrases_to_sites.json";
    private keywordsToSites: Record<string, string[]> = {};

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

        // start over from scratch?
        if (!clear && existsSync(this.outputFile)) {
            this.keywordsToSites = JSON.parse(readFileSync(this.outputFile, "utf-8"));
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
        let batchNum = 0;
        console.log(`${lines.length} domains. Processing in ${batchCount} batches of ${batchSize} domains each.`);    
        
        for(let i = 0; i < lines.length; i++) {
            const columns = lines[i].split(",");
            if (columns.length < 2) {
                continue; // skip invalid lines
            }

            const domain = columns[1].trim();
            if (!domain) {
                continue; // skip empty domains
            }

            // accumulate domains till will fill a page
            if (domains[batchNum] === undefined) {
                domains[batchNum] = [];
            }
            domains[batchNum].push(domain);

            // once the page is full or if it's the last page, send it
            if (domains[batchNum].length >= pageSize || i === lines.length - 1) {
                const bb = batchNum++;
                console.log(`Processing: ${chalk.blueBright(domains[bb])}`);

                batch.push(this.generateOpenPhrasesForDomains(domains[bb]).catch((err) => {
                    console.error(chalk.red(`Error processing domains ${domains[bb]}: ${err.message}`));
                }));

                if (batch.length >= batchSize) {
                    await Promise.all(batch).then(() => {
                        console.log(chalk.grey(`Processed batch ${bb} of ${batchCount}.`));
                    });

                    batch.length = 0; // reset the batch
                }
            }
        }

        // save the output file
        writeFileSync(this.outputFile, JSON.stringify(this.keywordsToSites, null, 2));
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

                    if (this.keywordsToSites[alias] === undefined) {
                        this.keywordsToSites[alias] = [element.domain];
                    } else {
                        this.keywordsToSites[alias] = [...new Set([...this.keywordsToSites[alias], element.domain])];

                        console.log(chalk.yellow(`\t${alias} now maps to ${this.keywordsToSites[alias].length} sites.`));
                    }                
                });
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

/*
There is a system that uses the command "Open" to open URLs in the browser.  You are helping me generate terms that I can cache such that when the user says "open apple" it goes to "https://apple.com".  YOu generate alternate terms/keywords/phrases/descriptions a user could use to invoke the same site. Avoid using statements that could actually refer to sub pages like (open ipad page). since those are technically different URLs.

For example: apple.com could be:

- open apple
- open iphone maker
- open ipad maker

*/

}
