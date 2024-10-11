// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TemplateParamArray, TemplateParamField } from "common-utils";
import {
    ActionTemplateSequence,
    TemplateParamFieldOpt,
    TemplateParamScalar,
} from "../../preload/electronTypes";

function isValidValue(paramField: TemplateParamScalar, value: any) {
    return paramField.type === "string-union"
        ? paramField.typeEnum.includes(value)
        : typeof value === paramField.type;
}
function toValueType(paramField: TemplateParamScalar, value: string) {
    switch (paramField.type) {
        case "string":
            return value;
        case "string-union":
            return paramField.typeEnum.includes(value) ? value : undefined;
        case "number":
            const mayBeInt = parseInt(value);
            return mayBeInt.toString() === value ? mayBeInt : undefined;

        case "boolean":
            return value === "true"
                ? true
                : value === "false"
                  ? false
                  : undefined;
    }
}

// Track hierarchy of fields for delete
type FieldGroup = {
    row: HTMLTableRowElement;
    fields: FieldGroup[];
};

function removeFieldGroup(fieldGroup: FieldGroup) {
    fieldGroup.fields.forEach((f) => removeFieldGroup(f));
    fieldGroup.row.remove();
}

export class ActionCascade {
    private readonly container: HTMLDivElement;
    private readonly table: HTMLTableElement;
    private current: any;
    private editMode = false;

    private errorCount = 0;
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

    public get hasErrors() {
        return this.errorCount !== 0;
    }

    public reset() {
        this.current = structuredClone(this.actionTemplates.actions);
        this.table.classList.remove("editing");
        this.errorCount = 0;
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
    private createFieldGroup(
        paramName: string,
        valueDisplay: string | undefined,
        optional: boolean = false,
        level: number = 0,
        parent?: FieldGroup,
    ): FieldGroup | undefined {
        if (valueDisplay === undefined && optional) {
            return undefined;
        }
        const row = this.table.insertRow();
        const fieldGroup: FieldGroup = { row, fields: [] };
        const nameCell = row.insertCell();
        nameCell.style.paddingLeft = `${level * 20}px`;
        nameCell.innerText = paramName;
        nameCell.className = "name-cell";

        const valueCell = row.insertCell();
        valueCell.innerText = valueDisplay ?? "";
        valueCell.className = "value-cell";

        if (this.enableEdit) {
            const optionCell = row.insertCell();
            optionCell.className = "button-cell";
            if (optional) {
                const optionalButton = document.createElement("button");
                optionalButton.innerText = "❌";
                optionalButton.className = "action-edit-button";
                optionalButton.onclick = () => {
                    removeFieldGroup(fieldGroup);
                };
                optionCell.appendChild(optionalButton);
            }
        }
        parent?.fields.push(fieldGroup);
        return fieldGroup;
    }

    private createUIForScalar(
        fullPropertyName: string,
        paramName: string,
        paramField: TemplateParamScalar,
        optional: boolean,
        level: number,
        parent: FieldGroup,
    ) {
        const value = this.getProperty(fullPropertyName);
        const valueStr = isValidValue(paramField, value)
            ? value.toString()
            : undefined;
        const fieldGroup = this.createFieldGroup(
            paramName,
            valueStr,
            optional,
            level,
            parent,
        );
        if (fieldGroup === undefined) {
            return;
        }
        const valueCell = fieldGroup.row.cells[1];
        let currentValid = true;
        const setValueValid = (valid: boolean) => {
            if (valid === currentValid) {
                return;
            }

            if (valid) {
                this.errorCount--;
                fieldGroup.row.classList.remove("error");
            } else {
                this.errorCount++;
                fieldGroup.row.classList.add("error");
            }
            currentValid = valid;
        };

        setValueValid(valueStr !== undefined);

        if (this.enableEdit) {
            const row = fieldGroup.row;
            const input = document.createElement("input");
            input.type = "text";
            if (fullPropertyName !== undefined) {
                const editCell = row.insertCell();
                editCell.className = "button-cell";
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

                const saveCell = row.insertCell();
                saveCell.className = "button-cell";
                const saveButton = document.createElement("button");
                saveButton.innerText = "💾";
                saveButton.className = "action-editing-button";
                saveButton.onclick = () => {
                    const newValue = toValueType(paramField, input.value);
                    if (newValue === undefined) {
                        setValueValid(false);
                        return;
                    }

                    setValueValid(true);
                    this.table.classList.remove("editing");
                    row.classList.remove("editing");
                    this.setProperty(fullPropertyName, newValue);
                    valueCell.innerText = input.value;
                };
                saveCell.appendChild(saveButton);

                const cancelCell = row.insertCell();
                cancelCell.className = "button-cell";
                const cancelButton = document.createElement("button");
                cancelButton.innerText = "🛇";
                cancelButton.className = "action-editing-button";
                cancelButton.onclick = () => {
                    this.table.classList.remove("editing");
                    row.classList.remove("editing");
                    const value = this.getProperty(fullPropertyName);
                    const valueStr = isValidValue(paramField, value)
                        ? value.toString()
                        : undefined;

                    valueCell.innerText = valueStr;
                    setValueValid(valueStr !== undefined);
                };
                cancelCell.appendChild(cancelButton);
            }
        }
        return fieldGroup;
    }

    private createUIForArray(
        fullPropertyName: string,
        paramName: string,
        paramValue: TemplateParamArray,
        optional: boolean,
        level: number,
        parent: FieldGroup,
    ) {
        const value = this.getProperty(fullPropertyName);
        const valid = Array.isArray(value);
        const fieldGroup = this.createFieldGroup(
            paramName,
            valid ? "" : undefined,
            optional,
            level,
            parent,
        );
        if (fieldGroup === undefined) {
            return;
        }
        const elmType = paramValue.elementType;
        // Must have at least one.
        const items = valid && value.length !== 0 ? value.length : 1;
        for (let i = 0; i < items; i++) {
            this.createUIForField(
                `${fullPropertyName}.${i}`,
                `[${i}]`,
                elmType,
                false,
                level + 1,
                fieldGroup,
            );
        }
        return fieldGroup;
    }

    private createUIForObject(
        fullPropertyName: string,
        paramName: string,
        fields: Record<string, TemplateParamFieldOpt>,
        optional: boolean = false,
        level = 0,
        parent?: FieldGroup,
    ) {
        const entries = Object.entries(fields);
        if (entries.length === 0) {
            return;
        }

        const value = this.getProperty(fullPropertyName);
        const fieldGroup = this.createFieldGroup(
            paramName,
            typeof value === "object" ? "" : undefined,
            optional,
            level,
            parent,
        );

        if (fieldGroup === undefined) {
            return;
        }
        const missingOptionalFields: string[] = [];
        for (const [k, v] of Object.entries(fields)) {
            const fieldValue =
                typeof value === "object" ? value?.[k] : undefined;
            if (v.optional && fieldValue === undefined) {
                missingOptionalFields.push(k);
                break;
            }
            this.createUIForField(
                `${fullPropertyName}.${k}`,
                k,
                v.field,
                v.optional ?? false,
                level + 1,
                fieldGroup,
            );
        }

        return fieldGroup;
    }

    private createUIForField(
        fullPropertyName: string,
        paramName: string,
        paramField: TemplateParamField,
        optional: boolean,
        level: number,
        parent: FieldGroup,
    ) {
        switch (paramField.type) {
            case "array":
                this.createUIForArray(
                    fullPropertyName,
                    paramName,
                    paramField,
                    optional,
                    level,
                    parent,
                );
                break;

            case "object":
                this.createUIForObject(
                    fullPropertyName,
                    paramName,
                    paramField.fields,
                    optional,
                    level,
                    parent,
                );
                break;

            default:
                this.createUIForScalar(
                    fullPropertyName,
                    paramName,
                    paramField,
                    optional,
                    level,
                    parent,
                );
                break;
        }
    }

    private createTable() {
        this.clearTable();
        for (let i = 0; i < this.actionTemplates.templates.length; i++) {
            const actionTemplate = this.actionTemplates.templates[i];
            const action = this.current[i];
            if (action === undefined) {
                break;
            }

            this.createFieldGroup("Agent", action.translatorName);
            this.createFieldGroup("Action", action.actionName);
            this.createUIForObject(
                `${i}.parameters`,
                "Parameters",
                actionTemplate.parameterStructure.fields,
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

    private getProperty(name: string) {
        const properties = name.split(".");
        let lastName: string | number = "current";
        let curr: any = this;
        for (let i = 0; i < properties.length; i++) {
            const name = properties[i];
            // Protect against prototype pollution
            if (
                name === "__proto__" ||
                name === "constructor" ||
                name === "prototype"
            ) {
                throw new Error(`Invalid property name: ${name}`);
            }
            const maybeIndex = parseInt(name);
            if (maybeIndex.toString() === name) {
                // Array index
                const next = curr[lastName];
                if (next === undefined || !Array.isArray(next)) {
                    return undefined;
                }
                curr = next;
                lastName = maybeIndex;
            } else {
                const next = curr[lastName];
                if (next === undefined || typeof next !== "object") {
                    return undefined;
                }
                curr = next;
                lastName = name;
            }
        }
        return curr[lastName];
    }
    private setProperty(name: string, value: any) {
        const properties = name.split(".");
        let lastName: string | number = "current";
        let curr = this;
        for (let i = 0; i < properties.length; i++) {
            const name = properties[i];
            // Protect against prototype pollution
            if (
                name === "__proto__" ||
                name === "constructor" ||
                name === "prototype"
            ) {
                throw new Error(`Invalid property name: ${name}`);
            }
            const maybeIndex = parseInt(name);
            if (maybeIndex.toString() === name) {
                // Array index
                let next = curr[lastName];
                if (next === undefined || !Array.isArray(next)) {
                    next = [];
                    curr[lastName] = next;
                }
                curr = next;
                lastName = maybeIndex;
            } else {
                let next = curr[lastName];
                if (next === undefined || typeof next !== "object") {
                    next = {};
                    curr[lastName] = next;
                }
                curr = next;
                lastName = name;
            }
        }
        curr[lastName] = value;
    }
}
