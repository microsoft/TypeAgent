// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fetchWithRetry, openai } from "aiclient";
import {
    arg,
    argNum,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
    StopWatch,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { Result, success } from "typechat";
import { ensureDir, getFileName, readAllText } from "typeagent";
import * as kp from "knowpro";
import { createIndexingEventHandler } from "./knowproCommon.js";
import chalk from "chalk";
import { conversation as kpLib } from "knowledge-processor";
import { RestaurantDb } from "./restaurantDb.js";
import { argDestFile, argSourceFile } from "./common.js";
import path from "path";

export async function createKnowproDataFrameCommands(
    context: KnowproContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    //commands.kpGetSchema = getSchema;
    commands.kpDataFrameImport = importDataFrame;
    commands.kpDataFrameIndex = indexDataFrame;
    commands.kpDataFrameSearch = searchDataFrame;
    commands.kpDataFrameList = listFrames;
    commands.kpDataFrameSave = saveDataFrame;
    commands.kpDataFrameLoad = loadDataFrame;

    const basePath = "/data/testChat/knowpro/restaurants";
    const filePath = "/data/testChat/knowpro/restaurants/all/split_011.json";
    let query = "Punjabi restaurant with Rating 3.0 in Eisenhüttenstadt";

    let db: RestaurantDb | undefined;
    let restaurantIndex: RestaurantIndex | undefined;

    await ensureDir(basePath);
    const printer = context.printer;

    function importDataFrameDef(): CommandMetadata {
        return {
            description: "Import a data frame",
            options: {
                filePath: arg("filePath", undefined),
                count: argNum("Number of import"),
            },
        };
    }
    commands.kpDataFrameImport.metadata = importDataFrameDef();
    async function importDataFrame(args: string[]) {
        const namedArgs = parseNamedArguments(args, importDataFrameDef());
        const dataFramePath = namedArgs.filePath ?? filePath;
        try {
            ensureIndex(true);
            //
            // Load some restaurants into a collection
            //
            let numRestaurants = namedArgs.count ?? 16;
            const restaurantData: Restaurant[] =
                await loadThings<Restaurant>(dataFramePath);

            importRestaurants(restaurantIndex!, restaurantData, numRestaurants);
        } catch (ex) {
            printer.writeError(`${ex}`);
        }
    }

    function indexDataFrameDef(): CommandMetadata {
        return {
            description:
                "Import a data frame, index it and optionally save the index",
            options: {
                filePath: arg("filePath", undefined),
                indexFilePath: arg("Output path for index file"),
                count: argNum("Number of import"),
            },
        };
    }
    commands.kpDataFrameIndex.metadata = indexDataFrameDef();
    async function indexDataFrame(args: string[]) {
        const namedArgs = parseNamedArguments(args, indexDataFrameDef());
        const dataFramePath = namedArgs.filePath ?? filePath;
        try {
            await importDataFrame(args);
            //
            // Build index
            //
            printer.writeHeading("Building index");
            await buildIndex(restaurantIndex!);
            // Save the index
            namedArgs.filePath = sourcePathToIndexPath(
                dataFramePath,
                namedArgs.indexFilePath,
            );
            await saveDataFrame(namedArgs);
        } catch (ex) {
            printer.writeError(`${ex}`);
        }
    }

    function saveDataFrameDef(): CommandMetadata {
        return {
            description: "Save data frame",
            args: {
                filePath: argDestFile(),
            },
        };
    }
    commands.kpDataFrameSave.metadata = saveDataFrameDef();
    async function saveDataFrame(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, saveDataFrameDef());
        if (!restaurantIndex) {
            printer.writeLine("No restaurant index");
            return;
        }

        printer.writeLine("Saving index");
        printer.writeLine(namedArgs.filePath);
        const dirName = path.dirname(namedArgs.filePath);
        await ensureDir(dirName);

        const clock = new StopWatch();
        clock.start();
        await restaurantIndex.textIndex.writeToFile(
            dirName,
            getFileName(namedArgs.filePath),
        );
        clock.stop();
        printer.writeTiming(chalk.gray, clock, "Write to file");
    }

    function loadDataFrameDef(): CommandMetadata {
        return {
            description: "Load data frame",
            options: {
                filePath: argSourceFile(),
                name: arg("Data frame name"),
            },
        };
    }
    commands.kpDataFrameLoad.metadata = loadDataFrameDef();
    async function loadDataFrame(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, loadDataFrameDef());
        let dfFilePath = namedArgs.filePath;
        dfFilePath ??= namedArgs.name
            ? dfNameToFilePath(namedArgs.name)
            : undefined;
        if (!dfFilePath) {
            printer.writeError("No filepath or name provided");
            return;
        }
        await ensureIndex(false);
        const clock = new StopWatch();
        clock.start();
        await restaurantIndex!.loadTextIndex(
            path.dirname(dfFilePath),
            getFileName(dfFilePath),
        );
        clock.stop();
        printer.writeTiming(chalk.gray, clock, "Read file");
        context.conversation = restaurantIndex?.conversation;
    }

    function listDataFrameDef(): CommandMetadata {
        return {
            description: "List records from the dataframe",
        };
    }

    commands.kpDataFrameList.metadata = listDataFrameDef();
    async function listFrames(args: string[]) {
        if (restaurantIndex) {
            for (const r of restaurantIndex.restaurantFacets) {
                printer.writeJson(r.record);
            }
        }
    }

    function searchDataFrameDef(): CommandMetadata {
        return {
            description: "Search data frame with language",
        };
    }
    commands.kpDataFrameSearch.metadata = searchDataFrameDef();
    async function searchDataFrame(args: string[]) {
        if (!restaurantIndex) {
            ensureIndex(false);
        }

        const nlpQuery = args[0] ?? query;
        // NLP querying
        printer.writeInColor(chalk.cyan, nlpQuery);
        const matchResult = await restaurantIndex!.findWithLanguage(
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

    function ensureIndex(newDb: boolean) {
        let filePath = "/data/testChat/knowpro/restaurants/restaurants.db";
        if (newDb) {
            db?.close();
            db = new RestaurantDb(filePath, newDb);
        } else if (!db) {
            db = new RestaurantDb(filePath, newDb);
        }
        restaurantIndex = new RestaurantIndex(db);
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

        context.conversation = restaurantCollection.conversation;
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

    const IndexFileSuffix = "_index.json";
    function sourcePathToIndexPath(
        sourcePath: string,
        indexFilePath?: string,
    ): string {
        return (
            indexFilePath ??
            path.join(basePath, getFileName(sourcePath) + IndexFileSuffix)
        );
    }

    function dfNameToFilePath(name: string): string {
        return path.join(basePath, name + IndexFileSuffix);
    }

    return;
}

interface Entity {
    name: string;
    type: string[];
}

export interface Thing {
    type: string;
}

export interface Restaurant extends Thing {
    name: string;
    description?: string;
    openingHours?: string;
    servesCuisine?: string;
    geo?: Geo;
    address?: Address;
    aggregateRating?: AggregateRating;
    facets?: RestaurantFacets;
    hasMenu?: Menu[];
}

export interface Geo extends Thing, kp.dataFrame.DataFrameRecord {
    latitude?: string | undefined;
    longitude?: string | undefined;
}

export interface Address extends Thing, kp.dataFrame.DataFrameRecord {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string;
}

export interface AggregateRating extends Thing {
    ratingValue?: string;
}

export interface Location {
    city?: string | undefined;
    region?: string | undefined;
    country?: string | undefined;
}

interface MenuItem extends Thing {
    name: string;
    description: string | null;
}

interface MenuSection extends Thing {
    name: string;
    description: string | null;
    hasMenuItem: MenuItem[];
}

interface Menu extends Thing {
    name: string;
    hasMenuSection: MenuSection[];
}

export interface RestaurantFacets
    extends kp.dataFrame.DataFrameRecord,
        Location {
    rating?: number | undefined;
}

export type Container<T> = {
    item?: T | undefined;
};

// We will model a restaurant's information as messages for now
// Pre-well known knowledge such as menus comes from here.
export class RestaurantInfo implements kp.IMessage {
    public deletionInfo?: kp.DeletionInfo | undefined;

    constructor(
        public restaurant: Restaurant,
        public textChunks: string[] = [],
        public timestamp?: string | undefined,
        public tags: string[] = [],
    ) {
        this.restaurant = restaurant;
        if (textChunks.length === 0) {
            let text = `Restaurant:\n${restaurant.name}`;
            if (restaurant.description) {
                text += `\n\n${restaurant.description}`;
            }
            if (restaurant.openingHours) {
                text += `Open Hours:  \n\n${restaurant.openingHours}`;
            }

            this.textChunks.push(text);
        }
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        // cuisine
        const cuisineEntities = parseCuisine(this.restaurant);
        const menuItems = parseMenuItems(this.restaurant);

        return {
            entities: [
                { name: this.restaurant.name, type: ["restaurant"] },
                ...cuisineEntities,
                ...menuItems,
            ],
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
    public messages: kp.MessageCollection<RestaurantInfo>;
    public settings: kp.ConversationSettings;
    public nameTag: string = "description";
    public tags: string[] = [];
    public semanticRefs: kp.SemanticRefCollection;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;

    constructor(
        messages: RestaurantInfo[] = [],
        settings?: kp.ConversationSettings,
    ) {
        this.messages = new kp.MessageCollection<RestaurantInfo>(messages);
        this.semanticRefs = new kp.SemanticRefCollection();
        settings ??= kp.createConversationSettings();
        this.settings = settings;
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
    }

    public add(restaurant: Restaurant): kp.TextRange {
        const messageOrdinal = this.messages.length;
        this.messages.append(new RestaurantInfo(restaurant));
        return {
            start: { messageOrdinal, chunkOrdinal: 0 },
        };
    }

    public getDescriptionFromLocation(
        textLocation: kp.TextLocation,
    ): RestaurantInfo {
        return this.messages.get(textLocation.messageOrdinal);
    }

    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        return kp.buildConversationIndex(this, this.settings, eventHandler);
    }

    public async serialize(): Promise<RestaurantData> {
        const data: RestaurantData = {
            nameTag: this.nameTag,
            messages: this.messages.getAll(),
            tags: this.tags,
            semanticRefs: this.semanticRefs.getAll(),
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            messageIndexData: this.secondaryIndexes.messageIndex?.serialize(),
        };
        return data;
    }

    public async deserialize(data: RestaurantData): Promise<void> {
        this.nameTag = data.nameTag;
        this.messages = new kp.MessageCollection<RestaurantInfo>(
            this.deserializeMessages(data),
        );
        this.semanticRefs = new kp.SemanticRefCollection(data.semanticRefs);
        this.tags = data.tags;
        if (data.semanticIndexData) {
            this.semanticRefIndex = new kp.ConversationIndex(
                data.semanticIndexData,
            );
        }
        if (data.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                data.relatedTermsIndexData,
            );
        }
        if (data.messageIndexData) {
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
                this.settings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                data.messageIndexData,
            );
        }
        await kp.buildTransientSecondaryIndexes(this, this.settings);
    }

    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const data = await this.serialize();
        await kp.writeConversationDataToFile(data, dirPath, baseFileName);
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<RestaurantStructuredRagIndex | undefined> {
        const index = new RestaurantStructuredRagIndex();
        const data = await kp.readConversationDataFromFile(
            dirPath,
            baseFileName,
            index.settings.relatedTermIndexSettings.embeddingIndexSettings
                ?.embeddingSize,
        );
        if (data) {
            await index.deserialize(data);
        }
        return index;
    }

    private deserializeMessages(memoryData: RestaurantData) {
        return memoryData.messages.map((m) => {
            return new RestaurantInfo(
                m.restaurant,
                m.textChunks,
                m.timestamp,
                m.tags,
            );
        });
    }
}

export interface RestaurantData
    extends kp.IConversationDataWithIndexes<RestaurantInfo> {}

export class RestaurantIndex
    implements kp.dataFrame.IConversationWithDataFrame
{
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
    public dataFrames: kp.dataFrame.DataFrameCollection;
    public locations: kp.dataFrame.IDataFrame;
    public restaurantFacets: kp.dataFrame.IDataFrame;
    private queryTranslator: kp.SearchQueryTranslator;

    constructor(public restaurantDb: RestaurantDb) {
        this.textIndex = new RestaurantStructuredRagIndex();
        /*
        this.locations = new kp.dataFrame.DataFrame("geo", [
            ["latitude", { type: "string" }],
            ["longitude", { type: "string" }],
        ]);
        this.restaurantFacets = new kp.dataFrame.DataFrame("restaurant", [
            ["rating", { type: "number" }],
            ["city", { type: "string" }],
            ["country", { type: "string" }],
        ]);
        */
        this.locations = restaurantDb.geo;
        this.restaurantFacets = restaurantDb.restaurants;
        this.dataFrames = new Map<string, kp.dataFrame.IDataFrame>([
            [this.locations.name, this.locations],
            [this.restaurantFacets.name, this.restaurantFacets],
        ]);

        this.queryTranslator = kp.dataFrame.lang.createSearchQueryTranslator(
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
        const sourceRef: kp.dataFrame.RowSourceRef = {
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

    public getDescriptionsFromRows(
        rows: kp.dataFrame.DataFrameRow[],
    ): string[] {
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
            const results = await kp.dataFrame.lang.searchConversationMessages(
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

    public async saveTextIndex(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        return this.textIndex.writeToFile(dirPath, baseFileName);
    }

    public async loadTextIndex(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const index = await RestaurantStructuredRagIndex.readFromFile(
            dirPath,
            baseFileName,
        );
        if (index) {
            this.textIndex = index;
        }
    }

    private collectRestaurants(
        matchedOrdinals: kp.ScoredMessageOrdinal[],
        matches?: Restaurant[],
    ): Restaurant[] {
        matches ??= [];
        for (const match of matchedOrdinals) {
            const restaurant = this.textIndex.messages.get(
                match.messageOrdinal,
            ).restaurant;
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
        facets.city = address.addressLocality.toLowerCase();
        facets.region = address.addressRegion?.toLowerCase();
        facets.country = address.addressCountry?.toLowerCase();
    }
}

function parseCuisine(restaurant: Restaurant): Entity[] {
    if (!restaurant.servesCuisine) {
        return [];
    }

    const entities = restaurant.servesCuisine
        .split(",")
        .map((item) => item.trim());

    return entities.map((entity) => ({
        name: entity,
        type: ["cuisine"],
    }));
}

function parseMenuItems(restaurant: Restaurant): Entity[] {
    if (!restaurant.hasMenu || restaurant.hasMenu.length === 0) {
        return [];
    }

    const menuItems: Entity[] = [];
    for (const menu of restaurant.hasMenu) {
        for (const section of menu.hasMenuSection) {
            for (const item of section.hasMenuItem) {
                menuItems.push({
                    name: item.name,
                    type: ["menuItem"],
                });
            }
        }
    }

    return menuItems;
}

export async function loadThings<T extends Thing>(
    filePath: string,
    maxCount?: number,
): Promise<T[]> {
    const json = await readAllText(filePath);
    console.log(`Length read: ${json.length}`);

    const containers: Container<T>[] = JSON.parse(json);
    const items: T[] = [];
    maxCount ??= containers.length;
    console.log(`Items read: ${containers.length}`);
    maxCount = Math.min(containers.length, maxCount);
    for (let i = 0; i < maxCount; ++i) {
        const item = containers[i] as T;
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

/**
 * 
        this.addresses = new kp.DataFrame("address", [
            ["streetAddress", { type: "string" }],
            ["postalCode", { type: "string" }],
            ["addressLocality", { type: "string" }],
        ]);
 */
