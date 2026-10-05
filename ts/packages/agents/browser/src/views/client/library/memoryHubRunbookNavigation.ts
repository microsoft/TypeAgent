// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RunbookDetailRequest,
    RunbookSummary,
} from "@typeagent/browser-control-rpc/viewRpc";

function sameObject(
    left: RunbookDetailRequest | undefined,
    right: RunbookDetailRequest | undefined,
) {
    return Boolean(
        left &&
            right &&
            left.corpusId === right.corpusId &&
            left.kind === right.kind &&
            left.objectId === right.objectId,
    );
}
export function createRunbookNavigation() {
    let entries: RunbookDetailRequest[] = [];
    let selected: RunbookDetailRequest | undefined;
    let position = -1;
    function open(request: RunbookDetailRequest, preferredPosition?: number) {
        selected = { ...request };
        if (
            preferredPosition !== undefined &&
            sameObject(entries[preferredPosition], request)
        )
            position = preferredPosition;
        else if (!sameObject(entries[position], request))
            position = entries.findIndex((entry) => sameObject(entry, request));
    }
    function adjacent(direction: -1 | 1) {
        if (position < 0) return undefined;
        for (
            let index = position + direction;
            index >= 0 && index < entries.length;
            index += direction
        ) {
            if (!sameObject(entries[index], selected))
                return { request: { ...entries[index] }, position: index };
        }
        return undefined;
    }
    return {
        get hasPosition() {
            return position >= 0;
        },
        load(items: RunbookSummary[]) {
            entries = items.map((item) => ({
                corpusId: item.corpusId,
                kind: item.kind,
                objectId: item.objectId,
            }));
            position = -1;
            if (selected) open(selected);
        },
        open,
        adjacent,
        replace(request: RunbookDetailRequest) {
            if (position >= 0)
                entries[position] = {
                    corpusId: request.corpusId,
                    kind: request.kind,
                    objectId: request.objectId,
                };
            selected = { ...request };
        },
        remove() {
            if (position < 0) return undefined;
            const removedPosition = position;
            entries.splice(position, 1);
            position = -1;
            selected = undefined;
            const nextPosition =
                removedPosition < entries.length
                    ? removedPosition
                    : entries.length - 1;
            return nextPosition >= 0
                ? {
                      request: { ...entries[nextPosition] },
                      position: nextPosition,
                  }
                : undefined;
        },
        clearSelection() {
            selected = undefined;
            position = -1;
        },
        reset() {
            entries = [];
            selected = undefined;
            position = -1;
        },
    };
}
