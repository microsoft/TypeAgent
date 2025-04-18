// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

interface Restaurant {
    "@id"?: string;
    "@source"?: string;
    name?: string;
    source?: string;
    sameAs?: string | string[];
    item?: Partial<Restaurant> | undefined;
    [key: string]: any;
}

// Get input file paths from command-line arguments
const inputFilePaths = process.argv.slice(2);

if (inputFilePaths.length === 0) {
    console.error(
        "❌ Please provide one or more JSON file paths as arguments.",
    );
    process.exit(1);
}

// Normalize by flattening "item" if @source === "parent"
function normalizeRestaurant(restaurant: Restaurant): Restaurant {
    if (
        restaurant["@source"] === "parent" &&
        typeof restaurant.item === "object"
    ) {
        return {
            ...restaurant.item,
            ...restaurant, // Root-level fields override item if duplicated
            item: undefined, // Clean up the merged version
        };
    }
    return restaurant;
}

// Check for TripAdvisor links
function filterTripAdvisor(restaurants: Restaurant[]): Restaurant[] {
    return restaurants
        .map(normalizeRestaurant)
        .filter((restaurant: Restaurant) => {
            const sourceIncludesTripAdvisor =
                typeof restaurant.source === "string" &&
                restaurant.source.includes("tripadvisor.com");

            const sameAsIncludesTripAdvisor = Array.isArray(restaurant.sameAs)
                ? restaurant.sameAs.some(
                      (url) =>
                          typeof url === "string" &&
                          url.includes("tripadvisor.com"),
                  )
                : typeof restaurant.sameAs === "string" &&
                  restaurant.sameAs.includes("tripadvisor.com");

            return sourceIncludesTripAdvisor || sameAsIncludesTripAdvisor;
        });
}

// Normalize sameAs into a unique deduplication key
function getSameAsKey(sameAs: string | string[] | undefined): string | null {
    if (!sameAs) return null;
    if (typeof sameAs === "string") return sameAs.trim();
    if (Array.isArray(sameAs)) {
        return sameAs
            .filter((url) => typeof url === "string")
            .map((url) => url.trim())
            .sort()
            .join("|");
    }
    return null;
}

const filteredMap = new Map<string, Restaurant>();
let unnamedCounter = 0;

for (const filePath of inputFilePaths) {
    try {
        const data = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) {
            throw new Error(`File ${filePath} does not contain an array`);
        }

        const filtered = filterTripAdvisor(parsed);
        console.log(
            `✅ Processed ${filePath}, found ${filtered.length} matching entries.`,
        );

        for (const restaurant of filtered) {
            const sameAsKey = getSameAsKey(restaurant.sameAs);
            const key = sameAsKey || `__unnamed_${unnamedCounter++}`;

            if (!filteredMap.has(key)) {
                filteredMap.set(key, restaurant);
            }
        }
    } catch (err) {
        console.error(
            `❌ Error processing ${filePath}: ${(err as Error).message}`,
        );
    }
}

const mergedFiltered = Array.from(filteredMap.values());

// Write merged filtered data
if (mergedFiltered.length > 0) {
    const { dir, name } = path.parse(inputFilePaths[0]);
    const outputFilePath = path.join(dir, `${name}_merged_filtered.json`);

    fs.writeFileSync(
        outputFilePath,
        JSON.stringify(mergedFiltered, null, 2),
        "utf8",
    );
    console.log(
        `✅ Merged filtered data (${mergedFiltered.length} unique entries) saved to: ${outputFilePath}`,
    );
} else {
    console.warn("⚠️ No matching restaurants found in any input files.");
}
