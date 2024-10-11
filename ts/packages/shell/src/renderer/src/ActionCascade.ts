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

class FieldData {
    private current: any;
    public readonly table: HTMLTableElement;
    public errorCount = 0;
    constructor(data: any) {
        this.table = document.createElement("table");
        this.current = structuredClone(data);
    }

    public get value() {
        return this.current;
    }

    public set value(data: any) {
        this.current = structuredClone(data);
    }

    public getProperty(name: string) {
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
    public setProperty(name: string, value: any) {
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
class FieldGroup {
    // TODO: Make this private
    public row: HTMLTableRowElement | undefined;
    protected fields: FieldGroup[] = [];
    constructor(
        enableEdit: boolean,
        data: FieldData,
        paramName: string,
        valueDisplay: string | undefined,
        optional: boolean = false,
        level: number = 0,
    ) {
        if (valueDisplay === undefined && optional) {
            return;
        }
        const row = document.createElement("tr");
        const nameCell = row.insertCell();
        nameCell.style.paddingLeft = `${level * 20}px`;
        nameCell.innerText = paramName;
        nameCell.className = "name-cell";

        const valueCell = row.insertCell();
        valueCell.innerText = valueDisplay ?? "";
        valueCell.className = "value-cell";

        if (enableEdit) {
            const optionCell = row.insertCell();
            optionCell.className = "button-cell";
            if (optional) {
                const optionalButton = document.createElement("button");
                optionalButton.innerText = "❌";
                optionalButton.className = "action-edit-button";
                optionalButton.onclick = () => {
                    this.remove();
                };
                optionCell.appendChild(optionalButton);
            }
        }
        this.row = row;
        data.table.appendChild(row);
    }

    public remove() {
        if (this.row) {
            this.fields.forEach((f) => f.remove());
            this.row.remove();
        }
    }
}

class FieldScalar extends FieldGroup {
    constructor(
        enableEdit: boolean,
        data: FieldData,
        fullPropertyName: string,
        paramName: string,
        paramField: TemplateParamScalar,
        optional: boolean,
        level: number,
    ) {
        const value = data.getProperty(fullPropertyName);
        const valueStr = isValidValue(paramField, value)
            ? value.toString()
            : undefined;
        super(enableEdit, data, paramName, valueStr, optional, level);
        if (this.row === undefined) {
            return;
        }
        const row = this.row;
        const valueCell = row.cells[1];
        let currentValid = true;
        const setValueValid = (valid: boolean) => {
            if (valid === currentValid) {
                return;
            }

            if (valid) {
                data.errorCount--;
                row.classList.remove("error");
            } else {
                data.errorCount++;
                row.classList.add("error");
            }
            currentValid = valid;
        };

        setValueValid(valueStr !== undefined);

        if (enableEdit) {
            const input = document.createElement("input");
            input.type = "text";
            if (fullPropertyName !== undefined) {
                const editCell = row.insertCell();
                editCell.className = "button-cell";
                const editButton = document.createElement("button");
                editButton.innerText = "✏️";
                editButton.className = "action-edit-button";
                editButton.onclick = () => {
                    data.table.classList.add("editing");
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
                    data.table.classList.remove("editing");
                    row.classList.remove("editing");
                    data.setProperty(fullPropertyName, newValue);
                    valueCell.innerText = input.value;
                };
                saveCell.appendChild(saveButton);

                const cancelCell = row.insertCell();
                cancelCell.className = "button-cell";
                const cancelButton = document.createElement("button");
                cancelButton.innerText = "🛇";
                cancelButton.className = "action-editing-button";
                cancelButton.onclick = () => {
                    data.table.classList.remove("editing");
                    row.classList.remove("editing");
                    const value = data.getProperty(fullPropertyName);
                    const valueStr = isValidValue(paramField, value)
                        ? value.toString()
                        : undefined;

                    valueCell.innerText = valueStr;
                    setValueValid(valueStr !== undefined);
                };
                cancelCell.appendChild(cancelButton);
            }
        }
    }
}

class FieldObject extends FieldGroup {
    constructor(
        enableEdit: boolean,
        data: FieldData,
        fullPropertyName: string,
        paramName: string,
        fields: Record<string, TemplateParamFieldOpt>,
        optional: boolean = false,
        level = 0,
    ) {
        const entries = Object.entries(fields);
        if (entries.length === 0) {
            return;
        }

        const value = data.getProperty(fullPropertyName);
        super(
            enableEdit,
            data,
            paramName,
            typeof value === "object" ? "" : undefined,
            optional,
            level,
        );

        if (this.row === undefined) {
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
            this.fields.push(
                createUIForField(
                    enableEdit,
                    data,
                    `${fullPropertyName}.${k}`,
                    k,
                    v.field,
                    v.optional ?? false,
                    level + 1,
                ),
            );
        }
    }
}

class FieldArray extends FieldGroup {
    constructor(
        enableEdit: boolean,
        data: FieldData,
        fullPropertyName: string,
        paramName: string,
        paramValue: TemplateParamArray,
        optional: boolean,
        level: number,
    ) {
        const value = data.getProperty(fullPropertyName);
        const valid = Array.isArray(value);
        super(
            enableEdit,
            data,
            paramName,
            valid ? "" : undefined,
            optional,
            level,
        );
        if (this.row === undefined) {
            return;
        }
        const elmType = paramValue.elementType;
        // Must have at least one.
        const items = valid && value.length !== 0 ? value.length : 1;
        for (let i = 0; i < items; i++) {
            this.fields.push(
                createUIForField(
                    enableEdit,
                    data,
                    `${fullPropertyName}.${i}`,
                    `[${i}]`,
                    elmType,
                    false,
                    level + 1,
                ),
            );
        }
    }
}

function createUIForField(
    enableEdit: boolean,
    data: FieldData,
    fullPropertyName: string,
    paramName: string,
    paramField: TemplateParamField,
    optional: boolean,
    level: number,
) {
    switch (paramField.type) {
        case "array":
            return new FieldArray(
                enableEdit,
                data,
                fullPropertyName,
                paramName,
                paramField,
                optional,
                level,
            );

        case "object":
            return new FieldObject(
                enableEdit,
                data,
                fullPropertyName,
                paramName,
                paramField.fields,
                optional,
                level,
            );

        default:
            return new FieldScalar(
                enableEdit,
                data,
                fullPropertyName,
                paramName,
                paramField,
                optional,
                level,
            );
    }
}

class FieldContainer {
    private data: FieldData;

    constructor(
        appendTo: HTMLElement,
        private actionTemplates: ActionTemplateSequence,
        private enableEdit = true,
    ) {
        this.data = new FieldData(actionTemplates.actions);
        this.createFields();
        appendTo.appendChild(this.data.table);
    }

    public get value() {
        return this.data.value;
    }

    public get hasErrors() {
        return this.data.errorCount !== 0;
    }

    public reset() {
        this.data.value = this.actionTemplates.actions;
        this.data.table.classList.remove("editing");
        this.data.errorCount = 0;
        this.createFields();
    }

    private createFields() {
        this.clearTable();
        for (let i = 0; i < this.actionTemplates.templates.length; i++) {
            const actionTemplate = this.actionTemplates.templates[i];
            const action = this.data.value[i];
            if (action === undefined) {
                break;
            }

            new FieldGroup(
                this.enableEdit,
                this.data,
                "Agent",
                action.translatorName,
            );
            new FieldGroup(
                this.enableEdit,
                this.data,
                "Action",
                action.actionName,
            );
            new FieldObject(
                this.enableEdit,
                this.data,
                `${i}.parameters`,
                "Parameters",
                actionTemplate.parameterStructure.fields,
            );
        }
    }

    private clearTable() {
        this.data.table.replaceChildren();
    }
}
export class ActionCascade {
    private readonly container: HTMLDivElement;
    private readonly fieldContainer: FieldContainer;
    private editMode = false;

    constructor(
        appendTo: HTMLElement,
        private actionTemplates: ActionTemplateSequence,
        private enableEdit = true,
    ) {
        this.container = document.createElement("div");
        this.container.className = "action-text";
        appendTo.appendChild(this.container);

        this.createUI();
        this.fieldContainer = new FieldContainer(
            this.container,
            actionTemplates,
            enableEdit,
        );
    }

    public get value() {
        return this.fieldContainer.value;
    }

    public get hasErrors() {
        return this.fieldContainer.hasErrors;
    }

    public reset() {
        this.fieldContainer.reset();
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
    }
}
