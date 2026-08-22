/* drive.js — sauvegarde automatique vers un fichier dédié sur Google Drive (scope drive.file).
   L'accès est limité au seul fichier créé par cette appli — jamais au reste du Drive.
   Toute la logique tolère l'absence de réseau ou de connexion Google : elle échoue
   proprement (avec un message clair) sans jamais bloquer le reste de l'appli. */

const GOOGLE_CLIENT_ID = "972049745058-g02ar6p9se61funaqlafsl10sm5bgg48.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_BACKUP_PREFIX = "thi-gestion-rdv-sauvegarde";
const DRIVE_BACKUP_MAX_AGE_DAYS = 30;

let driveTokenClient = null;
let driveAccessToken = null;
let driveTokenExpiresAt = 0;

function driveReady() {
  return !!(window.google && window.google.accounts && window.google.accounts.oauth2);
}

function initDriveTokenClient(callback) {
  driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback,
  });
  return driveTokenClient;
}

function requestDriveToken(prompt) {
  return new Promise((resolve, reject) => {
    if (!driveReady()) { reject(new Error("Google indisponible (hors ligne ?)")); return; }
    const client = initDriveTokenClient((resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      driveAccessToken = resp.access_token;
      driveTokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
      resolve(driveAccessToken);
    });
    client.requestAccessToken({ prompt });
  });
}

// Avec fenêtre de connexion Google — utilisée par le bouton "Connecter".
function driveConnect() { return requestDriveToken("consent"); }

// Sans fenêtre — utilisée pour le renouvellement automatique tant que l'accès est valide.
function driveSilentToken() { return requestDriveToken(""); }

async function driveGetToken() {
  if (driveAccessToken && Date.now() < driveTokenExpiresAt - 60000) return driveAccessToken;
  return driveSilentToken();
}

function driveDisconnect() {
  if (driveAccessToken && window.google?.accounts?.oauth2?.revoke) {
    google.accounts.oauth2.revoke(driveAccessToken, () => {});
  }
  driveAccessToken = null;
  driveTokenExpiresAt = 0;
}

function driveBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${DRIVE_BACKUP_PREFIX}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}h${pad(date.getMinutes())}.json`;
}

// Crée toujours un NOUVEAU fichier daté (jamais d'écrasement), pour permettre de choisir
// parmi plusieurs sauvegardes à l'import.
async function driveUploadBackup(jsonString) {
  const token = await driveGetToken();
  const metadata = { name: driveBackupFilename(), mimeType: "application/json" };
  const boundary = "thi-backup-boundary";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonString}\r\n--${boundary}--`;

  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Erreur Drive (${res.status}) ${text.slice(0, 150)}`);
  }
  return res.json();
}

// Liste toutes les sauvegardes disponibles sur le Drive connecté, les plus récentes d'abord.
async function driveListBackups() {
  const token = await driveGetToken();
  const q = encodeURIComponent(`name contains '${DRIVE_BACKUP_PREFIX}' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=name desc&pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Erreur Drive (${res.status})`);
  const data = await res.json();
  return data.files || [];
}

async function driveDownloadBackupById(fileId) {
  const token = await driveGetToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Erreur Drive (${res.status})`);
  return res.text();
}

// Supprime les sauvegardes de plus de 30 jours. Appelée après chaque export réussi.
// Une éventuelle erreur ici n'invalide jamais la sauvegarde qui vient d'être faite.
async function driveCleanupOldBackups(maxAgeDays = DRIVE_BACKUP_MAX_AGE_DAYS) {
  const token = await driveGetToken();
  const files = await driveListBackups();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const toDelete = files.filter((f) => new Date(f.createdTime).getTime() < cutoff);
  for (const f of toDelete) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  return toDelete.length;
}
