#!/usr/bin/env python
# Check docker container status + logs on deploy server
import paramiko, sys
sys.stdout.reconfigure(encoding="utf-8")
host, user, pw = "20.119.98.136", "csp", "cornerstp1234!@#$"
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(host, username=user, password=pw, timeout=30)
cmds = [
    f"echo '{pw}' | sudo -S docker ps -a --filter name=yg1-ai-catalog-app --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}\\t{{{{.Ports}}}}'",
    f"echo '{pw}' | sudo -S docker logs --tail 80 yg1-ai-catalog-app-dev 2>&1",
]
for c in cmds:
    print(f"\n$ {c.split('sudo -S ')[1] if 'sudo -S' in c else c}")
    _, out, err = cli.exec_command(c, timeout=60)
    for line in out: print(line, end="")
    for line in err: print(f"[stderr] {line}", end="")
cli.close()
