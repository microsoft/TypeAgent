// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, CompletionSettings, ChatModelWithStreaming } from "aiclient";
import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { domainAlises } from "./generateOpenCommandPhrasesSchema.js";
import { createTypeChat, loadSchema } from "typeagent";
import { Result } from "typechat";

export class topNDomainsExtractor {
    private downloadUrl: string = "https://radar.cloudflare.com/charts/LargerTopDomainsTable/attachment?id=1257&top=";
    private topN: number = 100;
    private topNFile: string = "examples/websiteAliases/topN.csv";

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
    public async extract() {
        // get the top domains
        this.downloadTopNDomains();

        // open the file, throw away the headers
        const fileContent = readFileSync(this.topNFile, "utf-8");
        const lines = fileContent.split("\n").slice(1);

        // go through each line, get the domain from the 2nd column and then generate
        // the keyword/phrases for that domain
        for (const line of lines) {
            const columns = line.split(",");
            if (columns.length < 2) {
                continue; // skip invalid lines
            }

            const domain = columns[1].trim();
            if (!domain) {
                continue; // skip empty domains
            }

            // Here you would call a method to generate keywords for the domain
            console.log(`Processing: ${chalk.blueBright(domain)}`);
            await this.generateOpenPhrasesForDomain(domain);
        }
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

            // Forbidden (bot detection, try built-in browser)
            if (response.status === 403) {
                // const browser = await puppeteer.launch({
                //     headless: false,
                // });

                // const page = await browser.newPage();
                // try {
                //     await page.goto(this.downloadUrl, {
                //         waitUntil: "load",
                //     });

                //     a

                //     await page.waitForSelector('div[class="meCS4"]', {
                //         timeout: 30000,
                //     });

                //     // const data = await page.$$eval(
                //     //     'script[type="application/ld+json"]',
                //     //     `document.documentElement.outerHTML`,
                //     // );
                //     // if (data) {
                //     //     console.log(`Extracted data for ${site}`);
                //     // }
                //     // return data as string;
                // } catch (err) {
                //     if (err instanceof TimeoutError) {
                //         console.warn("Element did not appear within 5 seconds.");
                //     } else {
                //         console.warn(`Failed to download ${this.downloadUrl}}`);
                //     }
                // } finally {
                //     await page.close();
                // }
            }

            throw new Error(`Failed to fetch top N domains: ${response.statusText}.  Please download '${this.downloadTopNDomains} manually and put the file at '${this.topNFile}'`);
        }

        // save this file locally
        const data = await response.text();
        writeFileSync(this.topNFile, data);

    //     try {
    //         await closeChrome();
    //     } catch (e) {
    //         console.log(e);
    //     }

    //     const browser = await puppeteer.launch({
    //         headless: false,
    //     });

    //     const page = await browser.newPage();
    //     try {
    //         await page.goto(this.downloadUrl, {
    //             waitUntil: "load",
    //         });
    //         await page.waitForSelector('div[class="container domain-analysis"]', {
    //             timeout: 5000,
    //         });

    //         const data = await page.$$eval(
    //             'script[type="application/ld+json"]',
    //             `document.documentElement.outerHTML`,
    //         );
    //         if (data) {
    //             console.log(`Extracted data for ${site}`);
    //         }
    //         return data as string;
    //     } catch (err) {
    //         if (err instanceof TimeoutError) {
    //             console.warn("Element did not appear within 5 seconds.");
    //         } else {
    //             console.warn(`Failed to scrape ${site}: ${err}`);
    //         }
    //         return null;
    //     } finally {
    //         await page.close();
    //     }
    }

    /**
     * Generate open command phrases for a given domain.
     * @param domain - The domain to generate open phrases for (i.e. open Adidas, open three stripe brand, etc.)
     */
    private async generateOpenPhrasesForDomain(domain: string): Promise<void> {
        const response = await this.getTypeChatResponse(domain);
        if (response.success) {
            console.log(chalk.green(`Generated phrases for ${domain}:`));
        } else {
            console.error(chalk.red(`Failed to generate phrases for ${domain}: ${response.message}`));
        }

        return;
    }

    private async getTypeChatResponse(
        pageMarkdown: string,
    ): Promise<Result<domainAlises>> {
        // Create Model instance
        let chatModel = this.createModel(true);

        // Create Chat History
        let maxContextLength = 8196;
        let maxWindowLength = 30;

        // create TypeChat object
        const chat = createTypeChat<domainAlises>(
            chatModel,
            loadSchema(["generateOpenCommandPhrasesSchema.ts"], import.meta.url),
            "domainAlises",
            `
There is a system that uses the command "Open" to open URLs in the browser.  You are helping me generate terms that I can cache such that when the user says "open apple" it goes to "https://apple.com".  YOu generate alternate terms/keywords/phrases/descriptions a user could use to invoke the same site. Avoid using statements that could actually refer to sub pages like (open ipad page). since those are technically different URLs.

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
