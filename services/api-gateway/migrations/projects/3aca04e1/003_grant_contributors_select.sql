-- Grant SELECT permission on cs_contributors table
-- Required for authenticated users to read contributor data

GRANT SELECT ON cs_contributors TO authenticated;
