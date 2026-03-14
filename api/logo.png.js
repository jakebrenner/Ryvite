import { ImageResponse } from '@vercel/og';

export const config = {
  runtime: 'edge',
};

export default function handler(req) {
  const url = new URL(req.url);
  // Support ?variant=dark for dark-background emails (gold icon, white text)
  const variant = url.searchParams.get('variant') || 'light';
  const isDark = variant === 'dark';

  const iconStroke = isDark ? '#FFB74D' : '#E94560';
  const textColor = isDark ? '#FFFFFF' : '#1A1A2E';

  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: 'transparent',
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            },
            children: [
              // Circle envelope icon — using nested divs to approximate the SVG
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: `2.5px solid ${iconStroke}`,
                    position: 'relative',
                  },
                  children: {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0px',
                      },
                      children: [
                        // Envelope flap (V shape using borders)
                        {
                          type: 'div',
                          props: {
                            style: {
                              width: '0',
                              height: '0',
                              borderLeft: `9px solid transparent`,
                              borderRight: `9px solid transparent`,
                              borderTop: `8px solid ${iconStroke}`,
                              marginBottom: '1px',
                            },
                          },
                        },
                        // Envelope body (rectangle)
                        {
                          type: 'div',
                          props: {
                            style: {
                              width: '20px',
                              height: '2.5px',
                              backgroundColor: iconStroke,
                              borderRadius: '1px',
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
              // Wordmark
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'serif',
                    fontSize: '30px',
                    fontWeight: 700,
                    color: textColor,
                    letterSpacing: '-0.5px',
                    lineHeight: 1,
                  },
                  children: 'Ryvite',
                },
              },
            ],
          },
        },
      },
    },
    {
      width: 200,
      height: 56,
    }
  );
}
