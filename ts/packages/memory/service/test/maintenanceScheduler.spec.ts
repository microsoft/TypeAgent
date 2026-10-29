// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setTimeout as delay } from "node:timers/promises";
import { MaintenanceScheduler } from "../src/maintenanceScheduler.js";
import {
    createMaintenanceBuildScheduler,
    yieldMaintenanceBuild,
} from "../src/maintenanceConcurrency.js";

test("a passive callback reacquires capacity before continuing after its build returns", async () => {
    const scheduler = new MaintenanceScheduler(() => false, "manual");
    let finishBuild!: () => void;
    const build = new Promise<void>((resolve) => {
        finishBuild = resolve;
    });
    let finishBorrower!: () => void;
    const borrowed = new Promise<void>((resolve) => {
        finishBorrower = resolve;
    });
    let borrowerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        borrowerStarted = resolve;
    });
    const order: string[] = [];
    scheduler.request("first", "wiki", "v1", async () => {
        await scheduler.waitForBuild(() => build);
        order.push("first-resumed");
    });
    scheduler.request("second", "wiki", "v1", async () => {
        order.push("borrower-started");
        borrowerStarted();
        await borrowed;
        order.push("borrower-finished");
    });
    const draining = scheduler.drain(5000);
    try {
        await started;
        finishBuild();
        await new Promise((resolve) => setImmediate(resolve));
        expect(order).toEqual(["borrower-started"]);
        finishBorrower();
        expect((await draining).settled).toBe(true);
        expect(order).toEqual([
            "borrower-started",
            "borrower-finished",
            "first-resumed",
        ]);
    } finally {
        finishBuild();
        finishBorrower();
        await scheduler.close();
        await draining;
    }
});

test("shutdown cancels a callback waiting to reacquire capacity", async () => {
    const scheduler = new MaintenanceScheduler(() => false, "manual");
    let finishBuild!: () => void;
    const build = new Promise<void>((resolve) => {
        finishBuild = resolve;
    });
    let borrowerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        borrowerStarted = resolve;
    });
    let resumed = false;
    scheduler.request("first", "wiki", "v1", async () => {
        await scheduler.waitForBuild(() => build);
        resumed = true;
    });
    scheduler.request("second", "wiki", "v1", async (signal) => {
        borrowerStarted();
        await delay(10_000, undefined, { signal });
    });
    const draining = scheduler.drain(5000);
    try {
        await started;
        finishBuild();
        await new Promise((resolve) => setImmediate(resolve));
        expect(resumed).toBe(false);
        await scheduler.close();
        expect(resumed).toBe(false);
        expect((await draining).failures.length).toBeGreaterThan(0);
    } finally {
        finishBuild();
        await scheduler.close();
        await draining;
    }
});

test("a pending dispatch timer rechecks capacity after a passive callback resumes", async () => {
    const scheduler = new MaintenanceScheduler(() => false, "manual");
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let resumed!: () => void;
    const ready = new Promise<void>((resolve) => {
        resumed = resolve;
    });
    let secondStarted = false;
    scheduler.request("first", "wiki", "v1", async () => {
        await scheduler.waitForBuild(async () => {
            scheduler.request("second", "wiki", "v1", async () => {
                secondStarted = true;
            });
        });
        resumed();
        await gate;
    });
    const draining = scheduler.drain(5000);
    try {
        await ready;
        await delay(350);
        expect(secondStarted).toBe(false);
        finish();
        expect((await draining).settled).toBe(true);
        expect(secondStarted).toBe(true);
    } finally {
        finish();
        await scheduler.close();
        await draining;
    }
});

test("automatic native waits let independent short work reach the build queue without releasing corpus exclusion", async () => {
    const scheduler = new MaintenanceScheduler(
        () => false,
        "manual",
        undefined,
        1,
        true,
    );
    const builds = createMaintenanceBuildScheduler(1, false, true);
    const order: string[] = [];
    let shortAdmitted!: () => void;
    const admitted = new Promise<void>((resolve) => {
        shortAdmitted = resolve;
    });
    scheduler.request(
        "native-corpus",
        "topics",
        "generation",
        async (signal) => {
            const build = builds(async () => {
                order.push("native-start");
                await admitted;
                order.push("durable");
                await yieldMaintenanceBuild(signal);
                order.push("native-resumed");
            }, true);
            await scheduler.waitForBuild(() => build);
        },
    );
    scheduler.request("native-corpus", "wiki", "generation", async () => {
        order.push("same-corpus");
    });
    scheduler.request("short-corpus", "wiki", "generation", async () => {
        const build = builds(async () => {
            order.push("short");
        }, false);
        shortAdmitted();
        await scheduler.waitForBuild(() => build);
    });
    try {
        const status = await scheduler.drain(5000);
        expect(status.settled).toBe(true);
        expect(order).toEqual([
            "native-start",
            "durable",
            "short",
            "native-resumed",
            "same-corpus",
        ]);
    } finally {
        await scheduler.close();
    }
});

test("automatic build waits retain the native and total admission bounds", async () => {
    const scheduler = new MaintenanceScheduler(
        () => false,
        "manual",
        undefined,
        2,
        true,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let filled!: () => void;
    const capacity = new Promise<void>((resolve) => {
        filled = resolve;
    });
    let native = 0;
    let entered = 0;
    for (let index = 0; index < 44; index++) {
        const family = index < 8 ? "topics" : "wiki";
        scheduler.request(`corpus-${index}`, family, "generation", async () => {
            if (family === "topics") native++;
            if (++entered === 32) filled();
            await scheduler.waitForBuild(() => gate);
        });
    }
    const drain = scheduler.drain(20000);
    try {
        await capacity;
        await delay(300);
        expect(entered).toBe(32);
        expect(native).toBe(2);
        expect(scheduler.status().running).toHaveLength(32);
        const status = scheduler.status();
        expect(
            status.pending.filter((key) => !status.running.includes(key)),
        ).toHaveLength(12);
        release();
        expect((await drain).settled).toBe(true);
    } finally {
        release();
        await scheduler.close();
        await drain;
    }
});

describe("coalesced maintenance execution", () => {
    test("quiet-period requests coalesce without delaying explicit drains", async () => {
        const scheduler = new MaintenanceScheduler(() => false);
        const calls: string[] = [];
        try {
            scheduler.request(
                "corpus",
                "topics",
                "old",
                async () => {
                    calls.push("old");
                },
                2000,
            );
            await delay(300);
            expect(calls).toEqual([]);
            scheduler.request(
                "corpus",
                "topics",
                "latest",
                async () => {
                    calls.push("latest");
                },
                2000,
            );
            expect((await scheduler.drain(1000)).settled).toBe(true);
            expect(calls).toEqual(["latest"]);
        } finally {
            await scheduler.close();
        }
    });

    test("nested foreground scopes retain only the latest generation", async () => {
        const scheduler = new MaintenanceScheduler(() => false);
        const first = scheduler.defer();
        const second = scheduler.defer();
        const calls: number[] = [];
        try {
            for (let generation = 0; generation < 100; generation++)
                scheduler.request(
                    "corpus",
                    "wiki",
                    String(generation),
                    async () => {
                        calls.push(generation);
                    },
                );
            expect(scheduler.status().pending).toEqual(["corpus:wiki"]);
            expect(scheduler.status().coalesced).toBe(99);
            first();
            first();
            expect((await scheduler.drain()).reason).toBe("paused");
            expect(calls).toEqual([]);
            second();
            expect((await scheduler.drain(2000)).settled).toBe(true);
            expect(calls).toEqual([99]);
        } finally {
            second();
            await scheduler.close();
        }
    });

    test("manual policy and active imports block all corpus families", async () => {
        let importing = true;
        const scheduler = new MaintenanceScheduler(() => importing, "manual");
        const calls: string[] = [];
        try {
            for (const corpus of ["earlier", "current"])
                for (const family of ["synopsis", "topics", "wiki", "projects"])
                    scheduler.request(
                        corpus,
                        family,
                        "generation",
                        async () => {
                            calls.push(`${corpus}:${family}`);
                        },
                    );
            await delay(300);
            expect(calls).toEqual([]);
            expect((await scheduler.drain(20)).settled).toBe(false);
            importing = false;
            expect((await scheduler.drain(4000)).settled).toBe(true);
            expect(calls).toHaveLength(8);
        } finally {
            await scheduler.close();
        }
    });

    test("invalidations during running work leave only one follow-up", async () => {
        const scheduler = new MaintenanceScheduler(() => false, "manual");
        let calls = 0;
        const latest = async () => {
            calls++;
        };
        scheduler.request("corpus", "wiki", "old", async () => {
            calls++;
            for (let index = 0; index < 100; index++)
                scheduler.request("corpus", "wiki", "latest", latest);
        });
        try {
            expect((await scheduler.drain(2000)).settled).toBe(true);
            expect(calls).toBe(2);
        } finally {
            await scheduler.close();
        }
    });

    test("unchanged failures are reported and retried only on changed generation", async () => {
        const scheduler = new MaintenanceScheduler(() => false, "manual");
        let calls = 0;
        const fail = async () => {
            calls++;
            throw new Error("offline failure");
        };
        try {
            scheduler.request("corpus", "wiki", "one", fail);
            const failed = await scheduler.drain(2000);
            expect(failed.settled).toBe(false);
            expect(failed.failures).toEqual([
                { key: "corpus:wiki", error: "offline failure" },
            ]);
            scheduler.request("corpus", "wiki", "one", fail);
            await scheduler.drain(50);
            expect(calls).toBe(1);
            scheduler.request("corpus", "wiki", "two", async () => {
                calls++;
            });
            expect((await scheduler.drain(2000)).settled).toBe(true);
            expect(calls).toBe(2);
        } finally {
            await scheduler.close();
        }
    });

    test("reported target failures stay visible without blocking a queued continuation", async () => {
        const scheduler = new MaintenanceScheduler(() => false, "manual");
        let calls = 0;
        scheduler.request("corpus", "wiki", "generation", async () => {
            calls++;
            scheduler.reportFailure(
                "corpus",
                "wiki",
                "target",
                "Target synthesis failed",
            );
            expect(scheduler.status().failures).toEqual([
                { key: "corpus:wiki:target", error: "Target synthesis failed" },
            ]);
            scheduler.request("corpus", "wiki", "generation", async () => {
                calls++;
                scheduler.reportFailure("corpus", "wiki", "target");
            });
        });
        try {
            expect((await scheduler.drain(2_000)).settled).toBe(true);
            expect(calls).toBe(2);
            expect(scheduler.status().failures).toEqual([]);
        } finally {
            await scheduler.close();
        }
    });

    test("reported exhausted targets do not spin or masquerade as a settled success", async () => {
        const scheduler = new MaintenanceScheduler(() => false, "manual");
        let calls = 0;
        scheduler.request("corpus", "wiki", "generation", async () => {
            calls++;
            scheduler.reportFailure(
                "corpus",
                "wiki",
                "target",
                "Retry budget exhausted",
            );
        });
        try {
            const status = await scheduler.drain(2_000);
            expect(status.settled).toBe(false);
            expect(status.pending).toEqual([]);
            expect(status.reason).toBeUndefined();
            expect(status.failures).toHaveLength(1);
            await scheduler.drain(100);
            expect(calls).toBe(1);
            scheduler.cancel("corpus", "wiki");
            expect(scheduler.status().failures).toEqual([]);
        } finally {
            await scheduler.close();
        }
    });

    test("budget deferral is visible and changed input becomes eligible", async () => {
        const scheduler = new MaintenanceScheduler(() => false, "manual");
        try {
            scheduler.request("corpus", "wiki", "one", async () => {
                scheduler.park("corpus", "wiki", "pass budget exhausted");
            });
            const parked = await scheduler.drain(2000);
            expect(parked.reason).toBe("budget");
            expect(parked.settled).toBe(false);
            expect(parked.deferred[0]?.reason).toBe("pass budget exhausted");
            scheduler.request("corpus", "wiki", "two", async () => {});
            expect((await scheduler.drain(2000)).settled).toBe(true);
        } finally {
            await scheduler.close();
        }
    });

    test("drain deadline reaches in-flight work and close cancels work", async () => {
        const scheduler = new MaintenanceScheduler(() => false, "manual");
        let aborted = false;
        scheduler.request("corpus", "synopsis", "one", async (signal) => {
            try {
                await delay(10_000, undefined, { signal });
            } finally {
                aborted = signal.aborted;
            }
        });
        try {
            const result = await scheduler.drain(400);
            expect(result.settled).toBe(false);
            await scheduler.close();
            expect(aborted).toBe(true);
        } finally {
            await scheduler.close();
        }
    });
});
