# Last Card

A phone-first, UNO-style game for **2–6 friends**, hosted as a static site on GitHub Pages. No player accounts, no game database, no build step. Includes offline practice against two bots.

## Play

1. Open the site on your phone and enter a nickname.
2. Choose **Create a room**.
3. Choose **Text an invite** and send the invite through your phone’s share sheet. Alternatively, copy the eight-character room code and send it with the site address.
4. Friends open the link, enter their names, and join. The host deals when everyone is in.
5. Keep the game visible. If somebody disconnects, the table pauses. Reopen the same browser on the same phone, select **Return to…**, and reconnect.

The invite opens the site with `#room=ABCDEFGH`; this works on a GitHub Pages repository subpath without custom routing. The fragment is not included in the request to the static host. Anyone who knows the code can join while the lobby is open. New players cannot join a round already in progress.

## Deploy to GitHub Pages

The repository includes `.github/workflows/pages.yml`, which tests and publishes on pushes to `main`.

1. In the repository, open **Settings → Pages**.
2. Set **Build and deployment → Source → GitHub Actions**.
3. Under **Actions → Test and deploy GitHub Pages**, choose **Run workflow** if the initial run did not deploy.
4. Use the deployed URL shown by the workflow. For this repository the normal address is `https://jenschristianschroder.github.io/Uno/`.

No npm installation is needed to serve or deploy. The pinned PeerJS 1.5.5 browser bundle is included locally, together with its MIT license. `package-lock.json` records how it was obtained. The workflow publishes only the static runtime files, not tests or dependencies.

For branch-based Pages hosting, the project also works directly from the `main` branch root (`/`); choose one publishing method. For a different default branch, update the workflow’s branch filter.

## Storage and connection architecture

- **Host phone:** shuffles and deals, validates every move, stores the full round and reconnect credentials in `localStorage`.
- **Guest phones:** retain a random seat token, room code, and nickname in `localStorage`. Their own hand and the public table are received from the host and held in memory.
- **Static host:** serves HTML, CSS, JavaScript, and icons. There are no game-state HTTP endpoints, database calls, analytics, or tracking scripts.
- **WebRTC:** encrypted data channels carry moves between each guest and the host. Guests receive only their own hand, opponents’ card counts, and public table state. The host necessarily has access to the deck and all hands. This is a casual friends game, not an adversarial or provably fair system.
- **Signaling:** the public PeerJS Cloud service (`0.peerjs.com`) introduces the phones. Google STUN servers discover network routes. These services see connection metadata; PeerJS may temporarily queue connection offers. The application does not send game state to signaling services.
- **Device cache:** a service worker caches the static app for offline practice. Online multiplayer still requires an internet connection.

“All storage on phones” applies to **application game data**. It cannot mean that hosting/network providers store absolutely nothing: GitHub Pages logs visitor IP addresses and third-party connection providers may log metadata. If zero third-party metadata storage is a strict requirement, this implementation does not meet it.

A short room code cannot locate a remote phone using GitHub Pages alone. It needs a rendezvous/signaling service. A no-signaling-service alternative would involve exchanging long WebRTC offers and answers manually, usually in multiple messages, and still cannot guarantee NAT traversal.

### Connectivity limits

There is **no TURN relay configured**. Direct connections work on compatible networks; restrictive Wi-Fi, carrier NAT, or firewall combinations can prevent them. The UI reports a connection failure instead of pretending that a room is connected. Internet-wide mobile reliability requires a TURN service in addition to static hosting.

Connection options live in `config.js`. A self-hosted PeerServer can replace the shared public service. TURN can be supplied through the `iceServers` configuration, but **never commit long-lived private credentials** to a public static app. A production relay should issue short-lived credentials through an appropriate endpoint; that requires an additional service even if no game data is persisted. The relay forwards encrypted WebRTC traffic, but its logging/retention policy still matters.

### Mobile and recovery limits

- Keep phones unlocked and the game in the foreground. The app requests a screen wake lock where supported, but browsers may suspend connections when switching to Messages, locking the screen, or changing networks.
- The host is the authority. There is no automatic host migration. If the host closes the page, their saved round can be restored on the same device and browser; guests can then reconnect.
- The table pauses when a peer is missing (heartbeat timeout: about 12 seconds). Use **Reconnect** after the host returns.
- Local storage can be cleared or evicted; private browsing may remove it. There is no cloud recovery.
- Open a room in one tab per device. Guest tokens are bearer credentials; protect the device and share room codes only with friends.
- A new hosted room replaces that phone’s previous hosted save. Practice does not overwrite an active multiplayer save. Clearing game data removes the saved name, seat token, and hosted round; cached static assets remain.
- Players cannot be removed mid-round. If a player cannot return, start a new room.
- For a service-worker update, increment the cache version in `sw.js`. Updates activate after all existing game tabs close, so a running round is not switched between code versions.

## Rules used here

- Standard 108-card deck. Seven cards each. A number card starts the discard pile.
- Match color or value/symbol, or play a wild.
- Draw one; play the drawn card if possible, or pass. Unplayable draws end your turn. You cannot play another card after drawing.
- Skip, reverse, draw two, wild, and wild draw four are supported. With two players, reverse acts as skip.
- Draw penalties also skip the affected player; no stacking.
- Wild +4 is allowed only when you hold no card matching the current color. There is no challenge mechanic.
- Tap **Call UNO** before playing from two cards to one. Forgetting adds two cards automatically.
- First empty hand wins a single round. Final-card draw penalties are still applied. The host can deal a rematch.
- If the stock and recyclable discard cards are exhausted and everyone draws unsuccessfully, the round ends in a draw.

This is an unofficial, simplified UNO-style implementation, not an official Mattel product. Visuals and application code are original; no official logos or card images are included.

## Development and verification

Node.js 22 or newer:

```sh
npm test
```

18 tests cover deck composition, dealing, illegal/stale actions, special cards, draw/pass rules, UNO penalties, recycling, winners, card conservation across 60 simulated games, redacted guest views, six-player messaging, disconnect pauses, and host/guest recovery.

Session integration tests use an in-memory PeerJS-compatible transport. They verify the application protocol, **not actual WebRTC NAT traversal or browser compatibility**. Browser/device QA and real-network multiplayer checks remain required before calling this production-ready.

For local development, serve this directory with a static HTTP server (for example `python3 -m http.server 8000`) and open `http://localhost:8000`. For testing on another physical phone, use HTTPS; secure-context browser features do not work on an arbitrary insecure LAN origin.

Suggested device acceptance checks:

- Safari on iPhone and Chrome on Android: create/join using a texted link, 2–6 players, wild color picker, draw/pass, UNO, and rematch.
- Same Wi-Fi, different Wi-Fi, and cellular networks; record any direct-connect failures.
- Switch to Messages and return, lock/unlock, change networks, refresh the host, and refresh a guest. Confirm recovery or clear failure feedback.
- Try an offline practice round after the first online load.
- Check portrait layouts at 320–430 CSS pixels, keyboard navigation, text zoom, screen reader labels, and long player names.

## Source references

- [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [PeerJS FAQ and NAT/TURN limitations](https://peerjs.com/client/faq)
- [PeerJS connection API](https://peerjs.com/client/api/peer)
- [PeerJS Cloud](https://peerjs.com/server/cloud)
