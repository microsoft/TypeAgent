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
    // Returns true if a completion was accepted, false if no item was
    // selected (so callers can fall through to default key handling).
    selectCompletion(): boolean;
    close(): void;
}
