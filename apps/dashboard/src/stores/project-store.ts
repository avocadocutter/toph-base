import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project } from '@/types';

interface ProjectState {
  currentProject: Project | null;
  setProject: (project: Project) => void;
  clearProject: () => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentProject: null,
      setProject: (project) => set({ currentProject: project }),
      clearProject: () => set({ currentProject: null }),
    }),
    {
      name: 'toph-project',
    },
  ),
);
