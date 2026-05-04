# Chatify — Support

## Common questions

**The "Chatify" button doesn't appear in the ribbon after I sideloaded the manifest.**
- Outlook on the Web caches add-ins aggressively. Try a hard reload (Ctrl+Shift+R / Cmd+Shift+R), or close all Outlook tabs and reopen one. If still missing, remove the add-in (My add-ins → Chatify → ⋯ → Remove) and re-add it.

**The chat looks empty or shows only the sender.**
- Chatify renders the **open message**. Forwarded chains expand into separate bubbles, but normal back-and-forth threads (each reply in a separate Graph message) only show the messages embedded in the currently-open one. Open the latest reply to see the full thread.

**Signatures, meeting boilerplate, or "Get Outlook for iOS" still appear in a bubble.**
- The signature stripper is heuristic. If you see a real false-negative, file an issue at <https://github.com/aviv-nevo-silk/chatify/issues> with a sanitized example of the email body and we'll add it to the test fixtures.

**The "Open full screen" link opens a 404.**
- Probably a stale cached version of the add-in JS. Hard reload Outlook. If it persists, file an issue.

**The AI Summarize button doesn't appear.**
- Click the **⚙ AI** cog. The status line tells you why:
  - `✓ Browser AI` / `✓ Ollama: …` — the Summarize chip should be visible. If not, try toggling "Enable AI features" off and back on.
  - `⏳ Browser AI is downloading` — Chrome is fetching Gemini Nano. Click Re-check after a minute.
  - `✗ AI unavailable` — neither backend is reachable. See the [Setup guide](AI_SETUP.md).

**AI Summarize works in the full-screen viewer but not in the Outlook task pane.**
- This is an Outlook iframe restriction. Browser-native AI (Gemini Nano) is blocked inside cross-origin iframes by default. To get AI in the task pane, install Ollama locally and configure `OLLAMA_ORIGINS` to include `https://aviv-nevo-silk.github.io`. Steps in [AI_SETUP.md](AI_SETUP.md#troubleshooting).

**My personal outlook.com account can't drag-drop .eml files.**
- Free outlook.com accounts have limited add-in import paths in the web client. This is a Microsoft account-tier restriction, not a Chatify limitation.

## Reporting bugs

File an issue: <https://github.com/aviv-nevo-silk/chatify/issues/new>

Helpful info to include:
- Outlook host (Outlook on Web / Outlook Desktop / Outlook Mac) + version
- Browser + version (if Web)
- A short description of what you expected vs. what happened
- A screenshot if visual; a sanitized email-body excerpt if a parsing issue (no PII please)

## Source

Chatify is open source: <https://github.com/aviv-nevo-silk/chatify>

## Privacy

See [PRIVACY.md](PRIVACY.md). 100% client-side, no telemetry, no Aviv-hosted backend.
