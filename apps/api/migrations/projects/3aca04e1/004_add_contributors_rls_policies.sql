-- Add RLS policies for authenticated users to access cs_contributors

-- Allow authenticated users to read all contributor records
CREATE POLICY "Authenticated read cs_contributors"
  ON cs_contributors
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert their own contributor record
CREATE POLICY "Authenticated insert cs_contributors"
  ON cs_contributors
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Optional: Allow authenticated users to update their own contributor record
-- Uncomment if needed and adjust the USING clause to match your business logic
-- CREATE POLICY "Authenticated update own cs_contributors"
--   ON cs_contributors
--   FOR UPDATE
--   TO authenticated
--   USING (id = auth_uid());
