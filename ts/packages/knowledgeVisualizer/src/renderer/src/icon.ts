// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function createSVGElement(path: string, id?: string) {
    const wrapperDiv = document.createElement("i");
    const emptySVG = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
    );
    wrapperDiv.appendChild(emptySVG);
    emptySVG.outerHTML = path;
    if (id !== undefined) {
        const child = wrapperDiv.children[0];
        child.setAttribute("id", id);
    }
    return wrapperDiv;
}

export function iconExpand(fillColor: string = "#212121") {
  const path = `<svg class="expand" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7.59551 15.3497C7.8884 15.0568 8.36327 15.0568 8.65617 15.3497C8.94906 15.6426 8.94906 16.1174 8.65617 16.4103L5.561 19.5042H7.75C8.1297 19.5042 8.44349 19.7864 8.49315 20.1524L8.5 20.2542C8.5 20.6684 8.16421 21.0042 7.75 21.0042H3.75C3.33579 21.0042 3 20.6684 3 20.2542V16.2542C3 15.84 3.33579 15.5042 3.75 15.5042C4.16421 15.5042 4.5 15.84 4.5 16.2542V18.4432L7.59551 15.3497ZM16.255 21.0042C15.8408 21.0042 15.505 20.6684 15.505 20.2542C15.505 19.84 15.8408 19.5042 16.255 19.5042H18.441L15.3495 16.4101C15.0833 16.1438 15.0593 15.7271 15.2772 15.4336L15.3499 15.3495C15.6429 15.0567 16.1178 15.0569 16.4105 15.3499L19.505 18.4462V16.2542C19.505 15.8745 19.7872 15.5607 20.1532 15.5111L20.255 15.5042C20.6692 15.5042 21.005 15.84 21.005 16.2542V20.2542C21.005 20.6684 20.6692 21.0042 20.255 21.0042H16.255ZM7.75 3C8.16421 3 8.5 3.33579 8.5 3.75C8.5 4.16421 8.16421 4.5 7.75 4.5H5.563L8.65554 7.59488C8.9217 7.86125 8.94574 8.27792 8.72777 8.57145L8.65512 8.65554C8.36211 8.94832 7.88724 8.94813 7.59446 8.65512L4.5 5.558V7.75C4.5 8.1297 4.21785 8.44349 3.85177 8.49315L3.75 8.5C3.33579 8.5 3 8.16421 3 7.75V3.75C3 3.33579 3.33579 3 3.75 3H7.75ZM20.255 3C20.6692 3 21.005 3.33579 21.005 3.75V7.75C21.005 8.16421 20.6692 8.5 20.255 8.5C19.8408 8.5 19.505 8.16421 19.505 7.75V5.559L16.4104 8.65522C16.1442 8.92154 15.7276 8.94583 15.4339 8.72804L15.3498 8.65544C15.0568 8.3626 15.0567 7.88773 15.3496 7.59478L18.442 4.5H16.255C15.8753 4.5 15.5615 4.21785 15.5118 3.85177L15.505 3.75C15.505 3.33579 15.8408 3 16.255 3H20.255Z" fill="${fillColor}" />
        </svg>`;

  return createSVGElement(path);
}

export function iconCollapse(fillColor: string = "currentColor") {
  const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 2048 2048">
          <path d="M256 1152h640v640H768v-421L93 2045l-90-90 674-675H256v-128zm1115-384h421v128h-640V256h128v421L1955 3l90 90-674 675z" fill=${fillColor}" />
        </svg>`;

  return createSVGElement(path);
}
