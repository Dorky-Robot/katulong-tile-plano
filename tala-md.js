/**
 * tala-md.js — Pure markdown ↔ HTML conversion functions.
 *
 * No DOM dependency for the core logic. Can be used in:
 * - <tala-editor> web component
 * - Plano tile
 * - Server-side rendering
 * - Any app that needs markdown ↔ rich text
 *
 * Usage:
 *   import { mdLineToHtml, htmlToMd, fmtInline, normalizeMd, getListPrefix, isEmptyListItem } from './tala-md.js';
 */

// ── Escaping ─────────────────────────────────────────────────

export function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Inline formatting ────────────────────────────────────────

export function fmtInline(text) {
  let h = esc(text);
  // Images before links (![...] vs [...])
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

// ── Normalize markdown ───────────────────────────────────────

export function normalizeMd(t) {
  return t
    .replace(/^(\s*)-\s*\[\s*\]\s*/, "$1- [ ] ")
    .replace(/^(\s*)-\s*\[x\]\s*/i, "$1- [x] ");
}

// ── Single line: markdown → HTML string + CSS class ──────────

/**
 * Convert a markdown line to { html, cls, tag }.
 * Returns null if no markdown pattern matched (plain text).
 */
export function mdLineToHtml(md) {
  const t = md.trim();
  if (!t) return null;

  let m;

  // Heading h1-h6
  m = t.match(/^(#{1,6})\s+(.+)$/);
  if (m) return { tag: `h${m[1].length}`, html: fmtInline(m[2]), cls: "" };

  // HR
  if (/^(-{3,}|\*{3,}|_{3,}|—{1,}|-\s-\s-[\s-]*)$/.test(t))
    return { tag: "hr", html: "", cls: "" };

  // Checkbox
  m = normalizeMd(t).match(/^-\s*\[([ xX]?)\]\s*(.*)$/);
  if (m) {
    const checked = m[1].toLowerCase() === "x";
    return {
      tag: "div",
      cls: "te-todo" + (checked ? " te-todo-done" : ""),
      html: `<input type="checkbox" class="te-cb" ${checked ? "checked" : ""} contenteditable="false"> <span class="te-todo-text">${fmtInline(m[2])}</span>`,
    };
  }

  // Bullet
  m = t.match(/^[-*+]\s*(.*)$/);
  if (m && (t.match(/^[-*+]\s/) || t.match(/^[-*+]$/)))
    return { tag: "div", cls: "te-li te-li-ul", html: fmtInline(m[1]) || "<br>", dataset: {} };

  // Ordered list
  m = t.match(/^(\d+)\.\s*(.*)$/);
  if (m && (t.match(/^\d+\.\s/) || t.match(/^\d+\.$/)))
    return { tag: "div", cls: "te-li te-li-ol", html: fmtInline(m[2]) || "<br>", dataset: { num: m[1] } };

  // Blockquote
  m = t.match(/^>\s*(.*)$/);
  if (m && t.startsWith(">"))
    return { tag: "blockquote", html: fmtInline(m[1]) || "<br>", cls: "" };

  // Inline formatting only
  const formatted = fmtInline(t);
  if (formatted !== esc(t))
    return { tag: "div", html: formatted, cls: "" };

  return null;
}

// ── DOM node → markdown ──────────────────────────────────────

/**
 * Convert a DOM node to a markdown line.
 * Works with nodes created by mdLineToHtml or browser contenteditable.
 */
export function nodeToMd(node) {
  if (node.nodeType === Node.TEXT_NODE)
    return node.textContent.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
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
  if (/^H[1-6]$/.test(tag)) return indent + "#".repeat(parseInt(tag[1])) + " " + inlineMd(node);
  if (tag === "BLOCKQUOTE") return indent + "> " + inlineMd(node);

  if (node.classList?.contains("te-todo")) {
    const checked = node.querySelector(".te-cb")?.checked;
    const textEl = node.querySelector(".te-todo-text");
    const text = textEl ? inlineMd(textEl) : "";
    return `${indent}- [${checked ? "x" : " "}] ${text}`;
  }
  if (node.classList?.contains("te-li-ol"))
    return `${indent}${node.dataset.num || "1"}. ${inlineMd(node)}`;
  if (node.classList?.contains("te-li-ul"))
    return `${indent}- ${inlineMd(node)}`;

  // Generic div/p
  if (tag === "DIV" || tag === "P") {
    if (node.childNodes.length === 1 && node.firstChild.nodeName === "BR") return indent || "";
    return indent + inlineMd(node);
  }
  return indent + inlineMd(node);
}

/**
 * Convert inline children of a DOM node to markdown.
 */
export function inlineMd(node) {
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
    if (tag === "INPUT" && child.classList?.contains("te-cb")) continue;
    result += inner;
  }
  return result;
}

// ── List helpers ─────────────────────────────────────────────

/**
 * Get the list continuation prefix for a line.
 * Also checks DOM element classes for rich text blocks.
 */
export function getListPrefix(text, block) {
  if (block) {
    const indent = getBlockIndent(block);
    if (block.classList?.contains("te-todo")) return indent + "- [ ] ";
    if (block.classList?.contains("te-li-ul")) return indent + "- ";
    if (block.classList?.contains("te-li-ol")) {
      const num = parseInt(block.dataset.num || "1") + 1;
      return indent + `${num}. `;
    }
  }
  const blockIndent = block ? getBlockIndent(block) : "";
  const t = normalizeMd(text).replace(/\u00A0/g, " ").trim();
  if (/^-\s*\[[ xX]?\]\s+./.test(t)) return blockIndent + "- [ ] ";
  if (/^([-*+])\s+./.test(t)) return blockIndent + t.match(/^([-*+])\s/)[0];
  if (/^(\d+)\.\s+./.test(t)) {
    const num = parseInt(t.match(/^(\d+)/)[1]) + 1;
    return blockIndent + `${num}. `;
  }
  return "";
}

/**
 * Check if a line/block is an empty list item (just the prefix, no content).
 */
export function isEmptyListItem(text, block) {
  if (block) {
    const isListEl = block.classList?.contains("te-li-ol") ||
                     block.classList?.contains("te-li-ul") ||
                     block.classList?.contains("te-todo");
    if (isListEl) {
      const content = block.textContent.replace(/\u200B/g, "").replace(/\u00A0/g, " ").trim();
      if (!content) return true;
    }
  }
  const t = normalizeMd(text).replace(/\u00A0/g, " ").replace(/\u200B/g, "").trim();
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

/**
 * Convert an editor's child nodes to markdown.
 */
export function editorToMarkdown(editorEl) {
  const lines = [];
  for (const node of editorEl.childNodes) lines.push(nodeToMd(node));
  return lines.join("\n");
}

/**
 * Create DOM elements from markdown and append to an editor element.
 */
export function loadMarkdownInto(editorEl, md) {
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
      const pre = document.createElement("pre");
      pre.className = "te-code-block";
      if (lang) pre.dataset.lang = lang;
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      pre.contentEditable = "false";
      editorEl.appendChild(pre);
      continue;
    }

    const indentMatch = line.match(/^(\s+)/);
    const level = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
    const parsed = mdLineToHtml(line);

    if (parsed) {
      const el = document.createElement(parsed.tag);
      if (parsed.cls) el.className = parsed.cls;
      if (parsed.html) el.innerHTML = parsed.html;
      if (parsed.dataset) {
        for (const [k, v] of Object.entries(parsed.dataset)) el.dataset[k] = v;
      }
      if (level > 0) el.style.paddingLeft = (level * 0.75) + "rem";
      editorEl.appendChild(el);
    } else {
      const div = document.createElement("div");
      if (line) div.textContent = line;
      else div.innerHTML = "<br>";
      editorEl.appendChild(div);
    }
    i++;
  }
}
