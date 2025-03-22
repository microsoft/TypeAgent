// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { SearchInput } from "./searchInput";
import { ChangeTitleAction, ListPhotosAction, SelectPhotosAction } from "../agent/montageActionSchema.js";

//const eventSource = new EventSource("/events");

export type Message = {
    type: "listPhotos";
}

export type ListPhotosMessage = Message & {
    files: string[];
};

document.addEventListener("DOMContentLoaded", function () {
    const mainContainer = document.getElementById("mainContainer");
    const imgMap: Map<string, HTMLImageElement> = new Map<string, HTMLImageElement>();
    const selected: Set<string> = new Set<string>();

    // setup event source from host source (shell, etc.)
    const eventSource = new EventSource("/events");
    eventSource.onmessage = function (event: MessageEvent) {        
        const e = JSON.parse(event.data);
        console.log(e);
        switch (e.actionName) {

            case "listPhotos": {
                const msg: ListPhotosAction = e as ListPhotosAction;

                if (msg.parameters.files) {
                    msg.parameters.files.forEach((f) => {
                        const img: HTMLImageElement = document.createElement("img");
                        img.src = "/thumbnail?path=" + f;
                        img.setAttribute("path", f);

                        mainContainer.append(img);

                        imgMap.set(f, img);
                    });
                }
                
                break;
            }

            case "changeTitle": {
                const msg: ChangeTitleAction = e as ChangeTitleAction;
                const title: HTMLElement = document.getElementById("title");
                title.innerHTML = msg.parameters.title;
                break;
            }

            case "selectPhotos": {
                const msg: SelectPhotosAction = e as SelectPhotosAction;
                // select image by indicies first
                if (msg.parameters.indicies) {
                    for(let i = 0; i < msg.parameters.indicies.length; i++) {
                        mainContainer.children[msg.parameters.indicies[i]].classList.add("selected");
                        selected.add(mainContainer.children[msg.parameters.indicies[i]].getAttribute("path"))
                    }
                }

                // select specifically mentioned images
                if (msg.parameters.files) {
                    console.log("Selecting images: " + msg.parameters.files);
                    for(let i = 0; i < msg.parameters.files.length; i++) {
                        if (imgMap.has(msg.parameters.files[i])) {
                            imgMap.get(msg.parameters.files[i]).classList.add("selected");
                            selected.add(msg.parameters.files[i]);
                        }
                    }
                }

                // remove or add "unselected" as needed
                if (selected.size > 0) {
                    for (let i = 0; i < mainContainer.children.length; i++) {
                        if (selected.has(mainContainer.children[i].getAttribute("path"))) {
                            mainContainer.children[i].classList.remove("unselected");
                        } else {
                            mainContainer.children[i].classList.add("unselected");
                        }
                    } 
                }

                break;
            }

            case "clearSelectedPhotos": {

                selected.clear();

                for (let i = 0; i < mainContainer.children.length; i++) {
                    mainContainer.children[i].classList.remove("selected");
                    mainContainer.children[i].classList.remove("unselected");
                }                
                break;
            }
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