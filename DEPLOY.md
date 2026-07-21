# Deploying FairHouse (free, on Render)

FairHouse is a plain Node + Express app (SQLite, no external services), so it
deploys anywhere that runs Node. These steps use **Render's free tier** (no card).

## 1. Put the code on GitHub

Easiest (VS Code is already open):
- Source Control panel → **Publish to GitHub** → choose **Public** → it creates the
  repo and pushes for you (it handles the login in your browser).

Or from a terminal, after creating an empty repo on github.com:
```bash
cd casino
git remote add origin https://github.com/<you>/fairhouse.git
git branch -M main
git push -u origin main
```

## 2. Deploy on Render

1. Sign up at **render.com** (log in with GitHub — free).
2. **New ▸ Blueprint**, pick the `fairhouse` repo. Render reads `render.yaml` and
   fills everything in. Click **Apply**.
   - (Or **New ▸ Web Service** → pick the repo → Build: `npm install --include=dev && npm run build`,
     Start: `npm start`.)
3. Wait ~2–4 minutes for the first build. You get a URL like
   `https://fairhouse.onrender.com` — that's your live link.

## Notes

- **Cold start:** the free tier sleeps after ~15 min idle; the first visit after
  that takes ~30–50s to wake, then it's fast. Fine for a portfolio demo.
- **Data is ephemeral:** the SQLite file resets on redeploy/sleep. That's fine —
  it's play money and a per-browser guest wallet.
- **If the build ever fails on `better-sqlite3`,** switch the service to a Docker
  runtime with this `Dockerfile`:
  ```dockerfile
  FROM node:22
  WORKDIR /app
  COPY package*.json ./
  RUN npm install --include=dev
  COPY . .
  RUN npm run build
  CMD ["npm", "start"]
  ```

Then put the live URL (and the GitHub repo) on your CV.
