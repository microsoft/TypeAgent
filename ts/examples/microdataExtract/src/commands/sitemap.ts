// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import * as zlib from "zlib";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

// Add xml2js as a dependency with: npm install xml2js @types/xml2js
import { parseStringPromise } from "xml2js";

const gunzipAsync = promisify(zlib.gunzip);

export default class Sitemap extends Command {
    static description = "Process sitemaps and extract URLs from them";

    static examples = [
        "<%= config.bin %> sitemap --source=tripadvisor",
        "<%= config.bin %> sitemap --source=opentable --output=./urls",
        "<%= config.bin %> sitemap --source=custom --url=https://example.com/sitemap.xml",
    ];

    static flags = {
        source: Flags.string({
            char: "s",
            description: "Sitemap source",
            options: ["tripadvisor", "opentable", "custom"],
            default: "tripadvisor",
        }),
        url: Flags.string({
            char: "u",
            description: "Custom sitemap URL (for --source=custom)",
        }),
        output: Flags.string({
            char: "o",
            description: "Output directory",
            default: "./output",
        }),
        timestamp: Flags.boolean({
            char: "t",
            description: "Include timestamp in output filename",
            default: true,
        }),
    };

    // Constants
    private readonly TRIPADVISOR_SITEMAP_INDEX =
        "http://tripadvisor-sitemaps.s3-website-us-east-1.amazonaws.com/2/en_US/sitemap_en_US_index.xml";

    private readonly OPENTABLE_SITEMAPS = [
        "https://www.opentable.com/sitemap_restaurants_restaurant-profile_listing_1.xml.gz",
        "https://www.opentable.com/sitemap_restaurants_restaurant-profile_listing_2.xml.gz",
        "https://www.opentable.com/sitemap_restaurants_restaurant-profile_listing_3.xml.gz",
        "https://www.opentable.com/sitemap_restaurants_restaurant-profile_listing_4.xml.gz",
    ];

    // Headers for fetch requests
    private readonly fetchHeaders = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: "*/*",
    };

    async fetchXml(url: string): Promise<any> {
        this.log(`Fetching XML from ${url}`);
        const response = await fetch(url, {
            headers: this.fetchHeaders,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const text = await response.text();
        return parseStringPromise(text);
    }

    async fetchAndDecompressGz(url: string): Promise<string> {
        this.log(`Fetching and decompressing GZ from ${url}`);
        const response = await fetch(url, {
            headers: this.fetchHeaders,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const decoded = await gunzipAsync(buffer);
        return decoded.toString();
    }

    async extractLocUrlsFromXml(url: string): Promise<string[]> {
        const xml = await this.fetchXml(url);
        const urlSet = xml.urlset?.url || [];
        return urlSet.map((u: any) => u.loc[0]);
    }

    async extractUrls(xml: string): Promise<string[]> {
        const parsed = await parseStringPromise(xml);
        const urlSet = parsed.urlset?.url || [];
        return urlSet.map((u: any) => u.loc[0]);
    }

    async processTripadvisorSitemaps(
        outputDir: string,
        includeTimestamp: boolean,
    ): Promise<void> {
        try {
            const sitemapIndex = await this.fetchXml(
                this.TRIPADVISOR_SITEMAP_INDEX,
            );
            const sitemapUrls: string[] = sitemapIndex.sitemapindex.sitemap
                .map((s: any) => s.loc[0])
                .filter((url: string) => url.includes("-restaurant_review-"));

            this.log(
                `Found ${sitemapUrls.length} TripAdvisor restaurant sitemaps`,
            );
            const allUrls: Set<string> = new Set();

            for (const sitemapUrl of sitemapUrls) {
                this.log(`Processing: ${sitemapUrl}`);
                try {
                    const xmlContent =
                        await this.fetchAndDecompressGz(sitemapUrl);
                    const urls = await this.extractUrls(xmlContent);

                    const filtered = urls.filter((u) =>
                        new URL(u).pathname.startsWith("/Restaurant_Review-"),
                    );
                    filtered.forEach((url) => allUrls.add(url));
                    this.log(`Added ${filtered.length} URLs from this sitemap`);
                } catch (err: any) {
                    this.warn(
                        `Failed to process ${sitemapUrl}: ${err.message}`,
                    );
                }
            }

            // Create output directory if it doesn't exist
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Generate filename with optional timestamp
            let filename: string;
            if (includeTimestamp) {
                const timestamp = new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-");
                filename = `tripadvisor_restaurant_urls_${timestamp}_${allUrls.size}.json`;
            } else {
                filename = `tripadvisor_restaurant_urls_${allUrls.size}.json`;
            }

            const filepath = path.join(outputDir, filename);
            fs.writeFileSync(
                filepath,
                JSON.stringify(Array.from(allUrls), null, 2),
                "utf-8",
            );
            this.log(`Saved ${allUrls.size} TripAdvisor URLs to ${filepath}`);
        } catch (err) {
            this.error(`Error processing TripAdvisor sitemaps: ${err}`);
        }
    }

    async processOpenTableSitemaps(
        outputDir: string,
        includeTimestamp: boolean,
    ): Promise<void> {
        const allUrls: Set<string> = new Set();

        for (const sitemapUrl of this.OPENTABLE_SITEMAPS) {
            try {
                this.log(`Processing OpenTable sitemap: ${sitemapUrl}`);
                const urls = await this.extractLocUrlsFromXml(sitemapUrl);
                this.log(`Found ${urls.length} URLs in this sitemap`);
                urls.forEach((url) => allUrls.add(url));
            } catch (err: any) {
                this.warn(`Failed to process ${sitemapUrl}: ${err.message}`);
            }
        }

        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate filename with optional timestamp
        let filename: string;
        if (includeTimestamp) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            filename = `opentable_restaurant_urls_${timestamp}_${allUrls.size}.json`;
        } else {
            filename = `opentable_restaurant_urls_${allUrls.size}.json`;
        }

        const filepath = path.join(outputDir, filename);
        fs.writeFileSync(
            filepath,
            JSON.stringify(Array.from(allUrls), null, 2),
            "utf-8",
        );
        this.log(`Saved ${allUrls.size} OpenTable URLs to ${filepath}`);
    }

    async processCustomSitemap(
        sitemapUrl: string,
        outputDir: string,
        includeTimestamp: boolean,
    ): Promise<void> {
        const allUrls: Set<string> = new Set();

        try {
            this.log(`Processing custom sitemap: ${sitemapUrl}`);

            let urls: string[] = [];
            if (sitemapUrl.endsWith(".gz")) {
                const xmlContent = await this.fetchAndDecompressGz(sitemapUrl);
                urls = await this.extractUrls(xmlContent);
            } else {
                urls = await this.extractLocUrlsFromXml(sitemapUrl);
            }

            this.log(`Found ${urls.length} URLs in this sitemap`);
            urls.forEach((url) => allUrls.add(url));
        } catch (err: any) {
            this.error(`Failed to process ${sitemapUrl}: ${err.message}`);
        }

        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate filename with optional timestamp
        let filename: string;
        if (includeTimestamp) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            filename = `custom_urls_${timestamp}_${allUrls.size}.json`;
        } else {
            filename = `custom_urls_${allUrls.size}.json`;
        }

        const filepath = path.join(outputDir, filename);
        fs.writeFileSync(
            filepath,
            JSON.stringify(Array.from(allUrls), null, 2),
            "utf-8",
        );
        this.log(`Saved ${allUrls.size} URLs to ${filepath}`);
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(Sitemap);
        const source = flags.source;
        const customUrl = flags.url;
        const outputDir = flags.output;
        const includeTimestamp = flags.timestamp;

        this.log(`Processing sitemaps from source: ${source}`);

        // Validate inputs
        if (source === "custom" && !customUrl) {
            this.error(
                "Custom source requires a URL. Use --url=https://example.com/sitemap.xml",
            );
            return;
        }

        // Process based on source
        switch (source) {
            case "tripadvisor":
                await this.processTripadvisorSitemaps(
                    outputDir,
                    includeTimestamp,
                );
                break;
            case "opentable":
                await this.processOpenTableSitemaps(
                    outputDir,
                    includeTimestamp,
                );
                break;
            case "custom":
                await this.processCustomSitemap(
                    customUrl!,
                    outputDir,
                    includeTimestamp,
                );
                break;
            default:
                this.error(`Unknown source: ${source}`);
        }
    }
}
