BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);
INSERT INTO public.conversations(org_id,id,created_by,kind,title)
VALUES
  ('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','interactive','Alpha conversation'),
  ('10000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000004','interactive','Beta conversation');
INSERT INTO public.messages(org_id,id,conversation_id,run_id,payload)
VALUES
  ('10000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',NULL,'{"message_id":"91000000-0000-4000-8000-000000000001","org_id":"10000000-0000-4000-8000-000000000001","conversation_id":"90000000-0000-4000-8000-000000000001","run_id":null,"role":"user","content":"alpha","created_at":"2026-09-20T00:00:00.000Z"}'),
  ('10000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002',NULL,'{"message_id":"91000000-0000-4000-8000-000000000002","org_id":"10000000-0000-4000-8000-000000000002","conversation_id":"90000000-0000-4000-8000-000000000002","run_id":null,"role":"user","content":"beta","created_at":"2026-09-20T00:00:00.000Z"}');
INSERT INTO public.runs(org_id,id,created_by,idempotency_key,request_hash,status,created_at,payload)
VALUES
  ('10000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','tenant-rls-alpha','test-hash-alpha','completed',now(),'{"org_id":"10000000-0000-4000-8000-000000000001","run_id":"92000000-0000-4000-8000-000000000001","created_by":"20000000-0000-4000-8000-000000000001"}'),
  ('10000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000004','tenant-rls-beta','test-hash-beta','completed',now(),'{"org_id":"10000000-0000-4000-8000-000000000002","run_id":"92000000-0000-4000-8000-000000000002","created_by":"20000000-0000-4000-8000-000000000004"}');
INSERT INTO public.tasks(org_id,id,run_id,payload)
VALUES
  ('10000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','{}'),
  ('10000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','{}');
INSERT INTO public.artifacts(org_id,id,run_id,task_id,kind,artifact_key,payload)
VALUES
  ('10000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','calculation','calculation','{"org_id":"10000000-0000-4000-8000-000000000001","artifact_id":"94000000-0000-4000-8000-000000000001","run_id":"92000000-0000-4000-8000-000000000001","task_id":"93000000-0000-4000-8000-000000000001","content_hash":"0000000000000000000000000000000000000000000000000000000000000000"}'),
  ('10000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002','data_analysis_pack','data_analysis_pack','{"org_id":"10000000-0000-4000-8000-000000000002","artifact_id":"94000000-0000-4000-8000-000000000002","run_id":"92000000-0000-4000-8000-000000000002","task_id":"93000000-0000-4000-8000-000000000002","content_hash":"0000000000000000000000000000000000000000000000000000000000000000"}');
INSERT INTO public.artifacts(org_id,id,run_id,task_id,kind,artifact_key,payload)
VALUES
  ('10000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','report_draft','report_draft:1','{}'),
  ('10000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','review_result','review_result:1','{}');
INSERT INTO public.messages(org_id,id,conversation_id,run_id,payload,role,status,sender_agent)
VALUES
  ('10000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','{"message_id":"91000000-0000-4000-8000-000000000003","org_id":"10000000-0000-4000-8000-000000000001","conversation_id":"90000000-0000-4000-8000-000000000001","run_id":"92000000-0000-4000-8000-000000000001","role":"assistant","content":"data complete","created_at":"2026-09-20T00:00:00.000Z"}','assistant','completed','data');
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
SELECT is((SELECT count(*)::integer FROM public.artifacts WHERE org_id='10000000-0000-4000-8000-000000000002' AND artifact_key='data_analysis_pack'),0,'cross-workspace keyed artifact read denied');
SELECT is((SELECT count(*)::integer FROM public.artifacts WHERE org_id='10000000-0000-4000-8000-000000000001' AND kind='report_draft'),0,'viewer cannot read agent report draft');
SELECT is((SELECT count(*)::integer FROM public.artifacts WHERE org_id='10000000-0000-4000-8000-000000000001' AND kind='review_result'),0,'viewer cannot read reviewer result');
SELECT throws_ok($$UPDATE public.artifacts SET artifact_key='tampered' WHERE org_id='10000000-0000-4000-8000-000000000001' AND id='94000000-0000-4000-8000-000000000001'$$,'42501',NULL,'viewer cannot update artifact key');
SELECT throws_ok($$UPDATE public.messages SET sender_agent='reviewer' WHERE org_id='10000000-0000-4000-8000-000000000001' AND id='91000000-0000-4000-8000-000000000003'$$,'42501',NULL,'viewer cannot update sender agent');
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='source-imports' AND name LIKE '10000000-0000-4000-8000-000000000002/%'),0,'private storage path denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
SELECT is((SELECT count(*)::integer FROM public.artifacts WHERE org_id='10000000-0000-4000-8000-000000000001' AND kind IN ('report_draft','review_result')),2,'owner can read agent report draft and reviewer result');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
SELECT is((SELECT count(*)::integer FROM public.artifacts WHERE org_id='10000000-0000-4000-8000-000000000001' AND kind IN ('report_draft','review_result')),2,'analyst can read agent report draft and reviewer result');
RESET ROLE;
DELETE FROM organization_members WHERE user_id='20000000-0000-4000-8000-000000000003';
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.snapshots),0,'revoked member loses snapshots');
SELECT is((SELECT count(*)::integer FROM public.imports),0,'revoked member loses source manifests');
SELECT * FROM finish();
ROLLBACK;
