export interface CreateSchemaAction {
    actionName: "createSchemaAction";
    parameters: {
        schema: string; // The schema definition in TypeScript Schema format
    }
}