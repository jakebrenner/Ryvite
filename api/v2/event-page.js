import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return ''; }
}

export default async function handler(req, res) {
  // Extract slug from the URL path: /v2/event/:slug
  const slug = req.query.slug;
  if (!slug) {
    return res.status(400).send('Event not found');
  }

  // Read the static HTML template
  let html;
  try {
    html = readFileSync(join(process.cwd(), 'v2', 'event', 'index.html'), 'utf-8');
  } catch {
    return res.status(500).send('Error loading page');
  }

  // Fetch event data for OG tags
  try {
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('title, description, event_date, end_date, location_name, location_address, event_type, slug, status')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (event) {
      const title = escapeHtml(event.title);
      const dateStr = formatDate(event.event_date);
      const location = escapeHtml(event.location_name || '');
      const address = escapeHtml(event.location_address || '');
      const locationFull = [location, address].filter(Boolean).join(', ');

      // Build a rich description
      const descParts = [];
      if (dateStr) descParts.push(dateStr);
      if (locationFull) descParts.push(locationFull);
      if (event.description) descParts.push(event.description);
      const description = escapeHtml(
        descParts.length > 0 ? descParts.join(' | ') : "You're invited! RSVP on Ryvite."
      );

      const eventUrl = `https://www.ryvite.com/v2/event/${encodeURIComponent(event.slug)}`;

      // OG meta tags to inject
      const ogTags = `
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title} — Ryvite">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${eventUrl}">
  <meta property="og:site_name" content="Ryvite">
  <meta property="og:image" content="https://www.ryvite.com/og-default.png">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title} — Ryvite">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="https://www.ryvite.com/og-default.png">`;

      // Replace the static title and description, inject OG tags
      html = html.replace(
        '<title>Event Invite — Ryvite</title>',
        `<title>${title} — Ryvite</title>`
      );
      html = html.replace(
        '<meta name="description" content="You\'re invited! RSVP to this event on Ryvite.">',
        `<meta name="description" content="${description}">${ogTags}`
      );
    }
  } catch (e) {
    // If DB fetch fails, serve the page with default meta tags — the client-side JS will handle the rest
    console.error('OG tag fetch failed:', e.message);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return res.status(200).send(html);
}
