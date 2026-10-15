#!/usr/bin/env python3
"""Copy a bounded snapshot using descriptor-relative, non-following reads."""
import os, stat, sys, json
source, destination = sys.argv[1:3]
project = len(sys.argv) > 3 and sys.argv[3] == "--project"
protected = [os.path.realpath(path) for path in sys.argv[4:]] if project else []
protected_ids = {(os.stat(path).st_dev, os.stat(path).st_ino) for path in protected if os.path.exists(path)}
files = skipped = 0
remaining = 16 * 1024 * 1024
entries = 4096
excluded = {'.env', '.ssh', '.codex', '.aws', '.docker', '.npmrc', '.gitconfig', '.git-credentials', '.netrc', 'auth.json', 'Cookies', 'state.sqlite', 'odwyn.db', 'odwyn.db-wal', 'odwyn.db-shm', 'sidekick.db', 'sidekick.db-wal', 'sidekick.db-shm', 'id_ed25519', 'id_rsa'}
def copy(fd, output, relative=''):
    global remaining, entries, files, skipped
    if relative.count('/') > 32:
        raise ValueError('Snapshot nesting exceeds bounds')
    for name in os.listdir(fd):
        path = relative + '/' + name
        absolute = os.path.join(source, path.lstrip('/'))
        if project and (name in {'.git', 'node_modules', 'dist', 'build', 'coverage', '.next'} or any(os.path.commonpath([absolute, root]) == root for root in protected)):
            skipped += 1
            continue
        if name in excluded or name.startswith('.env.') or (name.lower() if project else name).endswith(('.pem', '.key')) or path in ('/.git/config', '/.git/hooks', '/.git/logs'):
            skipped += 1
            continue
        entries -= 1
        if entries < 0:
            raise ValueError('Snapshot entry count exceeds bounds')
        if any(ord(c) < 32 for c in name):
            raise ValueError('Unsupported snapshot name')
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        child = os.open(name, flags, dir_fd=fd)
        try:
            info = os.fstat(child)
            mode = info.st_mode
            if project and (info.st_dev, info.st_ino) in protected_ids:
                skipped += 1
                continue
            target = os.path.join(output, name)
            if stat.S_ISDIR(mode):
                os.mkdir(target, 0o755)
                copy(child, target, path)
            elif stat.S_ISREG(mode):
                if project and info.st_nlink != 1:
                    raise ValueError('Project files must not be hard links')
                files += 1
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
if project:
    # Every selected path component is opened without following symlinks.
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in source.split('/')[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        if any(os.path.commonpath([source, root]) == root for root in protected) or (info.st_dev, info.st_ino) in protected_ids:
            raise ValueError('Odwyn private directories cannot be imported')
    except BaseException:
        os.close(fd)
        raise
else:
    fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    copy(fd, destination)
finally:
    os.close(fd)

if project:
    print(json.dumps({'files': files, 'bytes': 16 * 1024 * 1024 - remaining, 'skipped': skipped}))
