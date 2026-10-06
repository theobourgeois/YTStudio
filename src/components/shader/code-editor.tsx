/**
 * A GLSL code editor (CodeMirror 6, C's grammar, which reads GLSL well), in the app's theme: line numbers,
 * brackets, search, its own undo, and the shader's problems drawn on their lines. Loaded with the shader
 * editor only (`shader-window.tsx`).
 */
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { basicSetup } from "codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";
import type { ShaderProblem } from "@shared/shader-code";

export interface CodeEditorHandle {
  /** Put the cursor on a line (from 1) and show it. */
  goTo(line: number): void;
}

const THEME = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", backgroundColor: "var(--sunken)", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-gutters": { backgroundColor: "var(--surface-1)", color: "var(--muted-foreground)", borderRight: "1px solid var(--line)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--brand) 7%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--brand) 14%, transparent)", color: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--brand) 32%, transparent)",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklab, var(--brand) 22%, transparent)", outline: "none" },
  ".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--line)", borderRadius: "4px" },
  ".cm-diagnostic": { fontFamily: "var(--font-sans)", fontSize: "12px" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--destructive)" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--foreground)" },
  ".cm-textfield": { backgroundColor: "var(--sunken)", color: "var(--foreground)", border: "1px solid var(--line)" },
  ".cm-button": { backgroundImage: "none", backgroundColor: "var(--surface-3)", color: "var(--foreground)", border: "1px solid var(--line)" },
});

/** GLSL's colours, from the theme's `--code-*`. */
const HIGHLIGHT = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier, t.operatorKeyword, t.definitionKeyword], color: "var(--code-keyword)" },
  { tag: [t.typeName, t.standard(t.typeName)], color: "var(--code-type)" },
  { tag: [t.number, t.bool, t.atom, t.string], color: "var(--code-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--code-function)" },
  { tag: [t.processingInstruction, t.macroName], color: "var(--code-macro)" },
]);

export function CodeEditor({
  value,
  onChange,
  problems,
  label,
  typing,
  ref,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Whether what was typed is still on its way to `value` (which then lags behind it): it's left alone. */
  typing?: () => boolean;
  /** Shown on their lines (a problem without a line is the window's to show). */
  problems: readonly ShaderProblem[];
  label: string;
  ref?: Ref<CodeEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  // What the editor shows was put there from outside (undo, the assistant): not the user's typing.
  const replacing = useRef(false);

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          cpp(),
          syntaxHighlighting(HIGHLIGHT),
          lintGutter(),
          THEME,
          EditorView.contentAttributes.of({ "aria-label": label, "data-shader-code": "", "data-autofocus": "", spellcheck: "false" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !replacing.current) changed.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is made once; `value` changes reach it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || typing?.() || v.state.doc.toString() === value) return;
    replacing.current = true;
    try {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    } finally {
      replacing.current = false;
    }
    // `typing` is read when the value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const diagnostics: Diagnostic[] = problems.flatMap((p) =>
      p.line !== null && p.line >= 1 && p.line <= doc.lines ? [{ from: doc.line(p.line).from, to: doc.line(p.line).to, severity: "error" as const, message: p.message }] : [],
    );
    v.dispatch(setDiagnostics(v.state, diagnostics));
  }, [problems]);

  useImperativeHandle(ref, () => ({
    goTo(line) {
      const v = view.current;
      if (!v) return;
      const at = v.state.doc.line(Math.max(1, Math.min(v.state.doc.lines, line)));
      v.dispatch({ selection: { anchor: at.from, head: at.to }, scrollIntoView: true });
      v.focus();
    },
  }));

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

export default CodeEditor;
