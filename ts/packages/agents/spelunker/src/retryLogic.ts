// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result } from "typechat";

import { console_log } from "./logging.js";

export async function retryOn429<T>(
    translate: () => Promise<Result<T>>,
    retries: number = 3,
    defaultDelay: number = 5000,
): Promise<T | undefined> {
    let wrappedResult: Result<T>;
    do {
        retries--;
        wrappedResult = await translate();
        // console_log(wrappedResult);
        if (!wrappedResult.success) {
            if (
                retries > 0 &&
                wrappedResult.message.includes("fetch error: 429:")
            ) {
                let delay = defaultDelay;
                const embeddingTime = wrappedResult.message.match(
                    /Try again in (\d+) seconds/,
                );
                const azureTime = wrappedResult.message.match(
                    /after (\d+) milliseconds/,
                );
                const openaiTime = wrappedResult.message.match(
                    /Please try again in (\d+\.\d*|\.\d+|\d+m)s./,
                );
                if (embeddingTime || azureTime || openaiTime) {
                    if (embeddingTime) {
                        delay = parseInt(embeddingTime[1]) * 1000;
                    } else if (azureTime) {
                        delay = parseInt(azureTime[1]);
                    } else if (openaiTime) {
                        delay = parseFloat(openaiTime[1]);
                        if (!openaiTime[1].endsWith("m")) {
                            delay *= 1000;
                        }
                    }
                } else {
                    console_log(
                        `      [Couldn't find msec in '${wrappedResult.message}'`,
                    );
                }
                console_log(`    [Retry on 429 error: sleep ${delay} ms]`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            console_log(`    [Giving up: ${wrappedResult.message}]`);
            return undefined;
        }
    } while (!wrappedResult.success);
    return wrappedResult.data;
}
