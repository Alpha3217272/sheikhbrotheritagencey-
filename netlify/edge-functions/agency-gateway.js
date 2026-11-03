// Netlify's runtime bundles this module; it must stay outside the publish folder.
export const BACKEND = 'https://sheikh-brother-it-agency.furqanfarooq923.chatgpt.site';
const SECURITY_POLICY = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; worker-src 'self'; upgrade-insecure-requests";
const READ_ONLY = new Set(['GET', 'HEAD']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const APP_PAGE = /^\/(?:website-development|ai-creation|ai-automation|social-media-management|admin)?\/?$/;
const forbidden = /(?:^|\/)(?:\.env(?:\.|\/|$)|\.git(?:\/|$)|\.openai(?:\/|$)|netlify(?:\/|$)|scripts(?:\/|$)|tests(?:\/|$)|package(?:-lock)?\.json$|netlify\.toml$)|\.map$/i;

function error(message, status) {
  return new Response(message, { status, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  } });
}

// React Flight uses byte-counted records inside these scripts. Even a harmless
// domain replacement changes those counts and breaks hydration (Connection closed).
// Treat the framework bootstrap as opaque; rewrite only ordinary HTML/JSON-LD.
export function rewriteHtml(html, origin) {
  const scripts = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
  let result = '', cursor = 0;
  for (const match of html.matchAll(scripts)) {
    result += html.slice(cursor, match.index).replaceAll(BACKEND, origin);
    const script = match[0];
    result += /vinext\.navigationRuntime|__next_f/.test(script)
      ? script : script.replaceAll(BACKEND, origin);
    cursor = match.index + script.length;
  }
  return result + html.slice(cursor).replaceAll(BACKEND, origin);
}

export async function proxy(request, fetchBackend = fetch) {
  const incoming = new URL(request.url);
  let pathname;
  try { pathname = decodeURIComponent(incoming.pathname); } catch { return error('Not found', 404); }
  if (forbidden.test(pathname)) return error('Not found', 404);
  if (!METHODS.has(request.method)) return error('Method not allowed', 405);
  const mutation = !READ_ONLY.has(request.method);
  // Check the REAL browser origin before translating the request to the backend.
  // Never turn an arbitrary cross-site request into a trusted same-origin POST.
  if (mutation && (request.headers.get('origin') !== incoming.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site')) return error('Access denied', 403);
  const target = new URL(BACKEND);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (/^(?:host|connection|content-length|authorization|proxy-authorization|forwarded|x-forwarded-.*|x-nf-.*|cf-.*|oai-.*)$/i.test(name)) headers.delete(name);
  }
  if (headers.has('origin')) headers.set('origin', BACKEND);
  if (headers.has('referer')) {
    try { const ref = new URL(headers.get('referer')); headers.set('referer', BACKEND + ref.pathname + ref.search); }
    catch { headers.delete('referer'); }
  }
  // Avoid content-encoding/length mismatches after Fetch decompresses a response.
  headers.set('accept-encoding', 'identity');
  const init = { method: request.method, headers, redirect: 'manual', signal: request.signal };
  if (mutation && request.body) { init.body = request.body; init.duplex = 'half'; }
  let response;
  try { response = await fetchBackend(new Request(target, init)); }
  catch { return error('The website backend could not be reached. Please try again shortly.', 502); }
  return rewriteResponse(request, response);
}

export async function rewriteResponse(request, response) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, BACKEND);
  const output = new Headers(response.headers);
  output.delete('content-encoding');
  output.delete('content-length');
  if (!output.has('Content-Security-Policy')) output.set('Content-Security-Policy', SECURITY_POLICY);
  output.set('X-Content-Type-Options', 'nosniff');
  output.set('X-Frame-Options', 'DENY');
  output.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  const location = output.get('location');
  if (location) {
    try { const destination = new URL(location, target); if (destination.origin === BACKEND) output.set('location', incoming.origin + destination.pathname + destination.search + destination.hash); }
    catch { output.delete('location'); }
  }
  const privatePath = /^\/(?:api(?:\/|$)|admin(?:\/|$)|studio(?:\/|$))/.test(incoming.pathname);
  if (privatePath || output.has('set-cookie')) {
    output.set('Cache-Control', 'no-store, private');
    output.set('Netlify-CDN-Cache-Control', 'no-store');
    output.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  if (incoming.pathname === '/agency-notifications.js') {
    output.set('Cache-Control', 'no-cache');
    output.set('Service-Worker-Allowed', '/');
  }
  const type = output.get('content-type') || '';
  const rewrite = /text\/html|application\/xml|text\/xml/.test(type) || incoming.pathname === '/robots.txt';
  let body = response.body;
  if (rewrite && request.method !== 'HEAD' && ![204, 205, 304].includes(response.status)) {
    const source = await response.text();
    body = /text\/html/.test(type) ? rewriteHtml(source, incoming.origin)
      : source.replaceAll(BACKEND, incoming.origin);
    output.delete('etag');
    output.delete('content-md5');
    output.set('Cache-Control', 'no-store');
    output.set('Netlify-CDN-Cache-Control', 'no-store');
  }
  if (request.method === 'HEAD' || [204, 205, 304].includes(response.status)) body = null;
  return new Response(body, { status: response.status, statusText: response.statusText, headers: output });
}

export async function serve(request, context, fetchBackend = fetch) {
  const url = new URL(request.url);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return error('Not found',404); }
  if (forbidden.test(pathname)) return error('Not found',404);
  if (/^\/(?:api|media|studio)(?:\/|$)/.test(pathname)) return proxy(request, fetchBackend);
  if (/^\/(?:signin-with-chatgpt|signout-with-chatgpt|callback)(?:\/|$)/.test(pathname)) {
    return Response.redirect(BACKEND + url.pathname + url.search, 307);
  }
  if (!READ_ONLY.has(request.method)) return error('Method not allowed',405);
  // Client-side navigation/prefetch requests need actual React Flight data,
  // never a static HTML snapshot. Keep the upstream byte stream untouched.
  if (APP_PAGE.test(pathname) && (url.searchParams.has('_rsc') ||
      request.headers.get('rsc') === '1' ||
      (request.headers.get('accept') || '').includes('text/x-component'))) {
    const result = await proxy(request, fetchBackend);
    const headers = new Headers(result.headers);
    headers.set('Cache-Control', 'no-store, private');
    headers.set('Netlify-CDN-Cache-Control', 'no-store');
    return new Response(result.body, {status: result.status, statusText: result.statusText, headers});
  }
  // Pages, JavaScript, CSS, icons and bundled videos are served from NETLIFY.
  // Only API/media requests above need the existing Cloudflare backend.
  const local = await context.next();
  // Recover known pages only if the static host cannot resolve their clean URL.
  if (local.status === 404 && /^\/(?:website-development|ai-creation|ai-automation|social-media-management|admin)\/?$/.test(pathname)) return proxy(request, fetchBackend);
  return rewriteResponse(request, local);
}

export default (request, context) => serve(request, context);
