// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SearchInput } from "./searchInput";

//const eventSource = new EventSource("/events");

document.addEventListener("DOMContentLoaded", function () {
    const mainContainer = document.getElementById("mainContainer");
    const searchInput = new SearchInput();

    mainContainer.append(searchInput.container);
//     const listsContainer: CollapsableContainer = new CollapsableContainer(
//         "Lists",
//     );
//     const tangledTreeContainer: CollapsableContainer = new CollapsableContainer(
//         "Tangled Tree",
//     );
//     const hierarchyContainer: CollapsableContainer = new CollapsableContainer(
//         "Knowledge Network",
//     );
//     const wordCloudContainer: CollapsableContainer = new CollapsableContainer(
//         "Word Cloud",
//     );
//     const treeConfig: TidyTreeConfigType = defaultTidyTreeConfig;

//     treeConfig.label = (d) => (d.name ? d.name : d);
//     treeConfig.title = (_, n) => {
//         return `${n
//             .ancestors()
//             .reverse()
//             .map((d: { data: { name: any } }) => d.data.name)
//             .join(".")}`;
//     };
//     treeConfig.children = (d) => d.items;

//     const tidyTree: TidyTree = new TidyTree(
//         { name: "empty list", items: [] },
//         treeConfig,
//     );

//     const tangledTree: TangledTree = new TangledTree([]);
//     const hierarchy: HierarchicalEdgeBundling = new HierarchicalEdgeBundling(
//         [],
//     );
//     const wordCloud: WordCloud = new WordCloud("");

//     mainContainer!.appendChild(listsContainer.div);
//     mainContainer!.appendChild(tangledTreeContainer.div);
//     mainContainer!.appendChild(hierarchyContainer.div);
//     mainContainer!.appendChild(wordCloudContainer.div);

//     listsContainer.chartContainer.append(tidyTree.tree!);
//     tangledTreeContainer.chartContainer.append(tangledTree.tree!);
//     hierarchyContainer.chartContainer.append(hierarchy.chart!);
//     wordCloudContainer.chartContainer.append(wordCloud.chart!);

//     addEvents(
//         listsContainer,
//         tangledTreeContainer,
//         hierarchyContainer,
//         wordCloudContainer,
//         tidyTree,
//         tangledTree,
//         hierarchy,
//         wordCloud,
//     );

//     fetch("/initializeData");
});
