// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import { URL } from "url";
import { BaseRestaurant } from "../lib/restaurantTypes.js";

export default class Merge extends Command {
    static description = "Merge restaurant datasets from different sources";

    static examples = [
        "<%= config.bin %> merge path/to/parsed.json path/to/crawl.json",
        "<%= config.bin %> merge path/to/parsed.json path/to/crawl.json --dir custom_output_dir",
    ];

    static flags = {
        dir: Flags.string({
            char: "d",
            description: "Custom output directory",
            required: false,
        }),
    };

    static args = {
        parsed: Args.string({
            description: "Path to parsed restaurant data JSON file",
            required: true,
        }),
        crawl: Args.string({
            description: "Path to crawled restaurant data JSON file",
            required: true,
        }),
    };

    private normalizeSameAs(sameAs: string | string[] | undefined): string[] {
        if (!sameAs) return [];
        const urls = Array.isArray(sameAs) ? sameAs : [sameAs];

        return urls.map((rawUrl) => {
            try {
                const url = new URL(rawUrl);
                let allowedHosts = ["tripadvisor.com", "www.tripadvisor.com"];

                if (allowedHosts.includes(url.hostname)) {
                    return `https://www.tripadvisor.com${url.pathname}${url.search}`;
                }

                return rawUrl;
            } catch (e) {
                return rawUrl;
            }
        });
    }

    private mergeRestaurants(
        parsed: BaseRestaurant,
        crawl: BaseRestaurant,
    ): BaseRestaurant {
        return {
            ...parsed,
            aggregateRating: crawl.aggregateRating,
            address: crawl.address,
            priceRange: crawl.priceRange,
        };
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Merge);
        const parsedPath = args.parsed;
        const crawlPath = args.crawl;

        if (!fs.existsSync(parsedPath)) {
            this.error(`Parsed file not found: ${parsedPath}`);
            return;
        }

        if (!fs.existsSync(crawlPath)) {
            this.error(`Crawl file not found: ${crawlPath}`);
            return;
        }

        let parsedData: BaseRestaurant[];
        let crawlData: BaseRestaurant[];

        try {
            const parsedRaw = fs.readFileSync(parsedPath, "utf-8");
            parsedData = JSON.parse(parsedRaw);

            const crawlRaw = fs.readFileSync(crawlPath, "utf-8");
            crawlData = JSON.parse(crawlRaw);
        } catch (e) {
            this.error(`Failed to parse JSON: ${e}`);
            return;
        }

        if (!Array.isArray(parsedData) || !Array.isArray(crawlData)) {
            this.error(
                "Expected JSON arrays of restaurant objects in both input files.",
            );
            return;
        }

        const parsedBySameAs: Map<string, BaseRestaurant> = new Map();
        const matchedParsed = new Set<BaseRestaurant>();
        const matchedCrawl = new Set<BaseRestaurant>();

        // Index parsed entries by each of their normalized sameAs URLs
        parsedData.forEach((entry) => {
            this.normalizeSameAs(entry.sameAs).forEach((url) => {
                parsedBySameAs.set(url, entry);
            });
        });

        const mergedOnlyOverlap: BaseRestaurant[] = [];
        const onlyCrawl: BaseRestaurant[] = [];

        crawlData.forEach((crawlEntry) => {
            const crawlUrl = crawlEntry.url;
            const match = parsedBySameAs.get(crawlUrl);

            if (match) {
                matchedParsed.add(match);
                matchedCrawl.add(crawlEntry);
                mergedOnlyOverlap.push(
                    this.mergeRestaurants(match, crawlEntry),
                );
            } else {
                onlyCrawl.push(crawlEntry);
            }
        });

        const onlyParsed = parsedData.filter((p) => !matchedParsed.has(p));

        // Extract tripadvisor.com URLs from unmatched parsed entries
        const missingCrawlTripadvisorUrls: string[] = onlyParsed.flatMap((p) =>
            this.normalizeSameAs(p.sameAs).filter(
                (url) => new URL(url).hostname === "www.tripadvisor.com",
            ),
        );

        const mergedFull = [...mergedOnlyOverlap, ...onlyCrawl, ...onlyParsed];

        // Determine output directory
        let outputDir: string;
        if (flags.dir) {
            outputDir = flags.dir;
            // Create the directory if it doesn't exist
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
        } else {
            outputDir = path.dirname(parsedPath);
        }

        // Function to write outputs
        const writeOutput = (name: string, data: any): void => {
            const outPath = path.join(outputDir, `${name}.json`);
            fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
            this.log(`Wrote ${name} → ${outPath}`);
        };

        writeOutput("merged_only_overlap", mergedOnlyOverlap);
        writeOutput("only_crawl", onlyCrawl);
        writeOutput("only_parsed", onlyParsed);
        writeOutput("merged_full", mergedFull);
        writeOutput("missing_crawl", missingCrawlTripadvisorUrls);

        this.log(`Merge complete! Summary:`);
        this.log(`- Total parsed entries: ${parsedData.length}`);
        this.log(`- Total crawled entries: ${crawlData.length}`);
        this.log(`- Overlapping entries: ${mergedOnlyOverlap.length}`);
        this.log(`- Entries only in parsed data: ${onlyParsed.length}`);
        this.log(`- Entries only in crawled data: ${onlyCrawl.length}`);
        this.log(`- Combined unique entries: ${mergedFull.length}`);
    }
}
