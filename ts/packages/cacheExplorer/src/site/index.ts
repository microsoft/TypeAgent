// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConstructionCache,
    ConstructionPart,
    MatchSet,
    Construction,
    isMatchPart,
} from "agent-cache";

function createMatchSetListGroup(groupName: string, matchSetsDiv: Element) {
    const groupDiv = document.createElement("div");

    // Plus Div
    const groupPlusDiv = document.createElement("button");
    groupPlusDiv.innerText = "+";

    groupPlusDiv.style.padding = "0px";
    groupPlusDiv.style.margin = "5px";
    groupPlusDiv.style.width = "15px";
    groupPlusDiv.style.height = "15px";
    groupPlusDiv.style.textAlign = "center";
    groupPlusDiv.style.border = "1px solid black";

    groupPlusDiv.addEventListener("click", () => {
        if (groupDiv.contains(groupElem)) {
            groupDiv.removeChild(groupElem);
            groupPlusDiv.innerText = "+";
        } else {
            groupDiv.appendChild(groupElem);
            groupPlusDiv.innerText = "-";
        }
    });

    // Name Div
    const groupNameDiv = document.createElement("div");
    groupNameDiv.innerText = groupName;
    groupNameDiv.style.display = "inline-block";

    groupDiv.appendChild(groupPlusDiv);
    groupDiv.appendChild(groupNameDiv);

    matchSetsDiv.appendChild(groupDiv);

    // Group Div
    const groupElem = document.createElement("div");
    groupElem.style.position = "relative";
    groupElem.style.left = "30px";

    return groupElem;
}

let constructionViews: {
    construction: Construction;
    elem: Element;
    partViews: { part: ConstructionPart; elem: Element }[];
}[] = [];
let selectedMatchSets: MatchSet[] = [];
const matchSetElemMap = new Map<MatchSet, Element>();
function toMatchSetElem(matchSets: MatchSet[]) {
    return matchSets.map((m) => matchSetElemMap.get(m)!);
}
function selectMatchSets(newSelectedMatchSets: MatchSet[]) {
    toMatchSetElem(selectedMatchSets).forEach((s) =>
        s.classList.remove("selected"),
    );
    toMatchSetElem(newSelectedMatchSets).forEach((s) =>
        s.classList.add("selected"),
    );
    selectedMatchSets = newSelectedMatchSets;
    constructionViews.forEach((constructionView) => {
        const show =
            selectedMatchSets.length === 0 ||
            selectedMatchSets.every((m) =>
                constructionView.partViews.some(
                    (partView) =>
                        isMatchPart(partView.part) &&
                        partView.part.matchSet === m,
                ),
            );
        if (show) {
            constructionView.elem.classList.remove("hidden");
            constructionView.partViews.forEach((partView) => {
                if (isMatchPart(partView.part) && partView.part.matchSet) {
                    if (selectedMatchSets.includes(partView.part.matchSet)) {
                        partView.elem.classList.add("selected");
                    } else {
                        partView.elem.classList.remove("selected");
                    }
                }
            });
        } else {
            constructionView.elem.classList.add("hidden");
        }
    });
    const selectedMatchSetDetail = document.getElementById(
        "selectedMatchSetDetail",
    )!;
    selectedMatchSetDetail.innerHTML = "";
    selectedMatchSets.forEach((m) => {
        const matchSetDiv = document.createElement("div");
        matchSetDiv.classList.add("matchsetdetails");
        const header = document.createElement("h3");
        header.innerText = m.fullName;
        matchSetDiv.appendChild(header);

        m.matches.forEach((match) => {
            const matchDiv = document.createElement("div");
            matchDiv.innerText = match;
            matchSetDiv.appendChild(matchDiv);
        });
        selectedMatchSetDetail.appendChild(matchSetDiv);
    });
}

function createMatchSetListView(cache: ConstructionCache) {
    const matchSetsDiv = document.getElementById("matchsets")!;

    const matchSetGroups = new Map<string, MatchSet[]>();
    for (const matchSet of cache.matchSets) {
        const group = matchSetGroups.get(matchSet.name);
        if (group === undefined) {
            matchSetGroups.set(matchSet.name, [matchSet]);
        } else {
            group.push(matchSet);
        }
    }

    // List the action and then parameter parts first.
    const sortedMatchSetGroups = Array.from(matchSetGroups.entries()).sort(
        (a, b) => {
            const aname = a[0].split(":");
            const bname = b[0].split(":");
            if (aname.length !== bname.length) {
                return bname.length - aname.length;
            } else {
                const c = aname[0].localeCompare(bname[0]);
                return c !== 0
                    ? c
                    : aname.length === 1
                      ? 0
                      : aname[1].localeCompare(bname[1]);
            }
        },
    );
    sortedMatchSetGroups.forEach(([name, matchSets]) => {
        const matchSetListGroup =
            matchSets.length === 1
                ? matchSetsDiv
                : createMatchSetListGroup(name, matchSetsDiv);
        matchSets.map((m) => {
            const matchSetDiv = document.createElement("div");
            matchSetDiv.classList.add("matchset");
            matchSetDiv.innerText = m.fullName;
            matchSetDiv.addEventListener("click", (e) => {
                if (e.ctrlKey) {
                    if (selectedMatchSets.includes(m)) {
                        selectMatchSets(
                            selectedMatchSets.filter((s) => s !== m),
                        );
                    } else {
                        selectMatchSets([...selectedMatchSets, m]);
                    }
                } else {
                    selectMatchSets([m]);
                }
            });

            matchSetListGroup.appendChild(matchSetDiv);

            matchSetElemMap.set(m, matchSetDiv);
        });
    });
}

function createConstructionView(cache: ConstructionCache, namespace: string) {
    const constructionsDiv = document.getElementById("constructions")!;
    const constructionTable = document.createElement("table");
    constructionsDiv.replaceChildren(constructionTable);

    const constructionNamespace = cache.getConstructionNamespace(namespace);
    constructionViews = constructionNamespace
        ? constructionNamespace.constructions.map((construction, index) => {
              const constructionElem = document.createElement("tr");

              const constructionIndexElem = document.createElement("td");
              constructionIndexElem.innerText = index.toString();
              constructionElem.appendChild(constructionIndexElem);

              const partViews = construction.parts.map((p) => {
                  const partElem = document.createElement("td");
                  constructionElem.appendChild(partElem);
                  partElem.innerText = `${p.toString()}${
                      p.wildcardMode ? "(w)" : ""
                  }`;
                  return { part: p, elem: partElem };
              });
              constructionElem.addEventListener("click", () => {
                  const matchSets: MatchSet[] = [];
                  for (const part of construction.parts) {
                      if (isMatchPart(part) && part.matchSet) {
                          matchSets.push(part.matchSet);
                      }
                  }
                  selectMatchSets(matchSets);
              });
              constructionTable.appendChild(constructionElem);
              return { construction, elem: constructionElem, partViews };
          })
        : [];
}

function clearCacheView(loading: boolean) {
    const constructionsDiv = document.getElementById("constructions")!;
    constructionsDiv.replaceChildren();
    const matchSetsDiv = document.getElementById("matchsets")!;
    matchSetsDiv.replaceChildren();

    if (loading) {
        constructionsDiv.appendChild(
            document.createTextNode("Loading cache..."),
        );
    }
}

function createCacheView(cache: ConstructionCache, namespace: string) {
    createConstructionView(cache, namespace);
    createMatchSetListView(cache);
}

async function loadConstructionCache(session: string, cacheName: string) {
    const content = await fetch(`/session/${session}/cache/${cacheName}`);
    if (content.status !== 200) {
        throw new Error(
            `Failed to load construction cache: ${content.statusText}`,
        );
    }
    const cacheData = await content.json();
    return ConstructionCache.fromJSON(cacheData);
}

function updateCacheView(ui: CacheSelectionUI) {
    clearCacheView(true);
    if (currentCache) {
        const namespace = ui.namespace.value;
        createCacheView(currentCache, namespace);
    }
}

// Cache selection
type CacheEntry = {
    explainer: string;
    name: string;
    current: boolean;
};

type CacheSelectionUI = {
    explainer: HTMLSelectElement;
    name: HTMLSelectElement;
    namespace: HTMLSelectElement;
};

let currentSession: string | undefined;
let currentCacheName: string | undefined;
let currentCache: ConstructionCache | undefined;

function updateCacheSelection(ui: CacheSelectionUI, entries: CacheEntry[]) {
    const filtered = entries.filter((e) => e.explainer === ui.explainer.value);
    let currentIndex = 0;
    ui.name.replaceChildren(
        ...filtered.map((e, index) => {
            const option = document.createElement("option");
            option.text = `${e.name} ${e.current ? " (current)" : ""}`;
            option.value = e.name;
            if (e.current) {
                currentIndex = index;
            }
            return option;
        }),
    );
    ui.name.selectedIndex = currentIndex;

    updateTranslatorSelection(ui);
}

async function updateTranslatorSelection(ui: CacheSelectionUI) {
    clearCacheView(true);
    const sessionSelect = document.getElementById(
        "sessions",
    ) as HTMLSelectElement;
    const session = sessionSelect.value;
    const cacheName = ui.name.value;
    const cache = await loadConstructionCache(session, cacheName);
    if (
        session === sessionSelect.value &&
        cacheName === ui.name.value &&
        currentSession === session &&
        cacheName !== currentCacheName
    ) {
        currentCacheName = cacheName;
        currentCache = cache;
        const namespaces = cache.getConstructionNamespaces();
        ui.namespace.replaceChildren(
            ...namespaces.map((e) => {
                const option = document.createElement("option");
                option.text = e;
                return option;
            }),
        );
        updateCacheView(ui);
    }
}

function createCacheSelection(entries: CacheEntry[]) {
    if (entries.length === 0) {
        clearCacheSelection(false);
        return;
    }

    const explainer = document.createElement("select");
    const name = document.createElement("select");
    const namespace = document.createElement("select");

    explainer.addEventListener("change", () => {
        updateCacheSelection(ui, entries);
    });
    name.addEventListener("change", () => {
        updateTranslatorSelection(ui);
    });
    namespace.addEventListener("change", () => {
        updateCacheView(ui);
    });

    const cachesDiv = document.getElementById("cacheSelection")!;
    cachesDiv.replaceChildren(
        document.createTextNode(" Explainer: "),
        explainer,
        document.createTextNode(" Cache: "),
        name,
        document.createTextNode(" Translator: "),
        namespace,
    );

    const ui = { explainer, name, namespace };

    explainer.replaceChildren(
        ...Array.from(new Set(entries.map((e) => e.explainer)).values()).map(
            (t) => {
                const option = document.createElement("option");
                option.text = t;
                option.value = t;
                return option;
            },
        ),
    );

    updateCacheSelection(ui, entries);
}

async function getSessionCacheInfo(session: string) {
    try {
        const cachesResponse = await fetch(`/session/${session}/caches`);
        return cachesResponse.json();
    } catch {
        return [];
    }
}

function clearCacheSelection(loading: boolean) {
    const cachesDiv = document.getElementById("cacheSelection")!;
    cachesDiv.replaceChildren();
    cachesDiv.appendChild(
        document.createTextNode(
            loading ? "Loading cache from session..." : "No cache available",
        ),
    );
}

async function initializeUI() {
    const sessionSelection = document.getElementById(
        "sessions",
    ) as HTMLSelectElement;
    const sessionsResponse = await fetch("/sessions");
    const sessions = await sessionsResponse.json();
    sessions.forEach((session: string) => {
        const option = document.createElement("option");
        option.text = session;
        sessionSelection.add(option);
    });

    sessionSelection.selectedIndex = sessionSelection.options.length - 1;

    const updateCacheSelection = async () => {
        clearCacheSelection(true);
        clearCacheView(false);

        const session = sessionSelection.value;
        const data = await getSessionCacheInfo(session);
        if (session === sessionSelection.value && currentSession !== session) {
            currentSession = session;
            createCacheSelection(data);
        }
    };
    sessionSelection.addEventListener("change", updateCacheSelection);
    await updateCacheSelection();
}

initializeUI().catch((e) => {
    const cacheExplorer = document.getElementById("content")!;
    cacheExplorer.innerHTML = `Error rendering construction cache: ${e}`;
});
