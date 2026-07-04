import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { api } from '@/lib/api-client';
import {
  Database,
  Terminal,
  Users,
  Shield,
  Settings,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  GitBranch,
  HardDrive,
  Zap,
  ListChecks,
  LogOut,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/tables', icon: Database, label: 'Tables' },
  { to: '/sql', icon: Terminal, label: 'SQL Editor' },
  { to: '/migrations', icon: GitBranch, label: 'Migrations' },
  { to: '/storage', icon: HardDrive, label: 'Storage' },
  { to: '/functions', icon: Zap, label: 'Functions' },
  { to: '/jobs', icon: ListChecks, label: 'Jobs' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/policies', icon: Shield, label: 'Policies' },
];

const bottomItems = [
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/docs', icon: BookOpen, label: 'Docs' },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  const navigate = useNavigate();

  const logout = async () => {
    await api.post('/tophbase/logout').catch(() => {});
    navigate('/login', { replace: true });
  };

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border bg-card transition-all duration-200',
        sidebarCollapsed ? 'w-14' : 'w-56',
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        {!sidebarCollapsed && (
          <span className="text-sm font-bold tracking-tight text-foreground">Tophbase</span>
        )}
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-2 pt-3">
        {!sidebarCollapsed && (
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Studio
          </p>
        )}
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                sidebarCollapsed && 'justify-center px-0',
              )
            }
          >
            <item.icon size={18} />
            {!sidebarCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        {!sidebarCollapsed && (
          <p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Settings
          </p>
        )}
        {bottomItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                sidebarCollapsed && 'justify-center px-0',
              )
            }
          >
            <item.icon size={18} />
            {!sidebarCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        <button
          onClick={logout}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          <LogOut size={18} />
          {!sidebarCollapsed && <span>Log out</span>}
        </button>
      </nav>

      <div className="border-t border-border p-3">
        {!sidebarCollapsed && (
          <p className="text-[10px] text-muted-foreground">Tophbase v0.1.0</p>
        )}
      </div>
    </aside>
  );
}
