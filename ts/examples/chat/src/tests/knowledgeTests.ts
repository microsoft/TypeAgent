// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { generateTimestampString } from "typeagent";
import * as knowLib from "knowledge-processor";
import { StopWatch } from "interactive-app";
import chalk from "chalk";

export function logTiming(clock: StopWatch) {
    console.log(chalk.greenBright(clock.elapsedString()));
}

export function testPostings() {
    const x = knowLib.sets.createPostings([1, 2, 3, 4, 5, 6, 3, 4]);
    const y = knowLib.sets.createPostings([5, 6, 1, 3, 5]);
    const z = knowLib.sets.intersect(
        knowLib.sets.unique(x.values()),
        knowLib.sets.unique(y.values()),
    );
    console.log("Intersect");
    for (const value of z) {
        console.log(value);
    }

    console.log("Union");
    const t = knowLib.sets.union(
        knowLib.sets.unique(x.values()),
        knowLib.sets.unique(y.values()),
    );
    for (const value of t) {
        console.log(value);
    }
}

export function testTimestamp() {
    const date = new Date();
    const clock = new StopWatch();
    const count = 10000;
    let a: string = "";
    clock.start();
    for (let i = 0; i < count; ++i) {
        a = generateTimestampString(date);
    }
    clock.stop();
    console.log(a);
    console.log(clock.elapsedString());

    clock.start();
    for (let i = 0; i < count; ++i) {
        const year = date.getUTCFullYear().toString();
        const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
        const day = date.getUTCDate().toString().padStart(2, "0");
        const hour = date.getUTCHours().toString().padStart(2, "0");
        const minute = date.getUTCMinutes().toString().padStart(2, "0");
        const seconds = date.getUTCSeconds().toString().padStart(2, "0");
        const ms = date.getUTCMilliseconds().toString().padStart(3, "0");
        a = `${year}${month}${day}${hour}${minute}${seconds}${ms}`;
    }
    clock.stop();
    console.log(a);
    console.log(clock.elapsedString());
}
export async function runKnowledgeTests() {
    testTimestamp();
    testPostings();
}
