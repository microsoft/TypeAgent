// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ClientAPI } from "../../preload/electronTypes";
import { CollapsableContainer } from "./collapsableContainer";
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
    listsContainer: CollapsableContainer,
    tangledTreeContainer: CollapsableContainer,
    hierarchyContainer: CollapsableContainer,
    tidyTree: TidyTree,
    tangledTree: TangledTree,
    hierarchy: HierarchicalEdgeBundling
) {
    const api = getClientAPI();
    api.onUpdateListVisualization((_, data: any) => {
        listsContainer.chartContainer.innerHTML = "";
        tidyTree.update(data);
        listsContainer.chartContainer.append(tidyTree.tree!);
    });
    api.onUpdateKnowledgeVisualization((_, data: any) => {
        tangledTreeContainer.chartContainer.innerHTML = "";
        tangledTree.update(data);
        tangledTreeContainer.chartContainer.append(tangledTree.tree!);
    });
    api.onUpdateKnowledgeHierarchyVisualization((_, data: any) => {
        hierarchyContainer.chartContainer.innerHTML = "";
        hierarchy.update(data);
        hierarchyContainer.chartContainer.append(hierarchy.chart!);
    });
}

document.addEventListener("DOMContentLoaded", function () {
    const mainContainer = document.getElementById("mainContainer");
    const listsContainer: CollapsableContainer = new CollapsableContainer("Lists");
    const tangledTreeContainer: CollapsableContainer = new CollapsableContainer("Tangled Tree");
    const hierarchyContainer: CollapsableContainer = new CollapsableContainer("Knowledge Network");
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

    const tangledTree: TangledTree = new TangledTree([]);
    const hierarchy: HierarchicalEdgeBundling = new HierarchicalEdgeBundling([]);

    mainContainer!.appendChild(listsContainer.div);
    mainContainer!.appendChild(tangledTreeContainer.div);
    mainContainer!.appendChild(hierarchyContainer.div);
        
    listsContainer.chartContainer.append(tidyTree.tree!);
    tangledTreeContainer.chartContainer.append(tangledTree.tree!);
    hierarchyContainer.chartContainer.append(hierarchy.chart!);

    addEvents(listsContainer, tangledTreeContainer, hierarchyContainer, tidyTree, tangledTree, hierarchy);

    (window as any).electron.ipcRenderer.send("dom ready");
});
