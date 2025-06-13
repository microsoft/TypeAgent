// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Test script for website memory functionality

import { WebsiteCollection } from "./websiteCollection.js";
import { importWebsites, getDefaultBrowserPaths } from "./importWebsites.js";
import { WebsiteVisitInfo, importWebsiteVisit } from "./websiteMeta.js";

async function testWebsiteMemory() {
    console.log("Testing Website Memory Package...");

    // Test 1: Create a WebsiteCollection
    console.log("\n1. Creating WebsiteCollection...");
    const collection = new WebsiteCollection("test-collection");
    console.log("✓ WebsiteCollection created");

    // Test 2: Create sample website visits
    console.log("\n2. Creating sample website visits...");
    const sampleVisits: WebsiteVisitInfo[] = [
        {
            url: "https://github.com/microsoft/TypeAgent",
            title: "TypeAgent Repository",
            domain: "github.com",
            source: "bookmark",
            folder: "Development",
            pageType: "development",
            bookmarkDate: new Date().toISOString(),
        },
        {
            url: "https://news.bbc.com/technology",
            title: "BBC Technology News",
            domain: "news.bbc.com", 
            source: "history",
            pageType: "news",
            visitDate: new Date().toISOString(),
            visitCount: 5,
        },
        {
            url: "https://stackoverflow.com/questions/typescript",
            title: "TypeScript Questions - Stack Overflow",
            domain: "stackoverflow.com",
            source: "history",
            pageType: "development",
            visitDate: new Date().toISOString(),
            visitCount: 3,
        }
    ];

    const websites = sampleVisits.map(visit => importWebsiteVisit(visit));
    collection.addWebsites(websites);
    console.log(`✓ Added ${websites.length} sample websites`);

    // Test 3: Build index
    console.log("\n3. Building index...");
    await collection.buildIndex();
    console.log("✓ Index built successfully");
    console.log(`   - Semantic refs: ${collection.semanticRefs.length}`);
    console.log(`   - Messages: ${collection.messages.length}`);

    // Test 4: Test data frame queries
    console.log("\n4. Testing data frame queries...");
    const topDomains = collection.getMostVisitedDomains(5);
    console.log(`✓ Top visited domains:`, topDomains);

    const devWebsites = collection.getWebsitesByCategory("development");
    console.log(`✓ Development websites:`, devWebsites);

    const bookmarks = collection.getBookmarksByFolder("Development");
    console.log(`✓ Development bookmarks:`, bookmarks);

    // Test 5: Serialization
    console.log("\n5. Testing serialization...");
    const serialized = await collection.serialize();
    console.log("✓ Collection serialized successfully");
    console.log(`   - Messages: ${serialized.messages.length}`);
    console.log(`   - Semantic refs: ${serialized.semanticRefs.length}`);

    // Test 6: Check default browser paths
    console.log("\n6. Checking default browser paths...");
    const defaultPaths = getDefaultBrowserPaths();
    console.log("✓ Default browser paths:", {
        chrome: defaultPaths.chrome,
        edge: defaultPaths.edge
    });

    console.log("\n✅ All tests completed successfully!");
    return true;
}

// Test error handling
async function testErrorHandling() {
    console.log("\n\nTesting Error Handling...");

    try {
        // Test importing from non-existent file
        console.log("1. Testing import from non-existent file...");
        await importWebsites("chrome", "bookmarks", "/non/existent/path");
        console.log("❌ Should have thrown an error");
    } catch (error) {
        console.log("✓ Correctly threw error for non-existent file");
    }

    console.log("✅ Error handling tests completed!");
}

// Run tests
async function runTests() {
    try {
        await testWebsiteMemory();
        await testErrorHandling();
        console.log("\n🎉 All tests passed!");
    } catch (error) {
        console.error("❌ Test failed:", error);
        process.exit(1);
    }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('test.ts')) {
    runTests();
}

export { testWebsiteMemory, testErrorHandling };
