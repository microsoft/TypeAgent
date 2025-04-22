// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import { FilterRestaurant } from "../lib/restaurantTypes.js";

export default class Filter extends Command {
    static description = "Filter restaurant data for TripAdvisor entries";

    static examples = [
        "<%= config.bin %> filter path/to/restaurants1.json path/to/restaurants2.json",
        "<%= config.bin %> filter path/to/*.json --output custom_output.json",
    ];

    static flags = {
        output: Flags.string({
            char: "o",
            description: "Custom output filename",
            required: false,
        }),
    };

    static args = {
        files: Args.string({
            description:
                "Path(s) to input JSON file(s) containing restaurant data",
            required: true,
            multiple: true,
        }),
    };

    // Normalize by flattening "item" if @source === "parent"
    private normalizeRestaurant(
        restaurant: FilterRestaurant,
    ): FilterRestaurant {
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
    private filterTripAdvisor(
        restaurants: FilterRestaurant[],
    ): FilterRestaurant[] {
        return restaurants
            .map((restaurant) => this.normalizeRestaurant(restaurant))
            .filter((restaurant: FilterRestaurant) => {
                let allowedHosts = ["tripadvisor.com", "www.tripadvisor.com"];

                const sourceIncludesTripAdvisor =
                    typeof restaurant.source === "string" &&
                    allowedHosts.includes(new URL(restaurant.source)?.hostname);

                const sameAsIncludesTripAdvisor = Array.isArray(
                    restaurant.sameAs,
                )
                    ? restaurant.sameAs.some(
                          (url) =>
                              typeof url === "string" &&
                              allowedHosts.includes(new URL(url).hostname),
                      )
                    : typeof restaurant.sameAs === "string" &&
                      allowedHosts.includes(
                          new URL(restaurant.sameAs)?.hostname,
                      );

                return sourceIncludesTripAdvisor || sameAsIncludesTripAdvisor;
            });
    }

    // Normalize sameAs into a unique deduplication key
    private getSameAsKey(sameAs: string | string[] | undefined): string | null {
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

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Filter);
        const inputFilePaths: string[] = Array.isArray(args.files)
            ? args.files
            : [args.files];

        if (inputFilePaths.length === 0) {
            this.error(
                "❌ Please provide one or more JSON file paths as arguments.",
            );
            return;
        }

        const filteredMap = new Map<string, FilterRestaurant>();
        let unnamedCounter = 0;

        for (const filePath of inputFilePaths) {
            try {
                const data = fs.readFileSync(filePath, "utf8");
                const parsed = JSON.parse(data);
                if (!Array.isArray(parsed)) {
                    this.error(`File ${filePath} does not contain an array`);
                    continue;
                }

                const filtered = this.filterTripAdvisor(parsed);
                this.log(
                    `✅ Processed ${filePath}, found ${filtered.length} matching entries.`,
                );

                for (const restaurant of filtered) {
                    const sameAsKey = this.getSameAsKey(restaurant.sameAs);
                    const key = sameAsKey || `__unnamed_${unnamedCounter++}`;

                    if (!filteredMap.has(key)) {
                        filteredMap.set(key, restaurant);
                    }
                }
            } catch (err) {
                this.error(
                    `❌ Error processing ${filePath}: ${(err as Error).message}`,
                );
            }
        }

        const mergedFiltered = Array.from(filteredMap.values());

        // Write merged filtered data
        if (mergedFiltered.length > 0) {
            let outputFilePath: string;

            if (flags.output) {
                outputFilePath = flags.output;
            } else {
                const { dir, name } = path.parse(inputFilePaths[0]);
                outputFilePath = path.join(dir, `${name}_merged_filtered.json`);
            }

            fs.writeFileSync(
                outputFilePath,
                JSON.stringify(mergedFiltered, null, 2),
                "utf8",
            );
            this.log(
                `✅ Merged filtered data (${mergedFiltered.length} unique entries) saved to: ${outputFilePath}`,
            );
        } else {
            this.warn("⚠️ No matching restaurants found in any input files.");
        }
    }
}
