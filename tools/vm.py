"""VM helper — encoding-safe SSH/SFTP for the dev server."""
import sys, io, paramiko, time, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HOST = "20.119.98.136"
USER = "csp"
PASS = "cornerstp1234!@#$"
PORT = 22
DEV_DIR = "/home/csp/yg1-ai-catalog-dev"
DEV_CONTAINER = "yg1-ai-catalog-app-dev"
DEV_URL = "http://20.119.98.136:3000"

def client():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15)
    return c

def run(cmd, quiet=False, timeout=600):
    """Run command on VM, return (stdout, stderr, exit_code)."""
    c = client()
    si, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode("utf-8", errors="replace")
    err = se.read().decode("utf-8", errors="replace")
    code = so.channel.recv_exit_status()
    c.close()
    if not quiet:
        print(f"$ {cmd[:200]}")
        if out: print(out[:3500])
        if err: print("STDERR:", err[:1000])
    return out, err, code

def read_remote(remote_path):
    c = client()
    sftp = c.open_sftp()
    with sftp.open(remote_path, "rb") as f:
        data = f.read().decode("utf-8", errors="replace")
    sftp.close(); c.close()
    return data

def write_remote(remote_path, content):
    c = client()
    sftp = c.open_sftp()
    with sftp.open(remote_path, "wb") as f:
        f.write(content.encode("utf-8"))
    sftp.close(); c.close()

def docker_rebuild_dev(timeout=600):
    """Stop, build, restart yg1-ai-catalog-app-dev. Returns True if healthy."""
    print(f"[vm] docker rebuild dev — start {time.strftime('%H:%M:%S')}")
    out, err, code = run(
        f"cd {DEV_DIR} && sudo docker compose -f docker-compose.yml up -d --build app 2>&1 | tail -25",
        timeout=timeout,
    )
    print(f"[vm] build exit={code}")
    return code == 0

def wait_ready(max_wait=120):
    """Wait until /api/recommend responds 200."""
    import json, urllib.request
    payload = json.dumps({}).encode()
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            req = urllib.request.Request(f"{DEV_URL}/api/recommend", data=payload,
                                          headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=5)
            print(f"[vm] ready ({int(deadline-time.time())}s left)")
            return True
        except Exception:
            time.sleep(2)
    print("[vm] NOT ready after", max_wait, "s")
    return False

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "ping"
    if cmd == "ping":
        run("hostname && uname -a")
    elif cmd == "rebuild":
        ok = docker_rebuild_dev()
        if ok: wait_ready()
    elif cmd == "ready":
        wait_ready()
    elif cmd == "exec":
        run(" ".join(sys.argv[2:]))
