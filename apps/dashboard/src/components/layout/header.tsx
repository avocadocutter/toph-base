import { useUiStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { BranchSelector } from '@/components/branches/branch-selector';
import { Sun, Moon, Monitor } from 'lucide-react';

const themeIcon = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

const themeLabel = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
} as const;

export function Header() {
  const theme = useUiStore((s) => s.theme);
  const cycleTheme = useUiStore((s) => s.cycleTheme);

  const Icon = themeIcon[theme];

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div />
      <div className="flex items-center gap-3">
        <BranchSelector />
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleTheme}
          title={`Theme: ${themeLabel[theme]}`}
        >
          <Icon size={14} />
        </Button>
      </div>
    </header>
  );
}
