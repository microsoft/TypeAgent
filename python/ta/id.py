from azure.identity import DeviceCodeCredential

credential = DeviceCodeCredential()
token = credential.get_token("https://cognitiveservices.azure.com/.default")
print(f"export AZURE_OPENAI_API_KEY={token.token}")
