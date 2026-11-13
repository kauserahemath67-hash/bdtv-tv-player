<div align="center">

# BDTv TV Player

**Live TV Player · Android TV App · Admin Dashboard**

বাংলা টিভি চ্যানেল দেখুন, Android TV রিমোট দিয়ে নিয়ন্ত্রণ করুন এবং Admin Panel থেকে চ্যানেল ও app release পরিচালনা করুন।

<a href="https://bdtvfree.vercel.app/"><img src="https://img.shields.io/badge/Live%20Player-Open-0B7285?style=for-the-badge" alt="Open live player"></a>
<a href="https://bdtvfree.vercel.app/admin"><img src="https://img.shields.io/badge/Admin%20Panel-Open-6741D9?style=for-the-badge" alt="Open admin panel"></a>
<a href="https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/latest/download/BDTv.apk"><img src="https://img.shields.io/github/v/release/kauserahemath67-hash/bdtv-tv-player?label=Download%20Android%20APK&style=for-the-badge" alt="Download latest Android APK"></a>
<a href="https://github.com/kauserahemath67-hash/bdtv-tv-player"><img src="https://img.shields.io/badge/GitHub-Source%20Code-181717?style=for-the-badge&logo=github" alt="View source on GitHub"></a>

</div>

## 🔗 সরাসরি লিংক

| কী খুলবেন | লিংক |
|---|---|
| 📺 Live Player | [bdtvfree.vercel.app](https://bdtvfree.vercel.app/) |
| 🛠️ Admin Dashboard | [bdtvfree.vercel.app/admin](https://bdtvfree.vercel.app/admin) |
| 📃 M3U Playlist | [playlist.m3u](https://bdtvfree.vercel.app/playlist.m3u) |
| 📥 সর্বশেষ Android APK | [GitHub থেকে ডাউনলোড](https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/latest/download/BDTv.apk) |
| 🗂️ সব App Release | [GitHub Releases](https://github.com/kauserahemath67-hash/bdtv-tv-player/releases) |
| 💻 Source Code | [GitHub Repository](https://github.com/kauserahemath67-hash/bdtv-tv-player) |

APK লিংকটি GitHub-এ প্রকাশিত সর্বশেষ release-এর দিকে যায়। `ONLINE` status থাকলেও সব TV বা network-এ stream চলবে—এমন নিশ্চয়তা নেই; stream URL, provider, internet এবং device codec-এর ওপর playback নির্ভর করে।

## ✨ প্রধান বৈশিষ্ট্য

- HLS.js-ভিত্তিক web player এবং playback recovery।
- Android TV remote দিয়ে channel navigation, selection, play/pause এবং Back control।
- Mobile-friendly controls, swipe gesture ও picture-in-picture support।
- Admin Dashboard থেকে channel/playlist management, health check, report, device setting ও app version পরিচালনা।
- `/playlist.m3u` থেকে M3U playlist access।

## 📡 Channel data ও Android playback

- Android app-এর channel list: [`channels.json`](https://raw.githubusercontent.com/kauserahemath67-hash/bdtv-tv-player/data-storage/data/channels.json) — `data-storage` branch।
- App update metadata: [`version.json`](https://raw.githubusercontent.com/kauserahemath67-hash/bdtv-tv-player/data-storage/data/version.json)।
- Admin Panel-এর channel পরিবর্তন GitHub-এর `data-storage` branch-এ প্রকাশিত হয়; APK update প্রকাশিত হয় [GitHub Releases](https://github.com/kauserahemath67-hash/bdtv-tv-player/releases)-এ।
- VIP/customer/device validation, settings ও activity heartbeat Vercel service ব্যবহার করে।
- Android native player সাধারণত device থেকেই stream নেয়। কিছু recovery/fallback অবস্থায় Vercel proxy ব্যবহৃত হতে পারে।
- Channel `ONLINE` দেখালেও link মেয়াদোত্তীর্ণ/blocked হতে পারে, অথবা নির্দিষ্ট TV-তে codec/network সমস্যা হতে পারে। গুরুত্বপূর্ণ channel TV-তে পরীক্ষা করুন এবং সম্ভব হলে backup URL রাখুন।

## 🚀 GitHub-এ পরিবর্তন Push

এই repository আগে থেকেই GitHub-এ আছে: [kauserahemath67-hash/bdtv-tv-player](https://github.com/kauserahemath67-hash/bdtv-tv-player)।

Existing local clone-এর project folder থেকে README পরিবর্তন push করতে:

```bash
git status
git diff -- README.md
git add README.md
git commit -m "docs: update README"
git push origin main
```

অন্য file-ও পরিবর্তন করলে `git add README.md`-এর বদলে review করে নির্দিষ্ট file যোগ করুন। নতুন computer-এ প্রথমে clone করুন:

```bash
git clone https://github.com/kauserahemath67-hash/bdtv-tv-player.git
cd bdtv-tv-player
```

## ☁️ Vercel-এ Deploy

1. [Vercel](https://vercel.com/)-এ GitHub account দিয়ে sign in করুন।
2. **Add New → Project** থেকে `bdtv-tv-player` repository import করুন।
3. Framework preset **Other** রেখে project deploy করুন।
4. Admin Dashboard-এর default PIN বদলে নিজের PIN সেট করুন—public deployment-এর আগে এটি অবশ্যই করুন।
5. Repository-র production branch-এ push করলে GitHub integration থাকলে Vercel স্বয়ংক্রিয়ভাবে নতুন deployment চালাতে পারে।

## 💻 Local-এ চালান

Project root folder-এ Node.js server চালান:

```bash
node server.js
```

- Player: [http://localhost:3000/](http://localhost:3000/)
- Admin: [http://localhost:3000/admin](http://localhost:3000/admin)
