# NT208-AdBlock-Nhom16

Đồ án môn học - Extension chặn quảng cáo Manifest V3".

## AI Sidebar (OpenRouter)

This workspace now includes a client-only AI sidebar that loads from OpenRouter.

### Features

- Hotkey: Ctrl+Shift+K to toggle the sidebar
- Streaming responses with Markdown + code highlighting + copy buttons
- Multi-model compare view (2-4 columns)
- Selection actions: Ask AI, Summarize, Translate, Rewrite, Explain code
- Draggable width, dark/light mode, prompt templates

### Build the sidebar UI

The sidebar UI is a React + Vite + Tailwind app under `sidebar/`.

1. `cd sidebar`
2. `npm install`
3. `npm run build`

The build output goes to `sidebar/dist/`, which the extension loads via `ai-content.js`.

### API key storage

Users enter their OpenRouter API key inside the sidebar. The key is stored using `chrome.storage.local` only.
