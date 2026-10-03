// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Express } from "express";
import {
    browserViews,
    isRetiredBrowserView,
    type BrowserViewName,
} from "@typeagent/browser-control-rpc/viewRoutes";

export function registerBrowserNavigationRoutes(app: Express): void {
    for (const name of Object.keys(browserViews) as BrowserViewName[]) {
        const view = browserViews[name];
        const retired = isRetiredBrowserView(name);
        const paths = [
            view.path,
            `/views/${view.page}`,
            `/${view.page}`,
            ...(retired ? [`/library/${view.page}`] : []),
        ];
        app.get(paths, (req, res) => {
            const question = req.originalUrl.indexOf("?");
            const query =
                question === -1 ? "" : req.originalUrl.slice(question);
            if (retired) {
                // HTTP cannot read fragments. The Hub translates them after navigation.
                const marker = `${query ? "&" : "?"}legacyView=${name}`;
                res.redirect(302, `/library/memoryHub.html${query}${marker}`);
            } else {
                res.redirect(302, `/library/${view.page}${query}`);
            }
        });
    }
}
