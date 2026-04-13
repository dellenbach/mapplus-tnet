<?php
/**
 * admin-login.php
 * Login-Seite für TNET Admin-Bereich.
 * Ersteinrichtung: Beim ersten Aufruf wird das Passwort gesetzt.
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

// Bereits eingeloggt → weiterleiten
if ($isSetup && AdminAuth::isAuthenticated()) {
    header('Location: ' . $redirect);
    exit;
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
