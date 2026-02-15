import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useNavigate } from 'react-router-dom';
import { LogOut, User, Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const theme = useUiStore((s) => s.theme);
  const cycleTheme = useUiStore((s) => s.cycleTheme);

  const Icon = themeIcon[theme];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div />
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleTheme}
          title={`Theme: ${themeLabel[theme]}`}
        >
          <Icon size={14} />
        </Button>
        {user && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User size={14} />
            <span>{user.email}</span>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut size={14} />
          <span>Logout</span>
        </Button>
      </div>
    </header>
  );
}
