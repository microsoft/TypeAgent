// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { iconCollapse, iconExpand } from "./icon";

export class CollapsableContainer {
    public div: HTMLDivElement;
    public expandButton: HTMLButtonElement;
    public collapseButton: HTMLButtonElement;
    public chartContainer: HTMLDivElement;
    public title: HTMLDivElement;

    constructor(chartName: string) {
        this.div = document.createElement("div");
        this.div.className = "chartContainer-collapsed";

        this.title = document.createElement("div");
        this.title.className = "chart-title";
        this.title.innerText = chartName;

        this.expandButton = document.createElement("button");
        this.expandButton.appendChild(iconExpand("white"));
        this.expandButton.className = "sizeButton";
        this.expandButton.onclick = () => {
            this.div.classList.remove("chartContainer-collapsed");
            this.div.classList.add("chartContainer-expanded");
            this.expandButton.classList.add("hidden");
            this.collapseButton.classList.remove("hidden");
        };

        this.collapseButton = document.createElement("button");
        this.collapseButton.appendChild(iconCollapse("white"));
        this.collapseButton.className = "sizeButton hidden";
        this.collapseButton.onclick = () => {
            this.div.classList.add("chartContainer-collapsed");
            this.div.classList.remove("chartContainer-expanded");
            this.collapseButton.classList.add("hidden");
            this.expandButton.classList.remove("hidden");
        };

        this.div.appendChild(this.expandButton);
        this.div.appendChild(this.collapseButton);
        this.div.append(this.title);
        this.chartContainer = document.createElement("div");
        this.div.appendChild(this.chartContainer);
    }
}
