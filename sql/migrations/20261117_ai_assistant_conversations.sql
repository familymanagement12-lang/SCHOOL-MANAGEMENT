BEGIN;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('general', 'school_data')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id, user_id)
);

CREATE INDEX IF NOT EXISTS ai_conversations_owner_updated_idx
  ON ai_conversations (school_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL,
  school_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) <= 30000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (conversation_id, school_id, user_id)
    REFERENCES ai_conversations (id, school_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
  ON ai_messages (conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('general', 'school_data', 'generation')),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd NUMERIC(12, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_school_date_idx
  ON ai_usage_events (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_date_idx
  ON ai_usage_events (school_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_request_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_request_events_user_date_idx
  ON ai_request_events (school_id, user_id, created_at DESC);

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_conversations_owner_scope ON ai_conversations;
CREATE POLICY ai_conversations_owner_scope ON ai_conversations
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  );

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_messages_owner_scope ON ai_messages;
CREATE POLICY ai_messages_owner_scope ON ai_messages
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  );

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_owner_or_admin_scope ON ai_usage_events;
CREATE POLICY ai_usage_owner_or_admin_scope ON ai_usage_events
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND (
      user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
      OR current_setting('app.role', TRUE) = 'admin'
    )
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  );

ALTER TABLE ai_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_request_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_request_events_owner_scope ON ai_request_events;
CREATE POLICY ai_request_events_owner_scope ON ai_request_events
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  );

DO $$
DECLARE
  grantee TEXT;
BEGIN
  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.users', 'SELECT')
      AND rolname <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_conversations, ai_messages TO %I', grantee);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ai_usage_events TO %I', grantee);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON TABLE ai_request_events TO %I', grantee);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE ai_messages_id_seq, ai_usage_events_id_seq, ai_request_events_id_seq TO %I', grantee);
  END LOOP;
END $$;

COMMIT;
