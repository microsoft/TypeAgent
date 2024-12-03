// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class MetricsView {
    private mainContainer: HTMLDivElement;

    constructor() {
        this.mainContainer = document.createElement("div");
        this.mainContainer.className = "metrics";

        this.mainContainer.innerHTML = `<div style="text-align: center; font-size: 64px;">🚧</div>`;

        this.updateMetrics();
    }

    updateMetrics() {
        for (let i = 0; i < 0; i++) {
            let metric = document.createElement("div");
            let label = document.createElement("div");
            let value = document.createElement("div");

            metric.className = "metric-row";

            label.innerText = `Label${i}`;
            label.className = "metric-label";

            value.innerText = `Value${i}`;

            metric.append(label);
            metric.append(value);

            this.mainContainer.append(metric);
        }
    }

    getContainer() {
        return this.mainContainer;
    }
}
