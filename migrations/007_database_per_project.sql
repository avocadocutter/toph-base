-- Migrate from schema-per-project to database-per-project
-- Rename schema_name column to db_name in projects table

ALTER TABLE toph_internal.projects RENAME COLUMN schema_name TO db_name;

-- Prefix existing values with 'toph_' to form valid database names
UPDATE toph_internal.projects SET db_name = 'toph_' || db_name WHERE db_name NOT LIKE 'toph_%';

-- Drop the schema provisioning function (no longer needed)
DROP FUNCTION IF EXISTS toph_internal.provision_project_schema(TEXT);
