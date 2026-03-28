/**
 * <tala-editor> — WYSIWYG markdown editor web component.
 *
 * Built on tala-md.js for all markdown ↔ HTML conversion.
 * Drop into any page:
 *
 *   <script type="module" src="tala-editor.js"></script>
 *   <tala-editor theme="dark" value="# Hello"></tala-editor>
 *
 * Attributes: value, readonly, theme ("light" | "dark")
 * Events: change (detail.markdown), save (Cmd+S), file-drop (detail.files)
 * Properties: .value (get/set markdown), .markdown, .focus(), .undo(), .redo()
 */

import {
  esc, fmtInline, normMd, mdLineToEl, mdLineToHtml,
  nodeToMd, inlineMd, editorToMarkdown, loadMarkdownInto,
  getListPrefix, isEmptyListItem, getBlockIndent, TALA_MD_STYLES,
} from "./tala-md.js";

class TalaEditor extends HTMLElement {
  static get observedAttributes() { return ["value", "readonly", "theme"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._snapshots = [""];
    this._head = 0;
    this._isUndoRedo = false;
    this._snapshotTimer = null;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; height:100%; }
        .te-editor {
          height:100%; outline:none; padding:12px 16px; padding-bottom:40vh;
          font-family:Georgia,"Times New Roman",serif; font-size:1rem; line-height:1.7;
          color:var(--tm-fg); background:var(--tm-bg);
          word-wrap:break-word; overflow-wrap:break-word; overflow-y:auto;
        }
        .te-editor:empty::before { content:"Start writing..."; color:var(--tm-muted); font-style:italic; }
        .te-drop-active { outline:2px dashed var(--tm-accent); outline-offset:-4px; border-radius:4px; }
        ${TALA_MD_STYLES}
      </style>
      <div class="te-editor" part="editor"
           contenteditable="true" spellcheck="true" autocorrect="off"
           role="textbox" aria-multiline="true"></div>
    `;
    this._editor = this.shadowRoot.querySelector(".te-editor");
  }

  connectedCallback() {
    const ed = this._editor;

    ed.addEventListener("input", () => { this._fireChange(); this._scheduleSnapshot(); });
    ed.addEventListener("keydown", (e) => this._onKeydown(e));

    // Paste
    ed.addEventListener("paste", (e) => {
      if (e.clipboardData?.files?.length > 0) {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent("file-drop", { detail: { files: [...e.clipboardData.files] } }));
        return;
      }
      e.preventDefault();
      document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
    });

    // Copy as markdown
    ed.addEventListener("copy", (e) => { const md = this._selToMd(); if (md !== null) { e.preventDefault(); e.clipboardData.setData("text/plain", md); } });
    ed.addEventListener("cut", (e) => { const md = this._selToMd(); if (md !== null) { e.preventDefault(); e.clipboardData.setData("text/plain", md); document.execCommand("delete"); } });

    // Checkbox
    ed.addEventListener("change", (e) => {
      if (e.target.classList?.contains("tm-cb")) {
        const todo = e.target.closest(".tm-todo");
        if (todo) todo.classList.toggle("tm-todo-done", e.target.checked);
        this._fireChange(); this._pushSnapshot(this._getMd());
      }
    });

    // Click code block to edit / click empty space
    ed.addEventListener("click", (e) => {
      const pre = e.target.closest("pre.tm-code-block");
      if (pre && pre.contentEditable === "false") { pre.contentEditable = "true"; this._placeCursorIn(pre.querySelector("code") || pre); return; }
      if (e.target === ed) {
        const last = ed.lastElementChild;
        if (!last || last.contentEditable === "false") {
          const div = document.createElement("div"); div.innerHTML = "<br>"; ed.appendChild(div); this._placeCursorIn(div); this._fireChange();
        }
      }
    });

    // Drop files
    ed.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); ed.classList.add("te-drop-active"); } });
    ed.addEventListener("dragleave", () => ed.classList.remove("te-drop-active"));
    ed.addEventListener("drop", (e) => {
      ed.classList.remove("te-drop-active");
      if (e.dataTransfer?.files?.length > 0) { e.preventDefault(); this.dispatchEvent(new CustomEvent("file-drop", { detail: { files: [...e.dataTransfer.files] } })); }
    });

    if (this.hasAttribute("value")) this._loadMd(this.getAttribute("value") || "");
    if (this.hasAttribute("readonly")) ed.contentEditable = "false";
  }

  attributeChangedCallback(name, _old, val) {
    if (name === "value" && !this._isUndoRedo) this._loadMd(val || "");
    if (name === "readonly") this._editor.contentEditable = val !== null ? "false" : "true";
    if (name === "theme") this.style.colorScheme = val === "dark" ? "dark" : "light";
  }

  // ── Public API ──────────────────────────────────

  get value() { return this._getMd(); }
  set value(md) { this._loadMd(md || ""); }
  get markdown() { return this._getMd(); }
  focus() { this._editor.focus(); }
  blur() { this._editor.blur(); }
  undo() { return this._undoSnap(); }
  redo() { return this._redoSnap(); }
  insertText(text) { this._editor.focus(); document.execCommand("insertText", false, text); this._fireChange(); }

  // ── Internal ────────────────────────────────────

  _getMd() { return editorToMarkdown(this._editor); }

  _loadMd(md) {
    loadMarkdownInto(this._editor, md);
    if (!this._isUndoRedo) { this._snapshots = [md || ""]; this._head = 0; }
  }

  _fireChange() {
    this.dispatchEvent(new CustomEvent("change", { detail: { markdown: this._getMd() }, bubbles: true }));
  }

  // ── Snapshots ───────────────────────────────────

  _pushSnapshot(md) {
    if (this._isUndoRedo || md === this._snapshots[this._head]) return;
    this._snapshots.length = this._head + 1;
    this._snapshots.push(md);
    this._head = this._snapshots.length - 1;
    if (this._snapshots.length > 500) { this._snapshots.shift(); this._head--; }
  }

  _scheduleSnapshot() {
    clearTimeout(this._snapshotTimer);
    this._snapshotTimer = setTimeout(() => this._pushSnapshot(this._getMd()), 1000);
  }

  _undoSnap() {
    const c = this._getMd(); if (c !== this._snapshots[this._head]) this._pushSnapshot(c);
    if (this._head <= 0) return false;
    this._head--; this._isUndoRedo = true; this._loadMd(this._snapshots[this._head]); this._isUndoRedo = false; this._fireChange(); return true;
  }

  _redoSnap() {
    if (this._head >= this._snapshots.length - 1) return false;
    this._head++; this._isUndoRedo = true; this._loadMd(this._snapshots[this._head]); this._isUndoRedo = false; this._fireChange(); return true;
  }

  // ── Keydown ─────────────────────────────────────

  _onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); this._undoSnap(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" && e.shiftKey || e.key === "y")) { e.preventDefault(); this._redoSnap(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); this.dispatchEvent(new CustomEvent("save", { detail: { markdown: this._getMd() } })); return; }
    if (e.key === "Enter" && !e.shiftKey) { this._onEnter(e); return; }
    if (e.key === "Tab") { this._onTab(e); return; }
  }

  _onEnter(e) {
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    if (!sel?.rangeCount) return;
    let block = sel.anchorNode;
    while (block && block.parentNode !== this._editor) block = block.parentNode;
    if (!block) return;

    const text = block.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");

    // Empty list → clear
    if (isEmptyListItem(text, block)) {
      e.preventDefault();
      const div = document.createElement("div"); div.innerHTML = "<br>";
      block.replaceWith(div); this._placeCursorIn(div); this._fireChange();
      setTimeout(() => this._pushSnapshot(this._getMd()), 50);
      return;
    }

    // Code block open
    if (text.trim().startsWith("```") && !block.closest("pre")) {
      e.preventDefault();
      const lang = text.trim().slice(3).trim();
      const pre = document.createElement("pre"); pre.className = "tm-code-block";
      if (lang) pre.dataset.lang = lang;
      const code = document.createElement("code"); code.textContent = "\n"; pre.appendChild(code);
      pre.contentEditable = "true"; block.replaceWith(pre);
      this._placeCursorAt(code.firstChild || code.appendChild(document.createTextNode("")), 0);
      this._fireChange(); return;
    }

    // Markdown → rich text
    const richEl = mdLineToEl(text);
    if (richEl) {
      e.preventDefault();
      if (block.style?.paddingLeft) richEl.style.paddingLeft = block.style.paddingLeft;
      const prefix = getListPrefix(text, block);
      block.replaceWith(richEl);

      if (prefix) {
        const next = mdLineToEl(prefix.trimEnd());
        if (next) {
          if (richEl.style?.paddingLeft) next.style.paddingLeft = richEl.style.paddingLeft;
          richEl.after(next); this._ensureFocus(next);
        } else { const d = document.createElement("div"); d.innerHTML = "<br>"; richEl.after(d); this._placeCursorIn(d); }
      } else { const d = document.createElement("div"); d.innerHTML = "<br>"; richEl.after(d); this._placeCursorIn(d); }

      this._fireChange(); setTimeout(() => this._pushSnapshot(this._getMd()), 50); return;
    }

    // Rich text list continuation
    const prefix = getListPrefix(text, block);
    if (prefix) {
      e.preventDefault();
      const next = mdLineToEl(prefix.trimEnd());
      if (next) {
        if (block.style?.paddingLeft) next.style.paddingLeft = block.style.paddingLeft;
        block.after(next); this._ensureFocus(next);
      } else { const d = document.createElement("div"); d.innerHTML = "<br>"; block.after(d); this._placeCursorIn(d); }
      this._fireChange(); setTimeout(() => this._pushSnapshot(this._getMd()), 50); return;
    }

    setTimeout(() => { this._fireChange(); }, 0);
  }

  _onTab(e) {
    e.preventDefault();
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    if (!sel?.rangeCount) return;
    let block = sel.anchorNode;
    while (block && block.parentNode !== this._editor) block = block.parentNode;
    if (!block) return;

    const md = nodeToMd(block).replace(/\u00A0/g, " ");
    const newMd = e.shiftKey ? (md.startsWith("  ") ? md.slice(2) : md) : ("  " + md);
    const level = Math.floor(((newMd.match(/^(\s*)/) || ["", ""])[1].length) / 2);

    const newEl = mdLineToEl(newMd);
    if (newEl) {
      if (level > 0) newEl.style.paddingLeft = (level * 0.75) + "rem";
      block.replaceWith(newEl); this._ensureFocus(newEl);
    } else {
      const div = document.createElement("div"); div.textContent = newMd;
      block.replaceWith(div); this._placeCursorIn(div);
    }
    this._fireChange(); this._pushSnapshot(this._getMd());
  }

  // ── Cursor ──────────────────────────────────────

  _ensureFocus(el) {
    const target = el.querySelector(".tm-todo-text") || el;
    target.querySelectorAll("br").forEach(br => br.remove());
    let tn = null;
    for (const c of target.childNodes) { if (c.nodeType === Node.TEXT_NODE) { tn = c; break; } }
    if (!tn) { tn = document.createTextNode("\u200B"); target.appendChild(tn); }
    else if (!tn.textContent) tn.textContent = "\u200B";
    this._placeCursorAt(tn, tn.textContent.length);
  }

  _placeCursorIn(el) {
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null, n; while ((n = walker.nextNode())) last = n;
    if (last) { range.setStart(last, last.textContent.length); range.collapse(true); }
    else { const tn = document.createTextNode(""); el.appendChild(tn); range.setStart(tn, 0); range.collapse(true); }
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }

  _placeCursorAt(tn, off) {
    const range = document.createRange();
    range.setStart(tn, Math.min(off, tn.length || 0)); range.collapse(true);
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }

  _selToMd() {
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return null;
    const frag = sel.getRangeAt(0).cloneContents();
    const lines = [];
    for (const n of frag.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { const t = n.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, ""); if (t) lines.push(t); }
      else if (n.nodeType === Node.ELEMENT_NODE) lines.push(nodeToMd(n));
    }
    return lines.join("\n");
  }
}

customElements.define("tala-editor", TalaEditor);
export { TalaEditor };
