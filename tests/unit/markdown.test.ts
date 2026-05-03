import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/utils/markdown";

describe("renderMarkdown", () => {
  it("renders **bold** as <strong>", () => {
    expect(renderMarkdown("This is **important** stuff.")).toContain(
      "<strong>important</strong>",
    );
  });

  it("renders *italic* as <em>", () => {
    expect(renderMarkdown("a *quick* note")).toContain("<em>quick</em>");
  });

  it("does not treat the inner * of **bold** as italic", () => {
    const html = renderMarkdown("**Key takeaways:**");
    expect(html).toContain("<strong>Key takeaways:</strong>");
    expect(html).not.toContain("<em>");
  });

  it("renders unordered lists for * and - bullets", () => {
    const html = renderMarkdown("* one\n* two\n* three");
    expect(html).toMatch(
      /<ul><li>one<\/li><li>two<\/li><li>three<\/li><\/ul>/,
    );
    const dashed = renderMarkdown("- alpha\n- beta");
    expect(dashed).toMatch(/<ul><li>alpha<\/li><li>beta<\/li><\/ul>/);
  });

  it("renders numbered lists with <ol>", () => {
    expect(renderMarkdown("1. first\n2. second")).toMatch(
      /<ol><li>first<\/li><li>second<\/li><\/ol>/,
    );
  });

  it("renders ATX headings as bold-styled paragraphs", () => {
    const html = renderMarkdown("## Summary\nSome text.");
    expect(html).toContain('<p class="md-heading"><strong>Summary</strong></p>');
    expect(html).toContain("<p>Some text.</p>");
  });

  it("escapes HTML in the input so injected tags render as text", () => {
    const html = renderMarkdown("Hi <script>alert(1)</script> there");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("merges consecutive plain lines into one paragraph with <br>", () => {
    const html = renderMarkdown("first line\nsecond line");
    expect(html).toBe("<p>first line<br>second line</p>");
  });

  it("treats blank lines as paragraph breaks", () => {
    const html = renderMarkdown("first para\n\nsecond para");
    expect(html).toBe("<p>first para</p><p>second para</p>");
  });

  it("appends a non-bullet line after a bullet as a wrapped continuation", () => {
    const html = renderMarkdown("* main bullet\n  continuation text");
    expect(html).toMatch(
      /<ul><li>main bullet<br>continuation text<\/li><\/ul>/,
    );
  });

  it("renders inline `code` spans", () => {
    expect(renderMarkdown("the `foo` value")).toContain("<code>foo</code>");
  });

  it("renders the typical LLM summary shape end-to-end", () => {
    const input = [
      "**Key takeaways:**",
      "",
      "* If the recipient *recognizes* this, they can disregard.",
      "* If they don't, they should review recent activity.",
      "",
      "The email encourages users to confirm.",
    ].join("\n");
    const html = renderMarkdown(input);
    expect(html).toContain("<strong>Key takeaways:</strong>");
    expect(html).toContain("<em>recognizes</em>");
    expect(html).toMatch(/<ul>(?:<li>.+?<\/li>){2}<\/ul>/);
    expect(html).toContain("<p>The email encourages users to confirm.</p>");
  });
});
