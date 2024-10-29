// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeAgentServer } from "../src/typeAgentServer.js";

describe("api web/ws server", () => {
    const envPath = new URL("../../../.env", import.meta.url);
    const typeAgentServer: TypeAgentServer = new TypeAgentServer(envPath);
    typeAgentServer.start();

    it("verify 200", async () => {
        let response = await fetch("http://localhost:3000/");
        expect(response.ok);

        response = await fetch("http://localhost:3000/index.html");
        expect(response.ok);
    })

    typeAgentServer.stop();
});