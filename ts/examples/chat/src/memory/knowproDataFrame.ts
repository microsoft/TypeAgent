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
import { RestaurantDb } from "./restaurantDb.js";

export async function createKnowproDataFrameCommands(
    commands: Record<string, CommandHandler>,
    printer: KnowProPrinter,
): Promise<void> {
    //commands.kpGetSchema = getSchema;
    commands.kpDataFrame = testDataFrame;

    async function testDataFrame(args: string[]) {
        const db = new RestaurantDb(
            "/data/testChat/knowpro/restaurants/restaurants.db",
        );
        try {
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
            const restaurantCollection: HybridRestaurantCollection =
                new HybridRestaurantCollection(db);
            for (let i = 0; i < restaurants.length; ++i) {
                const restaurant = restaurants[i];
                const sourceRef =
                    restaurantCollection.addRestaurant(restaurant);
                if (sourceRef !== undefined) {
                    printer.writeLine(restaurant.name);
                } else {
                    printer.writeError(`Skipped ${restaurant.name}`);
                }
            }
            testDb(db, restaurantCollection);
            //
            // Direct querying, without AI
            //
            printer.conversation = restaurantCollection.conversation;
            let latitude = "50.804436 (nl)";
            let rows = restaurantCollection.locations.getRow(
                "latitude",
                latitude,
                kp.ComparisonOp.Eq,
            );
            if (rows) {
                printer.writeLine("Geo matches");
                writeRows(rows, restaurantCollection);
            }
            //
            // Build index
            //
            printer.writeHeading("Building index");
            const progress = new ProgressBar(printer, restaurants.length);
            await restaurantCollection.buildIndex(
                createIndexingEventHandler(
                    printer,
                    progress,
                    restaurants.length,
                ),
            );
            progress.complete();
            // Automatic querying of data frames using standard conversation stuff
            printer.writeInColor(
                chalk.cyan,
                "Searching for 50.804436 (nl), 5.8997846 (nl)",
            );
            // Hybrid querying
            let termGroup = kp.createAndTermGroup(
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
            printer.writeInColor(
                chalk.cyan,
                "Searching for 'Punjabi Restaurant'",
            );
            const matchResult =
                await restaurantCollection.findWithLanguage(
                    "Punjabi Restaurant",
                );
            if (matchResult.success) {
                for (const match of matchResult.data) {
                    printer.writeJson(match);
                }
            }
        } catch (ex) {
            printer.writeError(`${ex}`);
        } finally {
            db.close();
        }
    }

    function writeRows(
        rows: kp.DataFrameRow[],
        restaurantCollection: HybridRestaurantCollection,
    ) {
        printer.writeJson(rows);
        const descriptions = restaurantCollection.getDescriptionsFromRows(rows);
        if (descriptions.length > 0) {
            printer.writeLine("Descriptions");
            printer.writeLines(descriptions);
        }
    }

    function testDb(
        db: RestaurantDb,
        restaurantCollection: HybridRestaurantCollection,
    ) {
        let latitude = "50.804436 (nl)";
        let rows = db.geo.getRow("latitude", latitude, kp.ComparisonOp.Eq);
        if (rows) {
            printer.writeInColor(chalk.cyan, "Geo matches Sqlite");
            writeRows(rows, restaurantCollection);
        }

        // Hybrid querying
        let termGroup = kp.createAndTermGroup(
            kp.createPropertySearchTerm("geo.latitude", "50.804436 (nl)"),
            kp.createPropertySearchTerm("geo.longitude", "5.8997846 (nl)"),
        );
        const dataFrameMatches = kp.searchDataFrames(db.dataFrames, termGroup);
        if (dataFrameMatches) {
            printer.writeScoredMessages(
                dataFrameMatches,
                restaurantCollection.conversation.messages,
                25,
            );
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

export interface Rating extends Thing, kp.DataFrameRecord {
    bestRating?: string;
    reviewCount?: string;
    ratingValue?: string;
    worstRating?: string;
}

export type Container<T> = {
    item?: T | undefined;
};

export class RestaurantInfo implements kp.IMessage {
    public restaurant: Restaurant;
    public textChunks: string[];
    public timestamp?: string | undefined;
    public tags: string[] = [];
    public deletionInfo?: kp.DeletionInfo | undefined;

    constructor(restaurant: Restaurant) {
        this.restaurant = restaurant;
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

export class RestaurantCollection implements kp.IConversation {
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

export class HybridRestaurantCollection implements kp.IConversationHybrid {
    public restaurants: RestaurantCollection;
    // Some information for restaurants is stored in data frames
    public dataFrames: kp.DataFrameCollection;
    public locations: kp.IDataFrame;
    public addresses: kp.IDataFrame;
    private queryTranslator: kp.SearchQueryTranslator;

    constructor(private restaurantDb: RestaurantDb) {
        this.restaurants = new RestaurantCollection();
        /*
        this.locations = new kp.DataFrame("geo", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
        */
        this.locations = this.restaurantDb.geo;
        this.addresses = new kp.DataFrame("address", [
            ["streetAddress", { type: "string" }],
            ["postalCode", { type: "string" }],
            ["addressLocality", { type: "string" }],
        ]);
        this.dataFrames = new Map<string, kp.IDataFrame>([
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

    public addRestaurant(restaurant: Restaurant): kp.RowSourceRef | undefined {
        // Bad data in the file
        if (!this.isGoodData(restaurant)) {
            return undefined;
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
        return sourceRef;
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
