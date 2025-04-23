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
    commands.kpDataFrameIndex = indexDataFrame;
    commands.kpDataFrameSearch = searchDataFrame;

    const db = new RestaurantDb(
        "/data/testChat/knowpro/restaurants/restaurants.db",
    );
    const restaurantIndex: RestaurantIndex = new RestaurantIndex(db);
    const filePath =
        "/data/testChat/knowpro/restaurants/all_restaurants/part_12.json";
    let query = "Punjabi restaurant with Rating 3.0 in Eisenhüttenstadt";

    async function indexDataFrame(args: string[]) {
        try {
            //
            // Load some restaurants into a collection
            //
            let numRestaurants = 16;
            const restaurantData: Restaurant[] =
                await loadThings<Restaurant>(filePath);

            importRestaurants(restaurantIndex, restaurantData, numRestaurants);
            //
            // Build index
            //
            printer.writeHeading("Building index");
            await buildIndex(restaurantIndex);
            await testHybridQuery();
        } catch (ex) {
            printer.writeError(`${ex}`);
        } finally {
            db.close();
        }
    }

    async function searchDataFrame(args: string[]) {
        const nlpQuery = args[0] ?? query;
        // NLP querying
        printer.writeInColor(chalk.cyan, nlpQuery);
        const matchResult = await restaurantIndex.findWithLanguage(
            nlpQuery,
            (q) => {
                printer.writeJson(q);
            },
        );
        if (!matchResult.success) {
            printer.writeError(matchResult.message);
            return;
        }
        if (matchResult.data.length === 0) {
            printer.writeLine("No matches");
            return;
        }
        for (const restaurantList of matchResult.data) {
            restaurantList.forEach((restaurant) =>
                writeRestaurantMatch(restaurant),
            );
        }
    }

    function importRestaurants(
        restaurantCollection: RestaurantIndex,
        restaurants: Restaurant[],
        numRestaurants: number,
    ) {
        let countAdded = 0;
        for (let i = 0; i < restaurants.length; ++i) {
            const restaurant = restaurants[i];
            const facets = restaurantCollection.addRestaurant(restaurant);
            if (facets !== undefined) {
                printer.writeInColor(chalk.cyan, restaurant.name);
                printer.writeJson(facets);
                countAdded++;
                if (countAdded === numRestaurants) {
                    break;
                }
            } else {
                printer.writeError(`Skipped ${restaurant.name}`);
            }
        }
    }

    async function buildIndex(restaurantCollection: RestaurantIndex) {
        const numRestaurants =
            restaurantCollection.conversation.messages.length;
        const progress = new ProgressBar(printer, numRestaurants);
        await restaurantCollection.buildIndex(
            createIndexingEventHandler(printer, progress, numRestaurants),
        );
        progress.complete();
    }

    function writeRestaurantMatch(restaurant: Restaurant): void {
        printer.writeInColor(chalk.green, restaurant.name);
        printer.writeJsonInColor(chalk.gray, restaurant.facets);
    }

    async function testHybridQuery() {
        printer.writeInColor(
            chalk.cyan,
            "Searching for 50.804436 (nl), 5.8997846 (nl)",
        );
        // Hybrid querying
        let termGroup = kp.createAndTermGroup(
            kp.createPropertySearchTerm("geo.latitude", "50.804436 (nl)"),
            kp.createPropertySearchTerm("geo.longitude", "5.8997846 (nl)"),
        );
        const hybridMatches = await kp.hybrid.searchConversationWithJoin(
            restaurantIndex,
            termGroup,
        );
        if (hybridMatches && hybridMatches.dataFrameMatches) {
            printer.writeScoredMessages(
                hybridMatches.dataFrameMatches,
                restaurantIndex.conversation.messages,
                25,
            );
        }
    }
    /*
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

    function testGeo(restaurantCollection: HybridRestaurantCollection) {
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
        */
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
    aggregateRating?: AggregateRating;
    facets?: RestaurantFacets;
}

export interface Geo extends Thing, kp.hybrid.DataFrameRecord {
    latitude?: string | undefined;
    longitude?: string | undefined;
}

export interface Address extends Thing, kp.hybrid.DataFrameRecord {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
}

export interface AggregateRating extends Thing {
    ratingValue?: string;
}

export interface Location {
    city?: string | undefined;
    country?: string | undefined;
}

export interface RestaurantFacets extends kp.hybrid.DataFrameRecord, Location {
    rating?: number | undefined;
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

/**
 * Maintains all textual information for the restaurant + any knowledge extracted from it
 */
export class RestaurantStructuredRagIndex implements kp.IConversation {
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

export class RestaurantIndex implements kp.hybrid.IConversationHybrid {
    /**
     * All raw textual data (descriptions, etc) is indexed using structured RAG
     * Knowledge and other salient information is auto-extracted from the
     * text by structured RAG and indexed
     */
    public textIndex: RestaurantStructuredRagIndex;
    /**
     * Restaurant details like LOCATION and other FACETS can be stored in
     * strongly typed data frames ("tables") with spatial and other indexes.
     * These can be used as needed during query processing
     */
    public dataFrames: kp.hybrid.DataFrameCollection;
    public locations: kp.hybrid.IDataFrame;
    public restaurantFacets: kp.hybrid.IDataFrame;

    private queryTranslator: kp.SearchQueryTranslator;

    constructor(public restaurantDb: RestaurantDb) {
        this.textIndex = new RestaurantStructuredRagIndex();
        this.locations = new kp.hybrid.DataFrame("geo", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
        this.restaurantFacets = new kp.hybrid.DataFrame("restaurant", [
            ["rating", { type: "number" }],
            ["city", { type: "string" }],
            ["country", { type: "string" }],
        ]);
        this.dataFrames = new Map<string, kp.hybrid.IDataFrame>([
            [this.locations.name, this.locations],
            [this.restaurantFacets.name, this.restaurantFacets],
        ]);

        this.queryTranslator = kp.hybrid.lang.createSearchQueryTranslator(
            this.dataFrames,
            openai.createChatModelDefault("knowpro_test"),
        );
    }

    public get conversation(): kp.IConversation {
        return this.textIndex;
    }

    public addRestaurant(restaurant: Restaurant): RestaurantFacets | undefined {
        // Bad data in the file
        if (!this.isGoodData(restaurant)) {
            return undefined;
        }
        const facets = parseRestaurantFacets(restaurant);
        if (facets === undefined || !this.isGoodFacets(facets)) {
            return undefined;
        }
        const sourceRef: kp.hybrid.RowSourceRef = {
            range: this.textIndex.add(restaurant),
        };
        restaurant.facets = facets;
        this.restaurantFacets.addRows({ sourceRef, record: facets });
        if (restaurant.geo) {
            this.locations.addRows({
                sourceRef,
                record: restaurant.geo,
            });
        }
        if (restaurant.address) {
            // this.addresses.addRows({ sourceRef, record: restaurant.address });
        }
        return facets;
    }

    public getDescriptionsFromRows(rows: kp.hybrid.DataFrameRow[]): string[] {
        const descriptions: string[] = [];
        for (const row of rows) {
            if (row.record) {
                const description = this.textIndex.getDescriptionFromLocation(
                    row.sourceRef.range.start,
                );
                descriptions.push(description.textChunks[0]);
            }
        }
        return descriptions;
    }

    public async queryExprFromLanguage(query: string) {
        return kp.searchQueryFromLanguage(
            this.conversation,
            this.queryTranslator,
            query,
        );
    }

    public async findWithLanguage(
        query: string,
        callback?: (sq: kp.querySchema.SearchQuery) => void,
    ): Promise<Result<Restaurant[][]>> {
        const queryResults = await kp.searchQueryFromLanguage(
            this.conversation,
            this.queryTranslator,
            query,
        );
        if (!queryResults.success) {
            return queryResults;
        }
        const searchQuery = queryResults.data;
        if (callback) {
            callback(searchQuery);
        }
        const matchedRestaurants: Restaurant[][] = [];
        for (const searchExpr of searchQuery.searchExpressions) {
            const results = await kp.hybrid.lang.searchConversationMessages(
                this,
                searchExpr,
                undefined,
            );
            if (results) {
                for (const result of results) {
                    const matches = this.collectRestaurants(result);
                    if (matches.length > 0) {
                        matchedRestaurants.push(matches);
                    }
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

    private collectRestaurants(
        matchedOrdinals: kp.ScoredMessageOrdinal[],
        matches?: Restaurant[],
    ): Restaurant[] {
        matches ??= [];
        for (const match of matchedOrdinals) {
            const restaurant =
                this.textIndex.messages[match.messageOrdinal].restaurant;
            matches.push(restaurant);
        }
        return matches;
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
    private isGoodFacets(facets: RestaurantFacets): boolean {
        return (
            //facets.city !== undefined &&
            //facets.city.length > 0 &&
            facets.rating !== undefined && facets.rating > 0
        );
    }
}

function parseRestaurantFacets(
    restaurant: Restaurant,
): RestaurantFacets | undefined {
    let facets: RestaurantFacets = { rating: 3.0 };
    if (restaurant.address) {
        parseAddressFacets(restaurant.address, facets);
    }
    if (restaurant.aggregateRating) {
        facets.rating =
            parseNumber(restaurant.aggregateRating.ratingValue) ?? 3.0;
    }
    return facets;
}

function parseAddressFacets(address: Address, facets: RestaurantFacets) {
    if (address.addressLocality) {
        const location = parseLocation(address.addressLocality);
        if (location) {
            facets.city = location.city?.toLowerCase();
            facets.country = location.country?.toLowerCase();
        }
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

export type NumberAndText = {
    number: number;
    text: string;
};

export function parseNumberAndText(str: string): NumberAndText {
    const match = str.match(/^([\d.]+)\s*(.*)$/);
    return match
        ? { number: parseFloat(match[1]), text: match[2].trim() }
        : { number: NaN, text: str };
}

function parseNumber(str: string | undefined): number | undefined {
    try {
        return str ? Number.parseFloat(str.trim()) : undefined;
    } catch {}
    return undefined;
}

function parseLocation(location: string): Location | undefined {
    try {
        const match = location.match(/^(.+?)\s*\((.+?)\)$/);
        if (match && match.length > 1) {
            return {
                city: match[1].trim(),
                country: match[2].trim(),
            };
        }
    } catch {}
    return undefined;
}

/**
 * 
        this.addresses = new kp.DataFrame("address", [
            ["streetAddress", { type: "string" }],
            ["postalCode", { type: "string" }],
            ["addressLocality", { type: "string" }],
        ]);
 */
