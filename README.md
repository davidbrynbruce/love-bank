# Love Bank

Fortnightly check-in tracker for David and Beth: each rates the ten emotional needs from *His Needs, Her Needs* (how much it matters, how it's going), picks a top five and writes short notes. The page shows each person's love bank balance over time, per-need gaps, where to focus next, and the full history. Built 2026-11-06, moved off a Claude artifact the same day.

## Live pieces

| Piece | Where |
|---|---|
| Site | https://davidbrynbruce.github.io/love-bank/ (GitHub Pages, repo `davidbrynbruce/love-bank`, single file `index.html`) |
| Database | Supabase project `family-finance`, ref `zijtjfdpvkfdxflutmpc` (shared with the finance app) |
| Table | `public.love_bank_checkins` — one row per person per check-in: `person` (beth/david), `date`, `matters`/`met` (jsonb need→0-10), `rank` (jsonb array of need keys), `notes` (jsonb) |
| Allowlist | `public.love_bank_users` — auth user ids allowed to read/write check-ins |

## Login

- One shared Supabase auth account, `davidbrynbruce+lovebank@gmail.com`; its password is the gate. The page only asks for the password and fills in the email itself.
- RLS on `love_bank_checkins` allows only accounts listed in `love_bank_users`. `anon` has no grants. The shared account is **not** in `family_members`, so it cannot read any finance tables.
- To change the password: Supabase dashboard → family-finance → Authentication → Users → the lovebank user → reset/update password. Sessions persist per device (localStorage key `love-bank-auth`); "Sign out on this device" is in the page footer.

## Updating

Edit `index.html`, commit, push to `main`. Pages redeploys in about a minute.

## Balance formula

For each need with both ratings: sum(matters × going) / sum(matters × 10) × 100.
