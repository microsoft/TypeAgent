// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElectronWindowFields } from "./electron-types";

declare global {
    interface Window extends ElectronWindowFields {}
}
