// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ClientAPI } from "../../preload/electronTypes";
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
    tidyTree: TidyTree,
    tangledTree: TangledTree,
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
}

document.addEventListener("DOMContentLoaded", function () {
    const wrapper = document.getElementById("wrapper")!;
    const wrapper2 = document.getElementById("wrapper2")!;
    const wrapper3 = document.getElementById("wrapper3")!;

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

    let data = [
        [{ id: "session1 - knowledge" }],
        [
            {
                id: "2024_09_21_17_11_34_726",
                parents: ["session1 - knowledge"],
            },
            {
                id: "2024_09_21_17_08_21_185",
                parents: ["session1 - knowledge"],
            },
            {
                id: "2024_09_21_17_11_31_537",
                parents: ["session1 - knowledge"],
            },
        ],
        [
            {
                id: "topics",
                parents: [
                    "2024_09_21_17_11_34_726",
                    "2024_09_21_17_08_21_185",
                    "2024_09_21_17_11_31_537",
                ],
            },
            {
                id: "entities",
                parents: [
                    "2024_09_21_17_11_34_726",
                    "2024_09_21_17_08_21_185",
                    "2024_09_21_17_11_31_537",
                ],
            },
            {
                id: "actions",
                parents: ["2024_09_21_17_08_21_185", "2024_09_21_17_11_31_537"],
            },
        ],
        [
            { id: "retirement", parents: ["topics"] },
            { id: "gifts", parents: ["topics"] },
            { id: "personalization", parents: ["topics"] },

            { id: "footbal", parents: ["topics"] },
            { id: "sports", parents: ["topics"] },
            { id: "match", parents: ["topics"] },
            { id: "result", parents: ["topics"] },
            { id: "football", parents: ["topics"] },
            { id: "club", parents: ["entities"] },

            { id: "sports team", parents: ["entities"] },

            { id: "gift", parents: ["entities"] },
            { id: "object", parents: ["entities"] },

            { id: "team", parents: ["entities"] },
            { id: "athlete", parents: ["entities"] },
            { id: "person", parents: ["entities"] },

            { id: "play", parents: ["actions"] },
            { id: "win", parents: ["actions"] },
        ],

        [
            {
                id: "retirement gifts",
                parents: [
                    "gift",
                    "object",
                    "retirement",
                    "gifts",
                    "personalization",
                ],
            },
            {
                id: "manchester united",
                parents: [
                    "team",
                    "club",
                    "sports",
                    "win",
                    "football",
                    "sports",
                    "match",
                    "result",
                ],
            },

            { id: "bayern munich", parents: ["team", "sports team", "play"] },
            { id: "werder bremen", parents: ["team", "sports team", "play"] },

            { id: "michael olise", parents: ["athlete", "person"] },
            { id: "jamal musiala", parents: ["athlete", "person"] },
            { id: "harry kane", parents: ["athlete", "person"] },
            { id: "serge gnabry", parents: ["athlete", "person"] },
        ],

        [
            { id: "good", parents: ["retirement gifts"] },
            { id: "goals", parents: ["michael olise"] },
            { id: "assists", parents: ["michael olise"] },

            { id: "date", parents: ["bayern munich", "werder bremen"] },
            {
                id: "score",
                parents: [
                    "bayern munich",
                    "werder bremen",
                    "jamal musiala",
                    "harry kane",
                    "serge gnabry",
                ],
            },
        ],

        [
            { id: "5-0", parents: ["score"] },
            { id: "September 21, 2024", parents: ["date"] },
            { id: "2", parents: ["goals", "assists"] },
        ],
    ];

    const tangledTree: TangledTree = new TangledTree(data);
    wrapper3.append(tangledTree.tree!);

    addEvents(wrapper, wrapper2, tidyTree, tangledTree);

    //(window as any).electron.ipcRenderer.send("dom ready");
});
