// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface SchemaMetadata {
    url: string;
    data: any[];
}

export function extractSchemaMetadata(doc?: Document): any[] {
    if (doc == undefined) {
        doc = document;
    }

    const metadata: any[] = [];

    const scriptTags = doc.querySelectorAll(
        'script[type="application/ld+json"]',
    );
    scriptTags.forEach((script) => {
        try {
            const jsonData = JSON.parse(script.textContent || "");
            if (jsonData) {
                metadata.push(jsonData);
            }
        } catch (e) {
            console.error("Error parsing JSON-LD:", e);
        }
    });

    const microdataElements = doc.querySelectorAll("[itemscope]");
    microdataElements.forEach((element) => {
        const microdataObj = extractMicrodata(element as HTMLElement);
        if (Object.keys(microdataObj).length > 0) {
            metadata.push(microdataObj);
        }
    });

    const rdfaElements = doc.querySelectorAll("[typeof]");
    rdfaElements.forEach((element) => {
        const rdfaObj = extractRDFa(element as HTMLElement);
        if (Object.keys(rdfaObj).length > 0) {
            metadata.push(rdfaObj);
        }
    });

    return metadata;
}

function extractMicrodata(element: HTMLElement): any {
    const result: any = {};

    const itemtype = element.getAttribute("itemtype");
    if (itemtype) {
        result["@type"] = itemtype.split("/").pop();
    }

    const itemprops = element.querySelectorAll("[itemprop]");
    itemprops.forEach((itemprop) => {
        const propName = itemprop.getAttribute("itemprop");
        if (!propName) return;

        let propValue;
        if (itemprop.hasAttribute("content")) {
            propValue = itemprop.getAttribute("content");
        } else if (itemprop.hasAttribute("datetime")) {
            propValue = itemprop.getAttribute("datetime");
        } else {
            propValue = (itemprop as HTMLElement).innerText.trim();
        }

        if (propValue) {
            result[propName] = propValue;
        }
    });

    return result;
}

function extractRDFa(element: HTMLElement): any {
    const result: any = {};

    const type = element.getAttribute("typeof");
    if (type) {
        result["@type"] = type;
    }

    const properties = element.querySelectorAll("[property]");
    properties.forEach((prop) => {
        const propName = prop.getAttribute("property");
        if (!propName) return;

        let propValue;
        if (prop.hasAttribute("content")) {
            propValue = prop.getAttribute("content");
        } else {
            propValue = (prop as HTMLElement).innerText.trim();
        }

        if (propValue) {
            result[propName] = propValue;
        }
    });

    return result;
}

export async function extractSchemaFromLinkedPages() {
    const isTripAdvisor = window.location.hostname.includes("tripadvisor");
    let uniqueLinks: string[] = [];

    if (isTripAdvisor) {
        // Get restaurant links from the page
        let restaurantLinks: string[] = [];

        // TripAdvisor-specific selectors for restaurant search results
        // These selectors may need adjustment based on TripAdvisor's current HTML structure
        const restaurantElements = document.querySelectorAll(
            ".result-title, .listing_title a, .property_title a, .qoImL a",
        );

        restaurantLinks = Array.from(restaurantElements)
            .map(
                (el) =>
                    (el as HTMLAnchorElement).href ||
                    (el.querySelector("a") as HTMLAnchorElement)?.href,
            )
            .filter(Boolean) as string[];

        // If no restaurant links found with specific selectors, fallback to more generic approach
        if (restaurantLinks.length === 0) {
            // Look for links that contain restaurant-related paths
            const allLinks = Array.from(document.querySelectorAll("a[href]"));
            restaurantLinks = allLinks
                .map((a) => a.getAttribute("href"))
                .filter(
                    (href) =>
                        href &&
                        (href.includes("/Restaurant_Review") ||
                            href.includes("/restaurant") ||
                            href.includes("restaurant")),
                )
                .map(
                    (href) => new URL(href!, window.location.href).href,
                ) as string[];

            uniqueLinks = [...new Set(restaurantLinks)];
        }
    } else {
        // Get all links on the current page
        const links = Array.from(document.querySelectorAll("a[href]"))
            .map((a) => a.getAttribute("href"))
            .filter(Boolean) as string[];

        // Convert relative URLs to absolute
        const absoluteLinks = links.map(
            (link) => new URL(link, window.location.href).href,
        );

        const currentDomain = new URL(window.location.href).hostname;
        uniqueLinks = [...new Set(absoluteLinks)].filter((url) => {
            try {
                return new URL(url).hostname === currentDomain;
            } catch (e) {
                return false;
            }
        });
    }

    const totalLinks = uniqueLinks.length;
    let processedLinks = 0;
    const allMetadata: SchemaMetadata[] = [];

    // Create a popup for progress tracking
    const popup = document.createElement("div");
    popup.style.position = "fixed";
    popup.style.top = "20px";
    popup.style.right = "20px";
    popup.style.padding = "15px";
    popup.style.backgroundColor = "#f0f0f0";
    popup.style.border = "1px solid #ccc";
    popup.style.borderRadius = "5px";
    popup.style.zIndex = "10000";
    popup.style.boxShadow = "0 2px 10px rgba(0,0,0,0.2)";
    document.body.appendChild(popup);

    popup.textContent = `Crawling: 0/${totalLinks} pages`;

    const updateProgress = () => {
        processedLinks++;
        popup.textContent = `Crawling: ${processedLinks}/${totalLinks} pages`;
    };

    try {
        for (let i = 0; i < uniqueLinks.length; i++) {
            const link = uniqueLinks[i];
            try {
                // Create an iframe to load the page
                const iframe = document.createElement("iframe");
                iframe.style.display = "none";
                document.body.appendChild(iframe);

                // Wait for iframe to load
                await new Promise<void>((resolve, reject) => {
                    const timeoutId = setTimeout(() => {
                        reject(new Error("Timeout"));
                    }, 10000);

                    iframe.onload = () => {
                        clearTimeout(timeoutId);
                        resolve();
                    };

                    iframe.onerror = () => {
                        clearTimeout(timeoutId);
                        reject(new Error("Failed to load page"));
                    };

                    iframe.src = link;
                });

                const iframeDoc = iframe.contentDocument;
                if (iframeDoc) {
                    const metadata = extractSchemaMetadata(iframeDoc);
                    if (metadata.length > 0) {
                        allMetadata.push({
                            url: link,
                            data: metadata,
                        });
                    }
                }

                document.body.removeChild(iframe);
            } catch (e) {
                console.error(`Error processing ${link}:`, e);
            }

            updateProgress();

            // Add a random delay between requests (1-3 seconds)
            const delay = 1000 + Math.random() * 2000;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        if (allMetadata.length > 0) {
            chrome.runtime.sendMessage({
                type: "downloadData",
                data: allMetadata,
                filename: `linked-schemas-${new URL(window.location.href).hostname}-${Date.now()}.json`,
            });
        } else {
            alert("No schema.org metadata found on any linked pages.");
        }
    } finally {
        document.body.removeChild(popup);
    }
}
