#!/usr/bin/env python
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8")
host, user, pw = "20.119.98.136", "csp", "cornerstp1234!@#$"
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(host, username=user, password=pw, timeout=30)
query = sys.argv[1] if len(sys.argv) > 1 else "unified-router|toolType|machiningCategory|Milling"
cmd = f"echo '{pw}' | sudo -S docker logs --tail 600 yg1-ai-catalog-app-dev 2>&1 | grep -iE '{query}' | tail -60"
print(f"$ {cmd}")
_, out, err = cli.exec_command(cmd, timeout=60)
for line in out: print(line, end="")
cli.close()
