import crypto from 'node:crypto';
import QRCode from 'qrcode';

const QR_SECRET = process.env.QR_SECRET || 'fermi-super-secure-attendance-salt-2026';

/**
 * Returns time slice strings for current and past hours.
 */
function getTimeSlice(offsetHours = 0): { dateStr: string; hourStr: string; key: string } {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const hh = get('hour') === '24' ? '00' : get('hour');
  const hourStr = hh;
  const key = `${dateStr}-${hourStr}`;
  return { dateStr, hourStr, key };
}

/**
 * Generates an hourly unique token for attendance.
 * Format: FERMI-<YYYYMMDD>-<HH>-<6-char-hash>
 */
export function generateHourlyToken(offsetHours = 0): { token: string; key: string; expiresAt: Date } {
  const { dateStr, hourStr, key } = getTimeSlice(offsetHours);
  const hash = crypto
    .createHmac('sha256', QR_SECRET)
    .update(`ATTENDANCE:${key}`)
    .digest('hex')
    .substring(0, 6)
    .toUpperCase();

  const token = `FERMI-${dateStr.replace(/-/g, '')}-${hourStr}-${hash}`;
  
  // Next hour expiration
  const now = new Date();
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);

  return { token, key, expiresAt: nextHour };
}

/**
 * Validates a submitted attendance token.
 * Validates against current hour token or previous hour token (5-minute grace window).
 */
export function validateAttendanceToken(scannedToken: string): boolean {
  if (!scannedToken || typeof scannedToken !== 'string') return false;
  const clean = scannedToken.trim();

  // Current hour token
  const current = generateHourlyToken(0);
  if (clean === current.token) return true;

  // Grace period: check previous hour if within first 5 minutes of current hour
  const minutes = new Date().getMinutes();
  if (minutes < 5) {
    const prev = generateHourlyToken(-1);
    if (clean === prev.token) return true;
  }

  return false;
}

/**
 * Generates SVG QR Code markup for display on kiosk / landing page.
 */
export async function generateQrSvg(token: string): Promise<string> {
  return await QRCode.toString(token, {
    type: 'svg',
    margin: 1,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
    width: 280,
  });
}

/**
 * Computes seconds remaining until the next hourly QR rotation.
 */
export function getSecondsRemainingInHour(): number {
  const now = new Date();
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  return Math.max(0, Math.floor((nextHour.getTime() - now.getTime()) / 1000));
}
