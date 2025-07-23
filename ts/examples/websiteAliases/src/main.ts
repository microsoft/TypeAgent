// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { bingWithGrounding, extractorAgent } from "azure-ai-foundry";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { MessageContentUnion, ThreadMessage } from "@azure/ai-agents";

// Load environment variables from .env file
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const groundingConfig: bingWithGrounding.ApiSettings = bingWithGrounding.apiSettingsFromEnv();
const project = new AIProjectClient(
    groundingConfig.endpoint!,
    new DefaultAzureCredential(),
);

// go get top 500 sites
const topSitesUrl = "https://moz.com/top-500/download/?table=top500Domains";
const response = await fetch(topSitesUrl);
if (!response.ok) {
    throw new Error(`Failed to fetch top sites: ${response.statusText}`);
}

// extract the site names from the response
const csv_domains = await response.text();
const lines = csv_domains.split("\n").slice(1); // skip header
const sites = lines.map((line) => {
    if (line.length > 0) {
        const parts = line.split(",");
        return parts[1].trim().replaceAll("\"", ""); // get the domain name
    }
});

// go get the aliases for each site
const aliases: Record<string, string[]> = {};
const fetchHeaders = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US;",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Cache-Control": "max-age=0"
    };

for(const site of sites) {
    if (site) { 
        aliases[site] = [];

        const aliasResponse = await fetch(`https://moz.com/domain-analysis/${site}`,
        {
            headers: fetchHeaders,
        }
        );

        if (response.ok) {
            const data = await aliasResponse.text();

            const extracted: extractorAgent.extractedAliases | null | undefined = await extractAliases(data);

            // merge extracted keywords
            if (extracted) {
                aliases[site] = Array.from(new Set([...extracted.brandedKeyWords, ...extracted.extractedKeywordsByClick, ...extracted.topRankingKeywords]));
                console.log(`Extracted ${aliases[site].length} alises for ${site}`);
            }
        } else {
            console.error(`Failed to fetch aliases for ${site}: ${aliasResponse.statusText}`);
        }
    }
};

// TODO: write to disk

async function extractAliases(data: string): Promise<extractorAgent.extractedAliases | undefined | null> {
    const agent = await extractorAgent.ensureKeywordExtractorAgent(groundingConfig, project);
    let inCompleteReason;
    let retVal: extractorAgent.extractedAliases | undefined | null;

    if (!agent) {
        throw new Error(
            "No agent found for extracting web site aliases. Please check your configuration.",
        );
    }

    try {
        const thread = await project.agents.threads.create();

        // the question that needs answering
        await project.agents.messages.create(thread.id, "user", data);

        // Create run
        const run = await project.agents.runs.createAndPoll(
            thread.id,
            agent.id,
            {
                pollingOptions: {
                    intervalInMs: 250,
                },
                onResponse: (response): void => {
                    console.debug(`Received response with status: ${response.status}`);

                    const pb: any = response.parsedBody;
                    if (pb?.incomplete_details?.reason) {
                        inCompleteReason = pb.incomplete_details.reason;
                    }
                },
            },
        );

        const msgs: ThreadMessage[] = [];
        if (run.status === "completed") {
            if (run.completedAt) {
                // Retrieve messages
                const messages = await project.agents.messages.list(thread.id, {
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
                            retVal = JSON.parse(txt) as extractorAgent.extractedAliases;
                        }
                    }
                }
            }
        }

        // delete the thread we just created since we are currently one and done
        project.agents.threads.delete(thread.id);
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


