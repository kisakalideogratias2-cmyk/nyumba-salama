'use strict';

/*
 * NYUMBA SALAMA — cloud.js
 * Supabase authentication, profiles, listings, role requests and property media.
 * Uses the existing window.NS_CONFIG object:
 *   { supabaseUrl: 'https://....supabase.co', supabaseAnonKey: 'sb_publishable_...' }
 * Never put a Supabase service_role/secret key in browser code.
 */

(function () {
  if (window.NS_CLOUD_INITIALIZED) return;
  window.NS_CLOUD_INITIALIZED = true;

  const CONFIG = window.NS_CONFIG || {};
  const MEDIA_BUCKET = 'property-media';
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB per image
  const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB per video

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let initialized = false;
  let authListenerRegistered = false;

  function notify(message, type) {
    const kind = type || 'info';
    try {
      if (typeof window.showToast === 'function') return window.showToast(message, kind);
      if (typeof window.showNotification === 'function') return window.showNotification(message, kind);
      if (typeof window.notify === 'function') return window.notify(message, kind);
    } catch (e) { console.warn('[NS Cloud] notification handler failed:', e); }
    if (kind === 'error') console.error('[NYUMBA SALAMA]', message);
    else console.log('[NYUMBA SALAMA]', message);
  }

  function status(message, type) {
    try {
      const el = document.querySelector('#connectionStatus, [data-connection-status], .connection-status');
      if (el) {
        el.textContent = message;
        el.dataset.status = type || 'info';
      }
    } catch (_) {}
  }

  function requireClient() {
    if (!client) throw new Error('Supabase haijaunganishwa. Hakikisha config.js na Supabase JS vimepakiwa kabla ya cloud.js.');
    return client;
  }

  function normalizeRole(role) {
    const value = String(role || '').trim().toLowerCase();
    if (['admin', 'administrator', 'super_admin', 'superadmin'].includes(value)) return 'admin';
    if (['landlord', 'owner', 'property_owner', 'house_owner', 'property-owner'].includes(value)) return 'landlord';
    if (['agent', 'broker', 'dalali'].includes(value)) return 'agent';
    return value || 'user';
  }

  function detectSignupRole(input) {
    const raw = input && (input.role || input.accountType || input.account_type);
    return normalizeRole(raw || 'user');
  }

  function getPublicMediaUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(String(path))) return String(path);
    const sb = requireClient();
    const result = sb.storage.from(MEDIA_BUCKET).getPublicUrl(String(path));
    return result && result.data ? result.data.publicUrl : '';
  }

  function safeFileName(name) {
    const base = String(name || 'media').split(/[\\/]/).pop();
    return base.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-100) || 'media';
  }

  function makeObjectPath(file) {
    const ownerId = currentUser && currentUser.id;
    if (!ownerId) throw new Error('Ingia kwenye akaunti kabla ya kupakia picha au video.');
    const unique = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
    return ownerId + '/' + unique + '-' + safeFileName(file.name);
  }

  function toFileArray(files) {
    if (!files) return [];
    if (Array.isArray(files)) return files.filter(Boolean);
    if (typeof files.length === 'number') return Array.from(files).filter(Boolean);
    return [files];
  }

  async function uploadPropertyMedia(files, kind) {
    const sb = requireClient();
    if (!currentUser) throw new Error('Tafadhali ingia kwanza kabla ya kupakia media.');
    const list = toFileArray(files);
    if (!list.length) return [];

    const mediaKind = String(kind || '').toLowerCase();
    if (!['image', 'images', 'video', 'videos'].includes(mediaKind)) {
      throw new Error('Aina ya media haijatambulika. Tumia image au video.');
    }
    const isVideo = mediaKind === 'video' || mediaKind === 'videos';
    const allowedTypes = isVideo ? VIDEO_TYPES : IMAGE_TYPES;
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    const uploaded = [];

    for (const file of list) {
      if (!file || !file.name) throw new Error('Faili moja halijatambulika. Chagua picha au video tena.');
      if (!allowedTypes.includes(file.type)) {
        throw new Error('Faili "' + file.name + '" lina format isiyoruhusiwa. ' +
          (isVideo ? 'Tumia MP4, WebM au MOV.' : 'Tumia JPG, PNG, WebP au AVIF.'));
      }
      if (file.size > maxSize) {
        throw new Error('Faili "' + file.name + '" limezidi ukubwa unaoruhusiwa (' + (isVideo ? '50 MB' : '10 MB') + ').');
      }
      const path = makeObjectPath(file);
      const { data, error } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      });
      if (error) {
        // Best-effort cleanup of files already uploaded during this batch.
        if (uploaded.length) {
          try { await sb.storage.from(MEDIA_BUCKET).remove(uploaded.map(item => item.path)); } catch (_) {}
        }
        throw new Error('Imeshindikana kupakia "' + file.name + '": ' + error.message);
      }
      const storedPath = data && data.path ? data.path : path;
      uploaded.push({ path: storedPath, url: getPublicMediaUrl(storedPath), name: file.name, type: file.type });
    }
    return uploaded;
  }

  async function uploadImages(files) {
    return uploadPropertyMedia(files, 'images');
  }

  async function uploadVideos(files) {
    return uploadPropertyMedia(files, 'videos');
  }

  function normalizeProperty(row) {
    const item = Object.assign({}, row || {});
    const images = Array.isArray(item.image_urls) ? item.image_urls : [];
    const videos = Array.isArray(item.video_urls) ? item.video_urls : [];
    item.imageUrls = images.map(getPublicMediaUrl).filter(Boolean);
    item.videoUrls = videos.map(getPublicMediaUrl).filter(Boolean);
    item.image = item.imageUrls[0] || item.image_url || item.image || '';
    item.price = item.monthly_rent != null ? item.monthly_rent : (item.price != null ? item.price : 0);
    item.type = item.property_type || item.type || 'house';
    return item;
  }

  async function updateUI(user, profile) {
    currentUser = user || null;
    currentProfile = profile || null;
    window.NS_CURRENT_USER = currentUser;
    window.NS_CURRENT_PROFILE = currentProfile;
    window.NS_CURRENT_ROLE = currentProfile ? normalizeRole(currentProfile.role) : 'user';

    document.documentElement.classList.toggle('ns-authenticated', !!currentUser);
    document.documentElement.classList.toggle('ns-guest', !currentUser);

    try {
      document.querySelectorAll('[data-auth-only]').forEach(el => { el.hidden = !currentUser; });
      document.querySelectorAll('[data-guest-only]').forEach(el => { el.hidden = !!currentUser; });
      document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !(currentProfile && normalizeRole(currentProfile.role) === 'admin'); });
      document.querySelectorAll('[data-user-name]').forEach(el => {
        el.textContent = (currentProfile && (currentProfile.full_name || currentProfile.name)) || (currentUser && currentUser.email) || '';
      });
    } catch (e) { console.warn('[NS Cloud] UI update warning:', e); }

    try {
      if (typeof window.NS_onAuthChanged === 'function') window.NS_onAuthChanged(currentUser, currentProfile);
    } catch (e) { console.warn('[NS Cloud] NS_onAuthChanged failed:', e); }
  }

  async function loadProfile(user) {
    const sb = requireClient();
    const target = user || currentUser;
    if (!target) {
      currentProfile = null;
      await updateUI(null, null);
      return null;
    }

    // Profile table/column names follow the common public.profiles setup.
    const { data, error } = await sb.from('profiles').select('*').eq('id', target.id).maybeSingle();
    if (error) {
      console.warn('[NS Cloud] Could not load profile:', error.message);
      currentProfile = { id: target.id, email: target.email, role: 'user' };
    } else if (data) {
      currentProfile = Object.assign({ id: target.id, email: target.email, role: 'user' }, data);
    } else {
      currentProfile = { id: target.id, email: target.email, role: 'user' };
    }
    await updateUI(target, currentProfile);
    return currentProfile;
  }

  async function refreshSession() {
    const sb = requireClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const session = data && data.session;
    if (session && session.user) {
      currentUser = session.user;
      await loadProfile(currentUser);
    } else {
      currentUser = null;
      currentProfile = null;
      await updateUI(null, null);
    }
    return session || null;
  }

  async function signUp(input) {
    const sb = requireClient();
    const values = input || {};
    const email = String(values.email || '').trim();
    const password = String(values.password || '');
    if (!email || !password) throw new Error('Weka email na password.');

    const role = detectSignupRole(values);
    const fullName = values.full_name || values.fullName || values.name || '';
    const options = {
      data: { full_name: fullName, name: fullName, requested_role: role },
      emailRedirectTo: window.location.origin
    };
    const { data, error } = await sb.auth.signUp({ email, password, options });
    if (error) throw error;

    if (data && data.user && data.session) {
      currentUser = data.user;
      await loadProfile(currentUser);
    }
    notify('Usajili umetumwa. Angalia email yako ikiwa uthibitisho unahitajika.', 'success');
    return data;
  }

  async function signIn(input, maybePassword) {
    const sb = requireClient();
    const values = typeof input === 'string' ? { email: input, password: maybePassword } : (input || {});
    const email = String(values.email || '').trim();
    const password = String(values.password || '');
    if (!email || !password) throw new Error('Weka email na password.');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await loadProfile(currentUser);
    notify('Umeingia kikamilifu.', 'success');
    return data;
  }

  async function signInWithGoogle() {
    const sb = requireClient();
    const redirectTo = window.location.origin + window.location.pathname;
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) throw error;
    return data;
  }

  async function resetPassword(email) {
    const sb = requireClient();
    const value = String(email || '').trim();
    if (!value) throw new Error('Weka email yako kwanza.');
    const { data, error } = await sb.auth.resetPasswordForEmail(value, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw error;
    notify('Tumetuma maelekezo ya kubadilisha password kwenye email yako.', 'success');
    return data;
  }

  async function signOut() {
    const sb = requireClient();
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    currentUser = null;
    currentProfile = null;
    await updateUI(null, null);
    notify('Umetoka kwenye akaunti.', 'success');
  }

  async function loadRoleRequests() {
    const sb = requireClient();
    const { data, error } = await sb.from('role_requests').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function requestRole(role, details) {
    const sb = requireClient();
    if (!currentUser) throw new Error('Ingia kwanza ili kuomba role.');
    const requestedRole = normalizeRole(role);
    const payload = Object.assign({}, details || {}, {
      user_id: currentUser.id,
      requested_role: requestedRole,
      status: 'pending'
    });
    const { data, error } = await sb.from('role_requests').insert(payload).select().single();
    if (error) throw error;
    notify('Ombi lako limetumwa kwa ajili ya mapitio.', 'success');
    return data;
  }

  async function loadListings(options) {
    const sb = requireClient();
    const opts = options || {};
    let query = sb.from('properties').select('*').eq('is_published', true).order('created_at', { ascending: false });
    if (opts.limit) query = query.limit(Number(opts.limit));
    const { data, error } = await query;
    if (error) throw error;
    const properties = (data || []).map(normalizeProperty);
    window.NS_PROPERTIES = properties;
    window.properties = properties;
    if (typeof window.renderListings === 'function') window.renderListings(properties);
    return properties;
  }

  async function loadMyProperties() {
    const sb = requireClient();
    if (!currentUser) return [];
    const { data, error } = await sb.from('properties').select('*').eq('owner_id', currentUser.id).order('created_at', { ascending: false });
    if (error) throw error;
    const properties = (data || []).map(normalizeProperty);
    window.NS_MY_PROPERTIES = properties;

    const container = document.querySelector('#myProperties, [data-my-properties], .my-properties-list');
    if (container && !container.dataset.nsManagedByApp) {
      container.innerHTML = properties.length ? properties.map(p => {
        const title = escapeHtml(p.title || 'Nyumba bila jina');
        const location = escapeHtml(p.location || '');
        const rent = escapeHtml(String(p.monthly_rent != null ? p.monthly_rent : (p.price || '')));
        const description = escapeHtml(p.description || '');
        const id = escapeHtml(String(p.id || ''));
        const thumb = p.image ? '<img src="' + escapeAttr(p.image) + '" alt="Picha ya nyumba" loading="lazy" style="width:100%;max-height:180px;object-fit:cover;border-radius:10px">' : '';
        const mediaCount = (p.imageUrls || []).length + (p.videoUrls || []).length;
        return '<article class="ns-my-property" style="border:1px solid #ddd;border-radius:12px;padding:12px;margin:10px 0">' + thumb +
          '<h3>' + title + '</h3><p>' + location + '</p><p>Kodi: ' + rent + '</p><p>' + description + '</p>' +
          '<small>Media: ' + mediaCount + '</small> <button type="button" data-ns-delete-property="' + id + '">Futa</button></article>';
      }).join('') : '<p>Huna matangazo bado.</p>';
    }
    return properties;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function escapeAttr(value) { return escapeHtml(value); }

  async function addProperty(property) {
    const sb = requireClient();
    if (!currentUser) throw new Error('Ingia kwenye akaunti kabla ya kutangaza nyumba.');
    const input = Object.assign({}, property || {});
    const title = String(input.title || '').trim();
    const location = String(input.location || '').trim();
    const monthlyRent = input.monthlyRent != null ? input.monthlyRent : (input.monthly_rent != null ? input.monthly_rent : input.price);
    if (!title || !location || monthlyRent == null || monthlyRent === '') {
      throw new Error('Jaza jina la nyumba, eneo na kodi ya mwezi.');
    }

    // Supports both FileList and arrays passed by the app's listing form.
    const imageFiles = input.imageFiles || input.images || input.photos || [];
    const videoFiles = input.videoFiles || input.videos || [];
    let uploadedImages = [];
    let uploadedVideos = [];
    try {
      uploadedImages = await uploadImages(imageFiles);
      uploadedVideos = await uploadVideos(videoFiles);

      const imageUrls = uploadedImages.map(item => item.url).filter(Boolean);
      const videoUrls = uploadedVideos.map(item => item.url).filter(Boolean);
      const row = {
        owner_id: currentUser.id,
        title: title,
        location: location,
        property_type: input.propertyType || input.property_type || input.type || 'house',
        monthly_rent: Number(monthlyRent),
        description: String(input.description || '').trim(),
        is_published: input.is_published !== false,
        image_urls: imageUrls,
        video_urls: videoUrls
      };
      const { data, error } = await sb.from('properties').insert(row).select().single();
      if (error) throw error;
      await Promise.allSettled([loadListings(), loadMyProperties()]);
      notify('Tangazo la nyumba limehifadhiwa kikamilifu.', 'success');
      return normalizeProperty(data);
    } catch (error) {
      // If the database insert fails, remove uploaded objects to avoid orphaned files.
      const paths = uploadedImages.concat(uploadedVideos).map(item => item.path).filter(Boolean);
      if (paths.length) {
        try { await sb.storage.from(MEDIA_BUCKET).remove(paths); } catch (_) {}
      }
      throw error;
    }
  }

  async function deleteProperty(propertyId) {
    const sb = requireClient();
    if (!currentUser) throw new Error('Ingia kwanza.');
    const id = String(propertyId || '').trim();
    if (!id) throw new Error('ID ya tangazo haipo.');
    const { data: property, error: readError } = await sb.from('properties').select('id, owner_id, image_urls, video_urls').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!property) throw new Error('Tangazo halijapatikana.');
    if (property.owner_id !== currentUser.id && !(currentProfile && normalizeRole(currentProfile.role) === 'admin')) {
      throw new Error('Huna ruhusa ya kufuta tangazo hili.');
    }
    const { error } = await sb.from('properties').delete().eq('id', id);
    if (error) throw error;
    const paths = [];
    (property.image_urls || []).concat(property.video_urls || []).forEach(url => {
      const marker = '/object/public/' + MEDIA_BUCKET + '/';
      const index = String(url).indexOf(marker);
      if (index >= 0) paths.push(decodeURIComponent(String(url).slice(index + marker.length)));
    });
    if (paths.length) {
      try { await sb.storage.from(MEDIA_BUCKET).remove(paths); } catch (e) { console.warn('[NS Cloud] Media cleanup warning:', e.message); }
    }
    await Promise.allSettled([loadListings(), loadMyProperties()]);
    return true;
  }

  async function testConnection() {
    try {
      const sb = requireClient();
      const { error } = await sb.from('properties').select('id').limit(1);
      if (error) throw error;
      status('Connected to Supabase', 'success');
      return { ok: true, message: 'Supabase connection successful.' };
    } catch (error) {
      status('Connection error', 'error');
      return { ok: false, message: error.message || String(error) };
    }
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    const supabaseLib = window.supabase;
    if (!supabaseLib || typeof supabaseLib.createClient !== 'function') {
      status('Supabase library missing', 'error');
      console.error('[NS Cloud] Supabase JS library is missing. Load @supabase/supabase-js before cloud.js.');
      return;
    }
    const url = CONFIG.supabaseUrl || CONFIG.url || CONFIG.SUPABASE_URL;
    const key = CONFIG.supabaseAnonKey || CONFIG.anonKey || CONFIG.publishableKey || CONFIG.SUPABASE_ANON_KEY;
    if (!url || !key) {
      status('Supabase config missing', 'error');
      console.error('[NS Cloud] Missing supabaseUrl or supabaseAnonKey in window.NS_CONFIG.');
      return;
    }
    try {
      client = supabaseLib.createClient(url, key);
      window.NS_SUPABASE = client;
      window.NS_CLOUD = {
        get client() { return client; },
        get currentUser() { return currentUser; },
        get currentProfile() { return currentProfile; },
        get currentRole() { return currentProfile ? normalizeRole(currentProfile.role) : 'user'; },
        signUp,
        signIn,
        signInWithGoogle,
        resetPassword,
        signOut,
        refreshSession,
        loadProfile,
        loadRoleRequests,
        requestRole,
        loadListings,
        loadMyProperties,
        addProperty,
        deleteProperty,
        uploadPropertyMedia,
        uploadImages,
        uploadVideos,
        getPublicMediaUrl,
        testConnection,
        normalizeProperty
      };

      if (!authListenerRegistered) {
        authListenerRegistered = true;
        client.auth.onAuthStateChange((event, session) => {
          // Avoid doing heavy Supabase requests inside the auth callback itself.
          Promise.resolve().then(async () => {
            if (session && session.user) {
              currentUser = session.user;
              await loadProfile(currentUser);
            } else {
              currentUser = null;
              currentProfile = null;
              await updateUI(null, null);
            }
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
              try { await loadListings(); } catch (e) { console.warn('[NS Cloud] listings load:', e.message); }
              if (currentUser) {
                try { await loadMyProperties(); } catch (e) { console.warn('[NS Cloud] my listings load:', e.message); }
              }
            }
          }).catch(e => console.error('[NS Cloud] Auth state handler:', e));
        });
      }

      refreshSession().then(async () => {
        status('Connected to Supabase', 'success');
        try { await loadListings(); } catch (e) { console.warn('[NS Cloud] Initial listings load:', e.message); }
        if (currentUser) {
          try { await loadMyProperties(); } catch (e) { console.warn('[NS Cloud] Initial my listings load:', e.message); }
        }
      }).catch(e => {
        console.warn('[NS Cloud] Session refresh:', e.message);
        status('Supabase ready', 'success');
      });
    } catch (error) {
      status('Supabase initialization failed', 'error');
      console.error('[NS Cloud] Initialization failed:', error);
    }
  }

  // Keep the global available early so other scripts can check for it.
  window.NS_CLOUD = window.NS_CLOUD || {};
  initialize();
})();
