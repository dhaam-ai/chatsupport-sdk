// One process: bundles the app, serves it, and mints tokens for it.
//
// Two routes, and the split between them is the demo's whole security story:
//
//   GET  /*          static page + bundle. Gets the PUBLISHABLE key.
//   POST /api/token  proxies to chat-service using the SECRET key, which
//                    exists only in this process's memory.
//
// Nothing here is production-grade — no sessions, no CSRF, no per-user auth.
// A real integration mints for *the already-authenticated user of your app*;
// this one mints for a single user fixed in config. See README.

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import { bundle, publicDir } from './build.mjs';
import { describeConfig, loadConfig, toRuntimeConfig, ConfigError } from './config.mjs';
import { mintAccessToken, TokenMintError } from './token-endpoint.mjs';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // Tokens must never be cached by a proxy or the browser's bfcache.
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/**
 * Serves index.html with the runtime config inlined.
 *
 * `<` is escaped so a config value can never close the script element —
 * standard JSON-in-HTML hygiene. The values here are all server-controlled,
 * but the escaping is the difference between "safe" and "safe today".
 */
const CONFIG_PLACEHOLDER = '/*__RUNTIME_CONFIG__*/ null';

async function serveIndex(res, runtimeConfig) {
  const template = await readFile(join(publicDir, 'index.html'), 'utf8');
  const json = JSON.stringify(runtimeConfig).replace(/</g, '\\u003c');

  if (!template.includes(CONFIG_PLACEHOLDER)) {
    // Silently serving the un-substituted template is the worst outcome: the
    // page loads, then fails deep inside readRuntimeConfig with a message
    // about the file being opened from disk. Fail here instead.
    throw new Error('index.html no longer contains the runtime-config placeholder');
  }
  const html = template.replace(CONFIG_PLACEHOLDER, json);

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES['.html'],
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

/** Static file serving, confined to public/. */
async function serveStatic(res, pathname) {
  // normalize() collapses `..` before the prefix check, so `/../server/config.mjs`
  // cannot escape publicDir.
  const target = resolve(join(publicDir, normalize(pathname)));
  if (!target.startsWith(resolve(publicDir))) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError || error?.name?.startsWith('Invalid') || error?.name === 'SecretKeyInClientError') {
      console.error(`\nConfiguration problem:\n\n${error.message}\n\nSee examples/demo/README.md.\n`);
      process.exit(1);
    }
    throw error;
  }

  const runtimeConfig = toRuntimeConfig(config);

  console.log('Bundling the browser app…');
  await bundle();

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'POST' && pathname === '/api/token') {
      // No request body is read on purpose — see mintAccessToken: the userId
      // comes from server config, so the browser cannot choose who it becomes.
      mintAccessToken({
        apiUrl: config.apiUrl,
        secretKey: config.secretKey,
        user: config.user,
      })
        .then((token) => {
          // Logged as a fact, never with the token itself.
          console.log(`[token] minted for ${config.user.userId}`);
          sendJson(res, 200, token);
        })
        .catch((error) => {
          if (error instanceof TokenMintError) {
            console.error(`[token] mint failed: ${error.message}`);
            sendJson(res, 502, {
              error: { code: error.code ?? 'TOKEN_MINT_FAILED', message: error.message, retryable: true },
            });
            return;
          }
          console.error('[token] unexpected failure', error);
          sendJson(res, 500, {
            error: { code: 'INTERNAL', message: 'unexpected failure', retryable: true },
          });
        });
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405).end('Method not allowed');
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      serveIndex(res, runtimeConfig).catch(() => res.writeHead(500).end('Internal error'));
      return;
    }

    serveStatic(res, pathname).catch(() => res.writeHead(500).end('Internal error'));
  });

  server.listen(config.port, () => {
    console.log(`\nDemo running at http://localhost:${config.port}\n`);
    console.log(describeConfig(config));
    console.log('');
  });
}

await main();
