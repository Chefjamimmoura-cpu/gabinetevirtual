-- 035_proactive_engine.sql
-- Tables for ALIA Proactive Engine: notifications, log, preferences.

-- ── Notifications (dashboard alerts) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alia_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  recipient_id UUID,
  type TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('critica','alta','media','baixa','informativa')),
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_alia_notif_gabinete ON alia_notifications(gabinete_id);
CREATE INDEX idx_alia_notif_unread ON alia_notifications(gabinete_id, read) WHERE read = false;
CREATE INDEX idx_alia_notif_urgency ON alia_notifications(gabinete_id, urgency);

-- ── Proactive Log (anti-spam + audit) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alia_proactive_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_ref TEXT,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  consolidated_count INT DEFAULT 1,
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_proactive_log_gabinete ON alia_proactive_log(gabinete_id);
CREATE INDEX idx_proactive_log_cooldown ON alia_proactive_log(gabinete_id, event_type, event_ref, sent_at);

-- ── Notification Preferences (per assessor) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS alia_notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','dashboard','email')),
  quiet_start TIME,
  quiet_end TIME,
  max_daily INT DEFAULT 15,
  digest_time TIME DEFAULT '08:00',
  enabled BOOLEAN DEFAULT true,
  event_types_muted TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_notif_prefs_unique ON alia_notification_prefs(gabinete_id, profile_id, channel);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE alia_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE alia_proactive_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE alia_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on alia_notifications"
  ON alia_notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on alia_proactive_log"
  ON alia_proactive_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on alia_notification_prefs"
  ON alia_notification_prefs FOR ALL USING (true) WITH CHECK (true);
