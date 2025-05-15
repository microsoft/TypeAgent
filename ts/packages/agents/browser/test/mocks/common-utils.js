// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
    WebSocketMessageV2: class WebSocketMessageV2 {
        constructor(data) {
            Object.assign(this, data);
        }
    },
};
