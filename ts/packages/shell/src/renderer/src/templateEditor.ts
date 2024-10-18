// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TemplateFieldArray,
    TemplateField,
    TemplateFieldOpt,
    TemplateFieldScalar,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { TemplateData, TemplateEditConfig } from "agent-dispatcher";
import { getClientAPI } from "./main";

function isValidValue(paramField: TemplateFieldScalar, value: any) {
    return paramField.type === "string-union"
        ? paramField.typeEnum.includes(value)
        : typeof value === paramField.type && value !== "";
}

function cloneTemplateData(
    templateData: TemplateData | TemplateData[],
): TemplateData[] {
    const clone = Array.isArray(templateData) ? templateData : [templateData];

    return clone.map((d) => {
        return {
            data: structuredClone(d.data),
            schema: d.schema,
        };
    });
}

class FieldContainer {
    private current: TemplateData[];
    public readonly table: HTMLTableElement;
    private root: FieldRootArray;
    public errorCount = 0;
    public editMode = false;
    private editingField: FieldScalar | undefined;

    constructor(
        public readonly actionTemplates: TemplateEditConfig,
        public readonly enableEdit: boolean,
    ) {
        this.table = document.createElement("table");
        this.current = cloneTemplateData(actionTemplates.templateData);
        this.root = new FieldRootArray(
            this,
            "Actions",
            actionTemplates.defaultTemplate,
        );
    }

    public reset() {
        this.editingField = undefined;
        this.errorCount = 0;

        this.current = cloneTemplateData(this.actionTemplates.templateData);
        this.table.replaceChildren();
        this.root = new FieldRootArray(
            this,
            "Actions",
            this.actionTemplates.defaultTemplate,
        );
    }

    public getProperty(name: string) {
        if (name === "") {
            return this.current;
        }
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

    public async refreshSchema(index: number) {
        this.editingField = undefined;

        this.current[index].schema = await getClientAPI().getTemplateSchema(
            this.actionTemplates.templateAppAgent,
            this.actionTemplates.templateName,
            this.current[index].data,
        );
        this.root.refresh();
    }

    public getSchemaValue(): any {
        return this.root.getSchemaValue();
    }
    public setEditing(field: FieldScalar | undefined) {
        const editingField = this.editingField;
        if (editingField === field || editingField?.stopEditing() === false) {
            return undefined;
        }
        this.editingField = field;
        field?.startEditing();
        return editingField;
    }
}

class FieldRow {
    private readonly buttonCells: HTMLElement[] = [];
    protected readonly row: HTMLTableRowElement;
    protected readonly valueCell: HTMLTableCellElement;
    constructor(
        label: string,
        protected readonly level: number,
        parent: FieldGroup | undefined,
    ) {
        const row = document.createElement("tr");
        const nameCell = row.insertCell();
        nameCell.className = "name-cell";

        const labelDiv = document.createElement("div");
        labelDiv.style.paddingLeft = `${this.level * 20}px`;
        labelDiv.innerText = label;
        labelDiv.className = "name-div";
        nameCell.appendChild(labelDiv);

        const valueCell = row.insertCell();
        valueCell.className = "value-cell";

        this.row = row;
        this.valueCell = valueCell;

        if (parent !== undefined) {
            parent.insertAfter(row);
        }
    }

    public addButton(
        index: number,
        iconChar: string,
        className: string,
        onclick: () => void,
    ) {
        if (index >= this.buttonCells.length) {
            for (let i = this.buttonCells.length; i <= index; i++) {
                const buttonCell = this.row.insertCell();
                this.buttonCells.push(buttonCell);
            }
        }

        const buttonCell = this.buttonCells[index];
        buttonCell.className = "button-cell";
        const button = document.createElement("button");
        button.innerText = iconChar;
        button.className = className;
        button.onclick = onclick;
        buttonCell.appendChild(button);

        return button;
    }

    public showButton(index: number, show: boolean) {
        const buttonCell = this.buttonCells[index];
        buttonCell.style.visibility = show ? "visible" : "hidden";
    }

    public removeButton(index: number) {
        this.buttonCells[index].replaceChildren();
    }

    public remove() {
        this.row.remove();
    }
}

abstract class FieldBase extends FieldRow {
    private isValid: boolean = true;
    constructor(
        protected readonly data: FieldContainer,
        public readonly fullPropertyName: string,
        label: string,
        protected readonly optional: boolean,
        protected readonly level: number,
        private readonly parent: FieldGroup | undefined,
    ) {
        super(label, level, parent);
        if (parent === undefined) {
            this.data.table.appendChild(this.row);
        }
    }

    public isAncestor(field: FieldBase): boolean {
        let parent: FieldBase | undefined = this;
        while (parent) {
            if (parent === field) {
                return true;
            }
            parent = parent.parent;
        }
        return false;
    }

    public getNextField(): FieldBase | undefined {
        return this.parent?.findNextField(this);
    }

    public abstract startEditingField(propertyName: string);
    public abstract getScalarField(): FieldScalar | undefined;
    public abstract getSchemaValue(): any;
    protected abstract isValidValue(value: any): boolean;

    public insertAfter(row: HTMLTableRowElement) {
        this.row.after(row);
    }
    public remove() {
        if (!this.isValid) {
            this.data.errorCount--;
        }
        super.remove();
    }
    public updateValueDisplay(updateParent: boolean = false) {
        const value = this.getValue();
        if (value !== undefined) {
            this.setMissing(false);
            this.setValid(this.isValidValue(value));
            this.valueCell.innerText =
                typeof value === "object" ? "" : value.toString();
        } else {
            this.setMissing(true);
            this.setValid(this.optional);
            this.valueCell.innerText = "";
        }

        if (updateParent) {
            this.parent?.updateValueDisplay();
        }
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

    private setMissing(missing: boolean) {
        if (this.optional) {
            if (missing) {
                this.row.classList.add("missing");
            } else {
                this.row.classList.remove("missing");
            }
        }
    }

    protected getValue() {
        return this.data.getProperty(this.fullPropertyName);
    }
    protected setValue(value: any) {
        this.data.setProperty(this.fullPropertyName, value);
        this.updateValueDisplay(true);
    }
    public deleteValue() {
        this.setValue(undefined);
    }
}

abstract class FieldGroup extends FieldBase {
    protected readonly fields: FieldBase[] = [];

    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        label: string,
        optional: boolean,
        level: number,
        parent: FieldGroup | undefined,
    ) {
        super(data, fullPropertyName, label, optional, level, parent);
    }

    public startEditingField(propertyName: string) {
        if (!propertyName.startsWith(this.fullPropertyName)) {
            return false;
        }
        for (const field of this.fields) {
            if (field.startEditingField(propertyName)) {
                return true;
            }
        }
        return false;
    }
    public getScalarField() {
        return this.fields[0]?.getScalarField();
    }

    public findNextField(field: FieldBase): FieldBase | undefined {
        const index = this.fields.indexOf(field);
        if (index !== -1 && index + 1 < this.fields.length) {
            return this.fields[index + 1];
        }
        return super.getNextField();
    }
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
        fieldType: TemplateField,
        optional: boolean,
    ) {
        const field = createUIForField(
            this.data,
            this.fullPropertyName === ""
                ? `${fieldName}`
                : `${this.fullPropertyName}.${fieldName}`,
            label,
            fieldType,
            optional,
            this.level + 1,
            this,
        );
        this.fields.push(field);
        return field;
    }

    public remove() {
        super.remove();
        this.clearChildFields();
    }

    protected clearChildFields() {
        if (this.fields.length !== 0) {
            this.fields.forEach((f) => f.remove());
            this.fields.length = 0;
        }
    }

    protected abstract createChildFields(): void;

    public deleteValue() {
        super.deleteValue();
        this.clearChildFields();
    }
}

const defaultTemplatParamScalar = { type: "string" } as const;
class FieldScalar extends FieldBase {
    private input?: HTMLInputElement;
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        label: string,
        private readonly fieldType: TemplateFieldScalar = defaultTemplatParamScalar,
        optional: boolean = false,
        level: number = 0,
        parent?: FieldGroup,
    ) {
        super(data, fullPropertyName, label, optional, level, parent);
        this.updateValueDisplay();

        if (data.enableEdit && this.fieldType !== defaultTemplatParamScalar) {
            const input = this.createInputElement();
            this.input = input;
            const valueCell = this.valueCell;
            valueCell.onclick = () => {
                if (!this.data.editMode) {
                    return;
                }

                this.data.setEditing(this);
            };

            if (input.tagName.toLowerCase() === "input") {
                (input as HTMLInputElement).addEventListener(
                    "keydown",
                    (event) => {
                        switch (event.key) {
                            case "Enter":
                                event.preventDefault();
                                this.data.setEditing(
                                    this.getNextField()?.getScalarField(),
                                );
                                break;
                        }
                    },
                );
            }
        }
    }
    public startEditingField(propertyName: string) {
        if (this.fullPropertyName === propertyName) {
            this.data.setEditing(this);
            return true;
        }
        return false;
    }

    private getInputValue(type: string, input: HTMLInputElement) {
        if (type === "boolean") {
            return input.checked;
        }
        const inputValue = input.value;
        if (type === "number") {
            const value = parseInt(inputValue);
            if (value.toString() === inputValue) {
                return value;
            }
        }
        return inputValue === "" ? undefined : inputValue;
    }

    public startEditing() {
        const input = this.input;
        if (input === undefined) {
            return;
        }

        this.row.classList.add("editing");

        const valueCell = this.valueCell;
        input.value = valueCell.innerText;
        valueCell.replaceChildren(input);
        input.focus();
    }

    public stopEditing() {
        const input = this.input;
        if (input === undefined) {
            return true;
        }
        const fieldType = this.fieldType;
        const newValue = this.getInputValue(fieldType.type, input);
        this.row.classList.remove("editing");
        this.setValue(newValue);

        if (
            fieldType.type === "string-union" &&
            fieldType.discriminator !== undefined &&
            fieldType.discriminator !== newValue
        ) {
            // Need to refresh the schema
            this.data.refreshSchema(
                parseInt(this.fullPropertyName.split(".")[0]),
            );
            return false;
        }
        return true;
    }

    public getScalarField(): FieldScalar | undefined {
        return this;
    }

    public getSchemaValue() {
        return this.getValue();
    }
    private createInputElement() {
        const element: HTMLInputElement = document.createElement("input");
        switch (this.fieldType.type) {
            case "string":
            case "number":
                element.type = "text";
                return element;
            case "boolean":
                element.type = "checkbox";
                return element;
            case "string-union":
                element.type = "text";
                const typeEnum = this.fieldType.typeEnum;
                element.oninput = () => {
                    const value = element.value;
                    if (typeEnum.includes(value)) {
                        this.setValid(true);
                    } else {
                        this.setValid(false);
                    }
                };
                return element;
        }
    }

    protected isValidValue(value: any) {
        return isValidValue(this.fieldType, value);
    }
}

const enum ButtonIndex {
    add = 2,
    up = 0,
    down = 1,
    delete = 3,
    cancel = 3,
}

class FieldObject extends FieldGroup {
    private readonly hasRequiredFields: boolean;
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        paramName: string,
        private readonly fieldTypes: Record<string, TemplateFieldOpt>,
        optional: boolean = false,
        level = 0,
        parent?: FieldGroup,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);
        const fields = Object.values(fieldTypes);
        this.hasRequiredFields =
            fields.length === 0 ||
            Object.values(fields).some((f) => !f.optional);
        this.updateValueDisplay();
        this.createChildFields();
    }

    protected isValidValue(value: any) {
        // Missing required fields will count as errors already
        return (
            this.hasRequiredFields ||
            (typeof value === "object" && !Array.isArray(value))
        );
    }

    protected createChildFields() {
        this.clearChildFields();
        for (const [k, v] of Object.entries(this.fieldTypes)) {
            const optional = v.optional ?? false;
            const field = this.createChildField(k, k, v.field, optional);

            if (this.data.enableEdit && optional) {
                field.addButton(
                    ButtonIndex.delete,
                    "✕",
                    "action-button delete-button",
                    () => {
                        field.deleteValue();
                    },
                );
            }
        }
    }

    public getSchemaValue() {
        const value: Record<string, any> = {};
        const fieldEntries = Object.entries(this.fieldTypes);
        for (let i = 0; i < fieldEntries.length; i++) {
            const name = fieldEntries[i][0];
            const field = this.fields[i];
            value[name] = field.getSchemaValue();
        }
        return value;
    }
}

abstract class FieldArrayBase extends FieldGroup {
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        paramName: string,
        optional: boolean,
        level: number,
        parent: FieldGroup | undefined,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);

        if (data.enableEdit) {
            this.addButton(ButtonIndex.add, "➕", "action-button", () => {
                const index = this.appendNewValue();
                this.createChildIndex(index);

                if (index !== 0) {
                    this.updateArrows(this.fields[index - 1], index - 1);
                }
            });
        }
    }

    protected isValidValue(value: any) {
        return Array.isArray(value) && value.length !== 0;
    }

    public getSchemaValue() {
        return this.fields.map((f) => f.getSchemaValue());
    }

    protected createChildFields() {
        this.clearChildFields();

        const items = this.getArray()?.length ?? 0;
        for (let i = 0; i < items; i++) {
            this.createChildIndex(i);
        }
    }

    protected abstract appendNewValue();
    protected abstract getArray();
    protected abstract createChildIndexField(index: number): FieldBase;

    private updateArrows(field: FieldBase, index: number) {
        field.showButton(0, index !== 0);
        field.showButton(1, index + 1 !== this.getArray()?.length);
    }

    private swap(indexA: number, indexB: number) {
        const value = this.getArray();
        if (value) {
            // Stop current editing first
            const editingField = this.data.setEditing(undefined);

            // Determine if we need to reselect the editing field
            let editingFieldName: string | undefined;
            if (editingField) {
                const fieldA = this.fields[indexA];

                if (editingField?.isAncestor(fieldA)) {
                    const selectedSuffix =
                        editingField.fullPropertyName.substring(
                            fieldA.fullPropertyName.length,
                        );
                    editingFieldName = `${this.fullPropertyName}.${indexB}${selectedSuffix}`;
                } else {
                    const fieldB = this.fields[indexB];
                    if (editingField?.isAncestor(fieldB)) {
                        const selectedSuffix =
                            editingField.fullPropertyName.substring(
                                fieldB.fullPropertyName.length,
                            );
                        editingFieldName = `${this.fullPropertyName}.${indexA}${selectedSuffix}`;
                    }
                }
            }

            // Swap the value and recreate the fiels.
            const item = value.splice(indexA, 1)[0];
            value.splice(indexB, 0, item);
            this.createChildFields();

            // reselecting the editing field
            if (editingFieldName) {
                this.startEditingField(editingFieldName);
            }
        }
    }
    protected createChildIndex(index: number) {
        const field = this.createChildIndexField(index);
        field.addButton(ButtonIndex.up, "⬆", "action-button", () => {
            this.swap(index, index - 1);
        });
        field.addButton(ButtonIndex.down, "⬇", "action-button", () => {
            this.swap(index, index + 1);
        });

        this.updateArrows(field, index);
        field.addButton(
            ButtonIndex.delete,
            "✕",
            "action-button delete-button",
            () => {
                const value = this.getArray();
                if (value) {
                    const editingField = this.data.setEditing(undefined);
                    let isEditing = editingField?.isAncestor(field);

                    value.splice(index, 1);
                    this.createChildFields();

                    if (value.length === 0) {
                        this.setValid(false);
                    } else if (isEditing) {
                        if (index < this.fields.length) {
                            this.data.setEditing(
                                this.fields[index].getScalarField(),
                            );
                        } else {
                            this.data.setEditing(
                                this.fields[
                                    this.fields.length - 1
                                ].getScalarField(),
                            );
                        }
                    }
                }
            },
        );

        return field;
    }
}

class FieldArray extends FieldArrayBase {
    constructor(
        data: FieldContainer,
        fullPropertyName: string,
        paramName: string,
        private readonly paramValue: TemplateFieldArray,
        optional: boolean,
        level: number,
        parent: FieldGroup | undefined,
    ) {
        super(data, fullPropertyName, paramName, optional, level, parent);
        this.updateValueDisplay();
        this.createChildFields();
    }

    protected appendNewValue() {
        const value = this.ensureArray();
        const index = value.length;
        value.push(undefined);
        this.setValid(true);
        return index;
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

    protected createChildIndexField(index: number) {
        return this.createChildField(
            index,
            `[${index}]`,
            this.paramValue.elementType,
            false,
        );
    }
    protected getArray() {
        const value = this.getValue();
        return Array.isArray(value) ? value : undefined;
    }
}

class FieldRootArray extends FieldArrayBase {
    constructor(
        data: FieldContainer,
        label: string,
        private readonly defaultTemplate: TemplateSchema,
    ) {
        super(data, "", label, false, 0, undefined);
        this.updateValueDisplay();
        this.createChildFields();
    }
    protected appendNewValue() {
        const value = this.getArray();
        const index = value.length;
        value.push({
            data: {},
            schema: this.defaultTemplate,
        });
        this.setValid(true);
        return index;
    }
    protected getArray() {
        return this.getValue() as TemplateData[];
    }
    protected createChildIndexField(index: number) {
        return this.createChildField(
            `${index}.data`,
            `[${index}]`,
            this.getArray()[index].schema,
            false,
        );
    }

    public refresh() {
        this.createChildFields();
    }
}

function createUIForField(
    data: FieldContainer,
    fullPropertyName: string,
    paramName: string,
    paramField: TemplateField,
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

class FieldEditor {
    private data: FieldContainer;

    constructor(
        appendTo: HTMLElement,
        actionTemplates: TemplateEditConfig,
        enableEdit = true,
    ) {
        this.data = new FieldContainer(actionTemplates, enableEdit);
        appendTo.appendChild(this.data.table);
    }

    public get value() {
        return this.data.getSchemaValue();
    }

    public get hasErrors() {
        return this.data.errorCount !== 0;
    }

    public reset() {
        this.data.reset();
    }

    public setEditMode(editMode: boolean) {
        this.data.editMode = editMode;
    }
}

export class TemplateEditor {
    private readonly container: HTMLDivElement;
    private readonly fieldEditor: FieldEditor;
    private readonly preface: HTMLDivElement;
    private editMode = false;

    constructor(
        appendTo: HTMLElement,
        private readonly actionTemplates: TemplateEditConfig,
        private readonly enableEdit = true,
    ) {
        this.container = document.createElement("div");
        this.container.className = "action-text";
        appendTo.appendChild(this.container);

        this.preface = document.createElement("div");
        this.container.appendChild(this.preface);

        this.preface.innerText = this.actionTemplates.preface ?? "";

        this.fieldEditor = new FieldEditor(
            this.container,
            actionTemplates,
            enableEdit,
        );
    }

    public get value() {
        return this.fieldEditor.value;
    }

    public get hasErrors() {
        return this.fieldEditor.hasErrors;
    }

    public reset() {
        this.fieldEditor.reset();
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
        this.fieldEditor.setEditMode(editMode);
        if (editMode) {
            this.container.classList.add("action-text-editable");
            this.preface.innerText = this.actionTemplates.editPreface ?? "";
        } else {
            this.container.classList.remove("action-text-editable");
            this.preface.innerText = this.actionTemplates.preface ?? "";
        }
    }

    public remove() {
        this.container.remove();
    }
}
