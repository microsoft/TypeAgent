// Function to update the grocery list
function updateGroceryList(items: string[]) {
    const list = document.getElementById('grocery-list') as HTMLUListElement;
    list.innerHTML = ''; // Clear the current list
    items.forEach(item => {
        const listItem = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        listItem.appendChild(checkbox);
        listItem.appendChild(document.createTextNode(item));
        list.appendChild(listItem);
    });
}

// Function to load all lists
async function loadLists() {
    const response = await fetch('/lists');
    const lists = await response.json();
    const listNames = document.getElementById('list-names') as HTMLUListElement;
    listNames.innerHTML = ''; // Clear the current list names
    lists.forEach((list: string) => {
        const listItem = document.createElement('li');
        listItem.textContent = list;
        listItem.addEventListener('click', () => {
            loadListContents(list);
        });
        listNames.appendChild(listItem);
    });
    if (lists.length > 0) {
        loadListContents(lists); // Load the first list by default
    }
}

// Function to load the contents of a list
async function loadListContents(listName: string) {
    const response = await fetch(`/lists/${listName}`);
    const items = await response.json();
    const listTitle = document.getElementById('list-title') as HTMLHeadingElement;
    listTitle.textContent = listName;
    updateGroceryList(items);
}

// Initial load of lists
loadLists();

// Set up Server-Sent Events
const eventSource = new EventSource('/events');

eventSource.addEventListener('addList', (event) => {
    const newList = JSON.parse(event.data);
    const listNames = document.getElementById('list-names') as HTMLUListElement;
    const listItem = document.createElement('li');
    listItem.textContent = newList;
    listItem.addEventListener('click', () => {
        loadListContents(newList);
    });
    listNames.appendChild(listItem);
});

eventSource.addEventListener('addItem', (event) => {
    const { listName, newItem } = JSON.parse(event.data);
    if ((document.getElementById('list-title') as HTMLHeadingElement).textContent === listName) {
        const list = document.getElementById('grocery-list') as HTMLUListElement;
        const listItem = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        listItem.appendChild(checkbox);
        listItem.appendChild(document.createTextNode(newItem));
        list.appendChild(listItem);
    }
});

eventSource.addEventListener('removeItem', (event) => {
    const { listName, itemToRemove } = JSON.parse(event.data);
    if ((document.getElementById('list-title') as HTMLHeadingElement).textContent === listName) {
        const list = document.getElementById('grocery-list') as HTMLUListElement;
        const items = Array.from(list.children);
        items.forEach(item => {
            if (item.textContent === itemToRemove) {
                list.removeChild(item);
            }
        });
    }
});

eventSource.addEventListener('markOrdered', (event) => {
    const { listName, itemToMark } = JSON.parse(event.data);
    if ((document.getElementById('list-title') as HTMLHeadingElement).textContent === listName) {
        const list = document.getElementById('grocery-list') as HTMLUListElement;
        const items = Array.from(list.children);
        items.forEach(item => {
            if (item.textContent === itemToMark) {
                const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
                checkbox.checked = true;
            }
        });
    }
});

eventSource.addEventListener('updateLists', (event) => {
    const listsData = JSON.parse(event.data);
    const listNames = document.getElementById('list-names') as HTMLUListElement;
    listNames.innerHTML = ''; // Clear the current list names
    listsData.forEach((list: { name: string }) => {
        const listItem = document.createElement('li');
        listItem.textContent = list.name;
        listItem.addEventListener('click', () => {
            loadListContents(list.name);
        });
        listNames.appendChild(listItem);
    });
    if (listsData.length > 0) {
        loadListContents(listsData.name); // Load the first list by default
    }
});