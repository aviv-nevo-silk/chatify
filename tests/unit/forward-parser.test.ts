import { describe, it, expect } from "vitest";
import { expandForwardedChain } from "../../src/utils/forward-parser";
import type { Message } from "../../src/types";

import sentaraFixture from "../fixtures/sentara-forward.json" with { type: "json" };

function makeBaseMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    subject: "test",
    sender: { name: "Aviv", address: "aviv@example.com" },
    toRecipients: [],
    ccRecipients: [],
    sentDateTime: "2026-01-01T10:00:00.000Z",
    receivedDateTime: "2026-01-01T10:00:00.000Z",
    hasAttachments: false,
    body: { contentType: "html", content: "" },
    ...overrides,
  };
}

describe("expandForwardedChain", () => {
  it("returns [message] unchanged when there is no <hr/> chain", () => {
    const msg = makeBaseMessage({
      body: { contentType: "html", content: "<p>Just a regular reply.</p>" },
    });
    const out = expandForwardedChain(msg);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(msg);
  });

  it("expands the Sentara fixture into 7 chronologically-sorted messages", () => {
    const sentara = sentaraFixture.messages[0]!;
    const baseMsg: Message = {
      id: sentara.id,
      conversationId: sentara.conversationId,
      subject: sentara.subject,
      sender: sentara.sender,
      toRecipients: sentara.toRecipients,
      ccRecipients: sentara.ccRecipients,
      sentDateTime: sentara.sentDateTime,
      receivedDateTime: sentara.receivedDateTime,
      hasAttachments: sentara.hasAttachments,
      body: { contentType: "html", content: sentara.body.content },
    };
    const out = expandForwardedChain(baseMsg);

    expect(out.length).toBe(7);

    // Should be sorted ascending by sentDateTime
    for (let i = 1; i < out.length; i++) {
      expect(
        new Date(out[i]!.sentDateTime).getTime() >=
          new Date(out[i - 1]!.sentDateTime).getTime(),
      ).toBe(true);
    }

    // First (oldest): Efi Sandler 2026-04-23 11:30 to silk_eng_staff
    expect(out[0]!.sender.address).toBe("efi.sandler@silk.us");
    expect(new Date(out[0]!.sentDateTime).getUTCDate()).toBe(23);

    // Last (newest): Alex Gill's "Thanks" — same as the parent's sender + datetime
    const last = out[6]!;
    expect(last.sender.address).toBe("alex.gill@silk.us");
    expect(last.sentDateTime).toBe(sentara.sentDateTime);
  });

  it("parses 'Name <email>' format for the From header", () => {
    const html =
      "<p>Hi</p><hr/>" +
      "<p><b>From:</b> Efi Sandler &lt;efi.sandler@silk.us&gt;<br/>" +
      "<b>Sent:</b> Monday, April 27, 2026 6:16 PM<br/>" +
      "<b>To:</b> Alex Gill<br/>" +
      "<b>Subject:</b> Re: Test</p>" +
      "<p>That's the one.</p>";
    const out = expandForwardedChain(makeBaseMessage({ body: { contentType: "html", content: html } }));
    expect(out.length).toBe(2);
    const efi = out.find((m) => m.sender.address === "efi.sandler@silk.us");
    expect(efi).toBeDefined();
    expect(efi!.sender.name).toBe("Efi Sandler");
  });

  it("synthesizes an address when the From header has only a name", () => {
    const html =
      "<p>Hi</p><hr/>" +
      "<p><b>From:</b> Tal Boitel<br/>" +
      "<b>Sent:</b> Thursday, April 23, 2026 11:14 PM<br/>" +
      "<b>To:</b> Alex Gill<br/>" +
      "<b>Subject:</b> Test</p>" +
      "<p>Body</p>";
    const out = expandForwardedChain(makeBaseMessage({ body: { contentType: "html", content: html } }));
    const tal = out.find((m) => m.sender.name === "Tal Boitel");
    expect(tal).toBeDefined();
    expect(tal!.sender.address).toBe("tal.boitel@unknown.local");
  });

  it("drops segments that don't have a parseable header (decorative <hr>)", () => {
    const html =
      "<p>Real content</p>" +
      "<hr/>" +
      "<p>Just a divider, no forwarded header here.</p>";
    const out = expandForwardedChain(makeBaseMessage({ body: { contentType: "html", content: html } }));
    expect(out.length).toBe(1); // only the first segment kept; second silently dropped
    expect(out[0]!.body.content).toContain("Real content");
  });

  it("preserves the body html of forwarded segments", () => {
    const html =
      "<p>New</p><hr/>" +
      "<p><b>From:</b> X &lt;x@y.com&gt;<br/>" +
      "<b>Sent:</b> Monday, April 27, 2026 6:16 PM<br/>" +
      "<b>To:</b> A<br/>" +
      "<b>Subject:</b> S</p>" +
      "<p>Quoted content here.</p>" +
      "<p>Second paragraph of quote.</p>";
    const out = expandForwardedChain(makeBaseMessage({ body: { contentType: "html", content: html } }));
    const quoted = out.find((m) => m.sender.address === "x@y.com");
    expect(quoted!.body.content).toContain("Quoted content here.");
    expect(quoted!.body.content).toContain("Second paragraph of quote");
  });
});
