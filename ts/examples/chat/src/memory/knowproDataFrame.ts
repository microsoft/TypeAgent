// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fetchWithRetry, openai } from "aiclient";
import { CommandHandler, ProgressBar } from "interactive-app";
import { KnowProPrinter } from "./knowproPrinter.js";
import { Result, success } from "typechat";
import { readAllText } from "typeagent";
import * as kp from "knowpro";
import { createIndexingEventHandler } from "./knowproCommon.js";

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
            restaurantCollection.addRestaurant(restaurants[i]);
        }
        //
        // Build index
        //
        const progress = new ProgressBar(printer, restaurants.length);
        await restaurantCollection.buildIndex(
            createIndexingEventHandler(printer, progress, restaurants.length),
        );
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
            printer.writeLine("Descriptions");
            printer.writeLines(descriptions);
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

export function defineGeoFrame(): kp.DataFrameDef {
    return {
        name: "Geo",
        columns: [
            { name: "latitude", type: "string" },
            { name: "longitude", type: "string" },
        ],
    };
}

export function defineAddressFrame(): kp.DataFrameDef {
    return {
        name: "Address",
        columns: [
            { name: "streetAddress", type: "string" },
            { name: "postalCode", type: "string" },
            { name: "addressLocality", type: "string" },
        ],
    };
}

export type RestaurantOrdinal = number;

export class Description implements kp.IMessage {
    public textChunks: string[];
    public timestamp?: string | undefined;
    public tags: string[] = [];
    public deletionInfo?: kp.DeletionInfo | undefined;

    constructor(
        public restaurantOrdinal: RestaurantOrdinal,
        description: string,
    ) {
        this.textChunks = [description];
    }

    public getKnowledge() {
        return undefined;
    }
}

export class DescriptionCollection implements kp.IConversation {
    public settings: kp.ConversationSettings;
    public nameTag: string = "description";
    public tags: string[] = [];
    public semanticRefs: kp.SemanticRef[] = [];
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.IConversationSecondaryIndexes;

    constructor(
        public messages: Description[] = [],
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
        description: string,
    ): kp.TextRange {
        const messageOrdinal = this.messages.length;
        this.messages.push(new Description(restaurantOrdinal, description));
        return {
            start: { messageOrdinal, chunkOrdinal: 0 },
        };
    }

    public getDescriptionFromLocation(
        textLocation: kp.TextLocation,
    ): Description {
        return this.messages[textLocation.messageOrdinal];
    }

    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        return kp.buildConversationIndex(this, this.settings, eventHandler);
    }
}

export class RestaurantCollection {
    public restaurants: Restaurant[];
    public descriptions: DescriptionCollection;
    public locations: kp.DataFrame<Geo>;
    public addresses: kp.DataFrame<Address>;
    private queryTranslator: kp.SearchQueryTranslator;

    constructor() {
        this.restaurants = [];
        this.descriptions = new DescriptionCollection();
        this.locations = new kp.DataFrame<Geo>(defineGeoFrame());
        this.addresses = new kp.DataFrame<Address>(defineAddressFrame());
        this.queryTranslator = kp.createSearchQueryTranslator(
            openai.createChatModelDefault("knowpro_test"),
        );
    }

    public addRestaurant(restaurant: Restaurant) {
        let restaurantOrdinal = this.restaurants.length;
        this.restaurants.push(restaurant);
        if (restaurant.description) {
            const descriptionTextRange = this.descriptions.add(
                restaurantOrdinal,
                restaurant.description,
            );
            if (restaurant.geo) {
                restaurant.geo.range = descriptionTextRange;
            }
            if (restaurant.address) {
                restaurant.address.range = descriptionTextRange;
            }
        }
        if (restaurant.geo) {
            restaurant.geo.sourceOrdinal = restaurantOrdinal;
            this.locations.addRows(restaurant.geo);
        }
        if (restaurant.address) {
            restaurant.address.sourceOrdinal = restaurantOrdinal;
            this.addresses.addRows(restaurant.address);
        }
    }

    public getDescriptionsFromRows(rows: kp.IDataFrameRow[]): string[] {
        const descriptions: string[] = [];
        for (const row of rows) {
            if (row.range) {
                const description =
                    this.descriptions.getDescriptionFromLocation(
                        row.range.start,
                    );
                descriptions.push(description.textChunks[0]);
            }
        }
        return descriptions;
    }

    public async findRestaurantByDescription(
        query: string,
    ): Promise<Result<Restaurant[]>> {
        const queryResults = await kp.searchQueryExprFromLanguage(
            this.descriptions,
            this.queryTranslator,
            query,
        );
        if (!queryResults.success) {
            return queryResults;
        }
        const matchedRestaurants: Restaurant[] = [];
        const sq = queryResults.data[0];
        for (const sexpr of sq.selectExpressions) {
            // TODO: look at terms in sexpr.searchTermGroup and figure out which should be handled by data frames
            // Then we can intersect results
            const matches = await kp.searchConversation(
                this.descriptions,
                sexpr.searchTermGroup,
                sexpr.when,
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
        this.descriptions.buildIndex(eventHandler);
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
