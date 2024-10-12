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
    constructor(
        data: any,
        public readonly enableEdit: boolean,
    ) {
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

abstract class FieldBase {
    protected readonly row: HTMLTableRowElement;
    protected readonly valueCell: HTMLTableCellElement;
    private isValid: boolean = true;
    constructor(
        protected readonly data: FieldData,
        protected readonly fullPropertyName: string,
        private readonly label: string,
        private readonly optional: boolean,
        protected readonly level: number,
        parent: FieldGroup | undefined,
    ) {
        const row = document.createElement("tr");
        const nameCell = row.insertCell();
        nameCell.style.paddingLeft = `${this.level * 20}px`;
        nameCell.innerText = this.label;
        nameCell.className = "name-cell";

        const valueCell = row.insertCell();

        valueCell.className = "value-cell";

        if (this.data.enableEdit && this.optional) {
            this.addButton(1, "❌", "action-edit-button", () => {
                this.deleteField();
            });
        }
        if (parent !== undefined) {
            parent?.insertAfter(row);
        } else {
            this.data.table.appendChild(row);
        }
        this.row = row;
        this.valueCell = valueCell;
    }

    public addButton(
        index: number,
        iconChar: string,
        className: string,
        onclick: () => void,
    ) {
        if (this.row.cells.length <= index + 2) {
            for (let i = this.row.cells.length; i <= index + 2; i++) {
                this.row.insertCell();
            }
        }
        const buttonCell = this.row.cells[index + 2];
        buttonCell.className = "button-cell";
        const button = document.createElement("button");
        button.innerText = iconChar;
        button.className = className;
        button.onclick = onclick;
        buttonCell.appendChild(button);
    }

    public abstract getValueDisplay(): string | undefined;
    public insertAfter(row: HTMLTableRowElement) {
        this.row.after(row);
    }

    public remove() {
        if (!this.isValid) {
            this.data.errorCount--;
        }
        this.row.remove();
    }
    protected updateValueDisplay() {
        const valueDisplay = this.getValueDisplay();
        this.setValid(valueDisplay !== undefined);

        if (valueDisplay === undefined && this.optional) {
            this.setVisibility(false);
            return false;
        }
        this.valueCell.innerText = valueDisplay ?? "";
        this.setVisibility(true);
        return true;
    }

    protected setValid(valid: boolean) {
        if (valid === this.isValid) {
            return;
        }
        this.isValid = valid;
        if (valid) {
            this.data.errorCount--;
            this.row.classList.remove("error");
        } else {
            this.data.errorCount++;
            this.row.classList.add("error");
        }
    }
    protected deleteField() {
        // Only optional is deletable. so just visibility to false
        this.setVisibility(false);
        this.setValue(undefined);
    }
    protected getValue() {
        return this.data.getProperty(this.fullPropertyName);
    }
    protected setValue(value: any) {
        this.data.setProperty(this.fullPropertyName, value);
    }

    private setVisibility(visible: boolean) {
        if (visible) {
            this.row.classList.remove("hidden");
        } else {
            this.row.classList.add("hidden");
        }
    }
}

abstract class FieldGroup extends FieldBase {
    private readonly fields: FieldBase[] = [];

    public insertAfter(row: HTMLTableRowElement) {
        if (this.fields.length === 0) {
            super.insertAfter(row);
        } else {
            this.fields[this.fields.length - 1].insertAfter(row);
        }
    }

    protected createChildField(
        fieldName: string | number,
        label: string,
        fieldType: TemplateParamField,
        optional: boolean,
    ) {
        const field = createUIForField(
            this.data,
            `${this.fullPropertyName}.${fieldName}`,
            label,
            fieldType,
            optional,
            this.level + 1,
            this,
        );
        this.fields.push(field);
        return field;
    }
    protected clearChildFields() {
        if (this.fields.length !== 0) {
            this.fields.forEach((f) => f.remove());
            this.fields.length = 0;
        }
    }
    protected abstract createChildFields(): void;

    protected deleteField() {
        super.deleteField();
        this.clearChildFields();
    }
}

const defaultTemplatParamScalar = { type: "string" } as const;
class FieldScalar extends FieldBase {
    constructor(
        data: FieldData,
        fullPropertyName: string,
        label: string,
        private readonly fieldType: TemplateParamScalar = defaultTemplatParamScalar,
        optional: boolean = false,
        level: number = 0,
        parent?: FieldGroup,
    ) {
        super(data, fullPropertyName, label, optional, level, parent);
        this.updateValueDisplay();

        if (data.enableEdit && this.fieldType !== defaultTemplatParamScalar) {
            const input = document.createElement("input");
            input.type = "text";

            const row = this.row;
            const valueCell = this.valueCell;
            this.addButton(0, "✏️", "action-edit-button", () => {
                data.table.classList.add("editing");
                row.classList.add("editing");
                input.value = valueCell.innerText;
                valueCell.replaceChildren(input);
                input.focus();
            });

            this.addButton(2, "💾", "action-editing-button", () => {
                const newValue = toValueType(fieldType, input.value);
                if (newValue === undefined) {
                    this.setValid(false);
                    return;
                }

                this.setValid(true);
                data.table.classList.remove("editing");
                row.classList.remove("editing");
                data.setProperty(fullPropertyName, newValue);
                valueCell.innerText = input.value;
            });

            this.addButton(3, "🛇", "action-editing-button", () => {
                data.table.classList.remove("editing");
                row.classList.remove("editing");
                this.updateValueDisplay();
            });
        }
    }

    public getValueDisplay() {
        const value = this.getValue();
        return isValidValue(this.fieldType, value)
            ? value.toString()
            : undefined;
    }
}

class FieldObject extends FieldGroup {
    constructor(
        data: FieldData,
        fullPropertyName: string,
        paramName: string,
        private readonly fieldTypes: Record<string, TemplateParamFieldOpt>,
        optional: boolean = false,
        level = 0,
        parent?: FieldGroup,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);
        if (this.updateValueDisplay()) {
            this.createChildFields();
        }
    }

    public getValueDisplay() {
        const value = this.getValue();
        return typeof value === "object" ? "" : undefined;
    }

    protected createChildFields() {
        this.clearChildFields();
        for (const [k, v] of Object.entries(this.fieldTypes)) {
            this.createChildField(k, k, v.field, v.optional ?? false);
        }
    }
}

class FieldArray extends FieldGroup {
    constructor(
        data: FieldData,
        fullPropertyName: string,
        paramName: string,
        private readonly paramValue: TemplateParamArray,
        optional: boolean,
        level: number,
        parent: FieldGroup | undefined,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);

        if (data.enableEdit) {
            this.addButton(0, "➕", "action-edit-button", () => {
                const value = this.ensureArray();
                const index = value.length;
                value.push(undefined);
                this.setValid(true);
                this.createChildIndex(index);
            });
        }

        if (this.updateValueDisplay()) {
            this.createChildFields();
        }
    }
    public getValueDisplay() {
        const value = this.getValue();
        return Array.isArray(value) && value.length !== 0 ? "" : undefined;
    }

    protected createChildFields() {
        this.clearChildFields();

        const items = this.getArray()?.length ?? 0;
        for (let i = 0; i < items; i++) {
            this.createChildIndex(i);
        }
    }

    private getArray() {
        const value = this.getValue();
        return Array.isArray(value) ? value : undefined;
    }

    private ensureArray() {
        const value = this.getValue();
        if (Array.isArray(value)) {
            return value;
        }
        const newArray = [];
        this.setValue(newArray);
        return newArray;
    }

    private createChildIndex(index: number) {
        const field = this.createChildField(
            index,
            `[${index}]`,
            this.paramValue.elementType,
            false,
        );
        field.addButton(1, "❌", "action-edit-button", () => {
            const value = this.getArray();
            if (value) {
                value.splice(index, 1);
                this.createChildFields();
                if (value.length === 0) {
                    this.setValid(false);
                }
            }
        });
        return field;
    }
}

function createUIForField(
    data: FieldData,
    fullPropertyName: string,
    paramName: string,
    paramField: TemplateParamField,
    optional: boolean,
    level: number,
    parent: FieldGroup | undefined,
) {
    switch (paramField.type) {
        case "array":
            return new FieldArray(
                data,
                fullPropertyName,
                paramName,
                paramField,
                optional,
                level,
                parent,
            );

        case "object":
            return new FieldObject(
                data,
                fullPropertyName,
                paramName,
                paramField.fields,
                optional,
                level,
                parent,
            );

        default:
            return new FieldScalar(
                data,
                fullPropertyName,
                paramName,
                paramField,
                optional,
                level,
                parent,
            );
    }
}

class FieldContainer {
    private data: FieldData;

    constructor(
        appendTo: HTMLElement,
        private readonly actionTemplates: ActionTemplateSequence,
        enableEdit = true,
    ) {
        this.data = new FieldData(actionTemplates.actions, enableEdit);
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
        this.data.table.replaceChildren();
        for (let i = 0; i < this.actionTemplates.templates.length; i++) {
            const actionTemplate = this.actionTemplates.templates[i];
            const action = this.data.value[i];
            if (action === undefined) {
                break;
            }

            new FieldScalar(this.data, `${i}.translatorName`, "Agent");
            new FieldScalar(this.data, `${i}.actionName`, "Action");
            new FieldObject(
                this.data,
                `${i}.parameters`,
                "Parameters",
                actionTemplate.parameterStructure.fields,
            );
        }
    }
}

export class ActionCascade {
    private readonly container: HTMLDivElement;
    private readonly fieldContainer: FieldContainer;
    private editMode = false;

    constructor(
        appendTo: HTMLElement,
        private readonly actionTemplates: ActionTemplateSequence,
        private readonly enableEdit = true,
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
