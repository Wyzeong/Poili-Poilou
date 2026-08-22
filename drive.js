/* drive.js — sauvegarde automatique vers un fichier dédié sur Google Drive (scope drive.file).
   L'accès est limité au seul fichier créé par cette appli — jamais au reste du Drive.
   Toute la logique tolère l'absence de réseau ou de connexion Google : elle échoue
   proprement (avec un message clair) sans jamais bloquer le reste de l'appli. */

const GOOGLE_CLIENT_ID = "972049745058-g02ar6p9se61funaqlafsl10sm5bgg48.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_BACKUP_FILENAME = "thi-gestion-rdv-sauvegarde.json";

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

async function driveUploadBackup(jsonString) {
  const token = await driveGetToken();
  const fileId = await DB.getParam("driveBackupFileId", null);
  const metadata = { name: DRIVE_BACKUP_FILENAME, mimeType: "application/json" };
  const boundary = "thi-backup-boundary";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonString}\r\n--${boundary}--`;

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const res = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    if (res.status === 404 && fileId) {
      // Le fichier a été supprimé côté Drive : on oublie l'ID et on réessaiera une création propre la prochaine fois.
      await DB.setParam("driveBackupFileId", null);
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Erreur Drive (${res.status}) ${text.slice(0, 150)}`);
  }
  const data = await res.json();
  if (!fileId && data.id) await DB.setParam("driveBackupFileId", data.id);
  return data;
}
