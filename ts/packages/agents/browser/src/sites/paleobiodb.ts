// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {};

declare var taxaBrowser: any;
declare var timeScale: any;
declare var navMap: any;
declare var map: any;

function enablePaleoBioDbFilter(time: string, taxa: string) {
    if (time) {
        navMap.filterByTime(time);
        timeScale.goTo(time);
    }

    if (taxa) {
        navMap.filterByTaxon(taxa);
    }

    navMap.refresh("reset");
}

function clearPaleoBioDbFilter(time: boolean, taxa: boolean, all: boolean) {
    if (time || all) {
        const timeFilterControl = document.querySelector(
            "#selectedInterval > button",
        ) as HTMLButtonElement;
        if (timeFilterControl) {
            timeFilterControl.click();
            timeScale.goTo("Phanerozoic");
        }
    }

    if (taxa || all) {
        if (navMap.filters.exist.taxon) {
            navMap.filters.taxa.forEach((f: { name: string; id: any }) => {
                navMap.removeTaxonFilters([f.id]);
            });
        }
    }

    navMap.refresh("reset");
}

function zoomInOnPaleoBioDb() {
    const zoomInControl = document.querySelector(
        "#mapControls > div > div.zoom-in.mapCtrl",
    ) as HTMLDivElement;
    if (zoomInControl) {
        const event = new Event("tap", {
            bubbles: true,
            cancelable: true,
        });
        zoomInControl.dispatchEvent(event);
    }
}

function zoomOutOnPaleoBioDb() {
    const zoomOutControl = document.querySelector(
        "#mapControls > div > div.zoom-out.mapCtrl",
    ) as HTMLDivElement;
    if (zoomOutControl) {
        const event = new Event("tap", {
            bubbles: true,
            cancelable: true,
        });

        zoomOutControl.dispatchEvent(event);
    }
}

function panMapOnPaleoBioDb(direction: string) {
    const center = map.getCenter();
    switch (direction) {
        case "left":
            map.panBy([-200, 0]);
            break;
        case "right":
            map.panBy([200, 0]);
            break;
        case "up":
            map.panBy([0, -200]);
            break;
        case "down":
            map.panBy([0, 200]);
            break;
    }
}

function setMapLocation(latitude: number, longitude: number) {
    const zoomLevel = Math.max(8, map.getZoom());
    navMap.goTo([latitude, longitude], zoomLevel);
    navMap.refresh("reset");
}

function getPrevalentTaxons() {
    let taxonNames: string[] = [];
    const taxonList = document.querySelectorAll<Element>(
        "#graphics > div.col-sm-12.prevalence-row > div > div:nth-child(1) > p",
    );
    taxonList.forEach((el) => {
        taxonNames.push(el.innerHTML.split(" ")[0]);
    });

    return taxonNames;
}

function sendResponse(data: any) {
    document.dispatchEvent(
        new CustomEvent("fromPaleoDbAutomation", { detail: data }),
    );
}

document.addEventListener("toPaleoDbAutomation", function (e: any) {
    var message = e.detail;
    console.log("received", message);
    const actionName =
        message.actionName ?? message.fullActionName.split(".").at(-1);
    switch (actionName) {
        case "setTaxonomicGroup": {
            enablePaleoBioDbFilter("", message.parameters.taxa);
            sendResponse({});
            break;
        }

        case "setGeologicTimescale": {
            enablePaleoBioDbFilter(message.parameters.geologicTime, "");
            sendResponse({});
            break;
        }

        case "clearFilters": {
            clearPaleoBioDbFilter(
                message.parameters.geologicTime,
                message.parameters.taxa,
                message.parameters.all,
            );
            sendResponse({});
            break;
        }

        case "zoomIn": {
            zoomInOnPaleoBioDb();
            sendResponse({});
            break;
        }

        case "zoomOut": {
            zoomOutOnPaleoBioDb();
            sendResponse({});
            break;
        }

        case "panMap": {
            panMapOnPaleoBioDb(message.parameters.direction);
            sendResponse({});
            break;
        }

        case "setMapLocation": {
            setMapLocation(
                message.parameters.latitude,
                message.parameters.longitude,
            );
            sendResponse({});
            break;
        }
    }
});
