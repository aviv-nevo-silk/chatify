# Chatify — Requirements (v0.2)

> **Status:** Decisions locked for v1. Open items deferred to v1.1+ are tagged.
> **Goal:** An Outlook add-in that re-renders an email thread as a group-chat-style conversation (WhatsApp feel), making forwarded chains and long reply chains pleasant to read at a glance.

---

## 1. Problem statement

Forwarded email chains are painful to read. Each level of indentation, each `From:/Sent:/To:/Subject:` block, each quoted reply visually buries the actual content. People parse threads top-down by hand, scrolling past redundant headers and signatures.

A chat-style view solves this:
- **One bubble per message** — no nested headers
- **Color-coded by sender**, current user on the right
- **Chronological top-to-bottom** with day dividers
- **Quoted "from earlier in the thread" rendered as a small inline quote**, not the entire forwarded block

We already proved the visual works (`sentara_email_thread_chat.html` demo). This project turns it into a one-click button inside Outlook.

---

## 2. Users & primary use case

- **Primary user:** Aviv (engineer at Silk) — heavy email user, often receives long forwarded chains with mixed Hebrew/English content
- **Primary use case:** Click "Chatify" on any open email → task pane shows the entire thread as a chat
- **Secondary use cases (later):**
  - Export the chat view as HTML / image to share
  - Per-message AI summarization for very long threads
  - Auto-extract action items / TODOs

---

## 3. Scope — v1 (MVP)

**In scope**
1. **Outlook Web only** (Office.js add-in, sideloaded via manifest). Desktop = v1.1.
2. **Ribbon button "Chatify"** on the message-read surface. No auto-render.
3. Task pane that renders the **current open email's full thread** as chat bubbles
4. Two data sources for the thread, in priority order:
   - **(A) Microsoft Graph API** — fetch all messages with the same `conversationId` (clean structured data, no parsing). Requires `Mail.Read` consent on first run — accepted.
   - **(B) Body parsing fallback** — when Graph isn't available or the thread spans external forwards, parse the email body's `From:/Sent:/To:/Subject:` blocks into discrete messages
5. **Right side = current logged-in user**; everyone else on the left
6. **WhatsApp dark theme only** for v1. Theme switcher = v1.1.
7. Sender color-coding (deterministic hash of email address → color)
8. Day dividers and per-message timestamps
9. **Inline images** — render inside the chat bubble (Graph `/attachments` with `isInline: true`, resolve `cid:` references)
10. **Image attachments** (pasted screenshots, photos) — render as their own image bubble, click to open full-size
11. **File attachments** (PDFs, docs, anything non-image) — render as a file-card chip below the bubble: icon, filename, size, click to download
12. **@mentions** — detected from the HTML body's `<span class="mention">` tags and Graph `mentions[]` metadata; rendered as a colored pill inline (`@FirstName`)
13. **Hebrew/RTL handling** — per-bubble direction detection (not document-level), since threads often mix English and Hebrew replies
14. Builds on the existing `chatify-v0-dec2025` scaffold (Docker https server + sideloaded manifest)

**Explicit non-goals for v1**
- Outlook Classic (Windows COM) and new Outlook desktop — both = v1.1
- Editing / replying from the chat view — read-only
- Local LLM features — v1.1+ (per Section 5)
- Theme switching — v1.1
- Export "Save as HTML" / "Copy as image" — not needed
- Multi-thread merging or search
- Publishing to AppSource — sideload only
- Mobile Outlook — different add-in surface; defer
- Clickable @mention contact cards — pill is visual-only in v1

---

## 4. Architecture (proposed)

```
┌──────────────────────────────┐
│  Outlook Web (any browser)   │
│  ┌────────────────────────┐  │
│  │ Chatify task pane      │  │
│  │  - taskpane.html       │  │
│  │  - chat renderer (TS)  │  │
│  │  - thread fetcher      │  │
│  │  - body parser         │  │
│  │  - LLM client (opt)    │  │
│  └─────────┬──────────────┘  │
└────────────┼─────────────────┘
             │ HTTPS
             ▼
   ┌────────────────────┐         ┌──────────────────────┐
   │ Local dev server   │         │ Microsoft Graph API  │
   │ https://localhost  │         │ (conversation msgs)  │
   │ serves static SPA  │         └──────────────────────┘
   └─────────┬──────────┘
             │ optional
             ▼
   ┌────────────────────┐
   │ Local LLM (Ollama) │
   │ http://localhost:  │
   │ 11434              │
   └────────────────────┘
```

**Tech stack (locked)**
- **Front-end (the add-in itself):** **TypeScript + Vite**. The add-in's runtime is the user's browser inside an iframe Outlook controls — only JavaScript runs there. TypeScript = JS with types, same runtime, better dev experience. **Python is not an option for the front-end** (no browser-side Python interpreter exists for shipping production add-ins).
- No UI framework in v1 — vanilla TS + tiny chat-bubble templates. Adopt React only if templating gets messy.
- **DOMPurify** for HTML body sanitization (must — email HTML is untrusted).
- **Office.js** for Outlook integration (current item, conversation id, SSO token).
- **Microsoft Graph SDK for JavaScript** for fetching the conversation messages + attachments.
- **Auth:** `OfficeRuntime.auth.getAccessToken()` for SSO into Graph.
- **Backend (v1):** none. The browser calls Graph directly.
- **Backend (v1.1, LLM phase):** **Python FastAPI**. Acts as a thin proxy in front of Ollama — prompt templates, caching, structured-output validation, retries. Python is a good fit here (LLM ergonomics, text processing). The TS front-end calls our FastAPI; FastAPI calls Ollama.
- **LLM runtime (v1.1):** Ollama at `http://localhost:11434`, default model `llama3.2:3b`, swappable via config.

---

## 5. Local LLM — where it actually pays off

A local LLM is **not required** for v1. Microsoft Graph gives us structured per-message data with sender, recipients, and timestamp — we can render that as chat bubbles with zero AI involvement.

Where a local LLM **does** earn its keep:

| Feature | Why an LLM (vs. regex/rules) | Worth it for v1? |
|---|---|---|
| Parsing forwarded chains in body text (when Graph misses messages) | Each mail client formats `From:/Sent:` headers differently; Hebrew clients differ again; regex breaks on edge cases. LLMs handle messy structured extraction well. | **Yes — as fallback** when Graph returns < 2 messages |
| Per-message TL;DR ("AI caption" under each long bubble) | Pure summarization — LLMs are good at this. | Optional toggle |
| Auto-tag action items / questions / decisions | Classification | v2 |
| Hebrew↔English captions for mixed threads | Translation | v2 |
| Tone/sentiment chips ("urgent", "thanks") | Cute but gimmicky | Skip |

**Decision for v1:** Graph-only rendering, no LLM calls. But the codebase wires an `LLMClient` interface from day one with a no-op implementation, so adding real backends in v1.1 is plumbing not a refactor.

### 5.1 LLM hosting (when v1.1 lands)

Four candidate hosts, with very different operational profiles:

| Host | Privacy | Cost | Setup | Laptop load | Best for |
|---|---|---|---|---|---|
| Cloud API (OpenAI/Anthropic/Azure) | ❌ email leaves the org | $/call | Zero | None | Quick prototype |
| Self-hosted Ollama on a server | ✅ | Hardware only | Maintain a box | None | Sharing with colleagues |
| Local Ollama on user's laptop | ✅ | Free | Each user installs Ollama | ~30% CPU during inference, idle otherwise | Solo / power users |
| WebGPU in-browser (WebLLM) | ✅ | Free | None — but 1–2 GB model download on first use | Browser GPU usage | Cute demo, ≤3B models only |

**Decision (v1.1+):** Make the LLM backend a config flag. **Default to local Ollama at `http://localhost:11434`** with `llama3.2:3b` (≈2 GB, 30% CPU during inference) — small enough to not melt the laptop, capable enough for parsing/summarization. If colleagues install Chatify later, point the flag at a shared internal Ollama box. The web-vs-desktop Outlook question is moot: the add-in's JavaScript runs in the user's browser tab regardless of Outlook host, so it can call any reachable LLM endpoint.

---

## 6. Decisions (resolved) & remaining open items

### Resolved for v1
| # | Decision |
|---|---|
| Outlook target | Web only |
| Trigger | Ribbon button "Chatify" → task pane |
| Right side | Current logged-in user |
| Theme | WhatsApp dark, single theme |
| Thread fetch | Microsoft Graph (with `Mail.Read` consent), body-parsing fallback |
| LLM in v1 | None — interface stub only, real backend lands v1.1 |
| LLM host (v1.1) | Local Ollama, `llama3.2:3b`, swappable via config |
| Export | Out of scope |
| Images | Render inline in bubble (CID-resolved) or as own image bubble |
| File attachments | File-card chip below bubble |
| @mentions | Styled inline pill, visual only (clickable in v2) |
| Quoted "earlier in thread" snippets | Hide them — we already show the whole thread |
| Distribution | Sideload-only on Aviv's machine |

### Still open (low-stakes, can decide later)
- **Per-bubble copy/forward action menu** — long-press to copy text? Out of scope unless trivial.
- **Message-grouping when same sender posts twice in a row** — WhatsApp visually merges these. Nice-to-have, not blocking.

---

## 7. Acceptance criteria — v1

A run is successful when:
1. Sideloading the manifest.xml in Outlook Web shows a "Chatify" button on opened emails
2. Clicking Chatify on the Sentara thread (the demo we used) renders a chat view visually equivalent to `sentara_email_thread_chat.html` — message-by-message, sender colors, day dividers, current user on the right
3. **Inline images** render embedded in the chat bubble (test: any email with an inline screenshot)
4. **Image attachments** render as their own image bubble, click opens full-size (test: an email with a pasted PNG)
5. **File attachments** render as a file-card chip below the bubble (test: an email with a PDF attached)
6. **@mentions** in the body render as a colored pill inline (test: an email where someone @-mentioned a colleague)
7. **Per-bubble RTL detection** works on a mixed Hebrew/English thread (e.g., the Gil Niv thread mixing English and Hebrew)
8. Empty / single-message threads render gracefully (just one bubble)
9. Total task-pane load time < 2s on a thread of < 30 messages

---

## 8. Out of scope (explicitly rejected for v1)

- Composing replies from the chat view
- Reactions / emoji
- Voice notes / call buttons (no, this is not actually a messenger)
- Searching across threads
- Mobile Outlook (different add-in surface; defer)
- Offline mode

---

## 9. Risks & known gotchas

1. **Office.js doesn't expose siblings of the current message.** Thread fetch goes through Graph (decided). Body-parsing is the fallback only.
2. **`Mail.Read` SSO consent flow** can fail on tenants with strict admin policies. We need a graceful "consent failed → fall back to body-parsing the current message only" path.
3. **CID image resolution.** Inline images are referenced as `cid:abc123@whatever` in the HTML body. We must:
   - Match each `cid:` to its corresponding attachment in the message's `attachments[]`
   - Fetch the bytes (`/me/messages/{id}/attachments/{aid}/$value`) and inline as `data:` URL, OR use Graph's `contentBytes` if pre-loaded
   - Replace the `<img src="cid:...">` in our bubble HTML
4. **Attachment fetch is N+1.** Each message in a thread of 20 may have 0–5 attachments. We should batch attachment fetches per message in parallel and cache by attachment id within the session.
5. **HTML body sanitization.** Email bodies contain arbitrary HTML, including styles, scripts, and remote images that leak read-receipts. We must:
   - Strip `<script>`, event handlers, and `<style>` blocks
   - Either block remote images by default, or proxy/inline them
   - Use a sanitizer (DOMPurify) before injecting into the chat bubble
6. **Self-signed cert sideload UX is ugly.** v0 already handled it; keep using it for dev. For a colleague-shareable build, we'd need a real cert / hosting — out of scope v1.
7. **LLM latency (v1.1+).** A 3B model for body parsing on CPU is ~2–5s per call. Treat LLM calls as "click → spinner → result", never auto-fired.
8. **Per-bubble RTL.** The Gil Niv thread mixed Hebrew and English replies in one chain. We need per-bubble direction detection (first strong character heuristic), not a document-level dir.
9. **@mention extraction quirks.** Outlook stores mentions as both `<span class="mention">` in HTML *and* in the Graph `mentions[]` array — but only when the mention was made via the new Outlook UI. Old-style "Hi @Aviv" plaintext won't appear in `mentions[]`. We should style only the structural ones, not regex-detect plain-text @s (high false-positive rate).

---

## 10. Images, attachments, and mentions — rendering spec

### 10.1 Inline images (CID-referenced in body)
**Detection:** any `<img src="cid:...">` in the HTML body
**Source:** `attachments[]` where `isInline: true` and the matching `contentId`
**Render:** keep inline within the text bubble, exactly where the `<img>` tag was; constrain `max-width: 100%; max-height: 400px; border-radius: 6px`
**Click:** opens full-size in a lightbox over the task pane

### 10.2 Image attachments (pasted screenshots, .png/.jpg/.gif/.webp/.heic with `isInline: false`)
**Render:** their own bubble after the text bubble, no padding around the image
**Footer:** filename + size, small, on hover
**Click:** lightbox

### 10.3 File attachments (anything else)
**Render:** file-card chip below the bubble's text
**Card contains:**
- File-type icon (📄 generic / 📕 PDF / 📊 spreadsheet / 📝 doc / 🗜 archive)
- Filename (truncate with ellipsis if > 40 chars)
- Size (human-readable: "1.4 MB")
- Click → download via Graph `/attachments/{id}/$value`

### 10.4 @mentions
**Detection priority:**
1. Structural — `mentions[]` from Graph + matching `<span class="mention">` in body (high confidence)
2. Plain-text `@FirstName` — **NOT** auto-styled in v1 (too many false positives)

**Render:** inline pill with rounded background, sender's color at 30% opacity, `@FirstName` text in sender's color at full opacity
**Click (v1):** no-op. v2: contact card popover.

### 10.5 Mention pill inside a quoted/forwarded section
Quoted "earlier in thread" content is hidden by default in v1 (we render the whole thread anyway). So mentions inside quotes don't appear twice.

---

## 11. Development & testing workflow

### 11.1 Local dev server
- Reuse v0's setup: `docker-compose up` serves `https://localhost:3001` with self-signed cert
- Vite dev server inside the container, watching the `src/` directory
- Edit `src/*.ts` → Vite rebuilds → reload the task pane in Outlook

### 11.2 Three layers of testing

**Layer 1 — Mock dev page (fastest loop, no Outlook needed)**
- A `/dev.html?fixture=sentara` page renders the chat using fixture JSON files in `tests/fixtures/`
- Fixtures are real Graph-shaped responses captured once from real threads (Sentara, Gil Niv mixed-Hebrew, attachment-heavy thread)
- Use this for 90% of UI work — building bubbles, RTL, mentions, attachments
- Hot reload < 1s

**Layer 2 — Unit tests (Vitest)**
- Pure functions only: `detectRTL`, `senderColorFromEmail`, `parseCidImages`, `extractMentions`, `categorizeAttachment`
- Run in CI / pre-commit (when we add one)

**Layer 3 — Real Outlook smoke test**
- Sideload manifest into Outlook Web
- Open ~5 representative threads (mixed Hebrew, image-heavy, deeply forwarded, single message, with attachments)
- Visual check against acceptance criteria
- Manual; done before each "release" to your own machine

### 11.3 First-run setup checklist (for documentation)
1. Clone repo
2. `docker-compose up -d`
3. Visit `https://localhost:3001` in browser, accept the self-signed cert
4. Open Outlook Web → Settings → My add-ins → Add custom add-in → From file → `manifest.xml`
5. Grant `Mail.Read` consent on first ribbon-button click
6. Done

### 11.4 Test environments — three layers, increasing fidelity

| # | Environment | What it tests | Iteration speed | Risk |
|---|---|---|---|---|
| 1 | **Mock dev page** (`dev.html?fixture=...`) | Renderer logic, RTL, attachments, mentions, themes | < 1s reload | None |
| 2 | **M365 Developer Sandbox tenant** | Sideload, ribbon button, Office.js, Graph SSO, real consent flow, attachment fetch | ~5s reload | None — throwaway tenant |
| 3 | **Real Silk M365 account** (`aviv.nevo@silk.us`) | Real Hebrew/RTL threads, real Sentara-style forwards, real customer-language attachments | ~5s reload | Touches real mailbox; Mail.Read consent on real account |

**Mock dev page:**
- Capture Graph responses once via `mcp__claude_ai_Microsoft_365__outlook_email_search` + `read_resource`, save to `tests/fixtures/*.json`
- Captures we want before scaffolding: Sentara forward thread, Gil Niv mixed-Hebrew thread, an image-attachment thread, a single-message inbox item
- Page renders the chat from the fixture; query string toggles fixture
- Used for ~90% of UI iteration

**M365 Dev Sandbox setup (one-time, ~10 min):**
1. Sign up at https://developer.microsoft.com/en-us/microsoft-365/dev-program with a personal Microsoft account (NOT silk.us)
2. Provision an "Instant sandbox" — Microsoft creates a fresh E5 tenant in 5 min with 25 fake users + sample data pack
3. Tenant URL looks like `aviv-dev.onmicrosoft.com`
4. Sign in to https://outlook.office.com with the new admin user (e.g., `MOD-Admin@aviv-dev.onmicrosoft.com`)
5. Settings → My add-ins → Add custom add-in → from file → `manifest.xml` from this repo
6. Test the ribbon button on the seeded sample emails; iterate freely

Renew the sandbox every 90 days by clicking "extend" in the Dev Program portal. Free indefinitely.

**Pre-flight check on real Silk account (30 sec):**
Before assuming we can sideload on `aviv.nevo@silk.us`:
1. Open `https://outlook.office.com`
2. Settings (gear) → "View all Outlook settings" → search "add-ins"
3. Look for "My add-ins" with an **"Add a custom add-in → Add from file"** option
4. **Present** → tenant allows sideload, we're good. **Missing** → Silk IT blocks sideload; we live in the sandbox until distribution is solved (Phase 3)

If sideload is allowed but `Mail.Read` SSO consent gets denied at runtime, the add-in falls back to body-parsing the currently open message (Section 3.4.B).

### 11.5 Recommended dev sequence
1. Build the **mock dev page** first — see chat rendering working without any Outlook involvement
2. Spin up the **M365 Dev Sandbox** in parallel (5 min sign-up, 5 min provisioning) — note: real Silk account sideload is **blocked by IT**, so the sandbox is the only way to do live Outlook integration testing
3. Sideload the manifest into the **sandbox** for the first real Outlook integration test
4. Only after sandbox passes acceptance criteria → ~~sideload into the Silk account~~ (blocked) → ship as Phase 3 distribution

### 11.6 Edge cases we still need fixtures for ⚠️

Initial fixtures captured (`sentara-forward.json`, `gil-niv-mixed-hebrew.json`) cover forwarded threads, RTL, @mentions, links, lists, and same-sender consecutive bubbles. **The following edge cases are NOT yet covered** — the renderer must be designed to handle them, and a fixture should be captured before each is implemented:

| Edge case | Fixture name (TBD) | What it tests | Risk if missed |
|---|---|---|---|
| **Attachments** (PDFs, docs, archives) | `attachment-heavy.json` | File-card chip rendering, click-to-download wiring | UI breaks the moment any real email has an attachment |
| **Inline images** (CID-referenced) | `inline-images.json` | `cid:` resolution, embedding inside bubble | Most signature blocks, screenshots in tickets, etc. |
| **Image-only attachments** (pasted screenshots) | (covers via inline-images) | Standalone image-bubble layout | Common in support threads |
| **Long thread** (20+ messages) | `long-thread.json` | Day-divider grouping, scroll perf, virtualization need | Performance / UX failure on real long threads |
| **Single-message inbox item** | `single-message.json` | Graceful no-conversation case (e.g., Jenkins build emails) | Crash / empty render |
| **HTML body with `<style>` / `<script>` / external `<img src>` tracking pixels** | `untrusted-html.json` | DOMPurify sanitization, read-receipt blocking | Security / privacy leak |
| **Mention-heavy thread** | `mention-storm.json` | Multiple @mentions in one bubble, chains of mentions | Broken pill layout |
| **Very long single message** (e.g., a quoted incident report) | (within long-thread or separate) | Bubble height cap, "show more" affordance | UI dominated by one bubble |
| **Quoted reply chain WITHOUT siblings in inbox** | `external-forward.json` | Body-parsing fallback when Graph returns < 2 messages | Falls back to single-bubble forwarded content; should it parse? |

**Action:** capture each fixture before implementing the matching feature, so we can validate against real data, not synthetic inputs.

---

## 12. Roadmap & phases

### Phase 1 (v1) — Core chat renderer · current target
Everything in Section 3 ("Scope — v1"). Pure Graph, no LLM, no backend. Outlook Web only.

### Phase 2 (v1.1) — Local LLM features · the "I want it!" phase
**Goal:** Add value the structural renderer can't deliver — content understanding.

**Prep work that must already exist by end of Phase 1:**
- `LLMClient` interface with a no-op implementation, called by the renderer at the right hook points (`beforeMessageRender(msg)`, `afterThreadLoad(thread)`)
- `tests/fixtures/` includes the longer threads we want to summarize, so we can iterate without hitting Outlook
- HTML sanitization layer is in place (so we can safely feed message text to the LLM and back)
- Config flag `CHATIFY_LLM_BACKEND` read from a settings panel in the task pane

**Phase 2 deliverables:**
1. **Python FastAPI backend** at `http://localhost:8765` proxying to Ollama
2. **Ollama setup** (`docker-compose` service), default model `llama3.2:3b` pulled on first run
3. **Forward-parsing fallback:** when Graph returns < 2 messages but the body has visible `From:/Sent:` blocks, send the body to the LLM, get back a `Message[]` JSON, render those
4. **Per-message TL;DR caption:** small italicized one-liner under any bubble whose body is > 500 chars (toggle in settings)
5. **Mixed-language captions:** any bubble whose detected language differs from the user's UI language gets a small "Translate" affordance — click renders an English (or Hebrew) caption beneath
6. **Action-item extraction:** at the top of the task pane, a collapsible "Asks of you" section listing AI-detected action items addressed to the current user

**Phase 2 acceptance criteria:**
- LLM backend swappable between local Ollama and (optionally) a hosted Ollama via single config flag
- All LLM calls have a timeout and a failure path (renderer never breaks because the LLM is down)
- LLM never auto-fires — every call is user-initiated or feature-flagged on
- Phase 1 features still work with `CHATIFY_LLM_BACKEND=none`

### Phase 3 (v1.2) — Reach
- New Outlook desktop + Outlook for Mac (same Office.js add-in, mostly free)
- Theme switcher (iMessage, Telegram, Slack themes)
- Hosted LLM option for sharing with colleagues (shared Ollama box at known URL)
- Real cert / hosted manifest for sideload-by-other-people

### Phase 4 (v2) — Nice-to-haves
- Clickable @mentions → contact card popover
- Same-sender consecutive-message grouping (WhatsApp visual merge)
- "Ask Chatify" — chat with the LLM about the thread
- Multi-thread search across the user's mailbox

---

## 13. Reference

- Existing scaffold: `~/dev/learning/chatify-v0-dec2025/` — manifest.xml, Docker server, taskpane.html with Office.js API explorer buttons. Reuse the manifest + Docker setup; replace taskpane content.
- Visual reference: `~/dev/healthshield/sentara_email_thread_chat.html` — the WhatsApp-style chat we hand-built for the Sentara thread. v1 should produce something visually equivalent.
