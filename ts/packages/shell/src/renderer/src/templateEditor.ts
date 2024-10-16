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
        : typeof value === paramField.type;
}
function toValueType(paramField: TemplateFieldScalar, value: string) {
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
        this.table.classList.remove("editing");
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
        const buttonDiv = document.createElement("div");
        nameCell.appendChild(buttonDiv);
        buttonDiv.className = "left-button-div";

        const labelDiv = document.createElement("div");
        labelDiv.style.paddingLeft = `${this.level * 20}px`;
        labelDiv.innerText = label;
        labelDiv.className = "name-div";
        nameCell.appendChild(labelDiv);

        const button0Div = document.createElement("div");
        buttonDiv.appendChild(button0Div);
        this.buttonCells.push(button0Div);

        const button1Div = document.createElement("div");
        buttonDiv.appendChild(button1Div);
        this.buttonCells.push(button1Div);

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
        protected readonly fullPropertyName: string,
        label: string,
        private readonly optional: boolean,
        protected readonly level: number,
        protected readonly parent: FieldGroup | undefined,
    ) {
        super(label, level, parent);
        if (parent === undefined) {
            this.data.table.appendChild(this.row);
        }
    }

    public abstract getSchemaValue(): any;
    public abstract setDefaultValue();
    public abstract getValueDisplay(): string | undefined;
    public insertAfter(row: HTMLTableRowElement) {
        this.row.after(row);
    }
    public get isVisible() {
        return !this.row.classList.contains("hidden");
    }
    public remove() {
        if (!this.isValid) {
            this.data.errorCount--;
        }
        super.remove();
    }
    protected updateValueDisplay() {
        const valueDisplay = this.getValueDisplay();
        if (valueDisplay === undefined && this.optional) {
            this.setVisibility(false);
            return false;
        }
        this.setValid(valueDisplay !== undefined);
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

    protected getValue() {
        return this.data.getProperty(this.fullPropertyName);
    }
    protected setValue(value: any) {
        this.data.setProperty(this.fullPropertyName, value);
    }
    public deleteValue() {
        // Only optional is deletable. so just visibility to false
        this.setVisibility(false);
        this.setValue(undefined);
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
    protected readonly fields: FieldBase[] = [];

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

    protected updateValueDisplay(): boolean {
        if (super.updateValueDisplay()) {
            this.createChildFields();
            return true;
        }
        return false;
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
            const row = this.row;
            const valueCell = this.valueCell;
            valueCell.onclick = () => {
                if (
                    !this.data.editMode ||
                    this.data.table.classList.contains("editing")
                ) {
                    // If another field is being edited, don't start editing this one.
                    return;
                }

                data.table.classList.add("editing");
                row.classList.add("editing");
                input.value = valueCell.innerText;
                valueCell.replaceChildren(input);
                input.focus();
            };

            const saveButton = this.addButton(
                ButtonIndex.save,
                "💾",
                "action-editing-button",
                () => {
                    const newValue = toValueType(fieldType, input.value);
                    if (newValue === undefined) {
                        this.setValid(false);
                        return;
                    }

                    this.setValid(true);
                    data.table.classList.remove("editing");
                    row.classList.remove("editing");
                    this.setValue(newValue);
                    valueCell.innerText = input.value;

                    if (
                        fieldType.type === "string-union" &&
                        fieldType.discriminator !== newValue
                    ) {
                        // Need to refresh the schema
                        this.data.refreshSchema(
                            parseInt(this.fullPropertyName.split(".")[0]),
                        );
                        return;
                    }
                },
            );

            const cancelButton = this.addButton(
                ButtonIndex.cancel,
                "🛇",
                "action-editing-button",
                () => {
                    data.table.classList.remove("editing");
                    row.classList.remove("editing");
                    this.updateValueDisplay();
                },
            );

            if (input.tagName.toLowerCase() === "input") {
                (input as HTMLInputElement).addEventListener(
                    "keydown",
                    (event) => {
                        switch (event.key) {
                            case "Enter":
                                event.preventDefault();
                                saveButton.click();
                                break;
                            case "Escape":
                                event.preventDefault();
                                cancelButton.click();
                                break;
                        }
                    },
                );
            }
        }
    }

    public getSchemaValue() {
        return this.getValue();
    }
    private createInputElement() {
        let element: HTMLSelectElement | HTMLInputElement;
        switch (this.fieldType.type) {
            case "string":
                element = document.createElement("input");
                element.type = "text";
                return element;
            case "number":
                element = document.createElement("input");
                element.type = "number";
                return element;
            case "boolean":
                element = document.createElement("select");
                element.options.add(new Option("true"));
                element.options.add(new Option("false"));
                return element;
            case "string-union":
                element = document.createElement("select");
                for (const value of this.fieldType.typeEnum) {
                    element.options.add(new Option(value));
                }
                return element;
        }
    }
    public setDefaultValue() {
        switch (this.fieldType.type) {
            case "string":
                this.setValue("");
                break;
            case "number":
                this.setValue(0);
                break;
            case "boolean":
                this.setValue(false);
                break;
            case "string-union":
                this.setValue(this.fieldType.typeEnum[0]);
                break;
        }
        this.updateValueDisplay();
    }

    public getValueDisplay() {
        const value = this.getValue();
        return isValidValue(this.fieldType, value)
            ? value.toString()
            : undefined;
    }
}

class FieldObjectOptionalField extends FieldRow {
    private readonly select: HTMLSelectElement;
    constructor(
        label: string,
        level: number,
        parent: FieldGroup,
        fields: Iterable<string>,
    ) {
        super(label, level, parent);
        this.row.cells[0].classList.add("temp");
        const select = document.createElement("select");
        this.select = select;

        for (const field of fields) {
            select.options.add(new Option(field));
        }
        this.valueCell.appendChild(select);
        this.row.classList.add("editing");
    }

    public get value() {
        return this.select.value;
    }
}

const enum ButtonIndex {
    add = 2,
    up = 0,
    down = 1,
    delete = 3,
    save = 2,
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
    }

    public getValueDisplay() {
        const value = this.getValue();
        // Missing required fields will count as errors already
        return this.hasRequiredFields || typeof value === "object"
            ? ""
            : undefined;
    }

    public setDefaultValue() {
        this.setValue({});
        this.updateValueDisplay();
    }

    protected createChildFields() {
        this.clearChildFields();
        const missingFields = new Map<string, FieldBase>();
        let hasMissingFieldButton = false;
        const updateMissingFieldButton = () => {
            if (missingFields.size === 0) {
                if (!hasMissingFieldButton) {
                    return;
                }
                hasMissingFieldButton = false;
                this.removeButton(ButtonIndex.add);
                return;
            }
            if (hasMissingFieldButton) {
                return;
            }
            hasMissingFieldButton = true;
            this.addButton(ButtonIndex.add, "➕", "action-edit-button", () => {
                this.data.table.classList.add("editing");
                // create a temporary row
                const inputRow = new FieldObjectOptionalField(
                    "<field name>",
                    this.level + 1,
                    this,
                    missingFields.keys(),
                );
                inputRow.addButton(
                    ButtonIndex.save,
                    "💾",
                    "action-editing-button",
                    () => {
                        const fieldName = inputRow.value;

                        const field = missingFields.get(fieldName);
                        if (field === undefined) {
                            return;
                        }
                        missingFields.delete(fieldName);
                        field.setDefaultValue();
                        inputRow.remove();
                        this.data.table.classList.remove("editing");
                        updateMissingFieldButton();
                    },
                );

                inputRow.addButton(
                    ButtonIndex.cancel,
                    "🛇",
                    "action-editing-button",
                    () => {
                        inputRow.remove();
                        this.data.table.classList.remove("editing");
                    },
                );
            });
        };
        for (const [k, v] of Object.entries(this.fieldTypes)) {
            const optional = v.optional ?? false;
            const field = this.createChildField(k, k, v.field, optional);

            if (this.data.enableEdit && optional) {
                if (!field.isVisible) {
                    // Optional field without a value.
                    missingFields.set(k, field);
                }
                field.addButton(
                    ButtonIndex.delete,
                    "✕",
                    "action-edit-button",
                    () => {
                        field.deleteValue();
                        missingFields.set(k, field);
                        updateMissingFieldButton();
                    },
                );
            }
        }
        updateMissingFieldButton();
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
            this.addButton(ButtonIndex.add, "➕", "action-edit-button", () => {
                const index = this.appendNewValue();
                this.createChildIndex(index);

                if (index !== 0) {
                    this.updateArrows(this.fields[index - 1], index - 1);
                }
            });
        }
    }

    public getValueDisplay() {
        const value = this.getValue();
        return Array.isArray(value) && value.length !== 0 ? "" : undefined;
    }

    public setDefaultValue() {
        // Add at least one element to start with.
        this.setValue([undefined]);
        if (this.updateValueDisplay()) {
            this.createChildFields();
        }
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
    protected abstract createChildIndexField(index: number);

    private updateArrows(field: FieldBase, index: number) {
        field.showButton(0, index !== 0);
        field.showButton(1, index + 1 !== this.getArray()?.length);
    }

    protected createChildIndex(index: number) {
        const field = this.createChildIndexField(index);
        field.addButton(ButtonIndex.up, "⬆", "action-edit-button", () => {
            const value = this.getArray();
            if (value) {
                const item = value.splice(index, 1)[0];
                value.splice(index - 1, 0, item);
                this.createChildFields();
            }
        });
        field.addButton(ButtonIndex.down, "⬇", "action-edit-button", () => {
            const value = this.getArray();
            if (value) {
                const item = value.splice(index, 1)[0];
                value.splice(index + 1, 0, item);
                this.createChildFields();
            }
        });

        this.updateArrows(field, index);
        field.addButton(ButtonIndex.delete, "✕", "action-edit-button", () => {
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
