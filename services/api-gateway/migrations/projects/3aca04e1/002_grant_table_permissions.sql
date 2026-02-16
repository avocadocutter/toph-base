-- Grant table-level permissions for crowdsourced price tables
-- RLS policies control row-level access, but base table grants are required first

-- Public read access (filtered by RLS policies)
GRANT SELECT ON cs_products, cs_prices TO anon, authenticated;

-- Authenticated users can insert/update/delete (filtered by RLS policies)
GRANT INSERT, UPDATE, DELETE ON cs_products, cs_prices, cs_contributors TO authenticated;

-- Service role full access
GRANT ALL ON cs_products, cs_prices, cs_contributors TO service_role;

-- Grant sequence usage for UUID generation and auto-increment
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
