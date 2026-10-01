// A lightweight, accessible searchable author picker: an editable combobox with
// a listbox popup (per the WAI-ARIA combobox pattern), built over the already
// loaded 106-author list — it never scans posts. The matching helpers are pure
// and unit-tested; the controller touches the DOM only when called.

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
 * Wire up the combobox.
 * @param {object} opts
 * @param {HTMLElement} opts.container the .combobox wrapper
 * @param {HTMLInputElement} opts.input
 * @param {HTMLElement} opts.listbox the <ul role="listbox">
 * @param {HTMLButtonElement} opts.clearButton
 * @param {Array<{authorId:number,authorname:string,post_count:number}>} opts.authors
 * @param {(n:number)=>string} opts.formatCount
 * @param {(authorId:number|null)=>void} opts.onChange
 * @returns {{reset:()=>void}}
 */
export function createAuthorCombobox({ container, input, listbox, clearButton, authors, formatCount, onChange }) {
  const ALL = { authorId: null, authorname: 'Minden szerző' };
  let open = false;
  let items = [];
  let activeIndex = -1;
  let selectedId = null;

  const optionId = (a) => (a.authorId == null ? 'author-opt-all' : `author-opt-${a.authorId}`);

  // When no query is typed, offer the "all authors" reset at the top; while
  // filtering, show only matches so the top item (and Enter) is the best match.
  const computeItems = (query) => {
    const matches = filterAuthors(authors, query);
    return query.trim() ? matches : [ALL, ...matches];
  };

  function render(query) {
    items = computeItems(query);
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
      li.dataset.index = String(i);
      li.textContent = a.authorId == null ? a.authorname : `${a.authorname} (${formatCount(a.post_count)})`;
      if (a.authorId === selectedId) li.setAttribute('aria-selected', 'true');
      frag.append(li);
    });
    listbox.append(frag);
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
    setActive(query.trim() ? (items.length ? 0 : -1) : items.findIndex((a) => a.authorId === selectedId));
  }

  function closeList() {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    open = false;
    activeIndex = -1;
  }

  function syncInputToSelection() {
    const selected = authors.find((a) => a.authorId === selectedId);
    input.value = selected ? selected.authorname : '';
    clearButton.hidden = !selected;
  }

  function select(author) {
    selectedId = author.authorId;
    input.value = author.authorId == null ? '' : author.authorname;
    clearButton.hidden = author.authorId == null;
    closeList();
    onChange(selectedId);
  }

  input.addEventListener('click', () => {
    if (!open) {
      input.select();
      openList('');
    }
  });

  input.addEventListener('input', () => {
    clearButton.hidden = input.value.trim() === '' && selectedId == null;
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
        if (open && activeIndex >= 0 && items[activeIndex]) select(items[activeIndex]);
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          closeList();
          syncInputToSelection();
        }
        break;
      default:
        break;
    }
  });

  // Keep focus on the input while pressing inside the listbox, otherwise the
  // mousedown blurs the input and the container's focusout handler closes (and
  // hides) the list before the click can select. preventDefault keeps focus so
  // the click below still fires and selects.
  listbox.addEventListener('mousedown', (e) => e.preventDefault());
  listbox.addEventListener('click', (e) => {
    const li = e.target.closest('.combo-option');
    if (!li) return;
    select(items[Number(li.dataset.index)]);
  });

  // Close when focus leaves the whole combobox (e.g. Tab away).
  container.addEventListener('focusout', (e) => {
    if (!container.contains(e.relatedTarget)) {
      closeList();
      syncInputToSelection();
    }
  });

  clearButton.addEventListener('click', () => {
    select(ALL);
    input.focus();
  });

  return {
    reset() {
      selectedId = null;
      input.value = '';
      clearButton.hidden = true;
      closeList();
    }
  };
}
