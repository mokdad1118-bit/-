// ==================== SPLASH SCREEN LOGIC ====================
        const slides = document.querySelectorAll('.splash-slide');
        const indicators = document.querySelectorAll('.indicator');
        const categoryText = document.getElementById('category-text');
        const progressBar = document.getElementById('progress-bar');
        const ctaButton = document.getElementById('splash-cta');
        const splashScreen = document.getElementById('splash-screen');

        /** يُستدعى من onclick على الزر — يعمل حتى لو تعطّل addEventListener */
        function adoraSplashEnter(ev) {
            try {
                if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            } catch (_e) {}
            enterApp();
        }
        window.adoraSplashEnter = adoraSplashEnter;
        
        let currentSlide = 0;
        const totalSlides = slides.length;
        const msPerSlide = 1850;
        let progress = 0;
        let splashInterval;
        let progressInterval;
        
        function applySplashCtaLang() {
            const label = document.getElementById('splash-cta-label');
            const icon = document.getElementById('splash-cta-icon');
            const rtl = localStorage.getItem('adora_rtl') !== '0';
            if (label) {
                label.textContent = rtl ? label.getAttribute('data-ar') : label.getAttribute('data-en');
            }
            if (icon) {
                icon.classList.remove('fa-arrow-left', 'fa-arrow-right', 'ml-2', 'mr-2');
                if (rtl) {
                    icon.classList.add('fa-arrow-left', 'mr-2');
                } else {
                    icon.classList.add('fa-arrow-right', 'ml-2');
                }
            }
        }
        
        function initSplash() {
            applySplashCtaLang();
            setTimeout(() => {
                ctaButton?.classList.add('visible');
            }, 150);

            progress = 0;
            if (progressBar) progressBar.style.width = '0%';
            startSlideShow();
            startProgress();
        }
        
        function startSlideShow() {
            splashInterval = setInterval(() => {
                slides[currentSlide].classList.remove('active');
                indicators[currentSlide].classList.remove('active');
                
                currentSlide = (currentSlide + 1) % totalSlides;
                
                slides[currentSlide].classList.add('active');
                indicators[currentSlide].classList.add('active');
                
                progress = 0;
                if (progressBar) progressBar.style.width = '0%';
                
                categoryText?.classList.remove('active');
                setTimeout(() => {
                    if (categoryText) {
                        categoryText.textContent = slides[currentSlide].getAttribute('data-category');
                        categoryText.classList.add('active');
                    }
                }, 100);
                
            }, msPerSlide);
        }
        
        function startProgress() {
            progress = 0;
            if (progressBar) progressBar.style.width = '0%';
            const progressStep = 100 / (msPerSlide / 50);
            progressInterval = setInterval(() => {
                if (!splashScreen || splashScreen.style.display === 'none') return;
                progress += progressStep;
                if (progress >= 100) progress = 100;
                if (progressBar) progressBar.style.width = progress + '%';
            }, 50);
        }
        
        function showAppShellOnly() {
            adoraParticleGate.stop();
            adoraParticleModal.stop();
            document.getElementById('auth-gate-screen')?.classList.add('hidden');
            document.getElementById('app-shell')?.classList.remove('hidden');
            document.body.style.overflow = 'auto';
        }

        function showAuthGateOnly() {
            document.getElementById('auth-gate-screen')?.classList.remove('hidden');
            document.getElementById('app-shell')?.classList.add('hidden');
            document.body.style.overflow = 'hidden';
            adoraParticleGate.start();
        }

        function openAuthFromGate(mode) {
            openAuthModal(mode === 'login' ? 'login' : 'signup');
        }

        let pendingAfterSignupCredentials = null;

        function profileValidationTimeout(ms) {
            return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
        }

        let splashEnterLocked = false;

        function shouldSkipSplashOnLoad() {
            try {
                return (
                    sessionStorage.getItem('adora_skip_splash') === '1' || !!sessionStorage.getItem('adora_nav_stack_v1')
                );
            } catch (_e) {
                return false;
            }
        }

        async function finalizeSplashTransition() {
            try {
                sessionStorage.setItem('adora_skip_splash', '1');
            } catch (_e) {}
            if (splashScreen) splashScreen.style.display = 'none';
            const token = getStoredJwtToken();
            const resumeOverlay = document.getElementById('session-resume-overlay');

            if (!token) {
                resumeOverlay?.classList.add('hidden');
                showAuthGateOnly();
                return;
            }

            resumeOverlay?.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            try {
                await Promise.race([
                    apiFetch('/api/profile', { requireAuth: true }),
                    profileValidationTimeout(15000),
                ]);
                resumeOverlay?.classList.add('hidden');
                restoreBodyScrollIfIdle();
                showAppShellOnly();
                await refreshProfileAndOrders();
                await runPostAuthOnboarding();
                const hasDeep =
                    (() => {
                        try {
                            return !!sessionStorage.getItem('adora_deeplink_product');
                        } catch (_e) {
                            return false;
                        }
                    })();
                if (!hasDeep) {
                    await restoreAdoraSessionRoute();
                }
                consumeProductDeepLink();
            } catch {
                clearStoredJwtToken();
                resumeOverlay?.classList.add('hidden');
                restoreBodyScrollIfIdle();
                showAuthGateOnly();
            }
        }

        async function enterApp() {
            if (splashEnterLocked) return;
            splashEnterLocked = true;

            clearInterval(splashInterval);
            clearInterval(progressInterval);

            splashScreen?.classList.add('splash-exit');

            setTimeout(() => {
                finalizeSplashTransition();
            }, 800);
        }

        /** إعادة تحميل الصفحة: تخطي الشاشة الترحيبية والدخول مباشرة */
        async function skipSplashAndEnterApp() {
            if (splashEnterLocked) return;
            splashEnterLocked = true;
            clearInterval(splashInterval);
            clearInterval(progressInterval);
            splashScreen?.classList.remove('splash-exit');
            await finalizeSplashTransition();
        }

        function initOnboardingStorageMigration() {
            try {
                if (localStorage.getItem('adora_rtl') !== null && localStorage.getItem('adora_lang_prompt_done') === null) {
                    localStorage.setItem('adora_lang_prompt_done', '1');
                }
            } catch (_e) {}
        }

        async function runPostAuthOnboarding() {
            const token = getStoredJwtToken();
            if (!token) return;
            const shell = document.getElementById('app-shell');
            if (shell?.classList.contains('hidden')) return;
            await maybeShowLanguagePromptModal();
            await maybeShowNotificationPromptAsync();
            await maybeShowDownloadAppPromptModal();
        }

        function maybeShowLanguagePromptModal() {
            return new Promise((resolve) => {
                try {
                    if (localStorage.getItem('adora_lang_prompt_done') === '1') return resolve();
                    const el = document.getElementById('language-prompt-modal');
                    if (!el) return resolve();
                    window._resolveLangPrompt = resolve;
                    el.classList.remove('hidden');
                    document.body.style.overflow = 'hidden';
                } catch (_) {
                    resolve();
                }
            });
        }

        function chooseLanguagePrompt(rtl) {
            if (rtl !== null && rtl !== undefined) {
                isRTL = !!rtl;
                localStorage.setItem('adora_rtl', isRTL ? '1' : '0');
                applyAppLanguage();
            }
            localStorage.setItem('adora_lang_prompt_done', '1');
            document.getElementById('language-prompt-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
            const r = window._resolveLangPrompt;
            window._resolveLangPrompt = null;
            r?.();
        }

        function finishNotificationPromptUI() {
            document.getElementById('notification-prompt-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
            const r = window._resolveNotifPrompt;
            window._resolveNotifPrompt = null;
            r?.();
        }

        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
            return outputArray;
        }

        const ADORA_VAPID_FP_KEY = 'adora_vapid_public_fp';

        async function sendPushSubscriptionToServer(subscription) {
            const json = subscription.toJSON ? subscription.toJSON() : subscription;
            await apiFetch('/api/push/subscribe', {
                method: 'POST',
                requireAuth: true,
                body: { subscription: json },
            });
        }

        async function registerAdoraPushSubscription() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
            let reg;
            try {
                reg = await navigator.serviceWorker.ready;
            } catch (_e) {
                console.warn('[Adora Push] service worker not ready');
                return;
            }
            const keyUrl = `${getApiOrigin()}/api/push/vapid-public-key`;
            let keyRes;
            try {
                keyRes = await fetch(keyUrl, { credentials: 'omit', mode: 'cors' });
            } catch (_e) {
                console.warn('[Adora Push] cannot fetch VAPID key (CORS or network). Check CORS_ORIGIN on Render.', keyUrl);
                return;
            }
            if (!keyRes.ok) {
                console.warn('[Adora Push] VAPID endpoint HTTP', keyRes.status, keyUrl);
                return;
            }
            const keyJson = await keyRes.json().catch(() => ({}));
            if (!keyJson.ok || !keyJson.publicKey) return;
            const pubKey = String(keyJson.publicKey).trim();
            let sub = await reg.pushManager.getSubscription();
            const fp = pubKey.slice(0, 48);
            const prevFp = localStorage.getItem(ADORA_VAPID_FP_KEY);
            if (sub && prevFp && prevFp !== fp) {
                try {
                    const j = sub.toJSON();
                    if (j.endpoint) {
                        await apiFetch('/api/push/unsubscribe', {
                            method: 'POST',
                            requireAuth: true,
                            body: { endpoint: j.endpoint },
                        }).catch(() => {});
                    }
                    await sub.unsubscribe();
                } catch (_e) {
                    /* ignore */
                }
                sub = null;
            }
            const trySub = async () => {
                if (!sub) {
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(pubKey),
                    });
                }
                await sendPushSubscriptionToServer(sub);
                localStorage.setItem(ADORA_VAPID_FP_KEY, fp);
            };
            try {
                await trySub();
            } catch (e) {
                const msg = e && e.message ? String(e.message) : String(e);
                if (/user denied|not allowed|permission/i.test(msg)) {
                    return;
                }
                console.warn('[Adora Push] subscribe or save failed — open app from Netlify URL, allow notifications, ensure VAPID on Render.', msg);
                try {
                    localStorage.removeItem(ADORA_VAPID_FP_KEY);
                    if (sub) {
                        await sub.unsubscribe().catch(() => {});
                        sub = null;
                    }
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(pubKey),
                    });
                    await sendPushSubscriptionToServer(sub);
                    localStorage.setItem(ADORA_VAPID_FP_KEY, fp);
                } catch (e2) {
                    console.warn('[Adora Push] retry failed', e2 && e2.message ? e2.message : e2);
                }
            }
        }

        async function unregisterAdoraPushSubscription() {
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (sub) {
                    const j = sub.toJSON();
                    if (j.endpoint) {
                        await apiFetch('/api/push/unsubscribe', {
                            method: 'POST',
                            requireAuth: true,
                            body: { endpoint: j.endpoint },
                        }).catch(() => {});
                    }
                    await sub.unsubscribe();
                }
                try {
                    localStorage.removeItem(ADORA_VAPID_FP_KEY);
                } catch (_e) {
                    /* ignore */
                }
            } catch (_e) {
                /* ignore */
            }
        }

        function resolveNotificationOpenUrl(linkUrl) {
            if (linkUrl == null || linkUrl === '') return '/';
            const s = String(linkUrl).trim();
            if (s.startsWith('/')) return s.length <= 2048 && !s.includes('..') ? s : '/';
            if (/^https:\/\//i.test(s)) return s;
            return '/';
        }

        function showAdoraSystemNotification(payload) {
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            const tRaw = payload?.title != null ? String(payload.title).trim() : '';
            const title = tRaw ? tRaw.slice(0, 120) : isRTL ? 'أدورا' : 'Adora';
            const body = String(payload?.message || '').slice(0, 300);
            const opts = {
                body,
                icon: `${window.location.origin}/icons/adora-icon.svg`,
                tag: `adora-${payload?.id || 'msg'}`,
                data: { url: resolveNotificationOpenUrl(payload?.link_url) },
                silent: false,
            };
            if (payload?.image_url && /^https:\/\//i.test(payload.image_url)) opts.image = payload.image_url;
            try {
                const n = new Notification(title, opts);
                n.onclick = () => {
                    const u = n.data?.url || '/';
                    if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener,noreferrer');
                    else window.location.href = u.startsWith('/') ? u : `/${u}`;
                    n.close();
                };
            } catch (_e) {
                /* ignore */
            }
        }

        function maybeShowNotificationPromptAsync() {
            const token = getStoredJwtToken();
            if (!token) return Promise.resolve();
            return new Promise((resolve) => {
                (async () => {
                    try {
                        const data = await apiFetch('/api/profile', { requireAuth: true });
                        const u = data.user;
                        if (!u) return resolve();
                        if (Number(u.notifications_enabled) === 1) return resolve();
                        const sn = u.notifications_snoozed_until;
                        if (sn && new Date(sn) > new Date()) return resolve();
                        const el = document.getElementById('notification-prompt-modal');
                        if (!el || !el.classList.contains('hidden')) return resolve();
                        window._resolveNotifPrompt = resolve;
                        el.classList.remove('hidden');
                        document.body.style.overflow = 'hidden';
                    } catch (_) {
                        resolve();
                    }
                })();
            });
        }

        function maybeShowDownloadAppPromptModal() {
            return new Promise((resolve) => {
                try {
                    if (localStorage.getItem('adora_download_prompt_seen') === '1') return resolve();
                    const el = document.getElementById('download-prompt-modal');
                    if (!el) return resolve();
                    window._resolveDownloadPrompt = resolve;
                    el.classList.remove('hidden');
                    document.body.style.overflow = 'hidden';
                } catch (_) {
                    resolve();
                }
            });
        }

        let adoraDeferredInstallPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            adoraDeferredInstallPrompt = e;
        });

        async function tryInstallAdoraPwa() {
            if (!adoraDeferredInstallPrompt) return false;
            try {
                adoraDeferredInstallPrompt.prompt();
                const { outcome } = await adoraDeferredInstallPrompt.userChoice;
                adoraDeferredInstallPrompt = null;
                if (outcome === 'accepted') {
                    showToast(isRTL ? 'تم تثبيت أدورا' : 'Adora installed');
                }
                return outcome === 'accepted';
            } catch (_e) {
                return false;
            }
        }

        function isIosSafariLike() {
            const ua = navigator.userAgent || '';
            const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            return iOS;
        }

        function showPwaManualInstallHint() {
            showToast(
                isRTL
                    ? 'من القائمة (⋮): «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» — ستظهر أيقونة Adora.'
                    : 'Browser menu (⋮) → Install app or Add to Home screen — you’ll get the Adora icon.'
            );
        }

        function dismissDownloadPrompt(openLink) {
            localStorage.setItem('adora_download_prompt_seen', '1');
            const closeModal = () => {
                document.getElementById('download-prompt-modal')?.classList.add('hidden');
                restoreBodyScrollIfIdle();
                const r = window._resolveDownloadPrompt;
                window._resolveDownloadPrompt = null;
                r?.();
            };
            if (!openLink) {
                closeModal();
                return;
            }
            (async () => {
                const pwaOk = await tryInstallAdoraPwa();
                if (pwaOk) {
                    closeModal();
                    return;
                }
                if (isIosSafariLike()) {
                    showPwaManualInstallHint();
                    closeModal();
                    return;
                }
                const url = await resolveAppDownloadUrl();
                if (url && /^https?:\/\//i.test(url)) {
                    window.open(url, '_blank', 'noopener,noreferrer');
                } else {
                    showPwaManualInstallHint();
                }
                closeModal();
            })();
        }

        async function closeSignupCredentialsModal(acknowledged) {
            document.getElementById('signup-credentials-modal')?.classList.add('hidden');
            if (acknowledged) {
                try {
                    await apiFetch('/api/auth/ack-credentials', { method: 'POST', requireAuth: true });
                } catch (_e) {}
            }
            showAppShellOnly();
            await refreshProfileAndOrders();
            if (pendingAfterSignupCredentials) {
                const { payload, source } = pendingAfterSignupCredentials;
                pendingAfterSignupCredentials = null;
                const created = await sendOrderToSystem(payload, source);
                if (source === 'whatsapp' && created) await openWhatsAppWithOrder(created);
            }
            await runPostAuthOnboarding();
            consumeProductDeepLink();
        }

        async function confirmNotificationPrompt() {
            let granted = false;
            if (typeof Notification !== 'undefined') {
                const p = await Notification.requestPermission();
                granted = p === 'granted';
            }
            try {
                const body = granted
                    ? { notifications_enabled: 1 }
                    : { notifications_enabled: 0, snooze_hours: 24 };
                await apiFetch('/api/profile/notifications', {
                    method: 'PUT',
                    requireAuth: true,
                    body,
                });
            } catch (_e) {}
            syncNotificationToggleUI(granted);
            if (granted) await registerAdoraPushSubscription().catch(() => {});
            finishNotificationPromptUI();
        }

        async function dismissNotificationPrompt(snooze) {
            if (snooze) {
                try {
                    await apiFetch('/api/profile/notifications', {
                        method: 'PUT',
                        requireAuth: true,
                        body: { notifications_enabled: 0, snooze_hours: 24 },
                    });
                    await unregisterAdoraPushSubscription().catch(() => {});
                } catch (_e) {}
            }
            finishNotificationPromptUI();
        }

        function syncNotificationToggleUI(on) {
            const btn = document.getElementById('side-menu-notif-toggle');
            if (!btn) return;
            const knob = btn.querySelector('span');
            btn.classList.toggle('bg-purple-600', on);
            btn.classList.toggle('bg-gray-200', !on);
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            if (knob) {
                knob.classList.toggle('translate-x-5', on);
                knob.classList.toggle('translate-x-0.5', !on);
            }
        }

        async function toggleNotificationsFromMenu() {
            const token = getStoredJwtToken();
            if (!token) return;
            const btn = document.getElementById('side-menu-notif-toggle');
            const currentlyOn = btn?.classList.contains('bg-purple-600');
            const wantOn = !currentlyOn;
            let permitted = false;
            if (wantOn && typeof Notification !== 'undefined') {
                const p = await Notification.requestPermission();
                permitted = p === 'granted';
            }
            const enabled = wantOn && permitted;
            try {
                await apiFetch('/api/profile/notifications', {
                    method: 'PUT',
                    requireAuth: true,
                    body: { notifications_enabled: enabled ? 1 : 0 },
                });
                syncNotificationToggleUI(enabled);
                if (enabled) await registerAdoraPushSubscription().catch(() => {});
                else await unregisterAdoraPushSubscription().catch(() => {});
            } catch (_e) {
                showToast(isRTL ? 'تعذر التحديث' : 'Update failed');
            }
        }
        
        // ==================== CATEGORY TOGGLE LOGIC ====================
        let activeCategory = null;
        
        const HOME_SUBCAT_KEYS = ['men', 'women', 'kids'];
        const HOME_SUBCAT_INFO = {
            men: { en: 'Men', ar: 'رجالي', cat: 'Men' },
            women: { en: 'Women', ar: 'نسائي', cat: 'Women' },
            kids: { en: 'Kids', ar: 'ولادي', cat: 'Kids' },
        };

        function openHomeCategoryPanel(key) {
            const k = String(key || '').toLowerCase();
            if (!HOME_SUBCAT_KEYS.includes(k)) return;
            const ov = document.getElementById('home-subcat-overlay');
            if (!ov) return;
            if (activeCategory === k) {
                closeHomeCategoryPanel();
                return;
            }
            activeCategory = k;
            const info = HOME_SUBCAT_INFO[k];
            const titleEl = document.getElementById('home-subcat-sheet-title');
            if (titleEl && info) {
                titleEl.setAttribute('data-en', info.en);
                titleEl.setAttribute('data-ar', info.ar);
                titleEl.textContent = isRTL ? info.ar : info.en;
            }
            const viewBtn = document.getElementById('home-subcat-view-all-btn');
            if (viewBtn) {
                viewBtn.textContent = isRTL ? viewBtn.getAttribute('data-ar') || 'عرض الكل' : viewBtn.getAttribute('data-en') || 'View all';
                viewBtn.onclick = () => {
                    closeHomeCategoryPanel();
                    navigateToMainCategoryListing(info.cat);
                };
            }
            HOME_SUBCAT_KEYS.forEach((x) => {
                const p = document.getElementById(`panel-${x}`);
                if (p) p.classList.toggle('hidden', x !== k);
            });
            ov.classList.remove('hidden');
            ov.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            initHomeSubcategorySliderHosts();
        }

        function closeHomeCategoryPanel() {
            activeCategory = null;
            const ov = document.getElementById('home-subcat-overlay');
            if (ov) {
                ov.classList.add('hidden');
                ov.setAttribute('aria-hidden', 'true');
            }
            try {
                document.body.style.overflow = '';
            } catch (_e) {}
        }

        /** الانتقال إلى قائمة المنتجات للقسم الرئيسي (بدون فرعي) */
        function navigateToMainCategoryListing(category) {
            navigateToListingFiltered(category, null);
        }

        // State Management
        let currentScreen = 'screen-categories';
        /** مكدس شاشات داخلي يُزامن مع history.pushState لزر الرجوع على الموبايل */
        let adoraNavStack = ['screen-categories'];
        let adoraNavPopStateBound = false;
        let cartCount = 0;
        let currentQty = 1;
        let homeSubcatSlidesMerged = null;
        /** الافتراضي عربي؛ الإنجليزي فقط عند اختيار المستخدم (adora_rtl === '0') — لا يُربَط بلغة المتصفح */
        let isRTL = localStorage.getItem('adora_rtl') !== '0';
        let pendingOrder = null;
        let selectedPaymentMethod = 'cod';
        const ADORA_DELIVERY_ADDRESS_KEY = 'adora_delivery_address_v1';
        const defaultShippingAddress = {
            en: 'Damascus, Syria — coordinated with Adora',
            ar: 'دمشق، سوريا — يتم التنسيق مع أدورا'
        };
        function getSavedDeliveryAddressText() {
            try {
                return String(localStorage.getItem(ADORA_DELIVERY_ADDRESS_KEY) || '').trim();
            } catch (_e) {
                return '';
            }
        }
        function getShippingAddress() {
            const t = getSavedDeliveryAddressText();
            if (t) return { ar: t, en: t };
            return { ...defaultShippingAddress };
        }
        function loadDeliveryAddressField() {
            const ta = document.getElementById('profile-delivery-address');
            if (ta) ta.value = getSavedDeliveryAddressText();
        }
        function toggleProfileDeliveryAddressSection() {
            const sec = document.getElementById('profile-delivery-address-section');
            const ch = document.getElementById('profile-delivery-chevron');
            if (!sec) return;
            sec.classList.toggle('hidden');
            const hidden = sec.classList.contains('hidden');
            if (ch) ch.style.transform = hidden ? '' : 'rotate(180deg)';
            if (!hidden) loadDeliveryAddressField();
        }
        function saveDeliveryAddressFromProfile() {
            const ta = document.getElementById('profile-delivery-address');
            const v = String(ta?.value || '').trim().slice(0, 2000);
            try {
                localStorage.setItem(ADORA_DELIVERY_ADDRESS_KEY, v);
            } catch (_e) {}
            showToast(isRTL ? 'تم حفظ عنوان التوصيل' : 'Delivery address saved');
        }
        const paymentOptions = {
            cod: { en: 'Cash on Delivery', ar: 'الدفع عند الاستلام' },
            card: { en: 'Card', ar: 'بطاقة' }
        };
        const ADORA_CART_KEY = 'adora_cart_v3';
        let cartItems = [];
        const cartTotals = { subtotal: 0, discount: 0, shipping: 0, total: 0 };

        function computeTotalsForCartLines(items) {
            let subtotal = 0;
            let discount = 0;
            const arr = Array.isArray(items) ? items : [];
            for (const it of arr) {
                const q = Number(it.qty || 1);
                const listUnit = Number(it.unitPrice != null ? it.unitPrice : it.price || 0);
                const discPct = Number(it.discountPct || 0);
                const saleUnit = saleUnitFromListAndDiscount(listUnit, discPct);
                const lineOrig = q * listUnit;
                const lineSale = q * saleUnit;
                subtotal += lineSale;
                discount += Math.max(0, lineOrig - lineSale);
            }
            return { subtotal, discount, shipping: 0, total: subtotal };
        }
        let filterMinRating = 0;

        /** أرقام 0–9 لاتينية دائماً بغض النظر عن لغة الواجهة */
        const ADORA_NUMBER_LOCALE = 'en-US';

        function formatSyp(amount) {
            const n = Number(amount || 0);
            const s = (Number.isFinite(n) ? n : 0).toLocaleString(ADORA_NUMBER_LOCALE, { maximumFractionDigits: 0 });
            return `${s} ل.س`;
        }

        /** السعر المُدخل في لوحة التحكم = سعر القائمة قبل الخصم؛ سعر البيع = القائمة × (1 − خصم%) */
        function productListPrice(p) {
            return Number(p?.price ?? 0);
        }
        function productDiscountPct(p) {
            const d = Number(p?.discount ?? 0);
            return d > 0 && d < 100 ? d : 0;
        }
        function productSaleUnitPrice(p) {
            const list = productListPrice(p);
            const d = productDiscountPct(p);
            return d > 0 ? list * (1 - d / 100) : list;
        }
        function saleUnitFromListAndDiscount(listPrice, discPct) {
            const u = Number(listPrice || 0);
            const d = Number(discPct || 0);
            return d > 0 && d < 100 ? u * (1 - d / 100) : u;
        }

        function resolveDisplayBrand(brandRaw) {
            const b = String(brandRaw || '').trim();
            if (!b) return isRTL ? 'شركة أدورا' : 'Adora';
            return b;
        }

        function getCartLineKey(item) {
            if (item && item.marketplaceProductId != null) {
                return `mp_${Number(item.marketplaceProductId)}`;
            }
            const id = item.productId ?? item.id;
            const sz = String(item.size || '').trim();
            const cl = String(item.color || '').trim();
            return `${id}__${sz}__${cl}`;
        }

        function normalizeCartLine(it) {
            if (!it || typeof it !== 'object') return it;
            if (typeof it.name === 'string') {
                const s = it.name;
                it.name = { ar: s, en: s };
            }
            if (it.unitPrice == null && it.price != null) it.unitPrice = Number(it.price);
            if (it.price == null && it.unitPrice != null) it.price = Number(it.unitPrice);
            it.qty = Math.max(1, Math.min(99, Number(it.qty || 1)));
            return it;
        }

        function loadCartFromStorage() {
            try {
                const raw = localStorage.getItem(ADORA_CART_KEY);
                const arr = JSON.parse(raw || '[]');
                cartItems = Array.isArray(arr) ? arr.map(normalizeCartLine) : [];
            } catch (_e) {
                cartItems = [];
            }
            recalcCartTotals();
            renderCartUI();
        }

        function persistCart() {
            try {
                localStorage.setItem(ADORA_CART_KEY, JSON.stringify(cartItems));
            } catch (_e) {}
            recalcCartTotals();
            renderCartUI();
        }

        function recalcCartTotals() {
            let subtotal = 0;
            let discount = 0;
            for (const it of cartItems) {
                const q = Number(it.qty || 1);
                const listUnit = Number(it.unitPrice != null ? it.unitPrice : it.price || 0);
                const discPct = Number(it.discountPct || 0);
                const saleUnit = saleUnitFromListAndDiscount(listUnit, discPct);
                const lineOrig = q * listUnit;
                const lineSale = q * saleUnit;
                subtotal += lineSale;
                discount += Math.max(0, lineOrig - lineSale);
            }
            cartTotals.subtotal = subtotal;
            cartTotals.discount = discount;
            cartTotals.shipping = 0;
            cartTotals.total = subtotal;
            cartCount = cartItems.reduce((a, it) => a + Number(it.qty || 1), 0);
        }

        function renderCartUI() {
            updateCartBadge();
            const wrap = document.getElementById('cart-items');
            const empty = document.getElementById('cart-empty');
            if (!wrap) return;
            if (!cartItems.length) {
                wrap.innerHTML = '';
                empty?.classList.remove('hidden');
                empty?.classList.add('flex');
                wrap.classList.add('hidden');
            } else {
                empty?.classList.add('hidden');
                empty?.classList.remove('flex');
                wrap.classList.remove('hidden');
                const loc = isRTL ? 'ar' : 'en';
                wrap.innerHTML = cartItems
                    .map((it, idx) => {
                        const name = loc === 'ar' ? it.name.ar : it.name.en;
                        const img = it.image ? escapeHtml(it.image) : adoraPlaceholderImageUrl();
                        const sel = it.selected !== false;
                        const listUnit = Number(it.unitPrice != null ? it.unitPrice : it.price || 0);
                        const discPct = Number(it.discountPct || 0);
                        const saleU = saleUnitFromListAndDiscount(listUnit, discPct);
                        const meta = [it.size, it.color].filter(Boolean).join(' · ');
                        const brandLine = resolveDisplayBrand(it.brand);
                        return `<div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 relative overflow-hidden" data-cart-idx="${idx}">
                            <div class="flex gap-3 items-start">
                                <input type="checkbox" class="mt-3 cart-line-cb w-4 h-4 rounded border-gray-300 text-purple-600" ${sel ? 'checked' : ''} onchange="toggleCartLineSelected(${idx}, this.checked)" />
                                <div class="flex gap-4 flex-1 min-w-0">
                                    <div class="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                                        <img src="${img}" class="w-full h-full object-cover" alt="">
                                    </div>
                                    <div class="flex-1 flex flex-col justify-between min-w-0">
                                        <div>
                                            <div class="flex justify-between items-start gap-2">
                                                <h3 class="font-semibold text-gray-900 text-sm">${escapeHtml(name)}</h3>
                                                <button type="button" onclick="removeCartLineByIndex(${idx})" class="text-gray-400 hover:text-red-500 transition shrink-0"><i class="fas fa-trash-alt"></i></button>
                                            </div>
                                            <p class="text-[11px] text-violet-700 font-semibold mt-0.5">${escapeHtml(brandLine)}</p>
                                            ${meta ? `<p class="text-xs text-gray-500 mt-1">${escapeHtml(meta)}</p>` : ''}
                                        </div>
                                        <div class="flex justify-between items-end mt-2">
                                            <div class="flex items-center border border-gray-200 rounded-lg h-8">
                                                <button type="button" onclick="changeCartQtyByIndex(${idx},-1)" class="w-8 h-full flex items-center justify-center text-gray-600 hover:bg-gray-50 rounded-l-lg"><i class="fas fa-minus text-xs"></i></button>
                                                <span class="w-8 text-center text-sm font-semibold">${it.qty}</span>
                                                <button type="button" onclick="changeCartQtyByIndex(${idx},1)" class="w-8 h-full flex items-center justify-center text-gray-600 hover:bg-gray-50 rounded-r-lg"><i class="fas fa-plus text-xs"></i></button>
                                            </div>
                                            <div class="text-right">
                                                <div class="font-bold text-gray-900 text-sm">${formatSyp(saleU * it.qty)}</div>
                                                ${discPct > 0 ? `<div class="text-xs text-gray-400 line-through">${formatSyp(listUnit * it.qty)}</div>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                    })
                    .join('');
            }
            const subEl = document.getElementById('subtotal');
            const discEl = document.getElementById('discount');
            const totEl = document.getElementById('total');
            if (subEl) subEl.textContent = formatSyp(cartTotals.subtotal);
            if (discEl) discEl.textContent = cartTotals.discount > 0 ? `−${formatSyp(cartTotals.discount)}` : formatSyp(0);
            if (totEl) totEl.textContent = formatSyp(cartTotals.total);
            syncCartSelectAllCheckbox();
        }

        function syncCartSelectAllCheckbox() {
            const cb = document.getElementById('cart-select-all');
            if (!cb || !cartItems.length) return;
            const allOn = cartItems.every((it) => it.selected !== false);
            cb.checked = allOn;
        }

        function toggleCartSelectAll(on) {
            cartItems.forEach((it) => {
                it.selected = on;
            });
            persistCart();
        }

        function toggleCartLineSelected(index, on) {
            const it = cartItems[index];
            if (it) it.selected = on;
            persistCart();
        }

        function changeCartQtyByIndex(index, delta) {
            const it = cartItems[index];
            if (!it) return;
            it.qty = Math.max(1, Math.min(99, Number(it.qty || 1) + delta));
            persistCart();
        }

        function removeCartLineByIndex(index) {
            cartItems.splice(index, 1);
            persistCart();
        }

        function getSelectedCartItems() {
            return cartItems.filter((it) => it.selected !== false);
        }

        function setFilterMinRating(val, _btn) {
            filterMinRating = Number(val) || 0;
            document.querySelectorAll('.rating-filter-btn').forEach((b) => {
                const on = Number(b.getAttribute('data-min-rating')) === filterMinRating;
                b.classList.toggle('border-purple-600', on);
                b.classList.toggle('bg-purple-50', on);
                b.classList.toggle('text-purple-700', on);
                b.classList.toggle('border-gray-200', !on);
                b.classList.toggle('text-gray-600', !on);
            });
        }
        /** تسلسل حالات الطلب من المتجر */
        const orderStatusFlow = [
            { key: 'pending_receipt', en: 'Receiving your order', ar: 'جاري استلام طلبك' },
            { key: 'in_progress', en: 'Picking your order', ar: 'جاري تجميع طلبك' },
            { key: 'fulfilled', en: 'Order assembled', ar: 'تم تجميع طلبك' },
            { key: 'shipping', en: 'Shipping', ar: 'جاري الشحن' },
            { key: 'delivered', en: 'Delivered to you', ar: 'تم تسليم الطلب للعميل' }
        ];
        const LEGACY_ORDER_STATUS = { pending: 'pending_receipt', processing: 'in_progress', shipped: 'shipping' };
        function normalizeOrderStatus(s) {
            if (!s) return s;
            return LEGACY_ORDER_STATUS[s] || s;
        }
        let latestOrderStatus = 'pending_receipt';
        let latestOrderId = '';
        /** رقم الطلب المعروض في نافذة المراجعة (من الخادم قبل الإرسال) */
        let checkoutPreviewOrderNo = '';
        let latestOrderDbId = null; // numeric DB id for tracking updates
        let latestOrderCreatedAt = null; // ISO string from backend
        let latestTrackingItems = []; // line items for current tracking view
        let latestTrackingOrder = null; // order row from last tracking fetch (totals, payment)
        let shouldPersistOrderStatusUpdates = false;
        let cachedWhatsAppPhone = null;
        let jwtToken = null;
        /** فارغ = نفس أصل الصفحة (يعمل مع node server على أي host/port) */
        let apiBaseUrl = '';

        /** أصل الـ API: window.ADORA_API_BASE (adora-config.js) ثم meta adora-api-base، وإلا نفس أصل الصفحة */
        function getApiOrigin() {
            const base = String(apiBaseUrl || '').trim();
            return base || window.location.origin;
        }
        let appSocket = null;
        let pendingOrderPayload = null;
        let pendingOrderSource = null;
        let statusTimeouts = [];
        /** رابط تنزيل التطبيق (APK أو App Store) — ضع رابطاً يبدأ بـ https:// */
        const ADORA_APP_DOWNLOAD_URL = '';
        const translationMap = {
            orderSent: 'تم إرسال الطلب إلى النظام',
            orderDetails: 'تفاصيل الطلب:',
            orderTotal: 'السعر الكلي:',
            shippingFree: 'التوصيل: مجاني',
            orderShipped: 'تم شحن الطلب',
            orderDelivered: 'تم التوصيل',
            estimatedDelivery: 'موعد التوصيل المتوقع خلال 3 أيام',
            paymentLabel: 'طريقة الدفع:',
            shippingLabel: 'عنوان الشحن:'
        };
        /** صورة احتياطية عندما لا تتوفر صورة للمنتج */
        function adoraPlaceholderImageUrl() {
            return 'icons/adora-icon.svg';
        }
        let flashSaleItems = [];
        const searchHistoryKey = 'adora_search_history';
        let searchHistory = [];
        const selectedFilters = new Set();
        let currentQuery = '';
        let brandSortKey = 'selling';
        let activeBrandKey = null;
        /** علامات تجارية من الخادم */
        let apiBrandsList = [];
        /** عند فتح منتجات شركة: اسم العلامة كما في المنتج وفي جدول brands */
        let listingBrandName = null;
        /** عند تصفح شركة: القسم الرئيسي Men / Women / Kids (أو null = كل الأقسام) */
        let listingBrandMainCategory = null;
        /** فلترة قائمة المنتجات حسب القسم/الفرعي (نفس القيم المحفوظة في المنتج وفي جدول categories) */
        let listingCategoryFilter = null;
        let listingSubcategoryFilter = null;
        /** نتائج آخر تحميل من الـ API — تُطبَّق عليها الفلاتر محلياً */
        let listingProductsRaw = [];
        /** بحث نصي يمرّ عبر ?q= على الخادم */
        let listingSearchQuery = '';
        /** أقسام رجالي/نسائي/أطفال من الرئيسية = منتجات أدورا فقط */
        let listingAdoraOnly = false;
        /** قسم البانر/القائمة المخصصة — يضيف new_collection=1 للـ API */
        let listingNewCollectionOnly = false;
        let currentProductDetail = null;
        let productDetailSelectedColorIndex = 0;
        let listingSearchDebounceTimer = null;
        let productDetailBackScreen = 'screen-categories';
        let siteRatingSelected = 0;
        let productReviewSelected = 0;
        let flashSaleRemaining = 1 * 60 * 60 + 45 * 60 + 20;
        let flashCountdownInterval = null;
        let trackingCycleIndex = 0;
        let marketplaceBrowsePreset = null;
        let marketplaceBrowseSectionsCache = [];
        let marketplaceBrowseVendorsCache = [];
        let marketplaceDetailQty = 1;
        let currentMarketplaceProductDetail = null;

        const ADORA_SESSION_STACK_KEY = 'adora_nav_stack_v1';
        const ADORA_SESSION_LISTING_KEY = 'adora_listing_ctx_v1';
        const ADORA_SESSION_PRODUCT_KEY = 'adora_last_product_id_v1';

        const ADORA_VALID_RESTORE_SCREENS = new Set([
            'screen-categories',
            'screen-listing',
            'screen-offers',
            'screen-wishlist',
            'screen-marketplace',
            'screen-marketplace-product',
            'screen-cart',
            'screen-checkout',
            'screen-profile',
            'screen-order-tracking',
            'screen-product',
        ]);

        function getValidScreenStack(arr) {
            if (!Array.isArray(arr)) return null;
            const filtered = arr.filter((s) => typeof s === 'string' && ADORA_VALID_RESTORE_SCREENS.has(s));
            return filtered.length ? filtered : null;
        }

        function loadListingCtxFromSession() {
            try {
                const raw = sessionStorage.getItem(ADORA_SESSION_LISTING_KEY);
                if (!raw) return;
                const o = JSON.parse(raw);
                if (!o || typeof o !== 'object') return;
                listingSearchQuery = o.listingSearchQuery != null ? String(o.listingSearchQuery) : '';
                listingBrandName = o.listingBrandName != null ? o.listingBrandName : null;
                listingBrandMainCategory = o.listingBrandMainCategory != null ? o.listingBrandMainCategory : null;
                activeBrandKey = o.activeBrandKey != null ? o.activeBrandKey : null;
                listingCategoryFilter = o.listingCategoryFilter != null ? o.listingCategoryFilter : null;
                listingSubcategoryFilter = o.listingSubcategoryFilter != null ? o.listingSubcategoryFilter : null;
                listingAdoraOnly = !!o.listingAdoraOnly;
                listingNewCollectionOnly = !!o.listingNewCollectionOnly;
            } catch (_e) {}
        }

        function persistListingCtxToSession() {
            try {
                sessionStorage.setItem(
                    ADORA_SESSION_LISTING_KEY,
                    JSON.stringify({
                        listingSearchQuery,
                        listingBrandName,
                        listingBrandMainCategory,
                        activeBrandKey,
                        listingCategoryFilter,
                        listingSubcategoryFilter,
                        listingAdoraOnly,
                        listingNewCollectionOnly,
                    })
                );
            } catch (_e) {}
        }

        function persistAdoraSessionState() {
            try {
                const stack = getValidScreenStack(adoraNavStack);
                if (stack) sessionStorage.setItem(ADORA_SESSION_STACK_KEY, JSON.stringify(stack));
                persistListingCtxToSession();
                if (currentScreen === 'screen-product') {
                    const id = currentProductDetail && currentProductDetail.id;
                    if (id) {
                        sessionStorage.setItem(ADORA_SESSION_PRODUCT_KEY, String(id));
                    } else {
                        const prev = sessionStorage.getItem(ADORA_SESSION_PRODUCT_KEY);
                        if (!prev) sessionStorage.removeItem(ADORA_SESSION_PRODUCT_KEY);
                    }
                } else {
                    sessionStorage.removeItem(ADORA_SESSION_PRODUCT_KEY);
                }
            } catch (_e) {}
        }

        function setActiveNavForScreen(screenId) {
            const keys = ['screen-categories', 'screen-listing', 'screen-offers', 'screen-cart', 'screen-profile'];
            if (!keys.includes(screenId)) return;
            document.querySelectorAll('.nav-item').forEach((item) => {
                item.classList.remove('active', 'text-purple-600');
                item.classList.add('text-gray-400');
            });
            const navBtn = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
            if (navBtn) {
                navBtn.classList.remove('text-gray-400');
                navBtn.classList.add('active', 'text-purple-600');
            }
        }

        function initAdoraNavigationHistory() {
            let restored = false;
            try {
                const raw = sessionStorage.getItem(ADORA_SESSION_STACK_KEY);
                if (raw) {
                    const parsed = getValidScreenStack(JSON.parse(raw));
                    if (parsed && parsed.length) {
                        adoraNavStack = parsed;
                        currentScreen = adoraNavStack[adoraNavStack.length - 1];
                        loadListingCtxFromSession();
                        restored = true;
                    }
                }
            } catch (_e) {}
            if (!restored) {
                const first = document.querySelector('.screen.active')?.id;
                if (first && String(first).startsWith('screen-')) {
                    currentScreen = first;
                    adoraNavStack = [first];
                } else {
                    adoraNavStack = [currentScreen || 'screen-categories'];
                }
            }
            try {
                const url = window.location.pathname + window.location.search + window.location.hash;
                history.replaceState({ adora: 0, bootstrap: true }, '', url);
                history.pushState(
                    { adora: 1, screen: adoraNavStack[adoraNavStack.length - 1] },
                    '',
                    url
                );
            } catch (_e) {}
            if (!adoraNavPopStateBound) {
                adoraNavPopStateBound = true;
                window.addEventListener('popstate', onAdoraPopState);
            }
        }

        function getExitConfirmTitle() {
            return isRTL ? 'الخروج من التطبيق؟' : 'Leave the app?';
        }

        function getExitConfirmSubtitle() {
            return isRTL
                ? 'سيتم مغادرة أدورا والعودة للصفحة السابقة.'
                : 'You will leave Adora and return to the previous page.';
        }

        function syncExitAppModalLabels() {
            const title = document.getElementById('exit-app-modal-title');
            const sub = document.getElementById('exit-app-modal-subtitle');
            const yesBtn = document.getElementById('exit-app-modal-yes');
            const noBtn = document.getElementById('exit-app-modal-no');
            const card = document.querySelector('#exit-app-modal .exit-app-modal-card');
            if (title) title.textContent = getExitConfirmTitle();
            if (sub) sub.textContent = getExitConfirmSubtitle();
            if (yesBtn) yesBtn.textContent = isRTL ? 'نعم، خروج' : 'Yes, leave';
            if (noBtn) noBtn.textContent = isRTL ? 'لا، البقاء' : 'No, stay';
            if (card) card.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
        }

        function showExitAppModal() {
            const modal = document.getElementById('exit-app-modal');
            if (!modal) return;
            syncExitAppModalLabels();
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeExitAppModal() {
            const modal = document.getElementById('exit-app-modal');
            if (modal) modal.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        function confirmExitAppYes() {
            closeExitAppModal();
            try {
                window.removeEventListener('popstate', onAdoraPopState);
            } catch (_e) {}
            adoraNavPopStateBound = false;
            setTimeout(() => {
                try {
                    history.go(-1);
                } catch (_e2) {}
            }, 0);
        }

        function confirmExitAppNo() {
            closeExitAppModal();
        }

        function resetListingFiltersAfterLeave() {
            listingBrandName = null;
            listingBrandMainCategory = null;
            activeBrandKey = null;
            listingCategoryFilter = null;
            listingSubcategoryFilter = null;
            listingAdoraOnly = false;
            listingNewCollectionOnly = false;
            renderBrandCards();
            const status = document.getElementById('brand-status');
            if (status) {
                status.textContent = isRTL ? status.getAttribute('data-ar') : status.getAttribute('data-en');
            }
        }

        function onAdoraPopState() {
            if (adoraNavStack.length <= 1) {
                try {
                    history.pushState({ adora: 1, screen: adoraNavStack[0] }, '');
                } catch (_e) {}
                showExitAppModal();
                return;
            }
            const leaving = adoraNavStack.pop();
            if (leaving === 'screen-listing') {
                resetListingFiltersAfterLeave();
            }
            const prev = adoraNavStack[adoraNavStack.length - 1];
            navigateTo(prev, { skipHistory: true });
        }

        // Navigation
        function navigateTo(screenId, opts = {}) {
            const rootTab = opts.rootTab === true;
            const skipHistory = opts.skipHistory === true;

            if (rootTab) {
                if (screenId === 'screen-categories') {
                    adoraNavStack = ['screen-categories'];
                } else {
                    adoraNavStack = ['screen-categories', screenId];
                }
                try {
                    const top = adoraNavStack[adoraNavStack.length - 1];
                    history.replaceState(
                        { adora: 1, screen: top },
                        '',
                        window.location.pathname + window.location.search + window.location.hash
                    );
                } catch (_e) {}
            } else if (!skipHistory) {
                const top = adoraNavStack[adoraNavStack.length - 1];
                if (top !== screenId) {
                    adoraNavStack.push(screenId);
                    try {
                        history.pushState({ adora: 1, screen: screenId }, '');
                    } catch (_e) {}
                }
            }

            /* إصلاح المكدس: قائمة منتجات بدون «الرئيسية» تحتها تُفسّر كرجوع مباشر للرئيسية */
            if (!skipHistory && !rootTab && screenId === 'screen-listing') {
                if (adoraNavStack.length === 1 && adoraNavStack[0] === 'screen-listing') {
                    adoraNavStack.unshift('screen-categories');
                }
            }

            document.querySelectorAll('.screen').forEach((screen) => {
                screen.classList.remove('active');
                setTimeout(() => {
                    if (!screen.classList.contains('active')) {
                        screen.style.display = 'none';
                    }
                }, 300);
            });

            const target = document.getElementById(screenId);
            if (!target) {
                console.warn('[navigateTo] Missing screen:', screenId);
                return;
            }
            target.style.display = 'block';
            setTimeout(() => target.classList.add('active'), 10);

            currentScreen = screenId;
            try {
                document.body.classList.toggle('adora-screen-listing-active', screenId === 'screen-listing');
            } catch (_e) {}
            window.scrollTo(0, 0);
            setActiveNavForScreen(screenId);
            if (typeof onScreenEnter === 'function') {
                onScreenEnter(screenId);
            }
            persistAdoraSessionState();
        }

        function switchTab(screenId, btn) {
            if (screenId === 'screen-listing') {
                listingBrandName = null;
                listingBrandMainCategory = null;
                activeBrandKey = null;
                listingCategoryFilter = null;
                listingSubcategoryFilter = null;
                listingNewCollectionOnly = false;
                renderBrandCards();
                const st = document.getElementById('brand-status');
                if (st) st.textContent = isRTL ? st.getAttribute('data-ar') : st.getAttribute('data-en');
            }
            navigateTo(screenId, { rootTab: true });
        }

        // ==================== AUTH + API HELPERS ====================
        function getStoredJwtToken() {
            return localStorage.getItem('adora_token');
        }

        function setStoredJwtToken(token) {
            localStorage.setItem('adora_token', token);
        }

        function clearStoredJwtToken() {
            localStorage.removeItem('adora_token');
        }

        async function apiFetch(pathname, { method = 'GET', body = null, requireAuth = true, isFormData = false, cache } = {}) {
            const token = requireAuth ? getStoredJwtToken() : null;
            const headers = {};
            if (requireAuth && token) headers['Authorization'] = `Bearer ${token}`;

            let fetchBody = undefined;
            if (body !== null && body !== undefined) {
                if (isFormData) {
                    fetchBody = body;
                } else {
                    headers['Content-Type'] = 'application/json';
                    fetchBody = JSON.stringify(body);
                }
            }

            const fetchOpts = {
                method,
                headers,
                body: fetchBody,
            };
            if (cache !== undefined) fetchOpts.cache = cache;
            const res = await fetch(`${getApiOrigin()}${pathname}`, fetchOpts);

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = data.error || `Request failed (${res.status})`;
                throw new Error(msg);
            }
            return data;
        }

        let _cachedServerAppDownloadUrl;

        async function resolveAppDownloadUrl() {
            try {
                const m = document.querySelector('meta[name="adora-app-download-url"]');
                const c = m && m.getAttribute('content');
                if (c && String(c).trim()) return String(c).trim();
            } catch (_e) {}
            const fromConst = String(typeof ADORA_APP_DOWNLOAD_URL !== 'undefined' ? ADORA_APP_DOWNLOAD_URL : '').trim();
            if (fromConst) return fromConst;
            if (_cachedServerAppDownloadUrl !== undefined) return _cachedServerAppDownloadUrl;
            try {
                const cfg = await apiFetch('/api/public-config', { requireAuth: false });
                _cachedServerAppDownloadUrl = String(cfg.app_download_url || '').trim();
                return _cachedServerAppDownloadUrl;
            } catch (_e) {
                _cachedServerAppDownloadUrl = '';
                return '';
            }
        }

        let adoraParticleModal = { start() {}, stop() {} };
        let adoraParticleGate = { start() {}, stop() {} };

        function initAdoraAuthParticles() {
            const cModal = document.getElementById('auth-modal-particles-canvas');
            const cGate = document.getElementById('auth-gate-particles-canvas');
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            adoraParticleModal = createAdoraHeartParticleLayer(cModal);
            adoraParticleGate = createAdoraHeartParticleLayer(cGate);
        }

        /** Canvas: قلب مجرد + تفاعل خفيف مع المؤشر — محسّن للموبايل */
        function createAdoraHeartParticleLayer(canvas) {
            if (!canvas) return { start() {}, stop() {} };
            const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
            let raf = 0;
            let running = false;
            let targets = [];
            let particles = [];
            let w = 0;
            let h = 0;
            let dpr = 1;
            const pointer = { x: 0.5, y: 0.45 };

            function buildHeartTargets(outlineN, innerN) {
                const pts = [];
                for (let i = 0; i < outlineN; i++) {
                    const t = (i / outlineN) * Math.PI * 2;
                    const x = 16 * Math.pow(Math.sin(t), 3);
                    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
                    pts.push({ x, y });
                }
                for (let i = 0; i < innerN; i++) {
                    const t = Math.random() * Math.PI * 2;
                    const r = Math.random() * 0.62;
                    const x = 16 * Math.pow(Math.sin(t), 3) * r;
                    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * r;
                    pts.push({ x, y });
                }
                return pts;
            }

            function resize() {
                const rect = canvas.getBoundingClientRect();
                if (rect.width < 2 || rect.height < 2) return;
                dpr = Math.min(window.devicePixelRatio || 1, 2);
                w = Math.floor(rect.width * dpr);
                h = Math.floor(rect.height * dpr);
                canvas.width = w;
                canvas.height = h;
                const mobile = window.matchMedia('(max-width: 480px)').matches;
                const count = mobile ? 48 : 84;
                targets = buildHeartTargets(100, 40);
                particles = [];
                for (let i = 0; i < count; i++) {
                    particles.push({
                        x: Math.random() * w,
                        y: Math.random() * h,
                        vx: 0,
                        vy: 0,
                        ti: (i * 11) % targets.length,
                        r: (0.55 + Math.random() * 1.05) * dpr,
                        ph: Math.random() * Math.PI * 2,
                    });
                }
            }

            let onMove = (e) => {
                pointer.x = e.clientX / Math.max(window.innerWidth, 1);
                pointer.y = e.clientY / Math.max(window.innerHeight, 1);
            };

            function tick() {
                if (!running) return;
                if (!w || !h) {
                    raf = requestAnimationFrame(tick);
                    return;
                }
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = 'rgba(8, 3, 22, 0.2)';
                ctx.fillRect(0, 0, w, h);

                const cx = w / 2;
                const cy = h * 0.48;
                const scale = Math.min(w, h) * 0.0155;
                const t = Date.now() * 0.00075;

                ctx.globalCompositeOperation = 'lighter';
                for (const p of particles) {
                    const tgt = targets[p.ti];
                    const tx = cx + tgt.x * scale + Math.sin(t + p.ph) * 2.5 * dpr;
                    const ty = cy + tgt.y * scale + Math.cos(t * 0.9 + p.ph) * 2.5 * dpr;

                    let ax = (tx - p.x) * 0.026;
                    let ay = (ty - p.y) * 0.026;

                    const mxx = pointer.x * w;
                    const myy = pointer.y * h;
                    const ddx = p.x - mxx;
                    const ddy = p.y - myy;
                    const dist2 = ddx * ddx + ddy * ddy + 3500;
                    ax += (ddx / dist2) * 15000 * dpr;
                    ay += (ddy / dist2) * 15000 * dpr;

                    p.vx = (p.vx + ax) * 0.935;
                    p.vy = (p.vy + ay) * 0.935;
                    p.x += p.vx;
                    p.y += p.vy;

                    const a = 0.32 + Math.sin(p.ph + t * 2) * 0.1;
                    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4.2);
                    grd.addColorStop(0, `rgba(255,255,255,${0.42 * a})`);
                    grd.addColorStop(0.35, `rgba(196,181,253,${0.32 * a})`);
                    grd.addColorStop(0.65, `rgba(124,58,237,${0.18 * a})`);
                    grd.addColorStop(1, 'rgba(49,21,96,0)');
                    ctx.fillStyle = grd;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
                    ctx.fill();
                }

                raf = requestAnimationFrame(tick);
            }

            return {
                start() {
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                    running = true;
                    resize();
                    window.addEventListener('resize', resize);
                    window.addEventListener('pointermove', onMove, { passive: true });
                    raf = requestAnimationFrame(tick);
                },
                stop() {
                    running = false;
                    cancelAnimationFrame(raf);
                    window.removeEventListener('resize', resize);
                    window.removeEventListener('pointermove', onMove);
                },
            };
        }

        function setAuthMode(mode) {
            const loginTab = document.getElementById('auth-tab-login');
            const signupTab = document.getElementById('auth-tab-signup');
            const formSignup = document.getElementById('auth-form-signup');
            const formLogin = document.getElementById('auth-form-login');

            if (!loginTab || !signupTab || !formSignup || !formLogin) return;

            const isLogin = mode === 'login';
            loginTab.classList.toggle('auth-tab--active', isLogin);
            signupTab.classList.toggle('auth-tab--active', !isLogin);

            formSignup.classList.toggle('hidden', isLogin);
            formLogin.classList.toggle('hidden', !isLogin);
        }

        function openAuthModal(mode = 'signup', message = '') {
            const modal = document.getElementById('auth-modal');
            const msgEl = document.getElementById('auth-message');
            if (!modal) return;
            adoraParticleGate.stop();
            modal.classList.remove('hidden', 'auth-modal--leaving');
            document.body.style.overflow = 'hidden';
            if (msgEl) {
                msgEl.textContent = message;
                msgEl.classList.toggle('hidden', !message);
            }
            setAuthMode(mode);
            adoraParticleModal.start();
        }

        function closeAuthModal() {
            const modal = document.getElementById('auth-modal');
            if (!modal) return;
            adoraParticleModal.stop();
            modal.classList.remove('auth-modal--leaving');
            modal.classList.add('hidden');
            restoreBodyScrollIfIdle();
            const gate = document.getElementById('auth-gate-screen');
            if (gate && !gate.classList.contains('hidden')) {
                adoraParticleGate.start();
            }
        }

        async function completeAuthTransitionToApp(nextFn) {
            const modal = document.getElementById('auth-modal');
            const gate = document.getElementById('auth-gate-screen');
            const shell = document.getElementById('app-shell');
            adoraParticleModal.stop();
            adoraParticleGate.stop();
            if (modal) {
                modal.classList.add('auth-modal--leaving');
                await new Promise((r) => setTimeout(r, 360));
                modal.classList.remove('auth-modal--leaving');
                modal.classList.add('hidden');
            }
            gate?.classList.add('hidden');
            if (shell) {
                shell.classList.remove('hidden');
                shell.classList.add('app-shell--entering');
                requestAnimationFrame(() => {
                    shell.classList.add('app-shell--visible');
                    setTimeout(() => {
                        shell.classList.remove('app-shell--entering', 'app-shell--visible');
                    }, 620);
                });
            }
            document.body.style.overflow = 'auto';
            restoreBodyScrollIfIdle();
            if (typeof nextFn === 'function') await nextFn();
        }

        async function handleLogin() {
            const phone = document.getElementById('auth-phone-login').value.trim();
            const password = document.getElementById('auth-password-login').value;
            try {
                const data = await apiFetch('/api/auth/login', {
                    method: 'POST',
                    requireAuth: false,
                    body: { phone, password },
                });
                setStoredJwtToken(data.token);
                await completeAuthTransitionToApp(async () => {
                    await refreshProfileAndOrders();
                    if (pendingOrderPayload) {
                        const payload = pendingOrderPayload;
                        pendingOrderPayload = null;
                        const source = pendingOrderSource;
                        pendingOrderSource = null;
                        const created = await sendOrderToSystem(payload, source);
                        if (source === 'whatsapp' && created) {
                            await openWhatsAppWithOrder(created);
                        }
                    }
                    await runPostAuthOnboarding();
                    consumeProductDeepLink();
                });
            } catch (e) {
                openAuthModal('login', isRTL ? `فشل تسجيل الدخول: ${e.message}` : `Login failed: ${e.message}`);
            }
        }

        async function handleSignup() {
            const name = document.getElementById('auth-name').value.trim();
            const phone = document.getElementById('auth-phone').value.trim();
            const password = document.getElementById('auth-password').value;
            let resumeOrder = null;
            if (pendingOrderPayload) {
                resumeOrder = { payload: pendingOrderPayload, source: pendingOrderSource };
                pendingOrderPayload = null;
                pendingOrderSource = null;
            }
            try {
                const data = await apiFetch('/api/auth/signup', {
                    method: 'POST',
                    requireAuth: false,
                    body: { name, phone, password },
                });
                setStoredJwtToken(data.token);
                setAuthMode('signup');
                await completeAuthTransitionToApp(async () => {
                    refreshSideMenuHeader().catch(() => {});
                    pendingAfterSignupCredentials = resumeOrder;
                    const pEl = document.getElementById('signup-cred-phone');
                    const pwEl = document.getElementById('signup-cred-password');
                    if (pEl) pEl.textContent = phone;
                    if (pwEl) pwEl.textContent = password;
                    document.getElementById('signup-credentials-modal')?.classList.remove('hidden');
                    document.body.style.overflow = 'hidden';
                });
            } catch (e) {
                if (resumeOrder) {
                    pendingOrderPayload = resumeOrder.payload;
                    pendingOrderSource = resumeOrder.source;
                }
                openAuthModal('signup', isRTL ? `فشل إنشاء الحساب: ${e.message}` : `Sign up failed: ${e.message}`);
            }
        }

        function disconnectAppSocket() {
            if (appSocket) {
                try {
                    appSocket.disconnect();
                } catch {
                    /* ignore */
                }
                appSocket = null;
            }
        }

        function connectAppSocket() {
            if (typeof io === 'undefined') return;
            const token = getStoredJwtToken();
            if (!token) return;
            if (appSocket && appSocket.connected) return;
            disconnectAppSocket();
            appSocket = io(getApiOrigin(), { auth: { token }, transports: ['websocket', 'polling'] });
            appSocket.on('notification:new', (payload) => {
                syncAppBroadcastBadge().catch(() => {});
                if (payload && payload.message) {
                    const toastLine =
                        payload.title && String(payload.title).trim()
                            ? `${String(payload.title).trim()}: ${payload.message}`
                            : payload.message;
                    showToast(toastLine);
                    void (async () => {
                        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
                        try {
                            const r = await fetch(`${getApiOrigin()}/api/push/vapid-public-key`, { credentials: 'omit' });
                            const j = await r.json().catch(() => ({}));
                            if (j && j.ok && j.publicKey) return;
                        } catch (_e) {
                            /* fall through to system notification */
                        }
                        showAdoraSystemNotification(payload);
                    })();
                }
            });
            appSocket.on('order:updated', (payload) => {
                if (payload && payload.status) {
                    latestOrderStatus = normalizeOrderStatus(payload.status);
                    if (payload.orderId && latestOrderDbId === payload.orderId) {
                        updateOrderTrackingUI();
                    }
                }
                refreshProfileAndOrders().catch(() => {});
            });
        }

        async function refreshProfileAndOrders() {
            const profileNameEl = document.getElementById('profile-user-name');
            const profilePhoneEl = document.getElementById('profile-user-phone');
            const ordersList = document.getElementById('profile-orders-list');
            const ordersSection = document.getElementById('profile-orders-section');
            const ordersEmpty = document.getElementById('profile-orders-empty');
            const ordersBadge = document.getElementById('profile-orders-count-badge');

            const token = getStoredJwtToken();
            if (!token) {
                disconnectAppSocket();
                if (profileNameEl) profileNameEl.textContent = isRTL ? 'زائر' : 'Guest';
                const avGuest = document.getElementById('profile-avatar-placeholder');
                if (avGuest) avGuest.textContent = isRTL ? '؟' : '?';
                if (profilePhoneEl) profilePhoneEl.textContent = '';
                const guestMember = document.getElementById('profile-member-since');
                if (guestMember) guestMember.textContent = '';
                const guestOrdersStat = document.getElementById('profile-orders-stat');
                if (guestOrdersStat) guestOrdersStat.textContent = '0';
                const guestReviewsStat = document.getElementById('profile-reviews-stat');
                if (guestReviewsStat) guestReviewsStat.textContent = '0';
                if (ordersSection) ordersSection.classList.add('hidden');
                document.getElementById('profile-messages-row')?.classList.add('hidden');
                refreshSideMenuHeader().catch(() => {});
                updateSiteRatingLoginHint();
                updateProfileWishlistUi();
                loadDeliveryAddressField();
                return;
            }

            if (ordersSection) ordersSection.classList.remove('hidden');

            const data = await apiFetch('/api/profile', { requireAuth: true });
            if (profileNameEl) profileNameEl.textContent = data.user.name || '';
            const avEl = document.getElementById('profile-avatar-placeholder');
            if (avEl) {
                const nm = String(data.user.name || '').trim();
                const ch = nm ? nm.charAt(0).toUpperCase() : isRTL ? '؟' : '?';
                avEl.textContent = ch;
            }
            if (profilePhoneEl) profilePhoneEl.textContent = data.user.phone || '';
            const memberEl = document.getElementById('profile-member-since');
            if (memberEl) {
                const ca = data.user?.created_at;
                memberEl.textContent =
                    ca && !Number.isNaN(new Date(ca).getTime())
                        ? isRTL
                            ? `عضو منذ ${formatOrderDate(ca)}`
                            : `Member since ${formatOrderDate(ca)}`
                        : '';
            }
            const orderCount = Array.isArray(data.orders) ? data.orders.length : 0;
            const ordersStatEl = document.getElementById('profile-orders-stat');
            if (ordersStatEl) ordersStatEl.textContent = String(orderCount);
            const rc = Number(data.stats?.review_count ?? 0);
            const reviewsStatEl = document.getElementById('profile-reviews-stat');
            if (reviewsStatEl) reviewsStatEl.textContent = String(Number.isFinite(rc) ? rc : 0);
            syncNotificationToggleUI(Number(data.user.notifications_enabled) === 1);
            if (Number(data.user.notifications_enabled) === 1) {
                registerAdoraPushSubscription().catch(() => {});
            }

            if (ordersList) {
                if (!data.orders || data.orders.length === 0) {
                    ordersList.innerHTML = '';
                    ordersList.classList.add('hidden');
                    if (ordersEmpty) ordersEmpty.classList.remove('hidden');
                    if (ordersBadge) ordersBadge.classList.add('hidden');
                } else {
                    if (ordersEmpty) ordersEmpty.classList.add('hidden');
                    const n = data.orders.length;
                    if (ordersBadge) {
                        ordersBadge.textContent = n > 99 ? '99+' : String(n);
                        ordersBadge.classList.remove('hidden');
                    }
                    ordersList.classList.remove('hidden');
                    ordersList.innerHTML = data.orders.map((o) => {
                        const label = getOrderStatusLabel(o.status);
                        return `<button type="button" onclick="openOrderTrackingFromId(${o.id})" class="w-full bg-gray-50 rounded-2xl p-3 border border-gray-100 hover:bg-gray-100 transition text-start">
                                  <div class="flex items-center justify-between gap-3">
                                      <div class="min-w-0">
                                          <div class="text-xs text-gray-500">${escapeHtml(o.order_no || '')}</div>
                                          <div class="text-sm font-bold text-gray-900">${label}</div>
                                      </div>
                                      <i class="fas fa-chevron-right text-gray-300 shrink-0 rtl:rotate-180"></i>
                                  </div>
                                </button>`;
                    }).join('');
                }
            }
            refreshSideMenuHeader().catch(() => {});
            syncAppBroadcastBadge().catch(() => {});
            connectAppSocket();
            updateSiteRatingLoginHint();
            updateProductReviewLoginHint();
            updateProfileWishlistUi();
            loadDeliveryAddressField();
        }

        function updateSiteRatingLoginHint() {
            const hint = document.getElementById('site-rating-login-hint');
            if (!hint) return;
            hint.classList.toggle('hidden', !!getStoredJwtToken());
        }

        function setSiteRatingStarCount(n) {
            siteRatingSelected = Math.min(5, Math.max(0, n));
            document.querySelectorAll('.site-rating-star').forEach((btn) => {
                const v = Number(btn.getAttribute('data-star'));
                const icon = btn.querySelector('i');
                if (!icon) return;
                const on = siteRatingSelected >= 1 && v <= siteRatingSelected;
                icon.className = on ? 'fas fa-star text-amber-400' : 'far fa-star text-gray-300';
            });
        }

        function initSiteRatingStars() {
            document.querySelectorAll('.site-rating-star').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const v = Number(btn.getAttribute('data-star'));
                    if (v >= 1 && v <= 5) setSiteRatingStarCount(v);
                });
            });
        }

        async function submitSiteRating() {
            if (!getStoredJwtToken()) {
                openAuthModal('login', isRTL ? 'سجّل الدخول لإرسال التقييم' : 'Log in to submit your rating');
                return;
            }
            if (siteRatingSelected < 1 || siteRatingSelected > 5) {
                showToast(isRTL ? 'اختر من نجمة إلى خمس نجوم' : 'Choose 1–5 stars');
                return;
            }
            const ta = document.getElementById('site-rating-comment');
            const comment = ta ? ta.value.trim() : '';
            try {
                await apiFetch('/api/site-ratings', {
                    method: 'POST',
                    requireAuth: true,
                    body: { stars: siteRatingSelected, comment: comment || undefined },
                });
                if (ta) ta.value = '';
                setSiteRatingStarCount(0);
                siteRatingSelected = 0;
                showToast(isRTL ? 'شكراً على تقييمك' : 'Thanks for your feedback');
            } catch (e) {
                showToast(e.message || (isRTL ? 'تعذر الإرسال' : 'Could not send'));
            }
        }

        function closeAppBroadcastsModal() {
            document.getElementById('app-broadcasts-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        const ADORA_NOTIFICATIONS_CACHE_KEY = 'adora_notifications_cache_v1';

        async function syncAppBroadcastBadge() {
            const badge = document.getElementById('app-broadcast-badge');
            const sideBadge = document.getElementById('side-menu-notif-badge');
            const row = document.getElementById('profile-messages-row');
            if (!getStoredJwtToken()) {
                if (row) row.classList.add('hidden');
                if (sideBadge) sideBadge.classList.add('hidden');
                return;
            }
            if (row) row.classList.remove('hidden');
            try {
                let unread = 0;
                try {
                    const cnt = await apiFetch('/api/notifications/unread-count', { requireAuth: true });
                    if (cnt && Number.isFinite(Number(cnt.unread))) {
                        unread = Number(cnt.unread);
                    } else {
                        throw new Error('no count');
                    }
                } catch {
                    const list = await apiFetch('/api/notifications', { requireAuth: true });
                    if (!Array.isArray(list)) return;
                    unread = list.filter((x) => !x.read).length;
                }
                const label = unread > 99 ? '99+' : String(unread);
                if (badge) {
                    badge.textContent = label;
                    badge.classList.toggle('hidden', unread === 0);
                }
                if (sideBadge) {
                    sideBadge.textContent = label;
                    sideBadge.classList.toggle('hidden', unread === 0);
                }
            } catch {
                if (badge) badge.classList.add('hidden');
                if (sideBadge) sideBadge.classList.add('hidden');
            }
        }

        async function openAppBroadcastsModal() {
            if (!getStoredJwtToken()) {
                openAuthModal('login', isRTL ? 'سجّل الدخول لعرض الرسائل' : 'Log in to view messages');
                return;
            }
            const modal = document.getElementById('app-broadcasts-modal');
            const body = document.getElementById('app-broadcasts-modal-body');
            if (!modal || !body) return;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            body.innerHTML = `<p class="text-center text-gray-500 py-6">${isRTL ? 'جاري التحميل...' : 'Loading...'}</p>`;
            try {
                let list = [];
                let offlineBanner = '';
                try {
                    list = await apiFetch('/api/notifications', { requireAuth: true });
                    if (Array.isArray(list)) {
                        try {
                            localStorage.setItem(ADORA_NOTIFICATIONS_CACHE_KEY, JSON.stringify({ list, at: Date.now() }));
                        } catch (_e) {
                            /* ignore */
                        }
                    }
                } catch (netErr) {
                    try {
                        const raw = localStorage.getItem(ADORA_NOTIFICATIONS_CACHE_KEY);
                        const parsed = raw ? JSON.parse(raw) : null;
                        if (parsed && Array.isArray(parsed.list) && parsed.list.length) {
                            list = parsed.list;
                            offlineBanner = `<p class="text-center text-amber-700 text-sm py-2">${isRTL ? 'تعذر التحديث — عرض آخر نسخة محفوظة.' : 'Offline — showing last saved list.'}</p>`;
                        } else throw netErr;
                    } catch {
                        throw netErr;
                    }
                }
                if (!Array.isArray(list) || list.length === 0) {
                    body.innerHTML = `<p class="text-center text-gray-500 py-8">${isRTL ? 'لا توجد رسائل بعد.' : 'No messages yet.'}</p>`;
                } else {
                    body.innerHTML =
                        offlineBanner +
                        list
                            .map((m) => {
                                const isInApp = m.kind === 'in_app';
                                let title;
                                if (isInApp) {
                                    const custom = m.title != null && String(m.title).trim();
                                    title = custom
                                        ? String(m.title).trim()
                                        : isRTL
                                          ? 'إشعار'
                                          : 'Notification';
                                } else {
                                    title = isRTL ? m.title_ar : m.title_en;
                                }
                                const text = isInApp ? (m.message || '') : isRTL ? (m.body_ar || '') : (m.body_en || '');
                                const dt = m.created_at
                                    ? new Date(m.created_at).toLocaleString(ADORA_NUMBER_LOCALE, {
                                          dateStyle: 'medium',
                                          timeStyle: 'short',
                                      })
                                    : '';
                                const unread = !m.read ? ' border-violet-200 bg-violet-50/50' : '';
                                const imgUrl =
                                    isInApp && m.image_url && /^https:\/\//i.test(String(m.image_url))
                                        ? String(m.image_url)
                                        : '';
                                let linkUrl = '';
                                let linkLabel = isRTL ? 'فتح الرابط' : 'Open link';
                                if (isInApp && m.link_url) {
                                    const lu = String(m.link_url).trim();
                                    if (lu.startsWith('/')) {
                                        linkUrl = lu;
                                        linkLabel = isRTL ? 'فتح في التطبيق' : 'Open in app';
                                    } else if (/^https:\/\//i.test(lu)) {
                                        linkUrl = lu;
                                    }
                                }
                                const extAttrs = linkUrl.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
                                const linkHtml = linkUrl
                                    ? `<p class="mt-2"><a href="${escapeHtml(linkUrl)}"${extAttrs} class="text-violet-600 text-sm font-semibold break-all">${escapeHtml(linkLabel)}</a></p>`
                                    : '';
                                return `<div class="rounded-2xl border border-gray-100 p-4${unread}">
          <div class="font-bold text-gray-900 mb-1">${escapeHtml(title)}</div>
          ${text ? `<p class="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(text)}</p>` : ''}
          ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="" class="w-full max-h-44 object-cover rounded-xl mt-2" loading="lazy">` : ''}
          ${linkHtml}
          <p class="text-[10px] text-gray-400 mt-2">${escapeHtml(dt)}</p>
        </div>`;
                            })
                            .join('');
                }
                const unreadRows = (Array.isArray(list) ? list : []).filter((x) => !x.read);
                await Promise.all(
                    unreadRows.map((m) => {
                        const kind = m.kind === 'in_app' ? 'in_app' : 'broadcast';
                        return apiFetch('/api/notifications/read', {
                            method: 'POST',
                            requireAuth: true,
                            body: { kind, id: m.id },
                        }).catch(() => {});
                    })
                );
                await syncAppBroadcastBadge();
            } catch (e) {
                body.innerHTML = `<p class="text-center text-red-500 py-8">${escapeHtml(e.message)}</p>`;
            }
        }

        function escapeHtml(s) {
            return String(s ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        }

        function formatOrderDate(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            try {
                return d.toLocaleDateString(ADORA_NUMBER_LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
            } catch {
                return d.toDateString();
            }
        }

        function formatPaymentMethodLabel(pm) {
            const k = String(pm || '').toLowerCase();
            if (k === 'cod') return isRTL ? 'الدفع عند الاستلام' : 'Cash on delivery';
            if (k === 'whatsapp' || k === 'wa') return isRTL ? 'طلب عبر واتساب' : 'WhatsApp order';
            if (k === 'card') return isRTL ? 'بطاقة' : 'Card';
            return String(pm || '').trim() || '—';
        }

        async function openOrderTrackingFromId(orderDbId) {
            const token = getStoredJwtToken();
            if (!token) {
                pendingOrderPayload = null;
                pendingOrderSource = null;
                openAuthModal('login', isRTL ? 'سجل الدخول لعرض الطلبات' : 'Log in to view orders');
                return;
            }
            latestOrderDbId = orderDbId;
            const tracking = await apiFetch(`/api/orders/${orderDbId}/tracking`, { requireAuth: true });
            if (tracking && tracking.history && tracking.history.length) {
                latestOrderStatus = normalizeOrderStatus(tracking.history[tracking.history.length - 1].status);
            } else if (tracking && tracking.order) {
                latestOrderStatus = normalizeOrderStatus(tracking.order.status);
            }
            latestOrderId = tracking.order?.order_no || latestOrderId;
            if (tracking.order?.created_at) latestOrderCreatedAt = tracking.order.created_at;
            latestTrackingOrder = tracking.order || null;
            latestTrackingItems = Array.isArray(tracking.items) ? tracking.items : [];
            updateOrderTrackingUI();
            navigateTo('screen-order-tracking');
        }

        async function openContactUsFromProfile() {
            try {
                const data = await apiFetch('/api/contact', { requireAuth: false });
                const phones = (data.phones || []).slice(0, 3).join(', ');
                const wa = data.whatsapp_phone || '';
                const message = isRTL
                    ? `موقعنا: ${data.address}\\nهاتف: ${phones}\\nواتساب: ${wa}`
                    : `Address: ${data.address}\\nPhone: ${phones}\\nWhatsApp: ${wa}`;
                showToast(message);
                if (wa) {
                    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(isRTL ? 'مرحباً! أود التواصل مع فريق أدورا.' : 'Hi! I would like to contact Adora team.')}`, '_blank');
                }
            } catch (e) {
                showToast(isRTL ? 'تعذر تحميل بيانات التواصل' : 'Failed to load contact info');
            }
        }

        // Triggered when entering key screens.
        function onScreenEnter(screenId) {
            if (screenId === 'screen-listing') {
                loadListingPageProducts();
            }
            if (screenId === 'screen-offers') {
                loadOffersPageProducts();
            }
            if (screenId === 'screen-wishlist') {
                loadWishlistPageProducts();
            }
            if (screenId === 'screen-profile') {
                refreshProfileAndOrders().catch(() => {});
            }
            if (screenId === 'screen-cart') {
                renderCartUI();
            }
            if (screenId === 'screen-categories') {
                syncSearchInputsFromQuery();
                loadHomeFeaturedGrid().catch(() => {});
                loadHomeNewCollectionGrid().catch(() => {});
                loadHomeBestsellers().catch(() => {});
                injectHomeBanners().catch(() => {});
                refreshAdoraHomeSubcategoryCounts().catch(() => {});
                loadMarketplaceHomeStrip().catch(() => {});
            }
            if (screenId === 'screen-marketplace') {
                initMarketplaceBrowseScreen().catch(() => {});
            }
            if (screenId === 'screen-marketplace-product' && currentMarketplaceProductDetail) {
                renderMarketplaceProductDetailUi();
            }
            if (screenId === 'screen-order-tracking') {
                if (latestOrderDbId) {
                    apiFetch(`/api/orders/${latestOrderDbId}/tracking`, { requireAuth: true })
                        .then((tracking) => {
                            if (tracking?.history?.length) {
                                latestOrderStatus = normalizeOrderStatus(tracking.history[tracking.history.length - 1].status);
                            } else if (tracking?.order?.status) {
                                latestOrderStatus = normalizeOrderStatus(tracking.order.status);
                            }
                            if (tracking?.order?.order_no) latestOrderId = tracking.order.order_no;
                            if (tracking?.order?.created_at) latestOrderCreatedAt = tracking.order.created_at;
                            latestTrackingOrder = tracking?.order || null;
                            latestTrackingItems = Array.isArray(tracking?.items) ? tracking.items : [];
                            updateOrderTrackingUI();
                        })
                        .catch(() => {});
                }
            }
        }

        // Language Toggle
        function applyAppLanguage() {
            const dir = isRTL ? 'rtl' : 'ltr';
            const lang = isRTL ? 'ar' : 'en';
            document.documentElement.setAttribute('dir', dir);
            document.documentElement.setAttribute('lang', lang);
            document.body.setAttribute('dir', dir);
            document.getElementById('lang-text').textContent = isRTL ? 'AR' : 'EN';
            
            document.querySelectorAll('[data-en]').forEach((el) => {
                const hasIconChild = el.querySelector && el.querySelector('i, svg, img');
                if (hasIconChild) return;
                const v = isRTL ? el.getAttribute('data-ar') : el.getAttribute('data-en');
                if (v !== null) el.textContent = v;
            });
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                const placeholder = isRTL ? searchInput.getAttribute('data-ar-placeholder') : searchInput.getAttribute('data-en-placeholder');
                if (placeholder) searchInput.setAttribute('placeholder', placeholder);
                else searchInput.setAttribute('placeholder', '');
                const ariaS = isRTL ? searchInput.getAttribute('data-ar-aria') : searchInput.getAttribute('data-en-aria');
                if (ariaS) searchInput.setAttribute('aria-label', ariaS);
            }
            restartSearchRotatingHintTimer();
            const listingSearchInput = document.getElementById('listing-search-input');
            if (listingSearchInput) {
                const lph = isRTL ? listingSearchInput.getAttribute('data-ar-placeholder') : listingSearchInput.getAttribute('data-en-placeholder');
                if (lph) listingSearchInput.setAttribute('placeholder', lph);
            }
            ['auth-name', 'auth-phone', 'auth-phone-login'].forEach((id) => {
                const el = document.getElementById(id);
                if (!el) return;
                const ph = isRTL ? el.getAttribute('data-ar-placeholder') : el.getAttribute('data-en-placeholder');
                if (ph) el.setAttribute('placeholder', ph);
            });
            const siteRatingTa = document.getElementById('site-rating-comment');
            if (siteRatingTa) {
                const ph = isRTL ? siteRatingTa.getAttribute('data-ar-ph') : siteRatingTa.getAttribute('data-en-ph');
                if (ph) siteRatingTa.setAttribute('placeholder', ph);
            }
            const productReviewTa = document.getElementById('product-review-comment');
            if (productReviewTa) {
                const ph = isRTL ? productReviewTa.getAttribute('data-ar-ph') : productReviewTa.getAttribute('data-en-ph');
                if (ph) productReviewTa.setAttribute('placeholder', ph);
            }
            const profileDeliveryTa = document.getElementById('profile-delivery-address');
            if (profileDeliveryTa) {
                const pdh = isRTL ? profileDeliveryTa.getAttribute('data-ar-ph') : profileDeliveryTa.getAttribute('data-en-ph');
                if (pdh) profileDeliveryTa.setAttribute('placeholder', pdh);
            }
            const mpSearch = document.getElementById('marketplace-search-input');
            if (mpSearch) {
                const mph = isRTL ? mpSearch.getAttribute('data-ar-ph') : mpSearch.getAttribute('data-en-ph');
                if (mph) mpSearch.setAttribute('placeholder', mph);
            }
            const mpMin = document.getElementById('marketplace-min-price');
            const mpMax = document.getElementById('marketplace-max-price');
            if (mpMin) {
                const h = isRTL ? mpMin.getAttribute('data-ar-ph') : mpMin.getAttribute('data-en-ph');
                if (h) mpMin.setAttribute('placeholder', h);
            }
            if (mpMax) {
                const h = isRTL ? mpMax.getAttribute('data-ar-ph') : mpMax.getAttribute('data-en-ph');
                if (h) mpMax.setAttribute('placeholder', h);
            }
            const searchVoiceBtn = document.getElementById('search-voice-btn');
            if (searchVoiceBtn) {
                searchVoiceBtn.setAttribute('aria-label', isRTL ? 'بحث صوتي' : 'Voice search');
            }
            const listingBackBtn = document.getElementById('listing-back-btn');
            if (listingBackBtn) {
                listingBackBtn.setAttribute('aria-label', isRTL ? 'رجوع' : 'Back');
            }
            if (typeof applySplashCtaLang === 'function') applySplashCtaLang();
            syncExitAppModalLabels();
            refreshSideMenuHeader().catch(() => {});
        }

        function toggleLanguage() {
            isRTL = !isRTL;
            localStorage.setItem('adora_rtl', isRTL ? '1' : '0');
            applyAppLanguage();
            updateOrderTrackingUI();
            renderBrandCards();
            renderTopBrands();
            updateBrandSortButtons();
            renderFlashSale();
            renderCheckoutSummary();
            if (currentScreen === 'screen-listing') {
                loadListingPageProducts().catch(() => {});
            }
            if (currentScreen === 'screen-categories') {
                refreshAdoraHomeSubcategoryCounts().catch(() => {});
            }
            if (currentScreen === 'screen-offers') {
                loadOffersPageProducts().catch(() => {});
            }
            if (currentScreen === 'screen-wishlist') {
                loadWishlistPageProducts().catch(() => {});
            }
            if (currentScreen === 'screen-marketplace') {
                initMarketplaceBrowseScreen().catch(() => {});
            }
            if (currentScreen === 'screen-marketplace-product' && currentMarketplaceProductDetail) {
                renderMarketplaceProductDetailUi();
            }
            if (currentScreen === 'screen-product' && currentProductDetail && currentProductDetail.id) {
                loadProductReviewsForDetail(currentProductDetail.id).catch(() => {});
            }
            updateProfileWishlistUi();
        }

        // Product Details Functions
        function updateQty(change) {
            currentQty += change;
            if (currentQty < 1) currentQty = 1;
            if (currentQty > 99) currentQty = 99;
            const qd = document.getElementById('qty-display');
            if (qd) qd.textContent = currentQty;
        }

        function selectSize(btn) {
            if (btn && btn.closest('#product-size-options')) selectProductDetailSize(btn);
        }

        function selectColor(btn, color) {
            if (btn && btn.closest('#product-color-options')) {
                const idx = btn.getAttribute('data-color-idx');
                if (idx != null && idx !== '') selectProductDetailColorIdx(Number(idx));
            } else if (color && document.getElementById('selected-color')) document.getElementById('selected-color').textContent = color;
        }

        function toggleAccordion(id) {
            const content = document.getElementById(`content-${id}`);
            const icon = document.getElementById(`icon-${id}`);
            content.classList.toggle('open');
            icon.style.transform = content.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0)';
        }

        function openSizeGuide() {
            showToast('Size guide opened');
        }

        const WISHLIST_STORAGE_KEY = 'adora_wishlist_ids';

        function loadWishlistIds() {
            try {
                const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
                const arr = JSON.parse(raw || '[]');
                if (!Array.isArray(arr)) return [];
                return [...new Set(arr.map((x) => Number(x)).filter((n) => n > 0 && Number.isFinite(n)))];
            } catch (_e) {
                return [];
            }
        }

        function saveWishlistIds(ids) {
            const uniq = [...new Set((ids || []).map((x) => Number(x)).filter((n) => n > 0 && Number.isFinite(n)))];
            try {
                localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(uniq));
            } catch (_e) {}
            updateProfileWishlistUi();
        }

        function isProductInWishlist(productId) {
            const id = Number(productId);
            if (!id) return false;
            return loadWishlistIds().includes(id);
        }

        function updateProfileWishlistUi() {
            const c = loadWishlistIds().length;
            const stat = document.getElementById('profile-wishlist-stat');
            const line = document.getElementById('profile-wishlist-count');
            if (stat) stat.textContent = String(c);
            if (line) {
                if (isRTL) {
                    line.textContent = c === 0 ? 'لا توجد منتجات' : c === 1 ? 'منتج واحد' : `${c} منتجات`;
                } else {
                    line.textContent = c === 0 ? 'No items yet' : c === 1 ? '1 item' : `${c} items`;
                }
            }
        }

        function updateWishlistButtonForProduct(productId) {
            const btn = document.getElementById('product-wishlist-btn');
            if (!btn) return;
            const on = isProductInWishlist(productId);
            btn.classList.toggle('active', on);
        }

        function toggleWishlist(btn) {
            const id = currentProductDetail && currentProductDetail.id ? Number(currentProductDetail.id) : null;
            if (!id) {
                showToast(isRTL ? 'افتح منتجاً أولاً' : 'Open a product first');
                return;
            }
            let ids = loadWishlistIds();
            const idx = ids.indexOf(id);
            if (idx >= 0) {
                ids.splice(idx, 1);
                btn.classList.remove('active');
                showToast(isRTL ? 'أُزيل من المفضلة' : 'Removed from wishlist');
            } else {
                ids.push(id);
                btn.classList.add('active');
                showToast(isRTL ? 'أُضيف إلى المفضلة' : 'Added to wishlist');
            }
            saveWishlistIds(ids);
            if (currentScreen === 'screen-wishlist') loadWishlistPageProducts().catch(() => {});
        }

        function openWishlistScreen() {
            productDetailBackScreen = 'screen-profile';
            navigateTo('screen-wishlist');
        }

        async function loadWishlistPageProducts() {
            const grid = document.getElementById('wishlist-products-grid');
            if (!grid) return;
            const ids = loadWishlistIds();
            if (!ids.length) {
                grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-12 text-sm leading-relaxed px-2">${
                    isRTL
                        ? 'المفضلة فارغة. اضغط القلب ❤ في صفحة أي منتج لإضافته.'
                        : 'Your wishlist is empty. Tap the heart on a product page to add items.'
                }</p>`;
                return;
            }
            grid.innerHTML = `<p class="col-span-2 text-center text-gray-400 py-10 text-sm">${isRTL ? 'جاري التحميل…' : 'Loading…'}</p>`;
            try {
                const results = await Promise.all(
                    ids.map((pid) => apiFetch(`/api/products/${pid}`, { requireAuth: false }).catch(() => null))
                );
                const products = results.filter(Boolean);
                const validIds = products.map((p) => p.id);
                const pruned = ids.filter((i) => validIds.includes(i));
                if (pruned.length !== ids.length) saveWishlistIds(pruned);
                if (!products.length) {
                    grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-12 text-sm">${
                        isRTL ? 'تعذر تحميل المنتجات.' : 'Could not load products.'
                    }</p>`;
                    return;
                }
                grid.innerHTML = products.map((p) => renderProductCardHtml(p, { compact: true })).join('');
            } catch (e) {
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-8 text-sm">${escapeHtml(e.message)}</p>`;
            }
        }

        /* ========== السوق الشامل ========== */
        function openMarketplaceBrowse(opts) {
            marketplaceBrowsePreset = opts && typeof opts === 'object' ? opts : {};
            navigateTo('screen-marketplace');
        }

        function backFromMarketplaceBrowse() {
            if (adoraNavStack.length > 1 && adoraNavStack[adoraNavStack.length - 1] === 'screen-marketplace') {
                adoraNavStack.pop();
                const prev = adoraNavStack[adoraNavStack.length - 1];
                navigateTo(prev, { skipHistory: true });
                try {
                    history.replaceState(
                        { adora: 1, screen: prev },
                        '',
                        window.location.pathname + window.location.search + window.location.hash
                    );
                } catch (_e) {}
                persistAdoraSessionState();
            } else {
                history.back();
            }
        }

        function backFromMarketplaceProduct() {
            if (adoraNavStack.length > 1 && adoraNavStack[adoraNavStack.length - 1] === 'screen-marketplace-product') {
                adoraNavStack.pop();
                navigateTo('screen-marketplace', { skipHistory: true });
                try {
                    history.replaceState(
                        { adora: 1, screen: 'screen-marketplace' },
                        '',
                        window.location.pathname + window.location.search + window.location.hash
                    );
                } catch (_e) {}
                persistAdoraSessionState();
            } else {
                history.back();
            }
        }

        function attachMarketplaceSearchListeners() {
            const inp = document.getElementById('marketplace-search-input');
            if (!inp || inp.dataset.adoraMpBound === '1') return;
            inp.dataset.adoraMpBound = '1';
            let t;
            inp.addEventListener('input', () => {
                clearTimeout(t);
                t = setTimeout(() => refreshMarketplaceProductList().catch(() => {}), 420);
            });
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    refreshMarketplaceProductList().catch(() => {});
                }
            });
        }

        async function ensureMarketplaceSectionsForFilters() {
            const sel = document.getElementById('marketplace-filter-section');
            if (!sel) return;
            const cur = sel.value;
            try {
                const rows = await apiFetch('/api/marketplace/sections', { requireAuth: false });
                marketplaceBrowseSectionsCache = Array.isArray(rows) ? rows : [];
                const loc = isRTL ? 'ar' : 'en';
                sel.innerHTML = '';
                const o0 = document.createElement('option');
                o0.value = '';
                o0.textContent = loc === 'ar' ? 'كل الأقسام' : 'All sections';
                sel.appendChild(o0);
                for (const s of marketplaceBrowseSectionsCache) {
                    const o = document.createElement('option');
                    o.value = String(s.id);
                    o.textContent = loc === 'ar' ? s.name_ar || s.name_en : s.name_en || s.name_ar;
                    sel.appendChild(o);
                }
                if (cur && [...sel.options].some((x) => x.value === cur)) sel.value = cur;
            } catch (_e) {}
        }

        async function populateMarketplaceVendorDropdown() {
            const sel = document.getElementById('marketplace-filter-vendor');
            const secSel = document.getElementById('marketplace-filter-section');
            if (!sel || !secSel) return;
            const sid = secSel.value;
            const cur = sel.value;
            sel.innerHTML = '';
            const o0 = document.createElement('option');
            o0.value = '';
            o0.textContent = isRTL ? 'كل الشركات/المولات' : 'All vendors';
            sel.appendChild(o0);
            const qs = sid ? `?section_id=${encodeURIComponent(sid)}` : '';
            try {
                const rows = await apiFetch(`/api/marketplace/vendors${qs}`, { requireAuth: false });
                marketplaceBrowseVendorsCache = Array.isArray(rows) ? rows : [];
                const loc = isRTL ? 'ar' : 'en';
                for (const v of marketplaceBrowseVendorsCache) {
                    const o = document.createElement('option');
                    o.value = String(v.id);
                    o.textContent = loc === 'ar' ? v.name_ar || v.name_en : v.name_en || v.name_ar;
                    sel.appendChild(o);
                }
                if (cur && [...sel.options].some((x) => x.value === cur)) sel.value = cur;
            } catch (_e) {}
        }

        function onMarketplaceSectionFilterChange() {
            const ven = document.getElementById('marketplace-filter-vendor');
            if (ven) ven.value = '';
            populateMarketplaceVendorDropdown().catch(() => {});
        }

        async function initMarketplaceBrowseScreen() {
            attachMarketplaceSearchListeners();
            const preset = marketplaceBrowsePreset;
            marketplaceBrowsePreset = null;
            await ensureMarketplaceSectionsForFilters();
            if (preset && preset.sectionId != null) {
                const el = document.getElementById('marketplace-filter-section');
                if (el) el.value = String(preset.sectionId);
            }
            if (preset && preset.q) {
                const si = document.getElementById('marketplace-search-input');
                if (si) si.value = String(preset.q);
            }
            await populateMarketplaceVendorDropdown();
            if (preset && preset.vendorId != null) {
                const el = document.getElementById('marketplace-filter-vendor');
                if (el) el.value = String(preset.vendorId);
            }
            syncMarketplaceSortSelectLabels();
            await refreshMarketplaceProductList();
        }

        function syncMarketplaceSortSelectLabels() {
            const sel = document.getElementById('marketplace-filter-sort');
            if (!sel) return;
            const loc = isRTL ? 'ar' : 'en';
            sel.querySelectorAll('option').forEach((opt) => {
                const t = loc === 'ar' ? opt.getAttribute('data-ar') : opt.getAttribute('data-en');
                if (t) opt.textContent = t;
            });
        }

        async function loadMarketplaceHomeStrip() {
            const host = document.getElementById('marketplace-home-strip');
            if (!host) return;
            try {
                const sections = await apiFetch('/api/marketplace/sections', { requireAuth: false });
                const list = Array.isArray(sections) ? sections : [];
                if (!list.length) {
                    host.innerHTML = `<p class="text-xs text-gray-400 py-4 whitespace-normal">${isRTL ? 'لا أقسام بعد — أضفها من لوحة التحكم.' : 'No sections yet — add them in admin.'}</p>`;
                    return;
                }
                const loc = isRTL ? 'ar' : 'en';
                host.innerHTML = list
                    .map((s) => {
                        const title = loc === 'ar' ? s.name_ar || s.name_en : s.name_en || s.name_ar;
                        const imgUrl = absoluteMediaUrl(s.card_image_url || '');
                        const imgHtml = imgUrl
                            ? `<img src="${escapeHtml(imgUrl)}" class="absolute inset-0 w-full h-full object-cover" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
                            : '';
                        return `<button type="button" onclick="openMarketplaceBrowse({ sectionId: ${Number(s.id)} })" class="flex-shrink-0 w-[42%] max-w-[11.5rem] rounded-2xl overflow-hidden border border-gray-100 shadow-md shadow-purple-900/5 relative min-h-[6.75rem] bg-gradient-to-br from-purple-100 to-violet-50 active:scale-[0.98] transition-transform text-start">
                            <span class="block relative h-28 w-full overflow-hidden bg-gray-100">${imgHtml}
                            <span class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent pointer-events-none" aria-hidden="true"></span></span>
                            <span class="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 text-white text-xs font-bold drop-shadow-sm pointer-events-none">
                                <i class="fas fa-store text-[10px] opacity-90" aria-hidden="true"></i>
                                <span class="truncate">${escapeHtml(title)}</span>
                            </span>
                        </button>`;
                    })
                    .join('');
            } catch (_e) {
                host.innerHTML = `<p class="text-xs text-red-500 py-4">${isRTL ? 'تعذر تحميل السوق الشامل.' : 'Could not load marketplace.'}</p>`;
            }
        }

        async function refreshMarketplaceProductList() {
            const grid = document.getElementById('marketplace-products-grid');
            if (!grid) return;
            const params = new URLSearchParams();
            const q = (document.getElementById('marketplace-search-input')?.value || '').trim();
            if (q) params.set('q', q);
            const sid = document.getElementById('marketplace-filter-section')?.value;
            if (sid) params.set('section_id', sid);
            const vid = document.getElementById('marketplace-filter-vendor')?.value;
            if (vid) params.set('vendor_id', vid);
            const sort = document.getElementById('marketplace-filter-sort')?.value || 'newest';
            params.set('sort', sort);
            const minP = document.getElementById('marketplace-min-price')?.value;
            const maxP = document.getElementById('marketplace-max-price')?.value;
            if (minP !== '' && minP != null && Number.isFinite(Number(minP))) params.set('min_price', String(Number(minP)));
            if (maxP !== '' && maxP != null && Number.isFinite(Number(maxP))) params.set('max_price', String(Number(maxP)));
            if (document.getElementById('marketplace-filter-offers')?.checked) params.set('is_offer', '1');
            grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-10 text-sm">${isRTL ? 'جاري التحميل…' : 'Loading…'}</p>`;
            try {
                const products = await apiFetch(`/api/marketplace/products?${params.toString()}`, { requireAuth: false });
                const arr = Array.isArray(products) ? products : [];
                if (!arr.length) {
                    grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-12 text-sm">${isRTL ? 'لا نتائج.' : 'No results.'}</p>`;
                    return;
                }
                const loc = isRTL ? 'ar' : 'en';
                grid.innerHTML = arr
                    .map((p) => {
                        const title = loc === 'ar' ? p.name_ar || p.name_en : p.name_en || p.name_ar;
                        const vendor = loc === 'ar' ? p.vendor_name_ar || p.vendor_name_en : p.vendor_name_en || p.vendor_name_ar;
                        const imgs = Array.isArray(p.images) ? p.images : [];
                        const img0 = imgs.length ? absoluteMediaUrl(imgs[0]) : adoraPlaceholderImageUrl();
                        const offer = Number(p.is_offer) === 1;
                        return `<div role="button" tabindex="0" onclick="openMarketplaceProductDetail(${Number(p.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMarketplaceProductDetail(${Number(p.id)});}" class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer active:scale-[0.99] transition-transform">
                            <div class="aspect-square bg-gray-100 relative">
                                <img src="${escapeHtml(img0)}" class="w-full h-full object-cover" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                                ${offer ? `<span class="absolute top-2 right-2 rtl:right-auto rtl:left-2 text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full">${isRTL ? 'عرض' : 'Offer'}</span>` : ''}
                            </div>
                            <div class="p-2.5 space-y-0.5">
                                <p class="text-xs font-bold text-gray-900 line-clamp-2 leading-snug">${escapeHtml(title)}</p>
                                <p class="text-[10px] text-purple-700 font-semibold truncate">${escapeHtml(vendor || '')}</p>
                                <p class="text-sm font-extrabold text-purple-600">${escapeHtml(formatSyp(Number(p.price || 0)))}</p>
                            </div>
                        </div>`;
                    })
                    .join('');
            } catch (e) {
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-10 text-sm">${escapeHtml(e.message || (isRTL ? 'تعذر التحميل' : 'Failed to load'))}</p>`;
            }
        }

        async function openMarketplaceProductDetail(id) {
            try {
                const p = await apiFetch(`/api/marketplace/products/${Number(id)}`, { requireAuth: false });
                currentMarketplaceProductDetail = p;
                marketplaceDetailQty = 1;
                renderMarketplaceProductDetailUi();
                navigateTo('screen-marketplace-product');
            } catch (_e) {
                showToast(isRTL ? 'تعذر فتح المنتج' : 'Could not open product');
            }
        }

        function renderMarketplaceProductDetailUi() {
            const p = currentMarketplaceProductDetail;
            if (!p) return;
            const loc = isRTL ? 'ar' : 'en';
            const title = loc === 'ar' ? p.name_ar || p.name_en : p.name_en || p.name_ar;
            const vendor = loc === 'ar' ? p.vendor_name_ar || p.vendor_name_en : p.vendor_name_en || p.vendor_name_ar;
            const sec = loc === 'ar' ? p.section_name_ar || p.section_name_en : p.section_name_en || p.section_name_ar;
            const desc = loc === 'ar' ? p.description_ar || p.description_en : p.description_en || p.description_ar;
            const tEl = document.getElementById('marketplace-detail-title');
            const vEl = document.getElementById('marketplace-detail-vendor');
            const sEl = document.getElementById('marketplace-detail-section');
            const priceEl = document.getElementById('marketplace-detail-price');
            const stEl = document.getElementById('marketplace-detail-stock');
            const dEl = document.getElementById('marketplace-detail-desc');
            const off = document.getElementById('marketplace-detail-offer-badge');
            if (tEl) tEl.textContent = title || '—';
            if (vEl) vEl.textContent = vendor || '—';
            if (sEl) sEl.textContent = sec || '';
            if (priceEl) priceEl.textContent = formatSyp(Number(p.price || 0));
            if (stEl) {
                const st = Number(p.stock != null ? p.stock : 0);
                stEl.textContent = st > 0 ? (isRTL ? `متوفر: ${st}` : `In stock: ${st}`) : isRTL ? 'غير متوفر' : 'Out of stock';
            }
            if (dEl) dEl.textContent = desc || (isRTL ? 'لا يوجد وصف.' : 'No description.');
            if (off) off.classList.toggle('hidden', Number(p.is_offer) !== 1);
            const gal = document.getElementById('marketplace-product-gallery');
            if (gal) {
                const imgs = Array.isArray(p.images) && p.images.length ? p.images.map((u) => absoluteMediaUrl(u)) : [adoraPlaceholderImageUrl()];
                gal.innerHTML = imgs
                    .map(
                        (src) =>
                            `<div class="snap-center w-full min-w-full h-full relative flex-shrink-0"><img src="${escapeHtml(src)}" class="w-full h-full object-cover" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer"></div>`
                    )
                    .join('');
            }
            const stockN = Number(p.stock != null ? p.stock : 0);
            if (stockN > 0) marketplaceDetailQty = Math.min(Math.max(1, marketplaceDetailQty), Math.min(99, stockN));
            else marketplaceDetailQty = 1;
            const qd = document.getElementById('marketplace-qty-display');
            if (qd) qd.textContent = String(marketplaceDetailQty);
        }

        function updateMarketplaceDetailQty(delta) {
            const p = currentMarketplaceProductDetail;
            marketplaceDetailQty += delta;
            if (marketplaceDetailQty < 1) marketplaceDetailQty = 1;
            if (marketplaceDetailQty > 99) marketplaceDetailQty = 99;
            if (p && Number(p.stock) > 0) marketplaceDetailQty = Math.min(marketplaceDetailQty, Number(p.stock));
            const qd = document.getElementById('marketplace-qty-display');
            if (qd) qd.textContent = String(marketplaceDetailQty);
        }

        function addMarketplaceProductToCart(opts = {}) {
            const silent = opts.silent === true;
            const p = currentMarketplaceProductDetail;
            if (!p || !p.id) {
                showToast(isRTL ? 'تعذر إضافة المنتج' : 'Cannot add to cart');
                return false;
            }
            const qty = Math.max(1, Math.min(99, Number(marketplaceDetailQty || 1)));
            const stock = Number(p.stock != null ? p.stock : 0);
            if (stock < qty) {
                showToast(isRTL ? 'الكمية غير متوفرة' : 'Not enough stock');
                return false;
            }
            const imgs = Array.isArray(p.images) ? p.images : [];
            const img0 = imgs.length ? absoluteMediaUrl(imgs[0]) : adoraPlaceholderImageUrl();
            const vendorLabel = isRTL ? p.vendor_name_ar || p.vendor_name_en || '' : p.vendor_name_en || p.vendor_name_ar || '';
            const line = {
                marketplaceProductId: p.id,
                name: { ar: p.name_ar, en: p.name_en },
                qty,
                unitPrice: Number(p.price || 0),
                price: Number(p.price || 0),
                discountPct: 0,
                image: img0,
                brand: vendorLabel,
                size: '',
                color: '',
                selected: true,
            };
            const key = getCartLineKey(line);
            const existing = cartItems.find((x) => getCartLineKey(x) === key);
            if (existing) {
                const nextQty = Math.min(99, Number(existing.qty || 1) + qty);
                if (nextQty > stock) {
                    showToast(isRTL ? 'الكمية غير متوفرة' : 'Not enough stock');
                    return false;
                }
                existing.qty = nextQty;
                existing.selected = true;
                existing.unitPrice = Number(p.price || 0);
                existing.price = Number(p.price || 0);
                if (img0) existing.image = img0;
                existing.name = { ar: p.name_ar, en: p.name_en };
                existing.brand = vendorLabel;
            } else {
                cartItems.push(line);
            }
            marketplaceDetailQty = 1;
            const qd = document.getElementById('marketplace-qty-display');
            if (qd) qd.textContent = '1';
            persistCart();
            if (!silent) showToast(isRTL ? 'أُضيف إلى السلة' : 'Added to cart');
            return true;
        }

        function buyMarketplaceNow() {
            if (!addMarketplaceProductToCart({ silent: true })) return;
            openOrderOptions();
        }

        // Cart Functions
        /** يُرجع true عند نجاح الإضافة — لاستخدام «اشتري الآن» قبل فتح الطلب */
        function addToCart(opts = {}) {
            const silent = opts.silent === true;
            const forceQtyOne = opts.forceQtyOne === true;
            if (!currentProductDetail || !currentProductDetail.id) {
                showToast(isRTL ? 'تعذر إضافة المنتج' : 'Cannot add to cart');
                return false;
            }
            const p = currentProductDetail;
            const size = getSelectedDetailSize();
            const color = getSelectedDetailColor();
            const qty = forceQtyOne
                ? 1
                : Math.max(1, Math.min(99, Number(currentQty || 1)));
            if (!variantHasStock(p, size === '—' ? '' : size, color)) {
                showToast(isRTL ? 'غير متوفر بهذا المقاس/اللون' : 'Not available for this size/color');
                return false;
            }
            const listUnit = Number(p.price || 0);
            const discPct = Number(p.discount || 0);
            const img0 = p.images && p.images.length ? p.images[0] : '';
            const brandVal = String(p.brand || '').trim();
            const line = {
                productId: p.id,
                id: p.id,
                name: { ar: p.name_ar, en: p.name_en },
                qty,
                unitPrice: listUnit,
                price: listUnit,
                discountPct: discPct,
                image: img0,
                brand: brandVal,
                size: size === '—' ? '' : size,
                color,
                selected: true,
            };
            const key = getCartLineKey(line);
            const existing = cartItems.find((x) => getCartLineKey(x) === key);
            if (existing) {
                if (forceQtyOne) {
                    existing.qty = 1;
                } else {
                    existing.qty = Math.min(99, Number(existing.qty || 1) + qty);
                }
                existing.selected = true;
                existing.unitPrice = listUnit;
                existing.price = listUnit;
                existing.discountPct = discPct;
                if (img0) existing.image = img0;
                existing.name = { ar: p.name_ar, en: p.name_en };
                existing.brand = brandVal;
            } else {
                cartItems.push(line);
            }
            currentQty = 1;
            const qd = document.getElementById('qty-display');
            if (qd) qd.textContent = '1';
            persistCart();
            if (!silent) showToast(isRTL ? 'أُضيف إلى السلة' : 'Added to cart');
            return true;
        }

        function buyNow() {
            if (!addToCart({ silent: true, forceQtyOne: true })) return;
            openOrderOptions();
        }

        function updateCartBadge() {
            const n = cartCount || 0;
            const b1 = document.getElementById('cart-count-badge');
            const b2 = document.getElementById('nav-cart-badge');
            if (b1) b1.textContent = n;
            if (b2) b2.textContent = n;
        }

        // Checkout
        function placeOrder() {
            openOrderOptions();
        }

        // Filter Modal
        function toggleFilterModal() {
            const modal = document.getElementById('filter-modal');
            modal.classList.toggle('hidden');
            if (!modal.classList.contains('hidden')) {
                document.body.style.overflow = 'hidden';
                populateFilterSubcategoryList();
                syncFilterPriceRangeFromProducts(listingProductsRaw);
            } else {
                restoreBodyScrollIfIdle();
            }
        }

        function updatePriceLabel(value) {
            const el = document.getElementById('price-label');
            if (el) el.textContent = formatSyp(value);
        }

        function syncFilterPriceRangeFromProducts(products) {
            const list = Array.isArray(products) ? products : [];
            let maxP = 500000;
            for (const p of list) {
                const n = productSaleUnitPrice(p);
                if (n > maxP) maxP = Math.ceil(n / 10000) * 10000;
            }
            const r = document.getElementById('filter-price-max');
            if (r) {
                const step = maxP > 200000 ? 5000 : 1000;
                const rounded = Math.max(step, Math.ceil(maxP / step) * step);
                r.setAttribute('max', String(rounded));
                r.value = String(rounded);
                updatePriceLabel(r.value);
            }
        }

        function populateFilterSubcategoryList() {
            const list = document.getElementById('filter-subcategory-list');
            if (!list) return;
            const subs = [
                ...new Set((Array.isArray(listingProductsRaw) ? listingProductsRaw : []).map((p) => String(p.subcategory || '').trim()).filter(Boolean)),
            ].sort();
            if (!subs.length) {
                list.innerHTML = `<p class="text-xs text-gray-400 py-2">${isRTL ? 'لا توجد أقسام فرعية في النتائج الحالية.' : 'No subcategories in current results.'}</p>`;
                return;
            }
            list.innerHTML = subs
                .map(
                    (sub) =>
                        `<label class="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition">
              <input type="checkbox" class="filter-subcategory-cb w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500" data-subcategory="${escapeHtml(sub)}" />
              <span class="text-gray-700 font-medium">${escapeHtml(sub)}</span>
            </label>`
                )
                .join('');
        }

        function toggleFilterChip(btn) {
            const on = btn.classList.contains('border-purple-600');
            if (on) {
                btn.classList.remove('border-purple-600', 'bg-purple-50', 'text-purple-600');
                btn.classList.add('border-gray-200', 'text-gray-600');
            } else {
                btn.classList.add('border-purple-600', 'bg-purple-50', 'text-purple-600');
                btn.classList.remove('border-gray-200', 'text-gray-600');
            }
        }

        function toggleColorFilter(btn) {
            if (!btn.classList.contains('filter-color-opt')) return;
            const was = btn.classList.contains('ring-2');
            document.querySelectorAll('.filter-color-opt').forEach((b) => {
                b.classList.remove('ring-2', 'ring-purple-600', 'ring-offset-2', 'border-purple-600');
                b.classList.add('border-gray-300');
            });
            if (!was) {
                btn.classList.add('ring-2', 'ring-purple-600', 'ring-offset-2', 'border-purple-600');
                btn.classList.remove('border-gray-300');
            }
        }

        function productColorMatchesKey(colors, key) {
            if (!key) return true;
            const arr = Array.isArray(colors) ? colors : [];
            const k = String(key).toLowerCase();
            const needles = {
                black: ['black', 'أسود', '#000'],
                white: ['white', 'أبيض', '#fff'],
                gray: ['gray', 'grey', 'رمادي'],
                blue: ['blue', 'أزرق'],
                red: ['red', 'أحمر'],
                beige: ['beige', 'بيج', 'c4a484', 'tan'],
                green: ['green', 'أخضر'],
            };
            const n = needles[k] || [k];
            return arr.some((c) => {
                const s = String(c).toLowerCase();
                return n.some((x) => s.includes(x.toLowerCase()));
            });
        }

        function applyClientSideListingFilters(products) {
            const list = Array.isArray(products) ? products.slice() : [];
            const maxEl = document.getElementById('filter-price-max');
            const maxP = maxEl ? Number(maxEl.value) : 2000;
            const selectedSizes = [...document.querySelectorAll('.size-filter.border-purple-600')].map((b) =>
                (b.getAttribute('data-size') || b.textContent || '').trim()
            ).filter(Boolean);
            const colorBtn = document.querySelector('.filter-color-opt.ring-2');
            const colorKey = colorBtn ? colorBtn.getAttribute('data-color') || '' : '';
            const subCats = [...document.querySelectorAll('.filter-subcategory-cb:checked')]
                .map((cb) => (cb.getAttribute('data-subcategory') || '').trim())
                .filter(Boolean);

            return list.filter((p) => {
                const effective = productSaleUnitPrice(p);
                if (effective > maxP) return false;
                const minR = Number(filterMinRating || 0);
                if (minR > 0) {
                    const avg = p.review_avg != null ? Number(p.review_avg) : null;
                    if (avg == null || Number.isNaN(avg) || avg < minR) return false;
                }
                if (selectedSizes.length) {
                    const sz = Array.isArray(p.sizes) ? p.sizes : [];
                    const ok = sz.some((s) =>
                        selectedSizes.some((sel) => String(s).trim().toLowerCase() === String(sel).trim().toLowerCase())
                    );
                    if (!ok) return false;
                }
                if (colorKey && !productColorMatchesKey(p.colors, colorKey)) return false;
                if (subCats.length) {
                    const sub = String(p.subcategory || '').trim();
                    if (!subCats.includes(sub)) return false;
                }
                return true;
            });
        }

        function renderListingProductGrid(products) {
            const grid = document.getElementById('listing-products-grid');
            if (!grid) return;
            if (!Array.isArray(products) || products.length === 0) {
                grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-8 text-sm leading-relaxed px-2">${
                    isRTL ? 'لا توجد منتجات تطابق الفلاتر. جرّب توسيع نطاق السعر أو إلغاء بعض الخيارات.' : 'No products match these filters. Try a wider price range or fewer filters.'
                }</p>`;
                return;
            }
            grid.innerHTML = products.map((p) => renderProductCardHtml(p, { compact: true })).join('');
        }

        function resetFilters() {
            const r = document.getElementById('filter-price-max');
            if (r) {
                r.value = r.getAttribute('max') || '500000';
                updatePriceLabel(r.value);
            }
            setFilterMinRating(0, document.querySelector('.rating-filter-btn[data-min-rating="0"]'));
            document.querySelectorAll('.size-filter').forEach((b) => {
                b.classList.remove('border-purple-600', 'bg-purple-50', 'text-purple-600');
                b.classList.add('border-gray-200', 'text-gray-600');
            });
            document.querySelectorAll('.filter-color-opt').forEach((b) => {
                b.classList.remove('ring-2', 'ring-purple-600', 'ring-offset-2', 'border-purple-600');
                b.classList.add('border-gray-300');
            });
            document.querySelectorAll('.filter-subcategory-cb').forEach((cb) => {
                cb.checked = false;
            });
            renderListingProductGrid(listingProductsRaw);
            showToast(isRTL ? 'تمت إعادة ضبط الفلاتر' : 'Filters reset');
        }

        function applyFilters() {
            toggleFilterModal();
            const filtered = applyClientSideListingFilters(listingProductsRaw);
            renderListingProductGrid(filtered);
            showToast(isRTL ? 'تم تطبيق الفلاتر' : 'Filters applied');
        }

        async function refreshCheckoutOrderPreviewNo() {
            checkoutPreviewOrderNo = '';
            const token = getStoredJwtToken();
            if (!token) return;
            try {
                const data = await apiFetch('/api/orders/next-order-no', { requireAuth: true });
                if (data && data.order_no) checkoutPreviewOrderNo = String(data.order_no);
            } catch (_e) {}
        }

        function openOrderOptions() {
            const modal = document.getElementById('order-options-modal');
            if (!modal) return;
            renderCheckoutSummary();
            refreshCheckoutOrderPreviewNo().finally(() => renderCheckoutSummary());
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeOrderOptions() {
            const modal = document.getElementById('order-options-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        function selectPaymentMethod(method) {
            selectedPaymentMethod = method;
            updatePaymentSelection();
        }

        function updatePaymentSelection() {
            document.querySelectorAll('[data-payment]').forEach(btn => {
                const key = btn.getAttribute('data-payment');
                btn.classList.toggle('selected', key === selectedPaymentMethod);
            });
        }

        function renderCheckoutSummary() {
            const itemsContainer = document.getElementById('checkout-items');
            const locale = isRTL ? 'ar' : 'en';
            const sel = getSelectedCartItems();
            const totals = computeTotalsForCartLines(sel);
            if (itemsContainer) {
                itemsContainer.innerHTML = sel
                    .map((item) => {
                        const name = locale === 'ar' ? item.name.ar : item.name.en;
                        const listUnit = Number(item.unitPrice != null ? item.unitPrice : item.price || 0);
                        const discPct = Number(item.discountPct || 0);
                        const saleUnit = saleUnitFromListAndDiscount(listUnit, discPct);
                        const qty = Number(item.qty || 1);
                        const line = saleUnit * qty;
                        const br = resolveDisplayBrand(item.brand);
                        const meta = [item.size, item.color].filter(Boolean).join(' · ');
                        const oldLine =
                            discPct > 0 ? `<span class="text-[10px] text-gray-400 line-through ms-1">${formatSyp(listUnit * qty)}</span>` : '';
                        return `<div class="checkout-item">
                                <div class="flex justify-between items-start gap-2">
                                    <div>
                                        <h4>${escapeHtml(name)}</h4>
                                        <p class="text-[10px] text-violet-700 font-semibold mt-0.5">${escapeHtml(br)}</p>
                                        ${meta ? `<p class="text-[10px] text-gray-500">${escapeHtml(meta)}</p>` : ''}
                                    </div>
                                    <span class="text-[10px] text-gray-500 shrink-0">${item.qty} × ${formatSyp(saleUnit)}</span>
                                </div>
                                <span class="text-right text-[11px] text-gray-400">${locale === 'ar' ? 'المجموع' : 'Subtotal'}: ${formatSyp(line)}${oldLine}</span>
                            </div>`;
                    })
                    .join('');
            }
            const beforeRow = document.getElementById('checkout-before-discount-row');
            const beforeEl = document.getElementById('checkout-subtotal-before');
            const discRow = document.getElementById('checkout-discount-row');
            const discAmt = document.getElementById('checkout-discount-amount');
            const showDisc = totals.discount > 0;
            if (beforeRow) beforeRow.style.display = showDisc ? 'flex' : 'none';
            if (discRow) discRow.style.display = showDisc ? 'flex' : 'none';
            if (showDisc) {
                if (beforeEl) beforeEl.textContent = formatSyp(totals.subtotal + totals.discount);
                if (discAmt) discAmt.textContent = `−${formatSyp(totals.discount)}`;
            }
            const totalEl = document.getElementById('checkout-total');
            if (totalEl) {
                totalEl.textContent = formatSyp(totals.subtotal);
            }
            const orderIdEl = document.getElementById('checkout-order-id');
            if (orderIdEl) {
                if (checkoutPreviewOrderNo) {
                    orderIdEl.textContent = `#${checkoutPreviewOrderNo}`;
                } else if (getStoredJwtToken()) {
                    orderIdEl.textContent = isRTL ? 'جاري التحميل…' : 'Loading…';
                } else {
                    orderIdEl.textContent = isRTL ? 'بعد تسجيل الدخول' : 'Sign in to get order #';
                }
            }
            const shippingEl = document.getElementById('checkout-shipping-address');
            const ship = getShippingAddress();
            if (shippingEl) shippingEl.textContent = locale === 'ar' ? ship.ar : ship.en;
            const shippingLabelEl = document.getElementById('checkout-shipping-label');
            if (shippingLabelEl) shippingLabelEl.textContent = locale === 'ar' ? translationMap.shippingLabel : 'Shipping:';
            updatePaymentSelection();
        }

        async function handleCheckoutOption(option) {
            closeOrderOptions();
            await refreshCheckoutOrderPreviewNo();
            const order = buildOrderSummary();
            const created = await sendOrderToSystem(order, option);
            if (option === 'whatsapp' && created) {
                await openWhatsAppWithOrder(created);
            }
        }

        function buildOrderSummary() {
            const id = checkoutPreviewOrderNo || '';
            const items = getSelectedCartItems();
            const totals = computeTotalsForCartLines(items);
            return {
                id,
                items,
                totals,
                shippingAddress: getShippingAddress(),
                paymentMethod: selectedPaymentMethod
            };
        }

        async function sendOrderToSystem(order, optionSource) {
            // optionSource is 'whatsapp' or 'system' from the UI.
            const token = getStoredJwtToken();
            const source = optionSource === 'whatsapp' ? 'whatsapp' : 'system';

            if (!order.items || order.items.length === 0) {
                showToast(
                    isRTL
                        ? 'حدد منتجات للطلب (مربع الاختيار) أو استخدم «تحديد الكل»'
                        : 'Select items to checkout (checkbox) or use Select all'
                );
                return null;
            }

            if (!token) {
                pendingOrderPayload = order;
                pendingOrderSource = optionSource;
                openAuthModal(optionSource === 'whatsapp' ? 'login' : 'signup', isRTL ? 'سجّل الدخول لإتمام الطلب' : 'Log in to complete checkout');
                return null;
            }

            try {
                // Persist the order in DB first, then update statuses with simulation.
                shouldPersistOrderStatusUpdates = true;
                pendingOrderPayload = null;
                pendingOrderSource = null;

                // Backend stores product_id optionally, but we always store name/qty/price.
                const apiProducts = (order.items || []).map((item) => {
                    const listUnit = Number(item.unitPrice != null ? item.unitPrice : item.price ?? 0);
                    const discPct = Number(item.discountPct || 0);
                    const saleUnit = saleUnitFromListAndDiscount(listUnit, discPct);
                    const mpidRaw = item.marketplaceProductId != null ? Number(item.marketplaceProductId) : null;
                    const mpid = Number.isFinite(mpidRaw) && mpidRaw > 0 ? mpidRaw : null;
                    const pidRaw = item.productId ?? item.id ?? null;
                    const pid = mpid ? null : pidRaw != null && Number.isFinite(Number(pidRaw)) ? Number(pidRaw) : null;
                    return {
                        product_id: pid,
                        marketplace_product_id: mpid,
                        product_name: isRTL ? item.name.ar : item.name.en,
                        qty: item.qty ?? 1,
                        price: saleUnit,
                        image_url: item.image || item.imageUrl || item.thumb || '',
                        color: item.color || item.selectedColor || '',
                        size: item.size || item.selectedSize || '',
                        brand: String(item.brand || '').trim(),
                    };
                });

                const shipLine = getSavedDeliveryAddressText() || (isRTL ? order.shippingAddress?.ar : order.shippingAddress?.en) || '';
                const created = await apiFetch('/api/orders', {
                    method: 'POST',
                    requireAuth: true,
                    body: {
                        products: apiProducts,
                        total_price: order.totals?.total ?? 0,
                        payment_method: order.paymentMethod,
                        source,
                        shipping_address: shipLine.slice(0, 2000),
                    },
                });

                const o = created.order || created;
                latestOrderDbId = o.id;
                latestOrderId = o.order_no || order.id;
                latestOrderStatus = normalizeOrderStatus(o.status || 'pending_receipt');
                latestOrderCreatedAt = o.created_at || null;
                latestTrackingOrder = o;
                latestTrackingItems = Array.isArray(created.items) ? created.items : [];
                order.id = latestOrderId;
                updateOrderTrackingUI();

                cartItems = cartItems.filter((it) => it.selected === false);
                persistCart();

                showToast(isRTL ? translationMap.orderSent : 'Order submitted to system');
                setTimeout(() => navigateTo('screen-profile', { rootTab: true }), 1000);
                return order;
            } catch (e) {
                shouldPersistOrderStatusUpdates = false;
                latestOrderId = order.id;
                latestOrderDbId = null;
                latestOrderStatus = 'processing';
                updateOrderTrackingUI();
                showToast(isRTL ? `فشل إرسال الطلب: ${e.message}` : `Failed to submit order: ${e.message}`);
                setTimeout(() => navigateTo('screen-profile', { rootTab: true }), 1000);
                return order;
            }
        }

        function whatsAppDigitsOnly(phone) {
            return String(phone || '').replace(/\D/g, '');
        }

        async function openWhatsAppWithOrder(order) {
            let customerName = '';
            let customerPhone = '';
            try {
                const bundle = await apiFetch('/api/profile', { requireAuth: true });
                customerName = bundle?.user?.name ? String(bundle.user.name) : '';
                customerPhone = bundle?.user?.phone ? String(bundle.user.phone) : '';
            } catch (_e) {}
            const savedAddr = getSavedDeliveryAddressText();
            const shipAr = order.shippingAddress?.ar ?? getShippingAddress().ar;
            const shipEn = order.shippingAddress?.en ?? getShippingAddress().en;
            const enriched = {
                ...order,
                customerName,
                customerPhone,
                deliveryAddressAr: savedAddr || shipAr,
                deliveryAddressEn: savedAddr || shipEn,
            };
            const message = formatOrderMessage(enriched, isRTL ? 'ar' : 'en');
            try {
                if (!cachedWhatsAppPhone) {
                    const data = await apiFetch('/api/contact', { requireAuth: false });
                    cachedWhatsAppPhone = data?.whatsapp_phone || '';
                }
                const digits = whatsAppDigitsOnly(cachedWhatsAppPhone);
                if (digits.length < 8) {
                    showToast(isRTL ? 'رقم واتساب المتجر غير متاح حالياً' : 'Store WhatsApp number is not available');
                    return;
                }
                window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
            } catch (_e) {
                showToast(isRTL ? 'تعذر فتح واتساب' : 'Could not open WhatsApp');
            }
        }

        /** روابط الصور من Cloudinary (https فقط). مسارات /uploads/ أو اسم ملف قديم بدون رابط كامل → صورة احتياطية */
        function absoluteMediaUrl(u) {
            const s = String(u || '').trim();
            if (!s) return '';
            if (s.startsWith('http://') || s.startsWith('https://')) return s;
            const tail = s.replace(/^\/+/, '');
            if (tail.toLowerCase().startsWith('uploads/')) {
                return adoraPlaceholderImageUrl();
            }
            const origin = getApiOrigin();
            if (s.startsWith('/')) return origin + s;
            if (s.includes('/')) return `${origin}/${tail}`;
            return adoraPlaceholderImageUrl();
        }

        const DEFAULT_HOME_SECTIONS_VISIBILITY = {
            banners: true,
            comprehensive_market: true,
            main_categories: true,
            brands: true,
            top_brands: true,
            flash_sale: true,
            curated: true,
            promo_collection: true,
            bestsellers: true,
        };

        function mergeHomeSectionsVisibility(raw) {
            const o = raw && typeof raw === 'object' ? raw : {};
            const out = { ...DEFAULT_HOME_SECTIONS_VISIBILITY };
            for (const k of Object.keys(out)) {
                if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = Boolean(o[k]);
            }
            return out;
        }

        function applyHomeSectionsVisibility(raw) {
            const v = mergeHomeSectionsVisibility(raw);
            Object.keys(DEFAULT_HOME_SECTIONS_VISIBILITY).forEach((key) => {
                const on = v[key] !== false;
                document.querySelectorAll(`[data-adora-section="${key}"]`).forEach((el) => {
                    el.classList.toggle('hidden', !on);
                });
            });
        }

        function getDefaultHomeSubcatSlides() {
            const q = 'w=800&q=85&auto=format&fit=crop';
            return {
                Men: {
                    'T-Shirts': [
                        `https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?${q}`,
                        `https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?${q}`,
                        `https://images.unsplash.com/photo-1576566588028-4147f3842f27?${q}`,
                    ],
                    Pants: [
                        `https://images.unsplash.com/photo-1542272604-787c3835535d?${q}`,
                        `https://images.unsplash.com/photo-1473966968600-fa8013becd27?${q}`,
                        `https://images.unsplash.com/photo-1506629905607-2b256d2019d?${q}`,
                    ],
                    Shoes: [
                        `https://images.unsplash.com/photo-1549298916-b41d501d3772?${q}`,
                        `https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?${q}`,
                        `https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?${q}`,
                    ],
                    Shirts: [
                        `https://images.unsplash.com/photo-1594938298603-c8148c4dae35?${q}`,
                        `https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?${q}`,
                        `https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?${q}`,
                    ],
                    Jackets: [
                        `https://images.unsplash.com/photo-1551028719-00167b16eac5?${q}`,
                        `https://images.unsplash.com/photo-1591047139829-d91aecb6caea?${q}`,
                        `https://images.unsplash.com/photo-1544022613-e87ca75a784a?${q}`,
                    ],
                    Accessories: [
                        `https://images.unsplash.com/photo-1524592094714-0f0654e20314?${q}`,
                        `https://images.unsplash.com/photo-1611591437281-460bfbe1220a?${q}`,
                        `https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?${q}`,
                    ],
                    Perfumes: [
                        `https://images.unsplash.com/photo-1541643600914-78b084683601?${q}`,
                        `https://images.unsplash.com/photo-1595425970377-c970029bf94e?${q}`,
                        `https://images.unsplash.com/photo-1587017539504-67cfbddac569?${q}`,
                    ],
                },
                Women: {
                    'T-Shirts': [
                        `https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?${q}`,
                        `https://images.unsplash.com/photo-1618354691373-d851c5c3a990?${q}`,
                        `https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?${q}`,
                    ],
                    Dresses: [
                        `https://images.unsplash.com/photo-1595777457583-95e059d581b8?${q}`,
                        `https://images.unsplash.com/photo-1496747611176-843222e1e57c?${q}`,
                        `https://images.unsplash.com/photo-1515372039744-b8f02a815ac0?${q}`,
                    ],
                    Tops: [
                        `https://images.unsplash.com/photo-1524504388940-b1c1722653e1?${q}`,
                        `https://images.unsplash.com/photo-1434389677669-e08b4cac3105?${q}`,
                        `https://images.unsplash.com/photo-1585487000160-6ebcfceb0d03?${q}`,
                    ],
                    Pants: [
                        `https://images.unsplash.com/photo-1506629082955-511b1aa562c8?${q}`,
                        `https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?${q}`,
                        `https://images.unsplash.com/photo-1509631179647-0177331693ae?${q}`,
                    ],
                    Jackets: [
                        `https://images.unsplash.com/photo-1539533018447-63fcce2678e3?${q}`,
                        `https://images.unsplash.com/photo-1591047139829-d91aecb6caea?${q}`,
                        `https://images.unsplash.com/photo-1434389677669-e08b4cac3105?${q}`,
                    ],
                    Accessories: [
                        `https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?${q}`,
                        `https://images.unsplash.com/photo-1611591437281-460bfbe1220a?${q}`,
                        `https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?${q}`,
                    ],
                    Bags: [
                        `https://images.unsplash.com/photo-1584917865442-de89df76afd3?${q}`,
                        `https://images.unsplash.com/photo-1590874103328-eac38a683ce7?${q}`,
                        `https://images.unsplash.com/photo-1594223274512-ad4803739b7c?${q}`,
                    ],
                    Perfumes: [
                        `https://images.unsplash.com/photo-1541643600914-78b084683601?${q}`,
                        `https://images.unsplash.com/photo-1595425970377-c970029bf94e?${q}`,
                        `https://images.unsplash.com/photo-1594035910387-fea47794261f?${q}`,
                    ],
                },
                Kids: {
                    'T-Shirts': [
                        `https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?${q}`,
                        `https://images.unsplash.com/photo-1503341504253-dff4815485f1?${q}`,
                        `https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?${q}`,
                    ],
                    Pants: [
                        `https://images.unsplash.com/photo-1503944586555-7832668c7a95?${q}`,
                        `https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?${q}`,
                        `https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?${q}`,
                    ],
                    Boys: [
                        `https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?${q}`,
                        `https://images.unsplash.com/photo-1503944586555-7832668c7a95?${q}`,
                        `https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?${q}`,
                    ],
                    Girls: [
                        `https://images.unsplash.com/photo-1509967419530-da38b4704bc6?${q}`,
                        `https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?${q}`,
                        `https://images.unsplash.com/photo-1503341504253-dff4815485f1?${q}`,
                    ],
                    Baby: [
                        `https://images.unsplash.com/photo-1519689680058-324335c77eba?${q}`,
                        `https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?${q}`,
                        `https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?${q}`,
                    ],
                    Shoes: [
                        `https://images.unsplash.com/photo-1503944586555-7832668c7a95?${q}`,
                        `https://images.unsplash.com/photo-1460353581641-37baddab0fa2?${q}`,
                        `https://images.unsplash.com/photo-1549298916-b41d501d3772?${q}`,
                    ],
                    Sets: [
                        `https://images.unsplash.com/photo-1503919545889-aef66e16bb32?${q}`,
                        `https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?${q}`,
                        `https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?${q}`,
                    ],
                    Perfumes: [
                        `https://images.unsplash.com/photo-1595425970377-c970029bf94e?${q}`,
                        `https://images.unsplash.com/photo-1541643600914-78b084683601?${q}`,
                        `https://images.unsplash.com/photo-1587017539504-67cfbddac569?${q}`,
                    ],
                },
            };
        }

        function mergeHomeSubcategorySlides(apiObj) {
            const def = getDefaultHomeSubcatSlides();
            const out = JSON.parse(JSON.stringify(def));
            if (!apiObj || typeof apiObj !== 'object') return out;
            for (const cat of ['Men', 'Women', 'Kids']) {
                if (!apiObj[cat] || typeof apiObj[cat] !== 'object') continue;
                for (const sub of Object.keys(apiObj[cat])) {
                    const urls = apiObj[cat][sub];
                    if (!Array.isArray(urls) || !urls.length) continue;
                    const cleaned = urls
                        .map((x) => String(x || '').trim())
                        .filter(Boolean)
                        .map((url) => absoluteMediaUrl(url));
                    if (cleaned.length) out[cat][sub] = cleaned;
                }
            }
            return out;
        }

        function initHomeSubcategorySliderHosts() {
            const hosts = document.querySelectorAll('.subcat-slide-host');
            if (!hosts.length) return;
            const merged = homeSubcatSlidesMerged || mergeHomeSubcategorySlides(null);
            homeSubcatSlidesMerged = merged;
            hosts.forEach((host) => {
                if (host._slideTimer) {
                    clearInterval(host._slideTimer);
                    host._slideTimer = null;
                }
                const cat = host.getAttribute('data-slide-cat');
                const sub = host.getAttribute('data-slide-sub');
                const inner = host.querySelector('.subcat-slide-inner');
                if (!cat || !sub || !inner) return;
                const FALLBACK_SUBCAT =
                    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80&auto=format&fit=crop';
                let urls = merged?.[cat]?.[sub];
                if (!Array.isArray(urls) || !urls.length) urls = defUrlsForSubcat(cat, sub);
                urls = urls.map((u) => String(u || '').trim()).filter(Boolean);
                if (!urls.length) urls = [FALLBACK_SUBCAT];
                inner.innerHTML = urls
                    .map(
                        (url, i) =>
                            `<img src="${escapeHtml(url)}" alt="" class="subcat-slide-layer${i === 0 ? ' subcat-slide-visible' : ''}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
                    )
                    .join('');
                inner.querySelectorAll('img').forEach((im) => {
                    im.onerror = function () {
                        this.onerror = null;
                        if (this.src !== FALLBACK_SUBCAT) this.src = FALLBACK_SUBCAT;
                    };
                });
                const layers = inner.querySelectorAll('.subcat-slide-layer');
                if (layers.length < 2) return;
                let idx = 0;
                host._slideTimer = setInterval(() => {
                    const L = inner.querySelectorAll('.subcat-slide-layer');
                    if (!L.length) return;
                    L[idx].classList.remove('subcat-slide-visible');
                    idx = (idx + 1) % L.length;
                    L[idx].classList.add('subcat-slide-visible');
                }, 4800);
            });
        }

        function defUrlsForSubcat(cat, sub) {
            const d = getDefaultHomeSubcatSlides();
            const u = d[cat]?.[sub];
            return Array.isArray(u) && u.length ? u : [];
        }

        async function applyHomeContactFromApi() {
            try {
                const data = await apiFetch('/api/contact', { requireAuth: false });
                const img = data.home_main_section_images;
                if (img && typeof img === 'object') {
                    const pairs = [
                        ['men', 'home-main-img-men'],
                        ['women', 'home-main-img-women'],
                        ['kids', 'home-main-img-kids'],
                    ];
                    for (const [key, id] of pairs) {
                        const u = img[key];
                        if (u == null || !String(u).trim()) continue;
                        const el = document.getElementById(id);
                        if (!el) continue;
                        const fb = el.getAttribute('data-fallback-src') || el.src;
                        el.src = absoluteMediaUrl(String(u).trim());
                        el.onerror = function () {
                            this.onerror = null;
                            if (fb) this.src = fb;
                        };
                    }
                }
                homeSubcatSlidesMerged = mergeHomeSubcategorySlides(data.home_subcategory_slides);
                initHomeSubcategorySliderHosts();
                applyHomeSectionsVisibility(data.home_sections_visibility);
            } catch (_e) {
                applyHomeSectionsVisibility(null);
            }
        }

        function orderLineItemName(item, locale) {
            const n = item && item.name;
            if (!n) return '';
            if (typeof n === 'string') return n;
            return locale === 'ar' ? (n.ar || n.en || '') : (n.en || n.ar || '');
        }

        function formatOrderMessage(order, _locale) {
            const items = order.items || [];
            const payAr = paymentOptions[order.paymentMethod] ? paymentOptions[order.paymentMethod].ar : '';
            const payEn = paymentOptions[order.paymentMethod] ? paymentOptions[order.paymentMethod].en : '';
            const oid = order.id || latestOrderId || '—';
            const ar = [];
            const en = [];
            ar.push('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
            ar.push('  🛍  ADORA · طلب جديد');
            ar.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
            ar.push('');
            ar.push(`📋 رقم الطلب:  ${oid}`);
            ar.push('');
            ar.push('👤 بيانات الزبون');
            ar.push(`   الاسم: ${order.customerName || '—'}`);
            ar.push(`   الهاتف: ${order.customerPhone || '—'}`);
            ar.push(`   عنوان التوصيل: ${order.deliveryAddressAr || '—'}`);
            ar.push('');
            en.push('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
            en.push('  🛍  ADORA · New order');
            en.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
            en.push('');
            en.push(`📋 Order:  ${oid}`);
            en.push('');
            en.push('👤 Customer');
            en.push(`   Name: ${order.customerName || '—'}`);
            en.push(`   Phone: ${order.customerPhone || '—'}`);
            en.push(`   Address: ${order.deliveryAddressEn || '—'}`);
            en.push('');
            items.forEach((item, i) => {
                const num = i + 1;
                const br = resolveDisplayBrand(item.brand);
                const listUnit = Number(item.unitPrice != null ? item.unitPrice : item.price || 0);
                const discPct = Number(item.discountPct || 0);
                const saleUnit = saleUnitFromListAndDiscount(listUnit, discPct);
                const line = saleUnit * Number(item.qty || 1);
                const img = absoluteMediaUrl(item.image);
                const na = orderLineItemName(item, 'ar');
                const ne = orderLineItemName(item, 'en');
                ar.push(`▸▸  ${num} — البند ${num}`);
                ar.push('    ─────────────────');
                ar.push(`    📦  ${na}`);
                ar.push(`    🏷  ${br}`);
                if (item.size) ar.push(`    📏  المقاس: ${item.size}`);
                if (item.color) ar.push(`    🎨  اللون: ${item.color}`);
                ar.push(`    🔢  الكمية: ${item.qty}`);
                ar.push(`    💵  السعر: ${formatSyp(saleUnit)} × ${item.qty} = ${formatSyp(line)}`);
                if (discPct > 0) ar.push(`    📎  السعر قبل الخصم: ${formatSyp(listUnit)}`);
                if (img) ar.push(`    🖼  ${img}`);
                ar.push('');
                en.push(`▸▸  ${num} — Line ${num}`);
                en.push('    ─────────────────');
                en.push(`    📦  ${ne}`);
                en.push(`    🏷  ${br}`);
                if (item.size) en.push(`    📏  Size: ${item.size}`);
                if (item.color) en.push(`    🎨  Color: ${item.color}`);
                en.push(`    🔢  Qty: ${item.qty}`);
                en.push(`    💵  ${formatSyp(saleUnit)} × ${item.qty} = ${formatSyp(line)}`);
                if (discPct > 0) en.push(`    📎  List price: ${formatSyp(listUnit)}`);
                if (img) en.push(`    🖼  ${img}`);
                en.push('');
            });
            const td = order.totals || {};
            const payTotal = Number(td.total != null ? td.total : td.subtotal || 0);
            const discAll = Number(td.discount || 0);
            const beforeAll = payTotal + discAll;
            ar.push('┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈');
            if (discAll > 0) {
                ar.push(`📊  قبل الخصم: ${formatSyp(beforeAll)}`);
                ar.push(`🏷  الخصم: ${formatSyp(discAll)}`);
            }
            ar.push(`💰  الإجمالي: ${formatSyp(payTotal)}`);
            ar.push(`💳  الدفع: ${payAr}`);
            en.push('┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈');
            if (discAll > 0) {
                en.push(`📊  Before discount: ${formatSyp(beforeAll)}`);
                en.push(`🏷  Discount: ${formatSyp(discAll)}`);
            }
            en.push(`💰  Total: ${formatSyp(payTotal)}`);
            en.push(`💳  Payment: ${payEn}`);
            return [...ar, '', '──────────────', 'English:', '', ...en].join('\n');
        }

        function setOrderStatus(status) {
            latestOrderStatus = normalizeOrderStatus(status);
            trackingCycleIndex = Math.max(0, orderStatusFlow.findIndex(step => step.key === latestOrderStatus));
            updateOrderTrackingUI();
            if (latestOrderStatus === 'shipping') {
                showToast(isRTL ? translationMap.orderShipped : 'Order shipped');
            } else if (latestOrderStatus === 'delivered') {
                showToast(isRTL ? translationMap.orderDelivered : 'Order delivered');
            }
        }

        function simulateStatusProgression() {
            /* الحالة من السيرفر */
        }

        function updateOrderTrackingUI() {
            const timeline = document.getElementById('order-tracking-steps');
            const progressLine = document.getElementById('tracking-progress-fill');
            const detailTimeline = document.getElementById('tracking-timeline');
            const detailProgress = document.getElementById('tracking-progress-fill');
            const detailStatus = document.getElementById('tracking-current-status');
            const detailOrderId = document.getElementById('tracking-order-id-detail');
            const orderDateEl = document.getElementById('tracking-order-date');

            if (!timeline || !progressLine) return;
            const currentIndex = Math.max(0, orderStatusFlow.findIndex(step => step.key === normalizeOrderStatus(latestOrderStatus)));
            const fill = orderStatusFlow.length > 1 ? (currentIndex / (orderStatusFlow.length - 1)) * 100 : 0;
            progressLine.style.width = `${fill}%`;
            if (detailProgress) detailProgress.style.width = `${fill}%`;

            const timelineMarkup = orderStatusFlow.map((step, idx) => {
                const label = isRTL ? step.ar : step.en;
                const active = idx <= currentIndex;
                return `<div class="order-step${active ? ' active' : ''}">
                            <span class="order-step-dot"></span>
                            <span class="text-xs font-semibold">${label}</span>
                        </div>`;
            }).join('');

            timeline.innerHTML = timelineMarkup;
            if (detailTimeline) detailTimeline.innerHTML = orderStatusFlow.map((step, idx) => {
                const label = isRTL ? step.ar : step.en;
                const active = idx <= currentIndex;
                return `<div class="tracking-step${active ? ' active' : ''}">
                            <span class="tracking-dot"></span>
                            <div>
                                <p class="text-xs font-semibold">${label}</p>
                            </div>
                        </div>`;
            }).join('');

            if (detailOrderId) detailOrderId.textContent = latestOrderId || '—';
            if (detailStatus) {
                const st = orderStatusFlow[currentIndex];
                detailStatus.textContent = st ? (isRTL ? st.ar : st.en) : getOrderStatusLabel(latestOrderStatus);
            }
            const dateLabel = latestOrderCreatedAt ? formatOrderDate(latestOrderCreatedAt) : (isRTL ? '—' : '—');
            if (orderDateEl) orderDateEl.textContent = dateLabel;

            const itemsWrap = document.getElementById('tracking-order-items');
            if (itemsWrap) {
                if (latestTrackingItems && latestTrackingItems.length) {
                    itemsWrap.innerHTML = latestTrackingItems
                        .map((it) => {
                            const name = escapeHtml(it.product_name || '');
                            const qty = Number(it.qty || 1);
                            const price = Number(it.price || 0);
                            const lineTotal = qty * price;
                            const brandLabel = escapeHtml(resolveDisplayBrand(it.brand));
                            const img = it.image_url
                                ? `<img src="${escapeHtml(it.image_url)}" alt="" class="w-14 h-14 rounded-xl object-cover border border-gray-100 shrink-0" loading="lazy">`
                                : `<div class="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 shrink-0"><i class="fas fa-image"></i></div>`;
                            const meta = [it.color, it.size].filter(Boolean).map(escapeHtml).join(' · ');
                            return `<div class="flex gap-3 items-start">
                                ${img}
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm font-semibold text-gray-900">${name}</p>
                                    <p class="text-xs text-purple-700 font-medium mt-0.5">${isRTL ? 'الشركة' : 'Brand'}: ${brandLabel}</p>
                                    ${meta ? `<p class="text-xs text-gray-500 mt-0.5">${meta}</p>` : ''}
                                    <p class="text-xs text-gray-500 mt-1">${isRTL ? 'الكمية' : 'Qty'}: ${qty} · ${formatSyp(lineTotal)}</p>
                                </div>
                            </div>`;
                        })
                        .join('');
                } else if (latestTrackingOrder) {
                    const tp = Number(latestTrackingOrder.total_price || 0);
                    const pm = formatPaymentMethodLabel(latestTrackingOrder.payment_method);
                    itemsWrap.innerHTML = `<div class="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
                        <p class="text-sm font-semibold text-gray-900">${isRTL ? 'ملخص الطلب' : 'Order summary'}</p>
                        <p class="text-sm text-gray-800">${isRTL ? 'الإجمالي' : 'Total'}: <span class="font-bold">${formatSyp(tp)}</span></p>
                        <p class="text-xs text-gray-600">${isRTL ? 'طريقة الدفع' : 'Payment'}: ${escapeHtml(pm)}</p>
                    </div>`;
                } else {
                    itemsWrap.innerHTML = '';
                }
            }
        }

        function cycleTrackingStatus() {
            showToast(isRTL ? 'تحديث الحالة من المتجر فقط' : 'Only the store can update status');
        }

        function updateBrandSortButtons() {
            document.querySelectorAll('.brand-sort-btn').forEach(btn => {
                const key = btn.getAttribute('data-sort-key');
                btn.classList.toggle('active', key === brandSortKey);
            });
        }

        async function syncBrandsFromApi() {
            try {
                const rows = await apiFetch('/api/brands', { requireAuth: false });
                apiBrandsList = Array.isArray(rows) ? rows : [];
            } catch (_e) {
                apiBrandsList = [];
            }
            renderBrandCards();
            renderTopBrands();
        }

        /** إحصائيات حية من الـ API (قاعدة PostgreSQL على السيرفر) */
        async function syncStoreStatsFromApi() {
            const el = document.getElementById('store-catalog-stats');
            if (!el) return;
            try {
                let s;
                try {
                    s = await apiFetch('/api/public/stats', { requireAuth: false });
                } catch (_e1) {
                    s = await apiFetch('/api/stats', { requireAuth: false });
                }
                const p = Number(s.products ?? 0);
                const b = Number(s.brands ?? 0);
                const c = Number(s.categories ?? 0);
                el.textContent = isRTL
                    ? `من الكتالوج: ${p} منتج · ${b} علامة · ${c} قسم`
                    : `Catalog: ${p} products · ${b} brands · ${c} categories`;
                el.classList.remove('hidden');
            } catch (_e) {
                el.textContent = '';
                el.classList.add('hidden');
            }
        }

        function renderBrandCards() {
            const container = document.getElementById('brand-scroll');
            if (!container) return;
            const rows = apiBrandsList.map((b) => ({
                key: String(b.id),
                name: String(b.name || '').trim(),
                logo: b.logo || '',
                selling: Number(b.product_count || 0),
                popular: (Number(b.is_top_brand) ? 1000 : 0) + Number(b.product_count || 0),
            }));
            if (!rows.length) {
                container.innerHTML = `<p class="text-xs text-gray-500 px-2">${isRTL ? 'لا توجد علامات تجارية لعرضها حالياً.' : 'No brands to show yet.'}</p>`;
                return;
            }
            const sorted = [...rows].sort((a, b) => b[brandSortKey] - a[brandSortKey]);
            container.innerHTML = sorted
                .map((brand) => {
                    const activeClass = activeBrandKey === brand.name ? ' active' : '';
                    const logoHtml = brand.logo
                        ? `<img src="${escapeHtml(brand.logo)}" alt="" class="w-full h-full object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
                        : `<span class="text-2xl font-bold text-purple-600">${escapeHtml(brand.name.charAt(0).toUpperCase())}</span>`;
                    const brandEnc = encodeURIComponent(brand.name);
                    return `<button type="button" class="brand-strip-card${activeClass}" data-brand-name="${brandEnc}">
                            <div class="brand-strip-logo">${logoHtml}</div>
                            <div class="brand-strip-name">${escapeHtml(brand.name)}</div>
                        </button>`;
                })
                .join('');
        }

        function sortBrands(key) {
            brandSortKey = key;
            updateBrandSortButtons();
            renderBrandCards();
            const msg =
                key === 'selling'
                    ? isRTL
                        ? 'تم ترتيب حسب الأكثر مبيعاً'
                        : 'Sorted by best sellers'
                    : isRTL
                      ? 'تم ترتيب حسب الأكثر شعبية'
                      : 'Sorted by popularity';
            showToast(msg);
        }

        function openBrandStore(brandName, mainCategoryOpt) {
            const name = String(brandName || '').trim();
            if (!name) return;
            listingAdoraOnly = false;
            listingNewCollectionOnly = false;
            listingSearchQuery = '';
            listingCategoryFilter = null;
            listingSubcategoryFilter = null;
            listingBrandMainCategory =
                mainCategoryOpt && ['Men', 'Women', 'Kids'].includes(String(mainCategoryOpt).trim())
                    ? String(mainCategoryOpt).trim()
                    : null;
            activeBrandKey = name;
            listingBrandName = name;
            renderBrandCards();
            const status = document.getElementById('brand-status');
            if (status) {
                const defaultMessage = isRTL ? status.getAttribute('data-ar') : status.getAttribute('data-en');
                status.textContent = isRTL ? `عرض منتجات: ${name}` : `Showing: ${name}`;
            }
            navigateTo('screen-listing');
        }

        function navigateToListingAll() {
            listingSearchQuery = '';
            listingBrandName = null;
            listingBrandMainCategory = null;
            activeBrandKey = null;
            listingCategoryFilter = null;
            listingSubcategoryFilter = null;
            listingAdoraOnly = false;
            listingNewCollectionOnly = false;
            renderBrandCards();
            const status = document.getElementById('brand-status');
            if (status) {
                status.textContent = isRTL ? status.getAttribute('data-ar') : status.getAttribute('data-en');
            }
            navigateTo('screen-listing');
        }

        /** category/sub مثل Men, Shoes — تتطابق مع أقسام المتجر (كل العلامات، ليس فقط أدورا) */
        function navigateToListingFiltered(category, subcategory) {
            closeHomeCategoryPanel();
            listingSearchQuery = '';
            listingBrandName = null;
            listingBrandMainCategory = null;
            activeBrandKey = null;
            listingNewCollectionOnly = false;
            listingAdoraOnly = false;
            listingCategoryFilter = category ? String(category).trim() : null;
            const sub = subcategory != null ? String(subcategory).trim() : '';
            listingSubcategoryFilter = sub || null;
            renderBrandCards();
            const status = document.getElementById('brand-status');
            if (status) {
                const bits = [listingCategoryFilter, listingSubcategoryFilter].filter(Boolean);
                status.textContent = bits.length
                    ? (isRTL ? `تصفية: ${bits.join(' · ')}` : `Filter: ${bits.join(' · ')}`)
                    : (isRTL ? status.getAttribute('data-ar') : status.getAttribute('data-en'));
            }
            navigateTo('screen-listing');
        }

        function goBackFromListing() {
            if (adoraNavStack.length === 1 && adoraNavStack[0] === 'screen-listing') {
                adoraNavStack.unshift('screen-categories');
            }
            if (adoraNavStack.length > 1 && adoraNavStack[adoraNavStack.length - 1] === 'screen-listing') {
                adoraNavStack.pop();
                resetListingFiltersAfterLeave();
                const prev = adoraNavStack[adoraNavStack.length - 1];
                navigateTo(prev, { skipHistory: true });
                try {
                    history.replaceState(
                        { adora: 1, screen: prev },
                        '',
                        window.location.pathname + window.location.search + window.location.hash
                    );
                } catch (_e) {}
                persistAdoraSessionState();
                return;
            }
            resetListingFiltersAfterLeave();
            adoraNavStack = ['screen-categories'];
            navigateTo('screen-categories', { skipHistory: true });
            try {
                history.replaceState(
                    { adora: 1, screen: 'screen-categories' },
                    '',
                    window.location.pathname + window.location.search + window.location.hash
                );
            } catch (_e) {}
            persistAdoraSessionState();
        }

        function isAdoraBrandName(name) {
            const n = String(name || '')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '');
            return n === 'adora' || n === 'أدورا' || n.includes('adora');
        }

        function updateListingBrandSectionCount() {
            const el = document.getElementById('listing-brand-section-count');
            if (!el) return;
            const sq = listingSearchQuery && String(listingSearchQuery).trim();
            const show = !!listingBrandName && !sq;
            el.classList.toggle('hidden', !show);
            if (!show) return;
            const raw = Array.isArray(listingProductsRaw) ? listingProductsRaw : [];
            const n = applyClientSideListingFilters(raw).length;
            el.textContent = isRTL ? `${n} منتج` : `${n} items`;
        }

        function updateListingBrandMainCatBar() {
            const wrap = document.getElementById('listing-brand-main-cat-wrap');
            if (!wrap) return;
            const sq = listingSearchQuery && String(listingSearchQuery).trim();
            const show = !!listingBrandName && !sq;
            wrap.classList.toggle('hidden', !show);
            wrap.setAttribute('data-brand-theme', listingBrandName && isAdoraBrandName(listingBrandName) ? 'adora' : 'other');
            const cur = listingBrandMainCategory || '';
            wrap.querySelectorAll('.listing-brand-cat-chip').forEach((btn) => {
                const v = btn.getAttribute('data-main-cat') || '';
                btn.classList.toggle('active', v === cur);
            });
            updateListingBrandSectionCount();
        }

        function setListingBrandMainCategory(cat) {
            if (cat == null || cat === '') listingBrandMainCategory = null;
            else {
                const c = String(cat).trim();
                listingBrandMainCategory = ['Men', 'Women', 'Kids'].includes(c) ? c : null;
            }
            updateListingBrandMainCatBar();
            loadListingPageProducts().catch(() => {});
        }

        function scheduleListingSearchDebounced() {
            clearTimeout(listingSearchDebounceTimer);
            listingSearchDebounceTimer = setTimeout(() => {
                const el = document.getElementById('listing-search-input');
                listingSearchQuery = el ? String(el.value || '').trim() : '';
                loadListingPageProducts().catch(() => {});
            }, 380);
        }

        function listingSearchOnEnter(ev) {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            clearTimeout(listingSearchDebounceTimer);
            const el = document.getElementById('listing-search-input');
            listingSearchQuery = el ? String(el.value || '').trim() : '';
            loadListingPageProducts().catch(() => {});
        }

        async function refreshAdoraHomeSubcategoryCounts() {
            try {
                const products = await apiFetch('/api/products?adora_only=1', { requireAuth: false });
                const list = Array.isArray(products) ? products : [];
                const counts = {};
                for (const p of list) {
                    const c = String(p.category || '').trim();
                    const s = String(p.subcategory || '').trim();
                    const k = `${c}|${s}`;
                    counts[k] = (counts[k] || 0) + 1;
                }
                document.querySelectorAll('[data-adora-count-cat]').forEach((el) => {
                    const c = el.getAttribute('data-adora-count-cat') || '';
                    const s = el.getAttribute('data-adora-count-sub') || '';
                    const n = counts[`${c}|${s}`] || 0;
                    el.textContent = n ? (isRTL ? `${n} منتج` : `${n} items`) : isRTL ? '0 منتج' : '0 items';
                });
            } catch (_e) {
                document.querySelectorAll('[data-adora-count-cat]').forEach((el) => {
                    el.textContent = '—';
                });
            }
        }

        async function loadProductRelatedForDetail(productId) {
            const section = document.getElementById('product-related-section');
            const wrap = document.getElementById('product-related-scroll');
            if (!wrap || !section) return;
            wrap.innerHTML = '';
            section.classList.add('hidden');
            try {
                const rows = await apiFetch(`/api/products/${productId}/related?limit=12`, { requireAuth: false });
                const list = Array.isArray(rows) ? rows : [];
                if (!list.length) return;
                section.classList.remove('hidden');
                wrap.innerHTML = `<div class="home-product-strip">${list
                    .map((p) => renderProductCardHtml(p, { compact: true }))
                    .join('')}</div>`;
            } catch (_e) {
                section.classList.add('hidden');
            }
        }

        async function loadListingPageProducts() {
            const grid = document.getElementById('listing-products-grid');
            if (!grid) return;
            const startedWithTextSearch = !!(listingSearchQuery && String(listingSearchQuery).trim());
            const lsi = document.getElementById('listing-search-input');
            if (lsi && document.activeElement !== lsi) lsi.value = listingSearchQuery || '';
            grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-8">${isRTL ? 'جاري التحميل...' : 'Loading...'}</p>`;
            const titleEl = document.getElementById('listing-screen-title');
            try {
                const params = new URLSearchParams();
                const sq = listingSearchQuery && String(listingSearchQuery).trim();
                if (sq) {
                    params.set('q', sq);
                    if (listingBrandName) params.set('brand', listingBrandName);
                    if (listingNewCollectionOnly) {
                        params.set('new_collection', '1');
                        if (listingCategoryFilter) params.set('category', listingCategoryFilter);
                    }
                } else {
                    if (listingBrandName) {
                        params.set('brand', listingBrandName);
                        if (listingBrandMainCategory && ['Men', 'Women', 'Kids'].includes(listingBrandMainCategory)) {
                            params.set('category', listingBrandMainCategory);
                        }
                    } else if (listingNewCollectionOnly) {
                        params.set('new_collection', '1');
                        if (listingCategoryFilter) params.set('category', listingCategoryFilter);
                    } else if (listingAdoraOnly) {
                        params.set('adora_only', '1');
                        if (listingCategoryFilter) params.set('category', listingCategoryFilter);
                        if (listingSubcategoryFilter) params.set('subcategory', listingSubcategoryFilter);
                    } else {
                        if (listingCategoryFilter) params.set('category', listingCategoryFilter);
                        if (listingSubcategoryFilter) params.set('subcategory', listingSubcategoryFilter);
                    }
                }
                const minR = Number(filterMinRating || 0);
                if (minR > 0) params.set('min_rating', String(minR));
                const maxEl = document.getElementById('filter-price-max');
                const maxP = maxEl ? Number(maxEl.value) : NaN;
                if (Number.isFinite(maxP) && maxP > 0) params.set('max_price', String(maxP));
                const qs = params.toString() ? `?${params.toString()}` : '';
                const products = await apiFetch(`/api/products${qs}`, { requireAuth: false });
                listingProductsRaw = Array.isArray(products) ? products : [];
                if (titleEl) {
                    const ncCatLabelsAr = { Men: 'رجال', Women: 'نساء', Kids: 'أطفال', Games: 'ألعاب' };
                    const ncCatLabelsEn = { Men: 'Men', Women: 'Women', Kids: 'Kids', Games: 'Games' };
                    if (sq) {
                        titleEl.removeAttribute('data-en');
                        titleEl.removeAttribute('data-ar');
                        if (listingNewCollectionOnly) {
                            const cf = listingCategoryFilter && ncCatLabelsAr[listingCategoryFilter];
                            const catLab = cf ? (isRTL ? ncCatLabelsAr[listingCategoryFilter] : ncCatLabelsEn[listingCategoryFilter]) : '';
                            titleEl.textContent = catLab
                                ? isRTL
                                    ? `بحث: ${sq} · وصل حديثاً · ${catLab}`
                                    : `Search: ${sq} · Fresh drops · ${catLab}`
                                : isRTL
                                  ? `بحث: ${sq} · وصل حديثاً`
                                  : `Search: ${sq} · Fresh drops`;
                        } else {
                            titleEl.textContent = isRTL ? `بحث: ${sq}` : `Search: ${sq}`;
                        }
                    } else if (listingNewCollectionOnly) {
                        titleEl.setAttribute('data-en', 'Fresh drops');
                        titleEl.setAttribute('data-ar', 'وصل حديثاً');
                        const base = isRTL ? titleEl.getAttribute('data-ar') : titleEl.getAttribute('data-en');
                        const cf = listingCategoryFilter && ncCatLabelsAr[listingCategoryFilter];
                        const catLab = cf ? (isRTL ? ncCatLabelsAr[listingCategoryFilter] : ncCatLabelsEn[listingCategoryFilter]) : '';
                        titleEl.textContent = catLab ? `${base} · ${catLab}` : base;
                    } else if (listingBrandName) {
                        const catLab =
                            listingBrandMainCategory && ['Men', 'Women', 'Kids'].includes(listingBrandMainCategory)
                                ? isRTL
                                    ? { Men: 'رجالي', Women: 'نسائي', Kids: 'ولادي' }[listingBrandMainCategory] ||
                                      listingBrandMainCategory
                                    : listingBrandMainCategory
                                : '';
                        titleEl.textContent = catLab ? `${listingBrandName} · ${catLab}` : listingBrandName;
                    } else if (listingCategoryFilter) {
                        const sub = listingSubcategoryFilter ? ` · ${listingSubcategoryFilter}` : '';
                        titleEl.textContent = `${listingCategoryFilter}${sub}`;
                    } else {
                        titleEl.setAttribute('data-en', 'All products');
                        titleEl.setAttribute('data-ar', 'جميع المنتجات');
                        titleEl.textContent = isRTL ? titleEl.getAttribute('data-ar') : titleEl.getAttribute('data-en');
                    }
                }
                if (listingProductsRaw.length === 0) {
                    grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-8 text-sm leading-relaxed px-2">${isRTL ? 'لا توجد منتجات مطابقة لهذا التصفية حالياً.' : 'No products match this filter right now.'}</p>`;
                    return;
                }
                syncFilterPriceRangeFromProducts(listingProductsRaw);
                const filtered = applyClientSideListingFilters(listingProductsRaw);
                renderListingProductGrid(filtered);
            } catch (e) {
                listingProductsRaw = [];
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-8 text-sm">${escapeHtml(e.message)}</p>`;
            } finally {
                if (startedWithTextSearch) {
                    listingSearchQuery = '';
                    const homeInp = document.getElementById('search-input');
                    const listInp = document.getElementById('listing-search-input');
                    if (homeInp && document.activeElement !== homeInp) homeInp.value = '';
                    if (listInp && document.activeElement !== listInp) listInp.value = '';
                    const te = document.getElementById('listing-screen-title');
                    if (te) {
                        te.setAttribute('data-en', 'Search results');
                        te.setAttribute('data-ar', 'نتائج البحث');
                        te.textContent = isRTL ? te.getAttribute('data-ar') : te.getAttribute('data-en');
                    }
                    syncSearchRotatingHintVisibility();
                }
                syncSearchInputsFromQuery();
                updateListingBrandMainCatBar();
            }
        }

        let voiceSearchRecognition = null;
        let voiceSearchListening = false;

        /** توحيد أشكال الهمزة والتاء المربوطة والتشكيل لنتيجة أوضح في البحث */
        function normalizeArabicSpeechForSearch(text) {
            let t = String(text || '').trim();
            if (!t) return t;
            t = t.replace(/\u0640/g, '');
            t = t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
            t = t.replace(/[\u0622\u0623\u0625]/g, '\u0627');
            t = t.replace(/\u0629/g, '\u0647');
            t = t.replace(/\u0624/g, '\u0648');
            t = t.replace(/\u0626/g, '\u064a');
            return t.replace(/\s+/g, ' ').trim();
        }

        /** تحسين عرض كلمة عربية واحدة من الصوت: «كنزه» → «كنزة» (بدون المساس بجمل) */
        function prettifyArabicVoiceDisplay(s) {
            const t = String(s || '').trim();
            if (!t || !isRTL) return t;
            if (/\s/.test(t)) return t;
            if (t.length >= 4 && t.endsWith('ه')) return t.slice(0, -1) + '\u0629';
            return t;
        }

        function pickBestSpeechTranscript(event) {
            const res = event.results && event.results[0];
            if (!res) return '';
            let best = '';
            let bestConf = -Infinity;
            const n = res.length;
            for (let i = 0; i < n; i++) {
                const alt = res[i];
                const tx = String(alt.transcript || '').trim();
                if (!tx) continue;
                const c =
                    typeof alt.confidence === 'number' && !Number.isNaN(alt.confidence) ? alt.confidence : 0;
                if (best === '' || c > bestConf) {
                    bestConf = c;
                    best = tx;
                }
            }
            return best;
        }

        function getSpeechRecognitionConstructor() {
            return window.SpeechRecognition || window.webkitSpeechRecognition || null;
        }

        function setVoiceSearchUi(listening) {
            voiceSearchListening = !!listening;
            const btn = document.getElementById('search-voice-btn');
            if (btn) {
                btn.classList.toggle('listening', voiceSearchListening);
                btn.setAttribute('aria-pressed', voiceSearchListening ? 'true' : 'false');
            }
        }

        function stopVoiceSearch() {
            if (voiceSearchRecognition) {
                try {
                    voiceSearchRecognition.onend = null;
                    voiceSearchRecognition.stop();
                } catch (_e) {}
                voiceSearchRecognition = null;
            }
            setVoiceSearchUi(false);
        }

        function toggleVoiceSearch() {
            const Ctor = getSpeechRecognitionConstructor();
            if (!Ctor) {
                showToast(isRTL ? 'المتصفح لا يدعم البحث الصوتي. جرّب كروم أو متصفحاً حديثاً.' : 'Voice search is not supported. Try Chrome or a recent browser.');
                return;
            }
            if (voiceSearchListening) {
                stopVoiceSearch();
                showToast(isRTL ? 'تم إيقاف الاستماع' : 'Listening stopped');
                return;
            }

            try {
                voiceSearchRecognition = new Ctor();
            } catch (_e) {
                showToast(isRTL ? 'تعذر تشغيل الميكروفون' : 'Could not start microphone');
                return;
            }

            const rec = voiceSearchRecognition;
            rec.lang = isRTL ? 'ar' : 'en-US';
            rec.interimResults = false;
            rec.continuous = false;
            rec.maxAlternatives = 5;

            rec.onstart = () => {
                setVoiceSearchUi(true);
                showToast(isRTL ? 'استمع… تحدث الآن' : 'Listening… speak now');
            };

            rec.onerror = (ev) => {
                const err = ev && ev.error ? String(ev.error) : '';
                if (err === 'aborted' || err === 'no-speech') {
                    showToast(isRTL ? 'لم يُلتقط صوت. حاول مجدداً.' : 'No speech detected. Try again.');
                } else if (err === 'not-allowed' || err === 'service-not-allowed') {
                    showToast(isRTL ? 'الإذن بالميكروفون مرفوض. فعّله من إعدادات المتصفح.' : 'Microphone permission denied. Enable it in browser settings.');
                } else {
                    showToast(isRTL ? `خطأ في التعرف الصوتي: ${err || '?'}` : `Voice error: ${err || 'unknown'}`);
                }
                stopVoiceSearch();
            };

            rec.onend = () => {
                stopVoiceSearch();
            };

            rec.onresult = (event) => {
                try {
                    let text = pickBestSpeechTranscript(event);
                    if (isRTL) text = prettifyArabicVoiceDisplay(text);
                    const input = document.getElementById('search-input');
                    if (input) input.value = text;
                    if (text) {
                        runProductSearch();
                    } else {
                        showToast(isRTL ? 'لم يُفهم النص. أعد المحاولة.' : 'No text recognized. Try again.');
                    }
                } catch (_e) {
                    showToast(isRTL ? 'تعذر قراءة النتيجة' : 'Could not read result');
                }
                try {
                    rec.stop();
                } catch (_e2) {}
            };

            try {
                rec.start();
            } catch (_e) {
                showToast(isRTL ? 'تعذر بدء الاستماع. حاول بعد قليل.' : 'Could not start listening. Try again shortly.');
                stopVoiceSearch();
            }
        }

        function syncSearchInputsFromQuery() {
            const q = listingSearchQuery != null ? String(listingSearchQuery) : '';
            const home = document.getElementById('search-input');
            const list = document.getElementById('listing-search-input');
            try {
                if (home) {
                    if (currentScreen === 'screen-categories') {
                        if (document.activeElement !== home) home.value = q;
                        else if (!String(home.value || '').trim() && q) home.value = q;
                    } else if (document.activeElement !== home) {
                        home.value = '';
                    }
                    syncSearchRotatingHintVisibility();
                }
                if (list) {
                    if (document.activeElement !== list) list.value = q;
                    else if (!String(list.value || '').trim() && q) list.value = q;
                }
            } catch (_e) {}
        }

        const SEARCH_ROTATE_HINTS_AR = [
            'نسائي',
            'رجالي',
            'أطفال',
            'تيشرتات',
            'كنزات',
            'قمصان',
            'فساتين',
            'إكسسوارات',
            'أحذية',
            'حقائب',
            'عروض',
        ];
        const SEARCH_ROTATE_HINTS_EN = [
            'Women',
            'Men',
            'Kids',
            'T-shirts',
            'Sweaters',
            'Shirts',
            'Dresses',
            'Accessories',
            'Shoes',
            'Bags',
            'Deals',
        ];
        let searchRotateHintIndex = 0;
        let searchRotateHintTimer = null;
        let searchRotatingHintListenersBound = false;

        function getSearchRotateHintWords() {
            return isRTL ? SEARCH_ROTATE_HINTS_AR : SEARCH_ROTATE_HINTS_EN;
        }

        function updateSearchRotatingHintText(opts) {
            const animate = opts && opts.animate === true;
            const hint = document.getElementById('search-rotating-hint');
            if (!hint) return;
            const words = getSearchRotateHintWords();
            if (!words.length) return;
            searchRotateHintIndex = ((searchRotateHintIndex % words.length) + words.length) % words.length;
            const next = words[searchRotateHintIndex];
            if (animate) {
                hint.classList.remove('search-hint-anim-in');
                void hint.offsetWidth;
                hint.textContent = next;
                hint.classList.add('search-hint-anim-in');
            } else {
                hint.textContent = next;
            }
        }

        function syncSearchRotatingHintVisibility() {
            const input = document.getElementById('search-input');
            const hint = document.getElementById('search-rotating-hint');
            if (!input || !hint) return;
            const show = !String(input.value || '').trim() && document.activeElement !== input;
            hint.classList.remove('search-hint-anim-in');
            hint.classList.toggle('opacity-0', !show);
            hint.classList.toggle('opacity-100', show);
        }

        function tickSearchRotatingHint() {
            const words = getSearchRotateHintWords();
            if (!words.length) return;
            searchRotateHintIndex = (searchRotateHintIndex + 1) % words.length;
            updateSearchRotatingHintText({ animate: true });
        }

        function restartSearchRotatingHintTimer() {
            if (searchRotateHintTimer) {
                clearInterval(searchRotateHintTimer);
                searchRotateHintTimer = null;
            }
            searchRotateHintIndex = 0;
            updateSearchRotatingHintText();
            syncSearchRotatingHintVisibility();
            const hint = document.getElementById('search-rotating-hint');
            if (hint) {
                searchRotateHintTimer = setInterval(tickSearchRotatingHint, 2000);
            }
        }

        function initSearchRotatingHint() {
            const input = document.getElementById('search-input');
            if (!input) return;
            if (!searchRotatingHintListenersBound) {
                searchRotatingHintListenersBound = true;
                const onChange = () => syncSearchRotatingHintVisibility();
                input.addEventListener('focus', onChange);
                input.addEventListener('blur', onChange);
                input.addEventListener('input', onChange);
            }
            restartSearchRotatingHintTimer();
        }

        function runProductSearch() {
            const input = document.getElementById('search-input');
            listingSearchQuery = input ? input.value.trim() : '';
            listingAdoraOnly = false;
            listingNewCollectionOnly = false;
            if (input) input.value = '';
            syncSearchRotatingHintVisibility();
            navigateTo('screen-listing');
        }

        function navigateToListingNewCollection() {
            listingSearchQuery = '';
            listingBrandName = null;
            listingBrandMainCategory = null;
            activeBrandKey = null;
            listingCategoryFilter = null;
            listingSubcategoryFilter = null;
            listingAdoraOnly = false;
            listingNewCollectionOnly = true;
            renderBrandCards();
            const status = document.getElementById('brand-status');
            if (status) {
                status.textContent = isRTL ? status.getAttribute('data-ar') : status.getAttribute('data-en');
            }
            navigateTo('screen-listing');
        }

        /** Fresh drops filtered by main category + is_new_collection (Games = category Games) */
        function navigateToListingNewCollectionCategory(mainCat) {
            const allowed = ['Men', 'Women', 'Kids', 'Games'];
            const c = String(mainCat || '').trim();
            listingSearchQuery = '';
            listingBrandName = null;
            listingBrandMainCategory = null;
            activeBrandKey = null;
            listingSubcategoryFilter = null;
            listingAdoraOnly = false;
            listingNewCollectionOnly = true;
            listingCategoryFilter = allowed.includes(c) ? c : null;
            renderBrandCards();
            const status = document.getElementById('brand-status');
            if (status) {
                status.textContent = isRTL ? status.getAttribute('data-ar') : status.getAttribute('data-en');
            }
            navigateTo('screen-listing');
        }

        function renderProductCardHtml(p, opts = {}) {
            const compact = opts.compact === true;
            const br = resolveDisplayBrand(p.brand);
            const brandHtml = br
                ? `<p class="${
                      compact ? 'text-[8px]' : 'text-[9px]'
                  } text-violet-700 font-semibold line-clamp-1 mb-0.5 text-left" dir="auto">${escapeHtml(br)}</p>`
                : '';
            const img = p.images && p.images.length ? p.images[0] : adoraPlaceholderImageUrl();
            const name = isRTL ? p.name_ar : p.name_en;
            const listP = productListPrice(p);
            const disc = productDiscountPct(p);
            const saleP = productSaleUnitPrice(p);
            const badge =
                disc > 0
                    ? `<span class="absolute ${compact ? 'top-0.5 left-0.5 text-[8px] px-1 py-0.5' : 'top-1 left-1 text-[9px] px-1.5 py-0.5'} badge-sale text-white font-bold rounded-full shadow-md">-${Math.round(disc)}%</span>`
                    : '';
            const mediaCls = compact
                ? 'relative aspect-[3/4] max-h-[140px] overflow-hidden bg-gray-100'
                : 'relative aspect-[3/4] max-h-[168px] overflow-hidden bg-gray-100';
            const padCls = compact ? 'p-1.5' : 'p-2';
            const titleCls = compact
                ? 'font-semibold text-gray-900 text-[11px] line-clamp-2 mb-0.5'
                : 'font-semibold text-gray-900 text-xs line-clamp-2 mb-0.5';
            const priceMain = compact ? 'font-bold text-gray-900 text-[11px]' : 'font-bold text-gray-900 text-xs';
            const cardExtra = compact ? ' home-compact-product-card' : '';
            return `<div onclick="openProductDetail(${p.id})" class="product-card${cardExtra} bg-white rounded-xl shadow-md shadow-gray-200/80 ring-1 ring-black/[0.04] overflow-hidden group cursor-pointer transition-shadow hover:shadow-lg hover:ring-black/[0.06]">
                <div class="${mediaCls}">
                    <img src="${escapeHtml(img)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="">
                    ${badge}
                </div>
                <div class="${padCls}">
                    ${brandHtml}
                    <h3 class="${titleCls}">${escapeHtml(name)}</h3>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="${priceMain}">${formatSyp(saleP)}</span>
                        ${disc > 0 ? `<span class="text-[10px] text-gray-400 line-through">${formatSyp(listP)}</span>` : ''}
                    </div>
                </div>
            </div>`;
        }

        function offerRowIsActive(o) {
            if (!o.offer_end_time) return true;
            const end = new Date(o.offer_end_time).getTime();
            if (isNaN(end)) return true;
            return end > Date.now();
        }

        async function loadOffersPageProducts() {
            const grid = document.getElementById('offers-products-grid');
            if (!grid) return;
            grid.innerHTML = `<p class="col-span-2 text-center text-gray-400 py-10 text-sm">${isRTL ? 'جاري التحميل…' : 'Loading…'}</p>`;
            try {
                const rows = await apiFetch('/api/offers', { requireAuth: false });
                const list = Array.isArray(rows) ? rows.filter(offerRowIsActive) : [];
                if (!list.length) {
                    grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-10 text-sm leading-relaxed px-2">${isRTL ? 'لا توجد عروض نشطة حالياً.' : 'No active offers right now.'}</p>`;
                    return;
                }
                grid.innerHTML = list
                    .map((row) => {
                        const offerDisc = Number(row.discount_percent || 0);
                        const prodDisc = Number(row.discount || 0);
                        const disc = offerDisc > 0 ? offerDisc : prodDisc;
                        const cardProduct = {
                            id: row.product_id,
                            name_ar: row.name_ar,
                            name_en: row.name_en,
                            price: row.price,
                            discount: disc,
                            images: row.images,
                            brand: row.brand,
                        };
                        return renderProductCardHtml(cardProduct, { compact: true });
                    })
                    .join('');
            } catch (e) {
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-8 text-sm">${escapeHtml(e.message)}</p>`;
            }
        }

        async function openProductDetail(id, opts = {}) {
            const skipNavigate = opts.skipNavigate === true;
            if (!skipNavigate) {
                productDetailBackScreen = currentScreen || 'screen-listing';
            }
            try {
                const p = await apiFetch(`/api/products/${id}`, { requireAuth: false });
                currentProductDetail = p;
                fillProductDetailScreen(p);
                if (!skipNavigate) {
                    navigateTo('screen-product');
                } else {
                    persistAdoraSessionState();
                }
            } catch (e) {
                showToast(isRTL ? 'تعذر تحميل المنتج' : 'Failed to load product');
            }
        }

        async function restoreAdoraSessionRoute() {
            const token = getStoredJwtToken();
            if (!token) return;
            const shell = document.getElementById('app-shell');
            if (!shell || shell.classList.contains('hidden')) return;
            try {
                const raw = sessionStorage.getItem(ADORA_SESSION_STACK_KEY);
                if (!raw) return;
                const stack = getValidScreenStack(JSON.parse(raw));
                if (!stack || !stack.length) return;
                adoraNavStack = stack;
                loadListingCtxFromSession();
                const top = adoraNavStack[adoraNavStack.length - 1];
                navigateTo(top, { skipHistory: true });
                if (top === 'screen-product') {
                    const pid = sessionStorage.getItem(ADORA_SESSION_PRODUCT_KEY);
                    if (pid && /^\d+$/.test(pid)) {
                        const back = adoraNavStack.length >= 2 ? adoraNavStack[adoraNavStack.length - 2] : 'screen-categories';
                        productDetailBackScreen = back;
                        await openProductDetail(Number(pid), { skipNavigate: true });
                    }
                }
            } catch (_e) {}
        }

        function fillProductDetailScreen(p) {
            productDetailSelectedColorIndex = 0;
            currentQty = 1;
            const qd0 = document.getElementById('qty-display');
            if (qd0) qd0.textContent = '1';
            const title = isRTL ? p.name_ar : p.name_en;
            const listP = productListPrice(p);
            const disc = productDiscountPct(p);
            const saleP = productSaleUnitPrice(p);
            const gal = document.getElementById('product-gallery');
            if (gal) {
                const imgs = p.images && p.images.length ? p.images : [adoraPlaceholderImageUrl()];
                gal.innerHTML = imgs
                    .map(
                        (url) =>
                            `<div class="snap-center w-full flex-shrink-0 relative min-w-full"><img src="${escapeHtml(url)}" class="w-full h-full object-cover" alt=""></div>`
                    )
                    .join('');
            }
            const tEl = document.getElementById('product-detail-title');
            if (tEl) tEl.textContent = title;
            const metaEl = document.getElementById('product-detail-meta');
            if (metaEl) {
                const cat = (p.category || '').trim();
                const sub = (p.subcategory || '').trim();
                const br = (p.brand || '').trim();
                const catAr = { Men: 'رجالي', Women: 'نسائي', Kids: 'ولادي' };
                const parts = [];
                parts.push(br ? br : isRTL ? 'أدورا' : 'Adora');
                if (cat) parts.push(isRTL ? catAr[cat] || cat : cat);
                if (sub) parts.push(sub);
                if (parts.length) {
                    metaEl.textContent = parts.join(' · ');
                    metaEl.classList.remove('hidden');
                } else {
                    metaEl.textContent = '';
                    metaEl.classList.add('hidden');
                }
            }
            const pEl = document.getElementById('product-detail-price');
            if (pEl) pEl.textContent = formatSyp(saleP);
            const oEl = document.getElementById('product-detail-old-price');
            if (oEl) {
                if (disc > 0) {
                    oEl.classList.remove('hidden');
                    oEl.textContent = formatSyp(listP);
                } else {
                    oEl.classList.add('hidden');
                }
            }
            const sEl = document.getElementById('product-detail-save');
            if (sEl) {
                if (disc > 0) {
                    sEl.classList.remove('hidden');
                    sEl.textContent = isRTL ? `وفّر ${formatSyp(listP - saleP)}` : `Save ${formatSyp(listP - saleP)}`;
                } else {
                    sEl.classList.add('hidden');
                }
            }
            const db = document.getElementById('product-detail-discount-badge');
            if (db) {
                if (disc > 0) {
                    db.classList.remove('hidden');
                    db.textContent = `-${Math.round(disc)}%`;
                } else db.classList.add('hidden');
            }
            const dEl = document.getElementById('content-desc');
            if (dEl) dEl.textContent = p.description || '';
            const addP = document.getElementById('product-detail-add-price');
            if (addP) addP.textContent = ` — ${formatSyp(saleP)}`;

            const colWrap = document.getElementById('product-color-options');
            const colors = Array.isArray(p.colors) && p.colors.length ? p.colors.map((c) => String(c)) : [];
            if (colWrap) {
                if (!colors.length) {
                    colWrap.innerHTML = `<span class="text-sm text-gray-500">${isRTL ? 'لون واحد' : 'Standard'}</span>`;
                    const sc = document.getElementById('selected-color');
                    if (sc) sc.textContent = '—';
                } else {
                    colWrap.innerHTML = colors
                        .map((c, i) => {
                            const lab = escapeHtml(String(c).slice(0, 6));
                            return `<button type="button" class="color-btn ${i === 0 ? 'selected' : ''} w-10 h-10 min-w-[2.5rem] rounded-full border-2 border-gray-200 shadow-sm text-[9px] font-bold text-gray-700 flex items-center justify-center px-1" data-color-idx="${i}" onclick="selectProductDetailColorIdx(${i})">${lab}</button>`;
                        })
                        .join('');
                    const sc = document.getElementById('selected-color');
                    if (sc) sc.textContent = colors[0];
                }
            }
            rebuildProductDetailSizes(p);

            loadProductReviewsForDetail(p.id).catch(() => {});
            updateWishlistButtonForProduct(p.id);
            loadProductRelatedForDetail(p.id).catch(() => {});
        }

        function variantHasStock(p, size, color) {
            if (!p) return false;
            const inv = Array.isArray(p.inventory) ? p.inventory : [];
            const sz = String(size || '').trim().toLowerCase();
            const cl = String(color || '').trim().toLowerCase();
            if (!inv.length) return Number(p.stock || 0) > 0;
            const row = inv.find((r) => {
                const rs = String(r.size || '').trim().toLowerCase();
                const rc = String(r.color || '').trim().toLowerCase();
                const szMatch = !sz || rs === sz;
                const clMatch = !cl || rc === cl;
                return szMatch && clMatch;
            });
            if (row) return Number(row.stock || 0) > 0;
            return Number(p.stock || 0) > 0;
        }

        function getSelectedDetailColor() {
            const colors = currentProductDetail && Array.isArray(currentProductDetail.colors) ? currentProductDetail.colors : [];
            if (!colors.length) return '';
            const c = colors[productDetailSelectedColorIndex];
            return c != null ? String(c).trim() : '';
        }

        function getSelectedDetailSize() {
            const btn = document.querySelector('#product-size-options .size-btn.selected:not(.disabled)');
            return btn ? String(btn.getAttribute('data-size') || btn.textContent || '').trim() : '';
        }

        function selectProductDetailColorIdx(idx) {
            const colors = currentProductDetail && Array.isArray(currentProductDetail.colors) ? currentProductDetail.colors : [];
            const n = Number(idx);
            if (!Number.isFinite(n) || n < 0 || n >= colors.length) return;
            productDetailSelectedColorIndex = n;
            document.querySelectorAll('#product-color-options .color-btn').forEach((b) => {
                const i = Number(b.getAttribute('data-color-idx'));
                b.classList.toggle('selected', i === productDetailSelectedColorIndex);
            });
            const sc = document.getElementById('selected-color');
            if (sc) sc.textContent = colors[n] || '—';
            rebuildProductDetailSizes(currentProductDetail);
        }

        function selectProductDetailSize(btn) {
            if (!btn || btn.classList.contains('disabled')) return;
            document.querySelectorAll('#product-size-options .size-btn').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
        }

        function rebuildProductDetailSizes(p) {
            const szWrap = document.getElementById('product-size-options');
            if (!szWrap || !p) return;
            const color = getSelectedDetailColor();
            const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.map((s) => String(s)) : ['—'];
            let firstSel = null;
            szWrap.innerHTML = sizes
                .map((s) => {
                    const ok = s === '—' ? Number(p.stock || 0) > 0 : variantHasStock(p, s, color);
                    const sel = ok && firstSel == null;
                    if (sel) firstSel = s;
                    const safe = escapeHtml(s);
                    return `<button type="button" onclick="selectProductDetailSize(this)" class="size-btn ${sel ? 'selected' : ''} w-14 h-14 rounded-2xl border-2 font-semibold text-sm ${
                        ok ? 'border-gray-200 text-gray-800 hover:border-purple-400' : 'disabled border-gray-100 text-gray-400'
                    }" data-size="${safe}" ${ok ? '' : 'disabled'}>${safe}</button>`;
                })
                .join('');
        }

        function renderFiveStarsDisplayHtml(avg) {
            const n =
                avg == null || Number.isNaN(Number(avg))
                    ? 0
                    : Math.min(5, Math.max(0, Math.round(Number(avg))));
            let html = '';
            for (let i = 1; i <= 5; i++) {
                html += `<i class="fas fa-star ${i <= n ? '' : 'text-gray-200'}" style="${i > n ? 'opacity:0.35' : ''}"></i>`;
            }
            return html;
        }

        function renderProductReviewCardHtml(r) {
            const rawName = String(r.user_name || '?').trim();
            const name = escapeHtml(rawName || '?');
            const initials = escapeHtml((rawName || '?').slice(0, 2));
            const stars = Math.min(5, Math.max(1, Number(r.stars) || 1));
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                starsHtml += `<i class="fas fa-star text-xs ${i <= stars ? 'text-yellow-400' : 'text-gray-200'}" style="${i > stars ? 'opacity:0.35' : ''}"></i>`;
            }
            return `<div class="bg-gray-50 rounded-2xl p-4">
                <div class="flex justify-between items-start mb-2 gap-2">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-bold text-sm flex-shrink-0">${escapeHtml(initials)}</div>
                        <div class="min-w-0">
                            <div class="font-semibold text-sm text-gray-900 truncate">${name}</div>
                            <div class="flex gap-0.5 mt-0.5">${starsHtml}</div>
                        </div>
                    </div>
                    <span class="text-xs text-gray-400 flex-shrink-0">${escapeHtml(r.created_at || '')}</span>
                </div>
                <p class="text-sm text-gray-600 whitespace-pre-wrap break-words">${escapeHtml(r.comment || '')}</p>
            </div>`;
        }

        async function loadProductReviewsForDetail(productId) {
            setProductReviewStarCount(0);
            productReviewSelected = 0;
            const ta = document.getElementById('product-review-comment');
            if (ta) ta.value = '';
            updateProductReviewLoginHint();
            const listEl = document.getElementById('product-reviews-list');
            const badge = document.getElementById('product-reviews-count-badge');
            if (listEl) {
                listEl.innerHTML = `<p class="text-sm text-gray-500 py-2">${isRTL ? 'جاري التحميل…' : 'Loading…'}</p>`;
            }
            try {
                const data = await apiFetch(`/api/products/${productId}/reviews`, { requireAuth: false });
                const avg = data.average;
                const count = Number(data.count || 0);
                const avgEl = document.getElementById('product-detail-rating-avg');
                if (avgEl) avgEl.textContent = avg != null ? String(avg) : '—';
                const disp = document.getElementById('product-detail-stars-display');
                if (disp) disp.innerHTML = renderFiveStarsDisplayHtml(avg);
                const cntEl = document.getElementById('product-detail-rating-count-label');
                if (cntEl) {
                    cntEl.textContent = isRTL ? `${count} تقييم` : `${count} review${count === 1 ? '' : 's'}`;
                }
                if (badge) badge.textContent = String(count);
                const items = Array.isArray(data.items) ? data.items : [];
                if (listEl) {
                    if (!items.length) {
                        listEl.innerHTML = `<p class="text-sm text-gray-500 py-2">${isRTL ? 'لا تقييمات بعد. كن أول من يقيّم بالأسفل.' : 'No reviews yet. Be the first below.'}</p>`;
                    } else {
                        listEl.innerHTML = items.map((r) => renderProductReviewCardHtml(r)).join('');
                    }
                }
            } catch (_e) {
                if (listEl) {
                    listEl.innerHTML = `<p class="text-sm text-red-500 py-2">${isRTL ? 'تعذر تحميل التقييمات' : 'Could not load reviews'}</p>`;
                }
            }
        }

        function updateProductReviewLoginHint() {
            const hint = document.getElementById('product-review-login-hint');
            if (!hint) return;
            hint.classList.toggle('hidden', !!getStoredJwtToken());
        }

        function setProductReviewStarCount(n) {
            productReviewSelected = Math.min(5, Math.max(0, n));
            document.querySelectorAll('.product-review-star').forEach((btn) => {
                const v = Number(btn.getAttribute('data-star'));
                const icon = btn.querySelector('i');
                if (!icon) return;
                const on = productReviewSelected >= 1 && v <= productReviewSelected;
                icon.className = on ? 'fas fa-star text-amber-400' : 'far fa-star text-gray-300';
            });
        }

        function initProductReviewStars() {
            document.querySelectorAll('.product-review-star').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const v = Number(btn.getAttribute('data-star'));
                    if (v >= 1 && v <= 5) setProductReviewStarCount(v);
                });
            });
        }

        async function submitProductReview() {
            if (!currentProductDetail || !currentProductDetail.id) return;
            if (!getStoredJwtToken()) {
                openAuthModal('login', isRTL ? 'سجّل الدخول لإرسال تقييم المنتج' : 'Log in to review this product');
                return;
            }
            if (productReviewSelected < 1 || productReviewSelected > 5) {
                showToast(isRTL ? 'اختر من نجمة إلى خمس نجوم' : 'Choose 1–5 stars');
                return;
            }
            const ta = document.getElementById('product-review-comment');
            const comment = ta ? ta.value.trim() : '';
            try {
                await apiFetch('/api/product-reviews', {
                    method: 'POST',
                    requireAuth: true,
                    body: { product_id: currentProductDetail.id, stars: productReviewSelected, comment: comment || undefined },
                });
                if (ta) ta.value = '';
                setProductReviewStarCount(0);
                productReviewSelected = 0;
                showToast(isRTL ? 'تم إرسال تقييمك' : 'Your review was sent');
                await loadProductReviewsForDetail(currentProductDetail.id);
            } catch (e) {
                showToast(e.message || (isRTL ? 'تعذر الإرسال' : 'Could not send'));
            }
        }

        function backFromProductDetail() {
            if (adoraNavStack.length > 1 && adoraNavStack[adoraNavStack.length - 1] === 'screen-product') {
                adoraNavStack.pop();
                const prev = adoraNavStack[adoraNavStack.length - 1];
                navigateTo(prev, { skipHistory: true });
                try {
                    history.replaceState(
                        { adora: 1, screen: prev },
                        '',
                        window.location.pathname + window.location.search + window.location.hash
                    );
                } catch (_e) {}
                persistAdoraSessionState();
            } else {
                history.back();
            }
        }

        function captureProductDeepLinkFromUrl() {
            try {
                const u = new URL(window.location.href);
                const p = u.searchParams.get('p') || u.searchParams.get('product');
                if (p && /^\d+$/.test(String(p).trim())) {
                    sessionStorage.setItem('adora_deeplink_product', String(p).trim());
                }
            } catch (_e) {}
        }

        function stripProductQueryFromUrl() {
            try {
                const u = new URL(window.location.href);
                if (!u.searchParams.has('p') && !u.searchParams.has('product')) return;
                u.searchParams.delete('p');
                u.searchParams.delete('product');
                const q = u.searchParams.toString();
                history.replaceState(
                    { adora: 1, screen: currentScreen },
                    '',
                    u.pathname + (q ? `?${q}` : '') + u.hash
                );
            } catch (_e) {}
        }

        function consumeProductDeepLink() {
            try {
                const raw = sessionStorage.getItem('adora_deeplink_product');
                if (!raw || !/^\d+$/.test(raw)) return;
                const id = Number(raw);
                sessionStorage.removeItem('adora_deeplink_product');
                stripProductQueryFromUrl();
                setTimeout(() => {
                    openProductDetail(id).catch(() => {});
                }, 400);
            } catch (_e) {}
        }

        function getProductShareUrl() {
            const id = currentProductDetail?.id;
            if (!id) return String(window.location.href || '').split('#')[0];
            try {
                const u = new URL(window.location.href);
                u.searchParams.set('p', String(id));
                u.hash = '';
                return u.toString();
            } catch (_e) {
                return `${window.location.origin}${window.location.pathname}?p=${encodeURIComponent(String(id))}`;
            }
        }

        function getProductShareMessage() {
            const p = currentProductDetail;
            if (!p) return '';
            const title = isRTL ? (p.name_ar || p.name_en || '') : (p.name_en || p.name_ar || '');
            return String(title).trim();
        }

        async function copyTextToClipboard(text) {
            const t = String(text || '');
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(t);
                    return true;
                }
            } catch (_e) {}
            try {
                const ta = document.createElement('textarea');
                ta.value = t;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                return true;
            } catch (_e) {}
            return false;
        }

        function openProductShareModal() {
            if (!currentProductDetail || !currentProductDetail.id) {
                showToast(isRTL ? 'افتح منتجاً أولاً' : 'Open a product first');
                return;
            }
            const el = document.getElementById('product-share-modal');
            if (!el) return;
            el.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeProductShareModal() {
            document.getElementById('product-share-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        function shareProductWhatsApp() {
            const url = getProductShareUrl();
            const msg = getProductShareMessage();
            const text = msg ? `${msg}\n${url}` : url;
            const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
            window.open(wa, '_blank', 'noopener,noreferrer');
            closeProductShareModal();
        }

        function shareProductFacebook() {
            const url = getProductShareUrl();
            const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
            window.open(fb, '_blank', 'noopener,noreferrer');
            closeProductShareModal();
        }

        async function shareProductInstagram() {
            const url = getProductShareUrl();
            const ok = await copyTextToClipboard(url);
            showToast(
                ok
                    ? isRTL
                        ? 'تم نسخ الرابط — الصقه في ستوري إنستغرام'
                        : 'Link copied — paste it in your Instagram story'
                    : isRTL
                      ? 'تعذر النسخ'
                      : 'Could not copy'
            );
            closeProductShareModal();
        }

        async function copyProductShareLink() {
            const url = getProductShareUrl();
            const ok = await copyTextToClipboard(url);
            showToast(ok ? (isRTL ? 'تم نسخ الرابط' : 'Link copied') : isRTL ? 'تعذر النسخ' : 'Could not copy');
            closeProductShareModal();
        }

        function renderTopBrands() {
            const container = document.getElementById('top-brands');
            if (!container) return;
            const MAIN_CAT_LABELS = {
                Men: { en: 'Men', ar: 'رجالي' },
                Women: { en: 'Women', ar: 'نسائي' },
                Kids: { en: 'Kids', ar: 'ولادي' },
            };
            const tops = apiBrandsList.filter((b) => Number(b.is_top_brand));
            if (tops.length) {
                container.innerHTML = tops
                    .map((b) => {
                        const nameEnc = encodeURIComponent(String(b.name || ''));
                        let sc = Array.isArray(b.showcase_categories) ? b.showcase_categories.map(String) : [];
                        sc = sc.filter((c) => ['Men', 'Women', 'Kids'].includes(c));
                        if (!sc.length) sc = ['Men', 'Women', 'Kids'];
                        const chips = sc
                            .map((cat) => {
                                const lab = MAIN_CAT_LABELS[cat] || { en: cat, ar: cat };
                                const t = isRTL ? lab.ar : lab.en;
                                return `<button type="button" class="top-brand-cat-chip shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-purple-100 bg-white text-purple-700 hover:bg-purple-50 transition" data-brand-name="${nameEnc}" data-main-cat="${cat}">${escapeHtml(t)}</button>`;
                            })
                            .join('');
                        return `                        <div class="w-36 flex-shrink-0 flex flex-col gap-2">
                            <button type="button" class="top-brand-card cursor-pointer text-start border-0 bg-transparent p-0 w-full" data-brand-name="${nameEnc}">
                                <div class="w-14 h-14 rounded-2xl bg-gray-100 mb-2 overflow-hidden flex items-center justify-center shadow-sm ring-1 ring-black/5">
                                    ${b.logo ? `<img src="${escapeHtml(b.logo)}" class="w-full h-full object-cover" alt="">` : `<span class="text-xl font-bold text-purple-600">${escapeHtml(String(b.name || '').charAt(0))}</span>`}
                                </div>
                                <h4 class="font-bold text-gray-900 truncate">${escapeHtml(b.name)}</h4>
                            </button>
                            <div class="flex flex-wrap gap-1">${chips}</div>
                        </div>`;
                    })
                    .join('');
                return;
            }
            container.innerHTML = `<p class="text-xs text-gray-500 px-1 py-4 leading-relaxed">${
                isRTL ? 'لا توجد علامات مميزة لعرضها حالياً.' : 'No featured brands to show yet.'
            }</p>`;
        }

        function renderFlashSale() {
            const container = document.getElementById('flash-sale-scroll');
            if (!container) return;
            if (!flashSaleItems.length) {
                container.innerHTML = `<p class="text-sm text-gray-500 text-center py-6 px-2 leading-relaxed">${
                    isRTL ? 'لا توجد عروض سريعة نشطة حالياً.' : 'No active flash offers right now.'
                }</p>`;
                return;
            }
            container.innerHTML = flashSaleItems.map((item) => {
                const title = isRTL ? item.name.ar : item.name.en;
                const pid = Number(item.id);
                const imgSrc = item.image ? escapeHtml(item.image) : escapeHtml(adoraPlaceholderImageUrl());
                const safeTitle = escapeHtml(String(title || ''));
                const br = item.brand ? escapeHtml(String(item.brand)) : '';
                const brandLine = br
                    ? `<p class="text-[8px] text-violet-700 font-semibold line-clamp-1 mb-0.5 text-left" dir="auto">${br}</p>`
                    : '';
                return `<div class="flash-card" role="button" tabindex="0" onclick="openProductDetail(${pid})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProductDetail(${pid});}">
                            <div class="flash-card-thumb"><img src="${imgSrc}" alt=""></div>
                            <p class="text-xs text-gray-500" data-en="Ends soon" data-ar="ينتهي قريباً">Ends soon</p>
                            ${brandLine}
                            <h4>${safeTitle}</h4>
                            <div class="flash-price">
                                <span class="old">${formatSyp(item.old)}</span>
                                <span class="current">${formatSyp(item.now)}</span>
                            </div>
                            <span class="flash-badge">${escapeHtml(String(item.discount || ''))}</span>
                        </div>`;
            }).join('');
        }

        function initFlashCountdown() {
            const fc = document.getElementById('flash-countdown');
            if (flashCountdownInterval) clearInterval(flashCountdownInterval);
            if (!flashSaleItems.length) {
                if (fc) fc.textContent = '—';
                return;
            }
            updateFlashCountdownDisplay();
            flashCountdownInterval = setInterval(() => {
                if (flashSaleRemaining <= 0) {
                    clearInterval(flashCountdownInterval);
                    return;
                }
                flashSaleRemaining--;
                updateFlashCountdownDisplay();
            }, 1000);
        }

        async function loadHomeFeaturedGrid() {
            const grid = document.getElementById('home-featured-grid');
            if (!grid) return;
            try {
                const products = await apiFetch('/api/products?featured=1&adora_only=1', { requireAuth: false });
                const list = Array.isArray(products) ? products.slice(0, 28) : [];
                if (!list.length) {
                    grid.className = '';
                    grid.innerHTML = `<p class="text-center text-gray-500 text-sm py-8 leading-relaxed px-3 w-[min(100%,22rem)]">${
                        isRTL ? 'لا توجد منتجات مميزة لعرضها حالياً.' : 'No featured picks to show yet.'
                    }</p>`;
                    return;
                }
                grid.className = 'home-product-strip';
                grid.innerHTML = list.map((p) => renderProductCardHtml(p, { compact: true })).join('');
            } catch (_e) {
                grid.className = '';
                grid.innerHTML = `<p class="text-center text-red-500 text-sm py-6 px-3 w-[min(100%,22rem)]">${isRTL ? 'تعذر التحميل' : 'Load failed'}</p>`;
            }
        }

        async function loadHomeNewCollectionGrid() {
            const grid = document.getElementById('home-new-collection-grid');
            if (!grid) return;
            try {
                const products = await apiFetch('/api/products?new_collection=1', { requireAuth: false });
                const list = Array.isArray(products) ? products.slice(0, 36) : [];
                if (!list.length) {
                    grid.className = '';
                    grid.innerHTML = `<p class="text-center text-white/85 text-xs py-4 leading-relaxed px-3 w-[min(100vw-2rem,22rem)]">${
                        isRTL ? 'فعّل «الظهور في البانر» من إعدادات المنتج في لوحة التحكم.' : 'Enable the banner & list option on products in the admin panel.'
                    }</p>`;
                    return;
                }
                grid.className = 'home-product-strip';
                grid.innerHTML = list.map((p) => renderProductCardHtml(p, { compact: true })).join('');
            } catch (_e) {
                grid.className = '';
                grid.innerHTML = `<p class="text-center text-red-200 text-xs py-4 px-3 w-[min(100vw-2rem,22rem)]">${isRTL ? 'تعذر التحميل' : 'Load failed'}</p>`;
            }
        }

        async function loadHomeBestsellers() {
            const el = document.getElementById('home-bestsellers-scroll');
            if (!el) return;
            try {
                const rows = await apiFetch('/api/bestsellers?limit=14', { requireAuth: false });
                const list = Array.isArray(rows) ? rows : [];
                if (!list.length) {
                    el.innerHTML = `<p class="text-sm text-gray-500 py-6 px-2">${
                        isRTL ? 'لا مبيعات بعد — تظهر هنا بعد أول طلبات.' : 'No sales yet — appears after orders.'
                    }</p>`;
                    return;
                }
                el.innerHTML = list
                    .map((p) => {
                        const img = p.images && p.images.length ? p.images[0] : adoraPlaceholderImageUrl();
                        const name = isRTL ? p.name_ar : p.name_en;
                        const br = resolveDisplayBrand(p.brand);
                        const brandLine = br
                            ? `<p class="text-[8px] text-violet-700 font-semibold line-clamp-1 mb-0.5 text-left" dir="auto">${escapeHtml(br)}</p>`
                            : '';
                        const listP = productListPrice(p);
                        const disc = productDiscountPct(p);
                        const saleP = productSaleUnitPrice(p);
                        const badge =
                            disc > 0
                                ? `<span class="absolute top-2 left-2 badge-sale text-white text-[10px] font-bold px-2 py-1 rounded-full">-${Math.round(disc)}%</span>`
                                : '';
                        return `<div onclick="openProductDetail(${p.id})" class="home-bestseller-card flex-shrink-0 w-[6.5rem] bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden cursor-pointer">
                        <div class="aspect-[3/4] max-h-[102px] relative">
                            <img src="${escapeHtml(img)}" class="w-full h-full object-cover" alt="" loading="lazy" decoding="async">
                            ${badge}
                        </div>
                        <div class="p-1.5">
                            ${brandLine}
                            <h4 class="font-semibold text-[10px] text-gray-900 line-clamp-2 leading-tight">${escapeHtml(name)}</h4>
                            <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                <span class="font-bold text-purple-600 text-[10px]">${formatSyp(saleP)}</span>
                                ${disc > 0 ? `<span class="text-[8px] text-gray-400 line-through">${formatSyp(listP)}</span>` : ''}
                            </div>
                        </div>
                    </div>`;
                    })
                    .join('');
            } catch (_e) {
                el.innerHTML = `<p class="text-sm text-red-500 py-6">${isRTL ? 'تعذر التحميل' : 'Load failed'}</p>`;
            }
        }

        function __clearBannerCarouselTimers() {
            const arr = window.__adoraBannerCarouselTimers;
            if (Array.isArray(arr)) arr.forEach((id) => clearInterval(id));
            window.__adoraBannerCarouselTimers = [];
            const ros = window.__adoraBannerResizeObservers;
            if (Array.isArray(ros)) {
                ros.forEach((ro) => {
                    try {
                        ro.disconnect();
                    } catch (_e) {}
                });
                window.__adoraBannerResizeObservers = [];
            }
        }

        /** بانر: تمرير أفقي يدوي + شريط تمرير، وتبديل تلقائي كل 2s (مع احترام تقليل الحركة) */
        function __mountAdoraBannerSlider(host, banners) {
            const n = banners.length;
            if (!n) {
                host.innerHTML = '';
                return;
            }
            const slidesHtml = banners
                .map((b) => {
                    const title = isRTL ? b.title_ar || b.title_en : b.title_en || b.title_ar;
                    const bodyTxt = isRTL ? b.body_ar || b.body_en : b.body_en || b.body_ar;
                    const rawUrl = b.image_url != null ? String(b.image_url).trim() : '';
                    const imgAbs = absoluteMediaUrl(rawUrl);
                    const hasImg = !!imgAbs;
                    const linkRaw = b.link_url != null ? String(b.link_url).trim() : '';
                    const linkHref =
                        linkRaw && (linkRaw.startsWith('http://') || linkRaw.startsWith('https://') || linkRaw.startsWith('mailto:') || linkRaw.startsWith('tel:'))
                            ? linkRaw
                            : linkRaw
                              ? absoluteMediaUrl(linkRaw)
                              : '';
                    const linkLine = linkHref
                        ? `<a href="${escapeHtml(linkHref)}" target="_blank" rel="noopener noreferrer" class="inline-block mt-1 text-[11px] font-semibold text-white underline underline-offset-2">${isRTL ? 'افتح الرابط' : 'Open link'}</a>`
                        : '';
                    if (hasImg) {
                        return `<div class="adora-banner-slide relative h-[200px] shrink-0 overflow-hidden bg-gray-200 snap-start snap-always">
  <img src="${escapeHtml(imgAbs)}" alt="" class="absolute inset-0 z-0 h-full w-full object-cover" style="object-position:center center" width="1200" height="400" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-adora-banner-img="1" />
  <div class="absolute inset-x-0 bottom-0 z-[1] px-3 pb-2.5 pt-10 bg-gradient-to-t from-black/70 via-black/35 to-transparent">
    ${title ? `<p class="text-[13px] font-bold leading-tight text-white drop-shadow-sm line-clamp-1">${escapeHtml(title)}</p>` : ''}
    ${bodyTxt ? `<p class="mt-0.5 text-[11px] leading-snug text-white/95 line-clamp-2">${escapeHtml(bodyTxt)}</p>` : ''}
    ${linkLine}
  </div>
</div>`;
                    }
                    return `<div class="adora-banner-slide relative flex h-[200px] shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-purple-600 to-pink-600 px-4 text-center snap-start snap-always">
  <div class="max-w-full">
    ${title ? `<p class="text-[14px] font-bold text-white drop-shadow">${escapeHtml(title)}</p>` : ''}
    ${bodyTxt ? `<p class="mt-1 text-[12px] leading-snug text-white/95 line-clamp-3">${escapeHtml(bodyTxt)}</p>` : ''}
    ${linkLine}
  </div>
</div>`;
                })
                .join('');
            host.innerHTML = `<div class="adora-banner-slider-viewport adora-banner-scroll relative w-full shadow-md snap-x snap-mandatory" style="height:200px;border-radius:16px">
  <div dir="ltr" class="adora-banner-slider-track flex h-[200px]">
    ${slidesHtml}
  </div>
</div>`;
            const vp = host.querySelector('.adora-banner-slider-viewport');
            const track = host.querySelector('.adora-banner-slider-track');
            const slides = track ? Array.from(track.querySelectorAll('.adora-banner-slide')) : [];
            if (!vp || !track || !slides.length) return;

            let idx = 0;
            let resizeTimer = null;
            let layoutZeroRetries = 0;
            let scrollSyncTimer = null;

            function slideW() {
                return vp.offsetWidth || 0;
            }

            function layout() {
                const w = slideW();
                if (!w) {
                    if (layoutZeroRetries < 12) {
                        layoutZeroRetries += 1;
                        requestAnimationFrame(() => layout());
                    }
                    return;
                }
                layoutZeroRetries = 0;
                slides.forEach((el) => {
                    el.style.flexShrink = '0';
                    el.style.flex = `0 0 ${w}px`;
                    el.style.minWidth = `${w}px`;
                    el.style.width = `${w}px`;
                });
                idx = Math.max(0, Math.min(n - 1, idx));
                vp.scrollTo({ left: idx * w, behavior: 'auto' });
            }

            function syncIdxFromScroll() {
                const w = slideW();
                if (!w) return;
                const i = Math.round(vp.scrollLeft / w);
                idx = Math.max(0, Math.min(n - 1, i));
            }

            function onResize() {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    idx = Math.min(idx, Math.max(0, n - 1));
                    layout();
                }, 80);
            }

            layout();
            setTimeout(() => layout(), 0);
            setTimeout(() => layout(), 120);

            vp.addEventListener(
                'scroll',
                () => {
                    clearTimeout(scrollSyncTimer);
                    scrollSyncTimer = setTimeout(syncIdxFromScroll, 50);
                },
                { passive: true }
            );

            if (typeof ResizeObserver !== 'undefined') {
                try {
                    const ro = new ResizeObserver(() => layout());
                    ro.observe(vp);
                    window.__adoraBannerResizeObservers = window.__adoraBannerResizeObservers || [];
                    window.__adoraBannerResizeObservers.push(ro);
                } catch (_e) {
                    window.addEventListener('resize', onResize);
                }
            } else {
                window.addEventListener('resize', onResize);
            }

            if (n < 2) return;
            let reduced = false;
            try {
                reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            } catch (_e2) {}
            if (!reduced) {
                const id = setInterval(() => {
                    const w = slideW();
                    if (!w) return;
                    idx = (idx + 1) % n;
                    vp.scrollTo({ left: idx * w, behavior: 'smooth' });
                }, 2000);
                window.__adoraBannerCarouselTimers = window.__adoraBannerCarouselTimers || [];
                window.__adoraBannerCarouselTimers.push(id);
            }
        }

        /** يطابق placement من الـ API مع id العناصر banner-slot-* (مسافات، شرطات، حالة أحرف) */
        function normalizeBannerPlacement(pl) {
            let s = String(pl ?? '')
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, '_')
                .replace(/_+/g, '_');
            if (!s) return '';
            const aliases = {
                hometop: 'home_top',
                top: 'home_top',
                belowcategories: 'below_categories',
                belowbrands: 'below_brands',
                belowtopbrands: 'below_top_brands',
                belowflash: 'below_flash',
                belowcurated: 'below_curated',
                belowtrending: 'below_trending',
            };
            return aliases[s] || s;
        }

        async function injectHomeBanners() {
            const placementsFallback = [
                'home_top',
                'below_categories',
                'below_brands',
                'below_top_brands',
                'below_flash',
                'below_curated',
                'below_trending',
            ];
            try {
                __clearBannerCarouselTimers();
                let rows;
                try {
                    rows = await apiFetch('/api/banners', { requireAuth: false, cache: 'no-store' });
                } catch (err) {
                    try {
                        console.warn('[Adora] /api/banners failed:', err?.message || err);
                    } catch (_e) {}
                    rows = [];
                }
                const list = Array.isArray(rows) ? rows : [];
                const byPl = {};
                for (const b of list) {
                    const pl = normalizeBannerPlacement(b.placement);
                    if (!pl) continue;
                    if (!byPl[pl]) byPl[pl] = [];
                    byPl[pl].push(b);
                }
                const slotHosts = document.querySelectorAll('[id^="banner-slot-"]');
                const slotIds = new Set();
                slotHosts.forEach((el) => {
                    if (el.id) slotIds.add(el.id.replace(/^banner-slot-/, ''));
                });
                const keysToRender = new Set([...placementsFallback, ...Object.keys(byPl), ...slotIds]);
                keysToRender.forEach((rawKey) => {
                    const pl = normalizeBannerPlacement(rawKey);
                    if (!pl) return;
                    const host = document.getElementById(`banner-slot-${pl}`);
                    if (!host) return;
                    const banners = byPl[pl] || [];
                    if (!banners.length) {
                        host.innerHTML = '';
                        return;
                    }
                    __mountAdoraBannerSlider(host, banners);
                });
            } catch (err) {
                try {
                    console.warn('[Adora] injectHomeBanners:', err?.message || err);
                } catch (_e) {}
                document.querySelectorAll('[id^="banner-slot-"]').forEach((host) => {
                    host.innerHTML = '';
                });
            }
        }

        async function syncFlashSaleFromApi() {
            try {
                const products = await apiFetch('/api/products?flash=1', { requireAuth: false });
                if (!Array.isArray(products) || products.length === 0) {
                    flashSaleItems.splice(0, flashSaleItems.length);
                    return;
                }

                const first = products[0];
                if (first.flash_sale_end_time) {
                    const end = new Date(first.flash_sale_end_time).getTime();
                    const now = Date.now();
                    const diffSeconds = Math.floor((end - now) / 1000);
                    if (!isNaN(diffSeconds) && diffSeconds > 0) {
                        flashSaleRemaining = diffSeconds;
                    }
                }

                const mapped = products.slice(0, 4).map((p) => {
                    const discountPercent = Number(p.discount || 0);
                    const listPrice = Number(p.price || 0);
                    let nowPrice = listPrice;
                    let oldPrice = listPrice;
                    if (discountPercent > 0 && discountPercent < 100) {
                        nowPrice = listPrice * (1 - discountPercent / 100);
                        oldPrice = listPrice;
                    }
                    const rawImg = p.images && p.images.length ? p.images[0] : '';
                    return {
                        id: Number(p.id),
                        image: rawImg ? absoluteMediaUrl(rawImg) : '',
                        name: { en: p.name_en, ar: p.name_ar },
                        brand: resolveDisplayBrand(p.brand),
                        old: oldPrice,
                        now: nowPrice,
                        discount: `${discountPercent}% OFF`,
                    };
                });

                flashSaleItems.splice(0, flashSaleItems.length, ...mapped);
            } catch (_e) {
                flashSaleItems.splice(0, flashSaleItems.length);
            }
        }

        function updateFlashCountdownDisplay() {
            const target = document.getElementById('flash-countdown');
            if (!target) return;
            const hours = Math.floor(flashSaleRemaining / 3600);
            const minutes = Math.floor((flashSaleRemaining % 3600) / 60);
            const seconds = flashSaleRemaining % 60;
            target.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        async function refreshSideMenuHeader() {
            const displayName = document.getElementById('side-menu-display-name');
            const guestActions = document.getElementById('side-menu-guest-actions');
            const userBadge = document.getElementById('side-menu-user-badge');
            const logoutBtn = document.getElementById('side-menu-logout-btn');
            const panel = document.getElementById('side-drawer-panel');
            if (panel) panel.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
            const token = getStoredJwtToken();
            if (!token) {
                if (displayName) displayName.textContent = isRTL ? 'زائر' : 'Guest';
                guestActions?.classList.remove('hidden');
                userBadge?.classList.add('hidden');
                logoutBtn?.classList.add('hidden');
                document.getElementById('side-menu-notif-row')?.classList.add('hidden');
                document.getElementById('side-menu-notifications-btn')?.classList.add('hidden');
                return;
            }
            guestActions?.classList.add('hidden');
            userBadge?.classList.remove('hidden');
            logoutBtn?.classList.remove('hidden');
            document.getElementById('side-menu-notif-row')?.classList.remove('hidden');
            document.getElementById('side-menu-notifications-btn')?.classList.remove('hidden');
            try {
                const data = await apiFetch('/api/profile', { requireAuth: true });
                if (displayName) displayName.textContent = data.user?.name || (isRTL ? 'مستخدم' : 'User');
            } catch {
                if (displayName) displayName.textContent = isRTL ? 'مستخدم' : 'User';
            }
            document.querySelectorAll('.side-menu-chevron').forEach((el) => {
                el.classList.remove('fa-chevron-left', 'fa-chevron-right');
                el.classList.add(isRTL ? 'fa-chevron-left' : 'fa-chevron-right');
            });
        }

        function openSideDrawer() {
            document.getElementById('side-drawer-backdrop')?.classList.add('open');
            document.getElementById('side-drawer-panel')?.classList.add('open');
            document.body.style.overflow = 'hidden';
            refreshSideMenuHeader().catch(() => {});
        }

        function restoreBodyScrollIfIdle() {
            const overlayIds = [
                'orders-list-modal',
                'profile-edit-modal',
                'contact-info-modal',
                'auth-modal',
                'filter-modal',
                'order-options-modal',
                'signup-credentials-modal',
                'notification-prompt-modal',
                'language-prompt-modal',
                'download-prompt-modal',
                'auth-gate-screen',
                'session-resume-overlay',
                'app-broadcasts-modal',
                'product-share-modal',
            ];
            const anyOpen = overlayIds.some((id) => {
                const el = document.getElementById(id);
                return el && !el.classList.contains('hidden');
            });
            if (!anyOpen) document.body.style.overflow = '';
        }

        function closeSideDrawer(skipRestore) {
            document.getElementById('side-drawer-backdrop')?.classList.remove('open');
            document.getElementById('side-drawer-panel')?.classList.remove('open');
            if (!skipRestore) restoreBodyScrollIfIdle();
        }

        function toggleCategoriesMenu() {
            const panel = document.getElementById('side-drawer-panel');
            if (panel?.classList.contains('open')) closeSideDrawer();
            else openSideDrawer();
        }

        function sideMenuOpenAuth() {
            closeSideDrawer(true);
            openAuthModal('signup');
        }

        async function sideMenuTrackOrders() {
            if (!getStoredJwtToken()) {
                closeSideDrawer(true);
                openAuthModal('login', isRTL ? 'سجّل الدخول لعرض طلباتك' : 'Log in to view your orders');
                return;
            }
            closeSideDrawer(true);
            await openOrdersListModal();
        }

        async function sideMenuDownloadApp() {
            closeSideDrawer(true);
            const pwaOk = await tryInstallAdoraPwa();
            if (pwaOk) return;
            if (isIosSafariLike()) {
                showPwaManualInstallHint();
                return;
            }
            const url = await resolveAppDownloadUrl();
            if (url && /^https?:\/\//i.test(url)) {
                window.open(url, '_blank', 'noopener,noreferrer');
                return;
            }
            showPwaManualInstallHint();
        }

        function sideMenuOpenProfileEdit() {
            if (!getStoredJwtToken()) {
                closeSideDrawer(true);
                openAuthModal('login', isRTL ? 'سجّل الدخول لعرض الملف الشخصي' : 'Log in to view your profile');
                return;
            }
            closeSideDrawer(true);
            openProfileEditModal();
        }

        function openAccountSettingsFromProfile() {
            if (!getStoredJwtToken()) {
                openAuthModal('login', isRTL ? 'سجّل الدخول لتعديل الإعدادات' : 'Log in to change account settings');
                return;
            }
            openProfileEditModal();
        }

        function clearProfilePasswordFields() {
            ['profile-edit-current-password', 'profile-edit-new-password', 'profile-edit-confirm-password'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        }

        async function sideMenuOpenContact() {
            closeSideDrawer(true);
            await openContactInfoModal();
        }

        function sideMenuOpenNotifications() {
            closeSideDrawer(true);
            openAppBroadcastsModal();
        }

        function logoutFromSideMenu() {
            logout();
        }

        function getOrderStatusLabel(status) {
            const key = normalizeOrderStatus(status);
            const step = orderStatusFlow.find((s) => s.key === key);
            if (!step) return status || '';
            return isRTL ? step.ar : step.en;
        }

        function renderMiniTimeline(currentStatus) {
            const idx = Math.max(0, orderStatusFlow.findIndex((s) => s.key === normalizeOrderStatus(currentStatus)));
            return `<div class="flex justify-between gap-1 mt-3 pt-3 border-t border-gray-100">
                ${orderStatusFlow.map((step, i) => {
                    const on = i <= idx;
                    return `<div class="flex-1 text-center">
                        <div class="h-1.5 rounded-full ${on ? 'bg-purple-600' : 'bg-gray-200'} mb-1"></div>
                        <span class="text-[10px] font-semibold ${on ? 'text-purple-700' : 'text-gray-400'}">${isRTL ? step.ar : step.en}</span>
                    </div>`;
                }).join('')}
            </div>`;
        }

        async function openOrdersListModal() {
            const modal = document.getElementById('orders-list-modal');
            const body = document.getElementById('orders-list-modal-body');
            if (!modal || !body) return;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            body.innerHTML = `<p class="text-center text-gray-500 py-8">${isRTL ? 'جاري التحميل...' : 'Loading...'}</p>`;
            try {
                const orders = await apiFetch('/api/orders', { requireAuth: true });
                if (!Array.isArray(orders) || orders.length === 0) {
                    body.innerHTML = `<p class="text-center text-gray-500 py-8">${isRTL ? 'لا توجد طلبات بعد' : 'No orders yet'}</p>`;
                    return;
                }
                body.innerHTML = orders.map((o) => {
                    const dateLabel = formatOrderDate(o.created_at);
                    const statusLabel = getOrderStatusLabel(o.status);
                    return `<div class="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                        <div class="flex justify-between items-start gap-2">
                            <div>
                                <div class="text-xs text-gray-500">${escapeHtml(o.order_no || '')}</div>
                                <div class="text-sm font-bold text-gray-900 mt-0.5">${escapeHtml(statusLabel)}</div>
                                <div class="text-xs text-gray-500 mt-1">${escapeHtml(dateLabel)} · ${isRTL ? 'الإجمالي' : 'Total'}: ${formatSyp(Number(o.total_price || 0))}</div>
                            </div>
                            <button type="button" onclick="trackOrderFromListModal(${o.id})" class="shrink-0 px-3 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold shadow-sm">
                                ${isRTL ? 'تتبع' : 'Track'}
                            </button>
                        </div>
                        ${renderMiniTimeline(o.status)}
                        <div id="order-history-${o.id}" class="mt-3 hidden"></div>
                        <button type="button" class="mt-2 text-xs font-semibold text-purple-600" onclick="toggleOrderHistory(${o.id})">
                            ${isRTL ? 'عرض المخطط الزمني' : 'Timeline details'}
                        </button>
                    </div>`;
                }).join('');
            } catch (e) {
                body.innerHTML = `<p class="text-center text-red-600 py-8">${escapeHtml(e.message)}</p>`;
            }
        }

        async function toggleOrderHistory(orderId) {
            const box = document.getElementById(`order-history-${orderId}`);
            if (!box) return;
            if (box.classList.contains('hidden')) {
                box.classList.remove('hidden');
                box.innerHTML = `<p class="text-xs text-gray-500">${isRTL ? 'جاري التحميل...' : 'Loading...'}</p>`;
                try {
                    const t = await apiFetch(`/api/orders/${orderId}/tracking`, { requireAuth: true });
                    const hist = t.history || [];
                    if (!hist.length) {
                        box.innerHTML = `<p class="text-xs text-gray-500">${isRTL ? 'لا يوجد سجل' : 'No history'}</p>`;
                        return;
                    }
                    box.innerHTML = `<div class="space-y-2 border-l-2 border-purple-200 pl-3">
                        ${hist.map((h) => {
                            const lab = getOrderStatusLabel(h.status);
                            const when = formatOrderDate(h.created_at);
                            return `<div class="relative">
                                <span class="absolute -left-[13px] top-1.5 w-2 h-2 rounded-full bg-purple-600"></span>
                                <p class="text-xs font-bold text-gray-900">${escapeHtml(lab)}</p>
                                <p class="text-[10px] text-gray-500">${escapeHtml(when)}</p>
                            </div>`;
                        }).join('')}
                    </div>`;
                } catch {
                    box.innerHTML = `<p class="text-xs text-red-600">${isRTL ? 'تعذر التحميل' : 'Failed to load'}</p>`;
                }
            } else {
                box.classList.add('hidden');
            }
        }

        function trackOrderFromListModal(orderId) {
            closeOrdersListModal();
            openOrderTrackingFromId(orderId);
        }

        function closeOrdersListModal() {
            document.getElementById('orders-list-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        async function openProfileEditModal() {
            const modal = document.getElementById('profile-edit-modal');
            const err = document.getElementById('profile-edit-error');
            if (!modal) return;
            clearProfilePasswordFields();
            if (err) {
                err.classList.add('hidden');
                err.textContent = '';
            }
            try {
                const data = await apiFetch('/api/profile', { requireAuth: true });
                const name = document.getElementById('profile-edit-name');
                const phone = document.getElementById('profile-edit-phone');
                if (name) name.value = data.user?.name || '';
                if (phone) phone.value = data.user?.phone || '';
            } catch {
                showToast(isRTL ? 'تعذر تحميل الملف' : 'Unable to load profile');
                return;
            }
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeProfileEditModal() {
            document.getElementById('profile-edit-modal')?.classList.add('hidden');
            clearProfilePasswordFields();
            restoreBodyScrollIfIdle();
        }

        function mapProfileErrorMessage(msg) {
            const m = String(msg || '').trim();
            const ar = {
                'Current password is incorrect': 'كلمة المرور الحالية غير صحيحة',
                'New password must be at least 6 characters': 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف',
                'Missing password fields': 'أدخل حقول كلمة المرور كاملة',
                'Phone already exists': 'رقم الهاتف مستخدم مسبقاً',
                'Missing name or phone': 'الاسم والهاتف مطلوبان',
            };
            const en = Object.fromEntries(Object.entries(ar).map(([k, v]) => [v, k]));
            if (isRTL && ar[m]) return ar[m];
            if (!isRTL && en[m]) return en[m];
            return m;
        }

        async function saveProfileEdit() {
            const name = document.getElementById('profile-edit-name')?.value.trim();
            const phone = document.getElementById('profile-edit-phone')?.value.trim();
            const curPw = document.getElementById('profile-edit-current-password')?.value || '';
            const newPw = document.getElementById('profile-edit-new-password')?.value || '';
            const confPw = document.getElementById('profile-edit-confirm-password')?.value || '';
            const err = document.getElementById('profile-edit-error');
            const showErr = (t) => {
                if (err) {
                    err.textContent = t;
                    err.classList.remove('hidden');
                }
            };
            if (!name || !phone) {
                showErr(isRTL ? 'أدخل الاسم ورقم الهاتف' : 'Enter name and phone');
                return;
            }
            const wantsPw = curPw.length > 0 || newPw.length > 0 || confPw.length > 0;
            if (wantsPw) {
                if (!curPw || !newPw || !confPw) {
                    showErr(isRTL ? 'أدخل كلمة المرور الحالية والجديدة وتأكيدها' : 'Enter current password, new password, and confirmation');
                    return;
                }
                if (newPw !== confPw) {
                    showErr(isRTL ? 'كلمة المرور الجديدة غير متطابقة' : 'New passwords do not match');
                    return;
                }
                if (newPw.length < 6) {
                    showErr(isRTL ? 'كلمة المرور الجديدة 6 أحرف على الأقل' : 'New password must be at least 6 characters');
                    return;
                }
            }
            if (err) {
                err.classList.add('hidden');
                err.textContent = '';
            }
            try {
                if (wantsPw) {
                    await apiFetch('/api/profile/password', {
                        method: 'PUT',
                        requireAuth: true,
                        body: { current_password: curPw, new_password: newPw },
                    });
                    clearProfilePasswordFields();
                }
                const data = await apiFetch('/api/profile', {
                    method: 'PUT',
                    requireAuth: true,
                    body: { name, phone },
                });
                if (data.token) setStoredJwtToken(data.token);
                closeProfileEditModal();
                await refreshProfileAndOrders();
                showToast(
                    wantsPw
                        ? isRTL
                            ? 'تم حفظ البيانات وكلمة المرور'
                            : 'Account and password updated'
                        : isRTL
                          ? 'تم حفظ التغييرات'
                          : 'Changes saved'
                );
            } catch (e) {
                const raw = e.message || '';
                showErr(mapProfileErrorMessage(raw) || raw);
            }
        }

        async function openContactInfoModal() {
            const modal = document.getElementById('contact-info-modal');
            const body = document.getElementById('contact-info-modal-body');
            if (!modal || !body) return;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            body.innerHTML = `<p class="text-gray-500">${isRTL ? 'جاري التحميل...' : 'Loading...'}</p>`;
            try {
                const data = await apiFetch('/api/contact', { requireAuth: false });
                const phones = data.phones || [];
                const waRaw = (data.whatsapp_phone || '').replace(/\D/g, '');
                const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.address || '')}`;
                body.innerHTML = `
                    <div class="rounded-2xl bg-gray-50 p-4 border border-gray-100">
                        <p class="text-xs font-bold text-gray-500 mb-1">${isRTL ? 'الموقع' : 'Location'}</p>
                        <p class="font-semibold text-gray-900">${escapeHtml(data.address || '')}</p>
                        <a href="${mapLink}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 mt-2 text-purple-600 font-semibold text-sm">
                            <i class="fas fa-map-marker-alt"></i> ${isRTL ? 'فتح في الخرائط' : 'Open in Maps'}
                        </a>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-gray-500 mb-2">${isRTL ? 'أرقام الهاتف' : 'Phone numbers'}</p>
                        <div class="flex flex-col gap-2">
                            ${phones.length ? phones.map((p) => `<a href="tel:${escapeHtml(String(p).replace(/\s/g, ''))}" class="inline-flex items-center gap-2 text-gray-900 font-semibold"><i class="fas fa-phone text-green-600"></i>${escapeHtml(p)}</a>`).join('') : `<span class="text-gray-400">${isRTL ? 'لا يوجد' : 'None'}</span>`}
                        </div>
                    </div>
                    ${data.whatsapp_phone ? `<a href="https://wa.me/${waRaw}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-green-500 text-white font-bold shadow-lg">
                        <i class="fab fa-whatsapp text-xl"></i> ${isRTL ? 'واتساب' : 'WhatsApp'}
                    </a>` : ''}`;
            } catch {
                body.innerHTML = `<p class="text-red-600">${isRTL ? 'تعذر تحميل بيانات التواصل' : 'Failed to load contact info'}</p>`;
            }
        }

        function closeContactInfoModal() {
            document.getElementById('contact-info-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        // Profile
        function logout() {
            if (confirm(isRTL ? 'هل أنت متأكد من تسجيل الخروج؟' : 'Are you sure you want to logout?')) {
                disconnectAppSocket();
                clearStoredJwtToken();
                shouldPersistOrderStatusUpdates = false;
                latestOrderDbId = null;
                latestOrderCreatedAt = null;
                closeSideDrawer();
                refreshSideMenuHeader().catch(() => {});
                showAuthGateOnly();
                showToast(isRTL ? 'تم تسجيل الخروج' : 'Logged out successfully');
            }
        }

        // Toast System
        function showToast(message) {
            const toast = document.getElementById('toast');
            const msgEl = document.getElementById('toast-message');
            msgEl.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2500);
        }

        // Header scroll effect
        window.addEventListener('scroll', () => {
            const header = document.querySelector('.main-header');
            if (window.scrollY > 10) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        });

        // Initialize
        function initBrandClickDelegation() {
            const shell = document.getElementById('app-shell');
            if (!shell) return;
            shell.addEventListener('click', (e) => {
                const chip = e.target.closest('.top-brand-cat-chip[data-brand-name][data-main-cat]');
                if (chip && shell.contains(chip)) {
                    e.preventDefault();
                    const enc = chip.getAttribute('data-brand-name');
                    const cat = chip.getAttribute('data-main-cat');
                    if (!enc || !cat) return;
                    try {
                        openBrandStore(decodeURIComponent(enc), cat);
                    } catch (_) {}
                    return;
                }
                const btn = e.target.closest('.brand-strip-card[data-brand-name], .top-brand-card[data-brand-name]');
                if (!btn || !shell.contains(btn)) return;
                const enc = btn.getAttribute('data-brand-name');
                if (!enc) return;
                e.preventDefault();
                try {
                    openBrandStore(decodeURIComponent(enc));
                } catch (_) {}
            });
        }

        document.addEventListener('DOMContentLoaded', () => {
            try {
                const fromConfig = typeof window.ADORA_API_BASE === 'string' ? window.ADORA_API_BASE.trim() : '';
                const metaApi = document.querySelector('meta[name="adora-api-base"]');
                const c = metaApi && metaApi.getAttribute('content');
                const fromMeta = c && String(c).trim() ? String(c).trim().replace(/\/$/, '') : '';
                if (fromConfig) {
                    apiBaseUrl = fromConfig.replace(/\/$/, '');
                } else if (fromMeta) {
                    apiBaseUrl = fromMeta;
                }
            } catch (_e) {}
            captureProductDeepLinkFromUrl();
            initAdoraNavigationHistory();
            applyHomeContactFromApi()
                .then(() => injectHomeBanners())
                .catch(() => injectHomeBanners());
            loadCartFromStorage();
            loadHomeFeaturedGrid().catch(() => {});
            loadHomeNewCollectionGrid().catch(() => {});
            loadHomeBestsellers().catch(() => {});
            loadMarketplaceHomeStrip().catch(() => {});
            refreshAdoraHomeSubcategoryCounts().catch(() => {});
            updateProfileWishlistUi();
            initOnboardingStorageMigration();
            initBrandClickDelegation();
            initAdoraAuthParticles();
            initSiteRatingStars();
            initProductReviewStars();
            updateSiteRatingLoginHint();
            updateProductReviewLoginHint();
            applyAppLanguage();
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                const ov = document.getElementById('home-subcat-overlay');
                if (ov && !ov.classList.contains('hidden')) closeHomeCategoryPanel();
            });
            initSearchRotatingHint();
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        runProductSearch();
                    }
                });
            }
            document.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('touchstart', () => btn.style.transform = 'scale(0.95)');
                btn.addEventListener('touchend', () => btn.style.transform = 'scale(1)');
            });
            if (shouldSkipSplashOnLoad()) {
                skipSplashAndEnterApp();
            } else {
                initSplash();
            }
            const adoraSwReady = (async () => {
                if (!('serviceWorker' in navigator)) return;
                try {
                    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
                    await navigator.serviceWorker.ready;
                } catch (e) {
                    console.warn('[Adora] SW register failed — Push needs /sw.js on this site (Netlify).', e);
                }
            })();
            void adoraSwReady.finally(() => {
                updateOrderTrackingUI();
                refreshProfileAndOrders().catch(() => {});
            });
            syncBrandsFromApi().catch(() => {});
            syncStoreStatsFromApi().catch(() => {});
            updateBrandSortButtons();
            syncFlashSaleFromApi().finally(() => {
                renderFlashSale();
                initFlashCountdown();
                applyAppLanguage();
            });
        });