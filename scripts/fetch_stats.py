#!/usr/bin/env python3
"""
Fetch aggregate Wardrive Go stats from the Google Analytics Data API (GA4) and write docs/data/stats.json for
the static dashboard. Runs in CI (see .github/workflows/stats.yml). NO secrets live in this repo: the
service-account JSON is injected at runtime via GA4_SA (a GitHub Actions secret) and the numeric property id via
GA4_PROPERTY_ID.

Produces a REALTIME block (last 30 min) plus a `ranges` map — 24 hours / 7 / 28 / 90 days — each with the full
aggregate set (active users, totals + engagement quality, events, countries, cities, devices, OS, languages,
new-vs-returning, hour-of-day, day-of-week, top screens, and a daily timeseries) plus a `fun` block of breakdowns
by the app's CUSTOM dimensions (adapters, themes, notable categories, tools, …; registered once by
scripts/register_dims.py — unregistered ones just come back empty). The dashboard switches between them
client-side. Only AGGREGATE, non-PII dimensions are queried. Every report is isolated in safe() so one failure
can't sink the file.
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

from google.oauth2 import service_account
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange, Dimension, Metric, RunReportRequest, RunRealtimeReportRequest, OrderBy, Filter, FilterExpression,
    FilterExpressionList,
)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "stats.json")
RANGES = [(1, "24 hours"), (7, "7 days"), (28, "28 days"), (90, "90 days")]
# The app's custom dimensions were registered on this day; GA4 has no per-type breakdown data before it. Headline
# counts use the plain event totals, which cover the whole selected range.
FUN_SINCE = date(2026, 10, 18)
# Google Play's pre-launch report installs every release on Firebase Test Lab devices, and they count as users: these
# models showed up as ~1,400 one-visit "users" with no city or in Google data-center cities. Every query excludes them.
# (The app turns analytics off on Test Lab devices from 3.1.177.)
BOT_DEVICE_MODELS = ["OnePlus8Pro", "sdk_gphone16k_arm64"]


def client():
    raw = os.environ.get("GA4_SA", "").strip()
    if not raw:
        print("GA4_SA not set — skipping fetch (dashboard keeps its current data).")
        sys.exit(78)
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/analytics.readonly"])
    return BetaAnalyticsDataClient(credentials=creds)


def prop():
    pid = os.environ.get("GA4_PROPERTY_ID", "").strip().replace("properties/", "")
    if not pid:
        print("GA4_PROPERTY_ID not set — skipping fetch.")
        sys.exit(78)
    return f"properties/{pid}"


def safe(label, fn, default):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 — one bad report must not sink the whole file
        print(f"! {label} failed: {e}")
        return default


def rows(resp):
    return resp.rows or []


def no_bots(f=None):
    """[f] AND the device is not a known pre-launch test device."""
    bots = FilterExpression(not_expression=FilterExpression(filter=Filter(field_name="deviceModel",
        in_list_filter=Filter.InListFilter(values=BOT_DEVICE_MODELS))))
    if f is None:
        return bots
    return FilterExpression(and_group=FilterExpressionList(expressions=[f, bots]))


def name_filter(event_name, versions=None):
    f = FilterExpression(filter=Filter(field_name="eventName",
        string_filter=Filter.StringFilter(value=event_name)))
    if not versions:
        return f
    v = FilterExpression(filter=Filter(field_name="appVersion", string_filter=Filter.StringFilter(
        value=versions, match_type=Filter.StringFilter.MatchType.PARTIAL_REGEXP)))
    return FilterExpression(and_group=FilterExpressionList(expressions=[f, v]))


def run():
    c = client()
    p = prop()

    def report(dims, mets, days, limit=25, order_metric=None, order_dim=None, dim_filter=None, start=None):
        ob = []
        if order_metric:
            ob = [OrderBy(metric=OrderBy.MetricOrderBy(metric_name=order_metric), desc=True)]
        elif order_dim:
            ob = [OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name=order_dim))]
        return c.run_report(RunReportRequest(
            property=p,
            dimensions=[Dimension(name=d) for d in dims],
            metrics=[Metric(name=m) for m in mets],
            date_ranges=[DateRange(start_date=start or f"{days}daysAgo", end_date="today")],
            order_bys=ob, limit=limit, dimension_filter=no_bots(dim_filter),
        ))

    def metric1(name, days):
        r = c.run_report(RunReportRequest(property=p, metrics=[Metric(name=name)],
            date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")], dimension_filter=no_bots()))
        return float(r.rows[0].metric_values[0].value) if r.rows else 0.0

    def lst(dim, key, days, limit=8, metric="activeUsers", vk="users"):
        r = report([dim], [metric], days, limit=limit, order_metric=metric)
        out = []
        for x in rows(r):
            v = x.dimension_values[0].value
            if v in ("(not set)", ""):
                v = "Not reported"
            out.append({key: v, vk: int(float(x.metric_values[0].value))})
        return out

    # ---- "Fun data": CUSTOM dimensions (app user properties + event params; registered by register_dims.py) ----
    # Ask GA4 once which custom dimensions exist, so unregistered ones are skipped quietly instead of erroring on
    # every run. If the metadata call itself fails (None), every query is attempted — safe() still absorbs failures.
    def custom_dims():
        md = c.get_metadata(name=f"{p}/metadata")
        return {d.api_name for d in md.dimensions if d.api_name.startswith("custom")}
    custom = safe("metadata", custom_dims, None)
    if custom is not None:
        print(f"custom dimensions registered: {sorted(custom) or 'none'}")

    def brk(dim, start, event=None, limit=10, users=False, versions=None):
        """Top values of one custom dimension since [start] — activeUsers for a user property (or [users]),
        eventCount of [event] for an event param. '(not set)' rows (app versions older than the param) are dropped.
        Unregistered dims → []."""
        if custom is not None and dim not in custom:
            return []
        metric, vk = ("activeUsers", "users") if (users or not event) else ("eventCount", "count")
        r = report([dim], [metric], 0, limit=limit + 1, order_metric=metric, start=start,
                   dim_filter=name_filter(event, versions) if event else None)
        out = []
        for x in rows(r):
            v = x.dimension_values[0].value
            if v in ("(not set)", ""):
                continue
            out.append({"name": v, vk: int(float(x.metric_values[0].value))})
        return out[:limit]

    def ev_metric(event, metric, start, versions=None):
        r = c.run_report(RunReportRequest(property=p, metrics=[Metric(name=metric)],
            date_ranges=[DateRange(start_date=start, end_date="today")], dimension_filter=no_bots(name_filter(event, versions))))
        return int(float(r.rows[0].metric_values[0].value)) if r.rows else 0

    def fun_block(days, label):
        days_start = datetime.now(timezone.utc).date() - timedelta(days=days)
        since = max(days_start, FUN_SINCE).isoformat()

        def f(key, fn):
            return safe(f"{label} fun {key}", fn, [])

        range_start = days_start.isoformat()

        def n(key, event):
            return safe(f"{label} fun count {key}", lambda: ev_metric(event, "eventCount", range_start), 0)

        def chat():
            return {
                "openedUsers": safe(f"{label} chat opened", lambda: ev_metric("chat_opened", "activeUsers", since), 0),
                "senders": safe(f"{label} chat senders", lambda: ev_metric("chat_sent", "activeUsers", since), 0),
                "sent": safe(f"{label} chat sent", lambda: ev_metric("chat_sent", "eventCount", since), 0),
                "byKind": f("chat kind", lambda: brk("customEvent:kind", since, "chat_sent", 6)),
                "replies": f("chat reply", lambda: brk("customEvent:reply", since, "chat_sent", 3)),
                "statsViews": f("chat stats views", lambda: brk("customEvent:src", since, "chat_stats_view", 3)),
            }

        return {
            "since": since,              # breakdowns start here (custom dimensions)
            "rangeStart": range_start,   # headline counts cover the whole selected range
            "counts": {
                "notable": n("notable", "notable_spotted"),
                "captures": n("captures", "capture"),
                "cracked": n("cracked", "capture_cracked"),
                "drones": n("drones", "drone_detected"),
                "aircraft": n("aircraft", "notable_aircraft"),
                "secrets": n("secrets", "secret_unlock"),
            },
            # user properties → active users per value
            "adapters": f("adapters", lambda: brk("customUser:adapter", since, limit=40)),
            "skins": f("skins", lambda: brk("customUser:skin", since, limit=20)),
            "darkMap": f("dark map", lambda: brk("customUser:dark_map", since, limit=3)),
            "uploadTargets": f("upload targets", lambda: brk("customUser:upload_targets", since, limit=10)),
            "alertsOff": f("alerts off", lambda: brk("customUser:alerts_off", since, limit=20)),
            # event params → event counts (SDR → users per radio model)
            "notable": f("notable", lambda: brk("customEvent:category", since, "notable_spotted", 40)),
            "aircraft": f("aircraft", lambda: brk("customEvent:category", since, "notable_aircraft", 8)),
            "drones": f("drones", lambda: brk("customEvent:ua_type", since, "drone_detected", 12)),
            "tools": f("tools", lambda: brk("customEvent:tool", since, "tool_opened", 40)),
            "secrets": f("secrets", lambda: brk("customEvent:kind", since, "secret_unlock", 10)),
            "exportFormats": f("export formats", lambda: brk("customEvent:format", since, "export", 4)),
            "captureKinds": f("capture kinds", lambda: brk("customEvent:kind", since, "capture", 4)),
            "sdr": f("sdr", lambda: brk("customEvent:source", since, "sdr_connected", 10)),
            "captureNew": f("capture new", lambda: brk("customEvent:new", since, "capture", 3)),
            "uploadsBy": f("uploads by", lambda: brk("customEvent:target", since, "upload", 4)),
            "notifToggles": f("notif toggles", lambda: brk("customEvent:cat", since, "notif_toggle", 20)),
            "chat": safe(f"{label} fun chat", chat, {}),
        }

    def range_block(days, label):
        def totals():
            r = c.run_report(RunReportRequest(property=p, metrics=[
                Metric(name="activeUsers"), Metric(name="eventCount"), Metric(name="sessions"),
                Metric(name="newUsers"), Metric(name="userEngagementDuration"), Metric(name="engagementRate")],
                date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")], dimension_filter=no_bots()))
            v = r.rows[0].metric_values if r.rows else None
            au = int(float(v[0].value)) if v else 0
            ev = int(float(v[1].value)) if v else 0
            se = int(float(v[2].value)) if v else 0
            nu = int(float(v[3].value)) if v else 0
            eng = float(v[4].value) if v else 0.0
            er = float(v[5].value) if v else 0.0
            return {"active": au, "events": ev, "sessions": se, "newUsers": nu,
                    "engagementMinutes": round(eng / 60), "avgEngagementSec": round(eng / au) if au else 0,
                    "eventsPerSession": round(ev / se, 1) if se else 0, "engagementRate": round(er * 100)}

        def events():
            r = report(["eventName"], ["eventCount"], days, limit=30, order_metric="eventCount")
            return [{"name": x.dimension_values[0].value, "count": int(float(x.metric_values[0].value))} for x in rows(r)]

        def countries():
            r = report(["country", "countryId"], ["activeUsers"], days, limit=40, order_metric="activeUsers")
            out = []
            for x in rows(r):
                nm = x.dimension_values[0].value
                out.append({"country": "Not reported" if nm in ("(not set)", "") else nm,
                            "code": x.dimension_values[1].value, "users": int(float(x.metric_values[0].value))})
            return out

        def new_returning():
            r = report(["newVsReturning"], ["activeUsers"], days, limit=5)
            o = {"new": 0, "returning": 0}
            for x in rows(r):
                k = x.dimension_values[0].value.lower()
                if k.startswith("new"): o["new"] = int(float(x.metric_values[0].value))
                elif k.startswith("return"): o["returning"] = int(float(x.metric_values[0].value))
            return o

        def hours():
            r = report(["hour"], ["activeUsers"], days, limit=48)
            m = {int(x.dimension_values[0].value): int(float(x.metric_values[0].value)) for x in rows(r)}
            return [{"h": h, "users": m.get(h, 0)} for h in range(24)]

        def weekdays():
            r = report(["dayOfWeek"], ["activeUsers"], days, limit=10)
            m = {int(x.dimension_values[0].value): int(float(x.metric_values[0].value)) for x in rows(r)}
            names = {0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"}
            return [{"d": names[i], "users": m.get(i, 0)} for i in [1, 2, 3, 4, 5, 6, 0]]

        def timeseries():
            if days < 7:
                return []
            r = report(["date"], ["activeUsers", "eventCount"], days, limit=400, order_dim="date")
            base = {x.dimension_values[0].value: {
                "date": x.dimension_values[0].value, "activeUsers": int(float(x.metric_values[0].value)),
                "events": int(float(x.metric_values[1].value)), "notable": 0, "captures": 0} for x in rows(r)}

            def overlay(ev, key):
                rr = report(["date"], ["eventCount"], days, limit=400, dim_filter=name_filter(ev))
                for x in rows(rr):
                    d = x.dimension_values[0].value
                    if d in base: base[d][key] = int(float(x.metric_values[0].value))
            safe("ts notable", lambda: overlay("notable_spotted", "notable"), None)
            safe("ts captures", lambda: overlay("capture", "captures"), None)
            out = sorted(base.values(), key=lambda z: z["date"])
            for z in out:
                if len(z["date"]) == 8:
                    z["date"] = f'{z["date"][:4]}-{z["date"][4:6]}-{z["date"][6:]}'
            return out

        return {
            "label": label,
            "totals": safe(f"{label} totals", totals, {}),
            "newReturning": safe(f"{label} nr", new_returning, {"new": 0, "returning": 0}),
            "events": safe(f"{label} events", events, []),
            "countries": safe(f"{label} countries", countries, []),
            "cities": safe(f"{label} cities", lambda: lst("city", "city", days, 8), []),
            "versions": safe(f"{label} versions", lambda: lst("appVersion", "version", days, 6), []),
            "devices": safe(f"{label} devices", lambda: lst("deviceModel", "model", days, 6), []),
            "android": safe(f"{label} android", lambda: lst("operatingSystemWithVersion", "os", days, 6), []),
            "languages": safe(f"{label} languages", lambda: lst("language", "language", days, 6), []),
            "hours": safe(f"{label} hours", hours, []),
            "weekdays": safe(f"{label} weekdays", weekdays, []),
            "screens": safe(f"{label} screens", lambda: lst("unifiedScreenName", "name", days, 8, "screenPageViews", "views"), []),
            "timeseries": safe(f"{label} ts", timeseries, []),
            "fun": safe(f"{label} fun", lambda: fun_block(days, label), {}),
        }

    # ---- realtime (last 30 min) ----
    def realtime():
        ru = c.run_realtime_report(RunRealtimeReportRequest(property=p, metrics=[Metric(name="activeUsers")]))
        users = int(float(ru.rows[0].metric_values[0].value)) if ru.rows else 0
        re = c.run_realtime_report(RunRealtimeReportRequest(property=p,
            dimensions=[Dimension(name="eventName")], metrics=[Metric(name="eventCount")],
            order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="eventCount"), desc=True)], limit=14))
        evs = [{"name": x.dimension_values[0].value, "count": int(float(x.metric_values[0].value))} for x in rows(re)]

        def rt_countries():
            rc = c.run_realtime_report(RunRealtimeReportRequest(property=p,
                dimensions=[Dimension(name="country"), Dimension(name="countryId")], metrics=[Metric(name="activeUsers")],
                order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="activeUsers"), desc=True)], limit=40))
            out = []
            for x in rows(rc):
                nm = x.dimension_values[0].value
                out.append({"country": "Not reported" if nm in ("(not set)", "") else nm,
                            "code": x.dimension_values[1].value, "users": int(float(x.metric_values[0].value))})
            return out
        return {"activeUsers": users, "events": evs, "countries": safe("rt countries", rt_countries, [])}

    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "realtime": safe("realtime", realtime, {"activeUsers": 0, "events": [], "countries": []}),
        "ranges": {f"{d}d": range_block(d, label) for d, label in RANGES},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    r28 = out["ranges"].get("28d", {})
    print(f"wrote {OUT}: realtime={out['realtime'].get('activeUsers')} users, "
          f"28d active={r28.get('totals', {}).get('active')}, {len(r28.get('events', []))} event types, "
          f"ranges={list(out['ranges'].keys())}")


if __name__ == "__main__":
    run()
