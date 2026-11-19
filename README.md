# ytweb

The **YouTube 2.2.14 Android app** (Android 2.2 "Froyo", 2011) running in a phone browser.
The UI is not redrawn by hand: a small Android View runtime in JavaScript reads the app's original
layouts, 9-patch images, colors and strings and lays them out like Android did. A Node.js server
supplies today's YouTube content.

Open it on a phone, add it to the home screen, and it behaves like an app. It is made with iOS
(Safari) in mind and works on Android too.

> # ⚠️ WARNING: 1 server = 1 account
> The Google account you sign in with is stored **on the server**. **Everyone who can open your server's
> address uses your account**: they see your subscriptions, recommendations and history, and can comment,
> like and write in chat as you. Never give the address of a server with a signed-in account to other people.
> Want to share? Do not sign in on that server, or run a separate server with a separate (spare) account per person.
> Never publish the `data/` folder.

> Not affiliated with or endorsed by Google. "YouTube" is a trademark of Google LLC.
> The original app resources are **not** in this repository; you extract them from your own APK.

## Features

- Original 2.2.14 screens: Home, Browse (categories), Search, Watch (Info / Related / Comments),
  channels, My Channel, Settings, the options menu and the "More" toolbar
- Tablet mode (the ▭ key in the bottom row), using the layout ideas of YouTube 3.x for tablets
- Real videos, live streams, search, related videos and comments, with endless scrolling
  (stops at a memory budget; reload the page to reset)
- Player: original controls, seeking, fullscreen, quality (Auto, 1080p … 144p), playback speed and
  audio tracks (dubbed languages) when a video has them
- Live streams with rewind back to the start (as far as YouTube keeps it, capped by `DVR_MAX_HOURS`, default 24) and a LIVE button to jump back
- Live chat and chat replay (synced to the playhead), also as an overlay in fullscreen (not on iOS)
- Google account with two sign-in methods (Settings → Google account): a code at google.com/device, or
  youtube.com cookies (the only one that can write in live chat)
- Real channels: avatar, subscribers, uploads, playlists; My Channel with your uploads, liked videos,
  playlists and subscriptions
- Optional Google sign-in for your own recommendations
- Optional access PIN

## Requirements

- Node.js 18 or newer
- [jadx](https://github.com/skylot/jadx), once, to extract the resources from the APK
- Optional: [yt-dlp](https://github.com/yt-dlp/yt-dlp) in `PATH` for qualities above 360p and audio
  tracks. It uses `node` as its JavaScript runtime.

## Setup

1. Get the APK of YouTube **2.2.14** for Android (for example from APKMirror).
   Optionally also **3.3.0** for the experimental `?v=33` port.
2. Extract the UI resources:

   ```sh
   node tools/extract-res.js path/to/youtube-2.2.14.apk v22
   node tools/extract-res.js path/to/youtube-3.3.0.apk v33   # optional
   ```

   They go to `public/apps/v22/res` and `public/apps/v33/res`, which git ignores.

3. Start the server:

   ```sh
   npm start                      # this computer only: http://127.0.0.1:8080
   YT_PIN=1234 npm run lan        # whole home network, with a PIN
   ```

   No `npm install` is needed to run it. The dev dependencies only supply the bundled copies of
   hls.js and Roboto.

4. On the phone (same Wi-Fi) open `http://<computer-IP>:8080`. Find the IP with `ip -4 addr`
   (Linux) or `ipconfig` (Windows). Then add it to the home screen:
   - iPhone, Safari: Share → Add to Home Screen
   - Android, Chrome: ⋮ → Add to Home screen

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Address to listen on. `0.0.0.0` = every network interface |
| `PORT` | `8080` | Port |
| `YT_PIN` | none | If set, the browser must enter this PIN once (stored as a cookie) |
| `YTDLP` | `yt-dlp` | Path to yt-dlp |
| `DVR_MAX_HOURS` | `24` | How far back a live stream can be rewound |
| `YTWEB_DEBUG` | none | Log YouTube's answers to posting comments and chat messages |

## Security

- Only expose the server on networks you trust. It has no user accounts.
- **Google sign-in is shared.** The tokens are kept on the server in `data/auth.json`, so everyone
  who can open the server uses that account. Set `YT_PIN` when you sign in.
  Settings → Google account → Sign out revokes the token and deletes the file.
- **YouTube cookies** (only needed for writing in live chat) give full access to the Google account. They are
  kept in `data/cookies.txt`. Use a separate account. Settings → Google account → Sign out deletes them.
- Sign-in uses the OAuth "device code" flow with the public client of YouTube for TVs, as many
  open-source YouTube clients do. The client ID is in `auth.js`.

## How it works

| Part | File |
|---|---|
| Android resource loader: values, selectors, shapes, 9-patch (`npTc` chunk), layer lists | `public/android.js` |
| Layout inflater: LinearLayout / FrameLayout via CSS, RelativeLayout via a JS solver | `public/views.js` |
| 2.2.14 activities: navigation, player, dialogs, settings, tablet mode | `public/apps/v22/app.js` |
| API client with paging and demo-data fallback | `public/api.js` |
| HTTP server, PIN, API routes | `server.js` |
| YouTube InnerTube client, stream relay, HLS proxy, yt-dlp bridge | `yt.js` |
| Google device sign-in | `auth.js` |

Video playback:

- **360p**: the progressive MP4 (itag 18) from the InnerTube ANDROID client, relayed with Range
  support. It starts at once. This follows the approach of
  [yt2009](https://github.com/ftde0/yt2009).
- **Other qualities and audio tracks**: an HLS master playlist that yt-dlp prepares, proxied
  through `/hlsp` and filtered to H.264 so every phone can decode it. The first switch takes a few
  seconds.
- **Live**: the HLS manifest from InnerTube through the same proxy, played with hls.js or with
  Safari's built-in HLS player.

`tools/ytdlp-shim` is loaded only into the yt-dlp process. If `www.youtube.com` does not resolve
on your network, it falls back to `www.youtube-nocookie.com`, the same Google frontend.

YouTube's private API changes often. When playback breaks, update yt-dlp first.

## License

ytweb is free software under the **GNU General Public License v3.0 or later**. See [LICENSE](LICENSE).

Third-party parts and their licenses are listed in [NOTICE](NOTICE). The license texts are in
[LICENSES/](LICENSES):

- hls.js, Apache-2.0
- Droid Sans font, Apache-2.0
- Roboto font, SIL OFL 1.1
- yt2009, Apache-2.0 (reference for the playback approach; no code copied)

The YouTube APK resources are Google's property and are not covered by this license.
