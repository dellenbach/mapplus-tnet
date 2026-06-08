<?php
/**
 * admin-users.php
 * Benutzerverwaltung fuer TNET Admin-Bereich.
 * Nur fuer Benutzer mit is_admin=true (bzw. administrator) zugaenglich.
 *
 * API-Modus (Accept: application/json oder GET ?action=...):
 *   GET  ?action=list            → Benutzerliste
 *   POST ?action=reset-password  → Passwort-Reset-Flag setzen
 *   POST ?action=set-admin       → Admin-Rechte vergeben/entziehen
 *   POST ?action=delete          → Benutzer loeschen
 *   GET  ?action=current-user    → Eingeloggter Benutzer (fuer SLM-Header)
 *
 * @version    1.0
 * @date       2026-06-08
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/AdminAuth.php';
require_once __DIR__ . '/../includes/AdminAuth.php'; // idempotent

header('X-Content-Type-Options: nosniff');

// Pruefen ob API-Aufruf (JSON) oder UI
$isApi = (
    (isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false)
    || isset($_GET['action'])
    || ($_SERVER['REQUEST_METHOD'] === 'POST' && strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false)
);

// current-user ist ohne Admin-Recht zugaenglich (nur eingeloggt sein)
$action = $_GET['action'] ?? '';
if ($action === 'current-user') {
    AdminAuth::enforceEndpointPolicy('admin-users', 'php');
    header('Content-Type: application/json; charset=utf-8');
    $user = AdminAuth::getCurrentUser();
    echo json_encode([
        'success'  => true,
        'user'     => $user,
        'is_admin' => AdminAuth::isAdmin($user),
    ]);
    exit;
}

// Fuer alle anderen Aktionen: Admin-Recht pruefen
AdminAuth::enforceEndpointPolicy('admin-users', 'php');
if (!AdminAuth::isAdmin()) {
    if ($isApi) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Keine Admin-Rechte']);
        exit;
    }
    header('Location: admin-login.php?redirect=' . urlencode($_SERVER['REQUEST_URI'] ?? 'admin-users.php'));
    exit;
}

// ===== API-Aktionen =====
if ($isApi) {
    header('Content-Type: application/json; charset=utf-8');

    if ($action === 'list') {
        echo json_encode(['success' => true, 'users' => AdminAuth::listUsers()]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body     = json_decode(file_get_contents('php://input'), true) ?: [];
        $username = preg_replace('/[^a-zA-Z0-9_]/', '', trim($body['username'] ?? ($_POST['username'] ?? '')));

        if ($action === 'reset-password') {
            // Passwort-Reset: must_change setzen; Benutzer muss beim naechsten Login neues PW setzen
            if (!$username) { echo json_encode(['success' => false, 'error' => 'username fehlt']); exit; }
            $ok = AdminAuth::setMustChange($username, true);
            echo json_encode(['success' => $ok, 'message' => $ok ? $username . ' muss beim naechsten Login ein neues Passwort setzen.' : 'Fehler']);
            exit;
        }

        if ($action === 'set-admin') {
            $isAdminFlag = !empty($body['is_admin']);
            if (!$username) { echo json_encode(['success' => false, 'error' => 'username fehlt']); exit; }
            $ok = AdminAuth::setUserAdmin($username, $isAdminFlag);
            echo json_encode(['success' => $ok]);
            exit;
        }

        if ($action === 'delete') {
            if (!$username) { echo json_encode(['success' => false, 'error' => 'username fehlt']); exit; }
            if ($username === AdminAuth::getCurrentUser()) {
                echo json_encode(['success' => false, 'error' => 'Eigenen Account nicht loeschbar']);
                exit;
            }
            $ok = AdminAuth::deleteUser($username);
            echo json_encode(['success' => $ok]);
            exit;
        }

        if ($action === 'set-password') {
            // Admin setzt Passwort fuer einen anderen User direkt (optional)
            $pw  = $body['password'] ?? '';
            $mc  = !empty($body['must_change']);
            if (!$username || strlen($pw) < 8) {
                echo json_encode(['success' => false, 'error' => 'username und password (min. 8) benoetigt']);
                exit;
            }
            $ok = AdminAuth::setUserPassword($username, $pw, $mc);
            echo json_encode(['success' => $ok]);
            exit;
        }
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Unbekannte Aktion: ' . htmlspecialchars($action)]);
    exit;
}

// ===== HTML-UI =====
$currentUser = AdminAuth::getCurrentUser();
$users       = AdminAuth::listUsers();
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Benutzerverwaltung — TNET Admin</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #333; font-size: 13px; }
.toolbar {
    background: #1e3a4a; color: #fff; height: 42px;
    display: flex; align-items: center; padding: 0 16px; gap: 12px;
}
.toolbar .brand { font-weight: 700; font-size: 14px; }
.toolbar .spacer { flex: 1; }
.toolbar a { color: rgba(255,255,255,.6); font-size: 11px; text-decoration: none; }
.toolbar a:hover { color: #fff; }
.content { max-width: 800px; margin: 32px auto; padding: 0 16px; }
h1 { font-size: 18px; margin-bottom: 20px; color: #1e3a4a; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
th { background: #2c5f6e; color: #fff; padding: 10px 14px; text-align: left; font-size: 12px; font-weight: 600; }
td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f5f8fa; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
.b-admin    { background: #2c5f6e; color: #fff; }
.b-ok       { background: #e8f5e9; color: #2e7d32; }
.b-missing  { background: #fce4ec; color: #c62828; }
.b-reset    { background: #fff3e0; color: #e65100; }
.btn { padding: 4px 10px; font-size: 11px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; background: #f5f7fa; }
.btn:hover { background: #e8f0f5; }
.btn-red   { border-color: #c0392b; color: #c0392b; }
.btn-red:hover { background: #fde8e6; }
.btn-blue  { border-color: #1565c0; color: #1565c0; }
.btn-blue:hover { background: #e8f4fd; }
.status { font-size: 11px; color: #888; margin-top: 8px; }
</style>
</head>
<body>
<div class="toolbar">
  <span class="brand">🔐 TNET Benutzerverwaltung</span>
  <span class="spacer"></span>
  <span style="font-size:11px;opacity:.6">Eingeloggt als: <?php echo htmlspecialchars($currentUser ?: '—'); ?></span>
  <a href="slm.html">← SLM</a>
  <a href="admin-logout.php">Abmelden</a>
</div>

<div class="content">
  <h1>Benutzer</h1>
  <div id="status" class="status"></div>
  <table>
    <thead>
      <tr>
        <th>Benutzername</th>
        <th>Status</th>
        <th>Rechte</th>
        <th>Zuletzt geändert</th>
        <th>Aktionen</th>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($users as $u): ?>
      <tr data-user="<?php echo htmlspecialchars($u['username']); ?>">
        <td style="font-family:monospace;font-weight:600"><?php echo htmlspecialchars($u['username']); ?></td>
        <td>
          <?php if ($u['must_change']): ?>
            <span class="badge b-reset">PW-Reset ausstehend</span>
          <?php elseif ($u['has_password']): ?>
            <span class="badge b-ok">✓ PW gesetzt</span>
          <?php else: ?>
            <span class="badge b-missing">Noch kein PW</span>
          <?php endif; ?>
        </td>
        <td>
          <?php if ($u['is_admin']): ?><span class="badge b-admin">Admin</span><?php endif; ?>
          <?php if (!$u['is_admin'] && $u['username'] !== 'administrator'): ?>
            <label title="Admin-Rechte">
              <input type="checkbox" class="cb-admin" data-user="<?php echo htmlspecialchars($u['username']); ?>"
                <?php echo $u['is_admin'] ? 'checked' : ''; ?>>
              Admin
            </label>
          <?php endif; ?>
        </td>
        <td style="font-size:11px;color:#888"><?php echo $u['updated'] ? htmlspecialchars(substr($u['updated'], 0, 16)) : '—'; ?></td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <?php if ($u['username'] !== 'administrator'): ?>
            <button class="btn btn-blue" onclick="resetPw('<?php echo htmlspecialchars($u['username']); ?>')">🔁 PW-Reset</button>
            <?php if ($u['username'] !== $currentUser): ?>
            <button class="btn btn-red" onclick="deleteUser('<?php echo htmlspecialchars($u['username']); ?>')">🗑</button>
            <?php endif; ?>
          <?php endif; ?>
        </td>
      </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
</div>

<script>
var API = 'admin-users.php';

function status(msg, ok) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.style.color = ok ? '#2a8' : '#c33';
}

function resetPw(username) {
  if (!confirm('Passwort-Reset für «' + username + '»?\nBenutzer muss beim nächsten Login ein neues Passwort setzen.')) return;
  fetch(API + '?action=reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ username: username })
  }).then(function(r) { return r.json(); }).then(function(j) {
    status(j.success ? j.message : '✗ ' + j.error, j.success);
    if (j.success) setTimeout(function() { location.reload(); }, 1200);
  });
}

function deleteUser(username) {
  if (!confirm('Benutzer «' + username + '» wirklich löschen?')) return;
  fetch(API + '?action=delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ username: username })
  }).then(function(r) { return r.json(); }).then(function(j) {
    status(j.success ? '✓ Gelöscht' : '✗ ' + j.error, j.success);
    if (j.success) setTimeout(function() { location.reload(); }, 1000);
  });
}

document.querySelectorAll('.cb-admin').forEach(function(cb) {
  cb.addEventListener('change', function() {
    var username = cb.dataset.user;
    fetch(API + '?action=set-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ username: username, is_admin: cb.checked })
    }).then(function(r) { return r.json(); }).then(function(j) {
      status(j.success ? '✓ Gespeichert' : '✗ ' + j.error, j.success);
    });
  });
});
</script>
</body>
</html>
