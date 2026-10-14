#!/usr/bin/env python3
"""Read-only identity check between a released .app and its upgrade candidate.
Never launches either app, reads user credentials, or modifies macOS permissions.
"""
import json
import plistlib
import re
import subprocess
import sys
from pathlib import Path


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f"{args[0]} failed: {result.stderr.strip()}")
    return result.stdout + result.stderr


def inspect(path):
    app = Path(path).resolve()
    with (app / "Contents/Info.plist").open("rb") as source:
        info = plistlib.load(source)
    run("codesign", "--verify", "--deep", "--strict", str(app))
    signature = run("codesign", "-dv", "--verbose=4", str(app))
    team = re.search(r"^TeamIdentifier=(.+)$", signature, re.M)
    if not team or team[1] == "not set" or "Authority=Developer ID Application:" not in signature:
        raise ValueError("Upgrade requires a Developer ID signature, not an ad-hoc identity")
    requirement = run("codesign", "-dr", "-", str(app))
    designated = re.search(r"^designated => (.+)$", requirement, re.M)
    if not designated:
        raise ValueError("Missing designated requirement")
    return app, info, team[1], designated[1]


def main():
    if len(sys.argv) != 3:
        raise ValueError("Usage: verify-upgrade-identity.py RELEASED.app CANDIDATE.app")
    old, before, old_team, requirement = inspect(sys.argv[1])
    new, after, new_team, _ = inspect(sys.argv[2])
    if before.get("CFBundleIdentifier") != "com.rottesya.notchspi" or before.get("CFBundleIdentifier") != after.get("CFBundleIdentifier"):
        raise ValueError("Bundle identifier changed; settings and permissions may belong to another app")
    if old_team != new_team:
        raise ValueError("Signing team changed")
    for key in ("CFBundleExecutable", "LSUIElement", "LSMinimumSystemVersion"):
        if before.get(key) != after.get(key):
            raise ValueError(f"Upgrade compatibility needs review: {key} changed")
    schemes = lambda info: {s for item in info.get("CFBundleURLTypes", []) for s in item.get("CFBundleURLSchemes", [])}
    if not schemes(before).issubset(schemes(after)):
        raise ValueError("An existing URL scheme was removed")
    run("codesign", "--verify", "--strict", "-R", "=" + requirement, str(new))
    print(json.dumps({"identity_compatible": True, "baseline_version": before.get("CFBundleShortVersionString"),
        "candidate_version": after.get("CFBundleShortVersionString"), "bundle_id": after["CFBundleIdentifier"],
        "team_id": new_team, "system_permission_retention": "requires macOS in-place upgrade verification"}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, plistlib.InvalidFileException) as error:
        print(f"Upgrade identity check failed: {error}", file=sys.stderr)
        sys.exit(1)
