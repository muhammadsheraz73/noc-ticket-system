# Going live — 100% free

Two free services, no credit card required:

| Piece | Service | Cost |
|---|---|---|
| Database | MongoDB Atlas **M0** | Free forever |
| App (API + web) | Render **Free** web service | Free forever |

Total: **$0/month**.

---

## Step 1 — Atlas: resume the cluster and get the connection string

1. Open [cloud.mongodb.com](https://cloud.mongodb.com) → your `Cluster0`.
2. If it says *"paused due to prolonged inactivity"*, press **Resume** and wait 1–2 minutes.
3. **Database Access** (left sidebar) → *Add New Database User*
   - Authentication: **Password**
   - Username: e.g. `nocadmin`
   - Password: press **Autogenerate**, then **copy it somewhere safe**
     (or type one *without* the characters `@ : / ? # [ ] %`)
   - Database User Privileges: **Read and write to any database**
   - *Add User*
4. **Network Access** → *Add IP Address* → **ALLOW ACCESS FROM ANYWHERE** → *Confirm*
   > Render's outbound IP changes, so this step is required. Without it every
   > connection fails with a timeout.
5. **Clusters** → **Connect** → **Drivers** → **Node.js**. Copy the string:
   ```
   mongodb+srv://nocadmin:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Edit it twice — this exact shape is what the app needs:
   - replace `<db_password>` with the real password
   - insert the database name `noc_system` before the `?`
   ```
   mongodb+srv://nocadmin:REALPASSWORD@cluster0.xxxxx.mongodb.net/noc_system?retryWrites=true&w=majority
   ```

Keep this string — Step 4 needs it.

---

## Step 2 — Put the code on GitHub

The repository is already initialised and committed locally.

1. Create an account at [github.com](https://github.com) if you do not have one.
2. Go to [github.com/new](https://github.com/new):
   - Repository name: `noc-ticket-system`
   - **Private** is fine (Render can read private repos)
   - Do **not** tick "Add a README" — the repo already has one
   - *Create repository*
3. In a terminal **inside the project folder**, run the two lines GitHub shows you
   (replace `YOUR-USERNAME`):

```bash
git remote add origin https://github.com/YOUR-USERNAME/noc-ticket-system.git
git branch -M main
git push -u origin main
```

A browser window will open the first time to sign you into GitHub.

---

## Step 3 — Seed the Atlas database (once)

From the project folder, with the connection string from Step 1:

```powershell
$env:MONGODB_URI="mongodb+srv://nocadmin:REALPASSWORD@cluster0.xxxxx.mongodb.net/noc_system?retryWrites=true&w=majority"
npm run seed
```

You should see the four demo accounts printed. If instead you get a timeout, revisit
**Network Access** in Step 1.4.

> To move the data already on this laptop instead of seeding fresh:
> `npm run migrate -- --to "<the same connection string>"`

---

## Step 4 — Render: deploy

1. Sign up at [render.com](https://render.com) → **Sign in with GitHub** (no card needed).
2. Dashboard → **New +** → **Blueprint**.
3. Pick the `noc-ticket-system` repository. Render reads `render.yaml` and proposes one web
   service — press **Apply**.
4. Render asks for the values marked `sync: false`. Fill in:
   - `MONGODB_URI` → the connection string from Step 1
   - `ANTHROPIC_API_KEY` → leave **blank** unless you want the AI assistant
5. Press **Create**. The first build takes about 3–5 minutes.

`JWT_SECRET` is generated automatically and stays stable across deploys — you never see or manage it.

When the build finishes you get a public URL:

```
https://noc-ticket-system.onrender.com
```

Open it and sign in with `admin@noc.local` / `Admin@123`.

---

## Step 5 — Secure it (do this immediately)

The seeded accounts are public knowledge — they are in this repository.

1. Sign in as `admin@noc.local`.
2. **Settings → Change password** — set a real admin password.
3. **Users & roles** → create real accounts for your team.
4. **Users & roles** → deactivate `noc@noc.local`, `field@noc.local`, `accounts@noc.local`.

---

## What "free" costs you

Two real limitations, both livable:

**Render free services sleep after 15 minutes of inactivity.** The next visitor waits
**about 50 seconds** for it to wake, then it is fast again while anyone keeps using it. Your data
is never lost — only the app process stops, and Atlas is separate.

**Atlas M0 pauses after ~60 days with no connections** and gives you 512 MB of storage. For this
system 512 MB is roughly a hundred thousand tickets, so storage is not a practical concern.

If the cold start becomes annoying later, Render's Starter plan is $7/month and removes it. Nothing
in the code changes — you just switch the plan.

---

## Updating the live site later

```bash
git add -A
git commit -m "describe the change"
git push
```

Render redeploys automatically on every push to `main`.

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Build fails on Render | Node version or install error | Open the **Logs** tab — the failing command is printed |
| Site loads, login says "Cannot reach the API" | App started before Atlas was reachable | Check `MONGODB_URI` in Render → *Environment* |
| Login returns a server error | Atlas blocked the connection | Atlas → **Network Access** → allow `0.0.0.0/0` |
| `MongoServerError: bad auth` | Wrong password, or `<db_password>` never replaced | Recreate the DB user in Atlas → **Database Access** |
| Everything works but there are no users | Atlas was never seeded | Re-run Step 3 |
| First visit takes ~50 seconds | Free tier cold start | Expected — see above |

Health check for any host: `https://your-app.onrender.com/api/health`
