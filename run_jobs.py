import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
os.makedirs("out", exist_ok=True)
m, lanes = int(sys.argv[1]), int(sys.argv[2])
mine = [j for j in json.load(open("jobs.json")) if j["m"] == m]
print(f"{len(mine)} tukde, {lanes} browser ek saath, {os.cpu_count()} core", flush=True)

def one(j):
    r = subprocess.run([sys.executable, "html_render.py", f"jobs/{j['i']}/page.html", "--duration", str(j["dur"]),
                        "--fps", str(j["fps"]), "--size", j["size"], "--frames", f"{j['a']}:{j['b']}",
                        "--out", f"out/{j['i']}_{j['k']}"])
    print(f"job {j['i']} tukda {j['k']} (frames {j['a']}-{j['b']}): {'ok' if r.returncode == 0 else 'FAIL'}", flush=True)
    return r.returncode != 0

with ThreadPoolExecutor(lanes) as ex:
    bad = sum(ex.map(one, mine))
sys.exit(1 if bad else 0)
