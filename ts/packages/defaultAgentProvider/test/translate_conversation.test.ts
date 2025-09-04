// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*
 * NOTE: This test has the extension .test.ts and not .spec.ts.
 * *.test.ts files are run under test:live && test:live:debug
 * project settings (see ../package.json).  The assumption is
 * test:live has API endpoints where as test:local tests run
 * wholly locally.
 */

import { defineTranslateTest } from "./translateTestCommon.js";
const dataFiles = ["test/data/translate-conversation-e2e.json"];

await defineTranslateTest("translate conversation", dataFiles);