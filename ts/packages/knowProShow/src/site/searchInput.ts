// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class SearchInput {

    private _container: HTMLDivElement;
    private _input: HTMLInputElement;
    private _goButton: HTMLButtonElement;

    constructor() {
        this._container = document.createElement("div");
        this._input = document.createElement("input");

        this._goButton = document.createElement("button");
        this._goButton.type = "button";
        this._goButton.textContent = "run";
        this._goButton.onclick = () => {
            fetch("/cmd?cmd=" + this._input.value);
        };

        this._container.append(this._input);
        this._container.append(this._goButton);
    }

    get container() {
        return this._container;
    }
}