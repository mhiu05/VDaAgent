BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);
INSERT INTO public.conversations(org_id,id,created_by,kind,title)
VALUES
  ('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','interactive','Alpha conversation'),
  ('10000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000004','interactive','Beta conversation');
INSERT INTO public.messages(org_id,id,conversation_id,run_id,payload)
VALUES
  ('10000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',NULL,'{"message_id":"91000000-0000-4000-8000-000000000001","org_id":"10000000-0000-4000-8000-000000000001","conversation_id":"90000000-0000-4000-8000-000000000001","run_id":null,"role":"user","content":"alpha","created_at":"2026-09-20T00:00:00.000Z"}'),
  ('10000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002',NULL,'{"message_id":"91000000-0000-4000-8000-000000000002","org_id":"10000000-0000-4000-8000-000000000002","conversation_id":"90000000-0000-4000-8000-000000000002","run_id":null,"role":"user","content":"beta","created_at":"2026-09-20T00:00:00.000Z"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
SELECT is((SELECT count(*)::integer FROM public.organizations),1,'viewer sees exactly own workspace');
SELECT is((SELECT count(*)::integer FROM public.snapshots WHERE org_id='10000000-0000-4000-8000-000000000002'),0,'cross-workspace snapshots denied');
SELECT is((SELECT count(*)::integer FROM public.imports WHERE org_id='10000000-0000-4000-8000-000000000002'),0,'cross-workspace source manifests denied');
SELECT is((SELECT count(*)::integer FROM public.conversations WHERE org_id='10000000-0000-4000-8000-000000000002'),0,'cross-workspace conversations denied');
SELECT is((SELECT count(*)::integer FROM public.messages WHERE org_id='10000000-0000-4000-8000-000000000002'),0,'cross-workspace messages denied');
SELECT throws_ok($$INSERT INTO public.organizations(org_id,name) VALUES('10000000-0000-4000-8000-000000000003','forged')$$,'42501',NULL,'viewer cannot mutate organization');
SELECT throws_ok($$UPDATE public.organization_members SET role='owner'$$,'42501',NULL,'viewer cannot escalate membership');
SELECT throws_ok($$INSERT INTO public.imports(org_id,id,file_hash,payload) VALUES('10000000-0000-4000-8000-000000000002','forged','hash','{}')$$,'42501',NULL,'forged org import denied');
SELECT throws_ok($$INSERT INTO public.conversations(org_id,id,created_by,kind,title) VALUES('10000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','interactive','forged')$$,'42501',NULL,'forged conversation denied');
SELECT throws_ok($$INSERT INTO public.messages(org_id,id,conversation_id,run_id,payload) VALUES('10000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002',NULL,'{}')$$,'42501',NULL,'forged message denied');
SELECT is((SELECT count(*)::integer FROM public.artifacts WHERE org_id='10000000-0000-4000-8000-000000000002'),0,'artifact leakage denied');
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='source-imports' AND name LIKE '10000000-0000-4000-8000-000000000002/%'),0,'private storage path denied');
RESET ROLE;
DELETE FROM organization_members WHERE user_id='20000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.snapshots),0,'revoked member loses snapshots');
SELECT is((SELECT count(*)::integer FROM public.imports),0,'revoked member loses source manifests');
SELECT * FROM finish();
ROLLBACK;
