// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeAgent Studio never creates a MongoDB logger sink, but it imports the
// `@typeagent/telemetry` barrel for other symbols. That barrel statically
// re-exports `createMongoDBLoggerSink`, which statically imports the `mongodb`
// driver — pulling the entire driver (including its client-side-encryption
// crypto callbacks, whose PEM `-----BEGIN/END PRIVATE KEY-----` delimiters trip
// vsce's secret scanner) into the packaged bundle for no runtime benefit.
//
// The esbuild config aliases `mongodb` to this stub so the real driver never
// ships. The stub is a CJS module returning a self-referential Proxy, so any
// shape of import (`import mongodb`, `import { MongoClient }`, `import * as m`)
// resolves without a build error and is inert at module-init time. The Mongo
// sink code path that would touch these symbols is never reached in Studio.
const proxy = new Proxy(function mongodbStub() {}, {
    get() {
        return proxy;
    },
    apply() {
        return proxy;
    },
    construct() {
        return proxy;
    },
});

module.exports = proxy;
