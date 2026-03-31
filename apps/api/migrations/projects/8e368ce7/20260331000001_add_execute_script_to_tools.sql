-- Add execute_script to admin_tools.
-- JS function body executed in-process when the tool is called.
-- Available in scope: toolCallId (string), params (object), signal (AbortSignal), ctx (ToolScriptContext).
-- ctx = { agentTypeId: string, workspaceDir: string }
-- Must return { content: [{ type: "text", text: string }], details: any }
-- Throw on error (do not return errors in content).
-- NULL means no script — falls back to the default echo executor.
ALTER TABLE admin_tools ADD COLUMN execute_script TEXT NULL;
