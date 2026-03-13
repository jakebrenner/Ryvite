-- Contact Activity Log
-- Tracks all interactions and events related to a contact
-- Provides a full audit trail: invites sent, page views, RSVPs, updates, etc.

CREATE TABLE IF NOT EXISTS contact_activity_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Activity types:
-- 'invite_added'     - Contact was added as a guest to an event
-- 'invite_sent'      - Invitation was sent (SMS/email)
-- 'invite_viewed'    - Contact viewed the invite page
-- 'rsvp_submitted'   - Contact submitted their RSVP
-- 'rsvp_updated'     - Host or contact updated the RSVP
-- 'contact_created'  - Contact was first added to the address book
-- 'contact_updated'  - Contact info was modified
-- 'tag_added'        - A tag was assigned to the contact
-- 'tag_removed'      - A tag was removed from the contact

CREATE INDEX IF NOT EXISTS idx_contact_activity_contact_id ON contact_activity_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_activity_user_id ON contact_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_activity_event_id ON contact_activity_log(event_id);
CREATE INDEX IF NOT EXISTS idx_contact_activity_type ON contact_activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_contact_activity_created ON contact_activity_log(created_at DESC);

-- RLS: users can only see activity for their own contacts
ALTER TABLE contact_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own contact activity"
  ON contact_activity_log FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own contact activity"
  ON contact_activity_log FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Service role bypass for API inserts
CREATE POLICY "Service role full access to contact_activity_log"
  ON contact_activity_log FOR ALL
  USING (auth.role() = 'service_role');

-- View: Contact activity summary per event
CREATE OR REPLACE VIEW contact_event_timeline AS
SELECT
  cal.contact_id,
  cal.user_id,
  cal.event_id,
  e.title AS event_title,
  e.event_date,
  e.slug AS event_slug,
  array_agg(cal.activity_type ORDER BY cal.created_at) AS activities,
  min(cal.created_at) AS first_activity,
  max(cal.created_at) AS last_activity,
  count(*) AS activity_count
FROM contact_activity_log cal
LEFT JOIN events e ON cal.event_id = e.id
GROUP BY cal.contact_id, cal.user_id, cal.event_id, e.title, e.event_date, e.slug;
