/* Desktop-only Colab history selection adapter.
 * Uses the existing record checkbox and its native click handler.
 * No changes to the local data API, record IDs, or ordinary click actions.
 */
(function (root) {
  "use strict";
  const selector = 'article,details,li,tr,[data-record-id],[data-archive-id],.record-card,.archive-card,.record-row,.archive-row,.colab-job,.record-item,.archive-item,.record,.archive';
  function onlyCheckbox(node) {
    const boxes = [...node.querySelectorAll('input[type="checkbox"]')];
    return boxes.length === 1 && !boxes[0].disabled ? boxes[0] : null;
  }
  function checkboxFor(target, list) {
    if (!target || !list || !list.contains(target) || target === list) return null;
    // A recognized record must contain exactly one checkbox. Do not guess
    // among multiple records within a classification group.
    for (let item = target; item && item !== list; item = item.parentElement) {
      if (!item.matches(selector) && item.parentElement !== list) continue;
      const box = onlyCheckbox(item);
      if (box) return box;
    }
    return null;
  }
  function isNativeCheckboxTarget(target, box) {
    if (target === box) return true;
    const label = target.closest('label');
    return !!label && label.control === box;
  }
  function editable(target) {
    return !!target.closest('textarea,[contenteditable="true"],input:not([type="checkbox"]),select');
  }
  function install(win) {
    if (win.__rgDesktopSelectionV1) return;
    win.__rgDesktopSelectionV1 = true;
    const doc = win.document;
    let forwarding = false;
    function targetOf(event) {
      const target = event.target;
      return target && typeof target.closest === 'function' ? target : target?.parentElement;
    }
    function inspect(event) {
      if (forwarding) return null;
      const target = targetOf(event);
      const box = checkboxFor(target, doc.getElementById('records'));
      if (!box || editable(target) || isNativeCheckboxTarget(target, box)) return null;
      return box;
    }
    function reserveModifierClick(event) {
      if (!((event.button === 0 && (event.ctrlKey || event.metaKey)) ||
            (event.button === 2 && event.shiftKey))) return;
      const box = inspect(event);
      if (box) event.stopImmediatePropagation();
    }
    // Reserve the modifier gesture before a generic document-level
    // pointerdown/mousedown or click listener can clear the selection.
    for (const name of ['pointerdown','mousedown','pointerup','mouseup']) {
      win.addEventListener(name, reserveModifierClick, true);
    }
    function select(event, addOnly) {
      const box = inspect(event);
      if (!box) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (addOnly && box.checked) return;
      forwarding = true;
      try { box.click(); } finally { forwarding = false; }
    }
    win.addEventListener('click', event => {
      if (event.button === 0 && (event.ctrlKey || event.metaKey)) select(event, false);
    }, true);
    win.addEventListener('contextmenu', event => {
      if (event.shiftKey) select(event, true);
    }, true);
  }
  if (typeof module === 'object' && module.exports) module.exports = {checkboxFor,install};
  if (root && root.document) install(root);
})(typeof window !== 'undefined' ? window : null);
