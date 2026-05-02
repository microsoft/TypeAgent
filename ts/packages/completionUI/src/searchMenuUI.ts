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
    // Scrolls the visible window of items without changing which item is
    // selected.  Used for mouse-wheel scrolling.  No-op for inline mode.
    scrollBy(deltaY: number): void;
    // Returns true if a completion was accepted, false if no item was
    // selected (so callers can fall through to default key handling).
    selectCompletion(): boolean;
    close(): void;
}
