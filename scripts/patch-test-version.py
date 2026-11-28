import re
import sys
from pathlib import Path
base = Path(sys.argv[1] if len(sys.argv) > 1 else r"dist\update test\resources\app")
for name in ("app.js", "server.mjs"):
    p = base / name
    s = p.read_text(encoding="utf-8")
    s2 = re.sub(r"APP_VERSION\s*=\s*'1\.4\.\d+'", "APP_VERSION = '1.4.0'", s, count=1)
    p.write_text(s2, encoding="utf-8")
    print(name, "changed" if s2 != s else "UNCHANGED")
