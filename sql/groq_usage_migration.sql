-- Tabulka pro rate limiting sdíleného Groq klíče
CREATE TABLE IF NOT EXISTS groq_usage (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date NOT NULL DEFAULT CURRENT_DATE,
  search_count int  NOT NULL DEFAULT 0,
  fake_count   int  NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, date)
);

-- Index pro rychlé dotazy
CREATE INDEX IF NOT EXISTS groq_usage_user_date ON groq_usage (user_id, date);

-- RLS: každý vidí jen svá data, server píše přes anon key (service role)
ALTER TABLE groq_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own usage" ON groq_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user inserts own usage" ON groq_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user updates own usage" ON groq_usage
  FOR UPDATE USING (auth.uid() = user_id);
