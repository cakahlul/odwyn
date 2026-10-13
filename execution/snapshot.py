#!/usr/bin/env python3
"""Copy a bounded snapshot using descriptor-relative, non-following reads."""
import os, stat, sys
source, destination = sys.argv[1:]
remaining = 16 * 1024 * 1024
entries = 4096
excluded = {'.env', '.ssh', '.codex', '.aws', '.docker', '.npmrc', '.gitconfig', '.git-credentials', '.netrc', 'auth.json', 'Cookies', 'state.sqlite', 'odwyn.db', 'odwyn.db-wal', 'odwyn.db-shm', 'sidekick.db', 'sidekick.db-wal', 'sidekick.db-shm', 'id_ed25519', 'id_rsa'}
def copy(fd, output, relative=''):
    global remaining, entries
    if relative.count('/') > 32:
        raise ValueError('Snapshot nesting exceeds bounds')
    for name in os.listdir(fd):
        path = relative + '/' + name
        if name in excluded or name.startswith('.env.') or name.endswith(('.pem', '.key')) or path in ('/.git/config', '/.git/hooks', '/.git/logs'):
            continue
        entries -= 1
        if entries < 0:
            raise ValueError('Snapshot entry count exceeds bounds')
        if any(ord(c) < 32 for c in name):
            raise ValueError('Unsupported snapshot name')
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        child = os.open(name, flags, dir_fd=fd)
        try:
            mode = os.fstat(child).st_mode
            target = os.path.join(output, name)
            if stat.S_ISDIR(mode):
                os.mkdir(target, 0o755)
                copy(child, target, path)
            elif stat.S_ISREG(mode):
                with open(target, 'xb') as out:
                    while True:
                        data = os.read(child, min(65536, remaining + 1))
                        if not data:
                            break
                        remaining -= len(data)
                        if remaining < 0:
                            raise ValueError('Snapshot exceeds 16 MiB')
                        out.write(data)
                os.chmod(target, 0o755 if mode & 0o111 else 0o644)
            else:
                raise ValueError('Unsupported snapshot file type')
        finally:
            os.close(child)
fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    copy(fd, destination)
finally:
    os.close(fd)
