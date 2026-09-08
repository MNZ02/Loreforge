/**
 * Loreforge landing page client enhancements (L2 Flash).
 * Handles clipboard copy for the install command and accessibility announcements.
 * Vanilla ES module; no dependencies, no external network calls, no storage.
 */

function setupInstallCopy() {
  const commandEl = document.getElementById('install-command');
  const copyButton = document.getElementById('copy-install');
  const statusEl = document.getElementById('copy-status');

  if (!commandEl || !copyButton || !statusEl) {
    return;
  }

  function selectCommandText() {
    try {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(commandEl);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch {
      // Best-effort selection fallback
    }
  }

  function handleFailure() {
    statusEl.textContent = 'Copy unavailable. Select the command and copy it manually.';
    selectCommandText();
  }

  async function handleCopy() {
    const text = commandEl.textContent ? commandEl.textContent.trim() : '';

    if (!navigator || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      handleFailure();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = 'Copied install command.';
    } catch {
      handleFailure();
    }
  }

  copyButton.addEventListener('click', handleCopy);
  copyButton.hidden = false;
  copyButton.removeAttribute('hidden');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupInstallCopy);
} else {
  setupInstallCopy();
}
