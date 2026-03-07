import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getUserSupabase(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function generateSlug(title) {
  const slug = (title || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${slug}-${suffix}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // Public actions (no auth required)
    if (action === 'getPublic') {
      const { slug, eventId } = req.query;

      let query = supabaseAdmin
        .from('events')
        .select('*')
        .eq('status', 'Published');

      if (slug) query = query.eq('slug', slug);
      else if (eventId) query = query.eq('id', eventId);
      else return res.status(400).json({ success: false, error: 'slug or eventId required' });

      const { data, error } = await query.single();

      if (error || !data) return res.status(404).json({ success: false, error: 'Event not found' });

      return res.status(200).json({ success: true, event: formatEvent(data) });
    }

    if (action === 'rsvp') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

      const { eventId, name, status, phone, inviteId, responseData } = req.body || {};

      if (!eventId || !name || !status) {
        return res.status(400).json({ success: false, error: 'eventId, name, and status are required' });
      }

      const { data, error } = await supabaseAdmin
        .from('rsvps')
        .insert({
          event_id: eventId,
          invite_id: inviteId || null,
          name,
          phone: phone || null,
          status,
          response_data: responseData || {}
        })
        .select()
        .single();

      if (error) return res.status(400).json({ success: false, error: error.message });

      return res.status(200).json({ success: true, rsvpId: data.id });
    }

    // Authenticated actions
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    const supabase = getUserSupabase(token);

    if (action === 'create') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

      const { title, description, eventDate, endDate, locationName, locationAddress, dressCode, eventType, prompt } = req.body || {};

      if (!title) return res.status(400).json({ success: false, error: 'Title is required' });

      const slug = generateSlug(title);

      const { data, error } = await supabase
        .from('events')
        .insert({
          user_id: user.id,
          title,
          description: description || null,
          event_date: eventDate || null,
          end_date: endDate || null,
          location_name: locationName || null,
          location_address: locationAddress || null,
          dress_code: dressCode || null,
          event_type: eventType || null,
          slug,
          status: 'Draft',
          prompt: prompt || null
        })
        .select()
        .single();

      if (error) return res.status(400).json({ success: false, error: error.message });

      return res.status(200).json({ success: true, eventId: data.id, slug: data.slug });
    }

    if (action === 'update') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

      const { eventId, ...updates } = req.body || {};

      if (!eventId) return res.status(400).json({ success: false, error: 'eventId is required' });

      // Map camelCase to snake_case
      const dbUpdates = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.eventDate !== undefined) dbUpdates.event_date = updates.eventDate;
      if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate;
      if (updates.locationName !== undefined) dbUpdates.location_name = updates.locationName;
      if (updates.locationAddress !== undefined) dbUpdates.location_address = updates.locationAddress;
      if (updates.dressCode !== undefined) dbUpdates.dress_code = updates.dressCode;
      if (updates.eventType !== undefined) dbUpdates.event_type = updates.eventType;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.prompt !== undefined) dbUpdates.prompt = updates.prompt;
      if (updates.themeHtml !== undefined) dbUpdates.theme_html = updates.themeHtml;
      if (updates.themeCss !== undefined) dbUpdates.theme_css = updates.themeCss;
      if (updates.themeConfig !== undefined) dbUpdates.theme_config = typeof updates.themeConfig === 'string' ? JSON.parse(updates.themeConfig) : updates.themeConfig;
      if (updates.zapierWebhook !== undefined) dbUpdates.zapier_webhook = updates.zapierWebhook;
      if (updates.customFields !== undefined) dbUpdates.custom_fields = typeof updates.customFields === 'string' ? JSON.parse(updates.customFields) : updates.customFields;

      const { data, error } = await supabase
        .from('events')
        .update(dbUpdates)
        .eq('id', eventId)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) return res.status(400).json({ success: false, error: error.message });

      return res.status(200).json({ success: true, event: formatEvent(data) });
    }

    if (action === 'list') {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return res.status(400).json({ success: false, error: error.message });

      return res.status(200).json({
        success: true,
        events: (data || []).map(formatEvent)
      });
    }

    if (action === 'get') {
      const { eventId } = req.query;
      if (!eventId) return res.status(400).json({ success: false, error: 'eventId required' });

      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .eq('user_id', user.id)
        .single();

      if (error || !data) return res.status(404).json({ success: false, error: 'Event not found' });

      return res.status(200).json({ success: true, event: formatEvent(data) });
    }

    if (action === 'rsvps') {
      const { eventId } = req.query;
      if (!eventId) return res.status(400).json({ success: false, error: 'eventId required' });

      // Verify ownership
      const { data: event } = await supabase
        .from('events')
        .select('id')
        .eq('id', eventId)
        .eq('user_id', user.id)
        .single();

      if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

      const { data, error } = await supabaseAdmin
        .from('rsvps')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) return res.status(400).json({ success: false, error: error.message });

      return res.status(200).json({ success: true, rsvps: data || [] });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Events API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function formatEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description || '',
    eventDate: row.event_date || '',
    endDate: row.end_date || '',
    locationName: row.location_name || '',
    locationAddress: row.location_address || '',
    dressCode: row.dress_code || '',
    eventType: row.event_type || '',
    slug: row.slug || '',
    status: row.status || 'Draft',
    prompt: row.prompt || '',
    themeHtml: row.theme_html || '',
    themeCss: row.theme_css || '',
    themeConfig: row.theme_config || {},
    zapierWebhook: row.zapier_webhook || '',
    customFields: row.custom_fields || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
