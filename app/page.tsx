/**
 * The engine has no browser editor: the Mac app is the editor, and the CLI runs
 * headless (for scripts and coding agents). This page only says so, for anyone
 * who opens the engine's port in a browser.
 */
export default function HomePage() {
  return (
    <main style={{ maxWidth: 560, margin: "15vh auto", padding: "0 24px", lineHeight: 1.5 }}>
      <h1>store-shots engine</h1>
      <p>
        This is the engine the Store Shots Mac app runs on. Edit in the Mac app, or run{" "}
        <code>npx store-shots --help</code> for the command line.
      </p>
    </main>
  );
}
