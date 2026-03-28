/**
 * Plano — context sheets tile for Katulong.
 *
 * Notes, todos, and project plans. Works standalone with local file storage,
 * or optionally connects to a Tala server for git-backed versioning.
 *
 * TilePrototype interface: mount, unmount, focus, blur, resize,
 * getTitle, getIcon, serialize, restore
 */

// ============================================================
// Storage adapters
// ============================================================

const PLANO_DIR = "~/.katulong/plano/notes";

/**
 * localStorage adapter — works everywhere, no dependencies.
 * Notes stored as JSON in localStorage under "plano_notes" key.
 */
function createLocalStorageAdapter() {
  const STORAGE_KEY = "plano_notes";

  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch { return {}; }
  }

  function saveAll(notes) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  return {
    async init() { /* nothing to do */ },

    async list() {
      const notes = loadAll();
      return Object.entries(notes)
        .map(([slug, data]) => ({ slug, title: data.title || slug }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    async read(slug) {
      const notes = loadAll();
      return notes[slug]?.content || "";
    },

    async write(slug, content) {
      const notes = loadAll();
      if (!notes[slug]) notes[slug] = { title: slug, content: "", createdAt: Date.now() };
      notes[slug].content = content;
      notes[slug].updatedAt = Date.now();
      // Don't overwrite title if already set
      saveAll(notes);
    },

    async create(title) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
      const notes = loadAll();
      let finalSlug = slug;
      if (notes[finalSlug]) finalSlug = `${slug}-${Date.now().toString(36)}`;
      notes[finalSlug] = { title, content: "", createdAt: Date.now(), updatedAt: Date.now() };
      saveAll(notes);
      return { slug: finalSlug, title };
    },

    async remove(slug) {
      const notes = loadAll();
      delete notes[slug];
      saveAll(notes);
    },
  };
}

function createTalaAdapter(talaUrl, talaToken) {
  const headers = { "Content-Type": "application/json" };
  if (talaToken) headers.Authorization = `Bearer ${talaToken}`;

  async function api(path, opts = {}) {
    const url = talaUrl.replace(/\/$/, "") + path;
    const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
    if (!res.ok) throw new Error(`Tala API ${res.status}: ${res.statusText}`);
    return res;
  }

  return {
    async init() {
      // Verify connectivity
      await api("/api/notes");
    },

    async list() {
      const res = await api("/api/notes");
      const data = await res.json();
      return (data.notes || []).map((n) => ({
        slug: n.id || n.slug || n.name,
        title: n.title || n.name || "Untitled",
      }));
    },

    async read(slug) {
      const res = await api(`/api/notes/${encodeURIComponent(slug)}`);
      const data = await res.json();
      // Tala returns { note: { content, ... } }
      return data.note?.content || data.content || "";
    },

    async write(slug, content) {
      try {
        await api(`/api/notes/${encodeURIComponent(slug)}`, {
          method: "PUT",
          body: JSON.stringify({ content }),
        });
      } catch {
        // If PUT fails (note doesn't exist), try creating
        await api("/api/notes", {
          method: "POST",
          body: JSON.stringify({ title: slug }),
        });
      }
    },

    async create(title) {
      const res = await api("/api/notes", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      return { slug: data.note?.id, title: data.note?.title || title };
    },

    async remove(slug) {
      await api(`/api/notes/${encodeURIComponent(slug)}`, { method: "DELETE" });
    },
  };
}

// ============================================================
// Helpers
// ============================================================

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "untitled";
}

function decodeSlug(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
}

// ============================================================
// Markdown rendering (inline)
// ============================================================

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
function esc(s) { return s.replace(/[&<>]/g, (c) => ESC_MAP[c]); }

function fmtInline(text) {
  let h = esc(text);
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="pe-img">');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="pe-link" target="_blank">$1</a>');
  h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  h = h.replace(/__(.+?)__/g, "<b>$1</b>");
  h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  h = h.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");
  h = h.replace(/~~(.+?)~~/g, "<s>$1</s>");
  h = h.replace(/`(.+?)`/g, "<code>$1</code>");
  return h;
}

function normMd(t) {
  return t
    .replace(/^(\s*)-\s*\[\s*\]\s*/, "$1- [ ] ")
    .replace(/^(\s*)-\s*\[x\]\s*/i, "$1- [x] ");
}

// ============================================================
// Markdown line -> HTML element
// ============================================================

function mdLineToEl(md) {
  const t = md.trim();
  if (!t) return null;

  let m;

  // Heading
  m = t.match(/^(#{1,6})\s+(.+)$/);
  if (m) {
    const el = document.createElement(`h${m[1].length}`);
    el.innerHTML = fmtInline(m[2]);
    return el;
  }

  // HR
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return document.createElement("hr");

  // Checkbox
  m = normMd(t).match(/^-\s*\[([ xX]?)\]\s*(.*)$/);
  if (m) {
    const checked = m[1].toLowerCase() === "x";
    const el = document.createElement("div");
    el.className = "pe-todo" + (checked ? " pe-todo-done" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "pe-cb";
    cb.checked = checked;
    cb.contentEditable = "false";
    el.appendChild(cb);
    el.appendChild(document.createTextNode(" "));
    const span = document.createElement("span");
    span.className = "pe-todo-text";
    span.innerHTML = fmtInline(m[2]);
    el.appendChild(span);
    return el;
  }

  // Bullet list
  m = t.match(/^[-*+]\s*(.*)$/);
  if (m && (t.match(/^[-*+]\s/) || t.match(/^[-*+]$/))) {
    const el = document.createElement("div");
    el.className = "pe-li pe-li-ul";
    el.innerHTML = fmtInline(m[1]) || "<br>";
    return el;
  }

  // Ordered list
  m = t.match(/^(\d+)\.\s*(.*)$/);
  if (m && (t.match(/^\d+\.\s/) || t.match(/^\d+\.$/))) {
    const el = document.createElement("div");
    el.className = "pe-li pe-li-ol";
    el.dataset.num = m[1];
    el.innerHTML = fmtInline(m[2]) || "<br>";
    return el;
  }

  // Blockquote
  m = t.match(/^>\s*(.*)$/);
  if (m && t.startsWith(">")) {
    const el = document.createElement("blockquote");
    el.innerHTML = fmtInline(m[1]) || "<br>";
    return el;
  }

  // Inline formatting only
  const formatted = fmtInline(t);
  if (formatted !== esc(t)) {
    const el = document.createElement("div");
    el.innerHTML = formatted;
    return el;
  }

  return null;
}

// ============================================================
// DOM -> Markdown serialization
// ============================================================

function nodeToMd(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  let indent = "";
  const pl = node.style?.paddingLeft || "";
  if (pl) {
    const remMatch = pl.match(/([\d.]+)rem/);
    if (remMatch) {
      const level = Math.round(parseFloat(remMatch[1]) / 0.75);
      indent = "  ".repeat(level);
    }
  }

  const tag = node.tagName;
  if (tag === "BR") return "";
  if (tag === "HR") return indent + "---";
  if (tag === "PRE") {
    const lang = node.dataset?.lang || "";
    const code = node.querySelector("code")?.textContent || node.textContent;
    return "```" + lang + "\n" + code + "\n```";
  }
  if (/^H[1-6]$/.test(tag)) return indent + "#".repeat(parseInt(tag[1])) + " " + inlineMd(node);
  if (tag === "BLOCKQUOTE") return indent + "> " + inlineMd(node);

  if (node.classList?.contains("pe-todo")) {
    const checked = node.querySelector(".pe-cb")?.checked;
    const textEl = node.querySelector(".pe-todo-text");
    const text = textEl ? inlineMd(textEl) : inlineMd(node);
    return `${indent}- [${checked ? "x" : " "}] ${text}`;
  }
  if (node.classList?.contains("pe-li-ol")) {
    const num = node.dataset.num || "1";
    return `${indent}${num}. ${inlineMd(node)}`;
  }
  if (node.classList?.contains("pe-li-ul")) {
    return `${indent}- ${inlineMd(node)}`;
  }

  if (tag === "DIV" || tag === "P") {
    if (node.childNodes.length === 1 && node.firstChild.nodeName === "BR") return indent || "";
    return indent + inlineMd(node);
  }

  return indent + inlineMd(node);
}

function inlineMd(node) {
  let result = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName;
    const inner = inlineMd(child);
    if (tag === "B" || tag === "STRONG") { result += `**${inner}**`; continue; }
    if (tag === "I" || tag === "EM") { result += `*${inner}*`; continue; }
    if (tag === "S" || tag === "DEL") { result += `~~${inner}~~`; continue; }
    if (tag === "CODE" && !child.closest("pre")) { result += "`" + inner + "`"; continue; }
    if (tag === "A") { result += `[${inner}](${child.getAttribute("href") || ""})`; continue; }
    if (tag === "IMG") { result += `![${child.getAttribute("alt") || ""}](${child.getAttribute("src") || ""})`; continue; }
    if (tag === "BR") continue;
    if (tag === "INPUT" && child.classList?.contains("pe-cb")) continue;
    result += inner;
  }
  return result;
}

// ============================================================
// Editor component
// ============================================================

function createEditor(container) {
  const editor = document.createElement("div");
  editor.className = "pe-editor";
  editor.contentEditable = "true";
  editor.spellcheck = true;
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  container.appendChild(editor);

  let dirty = false;
  let changeCallbacks = [];

  function editorToMarkdown() {
    const lines = [];
    for (const node of editor.childNodes) {
      lines.push(nodeToMd(node));
    }
    return lines.join("\n");
  }

  function loadMarkdown(md) {
    editor.innerHTML = "";
    if (!md) {
      editor.innerHTML = "<div><br></div>";
      return;
    }

    const lines = md.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        const pre = document.createElement("pre");
        pre.className = "pe-code-block";
        if (lang) pre.dataset.lang = lang;
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.appendChild(code);
        pre.contentEditable = "false";
        editor.appendChild(pre);
        continue;
      }

      const indentMatch = line.match(/^(\s+)/);
      const level = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;

      const el = mdLineToEl(line);
      if (el) {
        if (level > 0) el.style.paddingLeft = level * 0.75 + "rem";
        editor.appendChild(el);
      } else {
        const div = document.createElement("div");
        if (line) div.textContent = line;
        else div.innerHTML = "<br>";
        editor.appendChild(div);
      }
      i++;
    }
  }

  function placeCursorIn(el) {
    const sel = window.getSelection();
    const range = document.createRange();
    // Find first text node or use the element itself
    let target = el;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNode = walker.lastChild();
    if (textNode) {
      range.setStart(textNode, textNode.length);
      range.collapse(true);
    } else {
      range.selectNodeContents(el);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCursorAt(node, offset) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function ensureEditableAndFocus(el) {
    // For rich elements, find the text-editable area
    const textArea = el.querySelector(".pe-todo-text") || el;
    placeCursorIn(textArea);
  }

  function getBlockIndent(block) {
    const pl = block.style?.paddingLeft || "";
    if (!pl) return "";
    const remMatch = pl.match(/([\d.]+)rem/);
    if (remMatch) return "  ".repeat(Math.round(parseFloat(remMatch[1]) / 0.75));
    return "";
  }

  function isEmptyListItem(text, block) {
    const t = normMd(text).replace(/\u00A0/g, " ").trim();
    if (block?.classList?.contains("pe-todo")) {
      const textEl = block.querySelector(".pe-todo-text");
      return !textEl?.textContent?.trim();
    }
    if (block?.classList?.contains("pe-li-ul")) return !block.textContent.trim();
    if (block?.classList?.contains("pe-li-ol")) return !block.textContent.trim();
    if (/^[-*+]$/.test(t)) return true;
    if (/^\d+\.$/.test(t)) return true;
    if (/^-\s*\[[ xX]?\]$/.test(t)) return true;
    return false;
  }

  function getListPrefix(text, block) {
    if (block) {
      if (block.classList?.contains("pe-todo")) {
        return getBlockIndent(block) + "- [ ] ";
      }
      if (block.classList?.contains("pe-li-ul")) {
        return getBlockIndent(block) + "- ";
      }
      if (block.classList?.contains("pe-li-ol")) {
        const num = parseInt(block.dataset.num || "1") + 1;
        return getBlockIndent(block) + `${num}. `;
      }
    }
    const t = normMd(text).replace(/\u00A0/g, " ").trim();
    if (/^-\s*\[[ xX]?\]\s+./.test(t)) return "- [ ] ";
    if (/^([-*+])\s+./.test(t)) return t.match(/^([-*+])\s/)[0];
    if (/^(\d+)\.\s+./.test(t)) {
      const num = parseInt(t.match(/^(\d+)/)[1]) + 1;
      return `${num}. `;
    }
    return null;
  }

  function sync() {
    dirty = true;
    changeCallbacks.forEach((fn) => fn());
  }

  // Key handling
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      handleEnter(e);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel.rangeCount) return;

      let block = sel.anchorNode;
      while (block && block.parentNode !== editor) block = block.parentNode;
      if (!block || block === editor) return;

      const md = nodeToMd(block).replace(/\u00A0/g, " ");
      let newMd;
      if (e.shiftKey) {
        newMd = md.startsWith("  ") ? md.slice(2) : md;
      } else {
        newMd = "  " + md;
      }
      const newIndent = (newMd.match(/^(\s*)/) || ["", ""])[1];
      const level = Math.floor(newIndent.length / 2);

      const newEl = mdLineToEl(newMd);
      if (newEl) {
        if (level > 0) newEl.style.paddingLeft = level * 0.75 + "rem";
        else newEl.style.paddingLeft = "";
        block.replaceWith(newEl);
        ensureEditableAndFocus(newEl);
      } else {
        const div = document.createElement("div");
        if (level > 0) {
          div.textContent = newMd.trimStart();
          div.style.paddingLeft = level * 0.75 + "rem";
        } else {
          div.textContent = newMd;
        }
        block.replaceWith(div);
        placeCursorIn(div);
      }
      sync();
      return;
    }
  });

  function handleEnter(e) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    let block = sel.anchorNode;
    while (block && block.parentNode !== editor) block = block.parentNode;
    if (!block || block === editor) return;

    const fullText = block.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");

    // Cursor offset
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(block);
    preRange.setEnd(range.startContainer, range.startOffset);
    const cursorOffset = preRange.toString().replace(/\u200B/g, "").length;
    const atEnd = cursorOffset >= fullText.length;

    const text = fullText;

    // Code block opening
    if (fullText.trim().startsWith("```") && !block.closest("pre")) {
      e.preventDefault();
      const lang = fullText.trim().slice(3).trim();
      const pre = document.createElement("pre");
      pre.className = "pe-code-block";
      if (lang) pre.dataset.lang = lang;
      const code = document.createElement("code");
      code.textContent = "\n";
      pre.appendChild(code);
      pre.contentEditable = "true";
      block.replaceWith(pre);
      placeCursorAt(code.firstChild || code.appendChild(document.createTextNode("")), 0);
      sync();
      return;
    }

    // Inside code block — check for closing ```
    const preBlock = block.closest ? block.closest("pre.pe-code-block") : null;
    if (preBlock) {
      const codeEl = preBlock.querySelector("code") || preBlock;
      const codeText = codeEl.innerText || codeEl.textContent;
      const codeLines = codeText.split("\n");
      while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === "") codeLines.pop();
      const lastLine = codeLines[codeLines.length - 1]?.trim();
      if (lastLine === "```") {
        e.preventDefault();
        codeLines.pop();
        while (codeLines.length > 0 && codeLines[codeLines.length - 1] === "") codeLines.pop();
        codeEl.textContent = codeLines.join("\n");
        preBlock.contentEditable = "false";
        const newDiv = document.createElement("div");
        newDiv.innerHTML = "<br>";
        preBlock.after(newDiv);
        placeCursorIn(newDiv);
        sync();
        return;
      }
      setTimeout(() => sync(), 0);
      return;
    }

    // Empty list item — exit list
    if (isEmptyListItem(text, block)) {
      e.preventDefault();
      const emptyDiv = document.createElement("div");
      emptyDiv.innerHTML = "<br>";
      block.replaceWith(emptyDiv);
      placeCursorIn(emptyDiv);
      sync();
      return;
    }

    const afterCursor = atEnd ? "" : fullText.slice(cursorOffset);
    const convertText = atEnd ? text : fullText.slice(0, cursorOffset);

    // Convert markdown to rich text
    const richEl = mdLineToEl(convertText);
    if (richEl) {
      e.preventDefault();
      if (block.style?.paddingLeft) richEl.style.paddingLeft = block.style.paddingLeft;

      const prefix = getListPrefix(convertText, block);
      block.replaceWith(richEl);

      if (prefix) {
        const nextEl = mdLineToEl(prefix.trimEnd());
        if (nextEl) {
          if (richEl.style?.paddingLeft) nextEl.style.paddingLeft = richEl.style.paddingLeft;
          richEl.after(nextEl);
          ensureEditableAndFocus(nextEl);
        } else {
          const newDiv = document.createElement("div");
          newDiv.textContent = prefix.replace(/ $/, "\u00A0");
          richEl.after(newDiv);
          placeCursorAt(newDiv.firstChild, prefix.length);
        }
      } else {
        const newDiv = document.createElement("div");
        if (afterCursor) newDiv.textContent = afterCursor;
        else newDiv.innerHTML = "<br>";
        richEl.after(newDiv);
        placeCursorIn(newDiv);
      }
      sync();
      return;
    }

    // Rich text list continuation
    const prefix = getListPrefix(text, block);
    if (prefix) {
      e.preventDefault();
      const nextEl = mdLineToEl(prefix.trimEnd());
      if (nextEl) {
        if (block.style?.paddingLeft) nextEl.style.paddingLeft = block.style.paddingLeft;
        block.after(nextEl);
        ensureEditableAndFocus(nextEl);
      } else {
        const newDiv = document.createElement("div");
        newDiv.innerHTML = "<br>";
        block.after(newDiv);
        placeCursorIn(newDiv);
      }
      sync();
      return;
    }

    // Plain text — let browser handle, sync after
    setTimeout(() => sync(), 0);
  }

  // Checkbox click handling
  editor.addEventListener("click", (e) => {
    if (e.target.classList?.contains("pe-cb")) {
      const todo = e.target.closest(".pe-todo");
      if (todo) {
        todo.classList.toggle("pe-todo-done", e.target.checked);
        sync();
      }
    }
  });

  // Input event for tracking changes
  editor.addEventListener("input", () => sync());

  // Copy produces markdown
  editor.addEventListener("copy", (e) => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const frag = range.cloneContents();
    const tmp = document.createElement("div");
    tmp.appendChild(frag);
    const lines = [];
    for (const node of tmp.childNodes) lines.push(nodeToMd(node));
    const md = lines.join("\n");
    if (md) {
      e.clipboardData.setData("text/plain", md);
      e.preventDefault();
    }
  });

  return {
    el: editor,
    loadMarkdown,
    toMarkdown: editorToMarkdown,
    onChange(fn) { changeCallbacks.push(fn); },
    isDirty() { return dirty; },
    clearDirty() { dirty = false; },
    focus() { editor.focus(); },
  };
}

// ============================================================
// Main tile setup
// ============================================================

function _log(msg) {
  try { fetch("/api/client-log", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({msg, ts: Date.now()}) }); } catch {}
}

export default function setup(sdk, options = {}) {
  _log("plano:setup called");
  return function createPlanoTile(tileOptions = {}) {
    _log("plano:createPlanoTile called");
    let container = null;
    let ctx = null;
    let adapter = null;
    let editorInstance = null;
    let notesList = [];
    let activeNote = null;
    let saveTimer = null;

    // DOM references
    let rootEl = null;
    let sidebarEl = null;
    let notesListEl = null;
    let editorWrap = null;
    let shelfInput = null;

    function getConfig(key) {
      // Check tile options, then sdk config
      return tileOptions[key] || options[key] || sdk?.config?.[key] || null;
    }

    function initAdapter() {
      const talaUrl = getConfig("talaUrl");
      const talaToken = getConfig("talaToken");

      // If Tala is configured, use it (optional upgrade)
      if (talaUrl) {
        return createTalaAdapter(talaUrl, talaToken || null);
      }

      // Default: localStorage — works everywhere, no dependencies
      return createLocalStorageAdapter();
    }

    function buildUI(el) {
      rootEl = document.createElement("div");
      rootEl.className = "plano-root";

      // Inject styles
      if (!document.getElementById("plano-styles")) {
        const style = document.createElement("style");
        style.id = "plano-styles";
        style.textContent = PLANO_CSS;
        document.head.appendChild(style);
      }

      // Sidebar
      sidebarEl = document.createElement("div");
      sidebarEl.className = "plano-sidebar";

      const sidebarHeader = document.createElement("div");
      sidebarHeader.className = "plano-sidebar-header";

      const newBtn = document.createElement("button");
      newBtn.className = "plano-btn plano-btn-new";
      newBtn.textContent = "+ New Note";
      newBtn.addEventListener("click", handleNewNote);
      sidebarHeader.appendChild(newBtn);

      sidebarEl.appendChild(sidebarHeader);

      notesListEl = document.createElement("div");
      notesListEl.className = "plano-notes-list";
      sidebarEl.appendChild(notesListEl);

      // Main area
      const mainEl = document.createElement("div");
      mainEl.className = "plano-main";

      // Title bar
      const titleBar = document.createElement("div");
      titleBar.className = "plano-title-bar";
      const titleInput = document.createElement("input");
      titleInput.className = "plano-title-input";
      titleInput.placeholder = "Note title...";
      titleInput.addEventListener("input", () => {
        if (activeNote) {
          activeNote._newTitle = titleInput.value;
          scheduleSave();
        }
      });
      titleBar.appendChild(titleInput);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "plano-btn plano-btn-delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", handleDeleteNote);
      titleBar.appendChild(deleteBtn);

      mainEl.appendChild(titleBar);

      // Editor
      editorWrap = document.createElement("div");
      editorWrap.className = "plano-editor-wrap";
      editorInstance = createEditor(editorWrap);
      editorInstance.onChange(() => scheduleSave());
      mainEl.appendChild(editorWrap);

      // Empty state
      const emptyState = document.createElement("div");
      emptyState.className = "plano-empty";
      emptyState.innerHTML = '<div class="plano-empty-icon">&#128221;</div><div>Create or select a note</div>';
      mainEl.appendChild(emptyState);

      // Chat shelf
      const shelf = document.createElement("div");
      shelf.className = "plano-shelf";
      shelfInput = document.createElement("input");
      shelfInput.className = "plano-shelf-input";
      shelfInput.placeholder = "Send to terminal...";
      shelfInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && shelfInput.value.trim()) {
          if (sdk?.terminal?.send) {
            sdk.terminal.send(shelfInput.value + "\n");
          }
          shelfInput.value = "";
        }
      });
      shelf.appendChild(shelfInput);
      mainEl.appendChild(shelf);

      rootEl.appendChild(sidebarEl);
      rootEl.appendChild(mainEl);
      el.appendChild(rootEl);

      updateUI();
    }

    function updateUI() {
      // Update sidebar note list
      if (notesListEl) {
        notesListEl.innerHTML = "";
        for (const note of notesList) {
          const item = document.createElement("div");
          item.className = "plano-note-item" + (activeNote?.slug === note.slug ? " active" : "");
          item.textContent = note.title;
          item.addEventListener("click", () => selectNote(note.slug));
          notesListEl.appendChild(item);
        }
      }

      // Update toolbar title
      if (ctx?.chrome?.toolbar) {
        ctx.chrome.toolbar.setTitle(activeNote ? activeNote.title : "Plano");
      }

      // Show editor or empty state in contentEl
      if (editorWrap) {
        if (activeNote) {
          editorWrap.innerHTML = "";

          // Use <tala-editor> web component if available, fallback to built-in
          if (customElements.get("tala-editor")) {
            const te = document.createElement("tala-editor");
            te.setAttribute("theme", "dark");
            te.style.cssText = "height:100%;";
            te.addEventListener("change", () => scheduleSave());
            te.addEventListener("save", () => scheduleSave());
            editorWrap.appendChild(te);
            editorInstance = {
              loadMarkdown(md) { te.value = md; },
              clearDirty() {},
              isDirty() { return false; },
              toMarkdown() { return te.value; },
              onChange(fn) { te.addEventListener("change", fn); },
              focus() { te.focus(); },
            };
          } else {
            // Fallback to built-in editor
            editorInstance = createEditor(editorWrap);
            editorInstance.onChange(() => scheduleSave());
          }
        } else {
          editorWrap.innerHTML = '<div class="plano-empty"><span style="font-size:24px;">&#128221;</span><span>Create or select a note</span></div>';
          editorInstance = null;
        }
      }
    }

    async function loadNotes() {
      try {
        notesList = await adapter.list();
        updateUI();
      } catch (err) {
        console.error("[plano] Failed to load notes:", err);
        notesList = [];
        updateUI();
      }
    }

    async function selectNote(slug) {
      await saveCurrentNote();

      try {
        const content = await adapter.read(slug);
        activeNote = notesList.find((n) => n.slug === slug) || { slug, title: decodeSlug(slug) };
        updateUI(); // This creates the editor if needed
        if (editorInstance) {
          editorInstance.loadMarkdown(content);
          editorInstance.clearDirty();
        }
      } catch (err) {
        console.error("[plano] Failed to load note:", err);
      }
    }

    async function handleNewNote() {
      await saveCurrentNote();

      const name = prompt("Note name:");
      if (!name) return;

      const content = `# ${name}\n\n`;

      try {
        let slug;
        if (adapter.create) {
          const result = await adapter.create(name);
          slug = result.slug;
          await adapter.write(slug, content);
        } else {
          slug = slugify(name);
          await adapter.write(slug, content);
        }
        await loadNotes();
        await selectNote(slug);
      } catch (err) {
        console.error("[plano] Failed to create note:", err);
      }
    }

    async function handleDeleteNote() {
      if (!activeNote) return;
      if (!confirm(`Delete "${activeNote.title}"?`)) return;

      try {
        await adapter.remove(activeNote.slug);
        activeNote = null;
        editorInstance.loadMarkdown("");
        await loadNotes();
      } catch (err) {
        console.error("[plano] Failed to delete note:", err);
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveCurrentNote(), 2000);
    }

    async function saveCurrentNote() {
      if (!activeNote) return;
      if (!editorInstance.isDirty() && !activeNote._newTitle) return;

      const content = editorInstance.toMarkdown();
      const slug = activeNote.slug;

      // Handle rename
      if (activeNote._newTitle && activeNote._newTitle !== activeNote.title) {
        const newSlug = slugify(activeNote._newTitle);
        if (newSlug !== slug) {
          try {
            await adapter.write(newSlug, content);
            await adapter.remove(slug);
            activeNote.slug = newSlug;
            activeNote.title = activeNote._newTitle;
            delete activeNote._newTitle;
            editorInstance.clearDirty();
            await loadNotes();
            return;
          } catch (err) {
            console.error("[plano] Rename failed:", err);
          }
        }
      }

      try {
        await adapter.write(slug, content);
        editorInstance.clearDirty();
      } catch (err) {
        console.error("[plano] Save failed:", err);
      }
    }

    // ---- TilePrototype interface ----

    return {
      type: "plano",

      async mount(el, tileCtx) {
        _log("plano:mount called");
        container = el;
        ctx = tileCtx;

        // Load <tala-editor> web component if not already registered
        if (!customElements.get("tala-editor")) {
          try {
            await import("/extensions/plano/tala-editor.js");
            _log("plano: tala-editor loaded");
          } catch (err) {
            _log("plano: tala-editor load failed: " + err.message);
          }
        }

        try {
          adapter = initAdapter();
        } catch (e) {
          el.innerHTML = `<div style="padding:20px;color:#f88;font-family:monospace;">[plano] ${e.message}</div>`;
          return;
        }

        const hasChrome = !!(ctx?.chrome?.toolbar);

        // ── Chrome: Toolbar ──────────────────────────────
        if (hasChrome) {
          ctx.chrome.toolbar.setTitle("Plano");
          ctx.chrome.toolbar.addButton({
            icon: "plus",
            label: "New Note",
            position: "left",
            onClick: handleNewNote,
          });
          ctx.chrome.toolbar.addButton({
            icon: "trash",
            label: "Delete Note",
            position: "right",
            onClick: handleDeleteNote,
          });
        }

        // ── Chrome: Sidebar (note list) ──────────────────
        notesListEl = document.createElement("div");
        notesListEl.className = "plano-notes-list";
        notesListEl.style.cssText = "padding:8px;overflow-y:auto;";

        if (ctx?.chrome?.sidebar) {
          ctx.chrome.sidebar.mount(notesListEl);
          ctx.chrome.sidebar.setWidth("160px");
        }

        // ── Fallback: inline controls when no chrome ─────
        if (!hasChrome) {
          // Make container a flex column so editor fills remaining space
          el.style.cssText = (el.style.cssText || "") + "display:flex;flex-direction:column;";
          const header = document.createElement("div");
          header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;";
          const title = document.createElement("span");
          title.textContent = "Plano";
          title.style.cssText = "font-weight:600;color:#fff;font-family:-apple-system,sans-serif;font-size:13px;";
          const newBtn = document.createElement("button");
          newBtn.textContent = "+ New Note";
          newBtn.style.cssText = "background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-family:-apple-system,sans-serif;";
          newBtn.addEventListener("click", handleNewNote);
          header.appendChild(title);
          header.appendChild(newBtn);
          el.appendChild(header);

          // Inline sidebar (note list above editor)
          notesListEl.style.cssText += "max-height:120px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;";
          el.appendChild(notesListEl);
        }

        // ── Chrome: Shelf (chat input) ───────────────────
        if (ctx?.chrome?.shelf) {
          const shelfEl = document.createElement("div");
          shelfEl.style.cssText = "display:flex;gap:8px;padding:6px 8px;align-items:center;";
          const input = document.createElement("input");
          input.type = "text";
          input.placeholder = "Chat with agent...";
          input.style.cssText = "flex:1;padding:5px 8px;border:1px solid rgba(255,255,255,0.15);border-radius:4px;background:rgba(255,255,255,0.05);color:#e0e0e0;font-size:12px;outline:none;font-family:inherit;";
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && input.value.trim()) {
              // Send to back-face terminal via ctx
              if (ctx.sendWs) ctx.sendWs({ type: "terminal:input", data: input.value + "\n" });
              input.value = "";
            }
          });
          const flipBtn = document.createElement("button");
          flipBtn.style.cssText = "background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:14px;padding:2px 4px;";
          flipBtn.innerHTML = '<i class="ph ph-terminal-window"></i>';
          flipBtn.title = "Flip to terminal";
          flipBtn.addEventListener("click", () => { if (ctx.flip) ctx.flip(); });
          shelfEl.appendChild(input);
          shelfEl.appendChild(flipBtn);
          ctx.chrome.shelf.mount(shelfEl);
        }

        // ── Content: Editor ──────────────────────────────
        // Inject minimal styles
        if (!document.getElementById("plano-styles")) {
          const style = document.createElement("style");
          style.id = "plano-styles";
          style.textContent = `
            .plano-note-item { padding:5px 8px; margin:1px 0; border-radius:3px; cursor:pointer; font-size:11px; color:rgba(255,255,255,0.6); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:-apple-system,sans-serif; }
            .plano-note-item:hover { background:rgba(255,255,255,0.08); }
            .plano-note-item.active { color:#fff; background:rgba(255,255,255,0.12); }
            .plano-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; flex:1; min-height:0; color:rgba(255,255,255,0.3); font-family:-apple-system,sans-serif; font-size:13px; gap:8px; }
          `;
          document.head.appendChild(style);
        }

        // Editor area fills contentEl (use flex:1 for chrome layout)
        editorWrap = document.createElement("div");
        editorWrap.style.cssText = "flex:1;min-height:0;overflow-y:auto;";

        // Empty state
        editorWrap.innerHTML = '<div class="plano-empty"><span style="font-size:24px;">📝</span><span>Create or select a note</span></div>';

        el.appendChild(editorWrap);
        rootEl = el;

        // Load notes
        adapter.init().then(() => loadNotes()).catch((err) => {
          _log("plano:adapter init failed: " + err.message);
          adapter = createLocalStorageAdapter();
          adapter.init().then(() => loadNotes());
        });
      },

      unmount() {
        saveCurrentNote();
        if (saveTimer) clearTimeout(saveTimer);
        if (ctx?.chrome?.sidebar) ctx.chrome.sidebar.unmount();
        if (ctx?.chrome?.shelf) ctx.chrome.shelf.unmount();
        rootEl = null;
        container = null;
        ctx = null;
      },

      focus() {
        if (activeNote && editorInstance) {
          editorInstance.focus();
        }
      },

      blur() {},

      resize() {},

      getTitle() {
        return activeNote ? activeNote.title : "Plano";
      },

      getIcon() {
        return "note-pencil";
      },

      serialize() {
        return {
          type: "plano",
          activeNote: activeNote?.slug || null,
        };
      },

      restore(state) {
        if (state?.activeNote) {
          // Wait for notes to load, then select
          const check = setInterval(() => {
            if (notesList.length > 0 || !adapter) {
              clearInterval(check);
              if (notesList.find((n) => n.slug === state.activeNote)) {
                selectNote(state.activeNote);
              }
            }
          }, 200);
          // Timeout after 5 seconds
          setTimeout(() => clearInterval(check), 5000);
        }
      },

      canClose() {
        if (editorInstance?.isDirty()) {
          saveCurrentNote();
        }
        return true;
      },
    };
  };
}

// ============================================================
// Styles
// ============================================================

const PLANO_CSS = `
.plano-root {
  display: flex;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: #e0e0e0;
  background: #1a1a2e;
}

/* Sidebar */
.plano-sidebar {
  width: 200px;
  min-width: 160px;
  border-right: 1px solid #2a2a4a;
  display: flex;
  flex-direction: column;
  background: #16162a;
}

.plano-sidebar-header {
  padding: 8px;
  border-bottom: 1px solid #2a2a4a;
}

.plano-btn {
  border: none;
  border-radius: 4px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.plano-btn-new {
  width: 100%;
  background: #2a4a6a;
  color: #e0e0e0;
}
.plano-btn-new:hover { background: #3a5a7a; }

.plano-btn-delete {
  background: transparent;
  color: #aa4444;
  font-size: 12px;
}
.plano-btn-delete:hover { background: #3a1a1a; }

.plano-notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.plano-note-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  border-left: 3px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plano-note-item:hover { background: #1e1e3a; }
.plano-note-item.active {
  background: #1e2e4a;
  border-left-color: #4a8af4;
}

/* Main area */
.plano-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.plano-title-bar {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid #2a2a4a;
  gap: 8px;
}

.plano-title-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  outline: none;
  padding: 4px 0;
}
.plano-title-input::placeholder { color: #555; }

/* Editor */
.plano-editor-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.pe-editor {
  min-height: 100%;
  padding: 12px 16px;
  outline: none;
  font-size: 14px;
  line-height: 1.6;
  color: #e0e0e0;
}

.pe-editor:empty::before {
  content: "Start typing...";
  color: #555;
  pointer-events: none;
}

.pe-editor h1 { font-size: 1.6em; font-weight: 700; margin: 0.5em 0 0.3em; color: #fff; }
.pe-editor h2 { font-size: 1.3em; font-weight: 600; margin: 0.4em 0 0.2em; color: #f0f0f0; }
.pe-editor h3 { font-size: 1.1em; font-weight: 600; margin: 0.3em 0 0.2em; color: #e8e8e8; }
.pe-editor h4, .pe-editor h5, .pe-editor h6 { font-size: 1em; font-weight: 600; margin: 0.2em 0; }

.pe-editor hr {
  border: none;
  border-top: 1px solid #3a3a5a;
  margin: 12px 0;
}

.pe-editor blockquote {
  border-left: 3px solid #4a8af4;
  margin: 4px 0;
  padding: 2px 12px;
  color: #aaa;
}

.pe-editor code {
  background: #2a2a4a;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 0.9em;
}

.pe-editor pre.pe-code-block {
  background: #0d0d1a;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  padding: 12px;
  margin: 8px 0;
  overflow-x: auto;
}
.pe-editor pre.pe-code-block code {
  background: none;
  padding: 0;
  font-size: 13px;
  color: #ccc;
}

/* List items */
.pe-li {
  position: relative;
  padding-left: 1.2em;
}
.pe-li-ul::before {
  content: "\\2022";
  position: absolute;
  left: 0.2em;
  color: #888;
}
.pe-li-ol::before {
  content: attr(data-num) ".";
  position: absolute;
  left: 0;
  color: #888;
  font-size: 0.9em;
}

/* Checkboxes */
.pe-todo {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 1px 0;
}
.pe-cb {
  margin-top: 4px;
  accent-color: #4a8af4;
  cursor: pointer;
}
.pe-todo-done .pe-todo-text {
  text-decoration: line-through;
  color: #666;
}

/* Links and images */
.pe-link { color: #4a8af4; text-decoration: underline; }
.pe-img { max-width: 100%; border-radius: 4px; margin: 4px 0; }

.pe-editor b, .pe-editor strong { font-weight: 700; }
.pe-editor i, .pe-editor em { font-style: italic; }
.pe-editor s, .pe-editor del { text-decoration: line-through; color: #888; }

/* Empty state */
.plano-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #555;
  gap: 8px;
  font-size: 14px;
}
.plano-empty-icon { font-size: 48px; opacity: 0.3; }

/* Chat shelf */
.plano-shelf {
  padding: 8px 12px;
  border-top: 1px solid #2a2a4a;
}

.plano-shelf-input {
  width: 100%;
  background: #0d0d1a;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  color: #e0e0e0;
  padding: 6px 10px;
  font-size: 13px;
  font-family: "SF Mono", "Fira Code", monospace;
  outline: none;
  box-sizing: border-box;
}
.plano-shelf-input:focus { border-color: #4a8af4; }
.plano-shelf-input::placeholder { color: #444; }

/* Scrollbar */
.plano-notes-list::-webkit-scrollbar,
.plano-editor-wrap::-webkit-scrollbar {
  width: 6px;
}
.plano-notes-list::-webkit-scrollbar-thumb,
.plano-editor-wrap::-webkit-scrollbar-thumb {
  background: #2a2a4a;
  border-radius: 3px;
}
`;
