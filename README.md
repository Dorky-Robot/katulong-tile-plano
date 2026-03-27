# Plano

Context sheets for [Katulong](https://github.com/Dorky-Robot/katulong) — notes, todos, and project plans.

Plano gives you a markdown-powered note editor inside a Katulong tile. Type markdown, press Enter, and it renders as rich text. Checkboxes are clickable, lists auto-continue, and copy always produces clean markdown.

Works standalone with local file storage, or optionally connects to a [Tala](https://github.com/Dorky-Robot/tala) server for git-backed versioning.

## Install

```
katulong extensions install dorky-robot/plano
```

## Usage

Once installed, create a new Plano tile from the Katulong tile picker. You get:

- **Sidebar** — list of notes with create/select/delete
- **Editor** — contenteditable markdown editor with rich text rendering
- **Chat shelf** — send commands to the back-face terminal

### Editor features

- Type markdown and press Enter to convert to rich text (headings, lists, checkboxes, blockquotes, code blocks, bold/italic/strikethrough)
- List continuation: bullets, ordered lists, and checkboxes auto-continue on Enter
- Tab to indent, Shift+Tab to outdent
- Checkboxes are clickable to toggle done/not-done
- Copy produces markdown
- Code blocks: type \`\`\` and press Enter to open a fenced code block

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Enter | Convert markdown line to rich text, continue lists |
| Shift+Enter | Line break (no conversion) |
| Tab | Indent current line |
| Shift+Tab | Outdent current line |

## Storage

By default, notes are stored as `.md` files in `~/.katulong/plano/notes/`. Each note is a separate file named by slug (e.g., `project-plan.md`).

## Tala integration (optional)

If you have a Tala server running, you can connect Plano to it for git-backed note versioning:

1. Open tile settings
2. Set **Tala Server URL** to your Tala instance (e.g., `http://localhost:3838`)
3. Set **Tala API Token** to your API token

When connected, notes are stored in Tala's git-backed storage instead of local files.

## Development

```bash
git clone git@github.com:Dorky-Robot/katulong-tile-plano.git
cd katulong-tile-plano
# Edit tile.js, test in Katulong dev mode
```

## License

MIT
