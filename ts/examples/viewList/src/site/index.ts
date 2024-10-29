// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function updateGroceryList(items: string[]) {
    const list = document.getElementById("list-content") as HTMLUListElement;
    list.innerHTML = ""; // Clear the current list
    items.forEach((item) => {
        const listItem = document.createElement("li");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        listItem.appendChild(checkbox);
        listItem.appendChild(document.createTextNode(item));
        list.appendChild(listItem);
    });
}

async function loadLists() {
    const response = await fetch("/lists");
    const lists = await response.json();
    const listNames = document.getElementById("list-names") as HTMLUListElement;
    listNames.innerHTML = ""; // Clear the current list names
    lists.forEach((list: string) => {
        const listItem = document.createElement("li");
        listItem.textContent = list;
        listItem.addEventListener("click", () => {
            loadListContents(list);
            highlightSelectedList(listItem);
        });
        listNames.appendChild(listItem);
    });
    if (lists.length > 0) {
        const currentListTitle =
            document.getElementById("list-title")?.textContent;
        if (!currentListTitle) {
            loadListContents(lists[0]);
            highlightSelectedList(listNames.children[0] as HTMLLIElement);
        }
    }
}

async function loadListContents(listName: string) {
    const response = await fetch(`/lists/${listName}`);
    const items = await response.json();
    const listTitle = document.getElementById(
        "list-title",
    ) as HTMLHeadingElement;
    listTitle.textContent = listName;
    updateGroceryList(items);
}

function highlightSelectedList(selectedItem: HTMLLIElement) {
    const listItems = document.querySelectorAll(".sidebar ul li");
    listItems.forEach((item) => {
        item.classList.remove("selected");
    });
    selectedItem.classList.add("selected");
}

function handleUpdateListsEvent(changes: any) {
    const { listsAdded, listsRemoved, listsEdited } = changes;
    const listNames = document.getElementById("list-names") as HTMLUListElement;

    // Handle lists added
    listsAdded.forEach((list: string) => {
        const listItem = document.createElement("li");
        listItem.textContent = list;
        listItem.addEventListener("click", () => {
            loadListContents(list);
            highlightSelectedList(listItem);
        });
        listNames.appendChild(listItem);
    });

    // Handle lists removed
    listsRemoved.forEach((list: string) => {
        const listItem = Array.from(listNames.children).find(
            (item) => item.textContent === list,
        );
        if (listItem) {
            listNames.removeChild(listItem);
        }
    });

    // Handle lists edited
    listsEdited.forEach((editedList: any) => {
        const { name, itemsAdded, itemsRemoved, itemsEdited } = editedList;
        if (
            (document.getElementById("list-title") as HTMLHeadingElement)
                .textContent === name
        ) {
            const list = document.getElementById(
                "list-content",
            ) as HTMLUListElement;

            // Handle items added
            itemsAdded.forEach((item: string) => {
                const listItem = document.createElement("li");
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                listItem.appendChild(checkbox);
                listItem.appendChild(document.createTextNode(item));
                list.appendChild(listItem);
            });

            // Handle items removed
            itemsRemoved.forEach((item: string) => {
                const listItem = Array.from(list.children).find(
                    (li) => li.textContent === item,
                );
                if (listItem) {
                    list.removeChild(listItem);
                }
            });

            // Handle items edited (for simplicity, we'll just update the text content)
            itemsEdited.forEach((item: string) => {
                const listItem = Array.from(list.children).find(
                    (li) => li.textContent === item,
                );
                if (listItem) {
                    listItem.textContent = item;
                }
            });
        }
    });

    // Determine the active list
    if (listsEdited.length > 0) {
        const lastEditedList = listsEdited[listsEdited.length - 1].name;
        const listItem = Array.from(listNames.children).find(
            (item) => item.textContent === lastEditedList,
        ) as HTMLLIElement;
        loadListContents(lastEditedList);
        highlightSelectedList(listItem);
    } else if (listsAdded.length > 0) {
        const lastAddedList = listsAdded[listsAdded.length - 1];
        const listItem = Array.from(listNames.children).find(
            (item) => item.textContent === lastAddedList,
        ) as HTMLLIElement;
        loadListContents(lastAddedList);
        highlightSelectedList(listItem);
    } else if (listsRemoved.length > 0) {
        const remainingLists = Array.from(listNames.children).map(
            (item) => item.textContent,
        );
        if (remainingLists.length > 0) {
            const firstRemainingList = remainingLists[0];
            const listItem = Array.from(listNames.children).find(
                (item) => item.textContent === firstRemainingList,
            ) as HTMLLIElement;
            loadListContents(firstRemainingList!);
            highlightSelectedList(listItem);
        }
    }
}

// Initial load of lists
loadLists();

// Set up Server-Sent Events
const eventSource = new EventSource("/events");

eventSource.addEventListener("addList", (event) => {
    const newList = JSON.parse(event.data);
    const listNames = document.getElementById("list-names") as HTMLUListElement;
    const listItem = document.createElement("li");
    listItem.textContent = newList;
    listItem.addEventListener("click", () => {
        loadListContents(newList);
        highlightSelectedList(listItem);
    });
    listNames.appendChild(listItem);
});

eventSource.addEventListener("addItem", (event) => {
    const { listName, newItem } = JSON.parse(event.data);
    if (
        (document.getElementById("list-title") as HTMLHeadingElement)
            .textContent === listName
    ) {
        const list = document.getElementById(
            "list-content",
        ) as HTMLUListElement;
        const listItem = document.createElement("li");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        listItem.appendChild(checkbox);
        listItem.appendChild(document.createTextNode(newItem));
        list.appendChild(listItem);
    }
});

eventSource.addEventListener("removeItem", (event) => {
    const { listName, itemToRemove } = JSON.parse(event.data);
    if (
        (document.getElementById("list-title") as HTMLHeadingElement)
            .textContent === listName
    ) {
        const list = document.getElementById(
            "list-content",
        ) as HTMLUListElement;
        const items = Array.from(list.children);
        items.forEach((item) => {
            if (item.textContent === itemToRemove) {
                list.removeChild(item);
            }
        });
    }
});

eventSource.addEventListener("markOrdered", (event) => {
    const { listName, itemToMark } = JSON.parse(event.data);
    if (
        (document.getElementById("list-title") as HTMLHeadingElement)
            .textContent === listName
    ) {
        const list = document.getElementById(
            "list-content",
        ) as HTMLUListElement;
        const items = Array.from(list.children);
        items.forEach((item) => {
            if (item.textContent === itemToMark) {
                const checkbox = item.querySelector(
                    'input[type="checkbox"]',
                ) as HTMLInputElement;
                checkbox.checked = true;
            }
        });
    }
});

eventSource.addEventListener("updateLists", (event) => {
    const changes = JSON.parse(event.data);
    handleUpdateListsEvent(changes);
});
