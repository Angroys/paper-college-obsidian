# Paper College

An Obsidian plugin for [paper.college](https://paper.college). It copies your glossary notes and your mindmap from your paper.college account into your vault as Markdown and Canvas files, and opens the papers themselves in a temporary PDF view.

Sync runs in one direction only: from paper.college into the vault. The plugin never uploads note content, and PDFs are never written to your vault or to your computer.

## Required disclosures

Please read this section before installing. It covers the things Obsidian's [Developer policies](https://docs.obsidian.md/community-directory/developer-policies) require plugin authors to disclose.

### An account is required

The plugin does nothing on its own. You need a paper.college account, and you have to pair the vault with that account before any command works. There is no offline or local-only mode. Glossary terms and the mindmap are created on paper.college; this plugin only copies them down.

### Network use

The plugin is not usable offline and makes network requests to the site configured in **Paper URL** (default `https://paper.college`). All requests go through Obsidian's own `requestUrl` API. These are the only requests it makes:

| When | Request | What is sent | Why |
| --- | --- | --- | --- |
| You submit a pairing code | `POST /api/obsidian/pairing/exchange` | The 8-digit pairing code and the name of the current vault | Trades the short-lived code for a device token so the vault can authenticate later |
| You run a sync | `GET /api/obsidian/sync` | The device token, as an `Authorization: Bearer` header | Downloads your glossary terms, paper titles, and mindmap |
| You open a paper | `GET /api/papers/<paperId>/file` | The device token and the paper's id | Asks for a short-lived signed download URL for that PDF |
| Immediately after the above | `GET <signed storage URL>` | Nothing beyond the signed URL itself | Downloads the PDF bytes into memory so they can be drawn on screen |

Nothing else is contacted. The plugin does not talk to any third-party service, ad network, or update server.

Two related notes. Choosing **Connect** opens `https://paper.college/settings#obsidian` in your normal web browser so you can generate a pairing code; that page is a website visit, not a plugin request. And the **Paper URL** setting only accepts `https://` addresses, with one exception: `http://` is accepted when the host is exactly `localhost`, so that people developing paper.college can point the plugin at a local server. It is not meant to be changed otherwise.

### What leaves your vault

The name of your vault, sent once during pairing so you can tell your devices apart in paper.college settings. That is the only vault-derived data the plugin ever transmits.

The plugin does not read, index, or upload the content of your notes. Sync is strictly one-way, server to vault: nothing in your vault is sent back to paper.college, and edits you make to synced notes are never pushed anywhere.

### No telemetry

There is none. The plugin contains no analytics, no usage tracking, and no error or crash reporting. The requests in the table above are the complete list.

### How your device token is stored

After pairing, the plugin saves your device token with Obsidian's standard `saveData()` mechanism. It lands in plain text in:

```
<vault>/.obsidian/plugins/paper-college/data.json
```

This is the only storage Obsidian offers plugins; there is no encrypted secret store available. It has a consequence worth understanding: the token is a file inside your vault, so it travels with anything that copies your vault. Obsidian Sync, iCloud, Dropbox, Git, and ordinary backups will all carry it. Anyone who can read that file can read your papers and glossary on paper.college until the token is revoked.

If you don't want that, either don't pair vaults you sync to places you don't control, or revoke the token when you're done with a device.

### Revoking access, and a limitation you should know about

To fully revoke a device, go to **Settings** on paper.college, find the vault in the device list, and choose **Disconnect**. That revokes the token server-side, and it stops working everywhere.

The plugin's own **Disconnect** button and the `Disconnect` command do **not** do this. They only clear the token and account details from this vault's local settings. The token stays valid on the server, so any copy of `data.json` made beforehand still works. This is a known bug, a fix is tracked, and it has not shipped yet. Until it does, treat the in-app Disconnect as "stop using this vault", and use the paper.college settings page whenever you actually need the token dead.

### Desktop only

The manifest sets `isDesktopOnly: true`. The plugin is not tested on Obsidian mobile and is not supported there.

## Installation

### From the community plugin directory

1. Open **Settings** then **Community plugins** in Obsidian.
2. Turn off Restricted mode if it's on.
3. Choose **Browse**, search for "Paper College", and install it.
4. Enable the plugin.

### Manually

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Angroys/paper-college-obsidian/releases) and put all three in:

```
<vault>/.obsidian/plugins/paper-college/
```

Then reload Obsidian and enable the plugin under **Community plugins**.

## Setup

Pairing links one vault to one paper.college account.

1. Enable the plugin. Open its settings tab, or use the **Connect** notice shown on first run.
2. Choose **Connect**. Your browser opens `https://paper.college/settings#obsidian`. If it doesn't open, the settings tab shows the link with a **Copy** button.
3. On that page, generate a pairing code. It's 8 digits and expires shortly.
4. Type the code into the **Pairing code** field in Obsidian and choose **Connect**.
5. Once it says you're connected, choose **Sync now**.

The first sync creates a `Paper` folder in your vault:

```
Paper/
  Glossary/      one Markdown note per glossary term
  Papers/        one Markdown note per paper, linking to its terms
  Mindmap.canvas your mindmap, as an Obsidian Canvas file
```

If you have no glossary terms yet, you get a `Paper/Glossary.md` placeholder instead of the `Glossary` notes.

Every note the plugin writes carries `paper_sync: true` in its frontmatter. Later syncs replace only files that carry that marker, so notes you wrote yourself are never overwritten, even if they sit in the same folder. If you edit a synced note in place, the next sync will overwrite your edits.

## Commands

All of these appear in the command palette under "Paper College".

| Command | What it does |
| --- | --- |
| Connect | Starts pairing, or opens settings if the vault is already paired |
| Sync glossary and mindmap | Downloads your glossary, paper notes, and mindmap |
| Open paper PDF… | Lists papers from the last sync and opens the one you pick |
| Open Paper folder | Opens `Mindmap.canvas` in the configured folder |
| Disconnect | Clears this vault's stored token, after a confirmation |

There is also a ribbon icon that syncs, and a status bar item showing when the last sync happened. Selecting the status bar item opens the plugin's settings.

Inside a synced note or the mindmap Canvas, selecting a paper link opens that paper in the PDF view rather than in your browser.

## Reading papers

Papers open in a Paper PDF tab. The plugin fetches a short-lived signed URL, downloads the PDF into memory, and draws the pages. The bytes are discarded when the tab closes.

There is deliberately no Save, Download, or Add-to-vault control: the PDF is never written to your vault or your filesystem. If you want the file itself, use **Open in Paper** in the tab toolbar to open the paper on paper.college.

The view needs a network connection. Signed URLs expire, so a tab left open for a long time refreshes its URL in the background. Your synced notes remain readable offline; only the PDF view does not.

## Settings

| Setting | Description |
| --- | --- |
| Connection | Pair the vault, view which account it's connected as, sync, disconnect, or replace the pairing with a different one |
| Vault folder | Folder that receives synced notes and the mindmap. Defaults to `Paper`. No PDFs are saved here |
| Sync now | Runs a sync immediately |
| Sync on startup | Sync once when Obsidian starts. Off by default |
| Paper URL | The site to talk to. Defaults to `https://paper.college`. Only change this if you are developing paper.college locally |

## Development

Requires Node.js 18 or later.

```bash
git clone https://github.com/Angroys/paper-college-obsidian.git
cd paper-college-obsidian
npm install
```

Build once, for a release:

```bash
npm run build
```

Or watch and rebuild while you work:

```bash
npm run dev
```

To test against a local paper.college instance, set **Paper URL** to `http://localhost:3000`.

The quickest way to try changes is to clone into `<vault>/.obsidian/plugins/paper-college/` directly, run `npm run dev`, and reload Obsidian after each rebuild.

## Support

Bug reports and questions go to [GitHub issues](https://github.com/Angroys/paper-college-obsidian/issues). When reporting a sync or connection problem, please include your Obsidian version, your operating system, and what the status bar showed.

Please do not paste the contents of `data.json` into an issue. It contains your device token.

## License

MIT. See [LICENSE](LICENSE).

This plugin bundles [PDF.js](https://mozilla.github.io/pdf.js/) (Apache License 2.0) to render papers.
