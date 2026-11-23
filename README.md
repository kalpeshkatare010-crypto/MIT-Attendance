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

## Status

- [x] Screen designs
- [ ] ERP login (email + password, OTP)
- [ ] Read the attendance page
- [ ] Android app build (APK)
