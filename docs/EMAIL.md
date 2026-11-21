# Official email notifications — Gmail and free alternatives

**Status:** implemented as an optional provider-backed HTTPS API sender, disabled by default. It does not ask ChatGPT to send emails and does not require a paid SDK or new running mail-server container. Configure exactly one provider through server environment variables. Never put credentials in frontend code, GitHub, invitation URLs or logs.

## Recommendation

| Provider | Published free allowance (November 2026) | Configuration and limitations |
| --- | --- | --- |
| **Personal Gmail / Gmail API** | Free personal Gmail sending, subject to Google's standard daily sending cap (typically around **500 messages/day**) | Can send from the existing admin Gmail address, but needs a Google Cloud project, Gmail API enabled, OAuth 2.0 user authorization with `gmail.send` scope, a refresh token and Google verification/testing configuration as applicable; credentials must be private |
| **Brevo transactional API** | **300 email sends/day** on free tier | Easier automated sending. Create account, configure approved sender and domain and use a Brevo API key. Cannot generally impersonate an arbitrary `@gmail.com` address as a verified sender |
| **Resend transactional API** | **3,000/month**, maximum **100/day**, free tier | Simple HTTPS API, but domain verification and approved `from` address are normally required |

Current authoritative pages: [Google SMTP sending limits](https://developers.google.com/workspace/gmail/imap/imap-smtp), [Gmail API send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [Gmail `gmail.send` scope](https://developers.google.com/workspace/gmail/api/auth/scopes), [Brevo free plan](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [Resend pricing](https://resend.com/pricing).

### Option A — use the operator's Gmail address

1. Register or designate the global operator account using `ADMIN_EMAIL=operator@gmail.com` and a strong `ADMIN_BOOTSTRAP_KEY` (as in the main README).
2. In Google Cloud Console, create/configure an OAuth consent screen and an OAuth 2.0 desktop or web application. Enable Gmail API. Authorize the **same Gmail account** with only `https://www.googleapis.com/auth/gmail.send`, following Google's current testing or verification requirements.
3. Obtain a legitimate refresh token using the OAuth authorization-code flow; set environment variables only on the backend server:

   ```dotenv
   MAIL_PROVIDER=gmail
   MAIL_FROM=operator@gmail.com
   APP_PUBLIC_URL=https://your-gridlock.example
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   GMAIL_REFRESH_TOKEN=...
   MAIL_ENCRYPTION_KEY=<64-hex-chars>
   ```

4. Redeploy the backend and verify your own inbox via the account notification panel. Use the global operator's `/api/admin/mail` status or the operator-triggered `/api/admin/mail/sync` reconciliation action for delivery troubleshooting.

Never put a Gmail password, app password or refresh token in frontend environment variables. The implementation uses OAuth2 **refresh tokens**, not basic username/password SMTP. Google's sending quotas, OAuth-testing expiry and consent/verification requirements apply. If account verification is not completed, Google may restrict the number of authorized users or refresh token longevity.

### Option B — Brevo free tier (recommended if you have an approved sending domain)

```dotenv
MAIL_PROVIDER=brevo
MAIL_FROM=notifications@yourverifieddomain.example
BREVO_API_KEY=...
APP_PUBLIC_URL=https://your-gridlock.example
MAIL_ENCRYPTION_KEY=<64-hex-chars>
```

The app uses `POST https://api.brevo.com/v3/smtp/email`. Sender authorization and free-plan quotas apply. This does not send **from** the operator's Gmail address unless the sending provider explicitly authorizes that sender; you can still set replies to be handled externally with a separate address in future.

### Option C — Resend free tier

```dotenv
MAIL_PROVIDER=resend
MAIL_FROM=GRIDLOCK@yourverifieddomain.example
RESEND_API_KEY=...
APP_PUBLIC_URL=https://your-gridlock.example
MAIL_ENCRYPTION_KEY=<64-hex-chars>
```

The app uses `POST https://api.resend.com/emails`. Verify the domain/sender with Resend; observe the daily and monthly quotas.

### Reliability and privacy

- Email jobs persist in an append-only SQLite-backed queue; sensitive bodies and verification tokens are AES-256-GCM encrypted at rest. `MAIL_ENCRYPTION_KEY` or the existing encrypted-backup key is required when email is enabled. Do **not** rotate this key without migrating or clearing pending mail because existing ciphertext would become unreadable.
- Outbox jobs are retried with exponential backoff and a max-attempt threshold. Sending is **at least once**, and provider acceptance followed by process failure may yield duplicates.
- Server UTC deadlines and scoring do not depend on live email delivery. The startup/periodic notification sweeper catches up post-lock messages for recently locked forms after the server was offline. It does **not** retroactively admit late picks.
- Registration is available without email configuration. With mail enabled, a user confirms their inbox through a one-time hashed proof link. Until then, tournament notifications are suppressed to prevent spam and impersonation. Opt-out is per account.
- Invitation-by-username remains functional without email; the invited user sees the request in the app and accepts or declines. An existing participant never needs to give the commissioner their email address.
- Client-facing emails contain **links** to tournament-level public picks and standings once the lock expires; they do not embed every competitor's detailed ballot, financial metadata or email addresses.
- Confirmed payout emails contain a **calculated entitlement only**, not money-transfer confirmation. Admins must reconcile the real-world payments externally.

### Important operational prerequisites

Set `PUBLIC_ORIGIN` to the actual frontend HTTPS origin for CSRF validation, and `APP_PUBLIC_URL` to the same externally accessible HTTPS base for links. Use a trusted reverse proxy; do not expose the API or SQLite database directly. Avoid running multiple workers against one SQLite database. Mail provider free tiers can change, and a burst of 300 tournament notifications may exceed the provider's quota even when the rest of the application is healthy.
