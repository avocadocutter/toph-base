import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import {
  Database,
  Terminal,
  Users,
  Shield,
  Settings,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/tables', icon: Database, label: 'Tables' },
  { to: '/sql', icon: Terminal, label: 'SQL Editor' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/policies', icon: Shield, label: 'Policies' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border bg-card transition-all duration-200',
        sidebarCollapsed ? 'w-14' : 'w-56',
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        {!sidebarCollapsed && (
          <span className="text-sm font-bold tracking-tight text-foreground">toph-base</span>
        )}
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
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
      </nav>

      <div className="border-t border-border p-3">
        {!sidebarCollapsed && (
          <p className="text-[10px] text-muted-foreground">toph-base v0.1.0</p>
        )}
      </div>
    </aside>
  );
}
