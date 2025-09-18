// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SearchMenuItem,
    SearchMenuPosition,
    SearchMenuUIUpdateData,
} from "../../../preload/electronTypes";
export type { SearchMenuItem, SearchMenuPosition, SearchMenuUIUpdateData };

export interface SearchMenuUI {
    update(data: SearchMenuUIUpdateData): void;
    adjustSelection(deltaY: number): void;
    selectCompletion(): void;
    close(): void;
}
