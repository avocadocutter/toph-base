import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { useProjectStore } from '@/stores/project-store';
import {
  Database,
  Terminal,
  Users,
  Shield,
  Settings,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  FolderOpen,
  ChevronDown,
  BookOpen,
  GitBranch,
} from 'lucide-react';

const projectItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/tables', icon: Database, label: 'Tables' },
  { to: '/sql', icon: Terminal, label: 'SQL Editor' },
  { to: '/migrations', icon: GitBranch, label: 'Migrations' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/policies', icon: Shield, label: 'Policies' },
];

const platformItems = [
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/docs', icon: BookOpen, label: 'Docs' },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const navigate = useNavigate();

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

      {/* Project selector */}
      {!sidebarCollapsed && (
        <button
          onClick={() => navigate('/projects')}
          className="mx-2 mt-2 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <span className="truncate text-left">
            {currentProject ? currentProject.name : 'Select project...'}
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      )}
      {sidebarCollapsed && (
        <button
          onClick={() => navigate('/projects')}
          className="mx-auto mt-2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={currentProject?.name ?? 'Select project'}
        >
          <FolderOpen size={18} />
        </button>
      )}

      <nav className="flex-1 space-y-1 p-2">
        {currentProject && (
          <>
            {!sidebarCollapsed && (
              <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Project
              </p>
            )}
            {projectItems.map((item) => (
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
          </>
        )}

        {!sidebarCollapsed && (
          <p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Platform
          </p>
        )}
        {platformItems.map((item) => (
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
      </nav>

      <div className="border-t border-border p-3">
        {!sidebarCollapsed && (
          <p className="text-[10px] text-muted-foreground">toph-base v0.1.0</p>
        )}
      </div>
    </aside>
  );
}
