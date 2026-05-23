import { useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';

const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-card)',
    color: 'var(--color-card-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-muted-foreground)',
    borderRight: '1px solid var(--color-border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'oklch(0.89 0.03 250)',
  },
  '.cm-activeLine': {
    backgroundColor: 'oklch(0.89 0.03 250)',
    mixBlendMode: 'multiply',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-foreground)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'oklch(0.82 0.08 240) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'oklch(0.74 0.12 240) !important',
  },
});

function getSelectedOrAll(view: EditorView): string {
  const { from, to } = view.state.selection.main;
  if (from !== to) return view.state.sliceDoc(from, to).trim();
  return view.state.doc.toString().trim();
}

interface SqlEditorProps {
  onExecute: (query: string) => void;
  onChange?: (value: string) => void;
  onSelectionChange?: (hasSelection: boolean) => void;
  initialValue?: string;
  viewRef?: MutableRefObject<EditorView | null>;
  theme?: 'light' | 'dark';
}

export function SqlEditor({ onExecute, onChange, onSelectionChange, initialValue = '', viewRef: externalViewRef, theme = 'dark' }: SqlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const editorCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      if (viewRef.current) return;

      const executeKeymap = keymap.of([
        {
          key: 'Mod-Enter',
          run: (view) => {
            const query = getSelectedOrAll(view);
            if (query) onExecute(query);
            return true;
          },
        },
      ]);

      const changeListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const { from, to } = update.state.selection.main;
          onSelectionChangeRef.current?.(from !== to);
        }
      });

      const state = EditorState.create({
        doc: initialValue,
        extensions: [
          basicSetup,
          sql({ dialect: PostgreSQL }),
          themeCompartment.current.of(theme === 'dark' ? oneDark : lightTheme),
          autocompletion(),
          keymap.of([...defaultKeymap, indentWithTab]),
          executeKeymap,
          changeListener,
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-content': { fontFamily: 'inherit' },
            '.cm-foldGutter': { display: 'none' },
          }),
        ],
      });

      viewRef.current = new EditorView({ state, parent: node });
      if (externalViewRef) externalViewRef.current = viewRef.current;
      editorRef.current = node;
    },
    [onExecute, initialValue],
  );

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(theme === 'dark' ? oneDark : lightTheme),
    });
  }, [theme]);

  return (
    <div ref={editorCallback} className="h-full min-h-[200px] overflow-hidden rounded-md border border-border" />
  );
}
