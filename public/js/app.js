/**
 * SnapShare - Frontend Application Router & Logic
 * Dedicated Host Dashboard (/host/:id) & Guest Mobile Upload (/upload/:id)
 * Features Public Tunnel URL support for global internet sharing
 */

(function () {
  // Application State
  let serverInfo = { ips: [], primaryIp: window.location.hostname, publicUrl: null, port: window.location.port || 3000 };
  let currentEvent = null;
  let mediaItems = [];
  let hostKey = null;
  let activeFilter = 'all';
  let activeSort = 'newest';
  let selectedFiles = [];
  let sseSource = null;
  let lightboxIndex = -1;

  // DOM Pages
  const pageCreate = document.getElementById('page-create');
  const pageHost = document.getElementById('page-host');
  const pageGuest = document.getElementById('page-guest');
  const liveIndicator = document.getElementById('live-indicator');
  const btnHeaderSwitchView = document.getElementById('btn-header-switch-view');

  // Page 1: Create Form
  const formCreateEvent = document.getElementById('form-create-event');

  // Page 2: Host Dashboard Elements
  const hostDisplayTitle = document.getElementById('host-display-title');
  const hostDisplayEventId = document.getElementById('host-display-event-id');
  const hostDisplayExpiry = document.getElementById('host-display-expiry');
  const hostDisplayMediaCount = document.getElementById('host-display-media-count');
  const hostDisplayLockStatus = document.getElementById('host-display-lock-status');
  const hostBtnToggleLock = document.getElementById('host-btn-toggle-lock');
  const hostBtnDownloadZip = document.getElementById('host-btn-download-zip');
  const hostQrcodeContainer = document.getElementById('host-qrcode-container');
  const hostBtnDownloadQr = document.getElementById('host-btn-download-qr');
  const selectLanIp = document.getElementById('select-lan-ip');
  const hostDisplayUploadUrl = document.getElementById('host-display-upload-url');
  const hostBtnCopyUrl = document.getElementById('host-btn-copy-url');
  const hostLinkOpenGuest = document.getElementById('host-link-open-guest');
  const hostCountAll = document.getElementById('host-count-all');
  const hostCountPhotos = document.getElementById('host-count-photos');
  const hostCountVideos = document.getElementById('host-count-videos');
  const hostSortSelect = document.getElementById('host-sort-select');
  const hostGalleryGrid = document.getElementById('host-gallery-grid');
  const hostEmptyGallery = document.getElementById('host-empty-gallery');

  // Page 3: Guest Mobile Upload Elements
  const guestDisplayTitle = document.getElementById('guest-display-title');
  const guestDisplaySubtitle = document.getElementById('guest-display-subtitle');
  const guestLockedBanner = document.getElementById('guest-locked-banner');
  const guestDropZone = document.getElementById('guest-drop-zone');
  const guestFileInput = document.getElementById('guest-file-input');
  const guestBtnCamera = document.getElementById('guest-btn-camera');
  const guestBtnFile = document.getElementById('guest-btn-file');
  const guestUploadPreviewSection = document.getElementById('guest-upload-preview-section');
  const guestPreviewCount = document.getElementById('guest-preview-count');
  const guestPreviewGrid = document.getElementById('guest-preview-grid');
  const guestInputName = document.getElementById('guest-input-name');
  const guestInputCaption = document.getElementById('guest-input-caption');
  const guestBtnStartUpload = document.getElementById('guest-btn-start-upload');
  const guestBtnCancelPreview = document.getElementById('guest-btn-cancel-preview');
  const guestUploadProgressContainer = document.getElementById('guest-upload-progress-container');
  const guestUploadProgressBar = document.getElementById('guest-upload-progress-bar');
  const guestUploadPercentage = document.getElementById('guest-upload-percentage');
  const guestGalleryGrid = document.getElementById('guest-gallery-grid');
  const guestEmptyGallery = document.getElementById('guest-empty-gallery');

  // Lightbox Elements
  const lightboxModal = document.getElementById('lightbox-modal');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const lightboxMediaContainer = document.getElementById('lightbox-media-container');
  const lbUploader = document.getElementById('lb-uploader');
  const lbCaption = document.getElementById('lb-caption');
  const lbTime = document.getElementById('lb-time');
  const lbBtnLike = document.getElementById('lb-btn-like');
  const lbLikeCount = document.getElementById('lb-like-count');
  const lbBtnDownload = document.getElementById('lb-btn-download');
  const lbBtnDelete = document.getElementById('lb-btn-delete');

  // --- INITIALIZATION & ROUTER ---
  async function init() {
    await fetchServerInfo();
    setupEventListeners();
    handleRouting();
    window.addEventListener('popstate', handleRouting);
  }

  async function fetchServerInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        serverInfo = await res.json();
      }
    } catch (e) {
      console.warn('Could not fetch server network info');
    }
  }

  function handleRouting() {
    const path = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);
    const eventParam = urlParams.get('e') || urlParams.get('event');

    let mode = 'create';
    let eventId = null;

    if (path.startsWith('/host/')) {
      mode = 'host';
      eventId = path.replace('/host/', '').trim();
    } else if (path.startsWith('/upload/') || path.startsWith('/g/')) {
      mode = 'guest';
      eventId = path.replace(/^\/(upload|g)\//, '').trim();
    } else if (path.startsWith('/event/')) {
      mode = 'guest';
      eventId = path.replace('/event/', '').trim();
    } else if (eventParam) {
      mode = 'guest';
      eventId = eventParam.trim();
    }

    if (eventId) {
      loadEvent(eventId.toUpperCase(), mode);
    } else {
      showPage('create');
    }
  }

  function showPage(pageName) {
    pageCreate.style.display = 'none';
    pageHost.style.display = 'none';
    pageGuest.style.display = 'none';
    liveIndicator.style.display = 'none';
    btnHeaderSwitchView.style.display = 'none';

    if (pageName === 'create') {
      pageCreate.style.display = 'block';
    } else if (pageName === 'host') {
      pageHost.style.display = 'block';
      liveIndicator.style.display = 'flex';
      btnHeaderSwitchView.style.display = 'inline-flex';
      btnHeaderSwitchView.innerText = '📱 View Guest Mobile Page';
      btnHeaderSwitchView.onclick = () => {
        history.pushState(null, '', `/upload/${currentEvent.id}`);
        showPage('guest');
        renderGuestPage();
      };
    } else if (pageName === 'guest') {
      pageGuest.style.display = 'block';
      liveIndicator.style.display = 'flex';
      // Guests do NOT get a "Host Dashboard" button — keep it hidden
      btnHeaderSwitchView.style.display = 'none';
    }
  }

  // --- CREATE EVENT FORM ---
  formCreateEvent.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('event-title').value.trim();
    const hostPassword = document.getElementById('host-password').value.trim();
    const expiryHours = document.getElementById('expiry-hours').value;

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, hostPassword, expiryHours })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.event.hostKey) {
          localStorage.setItem(`hostKey_${data.event.id}`, data.event.hostKey);
        }
        showToast('Event created successfully! Launching Host Dashboard... 🎉');
        history.pushState(null, '', `/host/${data.event.id}`);
        loadEvent(data.event.id, 'host');
      } else {
        showToast(data.error || 'Failed to create event', 'error');
      }
    } catch (err) {
      showToast('Server error creating event', 'error');
    }
  });

  // --- LOAD EVENT & MEDIA ---
  async function loadEvent(eventId, targetMode) {
    try {
      const res = await fetch(`/api/events/${eventId}`);
      if (!res.ok) {
        showToast('Event not found or expired', 'error');
        showPage('create');
        history.pushState(null, '', '/');
        return;
      }

      currentEvent = await res.json();
      hostKey = localStorage.getItem(`hostKey_${currentEvent.id}`) || null;

      await loadMedia(eventId);
      connectSSE(eventId);

      // Route guard: if targeting host mode but no hostKey, redirect to guest page
      if (targetMode === 'host' && !hostKey) {
        history.replaceState(null, '', `/upload/${currentEvent.id}`);
        targetMode = 'guest';
      }

      showPage(targetMode);
      if (targetMode === 'host') {
        renderHostPage();
      } else {
        renderGuestPage();
      }
    } catch (e) {
      showToast('Failed to load event details', 'error');
      showPage('create');
    }
  }

  async function loadMedia(eventId) {
    try {
      const res = await fetch(`/api/events/${eventId}/media`);
      if (res.ok) {
        const data = await res.json();
        mediaItems = data.media || [];
      }
    } catch (e) {}
  }

  // --- REAL-TIME SSE FEED ---
  function connectSSE(eventId) {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`/api/events/${eventId}/stream`);

    sseSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'CONNECTED' && payload.publicUrl) {
          serverInfo.publicUrl = payload.publicUrl;
          if (pageHost.style.display !== 'none') populateLanIpSelector();
        } else if (payload.type === 'TUNNEL_UPDATED') {
          serverInfo.publicUrl = payload.publicUrl;
          showToast('🌐 Public Global URL connected! QR Code updated.', 'success');
          if (pageHost.style.display !== 'none') populateLanIpSelector();
        } else if (payload.type === 'MEDIA_UPLOADED') {
          const newItems = payload.newMedia || [];
          newItems.forEach(item => {
            if (!mediaItems.some(m => m.id === item.id)) mediaItems.unshift(item);
          });
          renderCurrentPageGallery();
          showToast(`📸 ${newItems.length} new upload(s) arrived live!`);
        } else if (payload.type === 'MEDIA_DELETED') {
          mediaItems = mediaItems.filter(m => m.id !== payload.mediaId);
          renderCurrentPageGallery();
          if (lightboxIndex !== -1 && mediaItems[lightboxIndex]?.id === payload.mediaId) closeLightbox();
        } else if (payload.type === 'MEDIA_LIKED') {
          const item = mediaItems.find(m => m.id === payload.mediaId);
          if (item) {
            item.likes = payload.likes;
            renderCurrentPageGallery();
            if (lightboxIndex !== -1 && mediaItems[lightboxIndex]?.id === payload.mediaId) {
              lbLikeCount.innerText = payload.likes;
            }
          }
        } else if (payload.type === 'LOCK_TOGGLED') {
          currentEvent.isLocked = payload.isLocked;
          if (pageHost.style.display !== 'none') renderHostPage();
          if (pageGuest.style.display !== 'none') renderGuestPage();
        }
      } catch (err) {}
    };
  }

  function renderCurrentPageGallery() {
    if (pageHost.style.display !== 'none') renderHostGallery();
    if (pageGuest.style.display !== 'none') renderGuestGallery();
  }

  // --- PAGE 2: HOST DASHBOARD RENDERER ---
  function renderHostPage() {
    hostDisplayTitle.innerText = currentEvent.title;
    hostDisplayEventId.innerText = `Code: ${currentEvent.id}`;
    hostDisplayMediaCount.innerText = `📁 ${mediaItems.length} File(s)`;
    
    // Expiry
    const expiresAt = new Date(currentEvent.expiresAt);
    const diffHours = Math.max(0, Math.round((expiresAt - new Date()) / (1000 * 3600)));
    hostDisplayExpiry.innerText = currentEvent.isExpired ? '❌ Expired' : `⏳ Expires in ~${diffHours}h`;

    // Lock Status
    if (currentEvent.isLocked) {
      hostDisplayLockStatus.innerText = '🔒 Uploads Locked';
      hostDisplayLockStatus.style.background = 'rgba(239, 68, 68, 0.15)';
      hostDisplayLockStatus.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      hostDisplayLockStatus.style.color = '#fca5a5';
      hostBtnToggleLock.innerText = '🔓 Unlock Uploads';
    } else {
      hostDisplayLockStatus.innerText = '🔓 Uploads Active';
      hostDisplayLockStatus.style.background = 'rgba(16, 185, 129, 0.1)';
      hostDisplayLockStatus.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      hostDisplayLockStatus.style.color = '#6ee7b7';
      hostBtnToggleLock.innerText = '🔒 Lock Uploads';
    }

    populateLanIpSelector();
    renderHostGallery();
  }

  function populateLanIpSelector() {
    const currentVal = selectLanIp.value;
    selectLanIp.innerHTML = '';

    const optionsList = [];

    // 1. PUBLIC GLOBAL HTTPS TUNNEL (Top Priority - Works for anyone anywhere!)
    if (serverInfo.publicUrl) {
      optionsList.push({
        ip: serverInfo.publicUrl,
        label: `🌐 PUBLIC GLOBAL URL (${serverInfo.publicUrl.replace('https://','')}) - RECOMMENDED FOR SHARING!`,
        isPublic: true
      });
    }

    // 2. Physical Wi-Fi LAN IP
    const currentHost = window.location.hostname;
    if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1' && !currentHost.includes('lhr.life')) {
      optionsList.push({ ip: `http://${currentHost}:${serverInfo.port || 3000}`, label: `Wi-Fi / LAN (${currentHost})` });
    }

    if (serverInfo.ips && serverInfo.ips.length > 0) {
      serverInfo.ips.forEach(item => {
        const fullUrl = `http://${item.ip}:${serverInfo.port || 3000}`;
        if (!optionsList.some(o => o.ip === fullUrl)) {
          const tag = item.isVirtual ? 'Virtual Adap' : 'Wi-Fi / Local Network';
          optionsList.push({ ip: fullUrl, label: `Local IP: ${item.ip} [${tag}]` });
        }
      });
    }

    optionsList.push({ ip: `http://localhost:${serverInfo.port || 3000}`, label: 'http://localhost:3000 (This PC Only)' });

    optionsList.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.ip;
      el.innerText = opt.label;
      selectLanIp.appendChild(el);
    });

    // Default to Public Global URL if available!
    if (serverInfo.publicUrl) {
      selectLanIp.value = serverInfo.publicUrl;
    } else if (currentVal && optionsList.some(o => o.ip === currentVal)) {
      selectLanIp.value = currentVal;
    }

    selectLanIp.onchange = updateHostQRCode;
    updateHostQRCode();
  }

  function getTargetGuestUploadUrl() {
    let baseUrl = selectLanIp.value || `http://localhost:${serverInfo.port || 3000}`;
    baseUrl = baseUrl.replace(/\/$/, '');
    return `${baseUrl}/upload/${currentEvent.id}`;
  }

  function updateHostQRCode() {
    const uploadUrl = getTargetGuestUploadUrl();
    hostDisplayUploadUrl.innerText = uploadUrl;
    hostLinkOpenGuest.href = `/upload/${currentEvent.id}`;

    if (window.QRCode) {
      new QRCode('host-qrcode-container', {
        text: uploadUrl,
        width: 190,
        height: 190,
        colorDark: '#070913',
        colorLight: '#ffffff'
      });
    }
  }

  function renderHostGallery() {
    let filtered = filterAndSortMedia(mediaItems);
    hostCountAll.innerText = mediaItems.length;
    hostCountPhotos.innerText = mediaItems.filter(m => m.type === 'photo').length;
    hostCountVideos.innerText = mediaItems.filter(m => m.type === 'video').length;

    hostGalleryGrid.innerHTML = '';
    if (filtered.length === 0) {
      hostEmptyGallery.style.display = 'block';
      return;
    }
    hostEmptyGallery.style.display = 'none';

    filtered.forEach(item => {
      const card = createMediaCard(item, true);
      hostGalleryGrid.appendChild(card);
    });
  }

  // --- PAGE 3: GUEST MOBILE PAGE RENDERER ---
  function renderGuestPage() {
    guestDisplayTitle.innerText = currentEvent.title;
    guestLockedBanner.style.display = currentEvent.isLocked ? 'block' : 'none';
    guestDropZone.style.display = currentEvent.isLocked ? 'none' : 'block';
    renderGuestGallery();
  }

  function renderGuestGallery() {
    let filtered = filterAndSortMedia(mediaItems);
    guestGalleryGrid.innerHTML = '';

    if (filtered.length === 0) {
      guestEmptyGallery.style.display = 'block';
      return;
    }
    guestEmptyGallery.style.display = 'none';

    filtered.forEach(item => {
      const card = createMediaCard(item, false);
      guestGalleryGrid.appendChild(card);
    });
  }

  // Helper: Filter & Sort
  function filterAndSortMedia(items) {
    let list = items.filter(item => {
      if (activeFilter === 'photo') return item.type === 'photo';
      if (activeFilter === 'video') return item.type === 'video';
      return true;
    });

    list.sort((a, b) => {
      if (activeSort === 'oldest') return new Date(a.uploadedAt) - new Date(b.uploadedAt);
      if (activeSort === 'likes') return (b.likes || 0) - (a.likes || 0);
      return new Date(b.uploadedAt) - new Date(a.uploadedAt);
    });

    return list;
  }

  // Helper: Create Gallery Item Card
  function createMediaCard(item, isHostView) {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.onclick = () => openLightbox(mediaItems.indexOf(item));

    if (item.type === 'video') {
      const video = document.createElement('video');
      video.src = item.url;
      video.className = 'media-thumbnail';
      video.muted = true;
      video.preload = 'metadata';
      card.appendChild(video);

      const typeBadge = document.createElement('div');
      typeBadge.className = 'media-badge-type';
      typeBadge.innerHTML = '🎥 Video';
      card.appendChild(typeBadge);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.caption || 'Event photo';
      img.className = 'media-thumbnail';
      img.loading = 'lazy';
      card.appendChild(img);

      const typeBadge = document.createElement('div');
      typeBadge.className = 'media-badge-type';
      typeBadge.innerHTML = '📷 Photo';
      card.appendChild(typeBadge);
    }

    const overlay = document.createElement('div');
    overlay.className = 'media-overlay';

    const infoBox = document.createElement('div');
    infoBox.innerHTML = `
      <div class="uploader-info">${escapeHtml(item.uploader || 'Guest')}</div>
      ${item.caption ? `<div class="uploader-caption">${escapeHtml(item.caption)}</div>` : ''}
    `;

    const actionBox = document.createElement('div');
    actionBox.style.display = 'flex';
    actionBox.style.gap = '6px';

    const likeBtn = document.createElement('button');
    likeBtn.className = 'like-btn';
    likeBtn.innerHTML = `❤️ ${item.likes || 0}`;
    likeBtn.onclick = (e) => {
      e.stopPropagation();
      likeMedia(item.id);
    };
    actionBox.appendChild(likeBtn);

    if (isHostView && hostKey) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.style.padding = '4px 8px';
      delBtn.style.fontSize = '12px';
      delBtn.innerHTML = '🗑️';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteMedia(item.id);
      };
      actionBox.appendChild(delBtn);
    }

    overlay.appendChild(infoBox);
    overlay.appendChild(actionBox);
    card.appendChild(overlay);

    return card;
  }

  // --- MOBILE GUEST UPLOADER HANDLERS ---
  guestBtnCamera.addEventListener('click', () => {
    guestFileInput.setAttribute('capture', 'environment');
    guestFileInput.click();
  });

  guestBtnFile.addEventListener('click', () => {
    guestFileInput.removeAttribute('capture');
    guestFileInput.click();
  });

  guestFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleSelectedFiles(Array.from(e.target.files));
  });

  function handleSelectedFiles(files) {
    selectedFiles = files;
    guestPreviewGrid.innerHTML = '';
    guestPreviewCount.innerText = selectedFiles.length;

    selectedFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'preview-item';
      const src = URL.createObjectURL(file);

      if (file.type.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.src = src;
        vid.muted = true;
        item.appendChild(vid);
      } else {
        const img = document.createElement('img');
        img.src = src;
        item.appendChild(img);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'preview-remove';
      removeBtn.innerText = '✕';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        selectedFiles.splice(index, 1);
        handleSelectedFiles(selectedFiles);
      };
      item.appendChild(removeBtn);
      guestPreviewGrid.appendChild(item);
    });

    guestUploadPreviewSection.style.display = selectedFiles.length > 0 ? 'block' : 'none';
  }

  guestBtnCancelPreview.addEventListener('click', () => {
    selectedFiles = [];
    guestUploadPreviewSection.style.display = 'none';
  });

  guestBtnStartUpload.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    const uploader = guestInputName.value.trim() || 'Guest';
    const caption = guestInputCaption.value.trim();

    const formData = new FormData();
    formData.append('uploader', uploader);
    formData.append('caption', caption);
    selectedFiles.forEach(file => formData.append('files', file));

    guestUploadProgressContainer.style.display = 'block';
    guestBtnStartUpload.disabled = true;

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/events/${currentEvent.id}/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          guestUploadProgressBar.style.width = `${percent}%`;
          guestUploadPercentage.innerText = `${percent}%`;
        }
      };

      xhr.onload = () => {
        guestBtnStartUpload.disabled = false;
        guestUploadProgressContainer.style.display = 'none';

        if (xhr.status === 200) {
          const res = JSON.parse(xhr.responseText);
          showToast(`Success! Uploaded ${res.count} file(s) 🎉`);
          selectedFiles = [];
          guestUploadPreviewSection.style.display = 'none';
          guestInputCaption.value = '';
          guestFileInput.value = '';
        } else {
          const res = JSON.parse(xhr.responseText || '{}');
          showToast(res.error || 'Upload failed', 'error');
        }
      };

      xhr.onerror = () => {
        guestBtnStartUpload.disabled = false;
        guestUploadProgressContainer.style.display = 'none';
        showToast('Network error during upload', 'error');
      };

      xhr.send(formData);
    } catch (err) {
      guestBtnStartUpload.disabled = false;
      showToast('Error uploading files', 'error');
    }
  });

  // --- HOST ACTIONS ---
  hostBtnToggleLock.addEventListener('click', async () => {
    if (!hostKey) return verifyAndNavigateHost();

    try {
      const res = await fetch(`/api/events/${currentEvent.id}/toggle-lock`, {
        method: 'POST',
        headers: { 'x-host-key': hostKey }
      });
      if (res.ok) {
        const data = await res.json();
        currentEvent.isLocked = data.isLocked;
        renderHostPage();
        showToast(data.isLocked ? 'Gallery Locked 🔒' : 'Gallery Unlocked 🔓');
      }
    } catch (e) {
      showToast('Error toggling lock state', 'error');
    }
  });

  hostBtnDownloadZip.addEventListener('click', () => downloadZipArchive());

  function downloadZipArchive() {
    if (!currentEvent || mediaItems.length === 0) {
      showToast('No media items to download', 'error');
      return;
    }
    showToast('📦 Preparing ZIP download...', 'info');
    const zipUrl = `/api/events/${currentEvent.id}/zip`;
    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = `${currentEvent.title}_Media.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function verifyAndNavigateHost() {
    if (hostKey) {
      history.pushState(null, '', `/host/${currentEvent.id}`);
      showPage('host');
      renderHostPage();
      return;
    }

    const pass = prompt('Enter Host Password for this event:');
    if (!pass) return;

    try {
      const res = await fetch(`/api/events/${currentEvent.id}/verify-host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        hostKey = data.hostKey;
        localStorage.setItem(`hostKey_${currentEvent.id}`, hostKey);
        showToast('Host Authenticated! 👑');
        history.pushState(null, '', `/host/${currentEvent.id}`);
        showPage('host');
        renderHostPage();
      } else {
        showToast('Incorrect Host Password', 'error');
      }
    } catch (e) {
      showToast('Authentication failed', 'error');
    }
  }

  // --- LIGHTBOX ---
  function openLightbox(index) {
    if (index < 0 || index >= mediaItems.length) return;
    lightboxIndex = index;
    const item = mediaItems[lightboxIndex];

    lightboxMediaContainer.innerHTML = '';
    if (item.type === 'video') {
      const vid = document.createElement('video');
      vid.src = item.url;
      vid.controls = true;
      vid.autoplay = true;
      lightboxMediaContainer.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      lightboxMediaContainer.appendChild(img);
    }

    lbUploader.innerText = item.uploader ? `Uploaded by ${item.uploader}` : 'Guest Upload';
    lbCaption.innerText = item.caption || 'No caption';
    lbTime.innerText = new Date(item.uploadedAt).toLocaleString();
    lbLikeCount.innerText = item.likes || 0;
    lbBtnDownload.href = item.url;
    lbBtnDownload.download = item.originalName || item.filename;

    if (hostKey) {
      lbBtnDelete.style.display = 'inline-flex';
      lbBtnDelete.onclick = () => deleteMedia(item.id);
    } else {
      lbBtnDelete.style.display = 'none';
    }

    lbBtnLike.onclick = () => likeMedia(item.id);
    lightboxModal.classList.add('active');
  }

  function closeLightbox() {
    lightboxModal.classList.remove('active');
    lightboxMediaContainer.innerHTML = '';
    lightboxIndex = -1;
  }

  btnCloseLightbox.addEventListener('click', closeLightbox);
  lightboxModal.addEventListener('click', (e) => { if (e.target === lightboxModal) closeLightbox(); });

  // --- LIKE & DELETE MEDIA ---
  async function likeMedia(mediaId) {
    try {
      const res = await fetch(`/api/events/${currentEvent.id}/media/${mediaId}/like`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const item = mediaItems.find(m => m.id === mediaId);
        if (item) {
          item.likes = data.likes;
          renderCurrentPageGallery();
          if (lightboxIndex !== -1 && mediaItems[lightboxIndex]?.id === mediaId) {
            lbLikeCount.innerText = data.likes;
          }
        }
      }
    } catch (e) {}
  }

  async function deleteMedia(mediaId) {
    if (!confirm('Delete this media item?')) return;
    try {
      const res = await fetch(`/api/events/${currentEvent.id}/media/${mediaId}`, {
        method: 'DELETE',
        headers: { 'x-host-key': hostKey }
      });

      if (res.ok) {
        showToast('Media deleted');
        closeLightbox();
        mediaItems = mediaItems.filter(m => m.id !== mediaId);
        renderCurrentPageGallery();
      } else {
        showToast('Failed to delete media', 'error');
      }
    } catch (e) {
      showToast('Error deleting media', 'error');
    }
  }

  // --- SETUP LISTENERS ---
  function setupEventListeners() {
    document.getElementById('btn-home').addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', '/');
      showPage('create');
    });

    hostBtnDownloadQr.addEventListener('click', () => {
      const img = hostQrcodeContainer.querySelector('img');
      if (img) {
        const link = document.createElement('a');
        link.href = img.src;
        link.download = `${currentEvent.title}_QRCode.png`;
        link.click();
      }
    });

    hostBtnCopyUrl.addEventListener('click', () => {
      const url = hostDisplayUploadUrl.innerText;
      navigator.clipboard.writeText(url).then(() => showToast('Guest upload link copied to clipboard! 📋'));
    });

    const guestBtnHostAuth = document.getElementById('guest-btn-host-auth');
    if (guestBtnHostAuth) {
      guestBtnHostAuth.addEventListener('click', verifyAndNavigateHost);
    }

    // Filter Buttons (Host & Guest)
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeFilter = e.target.dataset.filter || e.target.dataset.guestFilter || 'all';
        renderCurrentPageGallery();
      });
    });

    if (hostSortSelect) {
      hostSortSelect.addEventListener('change', (e) => {
        activeSort = e.target.value;
        renderHostGallery();
      });
    }
  }

  function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'error') toast.style.borderColor = 'var(--danger)';
    toast.innerText = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  document.addEventListener('DOMContentLoaded', init);
})();
