// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ClientAPI } from "../../preload/electronTypes";
import { defaultTidyTreeConfig, TidyTree, TidyTreeConfigType } from "./visualizations/tidyTree";

function getClientAPI(): ClientAPI {
    return globalThis.api;
}

function addEvents(wrapper: HTMLElement, tidyTree: TidyTree) {
    const api = getClientAPI();
    api.onUpdateListVisualization(
        (
            _,
            data: any,
        ) => {
            wrapper.removeChild(wrapper.childNodes[0]);
            tidyTree.update(data);
            wrapper.append(tidyTree.tree!);
        },
    );
}

document.addEventListener("DOMContentLoaded", function () {

    const wrapper = document.getElementById("wrapper")!;

    const treeConfig: TidyTreeConfigType = defaultTidyTreeConfig;

    treeConfig.label = d => d.name ? d.name : d;
    treeConfig.title = (data, n) => { console.log(data); return `${n.ancestors().reverse().map(d => d.data.name).join(".")}` };
    treeConfig.children = d => d.items;
    
    const tidyTree: TidyTree = new TidyTree({name: "empty list", items: []}, treeConfig);

    wrapper.append(tidyTree.tree!);

    addEvents(wrapper, tidyTree);

    //(window as any).electron.ipcRenderer.send("dom ready");
});