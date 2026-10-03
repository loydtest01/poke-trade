-- ═══════════════════════════════════════════════════════════════
--  PokéTrade – Chat systém (OPRAVENÁ VERZE)
--  Spusť v Supabase → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- ── 1. KONVERZACE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user2_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user1_username   TEXT NOT NULL,
  user2_username   TEXT NOT NULL,
  user1_avatar_url TEXT,
  user2_avatar_url TEXT,
  last_message_text TEXT,
  last_sender_id   UUID,
  unread_user1     INT DEFAULT 0,
  unread_user2     INT DEFAULT 0,
  last_message_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT conversations_unique_pair UNIQUE(user1_id, user2_id),
  CONSTRAINT conversations_different_users CHECK(user1_id <> user2_id)
);

CREATE INDEX IF NOT EXISTS conversations_user1_idx ON conversations(user1_id);
CREATE INDEX IF NOT EXISTS conversations_user2_idx ON conversations(user2_id);
CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON conversations(last_message_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Konverzace vidí jen účastníci" ON conversations
  FOR SELECT USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Účastník může vytvořit konverzaci" ON conversations
  FOR INSERT WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Účastník může aktualizovat konverzaci" ON conversations
  FOR UPDATE USING (auth.uid() = user1_id OR auth.uid() = user2_id);


-- ── 2. CHATOVÉ ZPRÁVY ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_username  TEXT NOT NULL,
  text             TEXT NOT NULL,
  listing_refs     JSONB DEFAULT '[]',
  is_read          BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_sender_idx ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS chat_messages_unread_idx ON chat_messages(conversation_id, is_read) WHERE NOT is_read;

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat zprávy vidí účastníci" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = chat_messages.conversation_id
        AND (auth.uid() = c.user1_id OR auth.uid() = c.user2_id)
    )
  );

CREATE POLICY "Odesílatel může poslat zprávu" ON chat_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Příjemce může označit zprávu jako přečtenou" ON chat_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = chat_messages.conversation_id
        AND (auth.uid() = c.user1_id OR auth.uid() = c.user2_id)
    )
  );


-- ── 3. FUNKCE: Najdi nebo vytvoř konverzaci ─────────────────
CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_user_a UUID,
  p_user_b UUID,
  p_username_a TEXT,
  p_username_b TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user1  UUID;
  v_user2  UUID;
  v_uname1 TEXT;
  v_uname2 TEXT;
  v_conv_id UUID;
BEGIN
  IF p_user_a < p_user_b THEN
    v_user1 := p_user_a;  v_user2 := p_user_b;
    v_uname1 := p_username_a; v_uname2 := p_username_b;
  ELSE
    v_user1 := p_user_b;  v_user2 := p_user_a;
    v_uname1 := p_username_b; v_uname2 := p_username_a;
  END IF;

  SELECT id INTO v_conv_id
    FROM conversations
   WHERE user1_id = v_user1 AND user2_id = v_user2;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  INSERT INTO conversations (user1_id, user2_id, user1_username, user2_username)
  VALUES (v_user1, v_user2, v_uname1, v_uname2)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;


-- ── 4. TRIGGER: Aktualizovat konverzaci po nové zprávě ──────
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_u1 UUID;
  v_u2 UUID;
  v_unread1 INT;
  v_unread2 INT;
BEGIN
  SELECT user1_id, user2_id, unread_user1, unread_user2
    INTO v_u1, v_u2, v_unread1, v_unread2
    FROM conversations
   WHERE id = NEW.conversation_id;

  UPDATE conversations SET
    last_message_text = LEFT(NEW.text, 100),
    last_sender_id    = NEW.sender_id,
    last_message_at   = NEW.created_at,
    unread_user1 = CASE
      WHEN NEW.sender_id = v_u2 THEN v_unread1 + 1
      ELSE v_unread1
    END,
    unread_user2 = CASE
      WHEN NEW.sender_id = v_u1 THEN v_unread2 + 1
      ELSE v_unread2
    END
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_message_insert ON chat_messages;
CREATE TRIGGER on_chat_message_insert
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();


-- ── 5. FUNKCE: Označit zprávy jako přečtené ─────────────────
CREATE OR REPLACE FUNCTION mark_conversation_read(
  p_conversation_id UUID,
  p_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_u1 UUID;
  v_u2 UUID;
BEGIN
  SELECT user1_id, user2_id
    INTO v_u1, v_u2
    FROM conversations
   WHERE id = p_conversation_id;

  UPDATE chat_messages
     SET is_read = true
   WHERE conversation_id = p_conversation_id
     AND sender_id <> p_user_id
     AND is_read = false;

  IF p_user_id = v_u1 THEN
    UPDATE conversations SET unread_user1 = 0 WHERE id = p_conversation_id;
  ELSIF p_user_id = v_u2 THEN
    UPDATE conversations SET unread_user2 = 0 WHERE id = p_conversation_id;
  END IF;
END;
$$;


-- ── 6. FUNKCE: Celkový počet nepřečtených ───────────────────
CREATE OR REPLACE FUNCTION get_total_unread(p_user_id UUID)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT SUM(
      CASE WHEN user1_id = p_user_id THEN unread_user1
           WHEN user2_id = p_user_id THEN unread_user2
           ELSE 0 END
    ) FROM conversations
    WHERE user1_id = p_user_id OR user2_id = p_user_id),
  0)::INT;
$$;


-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO! Chat systém je připraven.
-- ═══════════════════════════════════════════════════════════════
