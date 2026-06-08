<?php
/**
 * admin-login.php
 * Multi-User Login fuer TNET Admin-Bereich.
 * - Erstpasswort: Benutzer setzt es selbst beim ersten Login.
 * - Passwort-Reset: Administrator kann must_change setzen.
 *
 * @version    2.0
 * @date       2026-06-08
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/AdminAuth.php';

$error    = '';
$redirect = $_GET['redirect'] ?? 'slm.html';

// Bereits eingeloggt → pruefen ob Passwort-Wechsel noetig, sonst weiterleiten
if (AdminAuth::isSetup() && AdminAuth::isAuthenticated()) {
    $loggedUser = AdminAuth::getCurrentUser();
    if (!$loggedUser || !AdminAuth::userMustChange($loggedUser)) {
        header('Location: ' . $redirect);
        exit;
    }
}

// IP-Whitelist-Bypass
$redirectPath = parse_url($redirect, PHP_URL_PATH);
if (is_string($redirectPath)) {
    if (preg_match('~/maps(?:-dev)?/tnet/api/v1/([a-zA-Z0-9_-]+)\.(html|php)$~', $redirectPath, $m)) {
        if (AdminAuth::endpointAllowsWhitelistedIp($m[1], $m[2]) && AdminAuth::isWhitelistedIp()) {
            header('Location: ' . $redirect);
            exit;
        }
    }
}

// ===== Modus bestimmen =====
// 'login' | 'set-password' | 'change-password'
$mode     = 'login';
$username = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username  = trim($_POST['username'] ?? '');
    $password  = $_POST['password']  ?? '';
    $password2 = $_POST['password2'] ?? '';
    $redirect  = $_POST['redirect']  ?? 'slm.html';
    $postMode  = $_POST['mode']      ?? 'login';

    if (!preg_match('/^[a-zA-Z0-9_]{2,32}$/', $username)) {
        $error = 'Ungültiger Benutzername.';
        $mode  = $postMode;
    } elseif ($postMode === 'set-password' || $postMode === 'change-password') {
        if ($postMode === 'change-password') {
            $oldPw = $_POST['old_password'] ?? '';
            if (!AdminAuth::verifyUserPassword($username, $oldPw)) {
                $error = 'Aktuelles Passwort falsch.';
                $mode  = 'change-password';
            }
        }
        if (!$error) {
            if (strlen($password) < 8) {
                $error = 'Passwort muss mindestens 8 Zeichen lang sein.';
                $mode  = $postMode;
            } elseif ($password !== $password2) {
                $error = 'Passwörter stimmen nicht überein.';
                $mode  = $postMode;
            } else {
                if (AdminAuth::setUserPassword($username, $password, false)) {
                    AdminAuth::setAuthCookie($username);
                    header('Location: ' . $redirect);
                    exit;
                } else {
                    $error = 'Speichern fehlgeschlagen (Dateisystem-Fehler).';
                    $mode  = $postMode;
                }
            }
        }
    } else {
        // Normaler Login
        if (!AdminAuth::userHasPassword($username)) {
            $mode = 'set-password';
        } elseif (AdminAuth::verifyUserPassword($username, $password)) {
            AdminAuth::setAuthCookie($username);
            if (AdminAuth::userMustChange($username)) {
                $mode = 'change-password';
            } else {
                header('Location: ' . $redirect);
                exit;
            }
        } else {
            $error = 'Falscher Benutzername oder falsches Passwort.';
        }
    }
} else {
    $username = trim($_GET['username'] ?? '');
    if ($username && AdminAuth::isSetup() && !AdminAuth::userHasPassword($username)) {
        $mode = 'set-password';
    }
}

$clientIp  = AdminAuth::getClientIp();
$pageTitles = ['login' => 'Anmelden', 'set-password' => 'Erstpasswort setzen', 'change-password' => 'Passwort ändern'];
$pageTitle  = $pageTitles[$mode] ?? 'Anmelden';
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?php echo htmlspecialchars($pageTitle); ?> — TNET Admin</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(135deg, #1e3a4a 0%, #2c5f6e 50%, #1e3a4a 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
}
.card { background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 8px 32px rgba(0,0,0,.3); width: 400px; max-width: 90vw; }
.hd { text-align: center; margin-bottom: 28px; }
.hd .icon { font-size: 38px; margin-bottom: 8px; }
.hd h1 { font-size: 20px; color: #1e3a4a; margin-bottom: 4px; }
.hd .sub { font-size: 12px; color: #888; }
.fg { margin-bottom: 16px; }
.fg label { display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px; }
.fg input { width: 100%; padding: 10px 12px; font-size: 14px; border: 2px solid #ddd; border-radius: 6px; outline: none; transition: border-color .2s; }
.fg input:focus { border-color: #4B7B81; }
.fg input[readonly] { background: #f5f7fa; color: #666; cursor: not-allowed; }
.fg .hint { font-size: 11px; color: #999; margin-top: 3px; }
.btn { width: 100%; padding: 12px; font-size: 14px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; background: linear-gradient(135deg, #4B7B81, #3a6166); color: #fff; transition: opacity .2s; }
.btn:hover { opacity: .88; }
.err  { background: #fde8e6; color: #c0392b; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 14px; }
.info { background: #e8f4fd; color: #1565c0; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 14px; }
.foot { text-align: center; margin-top: 14px; font-size: 10px; color: #bbb; }
.back { text-align: center; margin-top: 12px; font-size: 11px; }
.back a { color: #4B7B81; text-decoration: none; }
.back a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="card">
  <div class="hd">
    <div class="icon"><?php echo $mode === 'login' ? '🔐' : '🔑'; ?></div>
    <h1>TNET Admin</h1>
    <div class="sub"><?php echo htmlspecialchars($pageTitle); ?></div>
  </div>

  <?php if ($error): ?><div class="err"><?php echo htmlspecialchars($error); ?></div><?php endif; ?>

  <?php if ($mode === 'set-password'): ?>
  <div class="info">Benutzer <strong><?php echo htmlspecialchars($username); ?></strong> — noch kein Passwort gesetzt.<br>Bitte wählen Sie jetzt Ihr persönliches Passwort (min. 8 Zeichen).</div>
  <?php elseif ($mode === 'change-password'): ?>
  <div class="info">Ihr Passwort muss geändert werden.</div>
  <?php endif; ?>

  <form method="POST" autocomplete="off">
    <input type="hidden" name="redirect" value="<?php echo htmlspecialchars($redirect); ?>">
    <input type="hidden" name="mode"     value="<?php echo htmlspecialchars($mode); ?>">

    <div class="fg">
      <label for="f-user">Benutzername</label>
      <input type="text" id="f-user" name="username"
             value="<?php echo htmlspecialchars($username); ?>"
             <?php echo ($mode !== 'login') ? 'readonly' : 'autofocus'; ?>
             placeholder="z.B. del, mar, amr …" required>
    </div>

    <?php if ($mode === 'change-password'): ?>
    <div class="fg">
      <label for="f-old">Aktuelles Passwort</label>
      <input type="password" id="f-old" name="old_password" autofocus required>
    </div>
    <?php elseif ($mode === 'login'): ?>
    <div class="fg">
      <label for="f-pw">Passwort</label>
      <input type="password" id="f-pw" name="password" autofocus required>
    </div>
    <?php endif; ?>

    <?php if ($mode === 'set-password' || $mode === 'change-password'): ?>
    <div class="fg">
      <label for="f-pw1">Neues Passwort</label>
      <input type="password" id="f-pw1" name="password" minlength="8"
             <?php echo ($mode === 'set-password') ? 'autofocus' : ''; ?> required>
      <div class="hint">Mindestens 8 Zeichen, salted &amp; bcrypt-gehashed</div>
    </div>
    <div class="fg">
      <label for="f-pw2">Passwort bestätigen</label>
      <input type="password" id="f-pw2" name="password2" minlength="8" required>
    </div>
    <?php endif; ?>

    <button type="submit" class="btn">
      <?php
        if ($mode === 'set-password')        echo '✓ Passwort setzen &amp; anmelden';
        elseif ($mode === 'change-password') echo '✓ Passwort ändern &amp; anmelden';
        else                                 echo '🔑 Anmelden';
      ?>
    </button>
  </form>

  <div class="foot">Ihre IP: <?php echo htmlspecialchars($clientIp); ?></div>
  <?php if ($mode !== 'login'): ?>
  <div class="back"><a href="admin-login.php?redirect=<?php echo urlencode($redirect); ?>">← Zurück zum Login</a></div>
  <?php endif; ?>
</div>
</body>
</html>
 *
 * @version    1.0
 * @date       2026-04-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/AdminAuth.php';

$error = '';
$success = '';
$isSetup = AdminAuth::isSetup();
$redirect = isset($_GET['redirect']) ? $_GET['redirect'] : 'ip-manager.php';

// Ziel-Endpoint aus Redirect ermitteln (für Modus "Geschützt + IP-Freigabe")
$redirectEndpoint = null;
$redirectType = null;
$redirectPath = parse_url($redirect, PHP_URL_PATH);
if (is_string($redirectPath)) {
    if (preg_match('~/maps/tnet/api/v1/([a-zA-Z0-9_-]+)\.html$~', $redirectPath, $m)) {
        $redirectEndpoint = $m[1];
        $redirectType = 'html';
    } elseif (preg_match('~/maps/tnet/api/v1/([a-zA-Z0-9_-]+)\.php$~', $redirectPath, $m)) {
        $redirectEndpoint = $m[1];
        $redirectType = 'php';
    }
}

// Bereits eingeloggt → weiterleiten
if ($isSetup && AdminAuth::isAuthenticated()) {
    header('Location: ' . $redirect);
    exit;
}

// Whitelist-IP + Endpoint im Modus "Geschützt + IP-Freigabe" → Login überspringen
if ($isSetup && $redirectEndpoint && $redirectType) {
    if (AdminAuth::endpointAllowsWhitelistedIp($redirectEndpoint, $redirectType) && AdminAuth::isWhitelistedIp()) {
        header('Location: ' . $redirect);
        exit;
    }
}

// POST: Login oder Setup
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $password = isset($_POST['password']) ? $_POST['password'] : '';
    $redirect = isset($_POST['redirect']) ? $_POST['redirect'] : 'ip-manager.php';

    if (!$isSetup) {
        // Ersteinrichtung
        if (strlen($password) < 8) {
            $error = 'Passwort muss mindestens 8 Zeichen lang sein.';
        } else {
            if (AdminAuth::setup($password)) {
                AdminAuth::setAuthCookie();
                header('Location: ' . $redirect);
                exit;
            } else {
                $error = 'Einrichtung fehlgeschlagen (Dateisystem-Fehler).';
            }
        }
    } else {
        // Login
        if (AdminAuth::verifyPassword($password)) {
            AdminAuth::setAuthCookie();
            header('Location: ' . $redirect);
            exit;
        } else {
            $error = 'Falsches Passwort.';
        }
    }
}

$clientIp = AdminAuth::getClientIp();
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?php echo $isSetup ? 'Admin Login' : 'Admin Einrichtung'; ?> — TNET API</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(135deg, #1e3a4a 0%, #2c5f6e 50%, #1e3a4a 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    color: #333;
}
.login-card {
    background: #fff; border-radius: 12px; padding: 40px;
    box-shadow: 0 8px 32px rgba(0,0,0,.3); width: 380px; max-width: 90vw;
}
.login-header { text-align: center; margin-bottom: 28px; }
.login-header h1 { font-size: 20px; color: #1e3a4a; margin-bottom: 4px; }
.login-header .subtitle { font-size: 12px; color: #888; }
.login-header .icon { font-size: 36px; margin-bottom: 8px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px; }
.form-group input {
    width: 100%; padding: 10px 12px; font-size: 14px;
    border: 2px solid #ddd; border-radius: 6px; outline: none;
    transition: border-color .2s;
}
.form-group input:focus { border-color: #4B7B81; }
.login-btn {
    width: 100%; padding: 12px; font-size: 14px; font-weight: 700;
    border: none; border-radius: 6px; cursor: pointer;
    background: linear-gradient(135deg, #4B7B81, #3a6166); color: #fff;
    transition: opacity .2s;
}
.login-btn:hover { opacity: .9; }
.error { background: #fde8e6; color: #c0392b; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px; }
.info { background: #e8f4fd; color: #1565c0; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px; }
.ip-info { text-align: center; margin-top: 16px; font-size: 10px; color: #aaa; }
.nav-links { text-align: center; margin-top: 16px; font-size: 11px; }
.nav-links a { color: #4B7B81; text-decoration: none; }
.nav-links a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="login-card">
    <div class="login-header">
        <div class="icon">🔐</div>
        <h1><?php echo $isSetup ? 'TNET Admin' : 'Admin Einrichtung'; ?></h1>
        <div class="subtitle"><?php echo $isSetup ? 'Bitte anmelden' : 'Erstmaliges Passwort festlegen'; ?></div>
    </div>

    <?php if ($error): ?>
    <div class="error"><?php echo htmlspecialchars($error); ?></div>
    <?php endif; ?>

    <?php if (!$isSetup): ?>
    <div class="info">
        Noch kein Admin-Passwort gesetzt. Das hier eingegebene Passwort wird als Admin-Passwort gespeichert (bcrypt-verschlüsselt).
    </div>
    <?php endif; ?>

    <form method="POST" autocomplete="off">
        <input type="hidden" name="redirect" value="<?php echo htmlspecialchars($redirect); ?>">
        <div class="form-group">
            <label for="password"><?php echo $isSetup ? 'Passwort' : 'Neues Admin-Passwort (min. 8 Zeichen)'; ?></label>
            <input type="password" id="password" name="password" autofocus required
                   placeholder="<?php echo $isSetup ? 'Passwort eingeben…' : 'Admin-Passwort festlegen…'; ?>"
                   minlength="<?php echo $isSetup ? '1' : '8'; ?>">
        </div>
        <button type="submit" class="login-btn"><?php echo $isSetup ? '🔑 Anmelden' : '✓ Passwort setzen & anmelden'; ?></button>
    </form>

    <div class="ip-info">Ihre IP: <?php echo htmlspecialchars($clientIp); ?></div>
    <?php if ($isSetup): ?>
    <div class="nav-links">
        <a href="slm.html">← Service- und Layermanager</a>
    </div>
    <?php endif; ?>
</div>
</body>
</html>
