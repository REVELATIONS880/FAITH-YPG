# 📸 SnapShare - FAITH-YPG Event Photo & Video Sharing

Lightweight, high-performance web app for event photo and video sharing. Hosts can spin up events with QR codes, guests can upload media directly from their camera without sign-up, and hosts can download all shared media as a ZIP archive.

---

## ☁️ How to Host 24/7 Online (Even When Your PC is Off)

To keep your events active 24/7 without keeping your local computer powered on, connect this repository (`https://github.com/REVELATIONS880/FAITH-YPG`) to **Render.com** (100% Free 24/7 Hosting):

### Step 1: Upload Files to GitHub
1. Upload all files from this project folder to your repository:
   👉 **`https://github.com/REVELATIONS880/FAITH-YPG`**

### Step 2: Deploy Free 24/7 Web Service on Render
1. Go to **[https://dashboard.render.com/](https://dashboard.render.com/)** and sign up for a free account.
2. Click **New +** -> **Web Service**.
3. Select **Build and deploy from a Git repository** and connect your GitHub repo `REVELATIONS880/FAITH-YPG`.
4. Set the following settings:
   - **Name**: `faith-ypg-events`
   - **Environment**: `Node`
   - **Build Command**: `npm install` (or leave default)
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
5. Click **Create Web Service**.

### 🎉 You're Done!
Your site will immediately be live 24/7 at a permanent HTTPS address (e.g. `https://faith-ypg-events.onrender.com`).
When you create events on your live site, your QR codes will automatically use your 24/7 HTTPS domain so anyone anywhere can scan and upload anytime!
