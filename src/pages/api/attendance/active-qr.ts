import type { APIRoute } from 'astro';
import { generateHourlyToken, generateQrSvg, getSecondsRemainingInHour } from '../../../lib/qr';

export const GET: APIRoute = async () => {
  const { token, expiresAt } = generateHourlyToken(0);
  const secondsRemaining = getSecondsRemainingInHour();
  const qrSvg = await generateQrSvg(token);

  return new Response(
    JSON.stringify({
      token,
      expiresAt: expiresAt.toISOString(),
      secondsRemaining,
      qrSvg,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
};
