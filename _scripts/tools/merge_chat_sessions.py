"""
merge_chat_sessions.py
Fuegt alte Chat-Sessions (mapplus-exp) in den aktuellen Workspace (mapplus-tnet) ein.

WICHTIG: VS Code muss vor der Ausfuehrung vollstaendig geschlossen sein!

@version    1.0
@date       2026-07-02
@copyright  Trigonet AG
@author     Marco Dellenbach
"""

import sqlite3
import json
import shutil
import os
from datetime import datetime

# ===== KONFIGURATION =====
OLD_DB = r'C:\Users\marco.dellenbach\AppData\Roaming\Code\User\workspaceStorage\98da9e9792ce7cd9b8c4cb33995637f1\state.vscdb'
NEW_DB = r'C:\Users\marco.dellenbach\AppData\Roaming\Code\User\workspaceStorage\3e47bcfc15b9ec4e9eece18c142ab459\state.vscdb'
OLD_SESSIONS_DIR = r'C:\Users\marco.dellenbach\AppData\Roaming\Code\User\workspaceStorage\98da9e9792ce7cd9b8c4cb33995637f1\chatSessions'
NEW_SESSIONS_DIR = r'C:\Users\marco.dellenbach\AppData\Roaming\Code\User\workspaceStorage\3e47bcfc15b9ec4e9eece18c142ab459\chatSessions'
INDEX_KEY = 'chat.ChatSessionStore.index'

# ===== BACKUP =====
stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
backup = NEW_DB + f'.backup_{stamp}'
shutil.copy2(NEW_DB, backup)
print(f"Backup erstellt: {backup}")

# ===== JSONL-DATEIEN KOPIEREN =====
copied_files = 0
for fname in os.listdir(OLD_SESSIONS_DIR):
    src = os.path.join(OLD_SESSIONS_DIR, fname)
    dst = os.path.join(NEW_SESSIONS_DIR, fname)
    if not os.path.exists(dst):
        shutil.copy2(src, dst)
        copied_files += 1
print(f"JSONL-Dateien kopiert: {copied_files}")

# ===== INDEX MERGEN =====
old_conn = sqlite3.connect(OLD_DB)
new_conn = sqlite3.connect(NEW_DB)
old_c = old_conn.cursor()
new_c = new_conn.cursor()

# Alten Index lesen
old_c.execute(f"SELECT value FROM ItemTable WHERE key='{INDEX_KEY}'")
old_row = old_c.fetchone()
old_entries = {}
if old_row:
    old_data = json.loads(old_row[0])
    old_entries = old_data.get('entries', {})
    print(f"Alte Sessions gefunden: {len(old_entries)}")

# Neuen Index lesen
new_c.execute(f"SELECT value FROM ItemTable WHERE key='{INDEX_KEY}'")
new_row = new_c.fetchone()
new_entries = {}
new_version = 1
if new_row:
    new_data = json.loads(new_row[0])
    new_entries = new_data.get('entries', {})
    new_version = new_data.get('version', 1)
    print(f"Aktuelle Sessions: {len(new_entries)}")

# Mergen: alte Eintraege einfuegen, die im neuen noch nicht vorhanden sind
added = 0
for sid, entry in old_entries.items():
    if sid not in new_entries:
        new_entries[sid] = entry
        added += 1

print(f"Neu hinzugefuegt: {added} Sessions")
print(f"Gesamt nach Merge: {len(new_entries)} Sessions")

# Zurueckschreiben
merged = json.dumps({'version': new_version, 'entries': new_entries}, ensure_ascii=False)
if new_row:
    new_c.execute(f"UPDATE ItemTable SET value=? WHERE key='{INDEX_KEY}'", (merged,))
else:
    new_c.execute(f"INSERT INTO ItemTable (key, value) VALUES ('{INDEX_KEY}', ?)", (merged,))

new_conn.commit()
old_conn.close()
new_conn.close()

print("\nFertig! Starte VS Code neu und prüfe die Sitzungsliste.")
