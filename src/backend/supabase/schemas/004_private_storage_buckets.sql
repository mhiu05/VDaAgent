-- Provision private application buckets for both local resets and deployed migrations.
-- Object access remains governed by the storage.objects RLS policies in 001_inventory.sql.
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('source-imports', 'source-imports', false),
  ('report-exports', 'report-exports', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
