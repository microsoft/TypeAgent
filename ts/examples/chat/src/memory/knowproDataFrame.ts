// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fetchWithRetry } from "aiclient";
import {
    CommandHandler,
    //CommandMetadata,
    //parseNamedArguments,
} from "interactive-app";
import { KnowProPrinter } from "./knowproPrinter.js";
import { Result, success } from "typechat";
import { readAllText } from "typeagent";

export async function createKnowproDataFrameCommands(
    commands: Record<string, CommandHandler>,
    printer: KnowProPrinter,
): Promise<void> {
    //commands.kpGetSchema = getSchema;
    commands.kpTestDataFrame = testDataFrame;

    async function testDataFrame(args: string[]) {
        const filePath =
            "/data/testChat/knowpro/restaurants/all_restaurants/part_12.json";
        const restaurants: Restaurant[] =
            await loadSchemaData<Restaurant>(filePath);
        for (let i = 0; i < 4; ++i) {
            const restaurant = restaurants[i];
            printer.writeJson(restaurant);
            restaurant;
        }
    }
    return;
}

type Restaurant = {
    name: string;
    geo?: Geo;
    address?: Address;
};

type Geo = {
    latitude?: string;
    longitude?: string;
};

type Address = {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
};

type Container<T> = {
    item?: T | undefined;
};

async function loadSchemaData<T>(filePath: string): Promise<T[]> {
    const json = await readAllText(filePath);
    const containers: Container<T>[] = JSON.parse(json);
    const items: T[] = [];
    for (let container of containers) {
        if (container.item) {
            items.push(container.item);
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
