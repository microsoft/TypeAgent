// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionTemplateSequence,
    TemplateParamFieldOpt,
    TemplateParamScalar,
} from "../../preload/electronTypes";

import { iconX } from "./icon";

export class ActionCascade {
    constructor(
        public actionTemplates: ActionTemplateSequence,
        public editMode = false,
    ) {}

    private scalarToHTML(
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
            input.value = paramValue.value?.toString() || "";
            li.appendChild(input);
        } else {
            li.innerText = `${paramName}: ${paramValue.value}`;
        }
    }

    private paramToHTML(
        paramName: string,
        paramValue: TemplateParamFieldOpt,
        topLevel = false,
    ) {
        const liSeq: HTMLLIElement[] = [];
        switch (paramValue.field.type) {
            case "array": {
                if (paramValue.field.elements) {
                    const elts = paramValue.field.elements;
                    for (let i = 0; i < elts.length; i++) {
                        const arrayKey = paramName
                            ? `${paramName}[${i}]`
                            : i.toString();
                        const innerSeq = this.paramToHTML(arrayKey, {
                            field: paramValue.field.elements[i],
                        } as TemplateParamFieldOpt);
                        for (const elt of innerSeq) {
                            liSeq.push(elt);
                        }
                    }
                }
                if (this.editMode) {
                    // add a button to add more elements
                    const addButton = document.createElement("button");
                    addButton.innerText = "Add array element";
                    addButton.onclick = () => {
                        console.log("add");
                    };
                    const li = document.createElement("li");
                    li.appendChild(addButton);
                    liSeq.push(li);
                }
                break;
            }
            case "object": {
                const li = document.createElement("li");
                li.innerText = paramName;
                const ul = document.createElement("ul");
                const fields = paramValue.field.fields;
                for (const [k, v] of Object.entries(fields)) {
                    const innerLiSeq = this.paramToHTML(k, v);
                    for (const innerLi of innerLiSeq) {
                        ul.appendChild(innerLi);
                    }
                }
                li.appendChild(ul);
                liSeq.push(li);
                break;
            }
            default: {
                // TODO: handle input case and undefined value
                const li = document.createElement("li");
                this.scalarToHTML(li, paramName, paramValue.field, topLevel);
                liSeq.push(li);
                break;
            }
        }
        return liSeq;
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
            const agentDiv = document.createElement("div");
            agentDiv.innerText = `Agent: ${actionTemplate.agent}`;
            div.appendChild(agentDiv);
            const actionDiv = document.createElement("div");
            actionDiv.innerText = `Action: ${actionTemplate.name}`;
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
                    const liSeq = this.paramToHTML(key, value, true);
                    for (const li of liSeq) {
                        ul.appendChild(li);
                    }
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
