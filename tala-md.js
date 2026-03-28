/**
 * tala-md.js — Pure markdown ↔ HTML conversion functions.
 *
 * No DOM dependency for the core functions. Can be used in:
 * - Browser (tala-editor web component)
 * - Node.js (server-side rendering, tests)
 * - Any app that needs markdown conversion
 *
 * CSS class prefix: "tm-" (tala-md) to avoid conflicts.
 */

// ── Escaping ─────────────────────────────────────────────────

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
export function esc(s) { return s.replace(/[&<>]/g, c => ESC_MAP[c]); }

// ── Inline formatting ────────────────────────────────────────

export function fmtInline(text) {
  let h = esc(text);
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="tm-img">');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="tm-link" contenteditable="false">$1</a>');
  h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  h = h.replace(/__(.+?)__/g, "<b>$1</b>");
  h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  h = h.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");
  h = h.replace(/~~(.+?)~~/g, "<s>$1</s>");
  h = h.replace(/`(.+?)`/g, "<code>$1</code>");
  return h;
}

// ── Normalize forgiving checkbox syntax ──────────────────────

export function normMd(t) {
  return t.replace(/^(\s*)-\s*\[\s*\]\s*/, "$1- [ ] ")
          .replace(/^(\s*)-\s*\[x\]\s*/i, "$1- [x] ");
}

// ── Markdown line → HTML string ──────────────────────────────

/**
 * Convert a single markdown line to an HTML string + class name.
 * Returns { html, cls } or null if no markdown pattern matched.
 */
export function mdLineToHtml(md) {
  const t = md.trim();
  if (!t) return null;

  let m;

  // Heading h1-h6
  m = t.match(/^(#{1,6})\s+(.+)$/);
  if (m) return { tag: `h${m[1].length}`, html: fmtInline(m[2]), cls: `tm-h${m[1].length}` };

  // HR
  if (/^(-{3,}|\*{3,}|_{3,}|—{1,}|-\s-\s-[\s-]*)$/.test(t)) return { tag: "hr", html: "", cls: "tm-hr" };

  // Checkbox
  m = normMd(t).match(/^-\s*\[([ xX]?)\]\s*(.*)$/);
  if (m) {
    const checked = m[1].toLowerCase() === "x";
    return {
      tag: "div",
      cls: "tm-todo" + (checked ? " tm-todo-done" : ""),
      html: `<input type="checkbox" class="tm-cb" ${checked ? "checked" : ""} contenteditable="false"> <span class="tm-todo-text">${fmtInline(m[2])}</span>`,
      checked,
    };
  }

  // Bullet
  m = t.match(/^[-*+]\s*(.*)$/);
  if (m && (t.match(/^[-*+]\s/) || t.match(/^[-*+]$/))) {
    return { tag: "div", cls: "tm-li tm-li-ul", html: fmtInline(m[1]) || "<br>" };
  }

  // OL
  m = t.match(/^(\d+)\.\s*(.*)$/);
  if (m && (t.match(/^\d+\.\s/) || t.match(/^\d+\.$/))) {
    return { tag: "div", cls: "tm-li tm-li-ol", html: fmtInline(m[2]) || "<br>", num: m[1] };
  }

  // Blockquote
  m = t.match(/^>\s*(.*)$/);
  if (m && t.startsWith(">")) {
    return { tag: "blockquote", cls: "tm-bq", html: fmtInline(m[1]) || "<br>" };
  }

  // Inline formatting only
  const formatted = fmtInline(t);
  if (formatted !== esc(t)) {
    return { tag: "div", cls: "tm-p", html: formatted };
  }

  return null;
}

// ── Create DOM element from markdown line ────────────────────

export function mdLineToEl(md, doc = document) {
  const result = mdLineToHtml(md);
  if (!result) return null;

  const el = doc.createElement(result.tag);
  if (result.cls) el.className = result.cls;
  if (result.tag !== "hr") el.innerHTML = result.html;
  if (result.num) el.dataset.num = result.num;
  return el;
}

// ── HTML element → markdown ──────────────────────────────────

export function nodeToMd(node) {
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

  const hMatch = tag.match(/^H([1-6])$/);
  if (hMatch) return indent + "#".repeat(parseInt(hMatch[1])) + " " + inlineMd(node);

  if (tag === "BLOCKQUOTE") return indent + "> " + inlineMd(node);

  if (node.classList?.contains("tm-todo")) {
    const checked = node.querySelector(".tm-cb")?.checked;
    const textEl = node.querySelector(".tm-todo-text");
    const text = textEl ? inlineMd(textEl) : "";
    return `${indent}- [${checked ? "x" : " "}] ${text}`;
  }
  if (node.classList?.contains("tm-li-ol")) {
    return `${indent}${node.dataset.num || "1"}. ${inlineMd(node)}`;
  }
  if (node.classList?.contains("tm-li-ul")) {
    return `${indent}- ${inlineMd(node)}`;
  }

  // Also handle legacy be-* classes for backward compat
  if (node.classList?.contains("be-todo")) {
    const checked = node.querySelector(".be-cb")?.checked;
    const textEl = node.querySelector(".be-todo-text");
    const text = textEl ? inlineMd(textEl) : "";
    return `${indent}- [${checked ? "x" : " "}] ${text}`;
  }
  if (node.classList?.contains("be-li-ol")) return `${indent}${node.dataset.num || "1"}. ${inlineMd(node)}`;
  if (node.classList?.contains("be-li-ul")) return `${indent}- ${inlineMd(node)}`;

  if (tag === "DIV" || tag === "P") {
    if (node.childNodes.length === 1 && node.firstChild.nodeName === "BR") return indent || "";
    return indent + inlineMd(node);
  }
  return indent + inlineMd(node);
}

export function inlineMd(node) {
  let result = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) { result += child.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, ""); continue; }
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
    if (tag === "INPUT" && (child.classList?.contains("tm-cb") || child.classList?.contains("be-cb"))) continue;
    result += inner;
  }
  return result;
}

// ── List prefix detection ────────────────────────────────────

export function getListPrefix(text, blockEl) {
  // Check DOM element for rich text blocks
  if (blockEl) {
    const indent = getBlockIndent(blockEl);
    if (blockEl.classList?.contains("tm-todo") || blockEl.classList?.contains("be-todo")) return indent + "- [ ] ";
    if (blockEl.classList?.contains("tm-li-ul") || blockEl.classList?.contains("be-li-ul")) return indent + "- ";
    if (blockEl.classList?.contains("tm-li-ol") || blockEl.classList?.contains("be-li-ol")) {
      const num = parseInt(blockEl.dataset.num || "1") + 1;
      return indent + `${num}. `;
    }
  }

  // Text-based detection
  const blockIndent = blockEl ? getBlockIndent(blockEl) : "";
  const t = normMd(text).replace(/\u00A0/g, " ").trim();
  if (/^-\s*\[[ xX]?\]\s+./.test(t)) return blockIndent + "- [ ] ";
  if (/^([-*+])\s+./.test(t)) return blockIndent + t.match(/^([-*+])\s/)[0];
  if (/^(\d+)\.\s+./.test(t)) {
    const num = parseInt(t.match(/^(\d+)/)[1]) + 1;
    return blockIndent + `${num}. `;
  }
  return "";
}

export function isEmptyListItem(text, blockEl) {
  // Check rich text elements
  if (blockEl) {
    const isList = blockEl.classList?.contains("tm-li-ol") || blockEl.classList?.contains("tm-li-ul") ||
                   blockEl.classList?.contains("tm-todo") || blockEl.classList?.contains("be-li-ol") ||
                   blockEl.classList?.contains("be-li-ul") || blockEl.classList?.contains("be-todo");
    if (isList) {
      const content = blockEl.classList?.contains("tm-todo") || blockEl.classList?.contains("be-todo")
        ? (blockEl.querySelector(".tm-todo-text,.be-todo-text")?.textContent || "")
        : blockEl.textContent;
      if (!content.replace(/\u200B/g, "").replace(/\u00A0/g, " ").trim()) return true;
    }
  }

  const t = normMd(text).replace(/\u00A0/g, " ").replace(/\u200B/g, "").trim();
  return /^-\s*\[[ xX]?\]\s*$/.test(t) || /^[-*+]\s*$/.test(t) || /^\d+\.\s*$/.test(t);
}

export function getBlockIndent(el) {
  const pl = el?.style?.paddingLeft || "";
  if (!pl) return "";
  const rm = pl.match(/([\d.]+)rem/);
  if (rm) return "  ".repeat(Math.round(parseFloat(rm[1]) / 0.75));
  return "";
}

// ── Full document conversion ─────────────────────────────────

export function editorToMarkdown(editorEl) {
  const lines = [];
  for (const node of editorEl.childNodes) lines.push(nodeToMd(node));
  return lines.join("\n");
}

export function loadMarkdownInto(editorEl, md, doc = document) {
  editorEl.innerHTML = "";
  if (!md) { editorEl.innerHTML = "<div><br></div>"; return; }

  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++;
      const pre = doc.createElement("pre");
      pre.className = "tm-code-block";
      if (lang) pre.dataset.lang = lang;
      const code = doc.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      pre.contentEditable = "false";
      editorEl.appendChild(pre);
      continue;
    }

    const indentMatch = line.match(/^(\s+)/);
    const level = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;

    const el = mdLineToEl(line, doc);
    if (el) {
      if (level > 0) el.style.paddingLeft = (level * 0.75) + "rem";
      editorEl.appendChild(el);
    } else {
      const div = doc.createElement("div");
      if (line) div.textContent = line;
      else div.innerHTML = "<br>";
      editorEl.appendChild(div);
    }
    i++;
  }
}

// ── Styles (CSS custom properties for theming) ───────────────

export const TALA_MD_STYLES = `
  /* Theme vars — override these for light/dark themes */
  :host, .tm-themed {
    --tm-fg: #2c2c2c;
    --tm-bg: #faf9f7;
    --tm-accent: #8b7355;
    --tm-border: #e0ded8;
    --tm-muted: #999;
    --tm-code-bg: rgba(139,115,85,0.08);
  }
  :host([theme="dark"]), .tm-themed[data-theme="dark"] {
    --tm-fg: #e0e0e0;
    --tm-bg: #1a1a1a;
    --tm-accent: #8b7355;
    --tm-border: rgba(255,255,255,0.1);
    --tm-muted: rgba(255,255,255,0.4);
    --tm-code-bg: rgba(255,255,255,0.06);
  }

  /* Block elements */
  h1 { font-size:1.5em; font-weight:700; margin:0.3em 0 0.1em; }
  h2 { font-size:1.25em; font-weight:700; margin:0.2em 0 0.1em; }
  h3 { font-size:1.1em; font-weight:600; margin:0.15em 0 0.05em; }
  h4 { font-size:1em; font-weight:600; }
  h5 { font-size:0.9em; font-weight:600; }
  h6 { font-size:0.85em; font-weight:600; color:var(--tm-muted); }
  hr { border:none; border-top:1px solid var(--tm-border); margin:0.5em 0; }
  blockquote { border-left:3px solid var(--tm-accent); padding-left:0.75em; color:var(--tm-muted); font-style:italic; margin:0.2em 0; }
  code { background:var(--tm-code-bg); padding:1px 4px; border-radius:3px; font-family:"SF Mono","Consolas",monospace; font-size:0.85em; }
  s { color:var(--tm-muted); }
  pre.tm-code-block { background:var(--tm-code-bg); border:1px solid var(--tm-border); border-radius:4px; padding:0.75em 1em; margin:0.3em 0; overflow-x:auto; }
  pre.tm-code-block code { background:none; padding:0; display:block; white-space:pre; }

  /* Todo */
  .tm-todo { display:flex; align-items:baseline; gap:0.3em; }
  .tm-todo-done { color:var(--tm-muted); text-decoration:line-through; }
  .tm-cb { cursor:pointer; accent-color:var(--tm-accent); }

  /* Lists */
  .tm-li-ul::before { content:"\\2022"; color:var(--tm-accent); margin-right:0.4em; }
  .tm-li-ol::before { content:attr(data-num) "."; color:var(--tm-fg); margin-right:0.4em; }

  /* Links & images */
  .tm-link { color:var(--tm-accent); text-decoration:underline; cursor:pointer; }
  .tm-img { max-width:100%; height:auto; border-radius:4px; margin:0.3em 0; }
`;
