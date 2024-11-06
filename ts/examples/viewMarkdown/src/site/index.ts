// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

document.addEventListener("DOMContentLoaded", () => {
    const eventSource = new EventSource("/events");
    const mermaid = (window as any).mermaid;

    eventSource.onmessage = function (event: MessageEvent) {
        const contentElement = document.getElementById("content");
        if (contentElement) {
            contentElement.innerHTML = decodeURIComponent(event.data);
            mermaid.init(
                undefined,
                contentElement.querySelectorAll(".mermaid"),
            );

            processGeoJson(contentElement);
        }
    };

    fetch("/preview")
        .then((response) => response.text())
        .then((content) => {
            const contentElement = document.getElementById("content");
            if (contentElement) {
                contentElement.innerHTML = content;
                mermaid.init(
                    undefined,
                    contentElement.querySelectorAll(".mermaid"),
                );

                processGeoJson(contentElement);
            }
        });

    function processGeoJson(contentElement: HTMLElement) {
        const L = (window as any).L;
        const nodes = Array.from(contentElement.querySelectorAll(".geojson"));

        for (const node of nodes) {
            try {
                const mapId = node.id;
                const mapContent = node.innerHTML;
                const geojson = JSON.parse(mapContent);
                node.innerHTML = "";

                const map = L.map(mapId).setView(
                    [
                        geojson.features[0].geometry.coordinates[1],
                        geojson.features[0].geometry.coordinates[0],
                    ],
                    10,
                ); // Set initial view

                L.tileLayer(
                    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    {
                        maxZoom: 19,
                        attribution: "© OpenStreetMap",
                    },
                ).addTo(map);

                // Add GeoJSON layer
                L.geoJSON(mapContent).addTo(map);
            } catch {}
        }
    }
});
