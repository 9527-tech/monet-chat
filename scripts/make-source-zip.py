import os, subprocess, zipfile, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'release', 'monet-chat-1.4.0-source.zip')
files = subprocess.check_output(['toolchain\\git\\cmd\\git.exe', 'ls-files'], cwd=root, text=True).splitlines()
files = [f for f in files if not f.startswith('screenshots/') and not f.startswith('release/')]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        path = os.path.join(root, f.replace('/', os.sep))
        if os.path.isfile(path):
            z.write(path, f)
print(len(files), os.path.getsize(out))
