import sys, paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("20.119.98.136", 22, "csp", "cornerstp1234!@#$", timeout=15)

# Remove orphan/conflicting container and force a clean rebuild
cmd = (
  "cd ~/yg1-ai-catalog-dev && git log --oneline -1 && "
  "echo 'cornerstp1234!@#$' | sudo -S sh -c '"
  "docker rm -f $(docker ps -aq -f name=yg1-ai-catalog-app-dev) 2>/dev/null; "
  "docker compose up -d --build --force-recreate"
  "' 2>&1 | tail -40"
)
print(f"[$] {cmd}")
stdin, stdout, stderr = c.exec_command(cmd, timeout=600)
sys.stdout.buffer.write(stdout.read())
err = stderr.read().decode("utf-8", errors="replace")
if err.strip():
    print("STDERR:", err)
c.close()
