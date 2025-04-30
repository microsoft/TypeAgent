// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { TypeChatLanguageModel } from "typechat";

export type FileSaveSettings = {
    dirPath: string;
    baseFileName: string;
};

export interface MemorySettings {
    conversationSettings: kp.ConversationSettings;
    languageModel: TypeChatLanguageModel;
    queryTranslator?: kp.SearchQueryTranslator | undefined;
    fileSaveSettings?: FileSaveSettings | undefined;
}
