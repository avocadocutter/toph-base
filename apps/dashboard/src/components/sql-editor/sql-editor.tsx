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
    backgroundColor: 'var(--color-accent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--color-accent)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-foreground)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'oklch(0.55 0.15 250 / 0.2) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'oklch(0.55 0.15 250 / 0.3) !important',
  },
});

interface SqlEditorProps {
  onExecute: (query: string) => void;
  initialValue?: string;
  viewRef?: MutableRefObject<EditorView | null>;
  theme?: 'light' | 'dark';
}

export function SqlEditor({ onExecute, initialValue = '', viewRef: externalViewRef, theme = 'dark' }: SqlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());

  const editorCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      if (viewRef.current) return;

      const executeKeymap = keymap.of([
        {
          key: 'Mod-Enter',
          run: (view) => {
            const query = view.state.doc.toString().trim();
            if (query) onExecute(query);
            return true;
          },
        },
      ]);

      const state = EditorState.create({
        doc: initialValue,
        extensions: [
          basicSetup,
          sql({ dialect: PostgreSQL }),
          themeCompartment.current.of(theme === 'dark' ? oneDark : lightTheme),
          autocompletion(),
          keymap.of([...defaultKeymap, indentWithTab]),
          executeKeymap,
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-content': { fontFamily: 'inherit' },
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
