// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionTemplateSequence,
    TemplateParamFieldOpt,
    TemplateParamScalar,
} from "../../preload/electronTypes";

import { iconX } from "./icon";

export class ActionCascade {
    container: HTMLDivElement;

    constructor(
        public actionTemplates: ActionTemplateSequence,
        public editMode = false,
    ) {
        this.container = this.toHTML();
    }

    public scalarToHTML(
        li: HTMLLIElement,
        paramName: string,
        paramValue: TemplateParamScalar,
        topLevel = false,
    ) {
        if (this.editMode) {
            if (topLevel) {
                // TODO: make width dynamic
                const cancelButton = iconX();
                cancelButton.onclick = () => {
                    console.log("cancel");
                };
                li.appendChild(cancelButton);
            }
            const label = document.createElement("label");
            label.innerText = paramName;
            li.appendChild(label);
            const input = document.createElement("input");
            input.type = "text";
            input.name = paramName;
            li.appendChild(input);
        } else {
            li.innerText = `${paramName}: ${paramValue.value}`;
        }
    }

    public paramToHTML(
        paramName: string,
        paramValue: TemplateParamFieldOpt,
        topLevel = false,
    ) {
        const li = document.createElement("li");
        switch (paramValue.field.type) {
            case "array":
                if (paramValue.field.elements) {
                    const elts = paramValue.field.elements;
                    const ul = document.createElement("ul");
                    for (let i = 0; i < elts.length; i++) {
                        const arrayKey = paramName
                            ? `${paramName}[${i}]`
                            : i.toString();
                        const li = this.paramToHTML(arrayKey, {
                            field: paramValue[i],
                        } as TemplateParamFieldOpt);
                        ul.appendChild(li);
                    }
                    li.appendChild(ul);
                }
                if (this.editMode) {
                    // add a button to add more elements
                    const addButton = document.createElement("button");
                    addButton.innerText = "Add array element";
                    addButton.onclick = () => {
                        console.log("add");
                    };
                    li.appendChild(addButton);
                }
                break;
            case "object": {
                li.innerText = paramName;
                const ul = document.createElement("ul");
                const fields = paramValue.field.fields;
                for (const [k, v] of Object.entries(fields)) {
                    const innerLi = this.paramToHTML(k, v);
                    ul.appendChild(innerLi);
                }
                li.appendChild(ul);
                break;
            }
            default:
                // TODO: handle input case and undefined value
                this.scalarToHTML(li, paramName, paramValue.field, topLevel);
                break;
        }
        return li;
    }

    public toHTML() {
        // for now assume a single action
        const div = document.createElement("div");
        if (
            this.actionTemplates.templates.length === 1 &&
            this.actionTemplates.prefaceSingle
        ) {
            const preface = document.createElement("div");
            preface.className = "preface-text";
            preface.innerText = this.actionTemplates.prefaceSingle;
            div.appendChild(preface);
        } else if (
            this.actionTemplates.templates.length > 1 &&
            this.actionTemplates.prefaceMultiple
        ) {
            const preface = document.createElement("div");
            preface.className = "preface-text";
            preface.innerText = this.actionTemplates.prefaceMultiple;
            div.appendChild(preface);
        }
        for (const actionTemplate of this.actionTemplates.templates) {
            const actionDiv = document.createElement("div");
            actionDiv.innerText = `Action: ${actionTemplate.agent}.${actionTemplate.name}`;
            div.appendChild(actionDiv);
            // now the parameters
            const entries = Object.entries(
                actionTemplate.parameterStructure.fields,
            );
            if (entries.length !== 0) {
                const paramDiv = document.createElement("div");
                paramDiv.innerText = "Parameters:";
                const ul = document.createElement("ul");
                // TODO: split the entries by optional and required
                for (const [key, value] of entries.sort()) {
                    const li = this.paramToHTML(key, value, true);
                    ul.appendChild(li);
                }
                paramDiv.appendChild(ul);
                div.appendChild(paramDiv);
            }
        }
        if (this.editMode) {
            // add a button to enter an additional action
            const addButton = document.createElement("button");
            addButton.innerText = "Add action";
            addButton.onclick = () => {
                console.log("add");
            };
            div.appendChild(addButton);
            // add a button to submit the action
            const submitButton = document.createElement("button");
            submitButton.innerText = "Submit";
            submitButton.onclick = () => {
                console.log("submit");
            };
            div.appendChild(submitButton);
        }
        return div;
    }
}
