# Extract FOMC statement (announcement) dates from saved federalreserve.gov calendar pages in research/fx/fed/.
# Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm and fomchistorical<year>.htm
# Each meeting is a panel; its statement link is .../pressreleases/monetaryYYYYMMDDa.htm. A panel whose heading says
# "unscheduled" (or a calendars-page entry marked unscheduled) is flagged, since the FOMC-day paper uses scheduled only.
# Output: research/fx/fomc-dates.json  [{date, scheduled}]
#   python3 -I scripts/fed-dates.py
import re, json, glob, os

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "research", "fx")
MONTHS = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}
BAD = re.compile(r"unscheduled|notation vote|cancelled|conference call", re.I)
out = {}
# Historical pages (2005-2020): headings like "January 26-27 Meeting - 2016" / "March 2 (unscheduled) Meeting - 2020".
# A scheduled meeting's decision is announced on its LAST day.
for path in sorted(glob.glob(os.path.join(D, "fed", "fomchistorical*.htm"))):
    html = open(path, encoding="utf-8", errors="replace").read()
    for h in re.findall(r"<h[45][^>]*>([^<]*(?:Meeting|Conference Call|notation vote)[^<]*- *20\d\d)", html):
        # "Jan/Feb 31-1 Meeting" spans two months: the last day is in the SECOND month (abbreviated names).
        h = re.sub(r"^\s*[A-Z][a-z]+/([A-Z][a-z]+)", lambda x: next(k for k in MONTHS if k.startswith(x.group(1))), h)
        m = re.match(r"\s*([A-Z][a-z]+)\s+(?:\d+-)?(\d+)\b.*?(20\d\d)", h)
        if not m or m.group(1) not in MONTHS: continue
        iso = f"{m.group(3)}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"
        out[iso] = not BAD.search(h)
# Current calendars page (2021+): each meeting row has the statement link; skip rows marked unscheduled/notation/cancelled.
html = open(os.path.join(D, "fed", "fomccalendars.htm"), encoding="utf-8", errors="replace").read()
for b in re.split(r'<div class="(?:fomc-meeting--shaded )?row fomc-meeting"', html)[1:]:
    date_field = re.search(r'fomc-meeting__date[^>]*>([^<]*)', b)
    for d in re.findall(r"monetary(20\d{6})a\.htm", b):
        iso = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        if iso[:4] >= "2021": out[iso] = not (date_field and BAD.search(date_field.group(1)))
# Upcoming meetings have no statement link yet: take them from the calendars page's month/date fields, by year section.
for ysec in re.split(r"(?=\b20\d\d FOMC Meetings)", html)[1:]:
    year = ysec[:4]
    for mon, dd in re.findall(r'fomc-meeting__month[^>]*><strong>([^<]*)</strong>.*?fomc-meeting__date[^>]*>([^<]*)<', ysec, re.S):
        if "/" in mon: mon = next(k for k in MONTHS if k.startswith(mon.split("/")[1]))
        if mon not in MONTHS: continue
        m = re.match(r"\s*(?:\d+-)?(\d+)", dd)
        if not m: continue
        iso = f"{year}-{MONTHS[mon]:02d}-{int(m.group(1)):02d}"
        if iso not in out: out[iso] = not BAD.search(dd)
dates = [{"date": k, "scheduled": v} for k, v in sorted(out.items())]
json.dump({"source": "federalreserve.gov FOMC calendars (statement links)", "dates": dates}, open(os.path.join(D, "fomc-dates.json"), "w"), indent=0)
print(len(dates), "statements;", sum(not x["scheduled"] for x in dates), "unscheduled:", [x["date"] for x in dates if not x["scheduled"]])
by = {}
for x in dates: by.setdefault(x["date"][:4], 0); by[x["date"][:4]] += x["scheduled"]
print("scheduled per year:", by)
print("last 3:", dates[-3:])
