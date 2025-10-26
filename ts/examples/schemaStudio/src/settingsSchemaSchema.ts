export interface CreateSchemaAction {
    actionName: "createSchemaAction";
    parameters: {

        // The schema definition in TypeScript Schema format
        /* Example: 
            // An action to dim or brighten the screen
            export interface DimBrightNessAction {
                actionName: "dimBrightNessAction";
                parameters: {
                    // the original request of the user
                    originalRequest: string;
                    id: "dim_brightness";
                    uri: "ms-settings:display-advanced";
                };
            }
        */
        schema: string; 
    }
}