// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class TabView {
    private mainContainer: HTMLDivElement;
    private tabContainer: HTMLDivElement;
    private tabs: HTMLDivElement[];
    private tabPages: HTMLDivElement[];

    constructor(tabNames: string[], icons: HTMLElement[]) {
        this.mainContainer = document.createElement("div");
        this.tabContainer = document.createElement("div");
        this.tabContainer.className = "shadeContainer";
        this.mainContainer.append(this.tabContainer);

        this.tabs = new Array(tabNames.length);
        this.tabPages = new Array(tabNames.length);

        for(let i: number = 0; i < tabNames.length; i++) {

            let tabDiv = document.createElement("div");
            let tabPageDiv = document.createElement("div");
            this.tabs[i] = tabDiv;
            this.tabPages[i] = tabPageDiv;

            tabDiv.className = `shade shade${i}`;

            let tabPageContents = document.createElement("div");
            tabPageContents.className = "tabPageContents";
            tabPageDiv.append(tabPageContents);

            let tabTitle = document.createElement("div");
            tabTitle.innerText = tabNames[i];
            tabDiv.append(tabTitle);
            
            tabDiv.onclick = () => {
                console.log(`${tabDiv.innerText} clicked`);
                if (tabPageDiv.classList.contains("closedTab")) {
                    tabPageDiv.classList.remove("closedTab");
                } else  {
                    tabPageDiv.classList.add("closedTab");
                }

                for (let j = 0; j < this.tabPages.length; j++) {
                    if (this.tabPages[j] != tabPageDiv) {
                        this.tabPages[j].classList.add("closedTab");
                    }
                }
            }

            // tabPageDiv.onmouseout = () => {
            //     console.log(`${tabDiv.innerText} onmouseout`);
            //     tabPageDiv.classList.add("closedTab");
            // }

            
            this.tabContainer.append(tabDiv);

            tabPageDiv.id = `_tabPage_${i}`;
            tabPageDiv.className = `tabPage shade${i} closedTab`;

            let closeButton = document.createElement("input");
            closeButton.type = "button";
            closeButton.value = "X";
            closeButton.title = `Close ${tabNames[i]} tab`
            closeButton.className = "closeButton";

            closeButton.onclick = () => {
                tabPageDiv.classList.add("closedTab");
            }

            let title = document.createElement("div");
            icons[i].className = "shadeIcon";
            title.append(icons[i]);

            let titleText = document.createElement("div");
            titleText.innerText = tabNames[i];
            titleText.className = "titleText";
            title.className = "title";
            title.append(titleText);
                        
            tabPageContents.append(closeButton);
            tabPageContents.append(title);

            this.mainContainer.append(tabPageDiv);
        }
    }

    getContainer() {
        return this.mainContainer;
    }

    // getSettingsTab() {
    //     return this;
    // }

    // getMetricsTab() {
    //     return this.metricsTab;
    // }

    // getHelpTab() {
    //     return this.helpTab;
    // }
}
