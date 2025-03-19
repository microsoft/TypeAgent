// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { SearchInput } from "./searchInput";

//const eventSource = new EventSource("/events");

export type Message = {
    type: "listPhotos";
}

export type ListPhotosMessage = Message & {
    files: string[];
};

document.addEventListener("DOMContentLoaded", function () {
    const mainContainer = document.getElementById("mainContainer");

    // setup event source from host source (shell, etc.)
    const eventSource = new EventSource("/events");
    eventSource.onmessage = function (event: MessageEvent) {
        console.log(event);
        const e = JSON.parse(event.data);
        if (e.type === "listPhotos") {
            const msg: ListPhotosMessage = e as ListPhotosMessage;

            msg.files.forEach((f) => {
                const img: HTMLImageElement = document.createElement("img");
                img.src = "/image?path=" + f;

                mainContainer.append(img);
            })
        }
        // const contentElement = document.getElementById("mainContainer");
        // if (contentElement) {
        //     contentElement.innerHTML += decodeURIComponent(event.data);
        //     // mermaid.init(
        //     //     undefined,
        //     //     contentElement.querySelectorAll(".mermaid"),
        //     // );

        //     // processGeoJson(contentElement);
        // }
    };

    //mainContainer.append(searchInput.container);
    //mainContainer.innerText = "Hello world";
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