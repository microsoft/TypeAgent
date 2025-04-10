// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fetchWithRetry, openai } from "aiclient";
import { CommandHandler, ProgressBar } from "interactive-app";
import { KnowProPrinter } from "./knowproPrinter.js";
import { Result, success } from "typechat";
import { readAllText } from "typeagent";
import * as kp from "knowpro";
import { createIndexingEventHandler } from "./knowproCommon.js";
import chalk from "chalk";
import { conversation as kpLib } from "knowledge-processor";

export async function createKnowproDataFrameCommands(
    commands: Record<string, CommandHandler>,
    printer: KnowProPrinter,
): Promise<void> {
    //commands.kpGetSchema = getSchema;
    commands.kpDataFrame = testDataFrame;

    async function testDataFrame(args: string[]) {
        //
        // Load some restaurants into a collection
        //
        const filePath =
            "/data/testChat/knowpro/restaurants/all_restaurants/part_12.json";
        const numRestaurants = 16;
        const restaurants: Restaurant[] = await loadThings<Restaurant>(
            filePath,
            numRestaurants,
        );
        const restaurantCollection: RestaurantCollection =
            new RestaurantCollection();
        for (let i = 0; i < restaurants.length; ++i) {
            const restaurant = restaurants[i];
            if (restaurantCollection.addRestaurant(restaurant)) {
                printer.writeLine(restaurant.name);
            } else {
                printer.writeError(`Skipped ${restaurant.name}`);
            }
        }
        //
        // Build index
        //
        printer.writeHeading("Building index");
        const progress = new ProgressBar(printer, restaurants.length);
        await restaurantCollection.buildIndex(
            createIndexingEventHandler(printer, progress, restaurants.length),
        );
        //
        // Print knowledge
        //
        printer.writeHeading("Extracted Knowledge");
        for (const sr of restaurantCollection.textIndex.semanticRefs) {
            printer.writeSemanticRef(sr);
        }
        //
        // Do some querying
        //
        const rows = await restaurantCollection.locations.findRows(
            "latitude",
            "50.804436 (nl)",
            kp.ComparisonOp.Eq,
        );
        if (rows) {
            printer.writeLine("Geo matches");
            printer.writeJson(rows);
            const descriptions =
                restaurantCollection.getDescriptionsFromRows(rows);
            if (descriptions.length > 0) {
                printer.writeLine("Descriptions");
                printer.writeLines(descriptions);
            }
        }
        // So NLP querying
        printer.writeInColor(chalk.cyan, "Searching for Punjabi Food");
        const matchResult =
            await restaurantCollection.findRestaurant("Punjabi Restaurant");
        if (matchResult.success) {
            for (const match of matchResult.data) {
                printer.writeJson(match);
            }
        }
    }

    return;
}

export interface Thing {
    type: string;
}

export interface Restaurant extends Thing {
    name: string;
    description?: string;
    geo?: Geo;
    address?: Address;
}

export interface Geo extends Thing, kp.IDataFrameRow {
    latitude?: string;
    longitude?: string;
}

export interface Address extends Thing, kp.IDataFrameRow {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
}

export type Container<T> = {
    item?: T | undefined;
};

export type RestaurantOrdinal = kp.DataFrameRowSourceOrdinal;

export class RestaurantTextInfo implements kp.IMessage {
    public textChunks: string[];
    public timestamp?: string | undefined;
    public tags: string[] = [];
    public deletionInfo?: kp.DeletionInfo | undefined;

    constructor(
        public restaurantOrdinal: RestaurantOrdinal,
        public name: string,
        description?: string,
    ) {
        let text = `Restaurant:\n${name}`;
        if (description) {
            text += `\n\n${description}`;
        }
        this.textChunks = [text];
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        return {
            entities: [{ name: this.name, type: ["restaurant"] }],
            actions: [],
            inverseActions: [],
            topics: [],
        };
    }
}

export class RestaurantTextInfoCollection implements kp.IConversation {
    public settings: kp.ConversationSettings;
    public nameTag: string = "description";
    public tags: string[] = [];
    public semanticRefs: kp.SemanticRef[] = [];
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.IConversationSecondaryIndexes;

    constructor(
        public messages: RestaurantTextInfo[] = [],
        settings?: kp.ConversationSettings,
    ) {
        settings ??= kp.createConversationSettings();
        this.settings = settings;
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
    }

    public add(
        restaurantOrdinal: RestaurantOrdinal,
        name: string,
        description?: string,
    ): kp.TextRange {
        const messageOrdinal = this.messages.length;
        this.messages.push(
            new RestaurantTextInfo(restaurantOrdinal, name, description),
        );
        return {
            start: { messageOrdinal, chunkOrdinal: 0 },
        };
    }

    public getDescriptionFromLocation(
        textLocation: kp.TextLocation,
    ): RestaurantTextInfo {
        return this.messages[textLocation.messageOrdinal];
    }

    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        return kp.buildConversationIndex(this, this.settings, eventHandler);
    }
}

export class RestaurantCollection implements kp.IConversationHybrid {
    public restaurants: Restaurant[];
    public textIndex: RestaurantTextInfoCollection;
    public locations: kp.DataFrame<Geo>;
    public addresses: kp.DataFrame<Address>;
    private queryTranslator: kp.SearchQueryTranslator;
    private dataFames: kp.DataFrameCollection;

    constructor() {
        this.restaurants = [];
        this.textIndex = new RestaurantTextInfoCollection();
        this.locations = new kp.DataFrame<Geo>("geo", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
        this.addresses = new kp.DataFrame<Address>("address", [
            ["streetAddress", { type: "string" }],
            ["postalCode", { type: "string" }],
            ["addressLocality", { type: "string" }],
        ]);
        this.dataFames = new Map<string, kp.IDataFrame>([
            [this.locations.name, this.locations],
            [this.addresses.name, this.addresses],
        ]);

        this.queryTranslator = kp.createSearchQueryTranslator(
            openai.createChatModelDefault("knowpro_test"),
        );
    }

    public get conversation(): kp.IConversation {
        return this.textIndex;
    }

    public get dataFrames() {
        return this.dataFames;
    }

    public addRestaurant(restaurant: Restaurant): boolean {
        // Bad data in the file
        if (!this.isValidData(restaurant)) {
            return false;
        }
        let restaurantOrdinal = this.restaurants.length;
        this.restaurants.push(restaurant);
        const descriptionTextRange = this.textIndex.add(
            restaurantOrdinal,
            restaurant.name,
            restaurant.description,
        );
        if (restaurant.geo) {
            restaurant.geo.range = descriptionTextRange;
        }
        if (restaurant.address) {
            restaurant.address.range = descriptionTextRange;
        }
        if (restaurant.geo) {
            restaurant.geo.sourceOrdinal = restaurantOrdinal;
            this.locations.addRows(restaurant.geo);
        }
        if (restaurant.address) {
            restaurant.address.sourceOrdinal = restaurantOrdinal;
            this.addresses.addRows(restaurant.address);
        }
        return true;
    }

    public getDescriptionsFromRows(rows: kp.IDataFrameRow[]): string[] {
        const descriptions: string[] = [];
        for (const row of rows) {
            if (row.range) {
                const description = this.textIndex.getDescriptionFromLocation(
                    row.range.start,
                );
                descriptions.push(description.textChunks[0]);
            }
        }
        return descriptions;
    }

    public async findRestaurant(query: string): Promise<Result<Restaurant[]>> {
        const queryResults = await kp.searchQueryExprFromLanguage(
            this.textIndex,
            this.queryTranslator,
            query,
        );
        if (!queryResults.success) {
            return queryResults;
        }
        const matchedRestaurants: Restaurant[] = [];
        const sq = queryResults.data[0];
        for (const sExpr of sq.selectExpressions) {
            // TODO: look at terms in sexpr.searchTermGroup and figure out which should be handled by data frames
            // Then we can intersect results
            const matches = await kp.searchConversation(
                this.textIndex,
                sExpr.searchTermGroup,
                sExpr.when,
                undefined,
                sq.rawQuery,
            );
            if (matches) {
                for (const match of matches.messageMatches) {
                    matchedRestaurants.push(
                        this.restaurants[match.messageOrdinal],
                    );
                }
            }
        }
        return success(matchedRestaurants);
    }

    public async buildIndex(
        eventHandler: kp.IndexingEventHandlers,
    ): Promise<void> {
        await this.textIndex.buildIndex(eventHandler);
    }

    private isValidData(restaurant: Restaurant): boolean {
        if (restaurant.geo && typeof restaurant.geo === "string") {
            return false;
        }
        if (restaurant.address && typeof restaurant.address === "string") {
            return false;
        }
        return true;
    }
}

export async function loadThings<T extends Thing>(
    filePath: string,
    maxCount?: number,
): Promise<T[]> {
    const json = await readAllText(filePath);
    const containers: Container<T>[] = JSON.parse(json);
    const items: T[] = [];
    maxCount ??= containers.length;
    maxCount = Math.min(containers.length, maxCount);
    for (let i = 0; i < maxCount; ++i) {
        const item = containers[i].item;
        if (item !== undefined) {
            items.push(item);
        }
    }
    return items;
}

export async function fetchSchema(url: string): Promise<Result<unknown>> {
    const result = await fetchWithRetry(url);
    if (result.success) {
        return success(result.data.json());
    }
    return result;
}
