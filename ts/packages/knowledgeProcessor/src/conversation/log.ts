// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SearchResponse } from "./searchResponse.js";
import { CompositeEntity } from "./entities.js";

export function logSearchResponse(
    response: SearchResponse,
    verbose: boolean = false,
) {
    console.log;
    logList([...response.allTopics()], "ul", "TOPICS");
    logEntities(response.getEntities(), verbose);
}

function logEntities(
    entities: CompositeEntity[] | undefined,
    verbose: boolean,
): void {
    if (entities && entities.length > 0) {
        logTitle(`ENTITIES [${entities.length}]`);
        for (const entity of entities) {
            logEntity(entity, verbose);
            console.log();
        }
        console.log();
    }
}

function logEntity(
    entity: CompositeEntity | undefined,
    verbose: boolean,
): void {
    if (entity) {
        console.log(entity.name.toUpperCase());
        logList(entity.type, "csv");
        if (verbose) {
            logList(entity.facets, "ul");
        }
    }
}

function logList(
    list: string[] | undefined,
    type: "ol" | "ul" | "csv" | "plain" = "ol",
    title?: string,
) {
    if (list && list.length > 0) {
        if (title) {
            logTitle(`${title} [${list.length}]`);
        }
        switch (type) {
            default:
                for (let i = 0; i < list.length; ++i) {
                    console.log(list[i]);
                }
                break;
            case "ul":
                for (let i = 0; i < list.length; ++i) {
                    console.log("• " + list[i]);
                }
                break;
            case "csv":
            case "plain":
                const line = list.join(type === "plain" ? " " : ", ");
                console.log(line);
                break;
        }
    }
}

function logTitle(title: string): void {
    console.log(title);
    console.log();
}
