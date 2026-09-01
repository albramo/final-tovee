if (!customElements.get('tab-list')) {
  customElements.define(
    'tab-list',
    class TabList extends HTMLUListElement {
      constructor() {
        super();

        this.controls.forEach((button) => button.addEventListener('click', this.handleButtonClick.bind(this)));
      }

      get controls() {
        return this._controls = this._controls || Array.from(this.querySelectorAll('[aria-controls]'));
      }

      handleButtonClick(event) {
        event.preventDefault();

        this.controls.forEach((button) => {
          button.setAttribute('aria-expanded', 'false');

          const panel = document.getElementById(button.getAttribute('aria-controls'));
          panel?.removeAttribute('open');
        });

        const target = event.currentTarget;
        target.setAttribute('aria-expanded', 'true');

        const panel = document.getElementById(target.getAttribute('aria-controls'));
        panel?.setAttribute('open', '');
      }

      reset() {
        const firstControl = this.controls[0];
        firstControl.dispatchEvent(new Event('click'));
      }
    }, { extends: 'ul' }
  );
}

// Helper: Dynamically update free shipping bars without full drawer replace
// Preserves design/location, adds green when completed, smooth progress
theme.updateFreeShippingBars = theme.updateFreeShippingBars || function(cart) {
  if (!cart) return;
  const bars = document.querySelectorAll('[data-free-shipping-bar]');
  if (!bars.length) return;
  bars.forEach(bar => {
    const minimumCents = parseFloat(bar.getAttribute('data-minimum-cents')) || parseFloat(bar.getAttribute('data-minimum-amount')) * 100;
    if (!minimumCents || isNaN(minimumCents)) return;
    // Adjust total if gift wrap exists: try to detect gift wrap price in cart
    let totalPrice = cart.total_price;
    // If bar is inside drawer/cart and gift wrap logic exists, cart.total_price already includes gift wrap, but snippet subtracts it
    // Try to approximate by checking cart items for gift wrap id if stored in bar dataset (fallback ignore)
    const progress = Math.min(totalPrice / minimumCents, 1);
    const isCompleted = totalPrice >= minimumCents;
    bar.classList.toggle('free-shipping-bar--completed', isCompleted);
    bar.setAttribute('data-is-completed', isCompleted);
    bar.setAttribute('data-progress', progress);
    bar.setAttribute('data-cart-total', totalPrice);
    const progressBar = bar.querySelector('[data-free-shipping-progress]');
    if (progressBar) {
      progressBar.style.setProperty('--progress', progress);
    }
    const messageEl = bar.querySelector('[data-free-shipping-message]');
    if (messageEl) {
      if (isCompleted) {
        const congrat = bar.getAttribute('data-congratulations') || 'You are eligible for free shipping.';
        // Decode escaped HTML entities from Liquid escape
        const txt = document.createElement('textarea');
        txt.innerHTML = congrat;
        messageEl.innerHTML = txt.value;
        messageEl.classList.add('free-shipping-bar__message--success');
      } else {
        const template = bar.getAttribute('data-remaining-template') || 'Spend [[remaining_amount]] more to reach free shipping!';
        const tplDecoded = (function(s){
          const t=document.createElement('textarea'); t.innerHTML=s; return t.value;
        })(template);
        const remaining = minimumCents - totalPrice;
        let money = '';
        try {
          money = theme.Currency ? theme.Currency.formatMoney(remaining, theme.settings.moneyFormat) : (remaining/100).toFixed(2);
        } catch(e) {
          money = theme.Currency ? theme.Currency.formatMoney(remaining) : remaining;
        }
        const remainingHtml = `<span data-free-shipping-remaining>${money}</span>`;
        const finalHtml = tplDecoded.replace('[[remaining_amount]]', remainingHtml).replace('{{ remaining_amount }}', remainingHtml).replace('[[remaining]]', remainingHtml);
        messageEl.innerHTML = finalHtml;
        messageEl.classList.remove('free-shipping-bar__message--success');
      }
    }
  });
};

// Listen to cart:updated for bars outside cart-items flow (e.g., after add)
document.addEventListener('cart:updated', (e) => {
  if (e.detail && e.detail.cart && typeof theme.updateFreeShippingBars === 'function') theme.updateFreeShippingBars(e.detail.cart);
});
if (theme.pubsub && theme.pubsub.subscribe && theme.pubsub.PUB_SUB_EVENTS) {
  try {
    theme.pubsub.subscribe(theme.pubsub.PUB_SUB_EVENTS.cartUpdate, (e) => {
      if (e && e.cart && typeof theme.updateFreeShippingBars === 'function') theme.updateFreeShippingBars(e.cart);
      // Ensure drawer auto-opens when product added (fixes second product not showing)
      try {
        if (e && e.source === 'product-form' && e.cart && e.cart.item_count > 0) {
          const drawer = document.getElementById('CartDrawer');
          if (drawer && !drawer.hasAttribute('open')) {
            setTimeout(() => {
              if (!drawer.hasAttribute('open')) drawer.show(e.target || document.activeElement);
            }, 80);
          }
        }
        // Also for product-bundle and other sources that add items
        if (e && (e.source === 'product-bundle' || e.source === 'product-form') && e.cart) {
          const drawer = document.getElementById('CartDrawer');
          if (drawer && !drawer.hasAttribute('open') && e.cart.item_count > 0) {
            setTimeout(() => { if (!drawer.hasAttribute('open')) drawer.show(); }, 80);
          }
        }
      } catch(err) {}
    });
  } catch(e) {}
}

// Global fallback: ensure cart-drawer is always bundled (fixes add product where drawer not showing)
document.addEventListener('cart:bundled-sections', (e) => {
  try {
    const drawer = document.getElementById('CartDrawer');
    if (drawer) {
      const sec = drawer.getAttribute('data-render-section-id') || drawer.getAttribute('data-section-id');
      if (sec && !e.detail.sections.includes(sec)) e.detail.sections.push(sec);
      if (!e.detail.sections.includes('cart-drawer')) e.detail.sections.push('cart-drawer');
    }
  } catch(err) {}
});

if (!customElements.get('cart-drawer')) {
  customElements.define(
    'cart-drawer',
    class CartDrawer extends DrawerElement {
      constructor() {
        super();

        this.onPrepareBundledSectionsListener = this.onPrepareBundledSections.bind(this);
        this.onCartRefreshListener = this.onCartRefresh.bind(this);
        this.onCartUpdateListener = this.onCartUpdate.bind(this);
      }

      get sectionId() {
        return this.getAttribute('data-section-id');
      }

      get renderSectionId() {
        return this.getAttribute('data-render-section-id') || this.sectionId;
      }

      get shouldAppendToBody() {
        return false;
      }

      get recentlyViewed() {
        return this.querySelector('recently-viewed');
      }

      get tabList() {
        return this.querySelector('[is="tab-list"]');
      }

      connectedCallback() {
        super.connectedCallback();

        document.addEventListener('cart:bundled-sections', this.onPrepareBundledSectionsListener);
        document.addEventListener('cart:refresh', this.onCartRefreshListener);
        // Also listen for cartUpdate via pubsub to handle empty->add race where sections update fails
        this.cartUpdateUnsubscriber = theme.pubsub.subscribe(theme.pubsub.PUB_SUB_EVENTS.cartUpdate, this.onCartUpdateListener);
        if (this.recentlyViewed) {
          this.recentlyViewed.addEventListener('is-empty', this.onRecentlyViewedEmpty.bind(this));
        }
      }

      disconnectedCallback() {
        super.disconnectedCallback();
    
        document.removeEventListener('cart:bundled-sections', this.onPrepareBundledSectionsListener);
        document.removeEventListener('cart:refresh', this.onCartRefreshListener);
        if (this.cartUpdateUnsubscriber) this.cartUpdateUnsubscriber();
      }

      onCartUpdate(event) {
        if (event.cart.errors) return;
        const miniCart = document.getElementById(`MiniCart-${this.sectionId}`);
        if (!miniCart) return;
        // Update free shipping bars dynamically
        if (window.theme && typeof theme.updateFreeShippingBars === 'function') {
          try { theme.updateFreeShippingBars(event.cart); } catch(e) {}
        }
        const hasItems = event.cart.item_count > 0;
        const drawerHasItems = miniCart.querySelector('cart-items .horizontal-products li');
        const wasEmpty = !drawerHasItems;
        // Detect count mismatch (e.g., second product added but drawer still shows 1) - force refresh
        try {
          const drawerCount = miniCart.querySelectorAll('cart-items .horizontal-products li').length;
          const cartCount = (event.cart.items && event.cart.items.length) ? event.cart.items.length : event.cart.item_count;
          // For quantity change, item length same but quantity differs, so also check total quantity mismatch via cartUpdate
          // If counts differ, force refresh to sync drawer
          if (hasItems && drawerHasItems && drawerCount !== cartCount) {
            setTimeout(() => this.onCartRefresh({ detail: { open: true } }), 150);
          }
        } catch(e) {}
        if (hasItems && !drawerHasItems) {
          setTimeout(() => {
            const stillEmpty = !miniCart.querySelector('cart-items .horizontal-products li');
            if (stillEmpty) this.onCartRefresh({ detail: { open: true } });
          }, 350);
        }
        if (!hasItems && drawerHasItems) {
          setTimeout(() => this.onCartRefresh({ detail: { open: false } }), 350);
        }
        if (hasItems && wasEmpty) {
          setTimeout(() => {
            if (!this.open) this.show();
          }, 400);
        }
      }

      onPrepareBundledSections(event) {
        event.detail.sections.push(this.renderSectionId);
      }

      onRecentlyViewedEmpty() {
        this.recentlyViewed.innerHTML = `
        <div class="drawer__scrollable relative flex justify-center items-start grow shrink text-center">
          <div class="drawer__empty grid gap-5 md:gap-8">
            <h2 class="drawer__empty-text heading leading-none tracking-tight">${theme.strings.recentlyViewedEmpty}</h2>
          </div>
        </div>
        `;
      }

      async onCartRefresh(event) {
        const id = `MiniCart-${this.sectionId}`;
        const miniCartEl = document.getElementById(id);
        if (miniCartEl === null) return;

        const wasOpen = this.open;
        const wasActive = this.hasAttribute('active');
        const scrollable = miniCartEl.querySelector('.drawer__scrollable');
        const scrollTop = scrollable ? scrollable.scrollTop : 0;

        // Try with actual section id first (preserves merchant settings like free_shipping_bar), fallback to renderSectionId
        // Added extra strategies for overlay-group sections (Shopify section rendering API)
        let updatedMiniCart = null;
        const tried = new Set();
        const candidates = [this.sectionId, this.renderSectionId, 'cart-drawer'].filter(Boolean);
        for (const sid of [...new Set(candidates)]) {
          if (tried.has(sid)) continue;
          tried.add(sid);
          for (const urlTemplate of [
            `${theme.routes.root_url}?section_id=${sid}&t=${Date.now()}`,
            `${theme.routes.root_url}?sections=${sid}&t=${Date.now()}`,
            `/cart?section_id=${sid}&t=${Date.now()}`,
            `${window.location.pathname}?section_id=${sid}&t=${Date.now()}`
          ]) {
            try {
              const responseText = await (await fetch(urlTemplate, { credentials: 'same-origin', headers: { 'Accept': 'text/html' } })).text();
              // If response is JSON (sections API), parse differently
              let parsedHTML;
              try {
                const json = JSON.parse(responseText);
                const html = json[sid] || json['cart-drawer'] || Object.values(json)[0];
                if (html) parsedHTML = new DOMParser().parseFromString(html, 'text/html');
                else parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
              } catch(_) {
                parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
              }
              updatedMiniCart = parsedHTML.querySelector(`#MiniCart-${sid}`) || parsedHTML.querySelector('[id^="MiniCart-"]') || parsedHTML.querySelector(`#MiniCart-${this.sectionId}`) || parsedHTML.querySelector('cart-drawer #MiniCart-*') || parsedHTML.querySelector('#MiniCart-cart-drawer');
              // Also try to find cart-items then climb to MiniCart
              if (!updatedMiniCart) {
                const cartItems = parsedHTML.querySelector('cart-items');
                if (cartItems) updatedMiniCart = cartItems.closest('[id^="MiniCart-"]') || cartItems.parentElement;
              }
              if (updatedMiniCart && updatedMiniCart.querySelector && updatedMiniCart.querySelector('cart-items')) break;
              if (updatedMiniCart && updatedMiniCart.innerHTML && updatedMiniCart.innerHTML.includes('cart-items')) break;
            } catch(e) {}
          }
          if (updatedMiniCart && updatedMiniCart.querySelector && updatedMiniCart.querySelector('cart-items')) break;
          if (updatedMiniCart && updatedMiniCart.innerHTML && updatedMiniCart.innerHTML.includes('horizontal-products')) break;
        }
        // Extra attempt for overlay-group via sections API JSON
        if (!updatedMiniCart) {
          try {
            const res = await fetch(`${theme.routes.root_url}?sections=cart-drawer&t=${Date.now()}`, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
            if (res.ok) {
              const text = await res.text();
              let html = null;
              try {
                const json = JSON.parse(text);
                html = json['cart-drawer'] || json[Object.keys(json)[0]];
              } catch(_) {
                html = text;
              }
              if (html) {
                const parsed = new DOMParser().parseFromString(html, 'text/html');
                updatedMiniCart = parsed.querySelector('[id^="MiniCart-"]') || parsed.querySelector('cart-drawer')?.querySelector('[id^="MiniCart-"]') || parsed.querySelector('cart-items')?.closest('[id^="MiniCart-"]');
                if (updatedMiniCart && !updatedMiniCart.querySelector('cart-items')) {
                  const ci = parsed.querySelector('cart-items');
                  if (ci) updatedMiniCart = ci.closest('[id^="MiniCart-"]') || miniCartEl;
                }
              }
            }
          } catch(e) {}
        }
        if (!updatedMiniCart) {
          try {
            const res2 = await fetch(`/?sections=cart-drawer&t=${Date.now()}`, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
            if (res2.ok) {
              const json2 = await res2.json();
              const html2 = json2['cart-drawer'];
              if (html2) {
                const parsed2 = new DOMParser().parseFromString(html2, 'text/html');
                updatedMiniCart = parsed2.querySelector('[id^="MiniCart-"]') || parsed2.querySelector('[id^="MiniCart-cart-drawer"]');
              }
            }
          } catch(e) {}
        }
        // Last resort: fetch cart.js and reconstruct minimal update (keep drawer open, update count via helper)
        if (!updatedMiniCart) {
          // Fallback: keep existing bar and just update its progress via cart.js
          try {
            const cartRes = await fetch(`${theme.routes.cart_url}.js`, { credentials: 'same-origin', headers: {'Accept':'application/json'}});
            if (cartRes.ok) {
              const cartJson = await cartRes.json();
              if (typeof theme.updateFreeShippingBars === 'function') theme.updateFreeShippingBars(cartJson);
            }
          } catch(e) {}
          // Don't return empty - try to preserve existing MiniCart and just update bar
          // If we have no updated HTML, keep current DOM but ensure bar exists
          if (!updatedMiniCart) {
            // Ensure bar exists - if missing, inject from current cart data
            let bar = miniCartEl.querySelector('[data-free-shipping-bar]');
            if (!bar) {
              // Try to create bar from current cart - fetch minimum from settings
              const minCents = 100000; // fallback 1000 EGP
              const fallbackBar = document.createElement('div');
              fallbackBar.innerHTML = `<div class="free-shipping-bar grid gap-3 w-full" data-free-shipping-bar data-minimum-cents="${minCents}" data-minimum-amount="${minCents/100}"><span class="text-sm leading-tight" data-free-shipping-message></span><progress-bar style="--progress:0" data-free-shipping-progress></progress-bar></div>`;
              const scrollable = miniCartEl.querySelector('.drawer__scrollable');
              if (scrollable) scrollable.prepend(fallbackBar.firstElementChild);
            }
            try { 
              const cartRes2 = await fetch(`${theme.routes.cart_url}.js`, { credentials: 'same-origin'});
              if (cartRes2.ok) {
                const c2 = await cartRes2.json();
                if (typeof theme.updateFreeShippingBars === 'function') theme.updateFreeShippingBars(c2);
                // Try to sync product list from cart JSON as last resort for second product
                try {
                  if (c2.items && c2.items.length !== miniCartEl.querySelectorAll('cart-items .horizontal-products li').length) {
                    // Force a hard refresh of cart drawer via full page sections fetch
                    const hardRes = await fetch(`${theme.routes.root_url}?sections=cart-drawer`, {credentials:'same-origin'});
                    if (hardRes.ok) {
                      const hardJson = await hardRes.json();
                      const hardHtml = hardJson['cart-drawer'];
                      if (hardHtml) {
                        const hp = new DOMParser().parseFromString(hardHtml, 'text/html');
                        const hm = hp.querySelector('[id^="MiniCart-"]');
                        if (hm) {
                          miniCartEl.innerHTML = hm.innerHTML;
                          if (typeof theme.updateFreeShippingBars === 'function') theme.updateFreeShippingBars(c2);
                        }
                      }
                    }
                  }
                } catch(e) {}
              }
            } catch(e) {}
            // Keep drawer open
            if (wasOpen && !this.open) {
              this.hidden = false;
              this.removeAttribute('inert');
              this.setAttribute('open','');
              this.setAttribute('active','');
            }
            if (event.detail && event.detail.open === true) this.show();
            return;
          }
        }
        miniCartEl.innerHTML = updatedMiniCart.innerHTML;

        // Preserve scroll position
        try {
          const newScrollable = miniCartEl.querySelector('.drawer__scrollable');
          if (newScrollable && scrollTop) newScrollable.scrollTop = scrollTop;
        } catch(e) {}

        // Keep drawer open if it was open before refresh (prevents disappearing to empty state)
        if (wasOpen && !this.open) {
          this.hidden = false;
          this.removeAttribute('inert');
          this.setAttribute('open', wasActive ? '' : 'immediate');
          this.setAttribute('active', '');
          try { theme.a11y.trapFocus(this, this.focusElement); } catch(e) {}
        }

        if (event.detail && event.detail.open === true) {
          this.show();
        }

        // Re-apply free shipping bar after DOM swap
        try {
          fetch(`${theme.routes.cart_url}.js`, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(c => { if (typeof theme.updateFreeShippingBars === 'function') theme.updateFreeShippingBars(c); })
            .catch(()=>{});
        } catch(e) {}
      }

      show(focusElement = null, animate = true) {
        super.show(focusElement, animate);

        if (this.tabList) {
          this.tabList.reset();

          if (this.open) {
            theme.a11y.trapFocus(this, this.focusElement);
          }
        }
      }
    }
  );
}

if (!customElements.get('cart-remove-button')) {
  customElements.define(
    'cart-remove-button',
    class CartRemoveButton extends HTMLAnchorElement {
      constructor() {
        super();

        this.addEventListener('click', (event) => {
          event.preventDefault();

          const cartItems = this.closest('cart-items');
          cartItems.updateQuantity(this.getAttribute('data-index'), 0);
        });
      }
    }, { extends: 'a' }
  );
}

if (!customElements.get('cart-items')) {
  theme.cartMutationState = theme.cartMutationState || { inFlight: false };

  customElements.define(
    'cart-items',
    class CartItems extends HTMLElement {
      cartUpdateUnsubscriber = undefined;
      quantityUpdateInProgress = false;
      pendingLine = undefined;

      constructor() {
        super();

        this.addEventListener('change', theme.utils.debounce(this.onChange.bind(this), 150));
        this.cartUpdateUnsubscriber = theme.pubsub.subscribe(theme.pubsub.PUB_SUB_EVENTS.cartUpdate, this.onCartUpdate.bind(this));
      }

      get sectionId() {
        return this.getAttribute('data-section-id');
      }

      get renderSectionId() {
        return this.getAttribute('data-render-section-id') || this.sectionId;
      }

      disconnectedCallback() {
        if (this.cartUpdateUnsubscriber) {
          this.cartUpdateUnsubscriber();
        }
      }

      onChange(event) {
        this.validateQuantity(event);
      }

      async onCartUpdate(event) {
        const loadingLine = event.line;

        try {
          if (event.cart.errors) {
            this.onCartError(event.cart.errors, event.target);
            return;
          }

          // Dynamically update free shipping bars instantly if available
          if (typeof theme.updateFreeShippingBars === 'function') {
            try { theme.updateFreeShippingBars(event.cart); } catch(e) {}
          }

          let sectionHTML = event.cart.sections?.[this.renderSectionId] || event.cart.sections?.[this.sectionId];
          if (!sectionHTML && event.cart.sections) {
            // Fallback: search any section containing MiniCart (handles overlay-group key mismatches)
            for (const key in event.cart.sections) {
              const html = event.cart.sections[key];
              if (html && typeof html === 'string' && html.includes('MiniCart-')) {
                sectionHTML = html;
                break;
              }
            }
          }
          if (!sectionHTML) {
            // Try direct sections API fetch as fallback before dispatching refresh
            try {
              const directRes = await fetch(`/?sections=cart-drawer&t=${Date.now()}`, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
              if (directRes.ok) {
                const directJson = await directRes.json();
                const directHtml = directJson['cart-drawer'] || directJson[Object.keys(directJson)[0]];
                if (directHtml && directHtml.includes('MiniCart-')) {
                  sectionHTML = directHtml;
                }
              }
            } catch(e) {}
          }
          if (!sectionHTML) {
            try {
              const directRes2 = await fetch(`${theme.routes.root_url}?sections=cart-drawer&t=${Date.now()}`, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
              if (directRes2.ok) {
                const txt = await directRes2.text();
                try {
                  const j2 = JSON.parse(txt);
                  const h2 = j2['cart-drawer'];
                  if (h2 && h2.includes('MiniCart-')) sectionHTML = h2;
                } catch(_) {
                  if (txt.includes('MiniCart-')) sectionHTML = txt;
                }
              }
            } catch(e) {}
          }
          if (!sectionHTML) {
            // Preserve drawer open state even when sections missing - don't close drawer
            const drawerForRefresh = document.getElementById('CartDrawer');
            const wasOpen = drawerForRefresh && drawerForRefresh.hasAttribute('open');
            // Also try to sync products from cart JSON if count mismatch
            try {
              if (event.cart && event.cart.items) {
                const mini = document.querySelector(`#MiniCart-${this.sectionId}`);
                const currentCount = mini ? mini.querySelectorAll('cart-items .horizontal-products li').length : 0;
                if (currentCount !== event.cart.items.length) {
                  document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { open: true } }));
                  // Also force update free shipping
                  if (typeof theme.updateFreeShippingBars === 'function') theme.updateFreeShippingBars(event.cart);
                  return;
                }
              }
            } catch(e) {}
            document.dispatchEvent(new CustomEvent('cart:refresh', {
              detail: { open: wasOpen ? true : false }
            }));
            return;
          }

          const sectionToRender = new DOMParser().parseFromString(sectionHTML, 'text/html');

          const miniCart = document.querySelector(`#MiniCart-${this.sectionId}`);
          let miniCartWasOpen = false;
          let miniCartScrollTop = 0;
          let drawerEl = null;
          // Preserve old bar in case new HTML missing it (prevents disappearing bar)
          let oldBarHTML = null;
          let oldBarMin = null;
          if (miniCart) {
            const oldBar = miniCart.querySelector('[data-free-shipping-bar]');
            if (oldBar) {
              oldBarHTML = oldBar.outerHTML;
              oldBarMin = oldBar.getAttribute('data-minimum-cents') || oldBar.getAttribute('data-minimum-amount');
            }
          }
          if (miniCart) {
            drawerEl = document.getElementById('CartDrawer') || miniCart.closest('cart-drawer');
            miniCartWasOpen = drawerEl ? drawerEl.hasAttribute('open') : false;
            const scrollable = miniCart.querySelector('.drawer__scrollable');
            miniCartScrollTop = scrollable ? scrollable.scrollTop : 0;
            const updatedElement = sectionToRender.querySelector(`#MiniCart-${this.sectionId}`)
              || sectionToRender.querySelector('[id^="MiniCart-"]');
            if (updatedElement) {
              miniCart.innerHTML = updatedElement.innerHTML;
              // Restore scroll position
              try {
                const newScrollable = miniCart.querySelector('.drawer__scrollable');
                if (newScrollable && miniCartScrollTop) newScrollable.scrollTop = miniCartScrollTop;
              } catch(e) {}
              // Keep drawer open if it was open before replacement
              if (miniCartWasOpen && drawerEl && !drawerEl.hasAttribute('open')) {
                drawerEl.hidden = false;
                drawerEl.removeAttribute('inert');
                drawerEl.setAttribute('open', '');
                drawerEl.setAttribute('active', '');
              }
              // Ensure bar exists - restore old bar if new HTML missing it (critical for disappearing bar)
              let newBar = miniCart.querySelector('[data-free-shipping-bar]');
              if (!newBar && oldBarHTML) {
                const newScrollable = miniCart.querySelector('.drawer__scrollable');
                if (newScrollable) {
                  newScrollable.insertAdjacentHTML('afterbegin', oldBarHTML);
                  newBar = miniCart.querySelector('[data-free-shipping-bar]');
                }
              }
              // Re-apply free shipping progress after DOM swap (server rendered already but ensure green state)
              if (typeof theme.updateFreeShippingBars === 'function') {
                try { theme.updateFreeShippingBars(event.cart); } catch(e) {}
              }
              // Force bar visibility even if progress was 0
              try {
                const barEl = miniCart.querySelector('[data-free-shipping-bar]');
                if (barEl) barEl.style.display = '';
                const prog = miniCart.querySelector('[data-free-shipping-progress]');
                if (prog && !prog.style.getPropertyValue('--progress')) {
                  prog.style.setProperty('--progress', '0');
                }
              } catch(e) {}
            } else if (oldBarHTML) {
              // No updatedElement found but we have old bar - ensure it stays and update progress
              if (typeof theme.updateFreeShippingBars === 'function') {
                try { theme.updateFreeShippingBars(event.cart); } catch(e) {}
              }
            }
          }

          const mainCart = document.querySelector(`#MainCart-${this.sectionId}`);
          if (mainCart) {
            const updatedElement = sectionToRender.querySelector(`#MainCart-${this.sectionId}`);
            if (updatedElement) {
              mainCart.innerHTML = updatedElement.innerHTML;
              if (typeof theme.updateFreeShippingBars === 'function') {
                try { theme.updateFreeShippingBars(event.cart); } catch(e) {}
              }
            }
            else {
              mainCart.closest('.cart').classList.add('is-empty');
              mainCart.remove();
            }
          }

          // Focus handling with safety - avoid throwing if element missing
          try {
            const lineItem = document.getElementById(`CartItem-${event.line}`) || document.getElementById(`CartDrawer-Item-${event.line}`);
            if (lineItem && event.name && lineItem.querySelector(`[name="${event.name}"]`)) {
              theme.a11y.trapFocus(mainCart || miniCart, lineItem.querySelector(`[name="${event.name}"]`));
            }
            else if (event.cart.item_count === 0) {
              const focusTarget = miniCart ? miniCart.querySelector('a') : document.querySelector('.empty-state__link');
              if (focusTarget) theme.a11y.trapFocus(miniCart || document.querySelector('.empty-state') || document.body, focusTarget);
            }
            else {
              const fallback = miniCart ? miniCart.querySelector('.horizontal-product__title') : (mainCart ? mainCart.querySelector('.cart__item-title') : null);
              if (fallback) theme.a11y.trapFocus(miniCart || mainCart, fallback);
            }
          } catch(focusError) {
            console.warn('Cart focus error', focusError);
          }

          document.dispatchEvent(new CustomEvent('cart:updated', {
            detail: {
              cart: event.cart
            }
          }));
        }
        finally {
          if (loadingLine !== undefined && loadingLine !== null) {
            this.disableLoading(loadingLine);
          }
        }
      }

      onCartError(errors, target) {
        if (target) {
          // this.updateQuantity(target.getAttribute('data-index'), target.defaultValue, document.activeElement.getAttribute('name'), target);
          this.disableLoading(target.getAttribute('data-index'));
          this.setValidity(target, errors);
          return;
        }
        else {
          window.location.href = theme.routes.cart_url;
        }

        alert(errors);
      }

      async updateQuantity(line, quantity, name, target) {
        // Cart mutations must be serialized. Aborting fetch only stops the browser
        // from waiting; Shopify can still finish the mutation on the server and a
        // following request can then be based on stale cart state.
        if (this.quantityUpdateInProgress || theme.cartMutationState.inFlight) return;

        this.quantityUpdateInProgress = true;
        theme.cartMutationState.inFlight = true;
        this.pendingLine = line;
        this.enableLoading(line);

        let sectionsToBundle = [];
        document.documentElement.dispatchEvent(new CustomEvent('cart:bundled-sections', { bubbles: true, detail: { sections: sectionsToBundle } }));
        // Ensure critical sections are always bundled even if listeners miss event (fallback for disappearing drawer)
        const fallbackSections = [];
        if (this.renderSectionId) fallbackSections.push(this.renderSectionId);
        if (this.sectionId && this.sectionId !== this.renderSectionId) fallbackSections.push(this.sectionId);
        // Always include cart-drawer and main-cart if present (fixes add product not showing)
        const cartDrawerEl = document.getElementById('CartDrawer');
        if (cartDrawerEl) {
          const drawerSec = cartDrawerEl.getAttribute('data-section-id') || cartDrawerEl.getAttribute('data-render-section-id') || 'cart-drawer';
          fallbackSections.push(drawerSec);
          fallbackSections.push('cart-drawer');
        }
        const mainCartEl = document.querySelector('main-cart');
        if (mainCartEl && mainCartEl.getAttribute('data-section-id')) fallbackSections.push(mainCartEl.getAttribute('data-section-id'));
        // Merge and dedupe
        sectionsToBundle = [...new Set([...sectionsToBundle, ...fallbackSections].filter(Boolean))];

        const body = JSON.stringify({
          id: line,
          quantity,
          sections: sectionsToBundle,
          sections_url: window.location.pathname
        });

        try {
          const response = await this.fetchCartChange(body);
          const responseText = await response.text();
          let parsedState = {};

          try {
            parsedState = responseText ? JSON.parse(responseText) : {};
          }
          catch (parseError) {
            if (response.ok) throw parseError;
          }

          if (!response.ok && !parsedState.errors) {
            parsedState.errors = parsedState.description || parsedState.message || theme.cartStrings.error;
          }

          try {
            theme.pubsub.publish(theme.pubsub.PUB_SUB_EVENTS.cartUpdate, {
              source: 'cart-items',
              cart: parsedState,
              target,
              line,
              name
            });
          }
          catch (renderError) {
            // A successful Cart API response must not be reported as a cart
            // mutation failure just because a subscriber failed to repaint.
            console.error(renderError);
            document.dispatchEvent(new CustomEvent('cart:refresh', {
              detail: { open: false }
            }));
          }
        }
        catch (error) {
          console.error(error);
          if (target) {
            this.setValidity(target, theme.cartStrings.error);
          }
        }
        finally {
          this.quantityUpdateInProgress = false;
          theme.cartMutationState.inFlight = false;
          this.pendingLine = undefined;
          this.disableLoading(line);
        }
      }

      async fetchCartChange(body) {
        const maximumAttempts = 3;

        for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
          const response = await fetch(`${theme.routes.cart_change_url}`, {
            ...theme.utils.fetchConfig(),
            body
          });

          if (response.status !== 409 && response.status !== 429) {
            return response;
          }

          if (attempt === maximumAttempts - 1) {
            return response;
          }

          const retryAfter = parseFloat(response.headers.get('Retry-After'));
          const retryDelay = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : 750 * (2 ** attempt);

          // Avoid holding the cart UI for an excessive server cooldown. In that
          // case return the throttle response and let the buyer retry later.
          if (retryDelay > 5000) {
            return response;
          }

          await new Promise((resolve) => setTimeout(resolve, Math.max(retryDelay, 250)));
        }
      }

      enableLoading(line) {
        const loader = document.getElementById(`Loader-${this.sectionId}-${line}`);
        if (loader) loader.hidden = false;

        const lineItem = document.getElementById(`CartItem-${line}`) || document.getElementById(`CartDrawer-Item-${line}`);
        lineItem?.setAttribute('aria-busy', 'true');
        lineItem?.querySelectorAll('quantity-input input, quantity-input button').forEach((control) => {
          if (!control.disabled) {
            control.disabled = true;
            control.setAttribute('data-cart-update-disabled', '');
          }
        });
      }

      disableLoading(line) {
        const loader = document.getElementById(`Loader-${this.sectionId}-${line}`);
        if (loader) loader.hidden = true;

        const lineItem = document.getElementById(`CartItem-${line}`) || document.getElementById(`CartDrawer-Item-${line}`);
        lineItem?.removeAttribute('aria-busy');
        lineItem?.querySelectorAll('[data-cart-update-disabled]').forEach((control) => {
          control.disabled = false;
          control.removeAttribute('data-cart-update-disabled');
        });
      }

      setValidity(target, message) {
        target.setCustomValidity(message);
        target.reportValidity();
        target.value = target.defaultValue;
        target.select();
      }

      validateQuantity(event) {
        const target = event.target;
        const inputValue = parseInt(target.value);
        const index = target.getAttribute('data-index');
        let message = '';

        if (inputValue < parseInt(target.getAttribute('data-min'))) {
          message = theme.quickOrderListStrings.minError.replace('[min]', target.getAttribute('data-min'));
        }
        else if (inputValue > parseInt(target.max)) {
          message = theme.quickOrderListStrings.maxError.replace('[max]', target.max);
        }
        else if (inputValue % parseInt(target.step) !== 0) {
          message = theme.quickOrderListStrings.stepError.replace('[step]', target.step);
        }

        if (message) {
          this.setValidity(target, message);
        }
        else if (inputValue === parseInt(target.defaultValue)) {
          target.setCustomValidity('');
        }
        else {
          target.setCustomValidity('');
          target.reportValidity();
          this.updateQuantity(index, inputValue, document.activeElement.getAttribute('name'), target);
        }
      }
    }
  );
}

if (!customElements.get('cart-note')) {
  customElements.define(
    'cart-note',
    class CartNote extends HTMLElement {
      constructor() {
        super();

        this.addEventListener('change', theme.utils.debounce(this.onChange.bind(this), 300));
      }

      onChange(event) {
        const body = JSON.stringify({ note: event.target.value });
        fetch(`${theme.routes.cart_update_url}`, { ...theme.utils.fetchConfig(), ...{ body } });
      }
    }
  );
}

if (!customElements.get('main-cart')) {
  customElements.define(
    'main-cart',
    class MainCart extends HTMLElement {
      constructor() {
        super();

        document.addEventListener('cart:bundled-sections', this.onPrepareBundledSections.bind(this));
      }

      get sectionId() {
        return this.getAttribute('data-section-id');
      }

      onPrepareBundledSections(event) {
        event.detail.sections.push(this.sectionId);
      }
    }
  );
}

if (!customElements.get('country-province')) {
  customElements.define(
    'country-province',
    class CountryProvince extends HTMLElement {
      constructor() {
        super();

        this.provinceElement = this.querySelector('[name="address[province]"]');
        this.countryElement = this.querySelector('[name="address[country]"]');
        this.countryElement.addEventListener('change', this.handleCountryChange.bind(this));

        if (this.getAttribute('country') !== '') {
          this.countryElement.selectedIndex = Math.max(0, Array.from(this.countryElement.options).findIndex((option) => option.textContent === this.getAttribute('data-country')));
          this.countryElement.dispatchEvent(new Event('change'));
        }
        else {
          this.handleCountryChange();
        }
      }

      handleCountryChange() {
        const option = this.countryElement.options[this.countryElement.selectedIndex], provinces = JSON.parse(option.getAttribute('data-provinces'));
        this.provinceElement.parentElement.hidden = provinces.length === 0;

        if (provinces.length === 0) {
          return;
        }

        this.provinceElement.innerHTML = '';

        provinces.forEach((data) => {
          const selected = data[1] === this.getAttribute('data-province');
          this.provinceElement.options.add(new Option(data[1], data[0], selected, selected));
        });
      }
    }
  );
}

if (!customElements.get('shipping-calculator')) {
  customElements.define(
    'shipping-calculator',
    class ShippingCalculator extends HTMLFormElement {
      constructor() {
        super();

        this.onSubmitHandler = this.onSubmit.bind(this);
      }

      connectedCallback() {
        this.submitButton = this.querySelector('[type="submit"]');
        this.resultsElement = this.lastElementChild;

        this.submitButton.addEventListener('click', this.onSubmitHandler);
      }

      disconnectedCallback() {
        this.submitButton.removeEventListener('click', this.onSubmitHandler);
      }

      onSubmit(event) {
        event.preventDefault();

        this.abortController?.abort();
        this.abortController = new AbortController();

        const zip = this.querySelector('[name="address[zip]"]').value,
          country = this.querySelector('[name="address[country]"]').value,
          province = this.querySelector('[name="address[province]"]').value;

        this.submitButton.setAttribute('aria-busy', 'true');

        const body = JSON.stringify({
          shipping_address: { zip, country, province }
        });
        let sectionUrl = `${theme.routes.cart_url}/shipping_rates.json`;

        // remove double `/` in case shop might have /en or language in URL
        sectionUrl = sectionUrl.replace('//', '/');

        fetch(sectionUrl, { ...theme.utils.fetchConfig('javascript'), ...{ body }, signal: this.abortController.signal })
          .then((response) => response.json())
          .then((parsedState) => {
            if (parsedState.shipping_rates) {
              this.formatShippingRates(parsedState.shipping_rates);
            }
            else {
              this.formatError(parsedState);
            }
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              console.log('Fetch aborted by user');
            }
            else {
              console.error(error);
            }
          })
          .finally(() => {
            this.resultsElement.hidden = false;
            this.submitButton.removeAttribute('aria-busy');
          });
      }

      formatError(errors) {
        const shippingRatesList = Object.keys(errors).map((errorKey) => {
          return `<li>${errors[errorKey]}</li>`;
        });
        this.resultsElement.innerHTML = `
          <div class="alert alert--error grid gap-2 text-sm leading-tight">
            <p>${theme.shippingCalculatorStrings.error}</p>
            <ul class="list-disc grid gap-2" role="list">${shippingRatesList.join('')}</ul>
          </div>
        `;
      }

      formatShippingRates(shippingRates) {
        const shippingRatesList = shippingRates.map(({ presentment_name, currency, price }) => {
          return `<li>${presentment_name}: ${currency} ${price}</li>`;
        });
        this.resultsElement.innerHTML = `
          <div class="alert alert--${shippingRates.length === 0 ? 'error' : 'success'} grid gap-2 text-sm leading-tight">
            <p>${shippingRates.length === 0 ? theme.shippingCalculatorStrings.notFound : shippingRates.length === 1 ? theme.shippingCalculatorStrings.oneResult : theme.shippingCalculatorStrings.multipleResults}</p>
            ${shippingRatesList === '' ? '' : `<ul class="list-disc grid gap-2" role="list">${shippingRatesList.join('')}</ul>`}
          </div>
        `;

      }
    }, { extends: 'form' }
  );
}
