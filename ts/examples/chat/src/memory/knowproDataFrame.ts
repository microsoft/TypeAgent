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
        progress.complete();
        //
        // Do some querying
        //
        printer.conversation = restaurantCollection.conversation;
        const rows = await restaurantCollection.locations.get(
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
        // Automatic querying of data frames using standard conversation stuff
        const termGroup = kp.createAndTermGroup(
            kp.createPropertySearchTerm("geo.latitude", "50.804436 (nl)"),
            kp.createPropertySearchTerm("geo.longitude", "5.8997846 (nl)"),
        );
        const hybridMatches = await kp.searchConversationHybrid(
            restaurantCollection,
            termGroup,
        );
        if (hybridMatches && hybridMatches.dataFrameMatches) {
            printer.writeScoredMessages(
                hybridMatches.dataFrameMatches,
                restaurantCollection.conversation.messages,
                25,
            );
        }
        // NLP querying
        printer.writeInColor(chalk.cyan, "Searching for Punjabi Food");
        const matchResult =
            await restaurantCollection.findWithLanguage("Punjabi Restaurant");
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

export interface Geo extends Thing, kp.DataFrameRecord {
    latitude?: string | undefined;
    longitude?: string | undefined;
}

export interface Address extends Thing, kp.DataFrameRecord {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
}

export type Container<T> = {
    item?: T | undefined;
};

export class RestaurantInfo implements kp.IMessage {
    public textChunks: string[];
    public timestamp?: string | undefined;
    public tags: string[] = [];
    public deletionInfo?: kp.DeletionInfo | undefined;

    constructor(public restaurant: Restaurant) {
        let text = `Restaurant:\n${restaurant.name}`;
        if (restaurant.description) {
            text += `\n\n${restaurant.description}`;
        }
        this.textChunks = [text];
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        return {
            entities: [{ name: this.restaurant.name, type: ["restaurant"] }],
            actions: [],
            inverseActions: [],
            topics: [],
        };
    }
}

export class RestaurantInfoCollection implements kp.IConversation {
    public settings: kp.ConversationSettings;
    public nameTag: string = "description";
    public tags: string[] = [];
    public semanticRefs: kp.SemanticRef[] = [];
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.IConversationSecondaryIndexes;

    constructor(
        public messages: RestaurantInfo[] = [],
        settings?: kp.ConversationSettings,
    ) {
        settings ??= kp.createConversationSettings();
        this.settings = settings;
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
    }

    public add(restaurant: Restaurant): kp.TextRange {
        const messageOrdinal = this.messages.length;
        this.messages.push(new RestaurantInfo(restaurant));
        return {
            start: { messageOrdinal, chunkOrdinal: 0 },
        };
    }

    public getDescriptionFromLocation(
        textLocation: kp.TextLocation,
    ): RestaurantInfo {
        return this.messages[textLocation.messageOrdinal];
    }

    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        return kp.buildConversationIndex(this, this.settings, eventHandler);
    }
}

export class RestaurantCollection implements kp.IConversationHybrid {
    public restaurants: RestaurantInfoCollection;
    public tables: kp.DataFrameCollection;
    public locations: kp.DataFrame;
    public addresses: kp.DataFrame;
    private queryTranslator: kp.SearchQueryTranslator;

    constructor() {
        this.restaurants = new RestaurantInfoCollection();
        this.locations = new kp.DataFrame("geo", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
        this.addresses = new kp.DataFrame("address", [
            ["streetAddress", { type: "string" }],
            ["postalCode", { type: "string" }],
            ["addressLocality", { type: "string" }],
        ]);
        this.tables = new Map<string, kp.IDataFrame>([
            [this.locations.name, this.locations],
            [this.addresses.name, this.addresses],
        ]);

        this.queryTranslator = kp.createSearchQueryTranslator(
            openai.createChatModelDefault("knowpro_test"),
        );
    }

    public get conversation(): kp.IConversation {
        return this.restaurants;
    }

    public get dataFrames(): kp.DataFrameCollection {
        return this.dataFrames;
    }

    public addRestaurant(restaurant: Restaurant): boolean {
        // Bad data in the file
        if (!this.isGoodData(restaurant)) {
            return false;
        }
        const sourceRef: kp.RowSourceRef = {
            range: this.restaurants.add(restaurant),
        };
        if (restaurant.geo) {
            this.locations.addRows({
                sourceRef,
                record: restaurant.geo,
            });
        }
        if (restaurant.address) {
            this.addresses.addRows({ sourceRef, record: restaurant.address });
        }
        return true;
    }

    public getDescriptionsFromRows(rows: kp.DataFrameRow[]): string[] {
        const descriptions: string[] = [];
        for (const row of rows) {
            if (row.record) {
                const description = this.restaurants.getDescriptionFromLocation(
                    row.sourceRef.range.start,
                );
                descriptions.push(description.textChunks[0]);
            }
        }
        return descriptions;
    }

    public async findWithLanguage(
        query: string,
    ): Promise<Result<Restaurant[]>> {
        const queryResults = await kp.searchQueryExprFromLanguage(
            this.conversation,
            this.queryTranslator,
            query,
        );
        if (!queryResults.success) {
            return queryResults;
        }
        const matchedRestaurants: Restaurant[] = [];
        const sq = queryResults.data[0];
        for (const sExpr of sq.selectExpressions) {
            const matches = await kp.searchConversationHybrid(
                this,
                sExpr.searchTermGroup,
                sExpr.when,
                undefined,
                sq.rawQuery,
            );
            // TODO: combine these separate matches?
            if (matches && matches.conversationMatches) {
                this.collectMessages(
                    matches.conversationMatches.messageMatches,
                    matchedRestaurants,
                );
            }
            if (matches && matches.dataFrameMatches) {
                this.collectMessages(
                    matches.dataFrameMatches,
                    matchedRestaurants,
                );
            }
        }
        return success(matchedRestaurants);
    }

    public async buildIndex(
        eventHandler: kp.IndexingEventHandlers,
    ): Promise<void> {
        await this.restaurants.buildIndex(eventHandler);
    }

    private collectMessages(
        matchedOrdinals: kp.ScoredMessageOrdinal[],
        matches: Restaurant[],
    ) {
        for (const match of matchedOrdinals) {
            const restaurant =
                this.restaurants.messages[match.messageOrdinal].restaurant;
            matches.push(restaurant);
        }
    }
    /**
     * Source data is imperfect
     * @param restaurant
     * @returns
     */
    private isGoodData(restaurant: Restaurant): boolean {
        if (restaurant === undefined) {
            return false;
        }
        if (restaurant.name === undefined || restaurant.name.length === 0) {
            return false;
        }
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
