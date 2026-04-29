# Test fixtures

JSON snapshots of real email threads, used by:
- `dev.html` — the local mock dev page that renders the chat without needing Outlook
- Vitest unit tests — feed fixtures to renderer functions and assert output

## Why these aren't committed

`tests/fixtures/*.json` is in `.gitignore`. Each file contains real email content from someone's inbox — it doesn't belong in a public repo. The `.gitignore` allows `*.sanitized.json` through, so we can later commit anonymized copies for shareable demos.

## Fixture format

Each fixture is a wrapper around a Microsoft Graph–shaped message array:

```jsonc
{
  "name": "fixture-name",
  "description": "What this fixture tests",
  "captureSource": "where/when this was captured",
  "currentUser": { "name": "...", "address": "..." },
  "conversationId": "Graph conversationId",
  "messages": [
    {
      "id": "Graph message id",
      "conversationId": "...",
      "subject": "...",
      "sender": { "name": "...", "address": "..." },
      "toRecipients": [{ "name": "...", "address": "..." }],
      "ccRecipients": [],
      "sentDateTime": "ISO8601 UTC",
      "receivedDateTime": "ISO8601 UTC",
      "hasAttachments": false,
      "attachments": [],
      "body": { "contentType": "html", "content": "<p>...</p>" },
      "mentions": [{ "id": 1, "mentioned": {...}, "createdBy": {...} }]
    }
  ]
}
```

`messages[]` MUST be ordered chronologically (oldest first). The renderer uses `currentUser.address` to decide which messages render on the right side.

## Capture workflow

The captures so far were done via the M365 MCP server in conversation. To add a new fixture:

1. Identify a thread you want to capture (search by subject, sender, etc.)
2. Use the M365 MCP `outlook_email_search` to find all messages in the conversation
3. Use `read_resource` for each message URI to get the full body
4. Strip the redundant forwarded chain from each message's body — keep only the new content. Each message stands alone in `messages[]`, so the chain is already represented across siblings.
5. Replace `<a>` tags around mention email addresses with `<a class='mention' data-mention-email='...' href='mailto:...'>@Name</a>` so the renderer can style them as pills.
6. Mark RTL paragraphs with `dir='rtl' lang='he'` so the renderer's per-bubble RTL detection has something to work with.
7. Save as `tests/fixtures/<descriptive-name>.json`.

## Existing fixtures

| File | Tests |
|---|---|
| `sentara-forward.json` | 1-message thread, single-bubble rendering |
| `gil-niv-mixed-hebrew.json` | 6 messages, mixed Hebrew/English (RTL per-bubble), @mentions, links, ordered lists, same-sender consecutive messages |

## Fixtures we still want

- `attachment-heavy.json` — message(s) with PDFs, docs, screenshots → tests file-card chips and inline image rendering
- `inline-images.json` — message with `<img src='cid:...'>` references → tests CID resolution
- `single-message.json` — trivial 1-message inbox item → tests graceful empty-thread case
- `long-thread.json` — 20+ messages → tests scrolling, day-divider grouping, performance budget
