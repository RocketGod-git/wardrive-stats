#!/usr/bin/env python3
"""
Fetch aggregate Wardrive Go stats from the Google Analytics Data API (GA4) and write docs/data/stats.json
for the static dashboard. Runs in CI (see .github/workflows/stats.yml). NO secrets live in this repo:
the service-account JSON is injected at runtime via the GA4_SA env var (a GitHub Actions secret) and the
numeric GA4 property id via GA4_PROPERTY_ID.

Only AGGREGATE, non-PII dimensions/metrics are queried (eventName, date, appVersion, country, deviceModel,
OS version, activeUsers, eventCount, sessions, …). No user-level or device-id data.

Each query is isolated: if one report fails (e.g. a custom dimension isn't registered yet) the rest still
produce a valid file.
"""
import json
import os
import sys
from datetime import datetime, timezone

from google.oauth2 import service_account
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange, Dimension, Metric, RunReportRequest, RunRealtimeReportRequest, OrderBy,
)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "stats.json")


def client():
    raw = os.environ.get("GA4_SA", "").strip()
    if not raw:
        print("GA4_SA not set — skipping fetch (dashboard keeps its current data).")
        sys.exit(78)  # neutral: let the workflow treat this as a no-op, not a failure
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


def run():
    c = client()
    p = prop()

    def report(dims, mets, days, limit=25, order_metric=None, order_dim=None):
        ob = []
        if order_metric:
            ob = [OrderBy(metric=OrderBy.MetricOrderBy(metric_name=order_metric), desc=True)]
        elif order_dim:
            ob = [OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name=order_dim))]
        return c.run_report(RunReportRequest(
            property=p,
            dimensions=[Dimension(name=d) for d in dims],
            metrics=[Metric(name=m) for m in mets],
            date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")],
            order_bys=ob, limit=limit,
        ))

    # ---- active users over 1 / 7 / 28 days ----
    def active(days):
        r = c.run_report(RunReportRequest(property=p, metrics=[Metric(name="activeUsers")],
                                          date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")]))
        return int(r.rows[0].metric_values[0].value) if r.rows else 0

    active_block = safe("active", lambda: {
        "d1": active(1), "d7": active(7), "d28": active(28)}, {"d1": 0, "d7": 0, "d28": 0})

    # ---- 28-day totals ----
    def totals():
        r = c.run_report(RunReportRequest(property=p, metrics=[
            Metric(name="eventCount"), Metric(name="sessions"), Metric(name="newUsers"),
            Metric(name="userEngagementDuration")],
            date_ranges=[DateRange(start_date="28daysAgo", end_date="today")]))
        v = r.rows[0].metric_values if r.rows else None
        return {
            "events": int(v[0].value) if v else 0,
            "sessions": int(v[1].value) if v else 0,
            "newUsers": int(v[2].value) if v else 0,
            "engagementMinutes": round(float(v[3].value) / 60) if v else 0,
        }
    totals_block = safe("totals28d", totals, {})

    # ---- event counts (the big table) ----
    def events28d():
        r = report(["eventName"], ["eventCount"], 28, limit=30, order_metric="eventCount")
        return [{"name": x.dimension_values[0].value, "count": int(x.metric_values[0].value)} for x in rows(r)]
    events_block = safe("events28d", events28d, [])

    # ---- daily timeseries: activeUsers + total events + notable_spotted + capture ----
    def timeseries():
        r = report(["date"], ["activeUsers", "eventCount"], 28, limit=400, order_dim="date")
        base = {x.dimension_values[0].value: {
            "date": x.dimension_values[0].value,
            "activeUsers": int(x.metric_values[0].value),
            "events": int(x.metric_values[1].value), "notable": 0, "captures": 0} for x in rows(r)}

        def per_event(name, key):
            rr = c.run_report(RunReportRequest(property=p, dimensions=[Dimension(name="date")],
                metrics=[Metric(name="eventCount")],
                date_ranges=[DateRange(start_date="28daysAgo", end_date="today")],
                dimension_filter=_name_filter(name), limit=400))
            for x in rows(rr):
                d = x.dimension_values[0].value
                if d in base:
                    base[d][key] = int(x.metric_values[0].value)
        safe("ts notable", lambda: per_event("notable_spotted", "notable"), None)
        safe("ts captures", lambda: per_event("capture", "captures"), None)
        out = sorted(base.values(), key=lambda z: z["date"])
        for z in out:  # YYYYMMDD -> YYYY-MM-DD
            if len(z["date"]) == 8:
                z["date"] = f'{z["date"][:4]}-{z["date"][4:6]}-{z["date"][6:]}'
        return out
    ts_block = safe("timeseries", timeseries, [])

    def top(dim, key, limit=6):
        r = report([dim], ["activeUsers"], 28, limit=limit, order_metric="activeUsers")
        return [{key: x.dimension_values[0].value, "users": int(x.metric_values[0].value)} for x in rows(r)]

    versions = safe("versions", lambda: top("appVersion", "version"), [])
    countries = safe("countries", lambda: top("country", "country"), [])
    devices = safe("devices", lambda: top("deviceModel", "model"), [])
    android = safe("android", lambda: top("operatingSystemWithVersion", "os"), [])

    # ---- realtime (last 30 min) ----
    def realtime():
        ru = c.run_realtime_report(RunRealtimeReportRequest(property=p, metrics=[Metric(name="activeUsers")]))
        users = int(ru.rows[0].metric_values[0].value) if ru.rows else 0
        re = c.run_realtime_report(RunRealtimeReportRequest(property=p,
            dimensions=[Dimension(name="eventName")], metrics=[Metric(name="eventCount")],
            order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="eventCount"), desc=True)], limit=12))
        evs = [{"name": x.dimension_values[0].value, "count": int(x.metric_values[0].value)} for x in rows(re)]
        return {"activeUsers": users, "events": evs}
    rt_block = safe("realtime", realtime, {"activeUsers": 0, "events": []})

    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "realtime": rt_block, "active": active_block, "totals28d": totals_block,
        "events28d": events_block, "timeseries": ts_block,
        "versions": versions, "countries": countries, "devices": devices, "android": android,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {OUT}: {len(events_block)} event types, {len(ts_block)} days, "
          f"realtime users={rt_block.get('activeUsers')}")


def _name_filter(event_name):
    from google.analytics.data_v1beta.types import Filter, FilterExpression
    return FilterExpression(filter=Filter(field_name="eventName",
        string_filter=Filter.StringFilter(value=event_name)))


if __name__ == "__main__":
    run()
