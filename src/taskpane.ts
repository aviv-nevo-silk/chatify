// Outlook task-pane entry. Phase 1.5 work — wired up in a later commit.
// For Phase 1 we develop against dev.html with fixture-driven data.

const root = document.getElementById("chat-root");
if (root) {
  root.innerHTML = `
    <div style="padding: 24px; color: #8696a0; font-family: sans-serif;">
      <strong>Chatify task pane (Phase 1.5)</strong>
      <p>Office.js integration lands after the renderer is verified against fixtures.</p>
      <p>For now, see <a href="/dev.html" style="color:#25d366;">dev.html</a>.</p>
    </div>
  `;
}
