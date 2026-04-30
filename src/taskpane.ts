// Outlook task-pane entry. Uses Office.js to read the currently open email,
// converts it to our Conversation shape, and feeds it to the same renderer
// that powers the dev page. The forward parser does the heavy lifting:
// each email's body usually contains the entire forwarded chain, which it
// expands into separate bubbles.
//
// v1.5 scope: current message only — no Microsoft Graph / SSO yet. That's
// enough for forwarded threads (each Graph message contains its full chain
// in body HTML) but misses the case of normal back-and-forth threads where
// each reply lives as a separate Graph message in the same conversationId.
// Phase 2 will add Graph API to fetch all messages in the conversation.

/// <reference types="office-js" />

import type { Conversation, EmailAddress, Message } from "./types.js";
import { renderConversation } from "./renderer.js";
import { mountAiUi } from "./ai-summarize.js";

// Office.js is loaded by a <script> tag in taskpane.html. Types come from
// @types/office-js (global namespace via the triple-slash directive above).

const LIVE_KEY = "chatify.liveConversation";
const CHANNEL_NAME = "chatify-live";
// Relative URL so it resolves under both `/` (local dev) and `/chatify/`
// (GitHub Pages) without needing the build to rewrite it.
const VIEWER_URL = "viewer.html";

// Broadcast updates to any open viewer tabs the moment localStorage changes.
// More reliable than the `storage` event when the writer is inside a
// sandboxed iframe (Outlook's task pane).
const broadcastChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

// Cache the most recently rendered conversation so the click handler can
// embed it in the viewer URL hash synchronously (popup-blocker-safe).
let lastConversation: Conversation | null = null;

function writeLiveConversation(conversation: Conversation): void {
  lastConversation = conversation;
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify(conversation));
  } catch {
    // localStorage may be disabled.
  }
  broadcastChannel?.postMessage({ type: "live-update" });
}

const root = () => document.getElementById("chat-root")!;

function showStatus(text: string, isError = false): void {
  const el = root();
  el.innerHTML = "";
  const banner = document.createElement("div");
  banner.style.padding = "24px";
  banner.style.color = isError ? "#ff7b6b" : "#8696a0";
  banner.style.fontFamily = "sans-serif";
  banner.style.lineHeight = "1.5";
  banner.textContent = text;
  el.appendChild(banner);
}

function toEmailAddress(d: { displayName: string; emailAddress: string } | undefined): EmailAddress {
  if (!d) return { name: "", address: "" };
  return { name: d.displayName ?? "", address: d.emailAddress ?? "" };
}

function toEmailAddressArray(arr: ReadonlyArray<{ displayName: string; emailAddress: string }> | undefined): EmailAddress[] {
  if (!arr) return [];
  return Array.from(arr).map(toEmailAddress);
}

function buildMessage(item: Office.MessageRead, bodyHtml: string): Message {
  const sentAt = item.dateTimeCreated instanceof Date
    ? item.dateTimeCreated.toISOString()
    : new Date().toISOString();
  return {
    id: item.itemId ?? "",
    conversationId: item.conversationId ?? "",
    subject: item.subject ?? "",
    sender: toEmailAddress(item.from ?? undefined),
    toRecipients: toEmailAddressArray(item.to as ReadonlyArray<{ displayName: string; emailAddress: string }>),
    ccRecipients: toEmailAddressArray(item.cc as ReadonlyArray<{ displayName: string; emailAddress: string }>),
    sentDateTime: sentAt,
    receivedDateTime: sentAt,
    hasAttachments: Boolean(item.attachments && item.attachments.length > 0),
    attachments: [],
    body: { contentType: "html", content: bodyHtml },
  };
}

function buildConversation(
  item: Office.MessageRead,
  bodyHtml: string,
): Conversation {
  const profile = Office.context.mailbox.userProfile;
  return {
    conversationId: item.conversationId ?? "chatify-unknown",
    currentUser: {
      name: profile.displayName ?? profile.emailAddress ?? "You",
      address: profile.emailAddress ?? "",
    },
    messages: [buildMessage(item, bodyHtml)],
  };
}

function syncLiveConversationToStorage(
  onComplete?: (success: boolean) => void,
): void {
  const item = Office.context.mailbox.item;
  if (!item || item.itemType !== Office.MailboxEnums.ItemType.Message) {
    onComplete?.(false);
    return;
  }
  item.body.getAsync(
    Office.CoercionType.Html,
    (result: Office.AsyncResult<string>) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) {
        onComplete?.(false);
        return;
      }
      const conversation = buildConversation(
        item as Office.MessageRead,
        result.value,
      );
      writeLiveConversation(conversation);
      onComplete?.(true);
    },
  );
}

function chatifyCurrent(): void {
  const item = Office.context.mailbox.item;
  if (!item || item.itemType !== Office.MailboxEnums.ItemType.Message) {
    showStatus("Open an email message to chatify it.");
    return;
  }

  showStatus("Loading message…");

  item.body.getAsync(Office.CoercionType.Html, (result: Office.AsyncResult<string>) => {
    if (result.status !== Office.AsyncResultStatus.Succeeded) {
      showStatus(`Failed to read message body: ${result.error?.message ?? "unknown error"}`, true);
      return;
    }

    const conversation = buildConversation(item as Office.MessageRead, result.value);

    const r = root();
    r.replaceChildren();
    renderConversation(conversation, r);

    // Place the "Open full screen" link directly UNDER the thread header
    // (avatar + subject + participants) and ABOVE the day-divider/bubbles —
    // mirrors WhatsApp's "in-conversation actions" pattern.
    insertViewerLinkAfterHeader(r);

    // AI features (Summarize chip / setup banner) — gated by localStorage
    // flag chatify.aiEnabled. No-op when the flag is false.
    void mountAiUi(r);

    // Mirror to localStorage + BroadcastChannel so the full-screen viewer
    // (a separate browser tab on the same origin) can render the same
    // chat at full width.
    writeLiveConversation(conversation);
  });
}

function insertViewerLinkAfterHeader(container: HTMLElement): void {
  const link = buildViewerLink();
  const header = container.querySelector(".chat-thread-header");
  if (header && header.parentElement) {
    header.parentElement.insertBefore(link, header.nextSibling);
  } else {
    container.insertBefore(link, container.firstChild);
  }
}

function buildViewerLink(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "taskpane-actions";
  const link = document.createElement("a");
  link.className = "taskpane-actions__viewer";
  link.href = VIEWER_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "↗ Open full screen";

  // On click: encode the most recently rendered conversation directly into
  // the viewer URL hash and open. This bypasses Chrome's Storage
  // Partitioning, which separates the Outlook iframe's localStorage
  // (under outlook.live.com) from the viewer tab's localStorage (under
  // localhost:3001 as top). All storage-based sync (localStorage,
  // BroadcastChannel, storage events) is partitioned the same way and
  // unreliable across the iframe→tab boundary; URL data is not.
  link.addEventListener("click", (e) => {
    e.preventDefault();
    let url = link.href;
    if (lastConversation) {
      const encoded = encodeURIComponent(JSON.stringify(lastConversation));
      url = `${link.href}#data=${encoded}`;
    }
    const newWin = window.open(url, "_blank", "noopener,noreferrer");
    if (!newWin) return;
    // Also refresh localStorage in the (rare) same-partition case, so a
    // viewer tab kept open from a previous click can pick up the update.
    syncLiveConversationToStorage();
  });

  wrap.appendChild(link);
  return wrap;
}

Office.onReady((info: { host?: Office.HostType; platform?: Office.PlatformType }) => {
  if (info.host !== Office.HostType.Outlook) {
    showStatus(`Chatify only runs in Outlook. Detected host: ${info.host}.`, true);
    return;
  }

  chatifyCurrent();

  // Re-render when the user navigates to a different message in the reading pane.
  Office.context.mailbox.addHandlerAsync?.(
    Office.EventType.ItemChanged,
    () => chatifyCurrent(),
  );
});
