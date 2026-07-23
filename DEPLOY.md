# Deploying

FairHouse is a Node + Express app with an embedded SQLite database and no
external dependencies, so it runs on any host with Node 20+. A `render.yaml`
blueprint is included for Render.

## Render

1. Push the repo to GitHub.
2. New → Blueprint, select the repo. `render.yaml` sets the build command
   (`npm install --include=dev && npm run build`) and start command (`npm start`).
3. The first build takes a couple of minutes; Render then assigns a URL such as
   `https://fairhouse.onrender.com`.

Without the blueprint: New → Web Service, same build and start commands, Node 22.

## Anywhere else

```bash
npm install
npm run build
npm start        # listens on $PORT, defaults to 3300
```

## Notes

- On Render's free tier the instance sleeps after ~15 minutes idle and wakes on
  the next request after a short delay.
- The SQLite file lives on the instance's local disk and is recreated on
  redeploy. Balances are per-browser play money, so this is expected.
- If `better-sqlite3` fails to build on the host, deploy with Docker instead:

  ```dockerfile
  FROM node:22
  WORKDIR /app
  COPY package*.json ./
  RUN npm install --include=dev
  COPY . .
  RUN npm run build
  CMD ["npm", "start"]
  ```
