import { useRef, useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { useProjectStore } from '@/stores/project-store';
import { api } from '@/lib/api-client';
import type { Project } from '@/types';
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
  Check,
  Plus,
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
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/docs', icon: BookOpen, label: 'Docs' },
];

function ProjectSwitcher({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const currentProject = useProjectStore((s) => s.currentProject);
  const setProject = useProjectStore((s) => s.setProject);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/platform/projects'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (project: Project) => {
    setProject(project);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative mx-2 mt-2">
      {collapsed ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mx-auto flex rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={currentProject?.name ?? 'Select project'}
        >
          <FolderOpen size={18} />
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <span className="truncate text-left">
            {currentProject ? currentProject.name : 'Select project...'}
          </span>
          <ChevronDown size={14} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      )}

      {open && (
        <div className={cn(
          'absolute z-50 mt-1 w-56 rounded-md border border-border bg-popover py-1 shadow-md',
          collapsed ? 'left-10 top-0' : 'left-0',
        )}>
          {projects === undefined && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading...</p>
          )}
          {projects?.map((project) => (
            <button
              key={project.id}
              onClick={() => handleSelect(project)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
            >
              <Check size={14} className={cn('shrink-0', currentProject?.id === project.id ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
          {projects?.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No projects yet.</p>
          )}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => { setOpen(false); navigate('/projects'); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus size={14} className="shrink-0" />
            <span>Manage projects</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  const currentProject = useProjectStore((s) => s.currentProject);
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
      <ProjectSwitcher collapsed={sidebarCollapsed} />

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
