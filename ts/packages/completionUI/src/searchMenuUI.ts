// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SearchMenuItem } from "agent-dispatcher/helpers/completion";

export type { SearchMenuItem };

export type SearchMenuPosition = {
    left: number;
    bottom: number;
};

export type SearchMenuUIUpdateData = {
    position?: SearchMenuPosition;
    prefix?: string;
    items?: SearchMenuItem[];
};

export interface SearchMenuUI {
    update(data: SearchMenuUIUpdateData): void;
    adjustSelection(deltaY: number): void;
    selectCompletion(): void;
    close(): void;
}
