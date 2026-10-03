-- ══════════════════════════════════════════════════════════════
-- fix_message_notifications.sql
-- Zprávy přestanou jít do notif-bell.
-- Spusť v Supabase → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════

-- 1. Přidej sloupec type do notifications (pokud chybí)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'system';

-- 2. Označ existující message notifikace (zprávy vložené triggerem)
UPDATE notifications
SET type = 'message'
WHERE type = 'system'
  AND title LIKE '% ti napsal/a';

-- 3. Smaž všechny message notifikace (vyčisti historii)
DELETE FROM notifications WHERE type = 'message';

-- 4. Odstraň trigger – zprávy už notifications nepotřebují,
--    unread badge jde přes conversations tabulku (marketplace-chat.js)
DROP TRIGGER IF EXISTS trg_notify_on_new_message ON messages;
DROP TRIGGER IF EXISTS trg_notify_on_new_message ON chat_messages;

-- Ověření – mělo by vrátit 0 řádků:
-- SELECT * FROM notifications WHERE type = 'message';
-- Ověření – triggery jsou pryč:
-- SELECT trigger_name, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_name = 'trg_notify_on_new_message';
