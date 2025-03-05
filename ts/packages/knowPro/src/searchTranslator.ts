// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    createJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { SearchFilter } from "./searchSchema.js";
import { loadSchema } from "typeagent";

export function createSearchTranslator(
    model: TypeChatLanguageModel,
): TypeChatJsonTranslator<SearchFilter> {
    const typeName = "SearchFilter";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", "searchSchema.ts"],
        import.meta.url,
    );

    const validator = createTypeScriptJsonValidator<SearchFilter>(
        searchActionSchema,
        typeName,
    );
    return createJsonTranslator<SearchFilter>(model, validator);
}
