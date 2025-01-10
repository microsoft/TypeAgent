// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "assert";
import { TypeAgentServer } from "../src/typeAgentServer.js";
import findConfig from "find-config";

describe.skip("api web/ws server", () => {
    it("verify web server respnses", async () => {
        const envPath = findConfig(".env");
        if (envPath !== null) {
            assert(envPath, ".env file not found!");
            const typeAgentServer: TypeAgentServer = new TypeAgentServer(
                envPath!,
            );
            await typeAgentServer.start();

            let response = await fetch("http://localhost:3000/");
            expect(response.ok);

            response = await fetch("http://localhost:3000/index.html");
            expect(response.ok);

            response = await fetch("http://localhost:3000/sdfadfs.asdfsdf");
            expect(response.status == 404);

            typeAgentServer.stop();
        } else {
            console.warn(
                "Skipping test 'verify web server respnses', no .env file!",
            );
        }
    });
});
