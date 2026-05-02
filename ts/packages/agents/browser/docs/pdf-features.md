# Browser Agent — PDF Support

> **Scope:** This document covers the PDF viewing, annotation, and
> knowledge extraction capabilities of the browser agent. For the
> overall architecture, see `browserAgent.md`.

## Overview

The browser agent includes a full-featured PDF viewing system that
intercepts PDF navigation, renders documents using PDF.js, and provides
annotation and text selection capabilities. PDF content can also be
indexed into the knowledge system.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser Tab                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Content Script                                                   ││
│  │ └─ pdfInterceptor.ts: Detects PDF links, redirects to viewer    ││
│  └─────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ Redirect to custom viewer
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PDF Viewer (Extension View)                                         │
│  views/pdfView.html                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Client Components                                                ││
│  │ ├─ pdfViewer.ts: PDF.js rendering, page navigation              ││
│  │ ├─ annotationManager.ts: Create/edit/delete annotations         ││
│  │ ├─ textSelectionManager.ts: Text selection handling             ││
│  │ ├─ pdfJSHighlightManager.ts: Highlight rendering                ││
│  │ ├─ pdfApiService.ts: REST API client                            ││
│  │ └─ pdfSSEClient.ts: Real-time updates via SSE                   ││
│  └─────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ REST API + SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PDF Server (Express)                                                │
│  views/server/                                                       │
│  ├─ server.mts: Express server initialization                       │
│  ├─ core/baseServer.ts: Base server with CORS, rate limiting        │
│  ├─ core/sseManager.ts: Server-sent events for real-time updates    │
│  └─ features/pdf/                                                    │
│      ├─ pdfRoutes.ts: REST endpoints                                │
│      ├─ pdfService.ts: PDF processing logic                         │
│      └─ urlDocumentMappingService.ts: URL → document ID mapping     │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ File I/O
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Storage (~/.typeagent/browser/viewstore/)                           │
│  ├─ url-mappings.json: URL → document ID lookup                     │
│  └─ annotations/{docId}/*.json: Per-document annotations            │
└─────────────────────────────────────────────────────────────────────┘
```

## PDF Interception

The content script (`pdfInterceptor.ts`) intercepts PDF navigation to
redirect users to the custom PDF viewer instead of the browser's built-in
PDF viewer.

**Detection triggers:**

- Link clicks ending in `.pdf`
- Direct navigation to PDF URLs
- PDF content-type responses

**Interception flow:**

```
1. User clicks PDF link or navigates to PDF URL
2. pdfInterceptor checks WebSocket connection status
3. If connected: Redirect to typeagent-browser://pdfView?url=<encoded-url>
4. If not connected: Allow default browser PDF handling
```

**WebSocket dependency:**
The interceptor only redirects when the agent WebSocket is connected,
ensuring the PDF server is available. This prevents broken viewer
experiences when the agent is offline.

## PDF Viewer Components

### pdfViewer.ts

Main PDF rendering using PDF.js library (`pdfjs-dist`).

**Capabilities:**

- Multi-page document rendering
- Page navigation (scroll, jump to page)
- Zoom controls
- Text layer for selection
- Annotation layer overlay

### annotationManager.ts

Manages PDF annotations stored separately from the document.

**Annotation types:**

- Highlights (text selection highlights)
- Notes (point annotations with text)
- Rectangles (area highlights)

**Operations:**

- `createAnnotation(type, position, content)`
- `updateAnnotation(id, changes)`
- `deleteAnnotation(id)`
- `getAnnotationsForPage(pageNumber)`

### textSelectionManager.ts

Handles text selection and conversion to annotations.

**Flow:**

```
1. User selects text in PDF
2. textSelectionManager captures selection range
3. Converts to document coordinates
4. Creates highlight annotation via annotationManager
```

### pdfJSHighlightManager.ts

Renders highlight annotations using PDF.js highlight plugin.

**Features:**

- Color-coded highlights
- Hover tooltips
- Click-to-edit functionality

## PDF Server

### Express Server Setup

The PDF server runs as part of the browser agent's view server
(`views/server/server.mts`).

**Configuration:**

- CORS enabled for extension origin
- Rate limiting via `express-rate-limit`
- SSE support for real-time annotation updates

### REST API Endpoints

| Method | Endpoint                               | Purpose                       |
| ------ | -------------------------------------- | ----------------------------- |
| GET    | `/pdf/document/:docId`                 | Get document metadata         |
| GET    | `/pdf/document/:docId/annotations`     | List annotations              |
| POST   | `/pdf/document/:docId/annotations`     | Create annotation             |
| PUT    | `/pdf/document/:docId/annotations/:id` | Update annotation             |
| DELETE | `/pdf/document/:docId/annotations/:id` | Delete annotation             |
| GET    | `/pdf/url-mapping`                     | Get document ID for URL       |
| POST   | `/pdf/url-mapping`                     | Create URL → document mapping |

### SSE Manager

Real-time updates for collaborative annotation (future feature).

**Events:**

- `annotation:created` — New annotation added
- `annotation:updated` — Annotation modified
- `annotation:deleted` — Annotation removed

### URL-Document Mapping Service

Maps PDF URLs to stable document IDs for annotation storage.

**Purpose:**
PDFs accessed via different URLs (direct link vs. redirect) should share
annotations. The mapping service creates a stable document ID based on
content hash or canonical URL.

**Storage:** `~/.typeagent/browser/viewstore/url-mappings.json`

## Storage Structure

```
~/.typeagent/browser/viewstore/
├── url-mappings.json
│   {
│     "https://example.com/doc.pdf": "doc_abc123",
│     "https://cdn.example.com/doc.pdf": "doc_abc123"
│   }
└── annotations/
    └── doc_abc123/
        ├── highlight_001.json
        ├── highlight_002.json
        └── note_001.json
```

**Annotation file format:**

```json
{
  "id": "highlight_001",
  "type": "highlight",
  "pageNumber": 3,
  "position": {
    "x": 100,
    "y": 200,
    "width": 300,
    "height": 20
  },
  "content": {
    "text": "selected text",
    "color": "#ffff00",
    "note": "User's note about this highlight"
  },
  "createdAt": "2026-04-29T10:00:00Z",
  "updatedAt": "2026-04-29T10:00:00Z"
}
```

## Knowledge Integration

PDF content can be extracted and indexed into the knowledge system.

**Extraction flow:**

```
1. PDF opened in viewer
2. User triggers knowledge extraction (or auto-indexing enabled)
3. PDF text extracted via PDF.js text layer
4. Text sent to knowledge extraction pipeline
5. Entities, topics, relationships extracted
6. Indexed with PDF URL as source
```

**Searchable metadata:**

- Document title (from PDF metadata)
- Full text content
- User annotations and notes
- Extracted entities and topics

## Key Source Files

| File                           | Location                     | Purpose                          |
| ------------------------------ | ---------------------------- | -------------------------------- |
| `pdfInterceptor.ts`            | `extension/contentScript/`   | PDF link/navigation interception |
| `pdfView.html`                 | `extension/views/`           | PDF viewer HTML shell            |
| `pdfViewer.ts`                 | `views/client/pdf/`          | PDF.js rendering                 |
| `annotationManager.ts`         | `views/client/pdf/`          | Annotation CRUD                  |
| `textSelectionManager.ts`      | `views/client/pdf/`          | Text selection handling          |
| `pdfJSHighlightManager.ts`     | `views/client/pdf/`          | Highlight rendering              |
| `pdfApiService.ts`             | `views/client/pdf/`          | REST API client                  |
| `pdfSSEClient.ts`              | `views/client/pdf/`          | SSE client for updates           |
| `server.mts`                   | `views/server/`              | Express server entry             |
| `pdfRoutes.ts`                 | `views/server/features/pdf/` | REST endpoints                   |
| `pdfService.ts`                | `views/server/features/pdf/` | PDF processing logic             |
| `urlDocumentMappingService.ts` | `views/server/features/pdf/` | URL mapping service              |

## Dependencies

| Package              | Purpose              |
| -------------------- | -------------------- |
| `pdfjs-dist`         | PDF rendering engine |
| `express`            | HTTP server          |
| `express-rate-limit` | API rate limiting    |
