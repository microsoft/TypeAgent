// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Example usage of website memory with IndexManager

import { IndexManager } from "../../../../dispatcher/dist/context/indexManager.js";
import { WebsiteCollection } from "../src/index.js";
import path from "path";
import fs from "fs";

async function demonstrateWebsiteIndexing() {
    console.log("🌐 Website Memory Integration Demo");
    console.log("=====================================\n");

    // 1. Setup session directory
    const sessionDir = "./demo-session";
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    // 2. Initialize IndexManager
    console.log("1. Initializing IndexManager...");
    IndexManager.load([], sessionDir);
    const indexManager = IndexManager.getInstance();
    console.log("✓ IndexManager initialized\n");

    // 3. Create website indexes for different data sources
    console.log("2. Creating website indexes...");
    
    try {
        // Create Chrome bookmarks index
        await indexManager.createIndex(
            "my-chrome-bookmarks",
            "website",
            "default", // Will use default Chrome bookmarks path
            { sourceType: "bookmarks", browserType: "chrome" }
        );
        console.log("✓ Chrome bookmarks index created");

        // Create Chrome history index  
        await indexManager.createIndex(
            "my-chrome-history",
            "website", 
            "default", // Will use default Chrome history path
            { sourceType: "history", browserType: "chrome" }
        );
        console.log("✓ Chrome history index created");

        // Create Edge bookmarks index
        await indexManager.createIndex(
            "my-edge-bookmarks",
            "website",
            "default",
            { sourceType: "bookmarks", browserType: "edge" }
        );
        console.log("✓ Edge bookmarks index created");

    } catch (error) {
        console.log(`⚠️  Note: Some indexes may not be created if browser data is not available: ${error}`);
    }

    // 4. List all indexes
    console.log("\n3. Current indexes:");
    const indexes = indexManager.indexes;
    indexes.forEach((index, i) => {
        console.log(`   ${i + 1}. ${index.name} (${index.source}) - ${index.state}`);
        if (index.source === "website") {
            console.log(`      📁 ${index.sourceType} from ${index.browserType}`);
            console.log(`      📍 ${index.location}`);
        }
    });

    // 5. Wait for indexing to complete and show results
    console.log("\n4. Waiting for indexing to complete...");
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

    // Show updated status
    const updatedIndexes = indexManager.indexes;
    console.log("\n5. Indexing results:");
    updatedIndexes.forEach((index) => {
        if (index.source === "website") {
            console.log(`   📊 ${index.name}:`);
            console.log(`      State: ${index.state}`);
            console.log(`      Items: ${index.size}`);
            console.log(`      Progress: ${index.progress}`);
            console.log(`      Size on disk: ${(index.sizeOnDisk / 1024).toFixed(2)} KB`);
        }
    });

    console.log("\n✅ Demo completed! Website indexes are ready for querying.");
    console.log("\n💡 Next steps:");
    console.log("   - Query: 'Show me my most visited news sites'");
    console.log("   - Query: 'Find articles about TypeScript I bookmarked'");
    console.log("   - Query: 'What development tools have I been looking at?'");

    return true;
}

// Query examples for the indexed website data
export function getExampleQueries(): string[] {
    return [
        "What is my most visited news website?",
        "Show me articles about dinosaurs I read last week",
        "Find my bookmarks related to machine learning",
        "What development documentation have I visited recently?",
        "Show me all websites in my 'Work' bookmark folder",
        "Which domains do I visit most frequently?",
        "Find the TypeScript tutorial I bookmarked",
        "Show me my travel-related browsing history",
        "What shopping sites have I visited this month?",
        "Find GitHub repositories I've bookmarked"
    ];
}

// Direct website collection usage example
export async function demonstrateDirectUsage() {
    console.log("\n🔍 Direct Website Collection Usage");
    console.log("===================================\n");

    try {
        // Load an existing website index
        const collection = await WebsiteCollection.readFromFile(
            "./demo-session/indexes/website/index1",
            "index"
        );

        if (collection) {
            console.log("✓ Loaded existing website collection");
            console.log(`   Messages: ${collection.messages.length}`);
            
            // Example queries
            const topDomains = collection.getMostVisitedDomains(5);
            console.log("\n📈 Top 5 visited domains:", topDomains);

            const devSites = collection.getWebsitesByCategory("development");
            console.log("\n💻 Development websites:", devSites.slice(0, 3));

            const workBookmarks = collection.getBookmarksByFolder("Work");
            console.log("\n📁 Work bookmarks:", workBookmarks.slice(0, 3));
        } else {
            console.log("ℹ️  No existing website collection found. Run the indexing demo first.");
        }
    } catch (error) {
        console.log(`ℹ️  Could not load existing collection: ${error}`);
    }
}

// Run the demonstration
if (import.meta.url === `file://${process.argv[1]}`) {
    demonstrateWebsiteIndexing()
        .then(() => demonstrateDirectUsage())
        .catch(console.error);
}

export { demonstrateWebsiteIndexing, demonstrateDirectUsage };
