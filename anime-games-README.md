# Anime Draft Game

A local **anime character draft game** (Jikan API) inspired by the football squad-draft show: pick and draft anime characters squad-style, served by a lightweight Express backend.

## Features

- 🎴 Squad-draft-style gameplay over anime characters
- 🔌 Character data fetched from the [Jikan API](https://jikan.moe/) (unofficial MyAnimeList API)
- 🛠️ Scripted character-data build pipelines (`build-characters*.js`)
- ✅ Automated + end-to-end tests (`tests/`, `e2e.config.ts`)
- 📄 Extra notes in `docs/`

## Tech Stack

- JavaScript, Node.js, Express 4
- Jikan REST API for character data

## Run Locally

Requirements: Node.js 18+.

```bash
npm install
npm start
```

The server starts from `server.js` (see `package.json` → `scripts.start`). Open the printed local URL in your browser.

## Project Structure

```
├── server.js              # Express server (entry point)
├── build-characters.js    # Character-data build script
├── build-characters-ml.js # ML-variant build script
├── data/                  # Character datasets
├── docs/                  # Notes & documentation
├── tests/                 # Automated tests
├── e2e.config.ts          # End-to-end test config
└── package.json           # Scripts & dependencies
```

## Notes / To-Do

- [ ] Remove `server.log` from version control and add it to `.gitignore`
- [ ] Add environment-based config (port, API base URL)
- [ ] Add screenshots/GIF of gameplay to this README

## Author

**Ahmed Esam Shawky Shebl Elzok** — Information Systems student, Menoufia University
- GitHub: https://github.com/Yako-Ken
