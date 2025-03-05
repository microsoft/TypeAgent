// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineTranslateTest } from "./translateTestCommon.js";
const dataFiles = ["test/data/translate-image-history-e2e.json"];
await defineTranslateTest("translate image request (w/history)", dataFiles);
