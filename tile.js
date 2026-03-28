/**
 * Plano Tile — context sheets for katulong.
 *
 * Uses the Tile SDK properly:
 *   setup(sdk, options) receives the real SDK with storage, sessions, etc.
 *   Returns a TilePrototype with mount(el, ctx).
 *
 * Storage: sdk.storage (namespaced per tile type, persists in localStorage)
 * Chrome: ctx.chrome.toolbar/sidebar/shelf
 */

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

function genId() {
  return "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default function setup(sdk, options) {
  let el = null;
  let ctx = null;
  let activeId = null;
  let editorEl = null;
  let editorWrap = null;
  let listEl = null;
  let saveTimer = null;

  // Use sdk.storage for notes persistence (namespaced, survives reload)
  // Falls back to raw localStorage when sdk is not available (test harness)
  const FALLBACK_KEY = "plano_notes";

  function loadNotes() {
    if (sdk?.storage) return sdk.storage.get("notes") || {};
    try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || "{}"); } catch { return {}; }
  }

  function saveNotes(notes) {
    if (sdk?.storage) { sdk.storage.set("notes", notes); return; }
    try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(notes)); } catch {}
  }

  function getNotes() {
    return loadNotes();
  }

  function renderList() {
    if (!listEl) return;
    const notes = getNotes();
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
    if (!editorWrap) return;
    editorWrap.innerHTML = "";
    const notes = getNotes();

    if (!activeId || !notes[activeId]) {
      const empty = document.createElement("div");
      empty.className = "plano-empty";
      empty.textContent = "Create or select a note";
      editorWrap.appendChild(empty);
      editorEl = null;
      return;
    }

    const editor = document.createElement("div");
    editor.className = "pe-editor";
    editor.contentEditable = "true";
    editor.textContent = notes[activeId].content || "";
    editor.addEventListener("input", () => {
      if (!activeId) return;
      const notes = getNotes();
      notes[activeId].content = editor.textContent;
      notes[activeId].updated = Date.now();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveNotes(notes), 400);
    });
    editorWrap.appendChild(editor);
    editorEl = editor;
  }

  function selectNote(id) {
    activeId = id;
    const notes = getNotes();
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
    const notes = getNotes();
    notes[id] = { title, content: "", created: Date.now(), updated: Date.now() };
    saveNotes(notes);
    selectNote(id);
  }

  function deleteNote() {
    if (!activeId) return;
    if (!confirm("Delete this note?")) return;
    const notes = getNotes();
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
      listEl = document.createElement("div");
      listEl.className = "plano-notes-list";
      listEl.style.cssText = "padding:4px 0;overflow-y:auto;";

      if (ctx?.chrome?.sidebar) {
        listEl.style.height = "100%";
        ctx.chrome.sidebar.mount(listEl);
        ctx.chrome.sidebar.setWidth("160px");
      }

      // Fallback: inline controls when no chrome zones
      if (!ctx?.chrome?.toolbar) {
        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;";
        const title = document.createElement("span");
        title.textContent = "Plano";
        title.style.cssText = "font-weight:600;color:#fff;font-size:13px;";
        const btn = document.createElement("button");
        btn.textContent = "+ New Note";
        btn.style.cssText = "background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;";
        btn.addEventListener("click", createNote);
        header.appendChild(title);
        header.appendChild(btn);
        container.style.cssText = (container.style.cssText || "") + "display:flex;flex-direction:column;";
        container.appendChild(header);
        listEl.style.cssText += "max-height:100px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;overflow-y:auto;";
        container.appendChild(listEl);
      }

      // Editor wrapper (goes last in container, fills remaining space)
      editorWrap = document.createElement("div");
      editorWrap.style.cssText = "flex:1;min-height:0;overflow-y:auto;";
      container.appendChild(editorWrap);

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
