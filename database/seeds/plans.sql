-- Precios ficticios mensuales en USD para demostración técnica.
INSERT INTO plans (name, slug, description, speed_mbps, monthly_price)
VALUES
  ('Internet Esencial', 'internet-esencial', 'Plan de demostración para navegación y estudio en casa.', 200, 24.90),
  ('Internet Plus', 'internet-plus', 'Plan de demostración para streaming y varios dispositivos.', 400, 34.90),
  ('Internet Ultra', 'internet-ultra', 'Plan de demostración para hogares con mayor demanda de conexión.', 600, 44.90)
ON CONFLICT (slug) DO NOTHING;
