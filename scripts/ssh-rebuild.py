#!/usr/bin/env python
"""SSH to deploy server, pull + rebuild app."""
import sys, time, paramiko

HOST = "20.119.98.136"
USER = "csp"
PASS = "cornerstp1234!@#$"
CMDS = [
    # 컨테이너 이미지가 최신 커밋 기준으로 빌드됐는지 확인
    "echo 'cornerstp1234!@#$' | sudo -S docker exec yg1-ai-catalog-app-dev grep -l 'brandAffinity' /app/.next 2>&1 | head -5 || echo '(브랜드 affinity 코드 컨테이너에 없음 → rebuild 필요)'",
    # 강제 rebuild
    "cd ~/yg1-ai-catalog-dev && echo 'cornerstp1234!@#$' | sudo -S docker compose up -d --build app 2>&1 | tail -20",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"[ssh] connecting {USER}@{HOST}...", flush=True)
c.connect(HOST, port=22, username=USER, password=PASS, timeout=15)
print("[ssh] connected", flush=True)

for cmd in CMDS:
    print(f"\n$ {cmd}", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out: print(out, end="", flush=True)
    if err: print(f"[stderr] {err}", end="", flush=True)

c.close()
print("\n[ssh] done")
