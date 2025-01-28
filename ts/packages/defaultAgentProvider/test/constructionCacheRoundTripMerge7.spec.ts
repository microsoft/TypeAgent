// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineRoundtripTest } from "./constructionCacheTestCommon.js";

defineRoundtripTest(true, import.meta.url);
