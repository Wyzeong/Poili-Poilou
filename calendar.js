/* calendar.js — lecture seule du Google Agenda personnel (scope calendar.readonly).
   Connexion indépendante de celle du Drive (compte Google différent le plus souvent).
   Ne modifie jamais rien sur le Google Agenda — uniquement de la lecture. */

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

let calTokenClient = null;
let calAccessToken = null;
let calTokenExpiresAt = 0;

function requestCalendarToken(prompt) {
  return new Promise((resolve, reject) => {
    if (!driveReady()) { reject(new Error("Google indisponible (hors ligne ?)")); return; }
    calTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: CALENDAR_SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        calAccessToken = resp.access_token;
        calTokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
        resolve(calAccessToken);
      },
    });
    calTokenClient.requestAccessToken({ prompt });
  });
}

function calendarConnect() { return requestCalendarToken("consent"); }
function calendarSilentToken() { return requestCalendarToken(""); }

async function calendarGetToken() {
  if (calAccessToken && Date.now() < calTokenExpiresAt - 60000) return calAccessToken;
  return calendarSilentToken();
}

function calendarDisconnect() {
  if (calAccessToken && window.google?.accounts?.oauth2?.revoke) {
    google.accounts.oauth2.revoke(calAccessToken, () => {});
  }
  calAccessToken = null;
  calTokenExpiresAt = 0;
}

function parseCalendarEvent(ev) {
  const startDateTime = ev.start && ev.start.dateTime;
  const startDate = ev.start && ev.start.date;
  let date = null, time = null;
  if (startDateTime) {
    const d = new Date(startDateTime);
    date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } else if (startDate) {
    date = startDate;
  }
  return { date, time, title: ev.summary || "(Sans titre)" };
}

async function calendarFetchEvents(timeMinISO, timeMaxISO) {
  const token = await calendarGetToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}&singleEvents=true&orderBy=startTime&maxResults=250`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Erreur Google Agenda (${res.status}) ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  return (data.items || []).map(parseCalendarEvent).filter((e) => e.date);
}
