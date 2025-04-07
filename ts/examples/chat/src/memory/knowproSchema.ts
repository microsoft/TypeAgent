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
import { PostalAddress } from "schema-dts";

export async function createKnowproSchemaCommands(
    commands: Record<string, CommandHandler>,
    printer: KnowProPrinter,
): Promise<void> {
    //commands.kpGetSchema = getSchema;
    commands.kpTestSchema = testSchema;

    async function testSchema(args: string[]) {
        const address: PostalAddress = {
            "@type": "PostalAddress",
            streetAddress: "123 Microsoft Way",
            addressLocality: "Redmond",
            addressRegion: "WA",
            addressCountry: "USA",
        };
        printer.writeJson(address);
    }
    /*
    function getSchemaDef(): CommandMetadata {
        return {
            description: "Get schema.org schema",
            args: {
                url: arg("Url for schema"),
            },
        };
    }
    commands.kpGetSchema.metadata = getSchemaDef();
    async function getSchema(args: string[]) {
        const namedArgs = parseNamedArguments(args, getSchemaDef());
        const schema = await fetchSchema(namedArgs.url);
        printer.writeJson(schema, true);
    }
        */
    return;
}

export async function fetchSchema(url: string): Promise<Result<unknown>> {
    const result = await fetchWithRetry(url);
    if (result.success) {
        return success(result.data.json());
    }
    return result;
}
