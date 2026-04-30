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

// Office.js is loaded by a <script> tag in taskpane.html. Types come from
// @types/office-js (global namespace via the triple-slash directive above).

const LIVE_KEY = "chatify.liveConversation";
const VIEWER_URL = "/viewer.html";

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

    const profile = Office.context.mailbox.userProfile;
    const conversation: Conversation = {
      conversationId: item.conversationId ?? "chatify-unknown",
      currentUser: {
        name: profile.displayName ?? profile.emailAddress ?? "You",
        address: profile.emailAddress ?? "",
      },
      messages: [buildMessage(item as Office.MessageRead, result.value)],
    };

    const r = root();
    r.replaceChildren();
    r.appendChild(buildViewerLink());
    renderConversation(conversation, r);

    // Mirror to localStorage so the full-screen viewer (a separate browser
    // tab on the same origin) can render the same chat at full width.
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify(conversation));
    } catch {
      // localStorage may be disabled; the in-pane render still works.
    }
  });
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
