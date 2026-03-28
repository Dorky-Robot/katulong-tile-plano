/**
 * <tala-editor> — WYSIWYG markdown editor web component.
 *
 * A self-contained rich text editor backed by markdown.
 * Type markdown, press Enter → converts to rich text.
 * Edit rich text directly after conversion.
 *
 * Attributes:
 *   value     — markdown content (get/set)
 *   readonly  — disables editing
 *   theme     — "light" (default) or "dark"
 *
 * Events:
 *   change    — fired when content changes (detail: { markdown })
 *   save      — fired on Cmd+S (detail: { markdown })
 *
 * Usage:
 *   <tala-editor value="# Hello\n\n- [ ] task" theme="dark"></tala-editor>
 *
 *   const editor = document.querySelector('tala-editor');
 *   editor.value = "# New content";
 *   editor.addEventListener('change', e => console.log(e.detail.markdown));
 */

class TalaEditor extends HTMLElement {
  static get observedAttributes() {
    return ["value", "readonly", "theme"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    // State
    this._snapshots = [""];
    this._head = 0;
    this._isUndoRedo = false;
    this._snapshotTimer = null;

    // Build shadow DOM
    this.shadowRoot.innerHTML = `
      <style>${TalaEditor.styles}</style>
      <div class="te-wrapper" part="wrapper">
        <div class="te-margin" part="margin"></div>
        <div class="te-editor" part="editor"
             contenteditable="true"
             spellcheck="true"
             role="textbox"
             aria-multiline="true"></div>
      </div>
    `;

    this._wrapper = this.shadowRoot.querySelector(".te-wrapper");
    this._marginEl = this.shadowRoot.querySelector(".te-margin");
    this._editor = this.shadowRoot.querySelector(".te-editor");
  }

  connectedCallback() {
    const ed = this._editor;

    // Input → sync + debounced snapshot
    ed.addEventListener("input", () => {
      this._fireChange();
      this._scheduleSnapshot();
      this._scheduleMarginUpdate();
    });

    // Keydown: Enter (markdown convert), Tab (indent), Undo/Redo
    ed.addEventListener("keydown", (e) => this._handleKeydown(e));

    // Paste as plain text / paste files
    ed.addEventListener("paste", (e) => {
      const files = e.clipboardData?.files;
      if (files?.length > 0) {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent("file-drop", { detail: { files: [...files] } }));
        return;
      }
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });

    // Copy as markdown
    ed.addEventListener("copy", (e) => {
      const md = this._selectionToMarkdown();
      if (md !== null) {
        e.preventDefault();
        e.clipboardData.setData("text/plain", md);
      }
    });

    ed.addEventListener("cut", (e) => {
      const md = this._selectionToMarkdown();
      if (md !== null) {
        e.preventDefault();
        e.clipboardData.setData("text/plain", md);
        document.execCommand("delete");
      }
    });

    // Checkbox toggle
    ed.addEventListener("change", (e) => {
      if (e.target.classList?.contains("te-cb")) {
        const todo = e.target.closest(".te-todo");
        if (todo) todo.classList.toggle("te-todo-done", e.target.checked);
        this._fireChange();
        this._pushSnapshot(this._editorToMarkdown());
      }
    });

    // Click on non-editable code block → make editable
    ed.addEventListener("click", (e) => {
      const pre = e.target.closest("pre.te-code-block");
      if (pre && pre.contentEditable === "false") {
        pre.contentEditable = "true";
        this._placeCursorIn(pre.querySelector("code") || pre);
      }
      // Click in empty area below content
      if (e.target === ed) {
        const lastChild = ed.lastElementChild;
        if (!lastChild || lastChild.contentEditable === "false") {
          const div = document.createElement("div");
          div.innerHTML = "<br>";
          ed.appendChild(div);
          this._placeCursorIn(div);
          this._fireChange();
        }
      }
    });

    // Drag and drop files
    ed.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        ed.classList.add("te-drop-active");
      }
    });
    ed.addEventListener("dragleave", (e) => {
      if (e.target === ed || !ed.contains(e.relatedTarget)) ed.classList.remove("te-drop-active");
    });
    ed.addEventListener("drop", (e) => {
      ed.classList.remove("te-drop-active");
      const files = e.dataTransfer?.files;
      if (files?.length > 0) {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent("file-drop", { detail: { files: [...files] } }));
      }
    });

    // Apply initial value
    if (this.hasAttribute("value")) {
      this._loadMarkdown(this.getAttribute("value") || "");
    }
    if (this.hasAttribute("theme")) {
      this._wrapper.dataset.theme = this.getAttribute("theme");
    }
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "value" && newVal !== oldVal && !this._isUndoRedo) {
      this._loadMarkdown(newVal || "");
    }
    if (name === "readonly") {
      this._editor.contentEditable = newVal !== null ? "false" : "true";
    }
    if (name === "theme") {
      this._wrapper.dataset.theme = newVal || "light";
    }
  }

  // ── Public API ─────────────────────────────────────────────

  get value() { return this._editorToMarkdown(); }
  set value(md) { this._loadMarkdown(md || ""); }

  get markdown() { return this._editorToMarkdown(); }

  focus() { this._editor.focus(); }
  blur() { this._editor.blur(); }

  undo() { return this._undoSnapshot(); }
  redo() { return this._redoSnapshot(); }

  insertText(text) {
    this._editor.focus();
    document.execCommand("insertText", false, text);
    this._fireChange();
  }

  // ── Markdown → HTML ────────────────────────────────────────

  static _esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  static _fmtInline(text) {
    let h = TalaEditor._esc(text);
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="te-img">');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="te-link" contenteditable="false">$1</a>');
    h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    h = h.replace(/__(.+?)__/g, "<b>$1</b>");
    h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
    h = h.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");
    h = h.replace(/~~(.+?)~~/g, "<s>$1</s>");
    h = h.replace(/`(.+?)`/g, "<code>$1</code>");
    return h;
  }

  static _normMd(t) {
    return t.replace(/^(\s*)-\s*\[\s*\]\s*/, "$1- [ ] ")
            .replace(/^(\s*)-\s*\[x\]\s*/i, "$1- [x] ");
  }

  _mdLineToEl(md) {
    const t = md.trim();
    if (!t) return null;
    const E = TalaEditor;

    let m;
    // Heading h1-h6
    m = t.match(/^(#{1,6})\s+(.+)$/);
    if (m) { const el = document.createElement(`h${m[1].length}`); el.innerHTML = E._fmtInline(m[2]); return el; }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,}|—{1,}|-\s-\s-[\s-]*)$/.test(t)) return document.createElement("hr");

    // Checkbox
    m = E._normMd(t).match(/^-\s*\[([ xX]?)\]\s*(.*)$/);
    if (m) {
      const checked = m[1].toLowerCase() === "x";
      const el = document.createElement("div");
      el.className = "te-todo" + (checked ? " te-todo-done" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "te-cb"; cb.checked = checked; cb.contentEditable = "false";
      el.appendChild(cb);
      el.appendChild(document.createTextNode(" "));
      const span = document.createElement("span");
      span.className = "te-todo-text";
      span.innerHTML = E._fmtInline(m[2]);
      el.appendChild(span);
      return el;
    }

    // Bullet
    m = t.match(/^[-*+]\s*(.*)$/);
    if (m && (t.match(/^[-*+]\s/) || t.match(/^[-*+]$/))) {
      const el = document.createElement("div");
      el.className = "te-li te-li-ul";
      el.innerHTML = E._fmtInline(m[1]) || "<br>";
      return el;
    }

    // OL
    m = t.match(/^(\d+)\.\s*(.*)$/);
    if (m && (t.match(/^\d+\.\s/) || t.match(/^\d+\.$/))) {
      const el = document.createElement("div");
      el.className = "te-li te-li-ol";
      el.dataset.num = m[1];
      el.innerHTML = E._fmtInline(m[2]) || "<br>";
      return el;
    }

    // Blockquote
    m = t.match(/^>\s*(.*)$/);
    if (m && t.startsWith(">")) {
      const el = document.createElement("blockquote");
      el.innerHTML = E._fmtInline(m[1]) || "<br>";
      return el;
    }

    // Inline formatting only
    const formatted = E._fmtInline(t);
    if (formatted !== E._esc(t)) {
      const el = document.createElement("div");
      el.innerHTML = formatted;
      return el;
    }

    return null;
  }

  // ── HTML → Markdown ────────────────────────────────────────

  _editorToMarkdown() {
    const lines = [];
    for (const node of this._editor.childNodes) lines.push(this._nodeToMd(node));
    return lines.join("\n");
  }

  _nodeToMd(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    // Indent from paddingLeft
    let indent = "";
    const pl = node.style?.paddingLeft || "";
    if (pl) {
      const rm = pl.match(/([\d.]+)rem/);
      if (rm) indent = "  ".repeat(Math.round(parseFloat(rm[1]) / 0.75));
    }

    const tag = node.tagName;
    if (tag === "BR") return "";
    if (tag === "HR") return indent + "---";
    if (tag === "PRE") {
      const lang = node.dataset?.lang || "";
      const code = node.querySelector("code")?.textContent || node.textContent;
      return "```" + lang + "\n" + code + "\n```";
    }
    if (tag === "H1") return indent + "# " + this._inlineMd(node);
    if (tag === "H2") return indent + "## " + this._inlineMd(node);
    if (tag === "H3") return indent + "### " + this._inlineMd(node);
    if (tag === "H4") return indent + "#### " + this._inlineMd(node);
    if (tag === "H5") return indent + "##### " + this._inlineMd(node);
    if (tag === "H6") return indent + "###### " + this._inlineMd(node);
    if (tag === "BLOCKQUOTE") return indent + "> " + this._inlineMd(node);

    if (node.classList?.contains("te-todo")) {
      const checked = node.querySelector(".te-cb")?.checked;
      const textEl = node.querySelector(".te-todo-text");
      const text = textEl ? this._inlineMd(textEl) : "";
      return `${indent}- [${checked ? "x" : " "}] ${text}`;
    }
    if (node.classList?.contains("te-li-ol")) {
      return `${indent}${node.dataset.num || "1"}. ${this._inlineMd(node)}`;
    }
    if (node.classList?.contains("te-li-ul")) {
      return `${indent}- ${this._inlineMd(node)}`;
    }

    if (tag === "DIV" || tag === "P") {
      if (node.childNodes.length === 1 && node.firstChild.nodeName === "BR") return indent || "";
      return indent + this._inlineMd(node);
    }
    return indent + this._inlineMd(node);
  }

  _inlineMd(node) {
    let result = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { result += child.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, ""); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      const inner = this._inlineMd(child);
      if (tag === "B" || tag === "STRONG") { result += `**${inner}**`; continue; }
      if (tag === "I" || tag === "EM") { result += `*${inner}*`; continue; }
      if (tag === "S" || tag === "DEL") { result += `~~${inner}~~`; continue; }
      if (tag === "CODE" && !child.closest("pre")) { result += "`" + inner + "`"; continue; }
      if (tag === "A") { result += `[${inner}](${child.getAttribute("href") || ""})`; continue; }
      if (tag === "IMG") { result += `![${child.getAttribute("alt") || ""}](${child.getAttribute("src") || ""})`; continue; }
      if (tag === "BR") continue;
      if (tag === "INPUT" && child.classList?.contains("te-cb")) continue;
      result += inner;
    }
    return result;
  }

  // ── Load markdown ──────────────────────────────────────────

  _loadMarkdown(md) {
    const ed = this._editor;
    ed.innerHTML = "";
    if (!md) { ed.innerHTML = "<div><br></div>"; return; }

    const lines = md.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) { codeLines.push(lines[i]); i++; }
        i++;
        const pre = document.createElement("pre");
        pre.className = "te-code-block";
        if (lang) pre.dataset.lang = lang;
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.appendChild(code);
        pre.contentEditable = "false";
        ed.appendChild(pre);
        continue;
      }

      const indentMatch = line.match(/^(\s+)/);
      const level = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
      const el = this._mdLineToEl(line);
      if (el) {
        if (level > 0) el.style.paddingLeft = (level * 0.75) + "rem";
        ed.appendChild(el);
      } else {
        const div = document.createElement("div");
        if (line) div.textContent = line;
        else div.innerHTML = "<br>";
        ed.appendChild(div);
      }
      i++;
    }

    if (!this._isUndoRedo) { this._snapshots = [md]; this._head = 0; }
    this._scheduleMarginUpdate();
  }

  // ── Snapshot undo/redo ─────────────────────────────────────

  _pushSnapshot(md) {
    if (this._isUndoRedo || md === this._snapshots[this._head]) return;
    this._snapshots.length = this._head + 1;
    this._snapshots.push(md);
    this._head = this._snapshots.length - 1;
    if (this._snapshots.length > 500) { this._snapshots.shift(); this._head--; }
  }

  _scheduleSnapshot() {
    clearTimeout(this._snapshotTimer);
    this._snapshotTimer = setTimeout(() => this._pushSnapshot(this._editorToMarkdown()), 1000);
  }

  _undoSnapshot() {
    const current = this._editorToMarkdown();
    if (current !== this._snapshots[this._head]) this._pushSnapshot(current);
    if (this._head <= 0) return false;
    this._head--;
    this._isUndoRedo = true;
    this._loadMarkdown(this._snapshots[this._head]);
    this._isUndoRedo = false;
    this._fireChange();
    return true;
  }

  _redoSnapshot() {
    if (this._head >= this._snapshots.length - 1) return false;
    this._head++;
    this._isUndoRedo = true;
    this._loadMarkdown(this._snapshots[this._head]);
    this._isUndoRedo = false;
    this._fireChange();
    return true;
  }

  // ── Key handling ───────────────────────────────────────────

  _handleKeydown(e) {
    // Undo/redo
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault(); this._undoSnapshot(); return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" && e.shiftKey || e.key === "y")) {
      e.preventDefault(); this._redoSnapshot(); return;
    }

    // Save
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent("save", { detail: { markdown: this._editorToMarkdown() } }));
      return;
    }

    // Enter
    if (e.key === "Enter" && !e.shiftKey) {
      this._handleEnter(e);
      return;
    }

    // Tab
    if (e.key === "Tab") {
      e.preventDefault();
      const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
      if (!sel?.rangeCount) return;
      let block = sel.anchorNode;
      while (block && block.parentNode !== this._editor) block = block.parentNode;
      if (!block) return;

      const md = this._nodeToMd(block).replace(/\u00A0/g, " ");
      let newMd = e.shiftKey ? (md.startsWith("  ") ? md.slice(2) : md) : ("  " + md);
      const newIndent = (newMd.match(/^(\s*)/) || ["", ""])[1];
      const level = Math.floor(newIndent.length / 2);

      const newEl = this._mdLineToEl(newMd);
      if (newEl) {
        if (level > 0) newEl.style.paddingLeft = (level * 0.75) + "rem";
        block.replaceWith(newEl);
        this._ensureEditableAndFocus(newEl);
      } else {
        const div = document.createElement("div");
        div.textContent = newMd;
        block.replaceWith(div);
        this._placeCursorIn(div);
      }
      this._fireChange();
      this._pushSnapshot(this._editorToMarkdown());
    }
  }

  _handleEnter(e) {
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    if (!sel?.rangeCount) return;

    let block = sel.anchorNode;
    while (block && block.parentNode !== this._editor) block = block.parentNode;
    if (!block || block === this._editor) return;

    const fullText = block.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
    const E = TalaEditor;

    // Empty list item → clear
    const cleaned = E._normMd(fullText).replace(/\u00A0/g, " ").replace(/\u200B/g, "").trim();
    const isEmptyList = /^-\s*\[[ xX]?\]\s*$/.test(cleaned) || /^[-*+]\s*$/.test(cleaned) || /^\d+\.\s*$/.test(cleaned);
    // Check rich list elements too
    const isEmptyRich = (block.classList?.contains("te-li-ol") || block.classList?.contains("te-li-ul") || block.classList?.contains("te-todo"))
      && !block.textContent.replace(/\u200B/g, "").replace(/\u00A0/g, " ").trim();

    if (isEmptyList || isEmptyRich) {
      e.preventDefault();
      const emptyDiv = document.createElement("div");
      emptyDiv.innerHTML = "<br>";
      block.replaceWith(emptyDiv);
      this._placeCursorIn(emptyDiv);
      this._fireChange();
      setTimeout(() => this._pushSnapshot(this._editorToMarkdown()), 50);
      return;
    }

    // Code block
    if (fullText.trim().startsWith("```") && !block.closest("pre")) {
      e.preventDefault();
      const lang = fullText.trim().slice(3).trim();
      const pre = document.createElement("pre");
      pre.className = "te-code-block";
      if (lang) pre.dataset.lang = lang;
      const code = document.createElement("code");
      code.textContent = "\n";
      pre.appendChild(code);
      pre.contentEditable = "true";
      block.replaceWith(pre);
      this._placeCursorAt(code.firstChild || code.appendChild(document.createTextNode("")), 0);
      this._fireChange();
      return;
    }

    // Try markdown conversion
    const richEl = this._mdLineToEl(fullText);
    if (richEl) {
      e.preventDefault();
      if (block.style?.paddingLeft) richEl.style.paddingLeft = block.style.paddingLeft;

      let prefix = this._getListPrefix(fullText, block);
      block.replaceWith(richEl);

      // Create continuation
      if (prefix) {
        const nextEl = this._mdLineToEl(prefix.trimEnd());
        if (nextEl) {
          if (richEl.style?.paddingLeft) nextEl.style.paddingLeft = richEl.style.paddingLeft;
          richEl.after(nextEl);
          this._ensureEditableAndFocus(nextEl);
        } else {
          const newDiv = document.createElement("div");
          newDiv.innerHTML = "<br>";
          richEl.after(newDiv);
          this._placeCursorIn(newDiv);
        }
      } else {
        const newDiv = document.createElement("div");
        newDiv.innerHTML = "<br>";
        richEl.after(newDiv);
        this._placeCursorIn(newDiv);
      }

      this._fireChange();
      setTimeout(() => this._pushSnapshot(this._editorToMarkdown()), 50);
      return;
    }

    // Rich text list continuation
    const prefix = this._getListPrefix(fullText, block);
    if (prefix) {
      e.preventDefault();
      const nextEl = this._mdLineToEl(prefix.trimEnd());
      if (nextEl) {
        if (block.style?.paddingLeft) nextEl.style.paddingLeft = block.style.paddingLeft;
        block.after(nextEl);
        this._ensureEditableAndFocus(nextEl);
      } else {
        const newDiv = document.createElement("div");
        newDiv.innerHTML = "<br>";
        block.after(newDiv);
        this._placeCursorIn(newDiv);
      }
      this._fireChange();
      setTimeout(() => this._pushSnapshot(this._editorToMarkdown()), 50);
      return;
    }

    // Default: let browser handle, then sync
    setTimeout(() => { this._fireChange(); this._scheduleMarginUpdate(); }, 0);
  }

  _getListPrefix(text, block) {
    // Check DOM element
    if (block) {
      const indent = this._getBlockIndent(block);
      if (block.classList?.contains("te-todo")) return indent + "- [ ] ";
      if (block.classList?.contains("te-li-ul")) return indent + "- ";
      if (block.classList?.contains("te-li-ol")) {
        const num = parseInt(block.dataset.num || "1") + 1;
        return indent + `${num}. `;
      }
    }
    // Text-based
    const blockIndent = block ? this._getBlockIndent(block) : "";
    const t = TalaEditor._normMd(text).replace(/\u00A0/g, " ").trim();
    if (/^-\s*\[[ xX]?\]\s+./.test(t)) return blockIndent + "- [ ] ";
    if (/^([-*+])\s+./.test(t)) return blockIndent + t.match(/^([-*+])\s/)[0];
    if (/^(\d+)\.\s+./.test(t)) {
      const num = parseInt(t.match(/^(\d+)/)[1]) + 1;
      return blockIndent + `${num}. `;
    }
    return "";
  }

  _getBlockIndent(el) {
    const pl = el.style?.paddingLeft || "";
    if (!pl) return "";
    const rm = pl.match(/([\d.]+)rem/);
    if (rm) return "  ".repeat(Math.round(parseFloat(rm[1]) / 0.75));
    return "";
  }

  // ── Cursor helpers ─────────────────────────────────────────

  _ensureEditableAndFocus(el) {
    const target = el.querySelector(".te-todo-text") || el;
    target.querySelectorAll("br").forEach(br => br.remove());
    let textNode = null;
    for (const child of target.childNodes) { if (child.nodeType === Node.TEXT_NODE) { textNode = child; break; } }
    if (!textNode) { textNode = document.createTextNode("\u200B"); target.appendChild(textNode); }
    else if (!textNode.textContent) textNode.textContent = "\u200B";
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent.length);
    range.collapse(true);
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _placeCursorIn(el) {
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let lastText = null;
    let node;
    while ((node = walker.nextNode())) lastText = node;
    if (lastText) { range.setStart(lastText, lastText.textContent.length); range.collapse(true); }
    else { const tn = document.createTextNode(""); el.appendChild(tn); range.setStart(tn, 0); range.collapse(true); }
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _placeCursorAt(textNode, offset) {
    const range = document.createRange();
    range.setStart(textNode, Math.min(offset, textNode.length || 0));
    range.collapse(true);
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ── Selection to markdown (for copy) ───────────────────────

  _selectionToMarkdown() {
    const sel = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return null;
    const fragment = sel.getRangeAt(0).cloneContents();
    const lines = [];
    for (const node of fragment.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) { const t = node.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, ""); if (t) lines.push(t); }
      else if (node.nodeType === Node.ELEMENT_NODE) lines.push(this._nodeToMd(node));
    }
    return lines.join("\n");
  }

  // ── Margin drag handles ────────────────────────────────────

  _scheduleMarginUpdate() {
    // TODO: implement margin drag handles
  }

  // ── Events ─────────────────────────────────────────────────

  _fireChange() {
    this.dispatchEvent(new CustomEvent("change", {
      detail: { markdown: this._editorToMarkdown() },
      bubbles: true,
    }));
  }

  // ── Styles ─────────────────────────────────────────────────

  static get styles() {
    return `
      :host { display: block; height: 100%; }

      .te-wrapper { display: flex; height: 100%; position: relative; }
      .te-wrapper[data-theme="dark"] { --te-bg: #1a1a1a; --te-fg: #e0e0e0; --te-accent: #8b7355; --te-border: rgba(255,255,255,0.1); --te-muted: rgba(255,255,255,0.4); --te-code-bg: rgba(255,255,255,0.06); }
      .te-wrapper:not([data-theme="dark"]) { --te-bg: #faf9f7; --te-fg: #2c2c2c; --te-accent: #8b7355; --te-border: #e0ded8; --te-muted: #999; --te-code-bg: rgba(139,115,85,0.08); }

      .te-margin { width: 24px; min-width: 24px; flex-shrink: 0; }
      .te-editor {
        flex: 1; outline: none; padding: 12px 16px; padding-bottom: 40vh;
        font-family: Georgia, "Times New Roman", serif; font-size: 1rem; line-height: 1.7;
        color: var(--te-fg); background: var(--te-bg);
        word-wrap: break-word; overflow-wrap: break-word; overflow-y: auto;
      }
      .te-editor:empty::before { content: "Start writing..."; color: var(--te-muted); font-style: italic; }

      .te-editor h1 { font-size: 1.5em; font-weight: 700; margin: 0.3em 0 0.1em; }
      .te-editor h2 { font-size: 1.25em; font-weight: 700; margin: 0.2em 0 0.1em; }
      .te-editor h3 { font-size: 1.1em; font-weight: 600; margin: 0.15em 0 0.05em; }
      .te-editor h4 { font-size: 1em; font-weight: 600; }
      .te-editor h5 { font-size: 0.9em; font-weight: 600; }
      .te-editor h6 { font-size: 0.85em; font-weight: 600; color: var(--te-muted); }
      .te-editor hr { border: none; border-top: 1px solid var(--te-border); margin: 0.5em 0; }
      .te-editor blockquote { border-left: 3px solid var(--te-accent); padding-left: 0.75em; color: var(--te-muted); font-style: italic; margin: 0.2em 0; }
      .te-editor code { background: var(--te-code-bg); padding: 1px 4px; border-radius: 3px; font-family: "SF Mono","Consolas",monospace; font-size: 0.85em; }
      .te-editor s { color: var(--te-muted); }
      .te-editor pre.te-code-block { background: var(--te-code-bg); border: 1px solid var(--te-border); border-radius: 4px; padding: 0.75em 1em; margin: 0.3em 0; overflow-x: auto; }
      .te-editor pre.te-code-block code { background: none; padding: 0; display: block; white-space: pre; }

      .te-todo { display: flex; align-items: baseline; gap: 0.3em; }
      .te-todo-done { color: var(--te-muted); text-decoration: line-through; }
      .te-cb { cursor: pointer; accent-color: var(--te-accent); }

      .te-li-ul::before { content: "\\2022"; color: var(--te-accent); margin-right: 0.4em; }
      .te-li-ol::before { content: attr(data-num) "."; color: var(--te-fg); margin-right: 0.4em; }

      .te-link { color: var(--te-accent); text-decoration: underline; cursor: pointer; }
      .te-img { max-width: 100%; height: auto; border-radius: 4px; margin: 0.3em 0; }
      .te-drop-active { outline: 2px dashed var(--te-accent); outline-offset: -4px; border-radius: 4px; }
    `;
  }
}

customElements.define("tala-editor", TalaEditor);

export { TalaEditor };
