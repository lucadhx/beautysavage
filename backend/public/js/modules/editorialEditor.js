import { setActionButtonState } from '../helpers/actionButtonState.js';

const TOOLBAR_ACTIONS = [
  { label: 'B', command: 'bold', tooltip: 'Gras' },
  { label: 'I', command: 'italic', tooltip: 'Italique' },
  { label: 'U', command: 'underline', tooltip: 'Souligner' },
  { label: 'Left', command: 'justifyLeft', tooltip: 'Aligner à gauche' },
  { label: 'Center', command: 'justifyCenter', tooltip: 'Centrer' },
  { label: 'Right', command: 'justifyRight', tooltip: 'Aligner à droite' }
];

const FONT_SIZE_OPTIONS = [
  { label: 'Petit', value: 'small', className: 'text-small' },
  { label: 'Normal', value: 'normal', className: 'text-base' },
  { label: 'Large', value: 'large', className: 'text-large' },
  { label: 'XL', value: 'x-large', className: 'text-xlarge' }
];
const FONT_SIZE_NEUTRAL_VALUE = '';

const FONT_SIZE_CLASS_MAP = FONT_SIZE_OPTIONS.reduce((map, option) => {
  map[option.value] = option.className || null;
  return map;
}, {});

const FONT_SIZE_CLASS_NAMES = Object.values(FONT_SIZE_CLASS_MAP).filter(Boolean);
const FONT_SIZE_CLASS_TO_KEY = FONT_SIZE_OPTIONS.reduce((map, option) => {
  if (option.className) {
    map[option.className] = option.value;
  }
  return map;
}, {});
const STATEFUL_COMMANDS = new Set([
  'bold',
  'italic',
  'underline',
  'justifyLeft',
  'justifyCenter',
  'justifyRight'
]);

function createFontSizeSelect() {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-toolbar__font-size';
  const label = document.createElement('span');
  label.className = 'editor-toolbar__font-size-label';
  label.textContent = 'Taille';
  const select = document.createElement('select');
  select.className = 'editor-toolbar__font-size-input';
  select.setAttribute('aria-label', 'Taille du texte');
  const placeholder = document.createElement('option');
  placeholder.value = FONT_SIZE_NEUTRAL_VALUE;
  placeholder.textContent = '\u00a0';
  placeholder.dataset.placeholder = 'true';
  select.appendChild(placeholder);
  FONT_SIZE_OPTIONS.forEach(option => {
    const optionElement = document.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    select.appendChild(optionElement);
  });
  select.value = 'normal';
  wrapper.appendChild(label);
  wrapper.appendChild(select);
  return { wrapper, select };
}

function stripFontSizeClasses(container) {
  if (!container) {
    return;
  }
  const removeClasses = el => {
    if (!el?.classList) {
      return;
    }
    FONT_SIZE_CLASS_NAMES.forEach(className => el.classList.remove(className));
    if (!el.classList.length) {
      el.removeAttribute('class');
    }
  };
  if (container.nodeType === Node.ELEMENT_NODE) {
    removeClasses(container);
  }
  const walker = document.createNodeIterator(
    container,
    NodeFilter.SHOW_ELEMENT,
    null
  );
  while (walker.nextNode()) {
    removeClasses(walker.currentNode);
  }
}

function unwrapEmptyFontSizeSpans(root) {
  if (!root) {
    return;
  }
  const spans = [];
  const walker = document.createNodeIterator(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        return node.tagName?.toLowerCase() === 'span'
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    }
  );
  while (walker.nextNode()) {
    spans.push(walker.currentNode);
  }
  spans.forEach(span => {
    if (!span || !span.attributes || span.attributes.length) {
      return;
    }
    const parent = span.parentNode;
    if (!parent) {
      return;
    }
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  });
}

function getFontSizeKeyFromElement(element) {
  if (!element?.classList) {
    return null;
  }
  for (const className of element.classList) {
    if (Object.prototype.hasOwnProperty.call(FONT_SIZE_CLASS_TO_KEY, className)) {
      return FONT_SIZE_CLASS_TO_KEY[className];
    }
  }
  return null;
}

function findFontSizeParent(node, root) {
  let current = node;
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const sizeKey = getFontSizeKeyFromElement(current);
      if (sizeKey) {
        return current;
      }
    }
    current = current.parentNode;
  }
  return null;
}

function detectFontSizeFromSelection(editor) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    return 'normal';
  }
  if (selection.isCollapsed) {
    const parent = findFontSizeParent(selection.anchorNode, editor);
    return parent ? getFontSizeKeyFromElement(parent) || 'normal' : 'normal';
  }
  const range = selection.getRangeAt(0);
  const foundSizes = new Set();
  const walker = document.createTreeWalker(
    editor,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (!FONT_SIZE_CLASS_NAMES.some(className => node.classList.contains(className))) {
          return NodeFilter.FILTER_SKIP;
        }
        try {
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        } catch (error) {
          return NodeFilter.FILTER_SKIP;
        }
      }
    }
  );
  while (walker.nextNode()) {
    for (const [sizeKey, className] of Object.entries(FONT_SIZE_CLASS_MAP)) {
      if (className && walker.currentNode.classList.contains(className)) {
        foundSizes.add(sizeKey);
      }
    }
  }
  if (!foundSizes.size) {
    return 'normal';
  }
  if (foundSizes.size === 1) {
    return foundSizes.values().next().value;
  }
  return FONT_SIZE_NEUTRAL_VALUE;
}

function applyFontSize(editor, sizeKey) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    return;
  }
  const allowedSizeKey = Object.prototype.hasOwnProperty.call(FONT_SIZE_CLASS_MAP, sizeKey)
    ? sizeKey
    : 'normal';
  const targetClass = FONT_SIZE_CLASS_MAP[allowedSizeKey];
  const range = selection.getRangeAt(0).cloneRange();
  const fragment = range.extractContents();
  stripFontSizeClasses(fragment);
  unwrapEmptyFontSizeSpans(fragment);
  const nodes = Array.from(fragment.childNodes);
  if (!nodes.length) {
    return;
  }
  if (targetClass) {
    const span = document.createElement('span');
    span.classList.add(targetClass);
    span.appendChild(fragment);
    range.insertNode(span);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    selection.addRange(newRange);
  } else {
    range.insertNode(fragment);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartBefore(nodes[0]);
    newRange.setEndAfter(nodes[nodes.length - 1]);
    selection.addRange(newRange);
  }
}

function updateToolbarState(editor, toolbarState) {
  if (!toolbarState) {
    return;
  }
  const { actionButtons, fontSizeSelect } = toolbarState;

  actionButtons.forEach(({ action, button }) => {
    const commandActive =
      STATEFUL_COMMANDS.has(action.command) && document.queryCommandState(action.command);
    button.classList.toggle('is-active', Boolean(commandActive));
  });

  if (fontSizeSelect?.select) {
    const selectedSize = detectFontSizeFromSelection(editor);
    fontSizeSelect.select.value = selectedSize;
  }
}

function createToolbar(editor, onCommandApplied = () => {}) {
  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  const actionButtons = [];

  TOOLBAR_ACTIONS.forEach(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = action.tooltip || action.label;
    button.textContent = action.label;
    button.dataset.command = action.command;
    if (action.value) {
      button.dataset.value = action.value;
    }
    button.addEventListener('click', event => {
      event.preventDefault();
      document.execCommand(action.command, false, action.value || null);
      editor.focus();
      setTimeout(onCommandApplied, 0);
    });
    actionButtons.push({ action, button });
    toolbar.appendChild(button);
  });

  const fontSizeSelect = createFontSizeSelect();
  toolbar.appendChild(fontSizeSelect.wrapper);

  return {
    toolbarElement: toolbar,
    actionButtons,
    fontSizeSelect
  };
}

function createModalContent(options) {
  const { title = 'Édition', description = '', label = '' } = options;
  return `
    <div class="module-modal" role="dialog" aria-modal="true">
      <header class="module-modal__header">
        <div>
          <h3>${label || 'Zone éditoriale'}</h3>
          <p class="muted">${title}</p>
        </div>
        <button type="button" class="module-modal__close" data-editor-close aria-label="Fermer">&times;</button>
      </header>
      <p class="muted">${description}</p>
      <div data-editor-toolbar></div>
      <div
        class="editor-body"
        contenteditable="true"
        data-editor-body
        aria-label="Éditeur WYSIWYG"
      ></div>
      <div class="form-actions">
        <button type="button" class="primary-button" data-editor-save>Enregistrer</button>
        <button type="button" class="secondary-button" data-editor-cancel>Annuler</button>
      </div>
      <p class="form-message" data-editor-feedback></p>
    </div>
  `;
}

function createInlineContent(options) {
  const { title = 'Edition', description = '', label = '' } = options;
  return `
    <section class="epm-inline-editor" data-inline-editor-root>
      <header class="epm-inline-editor__header">
        <h3>${label || 'Zone editoriale'}</h3>
        <p class="epm-inline-editor__meta">${title}</p>
      </header>
      <p class="epm-inline-editor__description">${description}</p>
      <div data-editor-toolbar></div>
      <div
        class="editor-body"
        contenteditable="true"
        data-editor-body
        aria-label="Editeur WYSIWYG"
      ></div>
      <div class="form-actions">
        <button type="button" class="primary-button" data-editor-save>Enregistrer</button>
        <button type="button" class="secondary-button" data-editor-cancel>Annuler</button>
      </div>
      <p class="form-message" data-editor-feedback></p>
    </section>
  `;
}

function mountEditor(options) {
  const overlay = document.createElement('div');
  overlay.className = 'module-modal-overlay module-modal-overlay--visible';
  overlay.setAttribute('tabindex', '-1');
  overlay.innerHTML = createModalContent(options);
  document.body.appendChild(overlay);
  overlay.focus();
  return overlay;
}

export function mountEditorialEditorInline(container, options = {}) {
  if (!container) {
    return null;
  }
  container.innerHTML = createInlineContent(options);
  const root = container.querySelector('[data-inline-editor-root]');
  if (!root) {
    return null;
  }
  const toolbarContainer = root.querySelector('[data-editor-toolbar]');
  const editorBody = root.querySelector('[data-editor-body]');
  const feedback = root.querySelector('[data-editor-feedback]');
  const saveButton = root.querySelector('[data-editor-save]');
  const cancelButton = root.querySelector('[data-editor-cancel]');

  if (!editorBody || !toolbarContainer || !saveButton || !cancelButton) {
    return null;
  }

  editorBody.innerHTML = options.initialHtml || '';

  let toolbarState = null;
  const refreshToolbar = () => {
    if (!toolbarState) return;
    updateToolbarState(editorBody, toolbarState);
  };
  toolbarState = createToolbar(editorBody, () => setTimeout(refreshToolbar, 0));
  toolbarContainer.appendChild(toolbarState.toolbarElement);

  const fontSizeSelect = toolbarState.fontSizeSelect?.select;
  const handleFontSizeChange = event => {
    const selectedValue = event.target.value;
    if (selectedValue === FONT_SIZE_NEUTRAL_VALUE) {
      refreshToolbar();
      return;
    }
    applyFontSize(editorBody, selectedValue);
    setTimeout(refreshToolbar, 0);
  };
  fontSizeSelect?.addEventListener('change', handleFontSizeChange);

  const handleSelectionChange = () => {
    refreshToolbar();
  };
  document.addEventListener('selectionchange', handleSelectionChange);
  refreshToolbar();

  let isSaving = false;
  let isClosed = false;

  const cleanup = () => {
    document.removeEventListener('selectionchange', handleSelectionChange);
    fontSizeSelect?.removeEventListener('change', handleFontSizeChange);
    cancelButton.removeEventListener('click', handleCancel);
    saveButton.removeEventListener('click', handleSave);
    root.removeEventListener('keydown', handleKeyDown);
  };

  const closeEditor = () => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    cleanup();
    if (typeof options.onClose === 'function') {
      options.onClose();
    }
  };

  const showFeedback = (message = '', status = '') => {
    if (!feedback) return;
    feedback.textContent = message;
    if (status) {
      feedback.dataset.status = status;
      return;
    }
    delete feedback.dataset.status;
  };

  const handleCancel = () => {
    if (isSaving) return;
    if (typeof options.onCancel === 'function') {
      options.onCancel();
    }
    closeEditor();
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!options.onSave) {
      closeEditor();
      return;
    }
    const html = editorBody.innerHTML || '';
    try {
      isSaving = true;
      setActionButtonState(saveButton, 'loading', { loadingLabel: 'Enregistrement...' });
      const result = options.onSave(html);
      await (result instanceof Promise ? result : Promise.resolve(result));
      setActionButtonState(saveButton, 'success', { successLabel: 'Enregistre', resetAfterMs: 700 });
      showFeedback('', '');
      if (options.closeOnSave === true) {
        closeEditor();
      }
    } catch (error) {
      console.error('Erreur enregistrement contenu editorial', error);
      showFeedback(error?.message || 'Erreur durant la sauvegarde.', 'error');
      setActionButtonState(saveButton, 'error', { errorLabel: '\u00c9chec', resetAfterMs: 1000 });
    } finally {
      isSaving = false;
      if (saveButton?.dataset?.actionState === 'loading') {
        setActionButtonState(saveButton, 'idle');
      }
    }
  };

  const handleKeyDown = event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handleCancel();
    }
  };

  cancelButton.addEventListener('click', handleCancel);
  saveButton.addEventListener('click', handleSave);
  root.addEventListener('keydown', handleKeyDown);

  editorBody.focus();

  return {
    close: closeEditor,
    editor: editorBody
  };
}

export function openEditorialEditor(options = {}) {
  const overlay = mountEditor(options);
  const toolbarContainer = overlay.querySelector('[data-editor-toolbar]');
  const editorBody = overlay.querySelector('[data-editor-body]');
  const feedback = overlay.querySelector('[data-editor-feedback]');
  const saveButton = overlay.querySelector('[data-editor-save]');
  const cancelButton = overlay.querySelector('[data-editor-cancel]');
  const closeButton = overlay.querySelector('[data-editor-close]');
  if (!editorBody || !toolbarContainer) {
    document.body.removeChild(overlay);
    return;
  }
  editorBody.innerHTML = options.initialHtml || '';
  editorBody.focus();

  let toolbarState = null;
  const refreshToolbar = () => {
    if (!toolbarState) {
      return;
    }
    updateToolbarState(editorBody, toolbarState);
  };
  toolbarState = createToolbar(editorBody, () => setTimeout(refreshToolbar, 0));
  toolbarContainer.appendChild(toolbarState.toolbarElement);

  const fontSizeSelect = toolbarState.fontSizeSelect?.select;
  const handleFontSizeChange = event => {
    const selectedValue = event.target.value;
    if (selectedValue === FONT_SIZE_NEUTRAL_VALUE) {
      refreshToolbar();
      return;
    }
    applyFontSize(editorBody, selectedValue);
    setTimeout(refreshToolbar, 0);
  };
  fontSizeSelect?.addEventListener('change', handleFontSizeChange);

  const handleSelectionChange = () => {
    refreshToolbar();
  };
  document.addEventListener('selectionchange', handleSelectionChange);
  refreshToolbar();

  let isSaving = false;

  const cleanup = () => {
    document.removeEventListener('selectionchange', handleSelectionChange);
    fontSizeSelect?.removeEventListener('change', handleFontSizeChange);
  };

  const closeEditor = () => {
    cleanup();
    overlay.remove();
    if (typeof options.onClose === 'function') {
      options.onClose();
    }
  };

  const handleCancel = () => {
    if (isSaving) return;
    if (typeof options.onCancel === 'function') {
      options.onCancel();
    }
    closeEditor();
  };

  const showFeedback = (message = '', status = '') => {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.status = status;
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!options.onSave) {
      closeEditor();
      return;
    }
    const html = editorBody.innerHTML || '';
    try {
      isSaving = true;
      setActionButtonState(saveButton, 'loading', { loadingLabel: 'Enregistrement...' });
      const result = options.onSave(html);
      await (result instanceof Promise ? result : Promise.resolve(result));
      setActionButtonState(saveButton, 'success', { successLabel: 'Enregistre', resetAfterMs: 700 });
      showFeedback('', '');
      closeEditor();
    } catch (error) {
      console.error('Erreur enregistrement contenu editorial', error);
      showFeedback(error?.message || 'Erreur durant la sauvegarde.', 'error');
      setActionButtonState(saveButton, 'error', { errorLabel: '\u00c9chec', resetAfterMs: 1000 });
    } finally {
      isSaving = false;
      if (saveButton?.dataset?.actionState === 'loading') {
        setActionButtonState(saveButton, 'idle');
      }
    }
  };

  const handleKeyDown = event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handleCancel();
    }
  };

  cancelButton?.addEventListener('click', handleCancel);
  closeButton?.addEventListener('click', handleCancel);
  saveButton?.addEventListener('click', handleSave);
  overlay.addEventListener('keydown', handleKeyDown);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      handleCancel();
    }
  });

  return {
    close: closeEditor,
    editor: editorBody
  };
}

