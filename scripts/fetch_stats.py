#!/usr/bin/env python3
"""
Fetch aggregate Wardrive Go stats from the Google Analytics Data API (GA4) and write docs/data/stats.json for
the static dashboard. Runs in CI (see .github/workflows/stats.yml). NO secrets live in this repo: the
service-account JSON is injected at runtime via GA4_SA (a GitHub Actions secret) and the numeric property id via
GA4_PROPERTY_ID.

Produces a REALTIME block (last 30 min) plus a `ranges` map — 24 hours / 7 / 28 / 90 days — each with the full
aggregate set (active users, totals + engagement quality, events, countries, cities, devices, OS, languages,
new-vs-returning, hour-of-day, day-of-week, top screens, and a daily timeseries). The dashboard switches between
them client-side. Only AGGREGATE, non-PII dimensions are queried. Every report is isolated in safe() so one
failure can't sink the file.
"""
import json
import os
import sys
from datetime import datetime, timezone

from google.oauth2 import service_account
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange, Dimension, Metric, RunReportRequest, RunRealtimeReportRequest, OrderBy, Filter, FilterExpression,
)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "stats.json")
RANGES = [(1, "24 hours"), (7, "7 days"), (28, "28 days"), (90, "90 days")]


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


def name_filter(event_name):
    return FilterExpression(filter=Filter(field_name="eventName",
        string_filter=Filter.StringFilter(value=event_name)))


def run():
    c = client()
    p = prop()

    def report(dims, mets, days, limit=25, order_metric=None, order_dim=None, dim_filter=None):
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
            order_bys=ob, limit=limit, dimension_filter=dim_filter,
        ))

    def metric1(name, days):
        r = c.run_report(RunReportRequest(property=p, metrics=[Metric(name=name)],
            date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")]))
        return float(r.rows[0].metric_values[0].value) if r.rows else 0.0

    def lst(dim, key, days, limit=8, metric="activeUsers", vk="users"):
        r = report([dim], [metric], days, limit=limit, order_metric=metric)
        out = []
        for x in rows(r):
            v = x.dimension_values[0].value
            if v in ("(not set)", ""):
                v = "Unknown"
            out.append({key: v, vk: int(float(x.metric_values[0].value))})
        return out

    def range_block(days, label):
        def totals():
            r = c.run_report(RunReportRequest(property=p, metrics=[
                Metric(name="activeUsers"), Metric(name="eventCount"), Metric(name="sessions"),
                Metric(name="newUsers"), Metric(name="userEngagementDuration"), Metric(name="engagementRate")],
                date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")]))
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
                out.append({"country": "Unknown" if nm in ("(not set)", "") else nm,
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
                out.append({"country": "Unknown" if nm in ("(not set)", "") else nm,
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
