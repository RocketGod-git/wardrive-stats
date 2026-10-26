#!/usr/bin/env python3
"""
ONE-OFF: register the GA4 custom dimensions the "Fun data" cards need, via the Google Analytics ADMIN API.
Run from CI (see .github/workflows/register_dims.yml, workflow_dispatch only) with the SAME two secrets the
stats fetch uses: GA4_SA (service-account JSON) and GA4_PROPERTY_ID (numeric property id).

GA4 only reports a custom event parameter / user property once it is registered as a custom dimension, and
registration is NOT retroactive — data starts collecting from the moment a dimension exists. So run this once,
early. It is idempotent: it lists what is already registered and only creates what's missing (keyed on
scope + parameter name), so re-running is harmless.

Needs WRITE access: the service account must hold the "Editor" role on the GA4 property (the stats fetch only
needs "Viewer"), and the "Google Analytics Admin API" must be enabled in the service account's Cloud project.
If either is missing the script prints exactly what to fix — and the full dimension list, so they can also be
created by hand in GA Admin -> Custom definitions.

Usage:  python scripts/register_dims.py [--dry-run]
"""
import json
import os
import sys

from google.oauth2 import service_account
from google.analytics.admin_v1beta import AnalyticsAdminServiceClient
from google.analytics.admin_v1beta.types import CustomDimension
from google.api_core import exceptions as gexc

USER, EVENT = CustomDimension.DimensionScope.USER, CustomDimension.DimensionScope.EVENT

# (scope, parameter name, display name, description). Display names must be unique per property and may only use
# letters, digits, spaces and underscores — so a parameter that exists in BOTH scopes (adapter, skin) gets a
# distinct display name per scope. Parameter names must match the app exactly (core/Metrics.kt call sites).
DIMS = [
    # ---- USER-scoped (Metrics.userProp) ----
    (USER, "adapter", "User adapter", "External WiFi adapter label, or phone if none"),
    (USER, "has_ext_adapter", "Has ext adapter", "true when an external WiFi adapter is in use"),
    (USER, "android_api", "Android API level", "Android SDK_INT"),
    (USER, "app_version", "User app version", "App versionName"),
    (USER, "skin", "User theme", "Selected app theme (Skin enum name)"),
    (USER, "dark_map", "Dark map", "Dark basemap on or off"),
    (USER, "reduce_motion", "Reduce motion", "Reduce motion on or off"),
    (USER, "upload_targets", "Upload targets", "Enabled upload services, e.g. wigle+wdgw+wardrift or none"),
    (USER, "alerts_off", "Alerts off count", "How many notable alert switches are turned off"),
    # ---- EVENT-scoped (Metrics.event params) ----
    (EVENT, "category", "Notable category", "notable_spotted / notable_aircraft category"),
    (EVENT, "lane", "Threat lane", "notable_spotted threat lane"),
    (EVENT, "ua_type", "Drone UA type", "drone_detected Remote ID aircraft type"),
    (EVENT, "has_operator", "Drone has operator", "drone_detected: operator position broadcast"),
    (EVENT, "adapter", "Engaged adapter", "adapter_engaged adapter label"),
    (EVENT, "tool", "Tool", "tool_opened tool name"),
    (EVENT, "tool_ord", "Tool ordinal", "tool_opened tool ordinal"),
    (EVENT, "kind", "Kind", "kind param: capture / secret_unlock / export / chat_sent / device_used"),
    (EVENT, "skin", "Theme set", "theme_set theme"),
    (EVENT, "format", "Export format", "export file format"),
    (EVENT, "scope", "Export scope", "export time frame"),
    (EVENT, "reply", "Chat reply", "chat_sent: message was a reply"),
    (EVENT, "cat", "Notif category", "notif_toggle NotablePrefs id"),
    (EVENT, "what", "Notif switch", "notif_toggle switch: list or alert"),
    (EVENT, "on", "Notif on", "notif_toggle new state: on or off"),
    (EVENT, "src", "Stats source", "chat_stats_view source: wdgw or wigle"),
    # Already sent by the app today (sdr_connected{source}, upload{target}) — registered so those cards fill too.
    (EVENT, "source", "SDR source", "sdr_connected SDR type"),
    (EVENT, "target", "Upload target", "upload service"),
    (EVENT, "new", "Capture new", "capture: yes = first time this phone captured it"),
    (EVENT, "device", "Device", "device_used device model"),
    (EVENT, "lang", "App language", "language_set language tag, or system"),
    (EVENT, "bank", "Export bank", "export: run banked after the export, true or false"),
    (EVENT, "brand", "Notable brand", "notable_spotted maker label from the app's tables, e.g. Lovense or Flock"),
]

SCOPE_NAME = {USER: "USER", EVENT: "EVENT"}
API = {USER: "customUser", EVENT: "customEvent"}


def table():
    w = max(len(d[1]) for d in DIMS)
    lines = [f"  {'SCOPE':<6} {'PARAMETER / USER PROPERTY':<{max(w, 25)}}  DISPLAY NAME"]
    for sc, pn, dn, _ in DIMS:
        lines.append(f"  {SCOPE_NAME[sc]:<6} {pn:<{max(w, 25)}}  {dn}")
    return "\n".join(lines)


def summary(md):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(md + "\n")


def manual_help(reason):
    msg = (f"\n{reason}\n\nFix (pick one):\n"
           "  A) GA Admin -> Property access management -> the service account's email (client_email in GA4_SA)\n"
           "     -> change its role from Viewer to **Editor**, then re-run this workflow. (You can drop it back to\n"
           "     Viewer afterwards — the stats fetch only reads.)\n"
           "  B) Register them by hand: GA Admin -> Data display -> Custom definitions -> Create custom dimension,\n"
           "     one per row below (Scope / Event parameter or User property / Dimension name):\n\n" + table())
    print(msg)
    print("::error::Custom dimensions NOT registered — the service account needs Editor on the GA4 property "
          "(or create them manually; see the log / job summary).")
    rows = "\n".join(f"| {SCOPE_NAME[s]} | `{p}` | {d} |" for s, p, d, _ in DIMS)
    summary(f"### Custom dimensions NOT registered\n\n{reason}\n\nGrant the service account **Editor** on the GA4 "
            f"property and re-run, or create these in GA Admin -> Custom definitions:\n\n"
            f"| Scope | Parameter / user property | Display name |\n|---|---|---|\n{rows}\n")


def main():
    dry = "--dry-run" in sys.argv[1:]
    raw = os.environ.get("GA4_SA", "").strip()
    pid = os.environ.get("GA4_PROPERTY_ID", "").strip().replace("properties/", "")
    if not raw or not pid:
        print("GA4_SA / GA4_PROPERTY_ID not set — nothing to do. Dimensions this script would register:\n" + table())
        sys.exit(78)
    parent = f"properties/{pid}"
    creds = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=["https://www.googleapis.com/auth/analytics.edit"])
    c = AnalyticsAdminServiceClient(credentials=creds)

    try:
        existing = list(c.list_custom_dimensions(parent=parent))
    except gexc.PermissionDenied as e:
        text = str(e)
        if "has not been used" in text or "SERVICE_DISABLED" in text or "is disabled" in text:
            print(f"! {e}")
            print("\nThe Google Analytics ADMIN API is not enabled for the service account's Cloud project.\n"
                  "Enable it: Google Cloud Console -> APIs & Services -> Library -> \"Google Analytics Admin API\" "
                  "-> Enable, wait a minute, then re-run.\n\nDimensions to register:\n" + table())
            print("::error::Google Analytics Admin API is disabled for the service account's project.")
            summary("### Custom dimensions NOT registered\n\nEnable the **Google Analytics Admin API** in the "
                    "service account's Cloud project, then re-run.\n")
            sys.exit(1)
        manual_help(f"! Permission denied listing custom dimensions on {parent}: {e}")
        sys.exit(1)

    have = {(d.scope, d.parameter_name) for d in existing}
    names = {d.display_name for d in existing}
    print(f"{parent}: {len(existing)} custom dimension(s) already registered:")
    for d in sorted(existing, key=lambda d: (d.scope, d.parameter_name)):
        print(f"  = {SCOPE_NAME.get(d.scope, d.scope)} {d.parameter_name}  ({d.display_name})")

    created, skipped, failed = [], [], []
    for sc, pn, dn, desc in DIMS:
        key = f"{API[sc]}:{pn}"
        if (sc, pn) in have:
            skipped.append(key)
            print(f"  - skip   {key} (already registered)")
            continue
        if dn in names:   # display name taken by some other dimension -> disambiguate rather than fail
            dn = f"{dn} {SCOPE_NAME[sc].lower()}"
        if dry:
            print(f"  + would create {key}  \"{dn}\"")
            created.append(key)
            continue
        try:
            c.create_custom_dimension(parent=parent, custom_dimension=CustomDimension(
                parameter_name=pn, display_name=dn, description=desc, scope=sc))
            names.add(dn)
            created.append(key)
            print(f"  + created {key}  \"{dn}\"")
        except gexc.PermissionDenied as e:
            manual_help(f"! Permission denied creating {key}: {e}")
            sys.exit(1)
        except gexc.AlreadyExists as e:   # e.g. an ARCHIVED dimension with this parameter (not in the list)
            skipped.append(key)
            print(f"  - skip   {key} (already exists: {e.message})")
        except gexc.GoogleAPICallError as e:
            failed.append((key, str(e)))
            print(f"  ! FAILED {key}: {e}")

    verb = "would create" if dry else "created"
    print(f"\nDone: {verb} {len(created)}, already present {len(skipped)}, failed {len(failed)}.")
    summary(f"### Custom dimensions\n\n{verb.capitalize()} **{len(created)}**, already present **{len(skipped)}**, "
            f"failed **{len(failed)}**.\n\n" + "".join(f"- {verb} `{k}`\n" for k in created)
            + "".join(f"- FAILED `{k}`: {m}\n" for k, m in failed))
    if failed:
        print("Some dimensions failed — create them by hand in GA Admin -> Custom definitions:\n" + table())
        sys.exit(1)


if __name__ == "__main__":
    main()
