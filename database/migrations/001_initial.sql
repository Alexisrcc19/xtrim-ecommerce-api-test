CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  slug VARCHAR(120) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  speed_mbps INTEGER NOT NULL CHECK (speed_mbps > 0),
  monthly_price NUMERIC(10,2) NOT NULL CHECK (monthly_price >= 0 AND monthly_price <> 'NaN'::numeric),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(150) NOT NULL CHECK (length(btrim(full_name)) >= 2),
  phone VARCHAR(13) NOT NULL CHECK (phone ~ '^(0[2-7][0-9]{7}|09[0-9]{8}|[+]593[2-7][0-9]{7}|[+]5939[0-9]{8})$'),
  province VARCHAR(100) NOT NULL CHECK (length(btrim(province)) > 0),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_PROGRESS', 'CLOSED')),
  outcome VARCHAR(4) CHECK (outcome IN ('WON', 'LOST')),
  sale_amount NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_closure_consistency CHECK (
    (status <> 'CLOSED' AND outcome IS NULL AND sale_amount IS NULL)
    OR (status = 'CLOSED' AND outcome IS NOT NULL AND (
      (outcome = 'LOST' AND sale_amount IS NULL)
      OR (outcome = 'WON' AND sale_amount IS NOT NULL AND sale_amount >= 0 AND sale_amount <> 'NaN'::numeric)
    ))
  )
);
CREATE INDEX leads_plan_id_idx ON leads(plan_id);
CREATE INDEX leads_status_created_at_idx ON leads(status, created_at DESC);

CREATE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
