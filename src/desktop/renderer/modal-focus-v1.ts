const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** Keep keyboard and assistive-technology navigation within the currently visible modal. */
export function installModalFocusV1(): () => void {
  let active: HTMLElement | undefined;
  let returnFocus: HTMLElement | undefined;
  const previousInert = new Map<HTMLElement, boolean>();
  const visible = (node: HTMLElement) => !node.closest('[hidden]') && node.getClientRects().length > 0;
  const focusable = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
  const restoreInert = () => { for (const [node, inert] of previousInert) node.inert = inert; previousInert.clear(); };
  const sync = () => {
    const modals = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).filter(visible);
    const next = modals.find((node) => node.id === 'startup-recovery') ?? modals.at(-1);
    if (next !== active) {
      restoreInert();
      if (!active) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      active = next;
      if (!active) {
        if (returnFocus?.isConnected && visible(returnFocus)) returnFocus.focus();
        else document.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
        return;
      }
      let branch: HTMLElement = active;
      while (branch.parentElement) {
        for (const sibling of Array.from(branch.parentElement.children)) {
          if (sibling instanceof HTMLElement && sibling !== branch) {
            previousInert.set(sibling, sibling.inert); sibling.inert = true;
          }
        }
        branch = branch.parentElement;
        if (branch === document.body) break;
      }
    }
    if (active && (!(document.activeElement instanceof HTMLElement) || !active.contains(document.activeElement) || !visible(document.activeElement))) {
      const target = focusable(active)[0] ?? active;
      if (target === active) active.tabIndex = -1;
      target.focus();
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      const cancelId = active.dataset.cancelButton;
      if (cancelId) document.getElementById(cancelId)?.click();
    } else if (event.key === 'Tab') {
      const controls = focusable(active);
      if (!controls.length) { event.preventDefault(); active.focus(); return; }
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
      else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0]!.focus(); }
    }
  };
  const focusin = () => { if (active && !active.contains(document.activeElement)) sync(); };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', focusin);
  sync();
  return () => { observer.disconnect(); document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin); restoreInert(); };
}
