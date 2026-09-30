# Security

## Reporting a problem

Please don't open a public GitHub issue for security problems. Write to the contact
address in the app's legal notice (https://bonwise.onrender.com/impressum) with the
steps to reproduce. You'll get an answer within a week.

## What protects Bonwise

| Risk | Protection | Where |
|---|---|---|
| Someone runs up the AI bill | Scans per visitor per hour (`HOURLY_LIMIT`) and for everyone together (`GLOBAL_HOURLY_LIMIT`); the visitor's address is taken from the right end of `X-Forwarded-For`, which can't be faked | `app.py` (`client_key`, `RateLimiter`) |
| Spam in the community prices | 30 reports per visitor per hour; prices outside €0.05–2,000 dropped | `app.py`, `bonwise/storage.py` |
| Reading someone's household | 12-character random code (about 60 bits); only its hash is stored; data encrypted at rest with a key from the code (+ optional `HOUSEHOLD_SECRET`) | `bonwise/storage.py` |
| Other websites acting as the user | POSTs from other origins are refused | `app.py` (`do_POST`) |
| Injected scripts, clickjacking | Content-Security-Policy (scripts only from this site, no inline scripts), `frame-ancestors 'none'`, HSTS, nosniff | `app.py` (`SECURITY_HEADERS`) |
| Slow or huge requests | 30 s idle timeout per connection, 12 MB body limit | `app.py` |
| Leaking data in logs | Logs hold method, path and status only: no query strings, bodies or IP addresses | `app.py` (`log_request`) |
| Data sent to third parties | Fonts served by Bonwise itself (no Google Fonts); phone talks only to Bonwise and the two OpenStreetMap services named in the CSP | `static/fonts/`, CSP |
| Usage numbers | Daily totals only, no IDs/IPs/cookies; the `/stats` page needs `STATS_KEY` (compared in constant time, 20 tries per hour) | `bonwise/storage.py`, `app.py` (`_stats`) |
| Outages | Hourly live check; a failed run emails the owner | `tools/monitor.py`, `.github/workflows/monitor.yml` |
| Secrets in code | Tokens only in Render's environment settings; turn on GitHub secret scanning and push protection (Settings → Code security) | – |
| Old GitHub Actions | Dependabot updates them weekly | `.github/dependabot.yml` |

Server code uses only the Python standard library, so there are no third-party
packages that could be compromised.

## If data leaks (GDPR Art. 33/34)

1. Stop it: rotate `HF_TOKEN` and `HOUSEHOLD_SECRET` on Render, redeploy.
2. Write down what happened, when, what data and how many people.
3. If personal data may be at risk, report to the data protection authority of your
   German state within 72 hours of finding out (online form of the Landesdatenschutzbeauftragte).
4. If the risk to people is high, tell the affected users directly.
