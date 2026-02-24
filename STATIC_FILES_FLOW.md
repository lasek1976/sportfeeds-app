# Static Files Request Flow & Caching

## 📋 Complete Flow: How Browser Gets CSS/JS Files

### First Visit (Cold Cache)

```
┌──────────────────────────────────────────────────────────────────┐
│ Step 1: User opens http://localhost:3000                        │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│ • Request: GET / HTTP/1.1                                        │
│ • Host: localhost:3000                                           │
└──────────────────────────────────────────────────────────────────┘
                              ↓ HTTP Request
┌──────────────────────────────────────────────────────────────────┐
│ NODE.JS SERVER (Express.js)                                      │
│                                                                  │
│ Line 43-45 in server/index.js:                                  │
│   app.get('/', (req, res) => {                                  │
│     res.sendFile(path.join(__dirname, '../public/index.html')); │
│   });                                                            │
│                                                                  │
│ • Reads: public/index.html from disk                            │
│ • Sends: HTTP 200 OK                                            │
│ • Content-Type: text/html                                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓ HTTP Response
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│ • Receives: index.html                                           │
│ • Parses HTML                                                    │
│ • Finds: <link rel="stylesheet" href="/css/style.css">         │
│ • Finds: <script src="/js/app.js">                             │
│ • Finds: <script src="/js/treeBuilder.js">                     │
│ • ... etc.                                                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Step 2: Browser requests CSS file                               │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│ • Request: GET /css/style.css HTTP/1.1                          │
│ • Host: localhost:3000                                           │
│ • Accept: text/css                                               │
└──────────────────────────────────────────────────────────────────┘
                              ↓ HTTP Request
┌──────────────────────────────────────────────────────────────────┐
│ NODE.JS SERVER (Express.js)                                      │
│                                                                  │
│ Line 37 in server/index.js:                                     │
│   app.use(express.static(path.join(__dirname, '../public')));   │
│                                                                  │
│ Express.static middleware:                                       │
│ 1. Receives request for /css/style.css                          │
│ 2. Maps to file system: public/css/style.css                    │
│ 3. Checks if file exists                                        │
│ 4. Reads file from disk                                         │
│ 5. Detects MIME type (text/css)                                 │
│ 6. Sends HTTP response with headers:                            │
│    • Content-Type: text/css                                     │
│    • Content-Length: 15234 bytes                                │
│    • ETag: "W/3b82-abc123..."                                   │
│    • Last-Modified: Fri, 14 Feb 2026 10:30:00 GMT              │
│    • Cache-Control: public, max-age=0 (default)                │
└──────────────────────────────────────────────────────────────────┘
                              ↓ HTTP Response
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│ • Receives: style.css                                            │
│ • Stores in MEMORY CACHE (for current session)                  │
│ • Stores in DISK CACHE (for future visits)                      │
│ • Applies CSS to page                                            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Step 3: Browser requests JavaScript files (same process)        │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│ Multiple parallel requests:                                      │
│ • GET /js/app.js                                                │
│ • GET /js/treeBuilder.js                                        │
│ • GET /js/eventRenderer.js                                      │
│ • GET /js/eventDetailUpdater.js                                 │
│ • GET /js/treeUpdater.js                                        │
│ • GET /js/feedTypeManager.js                                    │
│                                                                  │
│ Express.static middleware serves each file from public/ folder  │
│ Browser caches each file                                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Second Visit (Warm Cache)

### When User Refreshes Page (F5)

```
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│ • Request: GET /css/style.css HTTP/1.1                          │
│ • If-Modified-Since: Fri, 14 Feb 2026 10:30:00 GMT             │
│ • If-None-Match: "W/3b82-abc123..."                             │
└──────────────────────────────────────────────────────────────────┘
                              ↓ Conditional Request
┌──────────────────────────────────────────────────────────────────┐
│ NODE.JS SERVER (Express.js)                                      │
│                                                                  │
│ Express.static middleware:                                       │
│ 1. Checks file's Last-Modified date                             │
│ 2. Checks file's ETag                                           │
│ 3. Compares with If-Modified-Since / If-None-Match             │
│                                                                  │
│ IF FILE UNCHANGED:                                               │
│ • Sends: HTTP 304 Not Modified                                  │
│ • No body (saves bandwidth!)                                    │
│                                                                  │
│ IF FILE CHANGED:                                                 │
│ • Sends: HTTP 200 OK                                            │
│ • Sends: New file content                                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓ HTTP 304 (typical case)
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│ • Receives: HTTP 304 Not Modified                               │
│ • Uses CACHED VERSION from disk                                 │
│ • No download needed! (faster page load)                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🗂️ Browser Cache Hierarchy

### 1. Memory Cache (RAM)
- **Duration:** Current browser session only
- **Speed:** Instant (microseconds)
- **Size:** Limited (usually 50-100 MB)
- **Cleared:** When tab/browser closes

### 2. Disk Cache (Hard Drive/SSD)
- **Duration:** Persistent across sessions
- **Speed:** Very fast (milliseconds)
- **Size:** Larger (usually 250-500 MB)
- **Cleared:** Manually (Ctrl+Shift+Del) or when full

### Cache Decision Flow:

```
Browser needs /css/style.css
         ↓
   [Check Memory Cache]
         ↓
   Found in RAM?
    ┌──Yes──→ Use memory cache (instant)
    │
    No
    ↓
   [Check Disk Cache]
         ↓
   Found on disk?
    ┌──Yes──→ Load from disk (very fast)
    │         Still valid? (check expiry)
    │              ↓
    │         Yes → Use disk cache
    │              ↓
    │         No → Make conditional request (304)
    │
    No
    ↓
   [Network Request]
         ↓
   GET /css/style.css from server (slow)
         ↓
   Download file
         ↓
   Store in memory cache
         ↓
   Store in disk cache
```

---

## 📊 Cache Headers Explained

### Default Express.static Headers

```http
HTTP/1.1 200 OK
Content-Type: text/css
Content-Length: 15234
ETag: "W/3b82-18d5e5c8c90"
Last-Modified: Fri, 14 Feb 2026 10:30:00 GMT
Cache-Control: public, max-age=0
Date: Fri, 14 Feb 2026 12:00:00 GMT
```

#### What Each Header Means:

| Header | Purpose | Value |
|--------|---------|-------|
| **Content-Type** | MIME type of file | `text/css`, `application/javascript`, `text/html` |
| **Content-Length** | File size in bytes | `15234` |
| **ETag** | File version identifier | `"W/3b82-18d5e5c8c90"` (weak etag) |
| **Last-Modified** | When file was last changed | `Fri, 14 Feb 2026 10:30:00 GMT` |
| **Cache-Control** | Caching directives | `public, max-age=0` |
| **Date** | When response was sent | `Fri, 14 Feb 2026 12:00:00 GMT` |

#### Cache-Control Values:

- `public` - Can be cached by browser and intermediaries (proxies)
- `private` - Can only be cached by browser (not proxies)
- `max-age=0` - Browser should revalidate on every request (sends 304 if unchanged)
- `max-age=3600` - Browser can use cache for 1 hour without asking server
- `no-cache` - Must revalidate with server before using cache
- `no-store` - Don't cache at all (always download fresh)

---

## 🚀 Performance Impact

### Cold Cache (First Visit):

```
Request: GET /css/style.css
         ↓
Server reads from disk: ~5 ms
         ↓
Send over network: ~10 ms (localhost) / 50-200 ms (internet)
         ↓
Total: ~15-205 ms
```

### Warm Cache (Memory):

```
Request: /css/style.css
         ↓
Check memory cache: ~0.1 ms
         ↓
Total: ~0.1 ms (150-2000x faster!)
```

### Warm Cache (Disk, 304):

```
Request: GET /css/style.css
         ↓
Server checks Last-Modified: ~1 ms
         ↓
Send 304 response (no body): ~5 ms
         ↓
Browser loads from disk cache: ~2 ms
         ↓
Total: ~8 ms (2-25x faster!)
```

---

## 🔍 How to See This in Browser DevTools

### Chrome DevTools (F12):

1. Open DevTools → **Network** tab
2. Reload page (F5)
3. Look at the **Size** column:

| Status | Size Column | Meaning |
|--------|-------------|---------|
| 200 OK | `15.2 KB` | Downloaded from server |
| 200 OK | `(memory cache)` | Loaded from RAM |
| 200 OK | `(disk cache)` | Loaded from disk |
| 304 Not Modified | `304 bytes` | Server said "use your cache" |

4. Look at the **Time** column:
   - Memory cache: ~0-1 ms
   - Disk cache: ~2-5 ms
   - Network: ~10-500 ms

### View Cache Headers:

1. Click on a request (e.g., `style.css`)
2. Go to **Headers** tab
3. Scroll to **Response Headers**
4. See `Cache-Control`, `ETag`, `Last-Modified`

---

## ⚙️ Customizing Cache Behavior

### Current Default (Express.static):

```javascript
app.use(express.static('public'));
// Cache-Control: public, max-age=0
// Browser revalidates on every refresh
```

### Option 1: Aggressive Caching (1 hour)

```javascript
app.use(express.static('public', {
  maxAge: '1h'  // Cache for 1 hour without asking server
}));
// Cache-Control: public, max-age=3600
```

### Option 2: Long-term Caching (1 year)

```javascript
app.use(express.static('public', {
  maxAge: '1y',  // Cache for 1 year
  immutable: true  // File will never change
}));
// Cache-Control: public, max-age=31536000, immutable
```

### Option 3: No Caching (Development)

```javascript
app.use(express.static('public', {
  maxAge: 0,
  etag: false,  // Disable ETag
  lastModified: false  // Disable Last-Modified
}));
// Always downloads fresh files
```

### Option 4: Custom Headers Per File Type

```javascript
app.use(express.static('public', {
  setHeaders: (res, path) => {
    if (path.endsWith('.css') || path.endsWith('.js')) {
      // Cache CSS/JS for 1 day
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (path.endsWith('.html')) {
      // Don't cache HTML (always fresh)
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
```

---

## 🧪 Testing Cache Behavior

### Force Refresh (Bypass Cache):

| Action | Shortcut | Result |
|--------|----------|--------|
| Normal Reload | F5 / Ctrl+R | Uses cache, sends conditional requests (304) |
| Hard Reload | Ctrl+F5 / Ctrl+Shift+R | Bypasses cache, downloads fresh |
| Clear Cache | Ctrl+Shift+Del | Deletes all cached files |

### Disable Cache (DevTools):

1. Open DevTools (F12)
2. Go to **Network** tab
3. Check **Disable cache** checkbox
4. Now every refresh downloads fresh files (good for development)

---

## 📌 Summary

### Your Current Flow:

```
1. Browser requests /css/style.css
2. Express.static middleware:
   - Reads public/css/style.css from disk
   - Sends file with Cache-Control: public, max-age=0
3. Browser receives file
4. Browser caches in:
   - Memory (for current session)
   - Disk (for future visits)
5. Next request:
   - Browser checks cache
   - Sends If-Modified-Since header
   - Server responds 304 if unchanged
   - Browser uses cached version
```

### Benefits:

✅ **Faster page loads** (memory cache = instant)
✅ **Reduced bandwidth** (304 responses have no body)
✅ **Better user experience** (faster interactions)
✅ **Lower server load** (fewer file reads)

### Current Behavior:

- ✅ Files are cached
- ✅ Browser revalidates on every refresh (max-age=0)
- ✅ Server sends 304 if file unchanged
- ✅ Good for development (always gets latest changes)

### For Production:

Consider increasing `max-age` for static assets:
```javascript
app.use(express.static('public', { maxAge: '1d' }));
```

This allows browser to use cache for 24 hours without asking server, significantly improving performance for repeat visitors!

---

**Last Updated:** 2026-02-14
**Related:** ARCHITECTURE.md, PROTOC_EXPLAINED.md
