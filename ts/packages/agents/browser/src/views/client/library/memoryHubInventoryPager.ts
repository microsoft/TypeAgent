// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { InventoryPageRequest } from "@typeagent/memory-service";
import { rbIconButton, rbNode } from "./memoryHubDocumentUi";

export class MemoryHubInventoryPager {
    private tokens = new Map<string, string | null>();
    private previous: Map<string, string | null>[] = [];
    private next = new Map<string, string | null>();
    private totals = new Map<string, number>();

    public reset() {
        this.tokens.clear();
        this.previous = [];
        this.next.clear();
        this.totals.clear();
    }
    public includes(corpusId: string) {
        return this.tokens.get(corpusId) !== null;
    }
    public request(corpusId: string): InventoryPageRequest {
        const token = this.tokens.get(corpusId);
        return {
            corpusId,
            pageSize: 25,
            ...(token ? { continuationToken: token } : {}),
        };
    }
    public update(
        pages: Array<{
            corpusId: string;
            total: number;
            nextContinuationToken?: string;
        }>,
    ) {
        this.next = new Map(this.tokens);
        for (const page of pages) {
            this.totals.set(page.corpusId, page.total);
            this.next.set(page.corpusId, page.nextContinuationToken ?? null);
        }
    }
    public get total() {
        return [...this.totals.values()].reduce((sum, count) => sum + count, 0);
    }
    public get hasNext() {
        return [...this.next.values()].some((token) => token !== null);
    }
    public controls(label: string, reload: () => void): HTMLElement {
        const nav = rbNode("nav", undefined, "hub-pager");
        nav.setAttribute("aria-label", `${label} pages`);
        const back = rbIconButton(
            "fa-chevron-left",
            `Previous ${label} page`,
            () => {
                const prior = this.previous.pop();
                if (!prior) return;
                back.disabled = forward.disabled = true;
                this.tokens = prior;
                reload();
            },
        );
        back.disabled = !this.previous.length;
        const forward = rbIconButton(
            "fa-chevron-right",
            `Next ${label} page`,
            () => {
                if (!this.hasNext) return;
                back.disabled = forward.disabled = true;
                this.previous.push(new Map(this.tokens));
                this.tokens = new Map(this.next);
                reload();
            },
        );
        forward.disabled = !this.hasNext;
        nav.append(
            back,
            rbNode(
                "span",
                `Page ${this.previous.length + 1} · up to 25 per collection`,
            ),
            forward,
        );
        return nav;
    }
}
