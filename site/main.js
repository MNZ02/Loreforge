// Progressive enhancements only. Examples are local illustrations, not a CLI connection.
const stageControls = document.querySelector('[data-stage-controls]');
const tabs = [...document.querySelectorAll('[data-stage]')];
const panels = [...document.querySelectorAll('[data-panel]')];

if (stageControls && tabs.length && panels.length === tabs.length) {
  function selectStage(tab, focus = false) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== tab.dataset.stage;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `tab-${panel.dataset.panel}`);
      panel.tabIndex = 0;
    }
    if (focus) tab.focus();
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectStage(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        selectStage(tabs[next], true);
      }
    });
  }
  selectStage(tabs[0]);
  stageControls.hidden = false;
}

const status = document.getElementById('copy-status');
let copySequence = 0;
for (const button of document.querySelectorAll('[data-copy]')) {
  const source = document.getElementById(button.dataset.copy);
  if (!source) continue;
  button.addEventListener('click', async () => {
    const sequence = ++copySequence;
    const text = source.textContent.trim();
    // Keep feedback next to the clicked control as well as in the live region.
    let feedback = button.closest('.command-box, .preview-command').nextElementSibling;
    if (!feedback?.classList.contains('command-feedback')) {
      feedback = document.createElement('p');
      feedback.className = 'command-feedback';
      button.closest('.command-box, .preview-command').after(feedback);
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (sequence !== copySequence) return;
      feedback.textContent = 'Copied. Ready for your terminal.';
      if (status) status.textContent = 'Command copied.';
    } catch {
      if (sequence !== copySequence) return;
      feedback.textContent = 'Copy unavailable. Select and copy the command manually.';
      if (status) status.textContent = 'Copy unavailable. Select and copy the command manually.';
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(source);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  });
  button.hidden = false;
}

function revealAnchor() {
  const id = location.hash.slice(1);
  if (id !== 'preview-setup') return;
  const target = document.getElementById(id);
  if (target instanceof HTMLDetailsElement) target.open = true;
}
document.querySelectorAll('a[href="#preview-setup"]').forEach(link => {
  link.addEventListener('click', () => {
    const target = document.getElementById('preview-setup');
    if (target instanceof HTMLDetailsElement) target.open = true;
  });
});
window.addEventListener('hashchange', revealAnchor);
revealAnchor();
