# Love Bank

Fortnightly check-in tracker for David and Beth: each rates the ten emotional needs from *His Needs, Her Needs* (how much it matters, how it's going), picks a top five and writes short notes. The page shows each person's love bank balance over time, per-need gaps, where to focus next, and the full history. Built 2026-11-06, moved off a Claude artifact the same day.

## Live pieces

| Piece | Where |
|---|---|
| Site | https://davidbrynbruce.github.io/love-bank/ (GitHub Pages, repo `davidbrynbruce/love-bank`, single file `index.html`) |
| Database | Supabase project `family-finance`, ref `zijtjfdpvkfdxflutmpc` (shared with the finance app) |
| Table | `public.love_bank_checkins` — one row per person per check-in: `person` (beth/david), `date`, `matters`/`met` (jsonb need→0-10), `rank` (jsonb array of need keys), `notes` (jsonb) |

## Password gate

- One common password, no user accounts. Its bcrypt hash lives in `public.love_bank_secret` (single row).
- `love_bank_login(p_password)` returns a random session token (or null for a wrong password). Only the token's SHA-256 is stored, in `love_bank_sessions`; sessions lapse after 180 days unused. The page keeps the token in localStorage (`love-bank-session`), so each device stays signed in.
- All reads/writes go through `love_bank_list`, `love_bank_save`, `love_bank_delete` (all require a valid token). `love_bank_logout` ends one session. No table is granted to `anon`/`authenticated`; verified that direct table reads and `love_bank_set_password` are refused from the web.
- Brute-force limit: after 10 wrong passwords in 15 minutes (counted in `love_bank_attempts`) logins are refused until the window passes.
- **Set or change the password** in the Supabase dashboard → family-finance → SQL Editor:
  `select public.love_bank_set_password('the new password');`
  This also signs out every device. The function is not callable through the API. Don't save that query as a snippet.

## Updating

Edit `index.html`, commit, push to `main`. Pages redeploys in about a minute.

## Balance formula

For each need with both ratings: sum(matters × going) / sum(matters × 10) × 100.
