// Optional Google Calendar integration for internal case tracking.
// Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN and
// optionally GOOGLE_CALENDAR_ID (defaults to primary).

export function hasGoogleCalendarConfig(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

export async function addCaseDatesToGoogleCalendar(env, caseData, { now = new Date() } = {}) {
  if (!hasGoogleCalendarConfig(env)) return { ok: false, skipped: true, reason: 'not_configured' };

  const dates = collectFutureDates(caseData, now);
  if (!dates.length) return { ok: true, created: 0, dates: [] };

  const accessToken = await getAccessToken(env);
  const calendarId = env.GOOGLE_CALENDAR_ID || 'primary';
  const created = [];

  for (const item of dates) {
    const event = {
      summary: 'Court date — ' + (caseData.name || caseData.tracking_code || 'Traffic ticket case'),
      description: buildDescription(caseData),
      start: { date: item.date },
      end: { date: addOneDay(item.date) },
      extendedProperties: {
        private: {
          united_ticket_case: String(caseData.tracking_code || ''),
        },
      },
    };

    const url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Google Calendar HTTP ' + res.status + ': ' + JSON.stringify(payload).slice(0, 500));
    created.push({ date: item.date, event_id: payload.id || '', html_link: payload.htmlLink || '' });
  }

  return { ok: true, created: created.length, dates: created };
}

function collectFutureDates(caseData, now) {
  const candidates = [
    caseData.court_date,
    caseData.courtDate,
    caseData.appearance_date,
    caseData.appearanceDate,
    caseData.hearing_date,
    caseData.hearingDate,
    caseData.next_court_date,
    caseData.nextCourtDate,
    caseData.notes && caseData.notes.court_date,
    caseData.notes && caseData.notes.courtDate,
    caseData.notes && caseData.notes.appearance_date,
    caseData.notes && caseData.notes.appearanceDate,
    caseData.notes && caseData.notes.hearing_date,
    caseData.notes && caseData.notes.hearingDate,
  ];

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const seen = new Set();
  const out = [];

  for (const value of candidates) {
    const date = normalizeDate(value);
    if (!date || seen.has(date)) continue;
    const parsed = new Date(date + 'T00:00:00');
    if (parsed < today) continue;
    seen.add(date);
    out.push({ date });
  }
  return out;
}

function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validDate(m[1], m[2], m[3]);
  const us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
  if (us) return validDate(us[3], us[1], us[2]);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return validDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function validDate(y, m, d) {
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
  return [String(y).padStart(4, '0'), String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-');
}

function addOneDay(date) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function buildDescription(caseData) {
  return [
    'United Traffic Tickets Defense',
    'Case: ' + (caseData.tracking_code || '—'),
    'Client: ' + (caseData.name || '—'),
    'Court: ' + (caseData.court || '—'),
    'Citation: ' + (caseData.citation || '—'),
    'Please verify the court date against the source document before relying on this calendar entry.',
  ].join('\n');
}

async function getAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) throw new Error('Google OAuth token refresh failed');
  return payload.access_token;
}
