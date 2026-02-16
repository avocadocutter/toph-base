import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { EditorView } from '@codemirror/view';
import { Save, ArrowLeft } from 'lucide-react';
import { SqlEditor } from '../components/sql-editor/sql-editor';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api, projectAdminPath } from '../lib/api-client';
import { useProjectStore } from '../stores/project-store';
import { toast } from 'sonner';
import type { MigrationListResponse } from '../types';

export function MigrationNewPage() {
  const navigate = useNavigate();
  const currentProject = useProjectStore((s) => s.currentProject);
  const editorViewRef = useRef<EditorView | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Fetch existing migrations to suggest next number
  const { data: migrations } = useQuery({
    queryKey: ['admin-migrations', currentProject?.ref],
    queryFn: () => api.get<MigrationListResponse>(projectAdminPath('/migrations')),
    enabled: !!currentProject,
  });

  // Auto-suggest next migration name
  useEffect(() => {
    if (migrations?.data) {
      const maxNumber = migrations.data
        .map(m => {
          const match = m.name.match(/^(\d+)_/);
          return match ? parseInt(match[1]) : 0;
        })
        .reduce((max, n) => Math.max(max, n), 0);

      const nextNumber = String(maxNumber + 1).padStart(3, '0');
      setName(`${nextNumber}_new_migration.sql`);
    }
  }, [migrations]);

  // Save migration
  const saveMutation = useMutation({
    mutationFn: () => {
      const content = editorViewRef.current?.state.doc.toString().trim() || '';

      if (!content) {
        throw new Error('Migration content cannot be empty');
      }

      if (!name.endsWith('.sql')) {
        throw new Error('Migration name must end with .sql');
      }

      return api.post(projectAdminPath('/migrations'), {
        name,
        content,
        description: description || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Migration created successfully');
      navigate('/migrations');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/migrations')}>
            <ArrowLeft size={14} />
          </Button>
          <div>
            <h1 className="text-lg font-bold">New Migration</h1>
            <p className="text-xs text-muted-foreground">
              Write SQL to modify your database schema
            </p>
          </div>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!name || saveMutation.isPending}
        >
          <Save size={14} />
          Save Migration
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Migration Name</label>
          <Input
            placeholder="e.g., 001_create_profiles.sql"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Description (Optional)</label>
          <Input
            placeholder="Brief description of what this migration does"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border">
        <SqlEditor
          initialValue={`-- Migration: ${name}\n-- ${description || 'Add description here'}\n\n-- Write your migration SQL below:\n\n`}
          viewRef={editorViewRef}
          onExecute={() => {}}
        />
      </div>
    </div>
  );
}
