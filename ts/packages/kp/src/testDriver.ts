#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Test driver for kp: builds an index from synthesized email threads
 * and runs interactive queries against it.
 *
 * Usage: npx tsx src/testDriver.ts
 */

import { TextChunk, ChunkGroup, QueryPlan } from "./types.js";
import { buildIndex } from "./indexBuilder.js";
import { QueryEngine } from "./queryEngine.js";
import { generateAnswer, ChunkContent } from "./answerGenerator.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";

/** Convert a TextChunk to ChunkContent, handling exactOptionalPropertyTypes. */
function toChunkContent(c: TextChunk): ChunkContent {
    const result: ChunkContent = { text: c.text, metadata: c.metadata };
    if (c.groupId) result.groupId = c.groupId;
    if (c.timestamp) result.timestamp = c.timestamp;
    return result;
}

// =========================================================================
// Synthesized Email Threads
// =========================================================================

interface TestEmail {
    from: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    timestamp: string;
    threadId: string;
}

function createTestEmails(): TestEmail[] {
    return [
        // Thread 1: Project kickoff
        {
            from: "alice.chen@contoso.com",
            to: ["bob.smith@contoso.com", "carol.jones@contoso.com"],
            subject: "Project Atlas Kickoff - Q1 Planning",
            body: "Hi team, I'd like to schedule the kickoff meeting for Project Atlas next Monday at 10am. We need to discuss the architecture design, timeline, and resource allocation. Bob, can you prepare the infrastructure cost estimates? Carol, please bring the UX mockups from the Figma prototype. Looking forward to a productive session!",
            timestamp: "2025-01-06T09:15:00Z",
            threadId: "thread-atlas-kickoff",
        },
        {
            from: "bob.smith@contoso.com",
            to: ["alice.chen@contoso.com", "carol.jones@contoso.com"],
            subject: "Re: Project Atlas Kickoff - Q1 Planning",
            body: "Thanks Alice. I'll have the AWS cost breakdown ready. I've been looking at using Kubernetes for the deployment — it should save us about 30% on compute costs compared to our current EC2 setup. I'll also include a comparison with Azure pricing since David from finance asked about multi-cloud options.",
            timestamp: "2025-01-06T10:30:00Z",
            threadId: "thread-atlas-kickoff",
        },
        {
            from: "carol.jones@contoso.com",
            to: ["alice.chen@contoso.com", "bob.smith@contoso.com"],
            subject: "Re: Project Atlas Kickoff - Q1 Planning",
            body: "Great! The Figma designs are almost done. I've been working with the accessibility team to ensure WCAG 2.1 compliance. One question — should we support dark mode from launch or add it later? Also, Taylor Swift's new album just dropped and half the office is distracted 😄",
            timestamp: "2025-01-06T11:45:00Z",
            threadId: "thread-atlas-kickoff",
        },

        // Thread 2: Bug report
        {
            from: "david.park@contoso.com",
            to: ["bob.smith@contoso.com"],
            cc: ["alice.chen@contoso.com"],
            subject: "Critical: Payment Processing Bug in Production",
            body: "Bob, we have a P0 issue in production. The Stripe payment integration is failing for customers in the EU region. Error logs show a timeout when connecting to Stripe's European endpoints. This started after last Friday's deployment. About 200 transactions have failed so far. We need to rollback or hotfix ASAP.",
            timestamp: "2025-01-07T08:00:00Z",
            threadId: "thread-payment-bug",
        },
        {
            from: "bob.smith@contoso.com",
            to: ["david.park@contoso.com"],
            cc: ["alice.chen@contoso.com"],
            subject: "Re: Critical: Payment Processing Bug in Production",
            body: "Found the root cause — the deployment changed the connection pool settings for the EU gateway. I'm pushing a hotfix now. The Stripe webhook URL was also pointing to the staging environment. ETA for fix: 30 minutes. I've already notified the customer support team and Amazon Web Services support since our EU cluster runs there.",
            timestamp: "2025-01-07T08:45:00Z",
            threadId: "thread-payment-bug",
        },
        {
            from: "david.park@contoso.com",
            to: ["bob.smith@contoso.com", "alice.chen@contoso.com"],
            subject: "Re: Critical: Payment Processing Bug in Production",
            body: "Hotfix is deployed and payment processing is back to normal. All 200 failed transactions have been retried successfully. I'll write a post-mortem document this afternoon. Lessons learned: we need better monitoring for our Stripe integration and automated rollback for payment-critical deployments.",
            timestamp: "2025-01-07T10:15:00Z",
            threadId: "thread-payment-bug",
        },

        // Thread 3: Hiring discussion
        {
            from: "alice.chen@contoso.com",
            to: ["elena.rodriguez@contoso.com"],
            subject: "Senior Engineer Candidates for Atlas Team",
            body: "Elena, I've reviewed the three candidates for the senior engineer position on the Atlas team. My top pick is James Liu from Google — he has 8 years of experience with distributed systems and previously worked on Google Cloud Spanner. Second choice is Sarah Kim from Microsoft Azure team. Both have strong Kubernetes experience which we'll need for the infrastructure work.",
            timestamp: "2025-01-08T14:00:00Z",
            threadId: "thread-hiring",
        },
        {
            from: "elena.rodriguez@contoso.com",
            to: ["alice.chen@contoso.com"],
            subject: "Re: Senior Engineer Candidates for Atlas Team",
            body: "I agree about James. His system design interview was excellent — he proposed an elegant solution for the data partitioning problem. I'll extend the offer today. Salary range is $180-200K plus equity. For Sarah, should we keep her in the pipeline for the second position we're opening in March?",
            timestamp: "2025-01-08T15:30:00Z",
            threadId: "thread-hiring",
        },

        // Thread 4: Conference planning
        {
            from: "carol.jones@contoso.com",
            to: ["alice.chen@contoso.com", "bob.smith@contoso.com", "david.park@contoso.com"],
            subject: "KubeCon EU 2025 - Who's Going?",
            body: "Hey everyone, KubeCon Europe is happening in London this April. I think we should send a few people from the Atlas team since we're investing heavily in Kubernetes. The early bird tickets are $800 each. Bob, you should definitely go since you're leading the infrastructure migration. David, the observability track might be relevant for the monitoring improvements you mentioned.",
            timestamp: "2025-01-09T11:00:00Z",
            threadId: "thread-kubecon",
        },
        {
            from: "bob.smith@contoso.com",
            to: ["carol.jones@contoso.com", "alice.chen@contoso.com", "david.park@contoso.com"],
            subject: "Re: KubeCon EU 2025 - Who's Going?",
            body: "I'm in! I'd love to attend the service mesh workshop and the session on running PostgreSQL on Kubernetes. Also, Kelsey Hightower is giving the keynote — that alone is worth the trip. London in April should be nice too. David, want to share a hotel to save on costs?",
            timestamp: "2025-01-09T11:45:00Z",
            threadId: "thread-kubecon",
        },

        // Thread 5: Vendor communication (external)
        {
            from: "sales@datadog.com",
            to: ["david.park@contoso.com"],
            subject: "Your Datadog Enterprise Trial - Next Steps",
            body: "Hi David, thanks for your interest in Datadog Enterprise. Following up on our demo last week, I wanted to share the pricing proposal for your team of 50 engineers. The annual plan would be $45,000 for infrastructure monitoring plus APM. This includes unlimited custom metrics and 15-day log retention. Happy to schedule a call to discuss further. Best regards, Jennifer Walsh, Datadog Sales",
            timestamp: "2025-01-10T09:00:00Z",
            threadId: "thread-datadog",
        },
        {
            from: "david.park@contoso.com",
            to: ["alice.chen@contoso.com"],
            subject: "Fwd: Your Datadog Enterprise Trial - Next Steps",
            body: "Alice, forwarding the Datadog pricing proposal. $45K/year seems reasonable for what we get. The alternative is building our own monitoring stack with Prometheus and Grafana which would take about 3 engineer-months. I recommend we go with Datadog — it'll help us catch issues like the Stripe payment bug much faster. Thoughts?",
            timestamp: "2025-01-10T09:30:00Z",
            threadId: "thread-datadog",
        },
    ];
}

// =========================================================================
// Convert emails to kp TextChunks and ChunkGroups
// =========================================================================

function emailsToChunks(emails: TestEmail[]): {
    chunks: TextChunk[];
    groups: ChunkGroup[];
} {
    const chunks: TextChunk[] = [];
    const groupMap = new Map<string, ChunkGroup>();

    for (let i = 0; i < emails.length; i++) {
        const email = emails[i];

        // Build metadata
        const metadata: Record<string, string[]> = {
            sender: [email.from],
            recipient: email.to,
            subject: [email.subject],
        };
        if (email.cc) {
            metadata.cc = email.cc;
        }

        chunks.push({
            chunkId: i,
            text: `From: ${email.from}\nTo: ${email.to.join(", ")}\nSubject: ${email.subject}\n\n${email.body}`,
            metadata,
            groupId: email.threadId,
            timestamp: email.timestamp,
        });

        // Build group
        if (!groupMap.has(email.threadId)) {
            groupMap.set(email.threadId, {
                groupId: email.threadId,
                groupType: "thread",
                label: email.subject.replace(/^(Re: |Fwd: )+/, ""),
                chunkIds: [],
                metadata: {},
            });
        }
        const group = groupMap.get(email.threadId)!;
        group.chunkIds.push(i);

        // Update time range
        if (!group.timeRange) {
            group.timeRange = { start: email.timestamp, end: email.timestamp };
        } else {
            if (email.timestamp < group.timeRange.start!) {
                group.timeRange.start = email.timestamp;
            }
            if (email.timestamp > group.timeRange.end!) {
                group.timeRange.end = email.timestamp;
            }
        }
    }

    return { chunks, groups: Array.from(groupMap.values()) };
}

// =========================================================================
// Query Plan Generation via LLM
// =========================================================================

const QUERY_PLAN_PROMPT = `You are a search query planner. Given a natural language question about an email corpus, generate a structured query plan as JSON.

The email corpus has these metadata columns:
- sender: email address of the sender
- recipient: email addresses of recipients
- cc: email addresses of CC recipients
- subject: email subject line

Available search features:
- metadataFilters: narrow by sender, recipient, subject (ops: "equals", "contains", "domain")
- timeRange: ISO date range {start, end}
- groupFilters: filter by thread label
- searchTerms: content keywords (USE LEMMATIZED FORMS — base forms like "run" not "running", "person" not "people")
- combineOp: "and" or "or" for search terms

Output a JSON object matching this schema:
{
  "intent": "factual" | "summary" | "list" | "recall",
  "metadataFilters": [{"column": "sender", "value": "bob@x.com", "op": "contains"}],
  "timeRange": {"start": "2025-01-07", "end": "2025-01-08"},
  "groupFilters": [{"label": "payment"}],
  "searchTerms": [{"term": "lemmatized_keyword", "weight": 1.0}],
  "combineOp": "and",
  "maxResults": 10
}

Return ONLY the JSON object. Use lemmatized (base) forms for all search terms.`;

async function generateQueryPlan(
    userQuery: string,
    model: string,
): Promise<QueryPlan> {
    const prompt = `${QUERY_PLAN_PROMPT}\n\nUser question: "${userQuery}"`;

    const queryInstance = query({
        prompt,
        options: { model },
    });

    let responseText = "";
    for await (const message of queryInstance) {
        if (message.type === "result") {
            if (message.subtype === "success") {
                responseText = message.result || "";
                break;
            }
        }
    }

    // Extract JSON
    const jsonStart = responseText.indexOf("{");
    const jsonEnd = responseText.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error("No JSON in query plan response");
    }
    const plan = JSON.parse(
        responseText.substring(jsonStart, jsonEnd + 1),
    ) as QueryPlan;

    // Defaults
    if (!plan.searchTerms) plan.searchTerms = [];
    if (!plan.combineOp) plan.combineOp = "and";

    return plan;
}

// =========================================================================
// Main
// =========================================================================

async function main() {
    const model = process.env.KP_MODEL ?? "claude-sonnet-4-20250514";

    console.log("=== kp Test Driver ===\n");

    // 1. Create test data
    console.log("Creating synthesized email threads...");
    const emails = createTestEmails();
    const { chunks, groups } = emailsToChunks(emails);
    console.log(`  ${chunks.length} emails in ${groups.length} threads\n`);

    // 2. Build index
    console.log("Building index (extracting keywords + LLM enrichment)...");
    const result = await buildIndex(chunks, groups, { model });

    console.log("\n--- Build Stats ---");
    console.log(`  Chunks:          ${result.stats.chunkCount}`);
    console.log(`  Raw keywords:    ${result.stats.rawKeywordCount}`);
    console.log(`  Vocabulary:      ${result.stats.vocabularySize}`);
    console.log(`  Enriched terms:  ${result.stats.enrichedTermCount}`);
    console.log(`  Index terms:     ${result.stats.indexTermCount}`);
    console.log(`  Related terms:   ${result.stats.relatedTermCount}`);
    console.log(`  Elapsed:         ${result.stats.elapsed}ms\n`);

    // 3. Create query engine
    const engine = new QueryEngine(
        result.invertedIndex,
        result.relatedTerms,
        result.metadataIndex,
        result.groupIndex,
    );

    // 4. Run test queries
    const testQueries = [
        "What was the payment bug about?",
        "Who is being hired for the Atlas team?",
        "What did Bob say about Kubernetes?",
        "Emails from alice.chen about project planning",
        "How much does Datadog cost?",
    ];

    console.log("=== Running Test Queries ===\n");
    for (const q of testQueries) {
        console.log(`Q: ${q}`);
        try {
            const plan = await generateQueryPlan(q, model);
            console.log(`  Plan: ${JSON.stringify(plan, null, 2).split("\n").join("\n  ")}`);

            const searchResult = engine.execute(plan);
            console.log(`  Results: ${searchResult.chunks.length} chunks (considered ${searchResult.totalConsidered})`);
            console.log(`  Matched terms: ${searchResult.matchedTerms.join(", ")}`);

            if (searchResult.expandedTerms && searchResult.expandedTerms.size > 0) {
                for (const [term, expanded] of searchResult.expandedTerms) {
                    console.log(`  Expanded "${term}" → [${expanded.join(", ")}]`);
                }
            }

            // Show top results
            for (const chunk of searchResult.chunks.slice(0, 3)) {
                const text = chunks[chunk.chunkId]?.text ?? "";
                const preview = text.substring(0, 120).replace(/\n/g, " ");
                console.log(`  [${chunk.chunkId}] score=${chunk.score.toFixed(2)} ${preview}...`);
            }

            // Generate grounded answer from top chunks
            if (searchResult.chunks.length > 0) {
                console.log("\n  --- Answer ---");
                const answerResult = await generateAnswer(
                    {
                        userQuery: q,
                        searchResult,
                        getChunk: (id) => {
                            const c = chunks[id];
                            if (!c) return undefined;
                            return toChunkContent(c);
                        },
                    },
                    { model },
                );
                console.log(`  ${answerResult.answer.split("\n").join("\n  ")}`);
                console.log(`  (${answerResult.chunksUsed} chunks, ${answerResult.charsUsed} chars)`);
            }
        } catch (e: any) {
            console.log(`  Error: ${e.message}`);
        }
        console.log();
    }

    // 5. Interactive mode
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log("=== Interactive Mode (type 'exit' to quit) ===\n");

    const askQuestion = () => {
        rl.question("Query> ", async (input) => {
            const trimmed = input.trim();
            if (!trimmed || trimmed === "exit") {
                rl.close();
                return;
            }

            try {
                const plan = await generateQueryPlan(trimmed, model);
                console.log(`Plan: ${JSON.stringify(plan)}`);

                const searchResult = engine.execute(plan);
                console.log(`Results: ${searchResult.chunks.length} chunks`);
                console.log(`Matched: ${searchResult.matchedTerms.join(", ")}`);

                if (searchResult.expandedTerms && searchResult.expandedTerms.size > 0) {
                    for (const [term, expanded] of searchResult.expandedTerms) {
                        console.log(`  "${term}" → [${expanded.join(", ")}]`);
                    }
                }

                for (const chunk of searchResult.chunks.slice(0, 5)) {
                    const text = chunks[chunk.chunkId]?.text ?? "";
                    const lines = text.split("\n");
                    const subject = lines.find((l) => l.startsWith("Subject:")) ?? "";
                    const from = lines.find((l) => l.startsWith("From:")) ?? "";
                    console.log(`  [${chunk.chunkId}] score=${chunk.score.toFixed(2)} ${from} | ${subject}`);
                }

                // Generate answer
                if (searchResult.chunks.length > 0) {
                    console.log("\n--- Answer ---");
                    const answerResult = await generateAnswer(
                        {
                            userQuery: trimmed,
                            searchResult,
                            getChunk: (id) => {
                                const c = chunks[id];
                                if (!c) return undefined;
                                return toChunkContent(c);
                            },
                        },
                        { model },
                    );
                    console.log(answerResult.answer);
                    console.log(`(${answerResult.chunksUsed} chunks, ${answerResult.charsUsed} chars)`);
                }
            } catch (e: any) {
                console.log(`Error: ${e.message}`);
            }

            console.log();
            askQuestion();
        });
    };

    askQuestion();
}

main().catch(console.error);
