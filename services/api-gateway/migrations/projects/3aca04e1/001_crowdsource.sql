-- Crowdsourced price collection tables
-- All prefixed with cs_ to avoid conflicts with scraper data

-- Products catalog (crowdsourced)
CREATE TABLE cs_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  aliases TEXT[] DEFAULT '{}',
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Contributors (phone for WhatsApp, session_id for web)
CREATE TABLE cs_contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE,
  session_id TEXT UNIQUE,
  total_reports INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Price reports
CREATE TABLE cs_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES cs_products(id) ON DELETE CASCADE,
  store TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  contributor_id UUID NOT NULL REFERENCES cs_contributors(id) ON DELETE CASCADE,
  reported_at TIMESTAMPTZ DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('whatsapp', 'web')),
  raw_message TEXT
);

-- Indexes
CREATE INDEX idx_cs_prices_product_reported ON cs_prices(product_id, reported_at DESC);
CREATE INDEX idx_cs_prices_store ON cs_prices(store);
CREATE INDEX idx_cs_products_name ON cs_products(name);

-- Auto-increment contributor report count on price insert
CREATE OR REPLACE FUNCTION cs_increment_report_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cs_contributors
  SET total_reports = total_reports + 1, updated_at = now()
  WHERE id = NEW.contributor_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cs_increment_reports
AFTER INSERT ON cs_prices
FOR EACH ROW
EXECUTE FUNCTION cs_increment_report_count();

-- Auto-update updated_at on cs_products
CREATE OR REPLACE FUNCTION cs_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cs_products_updated
BEFORE UPDATE ON cs_products
FOR EACH ROW
EXECUTE FUNCTION cs_update_timestamp();

-- RLS policies
ALTER TABLE cs_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE cs_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE cs_contributors ENABLE ROW LEVEL SECURITY;

-- Public read on products and prices
CREATE POLICY "Public read cs_products" ON cs_products FOR SELECT USING (true);
CREATE POLICY "Public read cs_prices" ON cs_prices FOR SELECT USING (true);

-- Service role full access
CREATE POLICY "Service full cs_products" ON cs_products FOR ALL USING (auth_role() = 'service_role');
CREATE POLICY "Service full cs_prices" ON cs_prices FOR ALL USING (auth_role() = 'service_role');
CREATE POLICY "Service full cs_contributors" ON cs_contributors FOR ALL USING (auth_role() = 'service_role');