import { describe, it, expect, beforeEach } from "vitest";
import { renderConversation } from "../../src/renderer";
import sentaraFixture from "../fixtures/sentara-forward.json" with { type: "json" };
import gilNivFixture from "../fixtures/gil-niv-mixed-hebrew.json" with { type: "json" };

describe("renderConversation — system events", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("emits an inline 'Alex Gill added you' event before the last bubble in Sentara", () => {
    renderConversation(sentaraFixture as never, container);
    const events = container.querySelectorAll(".system-event__label");
    // At least one event saying Alex added you
    const aviv = Array.from(events).find((el) =>
      /Alex Gill added you/.test(el.textContent ?? ""),
    );
    expect(aviv).toBeDefined();
  });

  it("emits 'Zion Sarusi added Guy Lorman' inline in the gil-niv fixture", () => {
    renderConversation(gilNivFixture as never, container);
    const events = container.querySelectorAll(".system-event__label");
    const guy = Array.from(events).find((el) =>
      /Zion Sarusi added Guy Lorman/.test(el.textContent ?? ""),
    );
    expect(guy).toBeDefined();
  });

  it("preserves Alex's 'Thanks' bubble (the forward bug)", () => {
    renderConversation(sentaraFixture as never, container);
    // The renderer emits seven .row elements after the system event +
    // day dividers. The last bubble's content should contain "Thanks".
    const rows = container.querySelectorAll(".row");
    const lastRow = rows[rows.length - 1];
    expect(lastRow).toBeDefined();
    expect(lastRow!.querySelector(".bubble__sender")?.textContent).toBe(
      "Alex Gill",
    );
    expect(lastRow!.querySelector(".bubble__content")?.textContent).toMatch(
      /Thanks/,
    );
  });

  it("renders 7 message rows for the Sentara fixture", () => {
    renderConversation(sentaraFixture as never, container);
    const rows = container.querySelectorAll(".row");
    expect(rows.length).toBe(7);
  });

  it("renders 6 rows for the Gil Niv fixture (no forward expansion)", () => {
    renderConversation(gilNivFixture as never, container);
    const rows = container.querySelectorAll(".row");
    expect(rows.length).toBe(6);
  });

  it("places Aviv's messages on the right (.row--out) in gil-niv", () => {
    renderConversation(gilNivFixture as never, container);
    const outRows = container.querySelectorAll(".row--out");
    // Aviv replied twice in gil-niv (Mar 8 19:18 and Mar 9 06:30)
    expect(outRows.length).toBe(2);
  });

  it("detects RTL on Hebrew bodies in gil-niv", () => {
    renderConversation(gilNivFixture as never, container);
    const rtlRows = container.querySelectorAll(".row--rtl");
    // Aviv's reply (Mar 9 06:30, Hebrew) and Gil Niv's reply (Mar 9 06:34, Hebrew)
    expect(rtlRows.length).toBeGreaterThanOrEqual(2);
  });
});
