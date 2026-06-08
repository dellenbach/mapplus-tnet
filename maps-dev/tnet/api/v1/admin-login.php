<?php
/**
 * admin-login.php
 * @version 2.1 @date 2026-06-08 @copyright Trigonet AG
 */
require_once __DIR__ . '/../includes/AdminAuth.php';

$error    = '';
$redirect = $_GET['redirect'] ?? 'slm.html';
$mode     = 'login';
$username = '';

// Bereits eingeloggt?
if (AdminAuth::isAuthenticated()) {
    $u = AdminAuth::getCurrentUser();
    if ($u && AdminAuth::userMustChange($u)) { $mode = 'change-password'; $username = $u; }
    else { header('Location: ' . $redirect); exit; }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username  = trim($_POST['username'] ?? '');
    $password  = $_POST['password']  ?? '';
    $password2 = $_POST['password2'] ?? '';
    $redirect  = $_POST['redirect']  ?? 'slm.html';
    $postMode  = $_POST['mode']      ?? 'login';

    if (!preg_match('/^[a-zA-Z0-9_]{2,32}$/', $username)) {
        $error = 'Ungültiger Benutzername.'; $mode = $postMode;
    } elseif ($postMode === 'set-password' || $postMode === 'change-password') {
        $oldOk = ($postMode === 'change-password') ? AdminAuth::verifyUserPassword($username, $_POST['old_password'] ?? '') : true;
        if ($postMode === 'change-password' && !$oldOk) {
            $error = 'Aktuelles Passwort falsch.'; $mode = 'change-password';
        } elseif (strlen($password) < 8) {
            $error = 'Passwort muss mindestens 8 Zeichen lang sein.'; $mode = $postMode;
        } elseif ($password !== $password2) {
            $error = 'Passwörter stimmen nicht überein.'; $mode = $postMode;
        } else {
            if (AdminAuth::setUserPassword($username, $password, false)) {
                AdminAuth::setAuthCookie($username);
                header('Location: ' . $redirect); exit;
            }
            $error = 'Speichern fehlgeschlagen.'; $mode = $postMode;
        }
    } else {
        if (!AdminAuth::userHasPassword($username)) { $mode = 'set-password'; }
        elseif (AdminAuth::verifyUserPassword($username, $password)) {
            AdminAuth::setAuthCookie($username);
            if (AdminAuth::userMustChange($username)) { $mode = 'change-password'; }
            else { header('Location: ' . $redirect); exit; }
        } else { $error = 'Falscher Benutzername oder Passwort.'; }
    }
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TNET Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1e3a4a;min-height:100vh;display:flex;align-items:center;justify-content:center}
.c{background:#fff;border-radius:12px;padding:36px;box-shadow:0 8px 32px rgba(0,0,0,.4);width:360px;max-width:92vw}
h1{text-align:center;font-size:18px;color:#1e3a4a;margin-bottom:6px}
.sub{text-align:center;font-size:12px;color:#888;margin-bottom:24px}
.fg{margin-bottom:14px}
label{display:block;font-size:11px;font-weight:700;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px}
input{width:100%;padding:10px 12px;font-size:14px;border:2px solid #ddd;border-radius:6px;outline:none;transition:border-color .15s}
input:focus{border-color:#4B7B81}
input[readonly]{background:#f5f7fa;color:#666}
.btn{width:100%;padding:11px;font-size:14px;font-weight:700;border:none;border-radius:6px;cursor:pointer;background:#4B7B81;color:#fff;margin-top:4px;transition:background .15s}
.btn:hover{background:#3a6166}
.err{background:#fde8e6;color:#c0392b;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:14px}
.hint{font-size:11px;color:#aaa;text-align:center;margin-top:12px}
</style>
</head>
<body>
<div class="c">
  <h1>🔐 TNET Admin</h1>
  <div class="sub"><?php
    if ($mode==='set-password') echo 'Erstpasswort festlegen';
    elseif ($mode==='change-password') echo 'Neues Passwort setzen';
    else echo 'Anmelden';
  ?></div>

  <?php if ($error): ?><div class="err"><?php echo htmlspecialchars($error) ?></div><?php endif ?>

  <form method="POST" autocomplete="off">
    <input type="hidden" name="redirect" value="<?php echo htmlspecialchars($redirect) ?>">
    <input type="hidden" name="mode"     value="<?php echo htmlspecialchars($mode) ?>">

    <div class="fg">
      <label>Benutzername</label>
      <input type="text" name="username"
        value="<?php echo htmlspecialchars($username) ?>"
        <?php echo ($mode==='login')?'autofocus':'readonly' ?>
        placeholder="z.B. admin, del, mar …" required>
    </div>

    <?php if ($mode==='change-password'): ?>
    <div class="fg"><label>Aktuelles Passwort</label><input type="password" name="old_password" autofocus required></div>
    <?php elseif ($mode==='login'): ?>
    <div class="fg"><label>Passwort</label><input type="password" name="password" autofocus required></div>
    <?php endif ?>

    <?php if ($mode==='set-password'||$mode==='change-password'): ?>
    <div class="fg">
      <label>Neues Passwort <span style="font-weight:400;color:#aaa">(min. 8 Zeichen)</span></label>
      <input type="password" name="password" minlength="8" <?php echo ($mode==='set-password')?'autofocus':'' ?> required>
    </div>
    <div class="fg"><label>Bestätigen</label><input type="password" name="password2" minlength="8" required></div>
    <?php endif ?>

    <button type="submit" class="btn"><?php
      if ($mode==='set-password') echo '✓ Passwort setzen';
      elseif ($mode==='change-password') echo '✓ Passwort ändern';
      else echo '→ Anmelden';
    ?></button>
  </form>

  <div class="hint">IP: <?php echo htmlspecialchars(AdminAuth::getClientIp()) ?></div>
</div>
</body>
</html>