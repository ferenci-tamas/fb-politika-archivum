// A lightweight, accessible, multi-select searchable author picker: an editable
// combobox with a listbox popup (per the WAI-ARIA combobox pattern) plus removable
// chips for the chosen authors. Selecting authors is additive and combined with OR
// in the query. It is built over the already-loaded 106-author list and never
// scans posts. The matching helpers are pure and unit-tested; the controller
// touches the DOM only when called.

/** Lowercase and strip diacritics so "ader" matches "Áder" and "koszeg" "Kőszeg". */
export function normalizeForSearch(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Case- and diacritic-insensitive substring filter over the author list. */
export function filterAuthors(authors, query) {
  const q = normalizeForSearch(query || '').trim();
  if (!q) return authors;
  return authors.filter((a) => normalizeForSearch(a.authorname).includes(q));
}

/**
 * Wire up the multi-select combobox.
 * @param {object} opts
 * @param {HTMLElement} opts.container the .combobox wrapper
 * @param {HTMLInputElement} opts.input
 * @param {HTMLElement} opts.listbox the <ul role="listbox">
 * @param {HTMLElement} opts.chips the chips container
 * @param {HTMLButtonElement} opts.clearButton
 * @param {Array<{authorId:number,authorname:string,post_count:number}>} opts.authors
 * @param {(n:number)=>string} opts.formatCount
 * @param {(authorIds:number[])=>void} opts.onChange called with the selected ids
 * @returns {{reset:()=>void}}
 */
export function createAuthorCombobox({ container, input, listbox, chips, clearButton, authors, formatCount, onChange }) {
  const authorsById = new Map(authors.map((a) => [a.authorId, a]));
  const selected = new Set();
  let open = false;
  let items = [];
  let activeIndex = -1;

  const optionId = (a) => `author-opt-${a.authorId}`;
  const emitChange = () => onChange([...selected]);

  function render(query) {
    items = filterAuthors(authors, query);
    listbox.replaceChildren();
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'combo-empty';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-disabled', 'true');
      li.textContent = 'Nincs ilyen szerző';
      listbox.append(li);
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((a, i) => {
      const li = document.createElement('li');
      li.id = optionId(a);
      li.className = 'combo-option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', selected.has(a.authorId) ? 'true' : 'false');
      li.dataset.index = String(i);
      li.textContent = `${a.authorname} (${formatCount(a.post_count)})`;
      frag.append(li);
    });
    listbox.append(frag);
  }

  function renderChips() {
    chips.replaceChildren();
    const ids = [...selected].sort((a, b) => a - b); // authorId order == Hungarian alphabetical
    if (ids.length === 0) {
      chips.hidden = true;
      return;
    }
    chips.hidden = false;
    const frag = document.createDocumentFragment();
    for (const id of ids) {
      const author = authorsById.get(id);
      if (!author) continue;
      const chip = document.createElement('span');
      chip.className = 'chip';
      const label = document.createElement('span');
      label.textContent = author.authorname;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.textContent = '×';
      remove.dataset.id = String(id);
      remove.setAttribute('aria-label', `${author.authorname} eltávolítása`);
      chip.append(label, remove);
      frag.append(chip);
    }
    chips.append(frag);
  }

  function updateClearVisibility() {
    clearButton.hidden = selected.size === 0 && input.value.trim() === '';
  }

  function setActive(index) {
    const options = listbox.querySelectorAll('.combo-option');
    options.forEach((o) => o.classList.remove('active'));
    if (index >= 0 && index < options.length) {
      activeIndex = index;
      const option = options[index];
      option.classList.add('active');
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
    }
  }

  function openList(query) {
    render(query);
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    open = true;
    setActive(query.trim() && items.length ? 0 : -1);
  }

  function closeList() {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    open = false;
    activeIndex = -1;
  }

  // Toggle membership; selecting is additive, so the list stays open and the
  // filter text is cleared to make picking several authors fluent.
  function toggle(author) {
    if (!author) return;
    if (selected.has(author.authorId)) selected.delete(author.authorId);
    else selected.add(author.authorId);
    input.value = '';
    renderChips();
    updateClearVisibility();
    render('');
    const idx = items.findIndex((a) => a.authorId === author.authorId);
    setActive(idx);
    emitChange();
  }

  input.addEventListener('click', () => {
    if (!open) openList(input.value);
  });

  input.addEventListener('input', () => {
    updateClearVisibility();
    openList(input.value);
  });

  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList(input.value);
        else setActive(Math.min(activeIndex + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (open) setActive(Math.max(activeIndex - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (open && activeIndex >= 0) toggle(items[activeIndex]);
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          input.value = '';
          updateClearVisibility();
          closeList();
        }
        break;
      case 'Backspace':
        // Remove the last chip when the input is empty.
        if (input.value === '' && selected.size > 0) {
          const ids = [...selected].sort((a, b) => a - b);
          selected.delete(ids[ids.length - 1]);
          renderChips();
          updateClearVisibility();
          if (open) render(input.value);
          emitChange();
        }
        break;
      default:
        break;
    }
  });

  // Keep focus on the input while pressing inside the listbox so the click can
  // toggle before the container's focusout handler would close it.
  listbox.addEventListener('mousedown', (e) => e.preventDefault());
  listbox.addEventListener('click', (e) => {
    const li = e.target.closest('.combo-option');
    if (!li) return;
    toggle(items[Number(li.dataset.index)]);
  });

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-remove');
    if (!btn) return;
    selected.delete(Number(btn.dataset.id));
    renderChips();
    updateClearVisibility();
    if (open) render(input.value);
    emitChange();
  });

  container.addEventListener('focusout', (e) => {
    if (!container.contains(e.relatedTarget)) {
      input.value = '';
      updateClearVisibility();
      closeList();
    }
  });

  clearButton.addEventListener('click', () => {
    selected.clear();
    input.value = '';
    renderChips();
    updateClearVisibility();
    closeList();
    input.focus();
    emitChange();
  });

  return {
    reset() {
      selected.clear();
      input.value = '';
      renderChips();
      clearButton.hidden = true;
      closeList();
    }
  };
}
