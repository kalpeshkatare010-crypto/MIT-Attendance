# MIT Attendance

An Android app for students of MIT, Chhatrapati Sambhajinagar. It logs in to the college ERP (erp.mit.asia) and shows only your attendance, clearly. Subjects below 75% are flagged first.

Developed by **Kalpesh Katare**.

## Features (v1)

- Log in with your ERP email ID and password, plus the email OTP when the ERP asks for one
- Home: average attendance and the subjects below 75%
- All subjects: attendance %, sessions done %, code and credits
- Subject detail: faculty, credits, attendance ring and session progress
- Auto refresh from the ERP, plus alerts when a subject drops below your target
- Your password is kept only in the phone's secure storage

## Design

College palette, taken from the official MIT CSN logo:

| Role | Colour |
|---|---|
| Teal (primary) | `#055B6F` / deep `#053F4D` |
| Orange (accent) | `#DD7945` |
| Light | `#E8F0F2`, `#FFFFFF` |

The screen designs are in [`design/`](design/). They are viewable on the design canvas:
https://claude.ai/artifact/A5YHQbKunwuqdxKKdxATHx

## Install

Open the latest release on GitHub on your phone, download **MIT-Attendance.apk**, and open it.
Android may ask you to allow installs from your browser or file manager. Allow it once.

Every push to `main` builds a new APK automatically (see the Actions tab).

## How it works

- `app/src/main/java/.../MainActivity.kt` is the Android shell. It holds two browsers: the real ERP site, kept hidden, and the app's own screens on top.
- `app/src/main/assets/erp_agent.js` runs inside the ERP page. It fills the login form, notices the email OTP step, opens the attendance page and reads the subject cards.
- `app/src/main/assets/app/index.html` holds all the app screens and animations. Opened in a normal browser, it runs in demo mode with sample data.

If the ERP changes its layout, use **Settings → Report a problem** in the app. It copies what the app saw (never the password) so the reader can be fixed.

## Status

- [x] Screen designs
- [x] ERP login (email + password, OTP)
- [x] Read the attendance page
- [x] Android app build (APK via GitHub Actions)
- [ ] Tested against the live ERP
