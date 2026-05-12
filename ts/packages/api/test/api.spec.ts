// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeAgentServer } from "../src/typeAgentServer.js";

describe.skip("api web/ws server", () => {
    it("verify web server respnses", async () => {
        const typeAgentServer: TypeAgentServer = new TypeAgentServer();
        await typeAgentServer.start();

        let response = await fetch("http://localhost:3000/");
        expect(response.ok);

        response = await fetch("http://localhost:3000/index.html");
        expect(response.ok);

        response = await fetch("http://localhost:3000/sdfadfs.asdfsdf");
        expect(response.status == 404);

        typeAgentServer.stop();
    });
});
