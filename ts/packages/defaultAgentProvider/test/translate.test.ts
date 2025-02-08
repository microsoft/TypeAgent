// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineTranslateTest } from "./translateTestCommon.js";
const dataFiles = ["test/data/translate-e2e.json"];

await defineTranslateTest("translate (no history)", dataFiles);
