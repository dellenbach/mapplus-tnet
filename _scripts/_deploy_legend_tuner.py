#!/usr/bin/env python3
"""
_deploy_legend_tuner.py
Deploy legend_tuner.json von /data/tmp/legend-conf/ nach /www/core/config/
(Remote-to-Remote Copy via SFTP)

@version    1.0
@date       2026-04-01
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import io
import sys
import paramiko

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

SRC_FILE = "/data/tmp/legend-conf/legend_tuner.json"
DST_FILE = "/www/core/config/legend_tuner.json"
BAK_FILE = DST_FILE + ".bak"


def deploy():
    print(f"Verbinde zu {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        # Prüfe ob Draft existiert
        try:
            info = sftp.stat(SRC_FILE)
        except IOError:
            print(f"  ✗ Draft nicht gefunden: {SRC_FILE}")
            return False

        print(f"  Draft: {SRC_FILE} ({info.st_size:,} Bytes)")

        # Backup erstellen falls Ziel existiert
        try:
            sftp.stat(DST_FILE)
            buf = io.BytesIO()
            sftp.getfo(DST_FILE, buf)
            buf.seek(0)
            sftp.putfo(buf, BAK_FILE)
            print(f"  Backup: {BAK_FILE}")
        except IOError:
            print("  (kein bestehendes Deploy — kein Backup nötig)")

        # Remote-to-Remote Copy: Draft → Deployed
        buf = io.BytesIO()
        sftp.getfo(SRC_FILE, buf)
        buf.seek(0)
        sftp.putfo(buf, DST_FILE)

        # Verify
        deployed = sftp.stat(DST_FILE)
        print(f"  ✓ Deployed: {DST_FILE} ({deployed.st_size:,} Bytes)")

        sftp.close()
        ssh.close()
        return True

    except Exception as e:
        print(f"  ✗ Fehler: {e}")
        return False


if __name__ == "__main__":
    ok = deploy()
    if ok:
        print("\n✓ legend_tuner.json erfolgreich deployed")
    else:
        print("\n✗ Deploy fehlgeschlagen")
        sys.exit(1)
