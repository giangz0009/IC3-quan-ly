import type { IncomingMessage, ServerResponse } from 'node:http';
import type express from 'express';
import { createApp } from '../server/app.js';

let cachedApp: express.Express | null = null;
let initError: unknown = null;

function getApp(): express.Express {
  if (cachedApp) return cachedApp;
  if (initError) throw initError;
  try {
    cachedApp = createApp();
    return cachedApp;
  } catch (err) {
    initError = err;
    throw err;
  }
}

function normalizeApiUrl(rawUrl: string | undefined): string {
  const urlStr = rawUrl || '/api';
  try {
    const parsed = new URL(urlStr, 'http://localhost');
    const pathParam = parsed.searchParams.get('__path');
    if (pathParam !== null) {
      parsed.searchParams.delete('__path');
      const cleanSubPath = pathParam.replace(/^\/+/, '');
      const qs = parsed.searchParams.toString();
      return `/api/${cleanSubPath}${qs ? `?${qs}` : ''}`;
    }
    if (!parsed.pathname.startsWith('/api')) {
      const suffix = parsed.pathname === '/' ? '' : parsed.pathname;
      return `/api${suffix}${parsed.search}`;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return urlStr.startsWith('/api') ? urlStr : `/api${urlStr}`;
  }
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    req.url = normalizeApiUrl(req.url);
    const app = getApp();
    return app(
      req as unknown as express.Request,
      res as unknown as express.Response
    );
  } catch (err) {
    console.error('Serverless API handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Lỗi khởi tạo máy chủ API.';
      res.end(JSON.stringify({ error: message }));
    }
  }
}
