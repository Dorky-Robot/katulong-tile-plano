/**
 * Plano — context sheets for katulong.
 *
 * Follows the Tile SDK contract exactly:
 *   export default function setup(sdk, options) → TilePrototype
 */

const STORAGE_KEY = "plano_notes";

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveNotes(notes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}
function genId() {
  return "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Inject styles once
let _styled = false;
function ensureStyles() {
  if (_styled) return;
  _styled = true;
  const s = document.createElement("style");
  s.textContent = `
    .plano-note-item { padding:6px 10px; cursor:pointer; border-radius:4px; margin:2px 4px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#ccc; }
    .plano-note-item:hover { background:rgba(255,255,255,0.08); }
    .plano-note-item.active { background:rgba(255,255,255,0.15); font-weight:600; }
    .plano-empty { display:flex; align-items:center; justify-content:center; height:100%; color:#888; font-size:14px; user-select:none; }
    .pe-editor { flex:1; padding:12px 16px; outline:none; font-size:14px; line-height:1.6; color:#ddd; overflow-y:auto; white-space:pre-wrap; word-wrap:break-word; }
  `;
  document.head.appendChild(s);
}

export default function setup(sdk, options) {
  let el = null;
  let ctx = null;
  let notes = {};
  let activeId = null;
  let editorEl = null;
  let listEl = null;
  let saveTimer = null;

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const [id, note] of Object.entries(notes)) {
      const li = document.createElement("div");
      li.className = "plano-note-item" + (id === activeId ? " active" : "");
      li.textContent = note.title || "Untitled";
      li.addEventListener("click", () => selectNote(id));
      listEl.appendChild(li);
    }
  }

  function renderEditor() {
    if (!el) return;
    el.innerHTML = "";

    if (!activeId || !notes[activeId]) {
      const empty = document.createElement("div");
      empty.className = "plano-empty";
      empty.textContent = "Create or select a note";
      el.appendChild(empty);
      editorEl = null;
      return;
    }

    const editor = document.createElement("div");
    editor.className = "pe-editor";
    editor.contentEditable = "true";
    editor.textContent = notes[activeId].content || "";
    editor.addEventListener("input", () => {
      if (!activeId) return;
      notes[activeId].content = editor.textContent;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveNotes(notes), 400);
    });
    el.appendChild(editor);
    editorEl = editor;
  }

  function selectNote(id) {
    activeId = id;
    if (ctx?.chrome?.toolbar) {
      ctx.chrome.toolbar.setTitle(notes[id]?.title || "Plano");
    }
    renderList();
    renderEditor();
  }

  function createNote() {
    const title = prompt("Note title:");
    if (!title) return;
    const id = genId();
    notes[id] = { title, content: "", created: Date.now() };
    saveNotes(notes);
    selectNote(id);
  }

  function deleteNote() {
    if (!activeId) return;
    if (!confirm("Delete this note?")) return;
    delete notes[activeId];
    saveNotes(notes);
    activeId = null;
    if (ctx?.chrome?.toolbar) ctx.chrome.toolbar.setTitle("Plano");
    renderList();
    renderEditor();
  }

  return {
    type: "plano",

    mount(container, tileCtx) {
      ensureStyles();
      el = container;
      ctx = tileCtx;
      notes = loadNotes();

      // Chrome: toolbar
      if (ctx?.chrome?.toolbar) {
        ctx.chrome.toolbar.setTitle("Plano");
        ctx.chrome.toolbar.addButton({
          icon: "plus", label: "New Note", position: "left", onClick: createNote,
        });
        ctx.chrome.toolbar.addButton({
          icon: "trash", label: "Delete Note", position: "right", onClick: deleteNote,
        });
      }

      // Chrome: sidebar
      if (ctx?.chrome?.sidebar) {
        listEl = document.createElement("div");
        listEl.className = "plano-notes-list";
        listEl.style.cssText = "padding:4px 0;overflow-y:auto;height:100%;";
        ctx.chrome.sidebar.mount(listEl);
        ctx.chrome.sidebar.setWidth("160px");
      }

      renderList();
      renderEditor();
    },

    unmount() {
      clearTimeout(saveTimer);
      if (ctx?.chrome?.sidebar) ctx.chrome.sidebar.unmount();
      el = null;
      ctx = null;
      editorEl = null;
      listEl = null;
    },

    focus() { editorEl?.focus(); },
    blur() {},
    resize() {},
    getTitle() { return "Plano"; },
    getIcon() { return "note-pencil"; },

    serialize() {
      return { type: "plano", activeNoteId: activeId };
    },
  };
}
