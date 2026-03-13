import { ImageResponse } from '@vercel/og';

export const config = {
  runtime: 'edge',
};

export default function handler(req) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get('title') || 'Ryvite';
  const subtitle = searchParams.get('subtitle') || 'AI-Powered Custom Invitations';
  const type = searchParams.get('type') || 'default';

  // Different accent colors by page type
  const accents = {
    default: { primary: '#E94560', secondary: '#FF6B6B' },
    birthday: { primary: '#FF6B6B', secondary: '#FFB74D' },
    'baby-shower': { primary: '#A78BFA', secondary: '#FF6B6B' },
    wedding: { primary: '#FFB74D', secondary: '#E94560' },
    graduation: { primary: '#4ECDC4', secondary: '#FFB74D' },
    holiday: { primary: '#E94560', secondary: '#4ECDC4' },
    corporate: { primary: '#1A1A2E', secondary: '#FFB74D' },
    blog: { primary: '#E94560', secondary: '#A78BFA' },
    pricing: { primary: '#4ECDC4', secondary: '#E94560' },
  };

  const accent = accents[type] || accents.default;

  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1A1A2E 0%, #0f3460 100%)',
          fontFamily: 'sans-serif',
          padding: '60px',
        },
        children: [
          // Logo circle
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px',
              },
              children: {
                type: 'svg',
                props: {
                  viewBox: '0 0 120 120',
                  width: '80',
                  height: '80',
                  xmlns: 'http://www.w3.org/2000/svg',
                  children: [
                    { type: 'circle', props: { cx: '60', cy: '60', r: '40', fill: 'none', stroke: '#FFB74D', strokeWidth: '2.5' } },
                    { type: 'path', props: { d: 'M35 45 L60 62 L85 45', fill: 'none', stroke: '#FFB74D', strokeWidth: '2.5', strokeLinecap: 'round', strokeLinejoin: 'round' } },
                    { type: 'path', props: { d: 'M35 75 L85 75', fill: 'none', stroke: '#FFB74D', strokeWidth: '2', strokeLinecap: 'round' } },
                    { type: 'circle', props: { cx: '60', cy: '30', r: '6', fill: accent.primary, opacity: '0.85' } },
                    { type: 'circle', props: { cx: '48', cy: '34', r: '4', fill: accent.secondary, opacity: '0.6' } },
                    { type: 'circle', props: { cx: '72', cy: '33', r: '4', fill: '#FFB74D', opacity: '0.6' } },
                  ],
                },
              },
            },
          },
          // Title
          {
            type: 'div',
            props: {
              style: {
                fontSize: '52px',
                fontWeight: '700',
                color: 'white',
                textAlign: 'center',
                lineHeight: '1.2',
                marginBottom: '16px',
                maxWidth: '900px',
              },
              children: title,
            },
          },
          // Subtitle
          {
            type: 'div',
            props: {
              style: {
                fontSize: '24px',
                color: accent.primary,
                fontWeight: '600',
                textAlign: 'center',
                maxWidth: '700px',
              },
              children: subtitle,
            },
          },
          // Bottom bar — Ryvite branding
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute',
                bottom: '40px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontSize: '20px', color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
                    children: 'ryvite.com',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    { width: 1200, height: 630 }
  );
}
