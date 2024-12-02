// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface PolitenessGeneralization {
    // polite prefix that can be added to the start of the original request.
    // Keep this empty if there are already politeness terms at the start of the original request.
    politePrefixes: string[];
    // polite prefix that can be added to the end of the original request
    // Keep this empty if there are already politeness terms at the start of the original request.
    politeSuffixes: string[];
}
