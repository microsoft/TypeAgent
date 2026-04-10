# image

Image dispatcher agent. This **sample agent** shows how to make calls to varying APIs to create images and show them to the user. Currently the image agent calls Azure OpenAI gpt-image-1 endpoints.

&lt;Deprecated&gt;
[Bing [Image] Search is being Deprecated August 2025](https://learn.microsoft.com/en-us/microsoftsearch/retirement-microsoft-search-bing).

To experiment with lookups, please add your Bing API key to the root **.env** file with the following key:  
**BING_API_KEY**

&lt;/Deprecated&gt;

To experiment with image generation models, please add your API key or configure your gpt-image-1 endpoint in the root **.env** file with the following variable names: AZURE_OPENAI_API_KEY_IMAGE, AZURE_OPENAI_ENDPOINT_IMAGE. For identity based authentication to your endpoint specify the key as identity.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
