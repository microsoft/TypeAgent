// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ClientAPI } from "../../preload/electronTypes";
import { HierarchicalEdgeBundling } from "./visualizations/hierarchicalEdgeBundling";
import { TangledTree } from "./visualizations/tangledTree";
import {
    defaultTidyTreeConfig,
    TidyTree,
    TidyTreeConfigType,
} from "./visualizations/tidyTree";

function getClientAPI(): ClientAPI {
    return globalThis.api;
}

function addEvents(
    wrapper: HTMLElement,
    wrapper2: HTMLElement,
    wrapper5: HTMLElement,
    tidyTree: TidyTree,
    tangledTree: TangledTree,
    hierarchy: HierarchicalEdgeBundling
) {
    const api = getClientAPI();
    api.onUpdateListVisualization((_, data: any) => {
        wrapper.removeChild(wrapper.childNodes[0]);
        tidyTree.update(data);
        wrapper.append(tidyTree.tree!);
    });
    api.onUpdateKnowledgeVisualization((_, data: any) => {
        wrapper2.innerHTML = "";
        tangledTree.update(data);
        wrapper2.append(tangledTree.tree!);
    });
    api.onUpdateKnowledgeHierarchyVisualization((_, data: any) => {
        wrapper5.innerHTML = "";
        hierarchy.update(data);
        wrapper5.append(hierarchy.chart!);
    });
}

document.addEventListener("DOMContentLoaded", function () {
    const wrapper = document.getElementById("wrapper")!;
    const wrapper2 = document.getElementById("wrapper2")!;
    const wrapper5 = document.getElementById("wrapper5")!;

    const treeConfig: TidyTreeConfigType = defaultTidyTreeConfig;

    treeConfig.label = (d) => (d.name ? d.name : d);
    treeConfig.title = (_, n) => {
        return `${n
            .ancestors()
            .reverse()
            .map((d) => d.data.name)
            .join(".")}`;
    };
    treeConfig.children = (d) => d.items;

    const tidyTree: TidyTree = new TidyTree(
        { name: "empty list", items: [] },
        treeConfig,
    );

    wrapper.append(tidyTree.tree!);

    const tangledTree: TangledTree = new TangledTree([]);
    const hierarchy: HierarchicalEdgeBundling = new HierarchicalEdgeBundling([]);
    if (hierarchy.chart) {
        wrapper5.append(hierarchy.chart);
    } else {
        wrapper5.innerHTML = "";
    }

    addEvents(wrapper, wrapper2, wrapper5, tidyTree, tangledTree, hierarchy);

    (window as any).electron.ipcRenderer.send("dom ready");
});
