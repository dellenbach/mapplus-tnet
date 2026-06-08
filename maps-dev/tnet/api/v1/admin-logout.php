<?php
/**
 * admin-logout.php
 * Cookie loeschen und zum Login weiterleiten.
 *
 * @version    1.0
 * @date       2026-06-08
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/AdminAuth.php';
AdminAuth::clearAuthCookie();
header('Location: admin-login.php?redirect=slm.html');
exit;
