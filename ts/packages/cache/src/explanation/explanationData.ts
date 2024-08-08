// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONAction } from "./requestAction.js";

export type ExplanationDataEntry<T extends object = object> = {
    request: string;
    action: JSONAction | JSONAction[];
    explanation: T;
};

export type ExplanationData<T extends object = object> = {
    translatorName: string;
    explainerName: string;
    entries: ExplanationDataEntry<T>[];
};
