import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { conversation } from "../src/index.js";

export type TestContext = {
    cm: conversation.ConversationManager;
};

describe("Conversation Manager", () => {
    test("addEntities", async () => {
        const context = await createTestContext();
        await addEntities(context.cm);
    }, 120000);
});

async function createTestContext(): Promise<TestContext> {
    const cm = await conversation.createConversationManager(
        "testConversation",
        "/data/tests",
        true,
    );
    return {
        cm,
    };
}

async function addEntities(
    testConversation: conversation.ConversationManager,
): Promise<void> {
    const testMessage = "Bach ate pizza while he wrote fugues";
    let entity1: conversation.ConcreteEntity = {
        name: "bach",
        type: ["composer", "person"],
    };
    let entity2: conversation.ConcreteEntity = {
        name: "pizza",
        type: ["food"],
    };
    await testConversation.addMessage(testMessage, [entity1, entity2]);
}
