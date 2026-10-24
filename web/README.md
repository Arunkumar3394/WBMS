# AquaPure website (Angular 20)

See the main [README](../README.md) and [SETUP](../SETUP.md).

| What | Command |
|---|---|
| Install | `npm install` |
| Settings | copy `public/config.example.json` to `public/config.json` and fill it in |
| Run (http://localhost:4200) | `npm start` |
| Production build (`dist/aquapure-web/browser`) | `npm run build` |
| Lint | `npm run lint` |
| Unit tests | `npm run test:ci` |
| Browser tests (API must be running on :5080) | `npm run e2e` |
| Re-create the WebP images from `../images` | `npm run images` |

Business details (phone, WhatsApp, email, address) are in `src/app/core/business.ts`.
