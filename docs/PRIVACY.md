# Chatify — Privacy policy

_Last updated: May 4, 2026_

## Summary

Chatify is an Outlook add-in that re-renders the email currently open in your reading pane as a WhatsApp-style chat. **All processing is client-side. Chatify does not transmit your email content to any external service or backend.** No telemetry, no analytics, no tracking.

## What Chatify reads

When you open a message in Outlook and activate the Chatify task pane, the add-in uses Microsoft's Office.js API to read the **single message currently open in the reading pane**:

- The HTML body of the message
- Sender, recipient list, and subject
- Sent / received timestamps
- The list of attachments (file names and sizes only — content is not read)
- The participant list of the conversation

The add-in declares a single permission, `ReadItem`, which scopes its access to read-only on the open message. Chatify cannot send mail, modify your inbox, delete messages, or read other folders or messages.

## What Chatify sends to a server

**Nothing.** All rendering, parsing, signature stripping, RTL detection, and bubble layout is done in JavaScript that runs inside your Outlook task pane in your browser. There is no Chatify-operated backend.

## Optional AI features

Chatify includes opt-in summarization features that generate a "TL;DR" or an "action items" list from the rendered conversation. These features call an LLM that runs **on the user's own machine or browser**:

- **Browser AI (Gemini Nano)** — Chrome's built-in language model. Runs entirely on-device. The browser handles model downloads via `chrome://components/`. No data leaves the device.
- **Ollama** — an optional locally-installed LLM server (`http://localhost:11434`). The user installs and configures Ollama themselves; Chatify only calls the local endpoint.

If neither backend is configured, the AI features are simply hidden — no calls are made. Chatify does not include any cloud-based AI integration.

The text sent to the local LLM is the rendered conversation text (subject + per-bubble sender, time, and content). This text never leaves the user's machine.

## What Chatify stores locally

Chatify uses `localStorage` (your browser's local storage, scoped to the Chatify origin) to persist a few small preferences:

- The last fixture you picked on the dev page (development tool only)
- The conversation last shown in the live task pane, so the optional full-screen viewer can mirror it
- AI feature settings: enabled state, preferred backend, configured Ollama host/model
- A short-lived (~1 hour TTL) probe cache to avoid re-checking AI backend availability on every render

This data lives on your device only. It is never uploaded.

## What Chatify does NOT do

- Does not transmit any email content to any external service.
- Does not request, send, or store any credentials, API keys, or auth tokens.
- Does not include analytics, telemetry, crash reporting, or third-party tracking scripts.
- Does not access folders, mailboxes, calendars, contacts, or files other than the open message.
- Does not modify, delete, send, or reply to messages.

## Static asset hosting

Chatify is hosted as static files on GitHub Pages. When the task pane loads, your browser fetches the JavaScript, CSS, and image assets from the published site (currently `https://aviv-nevo-silk.github.io/chatify/`). GitHub may log standard HTTP request metadata (IP address, user agent, requested path) per their own privacy policy. Chatify itself does not log, collect, or process this data.

## Inline images in messages

When Chatify renders an email body, inline `<img>` tags are passed through to the browser if their source is `https://`, `cid:`, or `data:`. `http:` and `javascript:` URLs are stripped. The images load directly from their source — typically Microsoft attachment URLs that the user is already authenticated to via their Outlook session — without going through any Chatify server.

## Open source

Chatify's full source code is published on GitHub: <https://github.com/aviv-nevo-silk/chatify>. You are welcome to audit any of the behavior described above.

## Contact

For questions about this policy or the add-in's behavior, file an issue at the GitHub repo above, or contact the developer at the email listed on the AppSource listing.

## Changes

This policy will be updated if Chatify's data handling changes. The "Last updated" date at the top reflects the most recent revision. Significant changes will be announced in the GitHub repository's release notes.
