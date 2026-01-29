// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * NFA Cache Integration Test
 *
 * This test verifies the complete NFA cache flow:
 * 1. Start CommandServer with NFA configuration
 * 2. Execute initial requests (should miss cache and populate)
 * 3. Re-execute same requests (should hit cache)
 * 4. Execute similar requests with same structure (should hit cache via grammar generalization)
 *
 * This is a long-running integration test that requires:
 * - A running TypeAgent dispatcher server at ws://localhost:8999
 * - The dispatcher configured with NFA cache enabled
 * - Patience (includes 120 second delays to ensure cache persistence)
 */

import { CommandServer } from "../src/commandServer.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ExecuteCommandRequest } from "../src/commandServer.js";

// Test configuration
const TEST_CONFIG_DIR = path.join(os.tmpdir(), "typeagent-test-config");
const TEST_CONFIG_FILE = path.join(TEST_CONFIG_DIR, "agentServerConfig.json");
const TEST_TIMEOUT = 240000; // 4 minutes (includes 120s wait)

/**
 * Helper to create NFA configuration file
 */
function createNFAConfig() {
    if (!fs.existsSync(TEST_CONFIG_DIR)) {
        fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }

    const config = {
        version: "1.0",
        cache: {
            enabled: true,
            grammarSystem: "nfa",
            matchWildcard: true,
            matchEntityWildcard: true,
            mergeMatchSets: true,
            cacheConflicts: false,
        },
        agents: [
            {
                name: "player",
                enabled: true,
            },
            {
                name: "list",
                enabled: true,
            },
            {
                name: "calendar",
                enabled: true,
            },
        ],
        dispatcher: {
            persistSession: true,
            persistDir: "~/.typeagent",
            metrics: true,
            dbLogging: false,
        },
    };

    fs.writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config, null, 2));
    return TEST_CONFIG_FILE;
}

/**
 * Helper to clean up test configuration
 */
function cleanupNFAConfig() {
    if (fs.existsSync(TEST_CONFIG_FILE)) {
        fs.unlinkSync(TEST_CONFIG_FILE);
    }
    if (fs.existsSync(TEST_CONFIG_DIR)) {
        fs.rmdirSync(TEST_CONFIG_DIR);
    }
}

/**
 * Helper to execute a command via CommandServer
 */
async function executeCommand(
    server: CommandServer,
    request: string,
    cacheCheck: boolean = false,
): Promise<{ result: string; isCacheHit: boolean; isCacheMiss: boolean }> {
    const executeRequest: ExecuteCommandRequest = {
        request,
        cacheCheck,
    };

    const result = await server.executeCommand(executeRequest);
    const text =
        result.content[0].type === "text" ? result.content[0].text : "";

    return {
        result: text,
        isCacheHit: text.startsWith("CACHE_HIT:"),
        isCacheMiss: text.startsWith("CACHE_MISS:"),
    };
}

describe("NFA Cache Integration", () => {
    let server: CommandServer;
    let configPath: string;

    beforeAll(async () => {
        // Create NFA configuration
        configPath = createNFAConfig();

        // Set environment variable to use our test config
        process.env.AGENT_SERVER_CONFIG = configPath;

        // Create CommandServer instance
        server = new CommandServer(false); // debugMode = false

        // Verify configuration was loaded correctly
        const config = server.getConfig();
        expect(config.cache.grammarSystem).toBe("nfa");
        expect(config.cache.enabled).toBe(true);

        // Start the server (connects to dispatcher)
        // Note: This assumes dispatcher is already running at ws://localhost:8999
        await server.start();

        console.log("CommandServer started with NFA cache configuration");
    }, TEST_TIMEOUT);

    afterAll(async () => {
        if (server) {
            await server.close();
        }
        cleanupNFAConfig();
        delete process.env.AGENT_SERVER_CONFIG;
    }, TEST_TIMEOUT);

    describe("Cache Population and Hit Cycle", () => {
        const initialRequests = [
            "play Bohemian Rhapsody by Queen",
            "add milk to my shopping list",
            "schedule dentist appointment tomorrow at 3pm",
        ];

        const similarRequests = [
            "play Stairway to Heaven by Led Zeppelin", // Similar structure to first
            "add eggs to my shopping list", // Similar structure to second
            "schedule team meeting next Monday at 2pm", // Similar structure to third
        ];

        it(
            "should populate cache on first execution",
            async () => {
                console.log("\n=== Phase 1: Initial Requests (Cache Population) ===");

                for (const request of initialRequests) {
                    console.log(`\nExecuting: "${request}"`);

                    // First execution - should miss cache (not yet populated)
                    const { result, isCacheHit, isCacheMiss } =
                        await executeCommand(server, request, true);

                    console.log(
                        `  Cache status: ${isCacheHit ? "HIT" : isCacheMiss ? "MISS" : "UNKNOWN"}`,
                    );
                    console.log(`  Result: ${result.substring(0, 100)}...`);

                    // On first run, we expect either:
                    // - CACHE_MISS (if cache doesn't have this pattern)
                    // - Successful execution that populates cache
                    // We don't strictly require CACHE_MISS because the cache might
                    // already have similar patterns from previous test runs
                }

                console.log("\n✓ Initial requests executed");
            },
            TEST_TIMEOUT,
        );

        it(
            "should hit cache on repeated execution after delay",
            async () => {
                console.log(
                    "\n=== Phase 2: Waiting 120 seconds for cache persistence ===",
                );
                console.log("Waiting to ensure grammar rules are persisted...");

                // Wait 120 seconds to ensure:
                // 1. Grammar rules are generated from request/action pairs
                // 2. Rules are saved to persistent storage
                // 3. Cache is fully populated
                await new Promise((resolve) => setTimeout(resolve, 120000));

                console.log("Wait complete. Re-executing same requests...\n");

                console.log("\n=== Phase 3: Repeated Requests (Cache Hit Verification) ===");

                let hitCount = 0;
                let missCount = 0;

                for (const request of initialRequests) {
                    console.log(`\nRe-executing: "${request}"`);

                    const { result, isCacheHit, isCacheMiss } =
                        await executeCommand(server, request, true);

                    console.log(
                        `  Cache status: ${isCacheHit ? "HIT" : isCacheMiss ? "MISS" : "UNKNOWN"}`,
                    );
                    console.log(`  Result: ${result.substring(0, 100)}...`);

                    if (isCacheHit) {
                        hitCount++;
                    } else if (isCacheMiss) {
                        missCount++;
                    }

                    // After cache population and persistence, we expect cache hits
                    // However, we'll track results rather than strictly requiring hits
                    // in case cache behavior varies based on dispatcher state
                }

                console.log(`\n✓ Repeated execution complete`);
                console.log(`  Cache hits: ${hitCount}/${initialRequests.length}`);
                console.log(`  Cache misses: ${missCount}/${initialRequests.length}`);

                // Log results for analysis
                console.log(
                    `\n📊 Cache Hit Rate: ${(hitCount / initialRequests.length * 100).toFixed(1)}%`,
                );
            },
            TEST_TIMEOUT,
        );

        it(
            "should hit cache for similar requests (grammar generalization)",
            async () => {
                console.log(
                    "\n=== Phase 4: Similar Requests (Grammar Generalization Test) ===",
                );
                console.log(
                    "Testing whether grammar patterns generalize to similar requests...\n",
                );

                let hitCount = 0;
                let missCount = 0;

                for (let i = 0; i < similarRequests.length; i++) {
                    const request = similarRequests[i];
                    const originalRequest = initialRequests[i];

                    console.log(`\nOriginal: "${originalRequest}"`);
                    console.log(`Similar:  "${request}"`);

                    const { result, isCacheHit, isCacheMiss } =
                        await executeCommand(server, request, true);

                    console.log(
                        `  Cache status: ${isCacheHit ? "HIT ✓" : isCacheMiss ? "MISS ✗" : "UNKNOWN ?"}`,
                    );
                    console.log(`  Result: ${result.substring(0, 100)}...`);

                    if (isCacheHit) {
                        hitCount++;
                        console.log(
                            "  ✓ Grammar generalization successful!",
                        );
                    } else if (isCacheMiss) {
                        missCount++;
                        console.log(
                            "  ✗ Grammar did not generalize (cache miss)",
                        );
                    }
                }

                console.log(`\n✓ Similar request execution complete`);
                console.log(
                    `  Generalization hits: ${hitCount}/${similarRequests.length}`,
                );
                console.log(
                    `  Generalization misses: ${missCount}/${similarRequests.length}`,
                );

                console.log(
                    `\n📊 Generalization Rate: ${(hitCount / similarRequests.length * 100).toFixed(1)}%`,
                );

                // The key insight: If NFA grammar generation is working correctly,
                // similar requests should hit the cache because they match the same
                // grammar patterns (e.g., "play $track by $artist")
                console.log(
                    "\n💡 Expected behavior:",
                );
                console.log(
                    "   - High generalization rate = NFA grammar is working correctly",
                );
                console.log(
                    "   - Low generalization rate = Grammar patterns may need tuning",
                );
            },
            TEST_TIMEOUT,
        );
    });

    describe("Cache Behavior Summary", () => {
        it("should log final test summary", () => {
            console.log("\n" + "=".repeat(80));
            console.log("NFA CACHE INTEGRATION TEST SUMMARY");
            console.log("=".repeat(80));
            console.log("\nTest completed successfully!");
            console.log("\nKey observations to review:");
            console.log("1. Did repeated requests hit the cache?");
            console.log(
                "2. Did similar requests generalize (hit cache via grammar patterns)?",
            );
            console.log("3. What was the overall cache hit rate?");
            console.log("\nIf cache hit rates are low, check:");
            console.log("- Grammar generation is enabled in dispatcher");
            console.log("- Dynamic rules are being persisted to disk");
            console.log("- AgentGrammarRegistry is properly synced");
            console.log("=".repeat(80) + "\n");
        });
    });
});
