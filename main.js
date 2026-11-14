const { Plugin, editorLivePreviewField } = require("obsidian");
const { ViewPlugin, Decoration } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");
const { syntaxTree } = require("@codemirror/language");

const HIDE = Decoration.replace({});
const BRACE = Decoration.mark({ class: "cm-orbit-brace" });
const BRACED = Decoration.mark({ class: "cm-orbit-braced" });
const QA = Decoration.mark({ class: "cm-orbit-qa" });

const SKIP = /code|math|frontmatter|comment/; // leave these regions alone
const BRACES = /(\{+)([^{}\n]*?)(\}+)/g;      // {x} or {{x}}
const QA_START = /^[QA]\./;                     // Q. / A. at the very start of a line

function build(view) {
  const b = new RangeSetBuilder();
  const { state } = view;
  if (!state.field(editorLivePreviewField, false)) return b.finish(); // Live Preview only

  const doc = state.doc;
  const active = new Set();
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number, z = doc.lineAt(r.to).number;
    for (let n = a; n <= z; n++) active.add(n);
  }

  const tree = syntaxTree(state);
  const skip = p => SKIP.test(tree.resolveInner(p, 1).name);
  let last = -1;

  for (const { from, to } of view.visibleRanges) {   // only what's on screen
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (line.from <= last) continue;               // line already done
      const isActive = active.has(line.number);
      const decos = [];

      if (QA_START.test(line.text) && !skip(line.from))
        decos.push([line.from, line.from + 2, QA]);

      BRACES.lastIndex = 0;
      let m;
      while ((m = BRACES.exec(line.text))) {
        const open = line.from + m.index;
        const inner = open + m[1].length;
        const close = inner + m[2].length;
        const end = close + m[3].length;
        if (skip(open)) continue;
        decos.push([open, inner, isActive ? BRACE : HIDE]);
        if (close > inner) decos.push([inner, close, BRACED]);
        decos.push([close, end, isActive ? BRACE : HIDE]);
      }

      for (const [f, t, d] of decos) b.add(f, t, d);  // already in document order
      last = line.to;
    }
  }
  return b.finish();
}

const orbit = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet ||
        u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false))
      this.decorations = build(u.view);
  }
}, { decorations: v => v.decorations });

// Reading view: mute Q. / A. at the start of a line in top-level paragraphs
function markQA(p) {
  let atStart = true;
  for (const node of Array.from(p.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      const re = /(^|\n)([QA]\.)/g;
      let m, idx = 0, frag = null;
      while ((m = re.exec(text))) {
        if (m.index === 0 && m[1] === "" && !atStart) continue;
        const s = m.index + m[1].length;
        frag = frag || document.createDocumentFragment();
        frag.append(text.slice(idx, s));
        const span = document.createElement("span");
        span.className = "orbit-qa";
        span.textContent = m[2];
        frag.append(span);
        idx = s + 2;
      }
      atStart = text.endsWith("\n");
      if (frag) { frag.append(text.slice(idx)); node.replaceWith(frag); }
    } else {
      atStart = node.nodeName === "BR";
    }
  }
}

module.exports = class OrbitMarkdown extends Plugin {
  onload() {
    this.registerEditorExtension(orbit);
    this.registerMarkdownPostProcessor(el => {
      el.querySelectorAll(":scope > p").forEach(markQA);
    });
  }
};
