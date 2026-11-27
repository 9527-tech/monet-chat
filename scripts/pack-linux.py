import os
import tarfile

SRC = 'dist-linux/linux-unpacked'
OUT = 'release/MonetChat-1.3.0-linux-x64.tar.gz'
os.makedirs('release', exist_ok=True)

with tarfile.open(OUT, 'w:gz', compresslevel=6) as tar:
    for root, dirs, files in os.walk(SRC):
        dirs.sort()
        files.sort()
        for name in dirs + files:
            full = os.path.join(root, name)
            arc = os.path.join('linux-unpacked', os.path.relpath(full, SRC))
            try:
                info = tar.gettarinfo(full, arcname=arc)
            except OSError:
                continue
            if info.isfile():
                info.mode = 0o755
                with open(full, 'rb') as fh:
                    tar.addfile(info, fh)
            elif info.isdir():
                info.mode = 0o755
                tar.addfile(info)
            elif info.issym():
                tar.addfile(info)
print(os.path.getsize(OUT))
