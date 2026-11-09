## document-processor test app

This sample app is used to interactively test the processing of pdf files and querying the documents using structured schema. You can use it to download pdf files from arxiv and process them.

## Python dependencies

Use Python 3.10 or later. From this directory, install the Python dependencies:

```powershell
python -m pip install --upgrade -r requirements.txt
```

PyMuPDF is pinned to 1.28.2, which bundles MuPDF 1.28.2 with the native Brotli
decoder fix for CVE-2026-111497. Installing or upgrading the separate Python
`brotli` package does not replace this embedded decoder.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
