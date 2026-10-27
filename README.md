# Slack 1-on-1 Direct Chat — Pure Vercel (No Login, Zero External Dependencies)

A clean, exact **Slack UI** clone built for **1-on-1 direct messaging**, written in pure HTML, CSS, and Vanilla JS + a built-in **Vercel Serverless API (`api/chat.js`)**.

## ✨ Features

- **Zero Login / Instant Access**: Opens directly into the Slack conversation interface—no accounts, passwords, or external databases required.
- **100% Pure Vercel**: Uses a built-in serverless endpoint (`/api/chat`) + client-side state reconciliation + `BroadcastChannel` for real-time messaging, reactions, profile updates, and *"is typing..."* indicators.
- **Customizable 1-on-1 Profiles**: Click your avatar, name, or **Edit Profile** at any time to upload a profile picture from your device, paste an image URL, pick a preset avatar, or change your **Display Name**, **`@username`**, and **Status**.
- **1-Click User Switcher**: Switch between **User 1** and **User 2** anytime from the top bar (`You: @alex ⇄ Switch to @sam`) or sidebar, or pass `?user=2` in the URL.
- **Full Slack Chat Experience**: Compact message grouping, Slack markdown (`*bold*`, `_italic_`, `~strike~`, `` `code` ``, `> quote`), image attachments, emoji reactions, message search, and right-side **Profile** drawer.
