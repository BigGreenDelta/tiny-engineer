"""Small WinRM client for scripts/deploy-broker.sh.

Run with: uv run --no-project --with pywinrm python scripts/winrm_cli.py <command>

Commands:
  ps                       run the PowerShell script on stdin
  wsl <distro> <user>      run the bash script on stdin inside a WSL distro;
                           the script goes over WinRM stdin straight into
                           wsl.exe, so a secret in it never touches a file
  upload <local> <remote>  copy a file (chunked: WinRM caps the command line)

Connection from the environment, one of:

- Certificate (no password): WINRM_URL (https://<ip>:5986/wsman) and
  WINRM_CERT_OP_ITEM, a 1Password item reference (op://vault/item) with the
  fields winrm-client-key, winrm-client-cert and winrm-server-cert. They are
  read with `op read` into memory (memfd), never to a file. The server cert is
  the only trust anchor and is checked against the URL host (use the IP from
  its SAN). TLS is capped at 1.2, where WinRM asks for the client cert by
  renegotiation.
- NTLM: WINRM_URL (http://host:5985/wsman), WINRM_USER, WINRM_PASS. The
  traffic is encrypted on plain HTTP.
"""

import base64
import os
import ssl
import subprocess
import sys

import winrm

CHUNK = 2000


def ram_file(item: str, field: str) -> str:
    """`op read` one field into a memfd; returns its /proc path."""
    ref = f"{item.rstrip('/')}/{field}"
    r = subprocess.run(["op", "read", ref], capture_output=True)
    if r.returncode:
        sys.exit(f"error: cannot read {ref} from 1Password: {r.stderr.decode(errors='replace').strip()}")
    fd = os.memfd_create(field, os.MFD_CLOEXEC)
    os.write(fd, r.stdout)
    return f"/proc/self/fd/{fd}"


def session() -> winrm.Session:
    item = os.environ.get("WINRM_CERT_OP_ITEM", "").strip()
    if not item:
        return winrm.Session(
            os.environ["WINRM_URL"],
            auth=(os.environ["WINRM_USER"], os.environ["WINRM_PASS"]),
            transport="ntlm",
        )

    from requests.adapters import HTTPAdapter
    from urllib3.util.ssl_ import create_urllib3_context

    class TLS12(HTTPAdapter):
        def init_poolmanager(self, *args, **kwargs):
            ctx = create_urllib3_context()
            ctx.maximum_version = ssl.TLSVersion.TLSv1_2
            kwargs["ssl_context"] = ctx
            return super().init_poolmanager(*args, **kwargs)

    key = ram_file(item, "winrm-client-key")
    crt = ram_file(item, "winrm-client-cert")
    srv = ram_file(item, "winrm-server-cert")
    s = winrm.Session(
        os.environ["WINRM_URL"],
        auth=(None, None),
        transport="certificate",
        cert_pem=crt,
        cert_key_pem=key,
        server_cert_validation="validate",
        ca_trust_path=srv,
    )
    s.protocol.transport.build_session().mount("https://", TLS12())
    return s


def run_ps(s: winrm.Session, script: str) -> int:
    r = s.run_ps(script)
    sys.stdout.write(r.std_out.decode("utf-8", "replace"))
    if r.status_code:
        sys.stderr.write(r.std_err.decode("utf-8", "replace")[-3000:])
    return r.status_code


def run_wsl(s: winrm.Session, distro: str, user: str, script: bytes) -> int:
    """Run a bash script in WSL, fed to wsl.exe on WinRM stdin (no file)."""
    proto = s.protocol
    shell = proto.open_shell(codepage=65001)
    try:
        # stderr joins stdout inside WSL, so the output keeps its order.
        command = proto.run_command(
            shell,
            "wsl",
            ["-d", distro, "-u", user, "--", "bash", "-c", '"exec bash -l 2>&1"'],
            console_mode_stdin=False,
        )
        proto.send_command_input(shell, command, script, end=True)
        out, err, code = proto.get_command_output(shell, command)
        proto.cleanup_command(shell, command)
    finally:
        proto.close_shell(shell)
    sys.stdout.write(out.decode("utf-8", "replace"))
    if code:
        sys.stderr.write(err.decode("utf-8", "replace")[-3000:])
    return code


def ps_quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    cmd = sys.argv[1]
    s = session()

    if cmd == "ps":
        return run_ps(s, sys.stdin.read())

    if cmd == "wsl" and len(sys.argv) == 4:
        distro, user = sys.argv[2], sys.argv[3]
        return run_wsl(s, distro, user, sys.stdin.buffer.read())

    if cmd == "upload" and len(sys.argv) == 4:
        local, remote = sys.argv[2], sys.argv[3]
        data = base64.b64encode(open(local, "rb").read()).decode()
        r = ps_quote(remote)
        rb = ps_quote(remote + ".b64")
        s.run_ps(f"Remove-Item -Force {rb} -ErrorAction SilentlyContinue")
        for i in range(0, len(data), CHUNK):
            s.run_ps(f"Add-Content -NoNewline -Path {rb} -Value '{data[i:i + CHUNK]}'")
        return run_ps(
            s,
            f"[IO.File]::WriteAllBytes({r}, [Convert]::FromBase64String((Get-Content -Raw {rb})))\n"
            f"Remove-Item {rb}\n",
        )

    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
