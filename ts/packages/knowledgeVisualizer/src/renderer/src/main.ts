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
import { WordCloud } from "./visualizations/wordCloud";

function getClientAPI(): ClientAPI {
    return globalThis.api;
}

function addEvents(
    listsContainer: CollapsableContainer,
    tangledTreeContainer: CollapsableContainer,
    hierarchyContainer: CollapsableContainer,
    wordCloud: CollapsableContainer,
    tidyTree: TidyTree,
    tangledTree: TangledTree,
    hierarchy: HierarchicalEdgeBundling,
    words: WordCloud,
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
    api.onUpdateWordCloud((_, data: any) => {
        wordCloud.chartContainer.innerHTML = "";
        words.update(data);
        wordCloud.chartContainer.append(words.chart!);
    });
}

document.addEventListener("DOMContentLoaded", function () {
    const mainContainer = document.getElementById("mainContainer");
    const listsContainer: CollapsableContainer = new CollapsableContainer(
        "Lists",
    );
    const tangledTreeContainer: CollapsableContainer = new CollapsableContainer(
        "Tangled Tree",
    );
    const hierarchyContainer: CollapsableContainer = new CollapsableContainer(
        "Knowledge Network",
    );
    const wordCloudContainer: CollapsableContainer = new CollapsableContainer(
        "Word Cloud",
    );
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
    const hierarchy: HierarchicalEdgeBundling = new HierarchicalEdgeBundling(
        [],
    );
    const wordCloud: WordCloud = new WordCloud("");

    mainContainer!.appendChild(listsContainer.div);
    mainContainer!.appendChild(tangledTreeContainer.div);
    mainContainer!.appendChild(hierarchyContainer.div);
    mainContainer!.appendChild(wordCloudContainer.div);

    listsContainer.chartContainer.append(tidyTree.tree!);
    tangledTreeContainer.chartContainer.append(tangledTree.tree!);
    hierarchyContainer.chartContainer.append(hierarchy.chart!);
    wordCloudContainer.chartContainer.append(wordCloud.chart!);

    addEvents(
        listsContainer,
        tangledTreeContainer,
        hierarchyContainer,
        wordCloudContainer,
        tidyTree,
        tangledTree,
        hierarchy,
        wordCloud,
    );

    (window as any).electron.ipcRenderer.send("dom ready");
});
