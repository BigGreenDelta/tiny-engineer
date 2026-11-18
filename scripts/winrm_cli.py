"""Small WinRM client for scripts/deploy-broker.sh.

Run with: uv run --no-project --with pywinrm python scripts/winrm_cli.py <command>

Commands:
  ps                       run the PowerShell script on stdin
  wsl <distro> <user>      run the bash script on stdin inside a WSL distro
  upload <local> <remote>  copy a file (chunked: WinRM caps the command line)

Connection from the environment: WINRM_URL (http://host:5985/wsman),
WINRM_USER, WINRM_PASS. NTLM, so the traffic is encrypted on plain HTTP.
"""

import base64
import os
import sys

import winrm

CHUNK = 2000


def session() -> winrm.Session:
    return winrm.Session(
        os.environ["WINRM_URL"],
        auth=(os.environ["WINRM_USER"], os.environ["WINRM_PASS"]),
        transport="ntlm",
    )


def run_ps(s: winrm.Session, script: str) -> int:
    r = s.run_ps(script)
    sys.stdout.write(r.std_out.decode("utf-8", "replace"))
    if r.status_code:
        sys.stderr.write(r.std_err.decode("utf-8", "replace")[-3000:])
    return r.status_code


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
        b64 = base64.b64encode(sys.stdin.read().encode()).decode()
        # The script goes through a file: the WinRM command line is short.
        tmp = "$env:TEMP\\winrm-wsl.b64"
        s.run_ps(f"Remove-Item -Force {tmp} -ErrorAction SilentlyContinue")
        for i in range(0, len(b64), CHUNK):
            s.run_ps(f"Add-Content -NoNewline -Path {tmp} -Value '{b64[i:i + CHUNK]}'")
        return run_ps(
            s,
            '$ProgressPreference = "SilentlyContinue"\n'
            f"$p = wsl -d {ps_quote(distro)} -u {ps_quote(user)} -- wslpath -u ($env:TEMP + '\\winrm-wsl.b64').Replace('\\','/')\n"
            f"wsl -d {ps_quote(distro)} -u {ps_quote(user)} -- bash -c \"base64 -d $p | bash -l; rc=`$?; rm -f $p; exit `$rc\" 2>&1 | Out-String\n"
            "exit $LASTEXITCODE\n",
        )

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
