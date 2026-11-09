// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { getAnalyticsData } from "../dist/agent/knowledge/actions/analyticsActions.mjs";

function fixture(failRead = 0) {
    let reads = 0;
    return {
        agentContext: {
            browserMemoryService: {
                listSources: async () => {
                    if (++reads === failRead)
                        throw new Error("Fixture source outage");
                    return [];
                },
                getKnowledgeGraph: async () => ({
                    entities: [],
                    topics: [],
                    relationships: [],
                }),
            },
        },
    };
}

test("browser reading analytics returns actual empty totals only after successful reads", async () => {
    const result = await getAnalyticsData({}, fixture());
    assert.equal(result.overview.totalSites, 0);
    assert.deepEqual(result.domains.topDomains, []);
    assert.equal(result.knowledge.totalEntities, 0);
});

test("missing browser service and partial helper/source outages never become healthy zero metrics", async () => {
    await assert.rejects(
        getAnalyticsData({}, { agentContext: {} }),
        /Durable browser memory/,
    );
    await assert.rejects(
        getAnalyticsData({}, fixture(1)),
        /statistics are unavailable/,
    );
    await assert.rejects(getAnalyticsData({}, fixture(2)), /top domains/);
    await assert.rejects(
        getAnalyticsData({}, fixture(7)),
        /Fixture source outage/,
    );
});
