// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TemplateParamArray, TemplateParamField } from "common-utils";
import {
    ActionTemplateSequence,
    TemplateParamFieldOpt,
    TemplateParamScalar,
} from "../../preload/electronTypes";
export class ActionCascade {
    private readonly container: HTMLDivElement;
    private readonly table: HTMLTableElement;
    private current: any;
    private editMode = false;
    constructor(
        appendTo: HTMLElement,
        private actionTemplates: ActionTemplateSequence,
        private enableEdit = true,
    ) {
        this.current = structuredClone(actionTemplates.actions);
        this.container = document.createElement("div");
        this.container.className = "action-text";
        appendTo.appendChild(this.container);

        this.table = document.createElement("table");
        this.createUI();
    }

    public get value() {
        return this.current;
    }

    public reset() {
        this.current = structuredClone(this.actionTemplates.actions);
        this.createTable();
    }

    public setEditMode(editMode: boolean) {
        if (this.editMode === editMode) {
            return;
        }
        if (!this.enableEdit && editMode === true) {
            throw new Error(
                "Cannot set edit mode to true on a non-editable action cascade",
            );
        }

        this.editMode = editMode;
        if (editMode) {
            this.container.classList.add("action-text-editable");
        } else {
            this.container.classList.remove("action-text-editable");
        }
    }

    public remove() {
        this.container.remove();
    }

    private createUIForScalar(
        paramName: string,
        paramValue: TemplateParamScalar,
        optional: boolean,
        valueObject: unknown,
        valueKey: string | number,
        level: number,
    ) {
        const value = valueObject?.[valueKey];
        // TODO: show mismatched type
        if (typeof value !== paramValue.type) {
            console.log(`Mismatched type: ${paramName}`);
        }
        this.createRow(paramName, optional, valueObject, valueKey, level, true);
    }

    private createRow(
        paramName: string,
        optional: boolean,
        valueObject: unknown,
        valueKey: string | number,
        level: number,
        editable: boolean = false,
    ) {
        const row = this.table.insertRow();
        const nameCell = row.insertCell();
        nameCell.style.paddingLeft = `${level * 20}px`;
        nameCell.innerText = paramName;

        const getValue = () => {
            const value = valueObject?.[valueKey];
            if (value !== undefined && typeof value !== "object") {
                return value;
            }
            return "";
        };
        const valueCell = row.insertCell();
        valueCell.innerText = getValue();

        if (this.enableEdit && editable) {
            const input = document.createElement("input");
            input.type = "text";

            const editCell = row.insertCell();
            const editButton = document.createElement("button");
            editButton.innerText = "✏️";
            editButton.className = "action-edit-button";
            editButton.onclick = () => {
                this.table.classList.add("editing");
                row.classList.add("editing");
                input.value = valueCell.innerText;
                valueCell.replaceChildren(input);
                input.focus();
            };
            editCell.appendChild(editButton);

            const optionalCell = row.insertCell();
            if (optional) {
                const optionalButton = document.createElement("button");
                optionalButton.innerText = "❌";
                optionalButton.className = "action-edit-button";
                optionalButton.onclick = () => {
                    row.remove();
                };
                optionalCell.appendChild(optionalButton);
            }

            const saveCell = row.insertCell();
            const saveButton = document.createElement("button");
            saveButton.innerText = "💾";
            saveButton.className = "action-editing-button";
            saveButton.onclick = () => {
                this.table.classList.remove("editing");
                row.classList.remove("editing");
                if (typeof valueObject === "object") {
                    valueObject![valueKey] = input.value;
                }
                valueCell.innerText = getValue();
            };
            saveCell.appendChild(saveButton);

            const cancelCell = row.insertCell();
            const cancelButton = document.createElement("button");
            cancelButton.innerText = "🛇";
            cancelButton.className = "action-editing-button";
            cancelButton.onclick = () => {
                this.table.classList.remove("editing");
                row.classList.remove("editing");
                valueCell.innerText = getValue();
            };
            cancelCell.appendChild(cancelButton);
        }
    }

    private createUIForArray(
        paramName: string,
        paramValue: TemplateParamArray,
        optional: boolean,
        value: unknown,
        level: number,
    ) {
        if (!Array.isArray(value)) {
            console.log(`Mismatched type: ${paramName}`);
            return;
        }

        this.createRow(paramName, optional, undefined, "", level);
        const elmType = paramValue.elementType;
        for (let i = 0; i < value.length; i++) {
            this.createUIForField(
                `[${i}]`,
                elmType,
                false,
                value,
                i,
                level + 1,
            );
        }
    }
    private createUIForField(
        paramName: string,
        paramValue: TemplateParamField,
        optional: boolean,
        valueObject: unknown,
        valueKey: string | number,
        level: number,
    ) {
        switch (paramValue.type) {
            case "array": {
                this.createUIForArray(
                    paramName,
                    paramValue,
                    optional,
                    valueObject?.[valueKey],
                    level,
                );

                break;
            }
            case "object": {
                this.createUIForObject(
                    paramName,
                    paramValue.fields,
                    optional,
                    valueObject?.[valueKey],
                    level,
                );
                break;
            }
            default: {
                this.createUIForScalar(
                    paramName,
                    paramValue,
                    optional,
                    valueObject,
                    valueKey,
                    level,
                );

                break;
            }
        }
    }

    private createUIForObject(
        paramName: string,
        fields: Record<string, TemplateParamFieldOpt>,
        optional: boolean,
        value: unknown,
        level = 0,
    ) {
        const entries = Object.entries(fields);
        if (entries.length === 0) {
            return;
        }

        this.createRow(paramName, optional, undefined, "", level);
        const missingOptionalFields: string[] = [];
        for (const [k, v] of Object.entries(fields)) {
            const fieldValue =
                typeof value === "object" ? value?.[k] : undefined;
            if (v.optional && fieldValue === undefined) {
                missingOptionalFields.push(k);
                break;
            }
            this.createUIForField(
                k,
                v.field,
                v.optional ?? false,
                value,
                k,
                level + 1,
            );
        }
    }

    private createTable() {
        const actions = Array.isArray(this.current)
            ? this.current
            : [this.current];
        this.clearTable();
        for (let i = 0; i < this.actionTemplates.templates.length; i++) {
            const actionTemplate = this.actionTemplates.templates[i];
            const action = actions[i];
            if (action === undefined) {
                break;
            }

            this.createRow("Agent", false, actionTemplate, "agent", 0);
            this.createRow("Action", false, actionTemplate, "name", 0);
            this.createUIForObject(
                "Parameters",
                actionTemplate.parameterStructure.fields,
                false,
                action.parameters,
            );
        }

        if (this.table.children.length !== 0) {
            this.container.appendChild(this.table);
        }
    }
    private clearTable() {
        this.table.remove();
        this.table.replaceChildren();
    }

    private createUI() {
        // for now assume a single action
        const div = this.container;
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

        this.createTable();
    }
}
