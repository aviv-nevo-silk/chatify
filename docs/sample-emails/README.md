# Sample emails for testing Chatify in Outlook

Three `.eml` files you can drag into your Outlook inbox to see how Chatify renders different thread shapes. Each file is one Graph message whose body embeds the entire conversation as quoted blocks — the standard Outlook format. Chatify's parser splits the body into separate bubbles.

| File | What it tests |
|---|---|
| `01-forward-chain.eml` | A forwarded support-ticket chain (Robin forwards a 4-deep thread). Tests forward parsing, signature stripping, multi-day rendering. |
| `02-reply-chain.eml` | A 4-message back-and-forth reply thread (Alex ↔ Jordan, Q3 roadmap). Tests reply parsing — Outlook quotes replies in the same format as forwards. |
| `03-mixed-language.eml` | Hebrew + English replies in one thread. Tests per-bubble RTL detection (Hebrew bubbles right-aligned, English left-aligned). |

## Importing into Outlook on the Web (outlook.live.com / outlook.office.com)

1. Open your inbox in the browser.
2. Drag the `.eml` file from your file manager directly onto the **message list area** (where emails are listed). Outlook will display an "Upload to inbox" hint while you hover.
3. Drop. The email appears as a new message in the folder.
4. Open the message. Chatify should activate from the ribbon and render the bubbles.

If drag-drop doesn't work in your version of Outlook on the Web, try Outlook desktop instead.

## Importing into Outlook desktop (Windows / Mac)

1. Double-click the `.eml` file in your file manager. Outlook opens it in a separate read window.
2. From the message window: **File → Move → Other Folder → Inbox** (Windows) or drag the open message into your Inbox (Mac).
3. Open from your Inbox. Chatify should activate and render.

## Sender addresses

The `From:` and `To:` fields use placeholder addresses (`@example.com`). Outlook will display them as-is — there's no SMTP authentication on import, so any addresses work. Feel free to edit `From:`/`To:` lines if you want the messages attributed to specific people in your contact list.

## Generating your own samples

Each sample is plain RFC 5322 with a single HTML body part. The format Chatify recognizes is:

```
<p>...new content...</p>
<hr/>
<p><b>From:</b> Sender Name &lt;sender@domain.com&gt;<br/>
<b>Sent:</b> Day, Month DD, YYYY HH:MM AM/PM<br/>
<b>To:</b> Recipient Name<br/>
<b>Subject:</b> Some subject</p>
<p>...quoted message body...</p>
<hr/>
... repeat for each level of nesting ...
```

Chatify splits on each `<b>From:</b>` marker, parses the quoted headers, and produces one chat bubble per segment. As long as you follow that pattern, you can generate arbitrarily-deep chains.
