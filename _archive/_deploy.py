import sys, io, shlex, paramiko, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = "20.119.98.136"
USER = "csp"
PASS = "cornerstp1234!@#$"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=1800):
    print(f"\n$ {cmd}", flush=True)
    stdin, stdout, stderr = client.exec_command(f"bash -lc {shlex.quote(cmd)}", timeout=timeout, get_pty=True)
    while True:
        line = stdout.readline()
        if not line: break
        print(line.rstrip(), flush=True)
    rc = stdout.channel.recv_exit_status()
    print(f"[exit {rc}]", flush=True)
    return rc

def sudo(cmd, timeout=1800):
    return run(f"echo {shlex.quote(PASS)} | sudo -S bash -c {shlex.quote(cmd)}", timeout=timeout)

print("\n========== GIT PULL ==========")
run("cd ~/yg1-ai-catalog-dev && git fetch origin && git reset --hard origin/main && git log --oneline -3")

print("\n========== REBUILD + START CONTAINER ==========")
sudo("cd /home/csp/yg1-ai-catalog-dev && APP_MODE=dev docker compose up --build -d app 2>&1 | tail -30", timeout=1200)

print("\n========== WAIT FOR CONTAINER ==========")
time.sleep(8)
for i in range(6):
    sudo("docker ps --filter name=app-dev --format '{{.Names}}|{{.Status}}'")
    time.sleep(4)

print("\n========== FIX VERIFICATION ==========")
sudo("docker exec yg1-ai-catalog-app-dev grep -c '출력 전 자체 체크리스트' /app/lib/recommendation/infrastructure/llm/prompt-builder.ts 2>&1")
sudo("docker exec yg1-ai-catalog-app-dev grep -c '질문 자연스러움 필수' /app/lib/recommendation/infrastructure/engines/serve-engine-response.ts 2>&1")

client.close()
