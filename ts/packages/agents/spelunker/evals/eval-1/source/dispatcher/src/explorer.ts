// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getSessionNames,
    getSessionDirPath,
    getSessionsDirPath,
} from "./context/session.js";
import { getInstanceDir } from "./utils/userData.js";

export function getInstanceSessionNames() {
    return getSessionNames(getInstanceDir());
}

export function getInstanceSessionsDirPath() {
    return getSessionsDirPath(getInstanceDir());
}

export function getInstanceSessionDirPath(sessionName: string) {
    return getSessionDirPath(getInstanceDir(), sessionName);
}

export {
    getSessionConstructionDirPaths,
    getSessionConstructionDirPath,
} from "./context/session.js";
