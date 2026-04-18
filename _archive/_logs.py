import sys, io, paramiko, shlex
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = "20.119.98.136"
USER = "csp"
PASS = "cornerstp1234!@#$"
SINCE = sys.argv[1] if len(sys.argv) > 1 else "5m"
GREP = sys.argv[2] if len(sys.argv) > 2 else ""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=30)

cmd = f"docker logs yg1-ai-catalog-app-dev --since {SINCE} 2>&1"
if GREP:
    cmd += f" | grep -iE {shlex.quote(GREP)}"
cmd += " | tail -200"

wrapper = f"echo {shlex.quote(PASS)} | sudo -S bash -c {shlex.quote(cmd)}"
_, out, _ = client.exec_command(wrapper, get_pty=True, timeout=120)
while True:
    line = out.readline()
    if not line: break
    print(line.rstrip(), flush=True)
client.close()
