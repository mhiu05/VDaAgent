-- Telegram is an entrypoint and delivery channel, not a second conversation store.
-- Only the server-side repository can read or write this private outbox.
CREATE TABLE public.external_channel_deliveries (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel = 'telegram'),
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 100),
  chat_id TEXT NOT NULL CHECK (length(chat_id) BETWEEN 1 AND 100),
  external_user_id TEXT NOT NULL CHECK (length(external_user_id) BETWEEN 1 AND 100),
  created_by TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  UNIQUE (channel,event_key),
  FOREIGN KEY (org_id,conversation_id) REFERENCES public.conversations(org_id,id),
  FOREIGN KEY (org_id,assistant_message_id) REFERENCES public.messages(org_id,id)
);
CREATE INDEX external_channel_deliveries_due
  ON public.external_channel_deliveries(next_attempt_at,created_at,id)
  WHERE status IN ('pending','sending');
ALTER TABLE public.external_channel_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_channel_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.external_channel_deliveries TO service_role;
