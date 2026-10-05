# Deploying Dumping Tool for $0

This guide sets up a fully working public deployment using only free tiers:

| Piece | Service (free tier) | What it's for |
|---|---|---|
| Code | **GitHub** | Repository that Render deploys from |
| App server | **Render**: free web service (Docker) | Runs the dashboard, scheduler and dump tools |
| App database | **MongoDB Atlas**: M0 (512 MB, free forever) | Users, jobs, dump history |
| Dump files | **Backblaze B2**: 10 GB free, no card needed | Stores the `.sql.gz` files |
| Email | **Brevo**: 300 emails/day free | "Backup ready / failed" notifications |
| Keep-alive | **cron-job.org**: free | Pings the app so scheduled runs fire on time |

> **Why these?** Render's free instances have no persistent disk, so dumps must go to object storage (B2). Render's free tier also [blocks outbound SMTP ports](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports), so email goes over HTTPS through Brevo. Finally, free instances sleep after 15 minutes without traffic. A ping every 10 minutes keeps the instance awake. Even without the ping, any run missed while asleep executes as soon as the app wakes up.

Total time: about 30–40 minutes.

---

## Step 1: Push the code to GitHub

1. Go to <https://github.com/new>. Create a repository named `dumping-tool`, set it to **Private** (recommended), and **don't** add a README.
2. In a terminal:

   ```bash
   cd C:\Users\PC\Desktop\dumping-tool
   git remote add origin https://github.com/<your-username>/dumping-tool.git
   git push -u origin main
   ```

`.env` is git-ignored, so no secrets are pushed.

## Step 2: Create the MongoDB Atlas database

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a cluster**, choose **M0 Free**, pick a region close to your Render region (e.g. AWS Mumbai / Singapore), and create it.
3. **Database Access** → *Add new database user*. Choose username/password auth and generate a strong password. Save the password.
4. **Network Access** → *Add IP address* → **Allow access from anywhere (`0.0.0.0/0`)**. Render's free tier has no fixed IP, so this is required. Access is still protected by the user/password.
5. **Connect** → *Drivers* → copy the connection string. Add the database name `dumping_tool` after `.net/`:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/dumping_tool?retryWrites=true&w=majority
   ```

   This is your **`MONGO_URI`**. If the password has special characters, URL-encode them (e.g. `@` → `%40`).

## Step 3: Create a Backblaze B2 bucket (dump storage)

1. Sign up at <https://www.backblaze.com/sign-up/cloud-storage>. The first 10 GB are free.
2. **Buckets** → *Create a Bucket*:
   - Name: something unique, e.g. `yourname-db-dumps`
   - Files in bucket: **Private**
   - Encryption: enable
3. On the bucket card, note the **Endpoint**, e.g. `s3.us-east-005.backblazeb2.com`. The region is the middle part: `us-east-005`.
4. **Application Keys** → *Add a New Application Key*:
   - Allow access to: your bucket only
   - Type of access: Read and Write
   - Copy the **keyID** and **applicationKey**. The key is only shown once.

You now have:

```
S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
S3_REGION=us-east-005
S3_BUCKET=yourname-db-dumps
S3_ACCESS_KEY_ID=<keyID>
S3_SECRET_ACCESS_KEY=<applicationKey>
```

## Step 4: Set up Brevo for email

1. Sign up at <https://www.brevo.com/>. The free plan allows 300 emails/day.
2. **Senders, Domains & Dedicated IPs** → *Senders* → add the address emails should come from (e.g. your Gmail) and click the verification link Brevo sends you.
3. **SMTP & API** → *API Keys* → *Generate a new API key*. Copy it.

You now have:

```
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-...
EMAIL_FROM=the-sender-you-verified@example.com
```

## Step 5: Deploy on Render

1. Sign up at <https://render.com> with your GitHub account.
2. **New +** → **Blueprint** → select the `dumping-tool` repository. Render reads `render.yaml` and creates a **free Docker web service**.
3. Render asks for the values marked `sync: false`. Fill them in:

   | Key | Value |
   |---|---|
   | `MONGO_URI` | from Step 2 |
   | `ADMIN_EMAIL` | the email you'll log in with |
   | `ADMIN_PASSWORD` | a strong password (you can change it later in *Settings*) |
   | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from Step 3 |
   | `BREVO_API_KEY`, `EMAIL_FROM` | from Step 4 |

   `JWT_SECRET` and `ENCRYPTION_KEY` are generated automatically. Open the service's **Environment** tab after deploying and **save a copy of `ENCRYPTION_KEY`** somewhere safe. If it's ever lost or changed, saved database passwords can't be decrypted and must be re-entered.

4. Click **Apply**. The first build takes 3–6 minutes because it installs the PostgreSQL and MySQL client tools.
5. When the service shows **Live**, open its URL, e.g. `https://dumping-tool-xxxx.onrender.com`, and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

   `APP_URL` is detected automatically on Render. If you add a custom domain later, set `APP_URL=https://your-domain` so email links point there.

## Step 6: Keep it awake (so schedules fire on time)

1. Sign up at <https://cron-job.org> (free).
2. **Create cronjob**:
   - URL: `https://dumping-tool-xxxx.onrender.com/healthz`
   - Schedule: every **10 minutes**
3. Save. Render's free plan includes 750 instance-hours per month, which covers one service running 24/7.

## Step 7: Verify everything

1. In the app, go to **Settings → System status**. You should see green **OK** for:
   - PostgreSQL dump tool (`pg_dump 18.x`)
   - MySQL dump tool (`mysqldump … MariaDB`)
   - Storage (s3), meaning the bucket is reachable
   - Email (brevo). Click **Send test** and check your inbox.
2. Go to **Backup jobs → New backup job**, enter a real database, click **Test connection**, pick the database, choose a schedule, add your email, then **Save & run now**.
3. Watch the dump go from **Running** to **Success** live on the **Dumps** page. Check that the email arrives, then click **Download**.

---

## Important: your databases must be reachable

The app connects **from Render's servers**, so the databases you back up must accept connections from the internet:

- **Managed databases** (Supabase, Neon, Aiven, RDS, PlanetScale, Railway, …): use the public host and enable **Require SSL/TLS** in the job.
- **Databases behind a firewall:** allow Render's outbound IP ranges for your region (Render dashboard → service → *Connect* → *Outbound*), or `0.0.0.0/0` combined with a strong password and SSL.
- **Least privilege:** create a dedicated **read-only backup user**:
  - PostgreSQL: `GRANT pg_read_all_data TO backup_user;` (PG 14+)
  - MySQL: `GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON *.* TO 'backup'@'%';`. On MySQL 8.0.20+, also add `SHOW_ROUTINE` so stored procedures are included.

## Free-tier limits to know

| Limit | Impact |
|---|---|
| Render free: 512 MB RAM, 0.1 CPU | Fine for small/medium databases (up to a few GB). Dumps stream to disk, so RAM usage stays low, but big dumps are slow. |
| Render free: ephemeral disk | Handled: dumps are uploaded to B2 immediately. |
| Atlas M0: 512 MB | Only metadata is stored here, which is plenty. |
| B2: 10 GB free | Use the per-job **retention** slider to cap how many dumps are kept. |
| Brevo: 300 emails/day | More than enough for backup notifications. |

## Alternative: always-on VM (Oracle Cloud Always Free)

If you want a real 24/7 server with persistent disk and no keep-alive tricks, Oracle Cloud's **Always Free** tier gives you an Ampere A1 VM (up to 4 CPUs / 24 GB RAM). A card is required for identity verification, but you aren't charged.

1. Create an **Ubuntu** instance (shape *VM.Standard.A1.Flex*) and add an ingress rule for TCP 80/443 in the VCN security list.
2. SSH in and install Docker: `curl -fsSL https://get.docker.com | sh`
3. `git clone` your repo, then `cp .env.example .env` and fill it in. Keep `STORAGE_DRIVER=local`, since the compose file runs MongoDB and stores dumps on a volume.
4. `docker compose up -d --build`
5. For HTTPS, point a free domain (e.g. DuckDNS) at the VM and put [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy) in front: `caddy reverse-proxy --from yourname.duckdns.org --to localhost:8080`.

## Updating

Push to `main` on GitHub. Render redeploys automatically (`autoDeploy: true`). Running dumps are marked "Interrupted by a server restart" if a deploy happens mid-dump; simply run them again.
