// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: "bdd", color: true, timeout: 30000 });

    const testsRoot = path.resolve(__dirname, ".");
    const files = await glob("**/*.test.js", { cwd: testsRoot });
    for (const f of files) {
        mocha.addFile(path.resolve(testsRoot, f));
    }

    await new Promise<void>((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}
