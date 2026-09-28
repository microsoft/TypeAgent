// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const http = require("node:http");
const index = process.argv.indexOf("--port");
const port = index < 0 ? 18999 : Number(process.argv[index + 1]);
const request = http.get(`http://127.0.0.1:${port}/stop`, (response) =>
    response.resume(),
);
request.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
});
request.setTimeout(5000, () =>
    request.destroy(new Error("shutdown timed out")),
);
