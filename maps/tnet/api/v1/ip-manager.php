<?php
/**
 * ip-manager.php
 * Standalone IP-Manager-Seite (analog FastAPI ags2mapplus /admin/ip-manager).
 * Verwaltet IP-Whitelist und zeigt Zugriffsstatistiken.
 *
 * @version    2.0
 * @date       2026-04-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/AdminAuth.php';
require_once __DIR__ . '/../includes/IpTracker.php';

// ===== AUTHENTIFIZIERUNG =====
AdminAuth::requireAuth();

// Logout-Handler
if (isset($_GET['action']) && $_GET['action'] === 'logout') {
    AdminAuth::clearAuthCookie();
    header('Location: admin-login.php');
    exit;
}

// Tracking-Daten laden und bereinigen
IpTracker::cleanup();
$trackingData = IpTracker::getAggregated();
$clientIp = AdminAuth::getClientIp();
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IP-Manager — TNET API</title>
<style>
:root {
    --primary: #2196F3;
    --primary-dark: #1976D2;
    --primary-light: #E3F2FD;
    --danger: #e53935;
    --danger-light: #FFEBEE;
    --success: #43A047;
    --success-light: #E8F5E9;
    --warning: #FB8C00;
    --warning-light: #FFF3E0;
    --bg: #f5f7fa;
    --card: #fff;
    --border: #e0e4e8;
    --text: #333;
    --text-light: #888;
    --mono: 'Consolas', 'Monaco', 'Courier New', monospace;
    --header-bg: #1565C0;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); font-size: 14px;
}
.header {
    background: linear-gradient(135deg, #0D47A1 0%, #1565C0 50%, #1976D2 100%);
    color: #fff; padding: 14px 24px;
    display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 2px 8px rgba(0,0,0,.2);
}
.header h1 { font-size: 18px; font-weight: 600; }
.header-actions { display: flex; align-items: center; gap: 12px; font-size: 12px; }
.header-actions a {
    color: rgba(255,255,255,.85); text-decoration: none;
    padding: 4px 10px; border-radius: 4px; transition: background .2s;
}
.header-actions a:hover { background: rgba(255,255,255,.15); }
.ip-badge {
    background: rgba(255,255,255,.15); padding: 3px 8px;
    border-radius: 4px; font-family: var(--mono); font-size: 11px;
}
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
.info-bar {
    background: var(--primary-light); border-left: 4px solid var(--primary);
    padding: 12px 16px; margin-bottom: 20px; border-radius: 0 6px 6px 0;
    font-size: 13px; color: #1565C0; line-height: 1.5;
}
.card {
    background: var(--card); border-radius: 8px; padding: 20px;
    margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
    border: 1px solid var(--border);
}
.card h3 { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--primary-dark); }
.add-ip-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.add-ip-row input[type="text"] {
    padding: 8px 10px; border: 2px solid var(--border); border-radius: 5px;
    font-size: 13px; outline: none; transition: border-color .2s;
}
.add-ip-row input:focus { border-color: var(--primary); }
.add-ip-row input#newIp { width: 200px; font-family: var(--mono); }
.add-ip-row input#newLabel { width: 160px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
    background: var(--header-bg); color: #fff; padding: 10px 8px;
    text-align: left; font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: .5px;
    white-space: nowrap; position: sticky; top: 0;
}
thead th:first-child { border-radius: 6px 0 0 0; }
thead th:last-child { border-radius: 0 6px 0 0; }
tbody td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tbody tr:hover { background: #f8fafb; }
tbody tr.row-blocked { background: #FFF8E1; }
.mono { font-family: var(--mono); font-size: 12px; }
.paths-cell { max-width: 200px; font-size: 11px; color: var(--text-light); word-break: break-all; }
.badge {
    display: inline-block; padding: 3px 10px; border-radius: 12px;
    font-size: 12px; font-weight: 600; white-space: nowrap;
}
.badge-ok { background: var(--success-light); color: var(--success); }
.badge-blocked { background: var(--danger-light); color: var(--danger); }
.badge-wildcard {
    display: inline-block; background: var(--primary-light); color: var(--primary);
    padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; margin-top: 2px;
}
.badge-manual { color: var(--text-light); font-size: 11px; font-style: italic; }
.btn-primary {
    padding: 8px 14px; background: var(--primary); color: #fff;
    border: none; border-radius: 5px; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: background .2s;
}
.btn-primary:hover { background: var(--primary-dark); }
.btn-secondary {
    padding: 8px 14px; background: #fff; color: var(--text);
    border: 2px solid var(--border); border-radius: 5px; font-size: 13px;
    cursor: pointer; transition: border-color .2s;
}
.btn-secondary:hover { border-color: var(--primary); }
.btn-delete {
    background: none; border: none; color: var(--danger);
    font-size: 18px; font-weight: bold; cursor: pointer;
    padding: 2px 8px; border-radius: 4px; line-height: 1; transition: background .2s;
}
.btn-delete:hover { background: var(--danger-light); }
.btn-add-ip {
    padding: 3px 10px; background: var(--primary-light); color: var(--primary);
    border: 1px solid var(--primary); border-radius: 4px; font-size: 11px;
    font-weight: 600; cursor: pointer; transition: background .2s;
}
.btn-add-ip:hover { background: var(--primary); color: #fff; }
.btn-large { padding: 10px 20px; font-size: 14px; }
.collapse-header { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; }
.collapse-header:hover { color: var(--primary); }
.collapse-body { display: none; margin-top: 12px; }
.collapse-body.open { display: block; }
.collapse-arrow { transition: transform .2s; display: inline-block; }
.collapse-arrow.open { transform: rotate(90deg); }
.action-bar {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px 20px;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 16px;
}
.action-bar .spacer { flex: 1; }
.toast {
    position: fixed; top: 20px; right: 20px; padding: 12px 20px;
    border-radius: 8px; font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,.2); z-index: 1000;
    transform: translateX(120%); transition: transform .3s ease;
}
.toast.show { transform: translateX(0); }
.toast-success { background: var(--success); color: #fff; }
.toast-error { background: var(--danger); color: #fff; }
.toast-info { background: var(--primary); color: #fff; }
.help-text {
    font-size: 12px; color: var(--text-light); line-height: 1.6;
    padding: 12px 16px; background: #f8f9fa; border-radius: 6px; margin-top: 8px;
}
.spinner {
    display: inline-block; width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,.3); border-top-color: #fff;
    border-radius: 50%; animation: spin .6s linear infinite;
    vertical-align: middle; margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.label-input {
    width: 100%; padding: 2px 6px; font-size: 12px;
    border: 1px solid var(--border); border-radius: 4px; outline: none;
    transition: border-color .2s;
}
.label-input:focus { border-color: var(--primary); }
</style>
</head>
<body>
<div class="header">
    <h1>🔐 TNET IP-Manager</h1>
    <div class="header-actions">
        <span class="ip-badge">IP: <?php echo htmlspecialchars($clientIp); ?></span>
        <a href="slm.html">← SLM</a>
        <a href="?action=logout">Logout</a>
    </div>
</div>
<div class="container">
<div class="info-bar">
    Verwalten Sie die IP-basierte Zugriffskontrolle für die TNET API.
    Änderungen werden in der Konfiguration gespeichert und sofort wirksam.
</div>
<div class="card">
    <h3>+ IP / Wildcard hinzufügen</h3>
    <div class="add-ip-row">
        <input type="text" id="newIp" placeholder="z.B. 192.168.1.0 oder 10.0.*.*">
        <input type="text" id="newLabel" placeholder="Label (optional)">
        <button class="btn-primary" onclick="addIp()">Hinzufügen</button>
    </div>
    <div class="help-text" style="margin-top:10px">
        <strong>Filter-Muster:</strong> <code>*</code> steht für beliebige Zeichen
        (z.B. <code>10.203.*.*</code> erlaubt alle IPs die mit <code>10.203.</code> beginnen).
    </div>
</div>
<div class="card">
    <h3>IP-Adressen &amp; Zugriffsstatistik</h3>
    <div id="loadingIndicator" style="text-align:center;padding:20px;color:var(--text-light);">
        Konfiguration wird geladen…
    </div>
    <div class="table-wrap" id="tableWrap" style="display:none">
        <table>
            <thead>
                <tr>
                    <th style="width:32px"><input type="checkbox" id="selectAll" title="Alle auswählen"></th>
                    <th>IP-Adresse</th>
                    <th>Label</th>
                    <th style="text-align:right">Zugriffe</th>
                    <th style="text-align:right">Blockiert</th>
                    <th>Erster Zugriff</th>
                    <th>Letzter Zugriff</th>
                    <th>Aufgerufene Pfade</th>
                    <th>Status</th>
                    <th style="width:40px"></th>
                </tr>
            </thead>
            <tbody id="ipTableBody"></tbody>
        </table>
    </div>
    <div id="emptyState" style="display:none;text-align:center;padding:20px;color:var(--text-light);">
        Keine IP-Adressen konfiguriert.
    </div>
</div>
<div class="action-bar">
    <button class="btn-primary btn-large" id="saveBtn" onclick="saveConfig()">💾 Speichern</button>
    <button class="btn-primary btn-large" onclick="whitelistSelected()">📋 Ausgewählte IPs freigeben</button>
    <div class="spacer"></div>
    <span id="changeIndicator" style="font-size:12px;color:var(--warning);display:none">⚠ Ungespeicherte Änderungen</span>
    <button class="btn-secondary" onclick="resetConfig()">↩ Zurücksetzen</button>
</div>
<div class="card">
    <div class="collapse-header" onclick="toggleCollapse(this)">
        <span class="collapse-arrow">▶</span>
        <h3 style="margin:0">Endpoint-Konfiguration</h3>
    </div>
    <div class="collapse-body" id="endpointSection">
        <div class="table-wrap">
            <table>
                <thead><tr><th>Datei</th><th>Typ</th><th>Schutz</th></tr></thead>
                <tbody id="epTableBody"></tbody>
            </table>
        </div>
        <p class="help-text" style="margin-top:8px">
            <strong>🔒 Geschützt</strong> = Cookie-Auth erforderlich.
            <strong>🛡️ Geschützt + IP-Freigabe</strong> = Cookie-Auth oder freigegebene Whitelist-IP.
            <strong>🌐 Öffentlich</strong> = Ohne Login erreichbar.
            <strong>🔐 POST geschützt</strong> = GET öffentlich, POST erfordert Auth.
        </p>
    </div>
</div>
</div>
<div id="toast" class="toast"></div>
<script>
var trackingData = <?php echo json_encode($trackingData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
var config = null;
var originalConfig = null;
var hasChanges = false;

document.addEventListener('DOMContentLoaded', function() {
    loadConfig();
    document.getElementById('selectAll').addEventListener('change', function() {
        var cbs = document.querySelectorAll('#ipTableBody input[type="checkbox"]');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = this.checked;
    });
    document.getElementById('newIp').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') addIp();
    });
});

function loadConfig() {
    Promise.all([
        fetch('access-control.php?action=load').then(function(r) { return r.json(); }),
        fetch('access-control.php?action=endpoints').then(function(r) { return r.json(); })
    ])
    .then(function(results) {
        var configRes = results[0];
        var epRes = results[1];
        if (configRes.success) {
            config = configRes.data;
            originalConfig = JSON.parse(JSON.stringify(config));
            if (epRes.success) _epEndpoints = epRes.data;
            renderTable();
            renderEndpoints();
            document.getElementById('loadingIndicator').style.display = 'none';
            document.getElementById('tableWrap').style.display = 'block';
        } else {
            showToast('Fehler beim Laden: ' + (configRes.error || 'Unbekannt'), 'error');
        }
    })
    .catch(function(err) { showToast('Netzwerkfehler: ' + err.message, 'error'); });
}

function saveConfig() {
    if (!config) return;
    var btn = document.getElementById('saveBtn');
    btn.innerHTML = '<span class="spinner"></span> Speichern…';
    btn.disabled = true;
    fetch('access-control.php?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    })
    .then(function(r) { return r.json(); })
    .then(function(json) {
        btn.innerHTML = '💾 Speichern';
        btn.disabled = false;
        if (json.success) {
            originalConfig = JSON.parse(JSON.stringify(config));
            setChanged(false);
            showToast('Konfiguration gespeichert ✓', 'success');
        } else {
            showToast('Fehler: ' + (json.error || 'Unbekannt'), 'error');
        }
    })
    .catch(function(err) {
        btn.innerHTML = '💾 Speichern';
        btn.disabled = false;
        showToast('Netzwerkfehler: ' + err.message, 'error');
    });
}

function renderTable() {
    var tbody = document.getElementById('ipTableBody');
    tbody.innerHTML = '';
    var rows = [];
    var configIps = config.ips || [];
    var blockedIps = config.blocked_ips || [];
    var blockedSet = {};
    blockedIps.forEach(function(ip) { blockedSet[ip] = true; });
    var configIpSet = {};
    configIps.forEach(function(e) { configIpSet[e.ip] = true; });

    configIps.forEach(function(entry) {
        var track = trackingData[entry.ip] || null;
        var isBlocked = !!blockedSet[entry.ip];
        rows.push({
            ip: entry.ip, label: entry.label || '', inWhitelist: true,
            isBlocked: isBlocked,
            isWildcard: entry.ip.indexOf('*') !== -1,
            count: track ? track.count : 0, blocked: 0,
            firstSeen: track ? track.first_seen : null,
            lastSeen: track ? track.last_seen : null,
            paths: track ? track.paths : []
        });
    });

    Object.keys(trackingData).forEach(function(ip) {
        if (configIpSet[ip]) return;
        var explicitlyBlocked = !!blockedSet[ip];
        var matchesWildcard = false;
        if (!explicitlyBlocked) {
            configIps.forEach(function(e) {
                if (e.ip.indexOf('*') !== -1 && wildcardMatch(e.ip, ip)) matchesWildcard = true;
            });
        }
        var track = trackingData[ip];
        rows.push({
            ip: ip, label: '', inWhitelist: matchesWildcard,
            isBlocked: explicitlyBlocked,
            isTrackedOnly: true, isWildcard: false,
            count: matchesWildcard ? track.count : 0,
            blocked: matchesWildcard ? 0 : track.count,
            firstSeen: track.first_seen, lastSeen: track.last_seen,
            paths: track.paths
        });
    });

    if (rows.length === 0) {
        document.getElementById('emptyState').style.display = 'block';
        document.getElementById('tableWrap').style.display = 'none';
        return;
    }
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('tableWrap').style.display = 'block';

    rows.forEach(function(row) {
        var tr = document.createElement('tr');
        if (row.isBlocked || !row.inWhitelist) tr.className = 'row-blocked';

        var statusBadge = (!row.isBlocked && row.inWhitelist)
            ? '<span class="badge badge-ok">✅ Erlaubt</span>'
            : '<span class="badge badge-blocked">🚫 Blockiert</span>';

        var ipHtml = '<span class="mono">' + esc(row.ip) + '</span>';
        if (row.isWildcard) ipHtml += '<br><span class="badge-wildcard">🌐 Wildcard</span>';

        var labelHtml = '';
        if (!row.isBlocked && row.inWhitelist && !row.isTrackedOnly) {
            labelHtml = '<input type="text" class="label-input" value="' + escAttr(row.label) + '" data-ip="' + escAttr(row.ip) + '" onchange="updateLabel(this)">';
        } else {
            labelHtml = '<span style="color:var(--text-light)">' + esc(row.label || '') + '</span>';
        }

        var pathsHtml = '';
        if (row.paths.length > 0) {
            pathsHtml = row.paths.slice(0, 5).map(function(p) { return esc(p); }).join(', ');
            if (row.paths.length > 5) pathsHtml += ' <span style="color:var(--text-light)">+' + (row.paths.length - 5) + '</span>';
        } else if (!row.isBlocked && row.inWhitelist && !row.isTrackedOnly) {
            pathsHtml = '<span class="badge-manual">Manuell hinzugefügt</span>';
        } else {
            pathsHtml = '-';
        }

        var actionHtml = '';
        if (!row.isBlocked && row.inWhitelist && !row.isTrackedOnly) {
            actionHtml = '<button class="btn-delete" onclick="removeIp(\'' + escAttr(row.ip) + '\')" title="Entfernen">✕</button>';
        } else if (row.isBlocked) {
            actionHtml = '<button class="btn-add-ip" onclick="unblockIp(\'' + escAttr(row.ip) + '\')" title="Entsperren">↺ Entsperren</button>';
        } else if (!row.inWhitelist) {
            actionHtml = '<button class="btn-add-ip" onclick="whitelistIp(\'' + escAttr(row.ip) + '\')" title="Freigeben">+ Freigeben</button>';
        }

        tr.innerHTML =
            '<td><input type="checkbox" data-ip="' + escAttr(row.ip) + '"></td>' +
            '<td>' + ipHtml + '</td>' +
            '<td>' + labelHtml + '</td>' +
            '<td style="text-align:right">' + (row.count || '-') + '</td>' +
            '<td style="text-align:right;color:' + (row.blocked > 0 ? 'var(--danger)' : 'var(--text-light)') + '">' + (row.blocked || '-') + '</td>' +
            '<td>' + (row.firstSeen ? formatDate(row.firstSeen) : '-') + '</td>' +
            '<td>' + (row.lastSeen ? formatDate(row.lastSeen) : '-') + '</td>' +
            '<td class="paths-cell">' + pathsHtml + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' + actionHtml + '</td>';
        tbody.appendChild(tr);
    });
}

var _epEndpoints = [];
function renderEndpoints() {
    if (!config || !config.endpoints) return;
    var ep = config.endpoints;
    var tbody = document.getElementById('epTableBody');
    tbody.innerHTML = '';
    var allNames = {};
    (ep.restricted_html || []).forEach(function(n) { allNames[n] = { type: 'html', status: 'restricted' }; });
    (ep.restricted_php || []).forEach(function(n) { allNames[n] = { type: 'php', status: 'restricted' }; });
    (ep.restricted_with_ip_html || []).forEach(function(n) { allNames[n] = { type: 'html', status: 'restricted_with_ip' }; });
    (ep.restricted_with_ip_php || []).forEach(function(n) { allNames[n] = { type: 'php', status: 'restricted_with_ip' }; });
    (ep.cache_post_only || []).forEach(function(n) { allNames[n] = { type: 'php', status: 'cache_post_only' }; });
    (ep.public || []).forEach(function(n) { allNames[n] = { type: 'php', status: 'public' }; });
    _epEndpoints.forEach(function(e) {
        if (!(e.name in allNames)) allNames[e.name] = { type: e.type, status: 'public' };
        else allNames[e.name].type = e.type;
    });
    var names = Object.keys(allNames).sort(function(a, b) {
        var order = { restricted: 0, restricted_with_ip: 1, cache_post_only: 2, public: 3 };
        var sa = order[allNames[a].status] != null ? order[allNames[a].status] : 9;
        var sb = order[allNames[b].status] != null ? order[allNames[b].status] : 9;
        return sa !== sb ? sa - sb : a.localeCompare(b);
    });
    names.forEach(function(name) {
        var info = allNames[name];
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td class="mono">' + esc(name) + '.' + info.type + '</td>' +
            '<td>' + (info.type === 'html' ? '📄' : '⚙') + ' ' + info.type.toUpperCase() + '</td>' +
            '<td><select data-name="' + escAttr(name) + '" data-type="' + info.type + '" onchange="epChanged()">' +
            '<option value="restricted"' + (info.status === 'restricted' ? ' selected' : '') + '>🔒 Geschützt</option>' +
            '<option value="restricted_with_ip"' + (info.status === 'restricted_with_ip' ? ' selected' : '') + '>🛡️ Geschützt + IP-Freigabe</option>' +
            '<option value="public"' + (info.status === 'public' ? ' selected' : '') + '>🌐 Öffentlich</option>' +
            '<option value="cache_post_only"' + (info.status === 'cache_post_only' ? ' selected' : '') + '>🔐 POST geschützt</option>' +
            '</select></td>';
        tbody.appendChild(tr);
    });
}

function epChanged() {
    var newEp = {
        restricted_html: [],
        restricted_php: [],
        restricted_with_ip_html: [],
        restricted_with_ip_php: [],
        cache_post_only: [],
        public: []
    };
    document.querySelectorAll('#epTableBody select').forEach(function(sel) {
        var name = sel.dataset.name, type = sel.dataset.type, status = sel.value;
        if (status === 'restricted') {
            if (type === 'html') newEp.restricted_html.push(name);
            else newEp.restricted_php.push(name);
        } else if (status === 'restricted_with_ip') {
            if (type === 'html') newEp.restricted_with_ip_html.push(name);
            else newEp.restricted_with_ip_php.push(name);
        } else if (status === 'cache_post_only') { newEp.cache_post_only.push(name); }
        else { newEp.public.push(name); }
    });
    config.endpoints = newEp;
    setChanged(true);
}

function addIp() {
    var ipInput = document.getElementById('newIp');
    var labelInput = document.getElementById('newLabel');
    var ip = ipInput.value.trim();
    var label = labelInput.value.trim();
    if (!ip) { showToast('Bitte IP-Adresse eingeben', 'error'); ipInput.focus(); return; }
    if (!/^[\d\.\*:]+$/.test(ip)) { showToast('Ungültiges IP-Format', 'error'); return; }
    var exists = (config.ips || []).some(function(e) { return e.ip === ip; });
    if (exists) { showToast('IP ' + ip + ' ist bereits in der Whitelist', 'error'); return; }
    if (!Array.isArray(config.blocked_ips)) config.blocked_ips = [];
    config.blocked_ips = config.blocked_ips.filter(function(b) { return b !== ip; });
    config.ips.push({ ip: ip, label: label, proxy: false });
    ipInput.value = ''; labelInput.value = '';
    setChanged(true); renderTable();
    showToast('IP ' + ip + ' hinzugefügt', 'success');
}

function removeIp(ip) {
    if (!confirm('IP ' + ip + ' aus der Whitelist entfernen?')) return;
    config.ips = config.ips.filter(function(e) { return e.ip !== ip; });
    if (!Array.isArray(config.blocked_ips)) config.blocked_ips = [];
    if (config.blocked_ips.indexOf(ip) === -1) config.blocked_ips.push(ip);
    setChanged(true); renderTable();
    showToast('IP ' + ip + ' entfernt und blockiert', 'info');
}

function updateLabel(input) {
    var ip = input.dataset.ip, newLabel = input.value.trim();
    for (var i = 0; i < config.ips.length; i++) {
        if (config.ips[i].ip === ip) { config.ips[i].label = newLabel; setChanged(true); return; }
    }
}

function whitelistIp(ip) {
    var label = prompt('Label für ' + ip + ' (optional):', '');
    if (label === null) return;
    if (!Array.isArray(config.blocked_ips)) config.blocked_ips = [];
    config.blocked_ips = config.blocked_ips.filter(function(b) { return b !== ip; });
    config.ips.push({ ip: ip, label: label || '', proxy: false });
    setChanged(true); renderTable();
    showToast('IP ' + ip + ' zur Whitelist hinzugefügt', 'success');
}

function unblockIp(ip) {
    if (!Array.isArray(config.blocked_ips)) return;
    config.blocked_ips = config.blocked_ips.filter(function(b) { return b !== ip; });
    setChanged(true); renderTable();
    showToast('IP ' + ip + ' entsperrt', 'success');
}

function whitelistSelected() {
    var cbs = document.querySelectorAll('#ipTableBody input[type="checkbox"]:checked');
    var added = 0;
    cbs.forEach(function(cb) {
        var ip = cb.dataset.ip;
        var exists = (config.ips || []).some(function(e) { return e.ip === ip; });
        if (!Array.isArray(config.blocked_ips)) config.blocked_ips = [];
        config.blocked_ips = config.blocked_ips.filter(function(b) { return b !== ip; });
        if (!exists) { config.ips.push({ ip: ip, label: '', proxy: false }); added++; }
    });
    if (added > 0) { setChanged(true); renderTable(); showToast(added + ' IP(s) zur Whitelist hinzugefügt', 'success'); }
    else { showToast('Keine neuen IPs zum Freigeben ausgewählt', 'info'); }
    document.getElementById('selectAll').checked = false;
}

function resetConfig() {
    if (!hasChanges) { showToast('Keine Änderungen vorhanden', 'info'); return; }
    if (!confirm('Alle ungespeicherten Änderungen verwerfen?')) return;
    config = JSON.parse(JSON.stringify(originalConfig));
    setChanged(false); renderTable(); renderEndpoints();
    showToast('Konfiguration zurückgesetzt', 'info');
}

function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
function escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
        var d = new Date(isoStr);
        return d.toLocaleDateString('de-CH') + ' ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    } catch(e) { return isoStr; }
}
function wildcardMatch(pattern, str) {
    var re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return re.test(str);
}
function setChanged(changed) {
    hasChanges = changed;
    document.getElementById('changeIndicator').style.display = changed ? 'inline' : 'none';
}
function toggleCollapse(headerEl) {
    var body = headerEl.nextElementSibling;
    var arrow = headerEl.querySelector('.collapse-arrow');
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
}
function showToast(msg, type) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast toast-' + (type || 'info') + ' show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { toast.classList.remove('show'); }, 3000);
}
</script>
</body>
</html>
