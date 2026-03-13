import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STATIC_PAGES = [
  { url: '/', priority: '1.0', changefreq: 'weekly' },
  { url: '/birthday-invitations/', priority: '0.8', changefreq: 'monthly' },
  { url: '/baby-shower-invitations/', priority: '0.8', changefreq: 'monthly' },
  { url: '/wedding-invitations/', priority: '0.8', changefreq: 'monthly' },
  { url: '/graduation-invitations/', priority: '0.8', changefreq: 'monthly' },
  { url: '/holiday-party-invitations/', priority: '0.8', changefreq: 'monthly' },
  { url: '/corporate-event-invitations/', priority: '0.8', changefreq: 'monthly' },
  { url: '/pricing/', priority: '0.7', changefreq: 'monthly' },
  { url: '/faq/', priority: '0.6', changefreq: 'monthly' },
  { url: '/examples/', priority: '0.7', changefreq: 'weekly' },
  { url: '/blog/', priority: '0.7', changefreq: 'weekly' },
  { url: '/inspiration', priority: '0.6', changefreq: 'weekly' },
  { url: '/privacy/', priority: '0.3', changefreq: 'yearly' },
  { url: '/terms/', priority: '0.3', changefreq: 'yearly' },
];

const BASE_URL = 'https://www.ryvite.com';

function escapeXml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];

  // Fetch published blog posts from Supabase
  let blogPosts = [];
  try {
    const { data } = await supabaseAdmin
      .from('blog_posts')
      .select('slug, updated_at, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false });
    if (data) blogPosts = data;
  } catch (e) {
    // Continue without blog posts if DB query fails
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Static pages
  for (const page of STATIC_PAGES) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(BASE_URL + page.url)}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += '  </url>\n';
  }

  // Blog posts
  for (const post of blogPosts) {
    const lastmod = (post.updated_at || post.published_at || today).split('T')[0];
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(BASE_URL + '/blog/' + post.slug + '/')}</loc>\n`;
    xml += `    <lastmod>${lastmod}</lastmod>\n`;
    xml += `    <changefreq>monthly</changefreq>\n`;
    xml += `    <priority>0.7</priority>\n`;
    xml += '  </url>\n';
  }

  xml += '</urlset>';

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res.status(200).send(xml);
}
