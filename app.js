'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const api = () => window.NS_CLOUD;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

  const money = value =>
    'TSh ' + Number(value || 0).toLocaleString('en-US');

  let listings = [];
  let filter = 'all';
  let query = '';
  let budget = 0;
  let savedOnly = false;
  let currentProfile = null;

  let saved = new Set();

  try {
    saved = new Set(
      JSON.parse(localStorage.getItem('ns_saved_ids') || '[]')
        .map(String)
    );
  } catch (_) {
    saved = new Set();
  }

  // ================================
  // TOAST NOTIFICATIONS
  // ================================

  function toast(message) {
    const el = $('toast');

    if (!el) {
      alert(message);
      return;
    }

    el.textContent = message;
    el.classList.add('show');

    setTimeout(() => {
      el.classList.remove('show');
    }, 4000);
  }

  window.showToast = toast;

  function error(err) {
    console.error('[NYUMBA SALAMA]', err);
    toast(err?.message || String(err));
  }

  // ================================
  // NOTIFICATION CENTER
  // ================================

  let notificationItems = [];
  let notificationBusy = false;
  let notificationRefreshTimer = null;

  function initNotificationCenter() {
    if ($('nsNotificationButton')) return;

    const style = document.createElement('style');

    style.textContent = `
      #nsNotificationButton {
        position: fixed;
        right: 16px;
        bottom: 20px;
        z-index: 9998;
        border: 0;
        border-radius: 50px;
        padding: 13px 17px;
        background: #14532d;
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        box-shadow: 0 4px 16px #0003;
        cursor: pointer;
      }

      #nsNotificationButton:focus-visible,
      #nsNotificationPanel button:focus-visible {
        outline: 3px solid #86efac;
        outline-offset: 3px;
      }

      #nsNotificationBadge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 19px;
        height: 19px;
        padding: 0 4px;
        margin-left: 5px;
        border-radius: 20px;
        background: #dc2626;
        color: #fff;
        font-size: 11px;
      }

      #nsNotificationBadge[hidden] {
        display: none;
      }

      #nsNotificationPanel {
        position: fixed;
        right: 12px;
        bottom: 78px;
        z-index: 9999;
        width: min(390px, calc(100vw - 24px));
        max-height: 70vh;
        overflow-y: auto;
        padding: 15px;
        background: var(--card, #fff);
        color: var(--text, #172033);
        border: 1px solid #d1d5db;
        border-radius: 16px;
        box-shadow: 0 8px 30px #0003;
        box-sizing: border-box;
      }

      #nsNotificationPanel[hidden] {
        display: none;
      }

      #nsNotificationPanel button {
        font: inherit;
      }

      .ns-notification-item {
        padding: 12px;
        margin: 9px 0;
        border: 1px solid #d1d5db;
        border-radius: 12px;
        overflow-wrap: anywhere;
      }

      .ns-notification-item.unread {
        border-left: 4px solid #16a34a;
        background: #16a34a0d;
      }

      .ns-notification-item p {
        margin: 7px 0;
      }

      .ns-notification-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }

      .ns-notification-actions button {
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }

      .ns-notification-actions button:disabled {
        opacity: .6;
        cursor: wait;
      }

      .ns-notification-empty {
        padding: 16px 8px;
        text-align: center;
      }

      @media (max-width: 420px) {
        #nsNotificationButton {
          right: 12px;
          bottom: 14px;
        }

        #nsNotificationPanel {
          bottom: 70px;
          max-height: 68vh;
        }
      }
    `;

    document.head.appendChild(style);

    const button = document.createElement('button');

    button.id = 'nsNotificationButton';
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'nsNotificationPanel');

    button.innerHTML =
      '🔔 Notifications <span id="nsNotificationBadge" hidden>0</span>';

    const panel = document.createElement('section');

    panel.id = 'nsNotificationPanel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Notification Center');

    panel.innerHTML = `
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
      ">
        <h3 style="margin:0">🔔 Notifications</h3>

        <button
          id="nsNotificationClose"
          type="button"
          aria-label="Funga notifications"
        >
          ✕
        </button>
      </div>

      <div class="ns-notification-actions">
        <button id="nsNotificationRefresh" type="button">
          ↻ Refresh
        </button>

        <button id="nsNotificationReadAll" type="button">
          Soma zote
        </button>
      </div>

      <div
        id="nsNotificationList"
        style="margin-top:10px"
        aria-live="polite"
      >
        Pakia notifications...
      </div>
    `;

    document.body.append(button, panel);

    button.addEventListener('click', async () => {
      panel.hidden = !panel.hidden;

      button.setAttribute(
        'aria-expanded',
        String(!panel.hidden)
      );

      if (!panel.hidden) {
        await refreshNotificationCenter();
      }
    });

    $('nsNotificationClose').addEventListener('click', () => {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    });

    $('nsNotificationRefresh').addEventListener(
      'click',
      async () => {
        await refreshNotificationCenter(true);
      }
    );

    $('nsNotificationReadAll').addEventListener(
      'click',
      async event => {
        if (!session()) {
          toast('Ingia kwanza kuona notifications zako.');
          return;
        }

        const readButton = event.currentTarget;
        readButton.disabled = true;

        try {
          const cloud = api();

          if (!cloud?.markAllNotificationsAsRead) {
            throw new Error(
              'Huduma ya notifications haijaunganishwa kwenye cloud.js.'
            );
          }

          await cloud.markAllNotificationsAsRead();

          await refreshNotificationCenter(true);

          toast('Notifications zote zimewekwa kuwa zimesomwa.');

        } catch (err) {
          error(err);

        } finally {
          readButton.disabled = false;
        }
      }
    );

    $('nsNotificationList').addEventListener(
      'click',
      async event => {
        const readButton = event.target.closest(
          '[data-notification-read]'
        );

        if (!readButton) return;

        const notificationId =
          readButton.dataset.notificationRead;

        readButton.disabled = true;

        try {
          const cloud = api();

          if (!cloud?.markNotificationAsRead) {
            throw new Error(
              'Huduma ya kusoma notification haijaunganishwa.'
            );
          }

          await cloud.markNotificationAsRead(notificationId);

          await refreshNotificationCenter(true);

        } catch (err) {
          error(err);
          readButton.disabled = false;
        }
      }
    );

    refreshNotificationBadge();
  }

  async function refreshNotificationBadge() {
    const badge = $('nsNotificationBadge');

    if (!badge) return;

    if (!session() || !api()?.ready) {
      badge.textContent = '0';
      badge.hidden = true;
      return;
    }

    try {
      const cloud = api();

      if (!cloud?.getUnreadNotificationCount) {
        badge.hidden = true;
        return;
      }

      const count = await cloud.getUnreadNotificationCount();

      badge.textContent = count > 99
        ? '99+'
        : String(count);

      badge.hidden = count <= 0;

    } catch (err) {
      console.warn(
        '[NYUMBA SALAMA] Notification count:',
        err.message
      );
    }
  }

  async function refreshNotificationCenter(force = false) {
    const list = $('nsNotificationList');

    if (!list) return;

    if (notificationBusy) {
      if (force) {
        notificationRefreshTimer = true;
      }

      return;
    }

    if (!session()) {
      notificationItems = [];

      list.textContent =
        'Ingia kwenye akaunti kuona notifications zako.';

      await refreshNotificationBadge();
      return;
    }

    const cloud = api();

    if (!cloud?.ready || !cloud?.loadNotifications) {
      list.textContent =
        'Notification service haijaunganishwa. Hakikisha cloud.js ina functions za notifications.';

      return;
    }

    notificationBusy = true;
    list.textContent = 'Inapakia notifications...';

    try {
      notificationItems = await cloud.loadNotifications(30);

      if (!notificationItems.length) {
        list.innerHTML = `
          <div class="ns-notification-empty">
            <div style="font-size:32px">📭</div>
            <p>Huna notifications kwa sasa.</p>
          </div>
        `;
      } else {
        list.innerHTML = notificationItems.map(item => `
          <article class="ns-notification-item ${
            item.is_read ? '' : 'unread'
          }">

            <strong>${esc(item.title)}</strong>

            <p>${esc(item.message)}</p>

            <small>
              ${esc(
                item.created_at
                  ? new Date(item.created_at).toLocaleString()
                  : ''
              )}
            </small>

            ${
              item.is_read
                ? '<p><small>✓ Imesomwa</small></p>'
                : `
                  <div class="ns-notification-actions">
                    <button
                      type="button"
                      data-notification-read="${esc(item.id)}"
                    >
                      Weka kuwa imesomwa
                    </button>
                  </div>
                `
            }

          </article>
        `).join('');
      }

      await refreshNotificationBadge();

    } catch (err) {
      console.error(
        '[NYUMBA SALAMA] Notifications:',
        err
      );

      list.textContent =
        err.message || 'Imeshindikana kupakia notifications.';

    } finally {
      notificationBusy = false;

      if (notificationRefreshTimer === true) {
        notificationRefreshTimer = null;
        refreshNotificationCenter(true);
      }
    }
  }

  window.refreshNotificationCenter =
    refreshNotificationCenter;

  // ================================
  // MODAL SYSTEM
  // ================================

  function modal(title, html) {
    const titleEl = $('modalTitle');
    const bodyEl = $('modalBody');
    const modalEl = $('modal');

    if (!titleEl || !bodyEl || !modalEl) {
      toast('Sehemu ya modal haipatikani kwenye index.html.');
      return;
    }

    titleEl.textContent = title;
    bodyEl.innerHTML = html;

    if (typeof modalEl.showModal === 'function') {
      modalEl.showModal();
    } else {
      modalEl.setAttribute('open', '');
    }
  }

  function close() {
    const modalEl = $('modal');

    if (!modalEl) return;

    if (
      typeof modalEl.close === 'function' &&
      modalEl.open
    ) {
      modalEl.close();
    } else {
      modalEl.removeAttribute('open');
    }
  }

  function formField(
    label,
    name,
    type = 'text',
    required = true
  ) {
    return `
      <label>
        ${label}
        <input
          name="${name}"
          type="${type}"
          ${required ? 'required' : ''}
        >
      </label>
    `;
  }

  // ================================
  // AUTHENTICATION AND ROLE
  // ================================

  function session() {
    return api()?.getUser?.() ||
      api()?.currentUser ||
      null;
  }

  function getRole() {
    const profile =
      currentProfile ||
      api()?.getProfile?.() ||
      null;

    const role =
      profile?.role ||
      api()?.currentRole ||
      'user';

    return String(role).trim().toLowerCase();
  }

  function isAdmin() {
    return [
      'admin',
      'administrator',
      'super_admin',
      'superadmin'
    ].includes(getRole());
  }

  // ================================
  // PUBLIC PROPERTY LISTINGS
  // ================================

  function renderListings(items) {
    if (Array.isArray(items)) {
      listings = items;
    }

    const filtered = listings.filter(property => {
      const typeMatch =
        filter === 'all' ||
        property.type === filter;

      const budgetMatch =
        !budget ||
        Number(property.price) <= budget;

      const queryMatch =
        `${property.title || ''} ${property.location || ''}`
          .toLowerCase()
          .includes(query);

      const savedMatch =
        !savedOnly ||
        saved.has(String(property.id));

      return (
        typeMatch &&
        budgetMatch &&
        queryMatch &&
        savedMatch
      );
    });

    const grid = $('listingGrid');

    if (!grid) return;

    grid.innerHTML = filtered.map(property => {
      const images = property.imageUrls || [];
      const videos = property.videoUrls || [];

      let media = '<div class="listing-art">🏠</div>';

      if (images.length) {
        media = `
          <img
            src="${esc(images[0])}"
            alt="${esc(property.title)}"
            loading="lazy"
            style="width:100%;height:190px;object-fit:cover"
          >
        `;
      } else if (videos.length) {
        media = `
          <video
            src="${esc(videos[0])}"
            controls
            playsinline
            style="width:100%;height:190px;object-fit:cover"
          ></video>
        `;
      }

      return `
        <article class="listing-card">

          ${media}

          <div class="listing-body">

            <h3>${esc(property.title)}</h3>

            <p>📍 ${esc(property.location)}</p>

            <div class="price">
              ${money(property.price)}
              <small>/ mwezi</small>
            </div>

            <p>${esc(property.description || '')}</p>

            <div class="card-actions">

              <button
                class="outline"
                data-action="details"
                data-id="${esc(property.id)}"
              >
                Angalia picha/video
              </button>

              <button
                class="primary"
                data-action="apply"
                data-id="${esc(property.id)}"
              >
                Omba kupanga
              </button>

              <button
                class="outline"
                data-action="save"
                data-id="${esc(property.id)}"
              >
                ${saved.has(String(property.id)) ? '♥' : '♡'}
              </button>

            </div>

          </div>

        </article>
      `;
    }).join('');

    const empty = $('emptyListings');

    if (empty) {
      empty.hidden = filtered.length > 0;
    }

    const savedCount = $('savedCount');

    if (savedCount) {
      savedCount.textContent = saved.size;
    }
  }

  window.renderListings = renderListings;

  async function refresh() {
    try {
      if (!api()?.loadListings) {
        throw new Error(
          'cloud.js haijakamilisha kuunganisha huduma za nyumba.'
        );
      }

      const rows = await api().loadListings();

      renderListings(rows);

    } catch (err) {
      error(err);
    }
  }

  // ================================
  // LOGIN / REGISTER / RESET
  // ================================

  function authModal(mode = 'login') {
    const register = mode === 'register';
    const reset = mode === 'reset';

    modal(
      reset
        ? 'Rejesha nenosiri'
        : register
          ? 'Fungua akaunti'
          : 'Ingia NYUMBA SALAMA',

      `
        <form id="authForm" class="form">

          ${register
            ? formField('Jina kamili', 'full_name')
            : ''
          }

          ${formField('Barua pepe', 'email', 'email')}

          ${reset
            ? ''
            : formField('Nenosiri', 'password', 'password')
          }

          <button class="primary full">
            ${
              reset
                ? 'Tuma link'
                : register
                  ? 'Jisajili'
                  : 'Ingia'
            }
          </button>

        </form>

        <p>
          <button class="linkbtn" id="switchAuth" type="button">
            ${
              register
                ? 'Tayari una akaunti? Ingia'
                : 'Huna akaunti? Jisajili'
            }
          </button>

          ·

          <button class="linkbtn" id="resetAuth" type="button">
            Umesahau nenosiri?
          </button>
        </p>

        ${
          reset
            ? ''
            : `
                <button class="outline full" id="googleAuth" type="button">
                  Ingia kwa Google
                </button>
              `
        }
      `
    );

    $('switchAuth').onclick = () => {
      authModal(register ? 'login' : 'register');
    };

    $('resetAuth').onclick = () => {
      authModal('reset');
    };

    const googleButton = $('googleAuth');

    if (googleButton) {
      googleButton.onclick = async () => {
        try {
          await api().signInWithGoogle();
        } catch (err) {
          error(err);
        }
      };
    }

    $('authForm').onsubmit = async event => {
      event.preventDefault();

      const data = Object.fromEntries(
        new FormData(event.target)
      );

      try {
        if (reset) {
          await api().resetPassword(data.email);
          toast('Angalia barua pepe yako.');

        } else if (register) {
          await api().signUp(data);
          toast(
            'Usajili umetumwa. Angalia barua pepe kwa uthibitisho.'
          );

        } else {
          await api().signIn(
            data.email,
            data.password
          );

          toast('Umeingia!');
        }

        close();

      } catch (err) {
        error(err);
      }
    };
  }

  window.openLogin = () => authModal('login');

  window.openRegister = () => authModal('register');

  // ================================
  // ADD PROPERTY
  // ================================

  function propertyModal() {
    if (!session()) {
      return authModal();
    }

    modal(
      'Ongeza nyumba',

      `
        <form id="propertyForm" class="form">

          ${formField('Jina la nyumba', 'title')}

          ${formField('Eneo', 'location')}

          ${formField(
            'Kodi kwa mwezi (TSh)',
            'price',
            'number'
          )}

          <label>
            Aina

            <select name="type">
              <option value="single">Chumba</option>
              <option value="self">Self-contained</option>
              <option value="apartment">Apartment</option>
              <option value="family">Familia</option>
            </select>
          </label>

          <label>
            Maelezo
            <textarea name="description"></textarea>
          </label>

          <label>
            Picha (hadi 8, kila moja 10MB)

            <input
              name="images"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
            >
          </label>

          <label>
            Video (hadi 2, kila moja 50MB)

            <input
              name="videos"
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              multiple
            >
          </label>

          <button
            class="primary full"
            type="submit"
          >
            Chapisha nyumba
          </button>

        </form>
      `
    );

    $('propertyForm').onsubmit = async event => {
      event.preventDefault();

      const form = event.target;
      const data = new FormData(form);

      const images = [
        ...form.elements.images.files
      ];

      const videos = [
        ...form.elements.videos.files
      ];

      if (images.length > 8 || videos.length > 2) {
        toast('Umezidisha idadi ya picha/video.');
        return;
      }

      if (
        images.some(file =>
          file.size > 10 * 1024 * 1024
        )
      ) {
        toast('Kila picha lazima iwe chini ya 10MB.');
        return;
      }

      if (
        videos.some(file =>
          file.size > 50 * 1024 * 1024
        )
      ) {
        toast('Kila video lazima iwe chini ya 50MB.');
        return;
      }

      const button = form.querySelector(
        'button[type="submit"]'
      );

      button.disabled = true;
      button.textContent = 'Inapakia...';

      try {
        await api().addProperty({
          title: data.get('title'),
          location: data.get('location'),
          price: Number(data.get('price')),
          type: data.get('type'),
          description: data.get('description'),
          images,
          videos,
          is_published: true
        });

        close();

        toast('Nyumba imechapishwa!');

        await refresh();

        await myProperties();

      } catch (err) {
        error(err);

      } finally {
        button.disabled = false;
        button.textContent = 'Chapisha nyumba';
      }
    };
  }

  window.openAddProperty = propertyModal;

  // ================================
  // MY PROPERTIES
  // ================================

  async function myProperties() {
    const box = $('myProperties');

    if (!box) return;

    if (!session()) {
      box.textContent = 'Ingia ili kuona nyumba zako.';
      return;
    }

    try {
      const rows = await api().loadMyProperties();

      box.dataset.nsManagedByApp = '1';

      box.innerHTML = rows.length
        ? rows.map(property => `
            <div class="activity-item">

              <strong>${esc(property.title)}</strong>

              —
              ${esc(property.location)}
              ·
              ${money(property.price)}

              <button
                class="outline"
                data-delete="${esc(property.id)}"
              >
                Futa
              </button>

            </div>
          `).join('')

        : 'Bado hujaongeza nyumba.';

    } catch (err) {
      box.textContent =
        err.message ||
        'Imeshindikana kupakia nyumba zako.';
    }
  }

  // ================================
  // AUTH STATE CALLBACK
  // ================================

  window.NS_onAuthChanged = (user, profile) => {
    currentProfile =
      profile ||
      api()?.getProfile?.() ||
      null;

    const accountButton = $('accountBtn');

    if (accountButton) {
      accountButton.textContent = user
        ? '👤 Akaunti'
        : '👤 Ingia / Jisajili';
    }

    const status = $('authStatus');

    if (status) {
      status.textContent = user
        ? `Umeingia: ${user.email} · Role: ${
            currentProfile?.role ||
            api()?.currentRole ||
            'user'
          }`
        : 'Ingia ili kutumia akaunti online.';
    }

    myProperties();

    refreshNotificationBadge();

    const notificationPanel = $('nsNotificationPanel');

    if (notificationPanel && !notificationPanel.hidden) {
      refreshNotificationCenter(true);
    }
  };

  // ================================
  // PROPERTY DETAILS
  // ================================

  function details(property) {
    modal(
      property.title,

      `
        <p>
          📍 ${esc(property.location)}
          ·
          ${money(property.price)}/mwezi
        </p>

        <p>${esc(property.description || '')}</p>

        ${
          (property.imageUrls || []).map(url => `
            <img
              src="${esc(url)}"
              alt="${esc(property.title)}"
              style="width:100%;border-radius:10px;margin:6px 0"
              loading="lazy"
            >
          `).join('')
        }

        ${
          (property.videoUrls || []).map(url => `
            <video
              src="${esc(url)}"
              controls
              playsinline
              style="width:100%;margin:6px 0"
            ></video>
          `).join('')
        }

        <button class="primary full" id="applyHere">
          Omba kupanga
        </button>
      `
    );

    $('applyHere').onclick = () => {
      apply(property);
    };
  }

  // ================================
  // RENTAL APPLICATION
  // ================================

  function apply(property) {
    if (!session()) {
      return authModal();
    }

    modal(
      'Omba kupanga: ' + property.title,

      `
        <form id="applyForm" class="form">

          ${formField('Jina lako', 'applicant_name')}

          ${formField('Simu', 'phone', 'tel')}

          <label>
            Ujumbe
            <textarea name="message"></textarea>
          </label>

          <button class="primary full" type="submit">
            Tuma ombi
          </button>

        </form>
      `
    );

    $('applyForm').onsubmit = async event => {
      event.preventDefault();

      const data = Object.fromEntries(
        new FormData(event.target)
      );

      const button = event.target.querySelector(
        'button[type="submit"]'
      );

      button.disabled = true;

      try {
        await api().createRentalRequest({
          ...data,
          property_id: property.id
        });

        close();

        toast('Ombi limetumwa!');

      } catch (err) {
        error(err);

      } finally {
        button.disabled = false;
      }
    };
  }

  // ================================
  // LANDLORD DASHBOARD
  // ================================

  async function landlordDashboard() {
    if (!session()) {
      return authModal();
    }

    let rows;

    try {
      rows = await api().loadOwnerRentalRequests();

    } catch (err) {
      return error(err);
    }

    function render() {
      const content = rows.length
        ? rows.map(request => {
            const property = request.property || {};

            const status = String(
              request.status || 'pending'
            );

            const actions = status === 'pending'
              ? `
                  <button
                    class="primary"
                    data-rental-action="approved"
                    data-id="${esc(request.id)}"
                  >
                    ✓ Kubali
                  </button>

                  <button
                    class="outline"
                    data-rental-action="rejected"
                    data-id="${esc(request.id)}"
                  >
                    ✕ Kataa
                  </button>
                `

              : `
                  <span class="ns-status ns-status-${esc(status)}">
                    ${
                      status === 'approved'
                        ? 'Imekubaliwa'
                        : status === 'rejected'
                          ? 'Imekataliwa'
                          : esc(status)
                    }
                  </span>
                `;

            return `
              <article
                class="activity-item"
                style="padding:14px;margin:10px 0;border:1px solid #ddd;border-radius:12px"
              >

                <h3>${esc(property.title || 'Nyumba')}</h3>

                <p>📍 ${esc(property.location || '')}</p>

                <p>
                  <strong>Mwombaji:</strong>
                  ${esc(request.applicant_name || '—')}
                </p>

                <p>
                  <strong>Simu:</strong>
                  <a href="tel:${esc(request.phone || '')}">
                    ${esc(request.phone || '—')}
                  </a>
                </p>

                <p>
                  <strong>Ujumbe:</strong>
                  ${esc(request.message || 'Hakuna ujumbe')}
                </p>

                <p>
                  <strong>Tarehe:</strong>
                  ${
                    esc(
                      request.created_at
                        ? new Date(request.created_at).toLocaleString()
                        : '—'
                    )
                  }
                </p>

                <p>
                  <strong>Status:</strong>
                  ${esc(status)}
                </p>

                <div>${actions}</div>

              </article>
            `;
          }).join('')

        : `
            <p>
              Bado hakuna maombi ya nyumba zako.
              Maombi mapya yataonekana hapa.
            </p>
          `;

      modal(
        'Landlord Dashboard · Maombi ya kupanga',

        `
          <p>
            Hapa unaona maombi ya nyumba zako pekee.
          </p>

          <div id="rentalApplicationsList">
            ${content}
          </div>

          <button
            class="outline full"
            id="refreshRentalApps"
          >
            ↻ Refresh maombi
          </button>
        `
      );

      $('modalBody').onclick = async event => {
        if (event.target.closest('#refreshRentalApps')) {
          await landlordDashboard();
          return;
        }

        const button = event.target.closest(
          '[data-rental-action]'
        );

        if (!button) return;

        const nextStatus =
          button.dataset.rentalAction;

        const confirmed = confirm(
          nextStatus === 'approved'
            ? 'Unakubali ombi hili?'
            : 'Unakataa ombi hili?'
        );

        if (!confirmed) return;

        button.disabled = true;

        try {
          await api().updateRentalRequestStatus(
            button.dataset.id,
            nextStatus
          );

          toast(
            nextStatus === 'approved'
              ? 'Ombi limekubaliwa.'
              : 'Ombi limekataliwa.'
          );

          rows = await api().loadOwnerRentalRequests();

          render();

        } catch (err) {
          error(err);
          button.disabled = false;
        }
      };
    }

    render();
  }

  window.openLandlordDashboard = landlordDashboard;

  // ================================
  // TENANT DASHBOARD
  // ================================

  async function tenantDashboard() {
    if (!session()) {
      return authModal();
    }

    let rows;

    try {
      rows = await api().loadMyRentalRequests();

    } catch (err) {
      return error(err);
    }

    const content = rows.length
      ? rows.map(request => {
          const property = request.property || {};

          const status = String(
            request.status || 'pending'
          );

          const label =
            status === 'approved'
              ? 'Imekubaliwa ✅'
              : status === 'rejected'
                ? 'Imekataliwa ❌'
                : status === 'pending'
                  ? 'Inasubiri majibu ⏳'
                  : status;

          const hint =
            status === 'approved'
              ? `
                  <p style="color:green">
                    <strong>Habari njema!</strong>
                    Landlord amekubali ombi lako.
                    Wasiliana naye kupitia taarifa za mawasiliano
                    zilizopo kwenye tangazo.
                  </p>
                `
              : status === 'rejected'
                ? `
                    <p>
                      Ombi hili limekataliwa.
                      Unaweza kutafuta nyumba nyingine
                      na kutuma ombi jipya.
                    </p>
                  `
                : `
                    <p>
                      Landlord bado hajatoa uamuzi.
                      Rudi hapa na bonyeza Refresh
                      kuangalia majibu mapya.
                    </p>
                  `;

          return `
            <article
              class="activity-item"
              style="padding:14px;margin:10px 0;border:1px solid #ddd;border-radius:12px"
            >

              <h3>
                ${esc(property.title || 'Nyumba uliyoomba')}
              </h3>

              <p>
                📍
                ${esc(
                  property.location ||
                  'Maelezo ya nyumba hayapatikani kwa sasa'
                )}
              </p>

              <p>
                <strong>Kodi:</strong>
                ${
                  property.price != null
                    ? money(property.price) + '/mwezi'
                    : '—'
                }
              </p>

              <p>
                <strong>Jina la mwombaji:</strong>
                ${esc(request.applicant_name || '—')}
              </p>

              <p>
                <strong>Ujumbe wako:</strong>
                ${esc(request.message || 'Hakuna ujumbe')}
              </p>

              <p>
                <strong>Tarehe ya ombi:</strong>
                ${
                  esc(
                    request.created_at
                      ? new Date(request.created_at).toLocaleString()
                      : '—'
                  )
                }
              </p>

              <p>
                <strong>Hali ya ombi:</strong>
                ${esc(label)}
              </p>

              ${hint}

            </article>
          `;
        }).join('')

      : `
          <p>
            Bado hujatuma ombi la kupanga.
            Nenda kwenye nyumba unayoipenda
            kisha bonyeza “Omba kupanga”.
          </p>
        `;

    modal(
      'Maombi yangu · Tenant Dashboard',

      `
        <p>
          Hapa utaona maombi uliyotuma
          na majibu ya landlord.
        </p>

        <div id="tenantApplicationsList">
          ${content}
        </div>

        <button
          class="outline full"
          id="refreshTenantApps"
        >
          ↻ Refresh majibu
        </button>
      `
    );

    $('modalBody').onclick = async event => {
      if (event.target.closest('#refreshTenantApps')) {
        await tenantDashboard();
      }
    };
  }

  window.openTenantDashboard = tenantDashboard;

  // ================================
  // ADMIN CONTROL CENTER
  // ================================

  function openAdminPanel() {
    if (!session()) {
      return authModal();
    }

    if (!isAdmin()) {
      toast('Akaunti hii haina ruhusa za Admin.');
      return;
    }

    window.location.href = 'admin.html';
  }

  window.openAdminPanel = openAdminPanel;

  // ================================
  // PROPERTY CARD BUTTONS
  // ================================

  const listingGrid = $('listingGrid');

  if (listingGrid) {
    listingGrid.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');

      if (!button) return;

      const property = listings.find(
        item => String(item.id) === button.dataset.id
      );

      if (!property) return;

      if (button.dataset.action === 'details') {
        details(property);
      }

      if (button.dataset.action === 'apply') {
        apply(property);
      }

      if (button.dataset.action === 'save') {
        const id = String(property.id);

        if (saved.has(id)) {
          saved.delete(id);
        } else {
          saved.add(id);
        }

        localStorage.setItem(
          'ns_saved_ids',
          JSON.stringify([...saved])
        );

        renderListings();
      }
    });
  }

  // ================================
  // DELETE MY PROPERTY
  // ================================

  const myPropertiesBox = $('myProperties');

  if (myPropertiesBox) {
    myPropertiesBox.addEventListener(
      'click',
      async event => {
        const button = event.target.closest('[data-delete]');

        if (
          !button ||
          !confirm('Futa nyumba hii?')
        ) {
          return;
        }

        try {
          await api().deleteProperty(
            button.dataset.delete
          );

          await refresh();
          await myProperties();

        } catch (err) {
          error(err);
        }
      }
    );
  }

  // ================================
  // ACCOUNT MENU
  // ================================

  const accountButton = $('accountBtn');

  if (accountButton) {
    accountButton.onclick = () => {
      if (!session()) {
        return authModal();
      }

      const role = getRole();

      const showAdmin = [
        'admin',
        'administrator',
        'super_admin',
        'superadmin'
      ].includes(role);

      modal(
        'Akaunti yangu',

        `
          <p>${esc(session().email)}</p>

          <button
            class="outline full"
            id="signOutBtn"
            type="button"
          >
            Toka kwenye akaunti
          </button>

          <button
            class="primary full"
            id="tenantAppsBtn"
            type="button"
          >
            📋 Maombi yangu (Tenant Dashboard)
          </button>

          <button
            class="outline full"
            id="roleBtn"
            type="button"
          >
            Omba kuwa landlord
          </button>

          <button
            class="primary full"
            id="landlordAppsBtn"
            type="button"
          >
            🏠 Maombi ya kupanga (Landlord Dashboard)
          </button>

          ${
            showAdmin
              ? `
                  <button
                    class="primary full"
                    id="adminBtn"
                    type="button"
                  >
                    Admin Panel
                  </button>
                `
              : ''
          }
        `
      );

      $('signOutBtn').onclick = async () => {
        try {
          await api().signOut();
          close();

        } catch (err) {
          error(err);
        }
      };

      $('roleBtn').onclick = async () => {
        try {
          await api().requestRole('landlord');

          close();

          toast('Ombi limetumwa');

        } catch (err) {
          error(err);
        }
      };

      $('tenantAppsBtn').onclick =
        tenantDashboard;

      $('landlordAppsBtn').onclick =
        landlordDashboard;

      const adminButton = $('adminBtn');

      if (adminButton) {
        adminButton.onclick = openAdminPanel;
      }
    };
  }

  // ================================
  // ADD PROPERTY BUTTON
  // ================================

  const addPropertyButton = $('addPropertyBtn');

  if (addPropertyButton) {
    addPropertyButton.onclick = propertyModal;
  }

  // ================================
  // SEARCH
  // ================================

  const searchButton = $('searchBtn');

  if (searchButton) {
    searchButton.onclick = () => {
      savedOnly = false;

      query = (
        $('searchInput')?.value || ''
      ).trim().toLowerCase();

      renderListings();

      $('explore')?.scrollIntoView({
        behavior: 'smooth'
      });
    };
  }

  const searchInput = $('searchInput');

  if (searchInput) {
    searchInput.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Enter') {
          searchButton?.click();
        }
      }
    );
  }

  // ================================
  // PROPERTY TYPE FILTERS
  // ================================

  const typeFilters = $('typeFilters');

  if (typeFilters) {
    typeFilters.onclick = event => {
      const button = event.target.closest('[data-type]');

      if (!button) return;

      savedOnly = false;
      filter = button.dataset.type;

      document.querySelectorAll('.chip').forEach(chip => {
        chip.classList.toggle(
          'active',
          chip === button
        );
      });

      renderListings();
    };
  }

  // ================================
  // BUDGET FILTER
  // ================================

  const budgetFilter = $('budgetFilter');

  if (budgetFilter) {
    budgetFilter.onchange = event => {
      savedOnly = false;
      budget = Number(event.target.value);

      renderListings();
    };
  }

  // ================================
  // MODAL CLOSE
  // ================================

  const closeModalButton = $('closeModal');

  if (closeModalButton) {
    closeModalButton.onclick = close;
  }

  const modalElement = $('modal');

  if (modalElement) {
    modalElement.onclick = event => {
      if (event.target === modalElement) {
        close();
      }
    };
  }

  // ================================
  // THEME SWITCH
  // ================================

  const themeButton = $('themeBtn');

  if (themeButton) {
    themeButton.onclick = () => {
      document.body.classList.toggle('dark');

      themeButton.textContent =
        document.body.classList.contains('dark')
          ? '☀'
          : '☾';
    };
  }

  // ================================
  // SAVED PROPERTIES
  // ================================

  const showSavedButton = $('showSavedBtn');

  if (showSavedButton) {
    showSavedButton.onclick = () => {
      savedOnly = true;
      query = '';
      filter = 'all';

      renderListings();

      $('explore')?.scrollIntoView({
        behavior: 'smooth'
      });
    };
  }

  // ================================
  // LUKU SPLITTER
  // ================================

  const lukuForm = $('lukuForm');

  if (lukuForm) {
    lukuForm.onsubmit = event => {
      event.preventDefault();

      const amount = Number(
        $('lukuAmount')?.value
      );

      const people = Number(
        $('lukuPeople')?.value
      );

      const result = $('lukuResult');

      if (!result) return;

      result.textContent =
        amount > 0 && people > 0
          ? `Kila mtu: ${money(amount / people)}`
          : 'Weka kiasi sahihi.';
    };
  }

  // ================================
  // FEATURES NOT YET CONNECTED
  // ================================

  const maintenanceButton = $('maintenanceBtn');

  if (maintenanceButton) {
    maintenanceButton.onclick = () => {
      toast(
        'Maintenance tracker inahitaji database table na policies.'
      );
    };
  }

  const contractButton = $('contractBtn');

  if (contractButton) {
    contractButton.onclick = () => {
      toast(
        'Mikataba ya kidijitali bado haijaunganishwa.'
      );
    };
  }

  const roommateButton = $('addRoommateBtn');

  if (roommateButton) {
    roommateButton.onclick = () => {
      toast(
        'Roommate backend bado haijaunganishwa.'
      );
    };
  }

  const roommateGrid = $('roommateGrid');

  if (roommateGrid) {
    roommateGrid.innerHTML =
      '<p class="muted">Roommate listings zinahitaji backend.</p>';
  }

  const maintenanceDashboard = $('dashboardMaintenance');

  if (maintenanceDashboard) {
    maintenanceDashboard.textContent =
      'Bado hakuna ripoti.';
  }

  // ================================
  // INITIALIZE APP
  // ================================

  renderListings();

  initNotificationCenter();

  let tries = 0;

  const wait = setInterval(() => {
    if (api()?.ready) {
      clearInterval(wait);

      refresh();

      currentProfile =
        api()?.getProfile?.() ||
        currentProfile;

      window.NS_onAuthChanged(
        session(),
        currentProfile
      );

      refreshNotificationBadge();

    } else if (++tries > 40) {
      clearInterval(wait);

      const status = $('authStatus');

      if (status) {
        status.textContent =
          'Supabase haijaunganishwa. Angalia config.js na internet.';
      }
    }
  }, 250);

  // Refresh badge periodically while the page remains open.
  setInterval(() => {
    refreshNotificationBadge();
  }, 60000);

})();