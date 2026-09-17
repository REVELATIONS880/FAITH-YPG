const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

// Global Tunnel State for local dev mode
let publicTunnelUrl = null;

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR, PUBLIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- STARTUP DIAGNOSTICS (helps debug Render / cloud deployments) ---
console.log('=== SnapShare Startup Diagnostics ===');
console.log('NODE_ENV      :', process.env.NODE_ENV || '(not set)');
console.log('PORT          :', process.env.PORT || '3000 (default)');
console.log('__dirname     :', __dirname);
console.log('PUBLIC_DIR    :', PUBLIC_DIR, '| exists:', fs.existsSync(PUBLIC_DIR));
console.log('index.html    :', path.join(PUBLIC_DIR, 'index.html'), '| exists:', fs.existsSync(path.join(PUBLIC_DIR, 'index.html')));
console.log('DATA_DIR      :', DATA_DIR, '| exists:', fs.existsSync(DATA_DIR));
console.log('UPLOADS_DIR   :', UPLOADS_DIR, '| exists:', fs.existsSync(UPLOADS_DIR));
try {
  const pubContents = fs.readdirSync(PUBLIC_DIR);
  console.log('public/ files :', pubContents.join(', '));
} catch(e) {
  console.log('public/ files : (error reading dir)', e.message);
}
console.log('=====================================');

// SSE Clients Registry: eventId -> Set of response objects
const sseClients = new Map();

// Helper: Read Events
function getEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Helper: Save Events
function saveEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf8');
}

// Helper: Get all local IP addresses
function getAllLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const isVirtual = /vmware|vbox|veth|docker|hyper-v|loopback|npcap/i.test(name);
        ips.push({
          ip: net.address,
          name: name,
          isVirtual: isVirtual
        });
      }
    }
  }

  ips.sort((a, b) => (a.isVirtual === b.isVirtual ? 0 : a.isVirtual ? 1 : -1));
  return ips;
}

// Start Local Dev Cloudflare/SSH Quick Tunnel (only if running locally)
function startLocalDevTunnel() {
  if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.RAILWAY_STATIC_URL) {
    console.log('☁️ Running in 24/7 Cloud Production Mode.');
    return;
  }

  const localCfExe = path.join(__dirname, 'bin', 'cloudflared.exe');
  
  if (fs.existsSync(localCfExe)) {
    console.log('⚡ Launching Cloudflare Tunnel (cloudflared.exe)...');
    try {
      const cfProc = spawn(localCfExe, ['tunnel', '--url', `http://localhost:${PORT}`]);
      
      const handleCfOutput = (data) => {
        const text = data.toString();
        const match = text.match(/(https:\/\/[a-z0-9\-]+\.trycloudflare\.com)/i);
        if (match && match[1] !== publicTunnelUrl) {
          publicTunnelUrl = match[1];
          console.log(`\n==================================================`);
          console.log(`🎉 LOCAL DEV CLOUDFLARE PUBLIC URL ACTIVE!`);
          console.log(`👉 ${publicTunnelUrl}`);
          console.log(`==================================================\n`);

          for (const [eventId, clients] of sseClients.entries()) {
            const payload = `data: ${JSON.stringify({ type: 'TUNNEL_UPDATED', publicUrl: publicTunnelUrl })}\n\n`;
            for (const res of clients) res.write(payload);
          }
        }
      };

      cfProc.stdout.on('data', handleCfOutput);
      cfProc.stderr.on('data', handleCfOutput);

      cfProc.on('close', () => {
        publicTunnelUrl = null;
        setTimeout(startLocalDevTunnel, 5000);
      });
      return;
    } catch (e) {}
  }

  // Fallback: OpenSSH localhost.run tunnel
  const sshBin = fs.existsSync('C:\\Windows\\System32\\OpenSSH\\ssh.exe') 
    ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' 
    : 'ssh';

  const sshArgs = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-R', `80:localhost:${PORT}`,
    'nokey@localhost.run'
  ];
  
  try {
    const tunnelProc = spawn(sshBin, sshArgs);
    
    const handleOutput = (data) => {
      const text = data.toString();
      const match = text.match(/(https:\/\/[a-z0-9\-]+\.lhr\.life)/i);
      if (match && match[1] !== publicTunnelUrl) {
        publicTunnelUrl = match[1];
        console.log(`🎉 PUBLIC LOCAL DEV SSH URL ACTIVE: ${publicTunnelUrl}`);
        for (const [eventId, clients] of sseClients.entries()) {
          const payload = `data: ${JSON.stringify({ type: 'TUNNEL_UPDATED', publicUrl: publicTunnelUrl })}\n\n`;
          for (const res of clients) res.write(payload);
        }
      }
    };

    tunnelProc.stdout.on('data', handleOutput);
    tunnelProc.stderr.on('data', handleOutput);

    tunnelProc.on('close', () => {
      publicTunnelUrl = null;
      setTimeout(startLocalDevTunnel, 5000);
    });
  } catch (err) {}
}

startLocalDevTunnel();

// Helper: Broadcast SSE event
function broadcastSSE(eventId, payload) {
  const clients = sseClients.get(eventId);
  if (clients) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      res.write(data);
    }
  }
}

// Multipart Parser
function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  
  let start = 0;
  while (true) {
    const boundaryIdx = buffer.indexOf(boundaryBuf, start);
    if (boundaryIdx === -1) break;
    
    if (start > 0) {
      const part = buffer.subarray(start, boundaryIdx - 2);
      const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd !== -1) {
        const rawHeaders = part.subarray(0, headerEnd).toString('utf8');
        const body = part.subarray(headerEnd + 4);
        
        const dispMatch = rawHeaders.match(/Content-Disposition:\ *form-data;\ *name="([^"]+)"(?:;\ *filename="([^"]+)")?/i);
        if (dispMatch) {
          const fieldName = dispMatch[1];
          const filename = dispMatch[2];
          
          if (filename) {
            const typeMatch = rawHeaders.match(/Content-Type:\ *([^\r\n]+)/i);
            const mimeType = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
            files.push({
              fieldName,
              filename,
              mimeType,
              data: body
            });
          } else {
            fields[fieldName] = body.toString('utf8').trim();
          }
        }
      }
    }
    
    start = boundaryIdx + boundaryBuf.length + 2;
  }
  return { fields, files };
}

// ZIP Generator
function createZipBuffer(filesList) {
  const localHeaders = [];
  const centralDirs = [];
  let offset = 0;

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function calcCRC32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  for (const file of filesList) {
    const filenameBuf = Buffer.from(file.filename, 'utf8');
    const fileBuf = file.buffer;
    const crc = calcCRC32(fileBuf);
    const size = fileBuf.length;

    const lh = Buffer.alloc(30 + filenameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(filenameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    filenameBuf.copy(lh, 30);

    localHeaders.push(lh);
    localHeaders.push(fileBuf);

    const cd = Buffer.alloc(46 + filenameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(filenameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    filenameBuf.copy(cd, 46);

    centralDirs.push(cd);
    offset += lh.length + fileBuf.length;
  }

  const cdStartOffset = offset;
  let cdSize = 0;
  for (const cd of centralDirs) cdSize += cd.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(filesList.length, 8);
  eocd.writeUInt16LE(filesList.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStartOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralDirs, eocd]);
}

// Request Handler
const server = http.createServer((req, res) => {
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const parsedUrl = new URL(req.url, `${proto}://${hostHeader}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-host-key');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // GET /api/info
  if (method === 'GET' && pathname === '/api/info') {
    const allIps = getAllLocalIps();
    // In cloud mode, hostHeader is the 24/7 public domain!
    const isCloudHost = !hostHeader.includes('localhost') && !hostHeader.includes('127.0.0.1') && !hostHeader.includes('192.168.') && !hostHeader.includes('172.16.');
    const cloudUrl = isCloudHost ? `${proto}://${hostHeader}` : null;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ips: allIps,
      primaryIp: allIps.length > 0 ? allIps[0].ip : 'localhost',
      publicUrl: cloudUrl || publicTunnelUrl,
      port: PORT,
      timestamp: new Date().toISOString()
    }));
  }

  // POST /api/events - Create new event
  if (method === 'POST' && pathname === '/api/events') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const title = (payload.title || 'Event Party').trim();
        const hostPassword = payload.hostPassword ? payload.hostPassword.trim() : '';
        const guestPassword = payload.guestPassword ? payload.guestPassword.trim() : '';
        const expiryHours = parseInt(payload.expiryHours, 10) || 48;

        const eventId = crypto.randomBytes(4).toString('hex').toUpperCase();
        const hostKey = crypto.randomBytes(16).toString('hex');

        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();

        const events = getEvents();
        events[eventId] = {
          id: eventId,
          title,
          hostPassword,
          guestPassword,
          hostKey,
          createdAt,
          expiresAt,
          isLocked: false,
          media: []
        };
        saveEvents(events);

        const eventDir = path.join(UPLOADS_DIR, eventId);
        if (!fs.existsSync(eventDir)) fs.mkdirSync(eventDir, { recursive: true });

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          event: {
            id: eventId,
            title,
            hasHostPassword: !!hostPassword,
            hasGuestPassword: !!guestPassword,
            hostKey,
            createdAt,
            expiresAt,
            isLocked: false,
            mediaCount: 0
          }
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }

  // GET /api/events/:id - Get event details
  const matchGetEvent = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)$/);
  if (method === 'GET' && matchGetEvent) {
    const eventId = matchGetEvent[1].toUpperCase();
    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    const isExpired = new Date(ev.expiresAt) < new Date();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      id: ev.id,
      title: ev.title,
      hasHostPassword: !!ev.hostPassword,
      hasGuestPassword: !!ev.guestPassword,
      createdAt: ev.createdAt,
      expiresAt: ev.expiresAt,
      isExpired,
      isLocked: ev.isLocked || false,
      mediaCount: (ev.media || []).length
    }));
  }

  // POST /api/events/:id/verify-host
  const matchVerifyHost = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/verify-host$/);
  if (method === 'POST' && matchVerifyHost) {
    const eventId = matchVerifyHost[1].toUpperCase();
    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const pass = (payload.password || '').trim();
      const hostKey = (payload.hostKey || '').trim();

      const isValid = (hostKey && hostKey === ev.hostKey) || (ev.hostPassword && pass === ev.hostPassword);
      if (isValid) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, hostKey: ev.hostKey }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Incorrect host password' }));
      }
    });
    return;
  }

  // POST /api/events/:id/toggle-lock
  const matchToggleLock = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/toggle-lock$/);
  if (method === 'POST' && matchToggleLock) {
    const eventId = matchToggleLock[1].toUpperCase();
    const hostKey = req.headers['x-host-key'];
    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    if (!hostKey || hostKey !== ev.hostKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized host key' }));
    }

    ev.isLocked = !ev.isLocked;
    saveEvents(events);

    broadcastSSE(eventId, { type: 'LOCK_TOGGLED', isLocked: ev.isLocked });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, isLocked: ev.isLocked }));
  }

  // GET /api/events/:id/media
  const matchGetMedia = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/media$/);
  if (method === 'GET' && matchGetMedia) {
    const eventId = matchGetMedia[1].toUpperCase();
    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ eventId, media: ev.media || [] }));
  }

  // GET /api/events/:id/stream - SSE real-time feed
  const matchStream = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/stream$/);
  if (method === 'GET' && matchStream) {
    const eventId = matchStream[1].toUpperCase();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', eventId, publicUrl: publicTunnelUrl })}\n\n`);

    if (!sseClients.has(eventId)) sseClients.set(eventId, new Set());
    sseClients.get(eventId).add(res);

    req.on('close', () => {
      const clients = sseClients.get(eventId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) sseClients.delete(eventId);
      }
    });
    return;
  }

  // POST /api/events/:id/upload
  const matchUpload = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/upload$/);
  if (method === 'POST' && matchUpload) {
    const eventId = matchUpload[1].toUpperCase();
    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    if (ev.isLocked) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'This gallery has been locked by the host.' }));
    }

    if (new Date(ev.expiresAt) < new Date()) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'This event has expired.' }));
    }

    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid content type' }));
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const boundary = boundaryMatch[1];
      const parsed = parseMultipart(buffer, boundary);

      const uploaderName = (parsed.fields.uploader || 'Guest').trim();
      const caption = (parsed.fields.caption || '').trim();
      const eventDir = path.join(UPLOADS_DIR, eventId);
      if (!fs.existsSync(eventDir)) fs.mkdirSync(eventDir, { recursive: true });

      const uploadedItems = [];

      for (const file of parsed.files) {
        const fileExt = path.extname(file.filename).toLowerCase() || (file.mimeType.startsWith('video/') ? '.mp4' : '.jpg');
        const mediaId = crypto.randomBytes(6).toString('hex');
        const savedFilename = `${mediaId}_${Date.now()}${fileExt}`;
        const filePath = path.join(eventDir, savedFilename);

        fs.writeFileSync(filePath, file.data);

        const isVideo = file.mimeType.startsWith('video/') || ['.mp4', '.mov', '.webm', '.avi', '.m4v'].includes(fileExt);

        const mediaItem = {
          id: mediaId,
          filename: savedFilename,
          originalName: file.filename,
          url: `/uploads/${eventId}/${savedFilename}`,
          type: isVideo ? 'video' : 'photo',
          mimeType: file.mimeType,
          size: file.data.length,
          uploader: uploaderName,
          caption,
          uploadedAt: new Date().toISOString(),
          likes: 0
        };

        ev.media.unshift(mediaItem);
        uploadedItems.push(mediaItem);
      }

      saveEvents(events);

      broadcastSSE(eventId, {
        type: 'MEDIA_UPLOADED',
        eventId,
        newMedia: uploadedItems
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        count: uploadedItems.length,
        items: uploadedItems
      }));
    });
    return;
  }

  // DELETE /api/events/:id/media/:mediaId
  const matchDeleteMedia = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/media\/([A-Za-z0-9]+)$/);
  if (method === 'DELETE' && matchDeleteMedia) {
    const eventId = matchDeleteMedia[1].toUpperCase();
    const mediaId = matchDeleteMedia[2];
    const hostKey = req.headers['x-host-key'];

    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    if (!hostKey || hostKey !== ev.hostKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized host key' }));
    }

    const idx = (ev.media || []).findIndex(m => m.id === mediaId);
    if (idx === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Media not found' }));
    }

    const [deletedItem] = ev.media.splice(idx, 1);
    saveEvents(events);

    const filePath = path.join(UPLOADS_DIR, eventId, deletedItem.filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }

    broadcastSSE(eventId, {
      type: 'MEDIA_DELETED',
      eventId,
      mediaId
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, mediaId }));
  }

  // POST /api/events/:id/media/:mediaId/like
  const matchLikeMedia = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/media\/([A-Za-z0-9]+)\/like$/);
  if (method === 'POST' && matchLikeMedia) {
    const eventId = matchLikeMedia[1].toUpperCase();
    const mediaId = matchLikeMedia[2];
    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    const mediaItem = (ev.media || []).find(m => m.id === mediaId);
    if (!mediaItem) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Media not found' }));
    }

    mediaItem.likes = (mediaItem.likes || 0) + 1;
    saveEvents(events);

    broadcastSSE(eventId, {
      type: 'MEDIA_LIKED',
      eventId,
      mediaId,
      likes: mediaItem.likes
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, likes: mediaItem.likes }));
  }

  // GET /api/events/:id/zip
  const matchZip = pathname.match(/^\/api\/events\/([A-Za-z0-9]+)\/zip$/);
  if (method === 'GET' && matchZip) {
    const eventId = matchZip[1].toUpperCase();
    const events = getEvents();
    const ev = events[eventId];
    if (!ev) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Event not found' }));
    }

    const mediaList = ev.media || [];
    if (mediaList.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No media files in this event gallery.' }));
    }

    const eventDir = path.join(UPLOADS_DIR, eventId);
    const filesToZip = [];

    for (const item of mediaList) {
      const filePath = path.join(eventDir, item.filename);
      if (fs.existsSync(filePath)) {
        const fileBuf = fs.readFileSync(filePath);
        const cleanName = `${item.uploader || 'Guest'}_${item.id}_${item.originalName || item.filename}`;
        filesToZip.push({
          filename: cleanName.replace(/[^a-zA-Z0-9._-]/g, '_'),
          buffer: fileBuf
        });
      }
    }

    if (filesToZip.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Media files missing on server.' }));
    }

    const zipBuffer = createZipBuffer(filesToZip);
    const zipFilename = `${ev.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_Media.zip`;

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
      'Content-Length': zipBuffer.length
    });
    return res.end(zipBuffer);
  }

  // --- SERVE UPLOADED MEDIA ---
  const matchUploadFile = pathname.match(/^\/uploads\/([A-Za-z0-9]+)\/([^\/]+)$/);
  if (method === 'GET' && matchUploadFile) {
    const eventId = matchUploadFile[1].toUpperCase();
    const filename = matchUploadFile[2];
    const filePath = path.join(UPLOADS_DIR, eventId, filename);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File not found');
    }

    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.svg': 'image/svg+xml'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=31536000'
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  // --- SERVE STATIC FRONTEND FILES ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!path.extname(filePath) && !fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    return fs.createReadStream(filePath).pipe(res);
  }

  const indexHtml = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(indexHtml).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getAllLocalIps();
  console.log(`\n==================================================`);
  console.log(`🚀 SnapShare Server is active and listening!`);
  console.log(`💻 Local Host:   http://localhost:${PORT}`);
  // On Render, RENDER_EXTERNAL_URL is automatically set
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`🌍 Render URL:   ${process.env.RENDER_EXTERNAL_URL}`);
  }
  ips.forEach(i => console.log(`📱 LAN (${i.name}): http://${i.ip}:${PORT}`));
  console.log(`==================================================\n`);
});
