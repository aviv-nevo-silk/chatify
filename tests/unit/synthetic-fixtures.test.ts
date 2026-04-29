import { describe, it, expect, beforeEach } from "vitest";
import { renderConversation } from "../../src/renderer";
import type { Conversation } from "../../src/types";

import forwardChain from "../fixtures/synthetic/forward-chain.json" with { type: "json" };
import mixedLanguage from "../fixtures/synthetic/mixed-language.json" with { type: "json" };
import attachmentHeavy from "../fixtures/synthetic/attachment-heavy.json" with { type: "json" };

interface ExpectedRow {
  senderName: string;
  isOut?: boolean;
  isRtl?: boolean;
  contains?: string;
}

interface ExpectedSystemEvent {
  kind: string;
  actorName: string;
}

interface ExpectedBlock {
  systemEvents: ExpectedSystemEvent[];
  rowCount: number;
  rowsInOrder: ExpectedRow[];
  rtlRowCount: number;
  outRowCount?: number;
  stripped?: string[];
  preserved?: string[];
  addressConsolidation?: Record<string, string>;
  mentionPillCount?: number;
  mentionTargets?: string[];
  fileCardCount?: number;
  fileCardNames?: string[];
  imageBubbleCount?: number;
  imageBubbleNames?: string[];
  inlineImageCount?: number;
  inlineImageCidResolved?: boolean;
  dayDividers?: string[];
}

interface FixtureWithExpected extends Conversation {
  expected: ExpectedBlock;
}

const FIXTURES: Array<[string, FixtureWithExpected]> = [
  ["forward-chain", forwardChain as unknown as FixtureWithExpected],
  ["mixed-language", mixedLanguage as unknown as FixtureWithExpected],
  ["attachment-heavy", attachmentHeavy as unknown as FixtureWithExpected],
];

describe("Synthetic fixture suite", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  for (const [name, fixture] of FIXTURES) {
    describe(`${name}.json`, () => {
      const expected = fixture.expected;

      it("renders the expected number of rows", () => {
        renderConversation(fixture, container);
        const rows = container.querySelectorAll(".row");
        expect(rows.length).toBe(expected.rowCount);
      });

      it("emits the expected system events", () => {
        renderConversation(fixture, container);
        const events = Array.from(
          container.querySelectorAll(".system-event__label"),
        );
        expect(events.length).toBe(expected.systemEvents.length);
        expected.systemEvents.forEach((ev, i) => {
          expect(events[i]?.textContent).toContain(ev.actorName);
        });
      });

      it("rows appear in the expected chronological order with correct senders", () => {
        renderConversation(fixture, container);
        const rows = Array.from(container.querySelectorAll(".row"));
        expect(rows.length).toBe(expected.rowsInOrder.length);
        expected.rowsInOrder.forEach((expectedRow, i) => {
          const row = rows[i]!;
          // Sender name appears in .bubble__sender for incoming, hidden for outgoing.
          const senderEl = row.querySelector(".bubble__sender");
          if (expectedRow.isOut === true) {
            expect(row.classList.contains("row--out")).toBe(true);
          } else {
            expect(row.classList.contains("row--in")).toBe(true);
            expect(senderEl?.textContent).toBe(expectedRow.senderName);
          }
          if (expectedRow.contains) {
            const content = row.querySelector(".bubble__content");
            expect(content?.textContent).toContain(expectedRow.contains);
          }
        });
      });

      it("RTL row count matches expected", () => {
        renderConversation(fixture, container);
        const rtl = container.querySelectorAll(".row--rtl");
        expect(rtl.length).toBe(expected.rtlRowCount);
      });

      if (expected.outRowCount !== undefined) {
        it("outgoing (current-user) row count matches expected", () => {
          renderConversation(fixture, container);
          const out = container.querySelectorAll(".row--out");
          expect(out.length).toBe(expected.outRowCount);
        });
      }

      if (expected.stripped) {
        it("strips signature/contact noise from bubbles", () => {
          renderConversation(fixture, container);
          const allText = container.textContent ?? "";
          for (const fragment of expected.stripped!) {
            expect(allText).not.toContain(fragment);
          }
        });
      }

      if (expected.preserved) {
        it("preserves real message content", () => {
          renderConversation(fixture, container);
          const allText = container.textContent ?? "";
          for (const fragment of expected.preserved!) {
            expect(allText).toContain(fragment);
          }
        });
      }

      if (expected.addressConsolidation) {
        it("consolidates addresses for repeated senders (no @unknown.local in DOM)", () => {
          renderConversation(fixture, container);
          const html = container.innerHTML;
          expect(html).not.toContain("@unknown.local");
        });
      }

      if (expected.mentionPillCount !== undefined) {
        it("renders mention pills with correct count and targets", () => {
          renderConversation(fixture, container);
          const pills = container.querySelectorAll("a.mention");
          expect(pills.length).toBe(expected.mentionPillCount);
          if (expected.mentionTargets) {
            const actualTargets = Array.from(pills).map(
              (p) => p.getAttribute("data-mention-email") ?? "",
            );
            for (const target of expected.mentionTargets) {
              expect(actualTargets).toContain(target);
            }
          }
        });
      }

      if (expected.fileCardCount !== undefined) {
        it("renders file-card chips for non-image attachments", () => {
          renderConversation(fixture, container);
          const cards = container.querySelectorAll(".attachment-card");
          expect(cards.length).toBe(expected.fileCardCount);
          if (expected.fileCardNames) {
            const names = Array.from(cards).map(
              (c) => c.querySelector(".attachment-card__name")?.textContent ?? "",
            );
            for (const name of expected.fileCardNames) {
              expect(names.some((n) => n.includes(name))).toBe(true);
            }
          }
        });
      }

      if (expected.imageBubbleCount !== undefined) {
        it("renders image bubbles for non-inline image attachments", () => {
          renderConversation(fixture, container);
          const bubbles = container.querySelectorAll(".image-bubble");
          expect(bubbles.length).toBe(expected.imageBubbleCount);
        });
      }

      if (expected.inlineImageCount !== undefined) {
        it("resolves inline images and wraps them in .inline-image", () => {
          renderConversation(fixture, container);
          const wrappers = container.querySelectorAll(".inline-image");
          expect(wrappers.length).toBe(expected.inlineImageCount);
          if (expected.inlineImageCidResolved) {
            const imgs = container.querySelectorAll(".inline-image img");
            for (const img of Array.from(imgs)) {
              const src = img.getAttribute("src") ?? "";
              expect(src.startsWith("data:")).toBe(true);
            }
          }
        });
      }
    });
  }
});
