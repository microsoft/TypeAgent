// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SearchResponse } from "./searchResponse.js";
import { CompositeEntity } from "./entities.js";

export function logSearchResponse(response: SearchResponse) {
    console.log;
    logList([...response.allTopics()], "ul", "TOPICS");
    logEntities(response.getEntities());
}

function logEntities(entities: CompositeEntity[] | undefined): void {
    if (entities && entities.length > 0) {
        logTitle(`ENTITIES [${entities.length}]`);
        for (const entity of entities) {
            logEntity(entity);
            console.log();
        }
        console.log();
    }
}

function logEntity(entity: CompositeEntity | undefined): void {
    if (entity) {
        console.log(entity.name.toUpperCase());
        logList(entity.type, "csv");
        logList(entity.facets, "ul");
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
