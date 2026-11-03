// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface IndexWarmupJob {
    key: string;
    corpusId: string;
    run(priority: boolean): Promise<boolean>;
}

export class IndexWarmupScheduler {
    private readonly jobs = new Map<
        string,
        { job: IndexWarmupJob; priority: boolean }
    >();
    private readonly attempted = new Map<string, string>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private active: Promise<void> | undefined;
    private activeKey: string | undefined;
    private readonly epochs = new Map<string, number>();
    private discovery = Promise.resolve();
    private started = false;
    private stopped = false;
    private discoveredAll = false;
    private opened: string | undefined;
    private nextAt = 0;

    constructor(
        private readonly discover: (
            corpusId?: string,
        ) => Promise<IndexWarmupJob[]>,
        private readonly onError: (error: unknown, corpusId?: string) => void,
    ) {}

    start(): void {
        if (this.started || this.stopped) return;
        this.started = true;
        this.nextAt = Date.now() + 5_000;
        this.schedule();
    }

    open(corpusId: string): void {
        this.start();
        if (this.stopped || this.opened === corpusId) return;
        this.opened = corpusId;
        for (const [key, id] of this.attempted)
            if (id === corpusId && key !== this.activeKey)
                this.attempted.delete(key);
        for (const entry of this.jobs.values())
            entry.priority = entry.job.corpusId === corpusId;
        this.discoverJobs(corpusId, true);
    }

    refresh(corpusId: string): void {
        if (this.started && !this.stopped) this.discoverJobs(corpusId);
    }

    invalidate(corpusId: string): void {
        this.epochs.set(corpusId, (this.epochs.get(corpusId) ?? 0) + 1);
        for (const [key, entry] of this.jobs)
            if (entry.job.corpusId === corpusId) this.jobs.delete(key);
        for (const [key, id] of this.attempted)
            if (id === corpusId) this.attempted.delete(key);
        if (this.opened === corpusId) this.opened = undefined;
    }

    private schedule(): void {
        clearTimeout(this.timer);
        if (this.stopped) return;
        this.timer = setTimeout(
            () => {
                this.timer = undefined;
                if (this.active) return;
                if (!this.discoveredAll) {
                    this.discoveredAll = true;
                    this.discoverJobs(undefined);
                } else this.pump();
            },
            Math.max(0, this.nextAt - Date.now()),
        );
        this.timer.unref();
    }

    private discoverJobs(
        corpusId: string | undefined,
        immediate = false,
    ): void {
        this.discovery = this.discovery
            .then(async () => {
                if (this.stopped) return;
                const epochs = new Map(this.epochs);
                const jobs = await this.discover(corpusId);
                if (this.stopped) return;
                for (const job of jobs)
                    if (
                        !this.attempted.has(job.key) &&
                        job.key !== this.activeKey &&
                        epochs.get(job.corpusId) ===
                            this.epochs.get(job.corpusId)
                    )
                        this.jobs.set(job.key, {
                            job,
                            priority: job.corpusId === this.opened,
                        });
                if (immediate || Date.now() >= this.nextAt) this.pump();
                else if (!this.active && this.jobs.size) this.schedule();
            })
            .catch((error: unknown) => this.onError(error, corpusId));
    }

    private pump(): void {
        if (this.stopped || this.active) return;
        const next =
            [...this.jobs.entries()].find(([, entry]) => entry.priority) ??
            this.jobs.entries().next().value;
        if (!next) return;
        const [key, { job, priority }] = next;
        this.jobs.delete(key);
        this.attempted.set(key, job.corpusId);
        this.activeKey = key;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.active = Promise.resolve()
            .then(() => job.run(priority))
            .then(() => undefined)
            .catch((error: unknown) => this.onError(error, job.corpusId))
            .finally(() => {
                this.active = undefined;
                this.activeKey = undefined;
                this.nextAt = Date.now() + 5_000;
                if (!this.stopped && (this.jobs.size || !this.discoveredAll))
                    this.schedule();
            });
    }

    async close(): Promise<void> {
        this.stopped = true;
        clearTimeout(this.timer);
        this.jobs.clear();
        await this.discovery;
        await this.active;
    }
}
