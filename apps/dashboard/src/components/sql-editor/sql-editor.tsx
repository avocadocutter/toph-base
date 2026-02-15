import { useRef, useCallback, type MutableRefObject } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';

interface SqlEditorProps {
  onExecute: (query: string) => void;
  initialValue?: string;
  viewRef?: MutableRefObject<EditorView | null>;
}

export function SqlEditor({ onExecute, initialValue = '', viewRef: externalViewRef }: SqlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

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
          oneDark,
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

  return (
    <div ref={editorCallback} className="h-full min-h-[200px] overflow-hidden rounded-md border border-border" />
  );
}
