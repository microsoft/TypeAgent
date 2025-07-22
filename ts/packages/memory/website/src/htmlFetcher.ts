// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface FetchResult {
    url: string;
    html?: string;
    error?: string;
}

/**
 * Simple HTML fetcher for batch processing
 * Fetches HTML content from URLs with basic error handling
 */
export class HtmlFetcher {
    /**
     * Fetch HTML content from a single URL
     */
    async fetchHtml(
        url: string,
        timeout: number = 10000,
    ): Promise<FetchResult> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    "User-Agent": "TypeAgent/1.0",
                },
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return { url, error: `HTTP ${response.status}` };
            }

            const html = await response.text();
            return { url, html };
        } catch (error) {
            return {
                url,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }

    /**
     * Fetch HTML content from multiple URLs with concurrent processing
     */
    async fetchBatch(
        urls: string[],
        maxConcurrent: number = 5,
    ): Promise<FetchResult[]> {
        const results: FetchResult[] = [];

        for (let i = 0; i < urls.length; i += maxConcurrent) {
            const batch = urls.slice(i, i + maxConcurrent);
            const batchPromises = batch.map((url) => this.fetchHtml(url));
            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach((result) => {
                if (result.status === "fulfilled") {
                    results.push(result.value);
                }
            });
        }

        return results;
    }
}
