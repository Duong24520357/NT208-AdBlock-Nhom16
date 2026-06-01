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

## Auto PiP

The extension now also supports automatic Picture-in-Picture for playing videos.

- Enable or disable Auto PiP from the popup
- Limit Auto PiP to selected domains from the popup
- Auto PiP now reacts on tab switches and visibility changes
- Video selection prefers the best matching player, including iframe-based players
- Use the "Bật PiP tab này" button to trigger PiP immediately on the current tab
- The feature follows the same browser auto-PiP requirement as Chrome's built-in behavior

### Build the sidebar UI

The sidebar UI is a React + Vite + Tailwind app under `sidebar/`.

1. `cd sidebar`
2. `npm install`
3. `npm run build`

The build output goes to `sidebar/dist/`, which the extension loads via `ai-content.js`.

### API key storage

Users enter their OpenRouter API key inside the sidebar. The key is stored using `chrome.storage.local` only.
