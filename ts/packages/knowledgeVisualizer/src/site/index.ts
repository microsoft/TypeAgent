// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CollapsableContainer } from "./collapsableContainer";
import { HierarchicalEdgeBundling } from "./visualizations/hierarchicalEdgeBundling";
import { TangledTree } from "./visualizations/tangledTree";
import {
    defaultTidyTreeConfig,
    TidyTree,
    TidyTreeConfigType,
} from "./visualizations/tidyTree";
import { WordCloud } from "./visualizations/wordCloud";

const eventSource = new EventSource("/events");

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
    eventSource.addEventListener("updateListVisualization", (event) => {
        const data = JSON.parse(event.data);
        listsContainer.chartContainer.innerHTML = "";
        tidyTree.update(data);
        listsContainer.chartContainer.append(tidyTree.tree!);
    });

    eventSource.addEventListener("updateKnowledgeVisualization", (event) => {
        const data = JSON.parse(event.data);
        tangledTreeContainer.chartContainer.innerHTML = "";
        tangledTree.update(data);
        tangledTreeContainer.chartContainer.append(tangledTree.tree!);
    });

    eventSource.addEventListener(
        "updateKnowledgeHierarchyVisualization",
        (event) => {
            const data = JSON.parse(event.data);
            hierarchyContainer.chartContainer.innerHTML = "";
            hierarchy.update(data);
            hierarchyContainer.chartContainer.append(hierarchy.chart!);
        },
    );

    eventSource.addEventListener("updateWordCloud", (event) => {
        const data = JSON.parse(event.data);
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
            .map((d: { data: { name: any } }) => d.data.name)
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

    fetch("/initializeData");
});
