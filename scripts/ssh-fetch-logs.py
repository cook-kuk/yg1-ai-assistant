#!/usr/bin/env python
"""SSH to deploy server (3000) and fetch recent app container error logs."""
import paramiko

HOST = "20.119.98.136"
USER = "csp"
PASS = "cornerstp1234!@#$"
CMDS = [
    "echo 'cornerstp1234!@#$' | sudo -S docker logs --tail 400 yg1-ai-catalog-app-dev 2>&1 | grep -iE 'error|fail|throw|exception|stack|recommend\\] Error|column .* does not exist|TypeError|ReferenceError' | tail -120",
    "echo '---ALL LAST 80---'",
    "echo 'cornerstp1234!@#$' | sudo -S docker logs --tail 80 yg1-ai-catalog-app-dev 2>&1 | tail -80",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=22, username=USER, password=PASS, timeout=15)
for cmd in CMDS:
    _, stdout, stderr = c.exec_command(cmd, timeout=60)
    print(stdout.read().decode("utf-8", errors="replace"), end="", flush=True)
    err = stderr.read().decode("utf-8", errors="replace")
    if err: print(f"[stderr] {err}", end="", flush=True)
c.close()
