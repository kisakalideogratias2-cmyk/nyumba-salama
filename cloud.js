'use strict';
/* NYUMBA SALAMA cloud.js — Supabase auth, listings, media and rental applications. */
(function () {
  if (window.NS_CLOUD_INITIALIZED && window.NS_CLOUD && typeof window.NS_CLOUD.createRentalRequest === 'function' && typeof window.NS_CLOUD.loadNotifications === 'function') return;
  window.NS_CLOUD_INITIALIZED = true;
  const CONFIG = window.NS_CONFIG || {};
  const MEDIA_BUCKET = 'property-media';
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
  const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
  let client = null, currentUser = null, currentProfile = null, initialized = false, authListenerRegistered = false;

  function notify(message, type) {
    try { if (typeof window.showToast === 'function') return window.showToast(message, type); } catch (_) {}
    if (type === 'error') console.error('[NYUMBA SALAMA]', message); else console.log('[NYUMBA SALAMA]', message);
  }
  function status(message, type) {
    const el = document.querySelector('#connectionStatus, [data-connection-status], .connection-status');
    if (el) { el.textContent = message; el.dataset.status = type || 'info'; }
  }
  function requireClient() { if (!client) throw new Error('Supabase haijaunganishwa. Angalia config.js na Supabase JS.'); return client; }
  function normalizeRole(role) {
    const value = String(role || '').trim().toLowerCase();
    if (['admin','administrator','super_admin','superadmin'].includes(value)) return 'admin';
    if (['landlord','owner','property_owner','house_owner','property-owner'].includes(value)) return 'landlord';
    if (['agent','broker','dalali'].includes(value)) return 'agent';
    return value || 'user';
  }
  function safeFileName(name) { return String(name || 'media').split(/[\\/]/).pop().normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-100) || 'media'; }
  function makeObjectPath(file) {
    if (!currentUser) throw new Error('Ingia kwenye akaunti kabla ya kupakia media.');
    const unique = window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
    return currentUser.id+'/'+unique+'-'+safeFileName(file.name);
  }
  function toFileArray(files) { if (!files) return []; if (Array.isArray(files)) return files.filter(Boolean); if (typeof files.length === 'number') return Array.from(files).filter(Boolean); return [files]; }
  function getPublicMediaUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(String(path))) return String(path);
    const result = requireClient().storage.from(MEDIA_BUCKET).getPublicUrl(String(path));
    return result && result.data ? result.data.publicUrl : '';
  }
  async function uploadPropertyMedia(files, kind) {
    const sb = requireClient(); if (!currentUser) throw new Error('Tafadhali ingia kwanza kabla ya kupakia media.');
    const list = toFileArray(files); if (!list.length) return [];
    const isVideo = ['video','videos'].includes(String(kind || '').toLowerCase());
    if (!isVideo && !['image','images'].includes(String(kind || '').toLowerCase())) throw new Error('Aina ya media haijatambulika.');
    const types = isVideo ? VIDEO_TYPES : IMAGE_TYPES, max = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE, uploaded = [];
    for (const file of list) {
      if (!file || !file.name) throw new Error('Faili halijatambulika. Chagua tena.');
      if (!types.includes(file.type)) throw new Error('Format ya '+file.name+' hairuhusiwi.');
      if (file.size > max) throw new Error(file.name+' limezidi ukubwa unaoruhusiwa.');
      const path = makeObjectPath(file);
      const {data,error} = await sb.storage.from(MEDIA_BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
      if (error) {
        if (uploaded.length) { try { await sb.storage.from(MEDIA_BUCKET).remove(uploaded.map(x=>x.path)); } catch (_) {} }
        throw new Error('Imeshindikana kupakia '+file.name+': '+error.message);
      }
      const stored = data && data.path ? data.path : path;
      uploaded.push({path:stored,url:getPublicMediaUrl(stored),name:file.name,type:file.type});
    }
    return uploaded;
  }
  const uploadImages = files => uploadPropertyMedia(files,'images');
  const uploadVideos = files => uploadPropertyMedia(files,'videos');
  function normalizeProperty(row) {
    const item = Object.assign({},row || {}), images = Array.isArray(item.image_urls)?item.image_urls:[], videos = Array.isArray(item.video_urls)?item.video_urls:[];
    item.imageUrls = images.map(getPublicMediaUrl).filter(Boolean); item.videoUrls = videos.map(getPublicMediaUrl).filter(Boolean);
    item.image = item.imageUrls[0] || item.image_url || item.image || '';
    item.price = item.monthly_rent != null ? item.monthly_rent : (item.price != null ? item.price : 0);
    item.type = item.property_type || item.type || 'house'; return item;
  }
  async function updateUI(user, profile) {
    currentUser=user||null; currentProfile=profile||null;
    window.NS_CURRENT_USER=currentUser; window.NS_CURRENT_PROFILE=currentProfile; window.NS_CURRENT_ROLE=currentProfile?normalizeRole(currentProfile.role):'user';
    document.documentElement.classList.toggle('ns-authenticated',!!currentUser); document.documentElement.classList.toggle('ns-guest',!currentUser);
    document.querySelectorAll('[data-auth-only]').forEach(el=>{el.hidden=!currentUser;});
    document.querySelectorAll('[data-guest-only]').forEach(el=>{el.hidden=!!currentUser;});
    document.querySelectorAll('[data-admin-only]').forEach(el=>{el.hidden=!(currentProfile&&normalizeRole(currentProfile.role)==='admin');});
    document.querySelectorAll('[data-user-name]').forEach(el=>{el.textContent=(currentProfile&&(currentProfile.full_name||currentProfile.name))||(currentUser&&currentUser.email)||'';});
    try { if (typeof window.NS_onAuthChanged==='function') window.NS_onAuthChanged(currentUser,currentProfile); } catch(e) { console.warn('[NS Cloud] auth UI:',e); }
  }
  async function loadProfile(user) {
    const sb=requireClient(), target=user||currentUser;
    if (!target) { currentProfile=null; await updateUI(null,null); return null; }
    const {data,error}=await sb.from('profiles').select('*').eq('id',target.id).maybeSingle();
    if (error) { console.warn('[NS Cloud] profile:',error.message); currentProfile={id:target.id,email:target.email,role:'user'}; }
    else currentProfile=Object.assign({id:target.id,email:target.email,role:'user'},data||{});
    await updateUI(target,currentProfile); return currentProfile;
  }
  async function refreshSession() {
    const {data,error}=await requireClient().auth.getSession(); if(error) throw error;
    const session=data&&data.session;
    if(session&&session.user){currentUser=session.user;await loadProfile(currentUser);} else {currentUser=null;currentProfile=null;await updateUI(null,null);}
    return session||null;
  }
  async function signUp(input) {
    const values=input||{},email=String(values.email||'').trim(),password=String(values.password||'');
    if(!email||!password) throw new Error('Weka email na password.');
    const fullName=values.full_name||values.fullName||values.name||'';
    const {data,error}=await requireClient().auth.signUp({email,password,options:{data:{full_name:fullName,name:fullName,requested_role:'user'},emailRedirectTo:window.location.origin}});
    if(error) throw error; if(data&&data.user&&data.session){currentUser=data.user;await loadProfile(currentUser);} notify('Usajili umetumwa. Angalia email yako kwa uthibitisho.','success'); return data;
  }
  async function signIn(input,maybePassword) {
    const v=typeof input==='string'?{email:input,password:maybePassword}:(input||{}),email=String(v.email||'').trim(),password=String(v.password||'');
    if(!email||!password) throw new Error('Weka email na password.');
    const {data,error}=await requireClient().auth.signInWithPassword({email,password}); if(error) throw error;
    currentUser=data.user; await loadProfile(currentUser); notify('Umeingia kikamilifu.','success'); return data;
  }
  async function signInWithGoogle(){const {data,error}=await requireClient().auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+window.location.pathname}});if(error)throw error;return data;}
  async function resetPassword(email){const v=String(email||'').trim();if(!v)throw new Error('Weka email yako kwanza.');const {data,error}=await requireClient().auth.resetPasswordForEmail(v,{redirectTo:window.location.origin+window.location.pathname});if(error)throw error;return data;}
  async function signOut(){const {error}=await requireClient().auth.signOut();if(error)throw error;currentUser=null;currentProfile=null;await updateUI(null,null);notify('Umetoka kwenye akaunti.','success');}
  async function loadRoleRequests(){const {data,error}=await requireClient().from('role_requests').select('*').order('created_at',{ascending:false});if(error)throw error;return data||[];}
  async function requestRole(role,details){if(!currentUser)throw new Error('Ingia kwanza ili kuomba role.');const value=normalizeRole(role),payload=Object.assign({},details||{},{user_id:currentUser.id,requested_role:value,status:'pending'});const {data,error}=await requireClient().from('role_requests').insert(payload).select().single();if(error)throw error;notify('Ombi lako limetumwa kwa ajili ya mapitio.','success');return data;}
  async function loadListings(options){let q=requireClient().from('properties').select('*').eq('is_published',true).order('created_at',{ascending:false});if(options&&options.limit)q=q.limit(Number(options.limit));const {data,error}=await q;if(error)throw error;const rows=(data||[]).map(normalizeProperty);window.NS_PROPERTIES=rows;window.properties=rows;if(typeof window.renderListings==='function')window.renderListings(rows);return rows;}
  async function loadMyProperties(){if(!currentUser)return[];const {data,error}=await requireClient().from('properties').select('*').eq('owner_id',currentUser.id).order('created_at',{ascending:false});if(error)throw error;const rows=(data||[]).map(normalizeProperty);window.NS_MY_PROPERTIES=rows;return rows;}
  async function addProperty(property){const sb=requireClient();if(!currentUser)throw new Error('Ingia kwenye akaunti kabla ya kutangaza nyumba.');const x=Object.assign({},property||{}),title=String(x.title||'').trim(),location=String(x.location||'').trim(),rent=x.monthlyRent!=null?x.monthlyRent:(x.monthly_rent!=null?x.monthly_rent:x.price);if(!title||!location||rent==null||rent==='')throw new Error('Jaza jina la nyumba, eneo na kodi ya mwezi.');let images=[],videos=[];try{images=await uploadImages(x.imageFiles||x.images||x.photos||[]);videos=await uploadVideos(x.videoFiles||x.videos||[]);const row={owner_id:currentUser.id,title,location,property_type:x.propertyType||x.property_type||x.type||'house',monthly_rent:Number(rent),description:String(x.description||'').trim(),is_published:x.is_published!==false,image_urls:images.map(i=>i.url).filter(Boolean),video_urls:videos.map(i=>i.url).filter(Boolean)};const {data,error}=await sb.from('properties').insert(row).select().single();if(error)throw error;await Promise.allSettled([loadListings(),loadMyProperties()]);notify('Tangazo la nyumba limehifadhiwa kikamilifu.','success');return normalizeProperty(data);}catch(e){const paths=images.concat(videos).map(i=>i.path).filter(Boolean);if(paths.length){try{await sb.storage.from(MEDIA_BUCKET).remove(paths);}catch(_){}}throw e;}}
  async function deleteProperty(id){const sb=requireClient();if(!currentUser)throw new Error('Ingia kwanza.');const {data:p,error:readError}=await sb.from('properties').select('id,owner_id,image_urls,video_urls').eq('id',String(id)).maybeSingle();if(readError)throw readError;if(!p)throw new Error('Tangazo halijapatikana.');if(p.owner_id!==currentUser.id&&!(currentProfile&&normalizeRole(currentProfile.role)==='admin'))throw new Error('Huna ruhusa ya kufuta tangazo hili.');const {error}=await sb.from('properties').delete().eq('id',String(id));if(error)throw error;const paths=[];(p.image_urls||[]).concat(p.video_urls||[]).forEach(url=>{const marker='/object/public/'+MEDIA_BUCKET+'/';const i=String(url).indexOf(marker);if(i>=0)paths.push(decodeURIComponent(String(url).slice(i+marker.length)));});if(paths.length){try{await sb.storage.from(MEDIA_BUCKET).remove(paths);}catch(e){console.warn('[NS Cloud] media cleanup:',e.message);}}await Promise.allSettled([loadListings(),loadMyProperties()]);return true;}

  // Owner sees only requests permitted by rental_select_owner RLS. No client-side owner_id trust.
  async function loadOwnerRentalRequests(){
    if(!currentUser) throw new Error('Ingia kwanza ili kuona maombi.');
    const {data,error}=await requireClient().from('rental_requests').select('*').order('created_at',{ascending:false});
    if(error) throw error;
    const ownProperties=await loadMyProperties();
    const byId=new Map(ownProperties.map(p=>[String(p.id),p]));
    return (data||[]).filter(r=>byId.has(String(r.property_id))).map(r=>Object.assign({},r,{property:byId.get(String(r.property_id))}));
  }
  async function loadMyRentalRequests(){
    if(!currentUser) throw new Error('Ingia kwanza ili kuona maombi yako.');
    const sb=requireClient();
    const {data,error}=await sb.from('rental_requests').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
    if(error) throw error;
    const rows=data||[];
    if(!rows.length) return [];
    const ids=[...new Set(rows.map(r=>String(r.property_id)).filter(Boolean))];
    const {data:properties,error:propertyError}=await sb.from('properties').select('*').in('id',ids);
    if(propertyError) console.warn('[NS Cloud] property details for tenant requests:',propertyError.message);
    const byId=new Map((properties||[]).map(p=>[String(p.id),normalizeProperty(p)]));
    return rows.map(r=>Object.assign({},r,{property:byId.get(String(r.property_id))||null}));
  }
  async function updateRentalRequestStatus(requestId,newStatus){
    if(!currentUser) throw new Error('Ingia kwanza.');
    if(!['approved','rejected'].includes(newStatus)) throw new Error('Status haijaruhusiwa.');
    // Keep this update compatible with schemas that only have a status column.
    const {data,error}=await requireClient().from('rental_requests').update({status:newStatus}).eq('id',requestId).select().maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('Ombi halijapatikana au huna ruhusa ya kulibadilisha.');
    return data;
  }
  // Notifications: additive functions; keep existing auth, listing, media and rental APIs.
  async function loadNotifications(limit) {
    const sb = requireClient();
    if (!currentUser) throw new Error('Ingia kwanza kuona notifications.');
    const parsed = Number.parseInt(limit, 10);
    const safeLimit = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 30, 100));
    const { data, error } = await sb.from('notifications').select('*')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(safeLimit);
    if (error) throw new Error('Imeshindikana kupakia notifications: ' + error.message);
    return data || [];
  }
  async function getUnreadNotificationCount() {
    const sb = requireClient();
    if (!currentUser) return 0;
    const { count, error } = await sb.from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id).eq('is_read', false);
    if (error) throw new Error('Imeshindikana kuhesabu notifications: ' + error.message);
    return count || 0;
  }
  async function markNotificationAsRead(notificationId) {
    const sb = requireClient();
    if (!currentUser) throw new Error('Ingia kwanza.');
    const id = String(notificationId || '').trim();
    if (!id) throw new Error('Notification ID haipo.');
    const { data, error } = await sb.from('notifications').update({ is_read: true })
      .eq('id', id).eq('user_id', currentUser.id).select('id').maybeSingle();
    if (error) throw new Error('Imeshindikana kuweka notification kuwa imesomwa: ' + error.message);
    if (!data) throw new Error('Notification haijapatikana au huna ruhusa ya kuibadilisha.');
    return data;
  }
  async function markAllNotificationsAsRead() {
    const sb = requireClient();
    if (!currentUser) throw new Error('Ingia kwanza.');
    const { error } = await sb.from('notifications').update({ is_read: true })
      .eq('user_id', currentUser.id).eq('is_read', false);
    if (error) throw new Error('Imeshindikana kusoma notifications zote: ' + error.message);
    return true;
  }
  async function testConnection(){try{const {error}=await requireClient().from('properties').select('id').limit(1);if(error)throw error;status('Connected to Supabase','success');return{ok:true,message:'Supabase connection successful.'};}catch(e){status('Connection error','error');return{ok:false,message:e.message||String(e)};}}
  function initialize(){if(initialized)return;initialized=true;const lib=window.supabase;if(!lib||typeof lib.createClient!=='function'){status('Supabase library missing','error');console.error('[NS Cloud] Supabase JS library missing.');return;}const url=CONFIG.supabaseUrl||CONFIG.url||CONFIG.SUPABASE_URL,key=CONFIG.supabaseAnonKey||CONFIG.anonKey||CONFIG.publishableKey||CONFIG.SUPABASE_ANON_KEY;if(!url||!key){status('Supabase config missing','error');console.error('[NS Cloud] Missing Supabase config.');return;}try{client=lib.createClient(url,key);window.NS_SUPABASE=client;window.NS_CLOUD={get client(){return client;},get ready(){return!!client;},getClient:()=>client,getUser:()=>currentUser,getProfile:()=>currentProfile,getProperties:()=>window.NS_PROPERTIES||[],get currentUser(){return currentUser;},get currentProfile(){return currentProfile;},get currentRole(){return currentProfile?normalizeRole(currentProfile.role):'user';},signUp,signIn,signInWithGoogle,resetPassword,signOut,refreshSession,loadProfile,loadRoleRequests,requestRole,async createRentalRequest(input){if(!currentUser)throw new Error('Ingia kwanza.');const v=input||{};const payload={property_id:v.property_id,user_id:currentUser.id,applicant_name:String(v.applicant_name||'').trim(),phone:String(v.phone||'').trim(),message:String(v.message||'').trim(),status:'pending'};if(!payload.property_id||!payload.applicant_name||!payload.phone)throw new Error('Jaza jina, simu na uchague nyumba.');const {data,error}=await client.from('rental_requests').insert(payload).select().single();if(error)throw error;return data;},loadOwnerRentalRequests,loadMyRentalRequests,updateRentalRequestStatus,async reviewRoleRequest(id,reviewStatus,userId,role){if(!currentProfile||normalizeRole(currentProfile.role)!=='admin')throw new Error('Admin pekee.');const {error}=await client.from('role_requests').update({status:reviewStatus}).eq('id',id);if(error)throw error;if(reviewStatus==='approved'&&userId&&role){const result=await client.from('profiles').update({role}).eq('id',userId);if(result.error)throw result.error;}},loadListings,loadMyProperties,addProperty,deleteProperty,uploadPropertyMedia,uploadImages,uploadVideos,getPublicMediaUrl,testConnection,normalizeProperty,loadNotifications,getUnreadNotificationCount,markNotificationAsRead,markAllNotificationsAsRead};
      if(!authListenerRegistered){authListenerRegistered=true;client.auth.onAuthStateChange((event,session)=>{Promise.resolve().then(async()=>{if(session&&session.user){currentUser=session.user;await loadProfile(currentUser);}else{currentUser=null;currentProfile=null;await updateUI(null,null);}if(['SIGNED_IN','TOKEN_REFRESHED','INITIAL_SESSION'].includes(event)){try{await loadListings();}catch(e){console.warn('[NS Cloud] listings:',e.message);}if(currentUser){try{await loadMyProperties();}catch(e){console.warn('[NS Cloud] properties:',e.message);}}}}).catch(e=>console.error('[NS Cloud] auth handler:',e));});}
      refreshSession().then(async()=>{status('Connected to Supabase','success');try{await loadListings();}catch(e){console.warn('[NS Cloud] initial listings:',e.message);}if(currentUser){try{await loadMyProperties();}catch(e){console.warn('[NS Cloud] initial properties:',e.message);}}}).catch(e=>{console.warn('[NS Cloud] session refresh:',e.message);status('Supabase ready','success');});
    }catch(e){status('Supabase initialization failed','error');console.error('[NS Cloud] init:',e);}}
  window.NS_CLOUD=window.NS_CLOUD||{};initialize();
})();
