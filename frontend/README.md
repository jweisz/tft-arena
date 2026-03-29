# TFT Arena Frontend

React + TypeScript + Vite client for the TFT Arena backend.

## Requirements

- Node 20+
- npm

## Install

```bash
npm install
```

## Run (dev)

```bash
npm run dev
```

Default dev URL:

- `http://localhost:5173`

The frontend expects backend API/WebSocket on port `8000` unless overridden.

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```

## Test

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

## Environment Variables

Optional variables:

- `VITE_API_BASE_URL`: override HTTP API base URL.
- `VITE_WS_BASE_URL`: override WebSocket base URL.

If not set, defaults are derived from browser hostname with backend port `8000`.

## Auth-Readiness Notes

The frontend keeps auth/session details in a centralized provider and injects token seams for both HTTP and WebSocket transport:

- HTTP: authorization header injection via shared API client.
- WS: optional `access_token` query parameter via shared URL helper.

Current local mode remains permissive when backend auth mode is `local-open`.
