import { useEffect, useRef } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface RecordSidebarProps {
  title: string;
  record: Record<string, unknown> | null;
  onClose: () => void;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function FieldValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">null</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <span className={cn('font-mono text-xs', value ? 'text-green-500' : 'text-red-400')}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === 'object') {
    const pretty = JSON.stringify(value, null, 2);
    return (
      <pre className="font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground bg-muted/40 rounded px-2 py-1.5 mt-1">
        {pretty}
      </pre>
    );
  }
  return (
    <span className="font-mono text-xs break-all">{String(value)}</span>
  );
}

export function RecordSidebar({ title, record, onClose }: RecordSidebarProps) {
  const open = record !== null;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/20 transition-opacity duration-200',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-[360px] flex flex-col bg-background border-l border-border shadow-xl transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold">{title}</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
          {record && Object.entries(record).map(([key, value]) => (
            <div key={key}>
              <div className="text-xs font-medium text-muted-foreground mb-1">{key}</div>
              <div className="group flex items-start">
                <FieldValue value={value} />
                {value !== null && value !== undefined && typeof value !== 'object' && (
                  <CopyButton value={String(value)} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
