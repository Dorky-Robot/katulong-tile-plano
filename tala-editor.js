/**
 * <tala-editor> — WYSIWYG markdown editor web component.
 *
 * Uses tala-md.js for all markdown ↔ HTML conversion.
 * The editor is a thin wrapper: contenteditable + event handling + undo.
 *
 * Attributes: value, readonly, theme ("light"|"dark")
 * Events: change, save, file-drop
 *
 * Usage:
 *   <tala-editor value="# Hello" theme="dark"></tala-editor>
 */

import {
  mdLineToHtml, nodeToMd, inlineMd, editorToMarkdown, loadMarkdownInto,
  normalizeMd, getListPrefix, isEmptyListItem, fmtInline, esc,
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
      <style>${TalaEditor.styles}</style>
      <div class="te-wrapper" part="wrapper">
        <div class="te-editor" part="editor"
             contenteditable="true" spellcheck="true"
             role="textbox" aria-multiline="true"></div>
      </div>
    `;
    this._wrapper = this.shadowRoot.querySelector(".te-wrapper");
    this._editor = this.shadowRoot.querySelector(".te-editor");
  }

  connectedCallback() {
    const ed = this._editor;
    ed.addEventListener("input", () => { this._fireChange(); this._scheduleSnapshot(); });
    ed.addEventListener("keydown", (e) => this._handleKeydown(e));
    ed.addEventListener("paste", (e) => this._handlePaste(e));
    ed.addEventListener("copy", (e) => this._handleCopy(e));
    ed.addEventListener("cut", (e) => this._handleCut(e));
    ed.addEventListener("change", (e) => {
      if (e.target.classList?.contains("te-cb")) {
        const todo = e.target.closest(".te-todo");
        if (todo) todo.classList.toggle("te-todo-done", e.target.checked);
        this._fireChange();
        this._pushSnapshot(this._getMd());
      }
    });
    ed.addEventListener("click", (e) => {
      const pre = e.target.closest("pre.te-code-block");
      if (pre && pre.contentEditable === "false") { pre.contentEditable = "true"; this._placeCursorIn(pre.querySelector("code") || pre); }
      if (e.target === ed) {
        const last = ed.lastElementChild;
        if (!last || last.contentEditable === "false") { const d = document.createElement("div"); d.innerHTML = "<br>"; ed.appendChild(d); this._placeCursorIn(d); this._fireChange(); }
      }
    });
    ed.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; ed.classList.add("te-drop-active"); } });
    ed.addEventListener("dragleave", (e) => { if (e.target === ed || !ed.contains(e.relatedTarget)) ed.classList.remove("te-drop-active"); });
    ed.addEventListener("drop", (e) => { ed.classList.remove("te-drop-active"); const f = e.dataTransfer?.files; if (f?.length) { e.preventDefault(); this.dispatchEvent(new CustomEvent("file-drop", { detail: { files: [...f] } })); } });
    if (this.hasAttribute("value")) this._loadMd(this.getAttribute("value") || "");
    if (this.hasAttribute("theme")) this._wrapper.dataset.theme = this.getAttribute("theme");
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "value" && newVal !== oldVal && !this._isUndoRedo) this._loadMd(newVal || "");
    if (name === "readonly") this._editor.contentEditable = newVal !== null ? "false" : "true";
    if (name === "theme") this._wrapper.dataset.theme = newVal || "light";
  }

  // ── Public API ─────────────────────────────────────────────

  get value() { return this._getMd(); }
  set value(md) { this._loadMd(md || ""); }
  get markdown() { return this._getMd(); }
  focus() { this._editor.focus(); }
  blur() { this._editor.blur(); }
  undo() { return this._undoSnapshot(); }
  redo() { return this._redoSnapshot(); }
  insertText(text) { this._editor.focus(); document.execCommand("insertText", false, text); this._fireChange(); }

  // ── Internal: markdown ─────────────────────────────────────

  _getMd() { return editorToMarkdown(this._editor); }

  _loadMd(md) {
    loadMarkdownInto(this._editor, md);
    if (!this._isUndoRedo) { this._snapshots = [md || ""]; this._head = 0; }
  }

  _mdLineToEl(md) {
    const parsed = mdLineToHtml(md);
    if (!parsed) return null;
    const el = document.createElement(parsed.tag);
    if (parsed.cls) el.className = parsed.cls;
    if (parsed.html) el.innerHTML = parsed.html;
    if (parsed.dataset) for (const [k, v] of Object.entries(parsed.dataset)) el.dataset[k] = v;
    return el;
  }

  // ── Snapshot undo/redo ─────────────────────────────────────

  _pushSnapshot(md) { if (this._isUndoRedo || md === this._snapshots[this._head]) return; this._snapshots.length = this._head + 1; this._snapshots.push(md); this._head++; if (this._snapshots.length > 500) { this._snapshots.shift(); this._head--; } }
  _scheduleSnapshot() { clearTimeout(this._snapshotTimer); this._snapshotTimer = setTimeout(() => this._pushSnapshot(this._getMd()), 1000); }
  _undoSnapshot() { const c = this._getMd(); if (c !== this._snapshots[this._head]) this._pushSnapshot(c); if (this._head <= 0) return false; this._head--; this._isUndoRedo = true; this._loadMd(this._snapshots[this._head]); this._isUndoRedo = false; this._fireChange(); return true; }
  _redoSnapshot() { if (this._head >= this._snapshots.length - 1) return false; this._head++; this._isUndoRedo = true; this._loadMd(this._snapshots[this._head]); this._isUndoRedo = false; this._fireChange(); return true; }

  // ── Key handling ───────────────────────────────────────────

  _handleKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); this._undoSnapshot(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" && e.shiftKey || e.key === "y")) { e.preventDefault(); this._redoSnapshot(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); this.dispatchEvent(new CustomEvent("save", { detail: { markdown: this._getMd() } })); return; }
    if (e.key === "Enter" && !e.shiftKey) { this._handleEnter(e); return; }
    if (e.key === "Tab") { this._handleTab(e); return; }
  }

  _handleEnter(e) {
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    if (!sel?.rangeCount) return;
    let block = sel.anchorNode;
    while (block && block.parentNode !== this._editor) block = block.parentNode;
    if (!block || block === this._editor) return;

    const text = block.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");

    // Empty list → clear
    if (isEmptyListItem(text, block)) {
      e.preventDefault();
      const d = document.createElement("div"); d.innerHTML = "<br>";
      block.replaceWith(d); this._placeCursorIn(d); this._fireChange();
      setTimeout(() => this._pushSnapshot(this._getMd()), 50);
      return;
    }

    // Code block open
    if (text.trim().startsWith("```") && !block.closest("pre")) {
      e.preventDefault();
      const lang = text.trim().slice(3).trim();
      const pre = document.createElement("pre"); pre.className = "te-code-block";
      if (lang) pre.dataset.lang = lang;
      const code = document.createElement("code"); code.textContent = "\n";
      pre.appendChild(code); pre.contentEditable = "true";
      block.replaceWith(pre);
      this._placeCursorAt(code.firstChild || code.appendChild(document.createTextNode("")), 0);
      this._fireChange();
      return;
    }

    // Markdown conversion
    const richEl = this._mdLineToEl(text);
    if (richEl) {
      e.preventDefault();
      if (block.style?.paddingLeft) richEl.style.paddingLeft = block.style.paddingLeft;
      const prefix = getListPrefix(text, block);
      block.replaceWith(richEl);

      if (prefix) {
        const next = this._mdLineToEl(prefix.trimEnd());
        if (next) {
          if (richEl.style?.paddingLeft) next.style.paddingLeft = richEl.style.paddingLeft;
          richEl.after(next);
          this._ensureFocus(next);
        } else { const d = document.createElement("div"); d.innerHTML = "<br>"; richEl.after(d); this._placeCursorIn(d); }
      } else { const d = document.createElement("div"); d.innerHTML = "<br>"; richEl.after(d); this._placeCursorIn(d); }
      this._fireChange();
      setTimeout(() => this._pushSnapshot(this._getMd()), 50);
      return;
    }

    // Rich text list continuation
    const prefix = getListPrefix(text, block);
    if (prefix) {
      e.preventDefault();
      const next = this._mdLineToEl(prefix.trimEnd());
      if (next) {
        if (block.style?.paddingLeft) next.style.paddingLeft = block.style.paddingLeft;
        block.after(next); this._ensureFocus(next);
      } else { const d = document.createElement("div"); d.innerHTML = "<br>"; block.after(d); this._placeCursorIn(d); }
      this._fireChange();
      setTimeout(() => this._pushSnapshot(this._getMd()), 50);
      return;
    }

    setTimeout(() => { this._fireChange(); }, 0);
  }

  _handleTab(e) {
    e.preventDefault();
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    if (!sel?.rangeCount) return;
    let block = sel.anchorNode;
    while (block && block.parentNode !== this._editor) block = block.parentNode;
    if (!block) return;

    const md = nodeToMd(block).replace(/\u00A0/g, " ");
    const newMd = e.shiftKey ? (md.startsWith("  ") ? md.slice(2) : md) : ("  " + md);
    const level = Math.floor(((newMd.match(/^(\s*)/) || ["", ""])[1].length) / 2);
    const newEl = this._mdLineToEl(newMd);
    if (newEl) {
      if (level > 0) newEl.style.paddingLeft = (level * 0.75) + "rem";
      block.replaceWith(newEl); this._ensureFocus(newEl);
    } else {
      const d = document.createElement("div"); d.textContent = newMd;
      block.replaceWith(d); this._placeCursorIn(d);
    }
    this._fireChange(); this._pushSnapshot(this._getMd());
  }

  _handlePaste(e) {
    const f = e.clipboardData?.files;
    if (f?.length) { e.preventDefault(); this.dispatchEvent(new CustomEvent("file-drop", { detail: { files: [...f] } })); return; }
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
  }

  _handleCopy(e) {
    const md = this._selToMd();
    if (md !== null) { e.preventDefault(); e.clipboardData.setData("text/plain", md); }
  }

  _handleCut(e) {
    const md = this._selToMd();
    if (md !== null) { e.preventDefault(); e.clipboardData.setData("text/plain", md); document.execCommand("delete"); }
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

  // ── Cursor helpers ─────────────────────────────────────────

  _ensureFocus(el) {
    const target = el.querySelector(".te-todo-text") || el;
    target.querySelectorAll("br").forEach(br => br.remove());
    let tn = null;
    for (const c of target.childNodes) if (c.nodeType === Node.TEXT_NODE) { tn = c; break; }
    if (!tn) { tn = document.createTextNode("\u200B"); target.appendChild(tn); }
    else if (!tn.textContent) tn.textContent = "\u200B";
    const r = document.createRange(); r.setStart(tn, tn.textContent.length); r.collapse(true);
    const s = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }

  _placeCursorIn(el) {
    const r = document.createRange();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null, n; while ((n = w.nextNode())) last = n;
    if (last) { r.setStart(last, last.textContent.length); r.collapse(true); }
    else { const tn = document.createTextNode(""); el.appendChild(tn); r.setStart(tn, 0); r.collapse(true); }
    const s = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }

  _placeCursorAt(tn, offset) {
    const r = document.createRange(); r.setStart(tn, Math.min(offset, tn.length || 0)); r.collapse(true);
    const s = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }

  // ── Events ─────────────────────────────────────────────────

  _fireChange() { this.dispatchEvent(new CustomEvent("change", { detail: { markdown: this._getMd() }, bubbles: true })); }

  // ── Styles ─────────────────────────────────────────────────

  static get styles() {
    return `
      :host { display: block; height: 100%; }
      .te-wrapper { display: flex; height: 100%; }
      .te-wrapper[data-theme="dark"] { --te-bg:#1a1a1a; --te-fg:#e0e0e0; --te-accent:#8b7355; --te-border:rgba(255,255,255,0.1); --te-muted:rgba(255,255,255,0.4); --te-code-bg:rgba(255,255,255,0.06); }
      .te-wrapper:not([data-theme="dark"]) { --te-bg:#faf9f7; --te-fg:#2c2c2c; --te-accent:#8b7355; --te-border:#e0ded8; --te-muted:#999; --te-code-bg:rgba(139,115,85,0.08); }
      .te-editor { flex:1; outline:none; padding:12px 16px; padding-bottom:40vh; font-family:Georgia,"Times New Roman",serif; font-size:1rem; line-height:1.7; color:var(--te-fg); background:var(--te-bg); word-wrap:break-word; overflow-wrap:break-word; overflow-y:auto; }
      .te-editor:empty::before { content:"Start writing..."; color:var(--te-muted); font-style:italic; }
      .te-editor h1 { font-size:1.5em; font-weight:700; margin:0.3em 0 0.1em; }
      .te-editor h2 { font-size:1.25em; font-weight:700; margin:0.2em 0 0.1em; }
      .te-editor h3 { font-size:1.1em; font-weight:600; margin:0.15em 0 0.05em; }
      .te-editor h4 { font-size:1em; font-weight:600; }
      .te-editor h5 { font-size:0.9em; font-weight:600; }
      .te-editor h6 { font-size:0.85em; font-weight:600; color:var(--te-muted); }
      .te-editor hr { border:none; border-top:1px solid var(--te-border); margin:0.5em 0; }
      .te-editor blockquote { border-left:3px solid var(--te-accent); padding-left:0.75em; color:var(--te-muted); font-style:italic; margin:0.2em 0; }
      .te-editor code { background:var(--te-code-bg); padding:1px 4px; border-radius:3px; font-family:"SF Mono","Consolas",monospace; font-size:0.85em; }
      .te-editor s { color:var(--te-muted); }
      .te-editor pre.te-code-block { background:var(--te-code-bg); border:1px solid var(--te-border); border-radius:4px; padding:0.75em 1em; margin:0.3em 0; overflow-x:auto; }
      .te-editor pre.te-code-block code { background:none; padding:0; display:block; white-space:pre; }
      .te-todo { display:flex; align-items:baseline; gap:0.3em; }
      .te-todo-done { color:var(--te-muted); text-decoration:line-through; }
      .te-cb { cursor:pointer; accent-color:var(--te-accent); }
      .te-li-ul::before { content:"\\2022"; color:var(--te-accent); margin-right:0.4em; }
      .te-li-ol::before { content:attr(data-num) "."; color:var(--te-fg); margin-right:0.4em; }
      .te-link { color:var(--te-accent); text-decoration:underline; cursor:pointer; }
      .te-img { max-width:100%; height:auto; border-radius:4px; margin:0.3em 0; }
      .te-drop-active { outline:2px dashed var(--te-accent); outline-offset:-4px; border-radius:4px; }
    `;
  }
}

customElements.define("tala-editor", TalaEditor);
export { TalaEditor };
