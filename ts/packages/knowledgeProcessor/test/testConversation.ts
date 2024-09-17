import { ConversationManager } from "../src/conversation/conversationManager.js";
import { conversation } from "../src/index.js";

test("knowledgeProcessor: testConversation", async () => {
    const testConversation = await conversation.createConversationManager(
        "testConversation",
        "/data/tests",
        true,
    );
    expect(await addEntities(testConversation)).resolves.not.toThrow();
});

async function addEntities(
    testConversation: ConversationManager,
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
