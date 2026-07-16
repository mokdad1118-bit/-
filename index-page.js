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
            if (totalSlides <= 1) {
                if (categoryText && slides[0]) {
                    categoryText.textContent = slides[0].getAttribute('data-category') || categoryText.textContent;
                    categoryText.classList.add('active');
                }
                return;
            }
            splashInterval = setInterval(() => {
                slides[currentSlide].classList.remove('active');
                indicators[currentSlide]?.classList.remove('active');
                
                currentSlide = (currentSlide + 1) % totalSlides;
                
                slides[currentSlide].classList.add('active');
                indicators[currentSlide]?.classList.add('active');
                
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
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    injectHomeBanners().catch(() => {});
                    syncAdoraGlobalBackButton();
                });
            });
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
                            return (
                                !!sessionStorage.getItem('adora_deeplink_product') ||
                                !!sessionStorage.getItem('adora_deeplink_mp_product')
                            );
                        } catch (_e) {
                            return false;
                        }
                    })();
                if (!hasDeep) {
                    await restoreAdoraSessionRoute();
                }
                consumeProductDeepLink();
                consumeMarketplaceDeepLink();
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
            const origin = window.location.origin;
            const opts = {
                body,
                icon: `${origin}/icons/adora-icon.png`,
                badge: `${origin}/icons/adora-icon.png`,
                tag: `adora-${payload?.id || 'msg'}`,
                data: { url: resolveNotificationOpenUrl(payload?.link_url) },
                silent: false,
            };
            opts.image =
                payload?.image_url && /^https:\/\//i.test(payload.image_url)
                    ? payload.image_url
                    : `${origin}/icons/adora-image.png`;
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
            consumeMarketplaceDeepLink();
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
        const ADORA_SHIPPING_STRUCTURED_KEY = 'adora_shipping_structured_v2';
        function loadStructuredShippingToForm() {
            try {
                const j = JSON.parse(localStorage.getItem(ADORA_SHIPPING_STRUCTURED_KEY) || 'null');
                if (!j || typeof j !== 'object') return;
                const map = [
                    ['checkout-ship-fullname', 'full_name'],
                    ['checkout-ship-phone', 'phone'],
                    ['checkout-ship-governorate', 'governorate'],
                    ['checkout-ship-region', 'region'],
                    ['checkout-ship-address', 'address'],
                ];
                for (const [id, k] of map) {
                    const el = document.getElementById(id);
                    if (el && j[k]) el.value = String(j[k]);
                }
            } catch (_e) {}
        }
        function getStructuredShippingFromForm() {
            const g = (id) => String(document.getElementById(id)?.value || '').trim();
            return {
                full_name: g('checkout-ship-fullname'),
                phone: g('checkout-ship-phone'),
                governorate: g('checkout-ship-governorate'),
                region: g('checkout-ship-region'),
                address: g('checkout-ship-address'),
            };
        }
        function structuredShippingComplete(s) {
            return (
                s &&
                [s.full_name, s.phone, s.governorate, s.region, s.address].every((x) => String(x || '').trim().length > 0)
            );
        }
        function persistStructuredShipping(s) {
            try {
                localStorage.setItem(ADORA_SHIPPING_STRUCTURED_KEY, JSON.stringify(s));
            } catch (_e) {}
        }
        function cartHasMarketplaceSelected() {
            return getSelectedCartItems().some((it) => effectiveMarketplaceProductId(it) != null);
        }
        function getShippingAddressSummaryForDisplay() {
            const s = getStructuredShippingFromForm();
            if (structuredShippingComplete(s)) {
                const t = [s.full_name, s.phone, `${s.governorate} — ${s.region}`, s.address].join('\n');
                return { ar: t, en: t };
            }
            return getShippingAddress();
        }
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
        const ADORA_CART_KEY = 'adora_cart_v5';
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
            const d = Number(p?.discount ?? p?.discount_percent ?? 0);
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

        /** معرّف منتج السوق من السطر مهما كانت الصيغة (camelCase أو snake_case من التخزين/API) */
        function effectiveMarketplaceProductId(item) {
            if (!item || typeof item !== 'object') return null;
            const a = item.marketplaceProductId != null ? Number(item.marketplaceProductId) : NaN;
            if (Number.isFinite(a) && a > 0) return a;
            const b = item.marketplace_product_id != null ? Number(item.marketplace_product_id) : NaN;
            if (Number.isFinite(b) && b > 0) return b;
            return null;
        }

        function getCartLineKey(item) {
            const mpEff = effectiveMarketplaceProductId(item);
            if (item && mpEff != null) {
                const mpid = mpEff;
                const vo = item.variantOptions;
                if (vo && typeof vo === 'object' && !Array.isArray(vo)) {
                    const keys = Object.keys(vo).sort();
                    if (keys.length) {
                        return `mp_${mpid}__vo:${keys.map((k) => `${k}=${vo[k]}`).join('|')}`;
                    }
                }
                const sz = String(item.size || '').trim();
                const cl = String(item.color || '').trim();
                if (sz || cl) return `mp_${mpid}__${sz}__${cl}`;
                return `mp_${mpid}`;
            }
            const id = item.productId ?? item.id;
            const vo = item.variantOptions;
            if (vo && typeof vo === 'object' && !Array.isArray(vo)) {
                const keys = Object.keys(vo).sort();
                if (keys.length) {
                    return `${id}__vo:${keys.map((k) => `${k}=${vo[k]}`).join('|')}`;
                }
            }
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
            const mpFromSnake = it.marketplace_product_id != null ? Number(it.marketplace_product_id) : NaN;
            if (
                (it.marketplaceProductId == null || !Number.isFinite(Number(it.marketplaceProductId))) &&
                Number.isFinite(mpFromSnake) &&
                mpFromSnake > 0
            ) {
                it.marketplaceProductId = mpFromSnake;
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
                        const meta =
                            (it.variantLabel && String(it.variantLabel).trim()) ||
                            [it.size, it.color].filter(Boolean).join(' · ');
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
            { key: 'delivered', en: 'Delivered to you', ar: 'تم تسليم الطلب للعميل' },
            { key: 'cancelled', en: 'Cancelled', ar: 'ملغي' },
        ];
        const VENDOR_SPLIT_STATUS_UI = {
            vendor_new: { ar: 'طلب جديد', en: 'New order' },
            vendor_accepted: { ar: 'تم القبول', en: 'Accepted' },
            vendor_preparing: { ar: 'قيد التحضير', en: 'Preparing' },
            vendor_shipped: { ar: 'تم الشحن', en: 'Shipped' },
            vendor_delivered: { ar: 'تم التسليم', en: 'Delivered' },
            vendor_cancelled: { ar: 'ملغي', en: 'Cancelled' },
        };
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
        let latestTrackingFulfillments = []; // marketplace vendor sub-orders
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
            checkoutSaveOrderNoHint:
                'بعد إرسال الطلب سيظهر رقم الطلب — احفظه؛ ستصلك إشعاراً تلقائياً عند الاستلام',
            orderSent: 'تم إرسال الطلب إلى النظام',
            orderDetails: 'تفاصيل الطلب:',
            orderTotal: 'السعر الكلي:',
            shippingFree: 'التوصيل: مجاني',
            orderShipped: 'تم شحن الطلب',
            orderDelivered: 'تم التوصيل',
            estimatedDelivery: 'موعد التوصيل المتوقع خلال 3 أيام',
            paymentLabel: 'طريقة الدفع:'
        };
        /** صورة احتياطية عندما لا تتوفر صورة للمنتج */
        function adoraPlaceholderImageUrl() {
            return 'icons/adora-icon.png';
        }
        let flashSaleItems = [];
        const adoraGalleryAutoScrollTimers = {};
        function stopGalleryAutoScroll(galleryDomId) {
            const t = adoraGalleryAutoScrollTimers[galleryDomId];
            if (t) {
                clearInterval(t);
                delete adoraGalleryAutoScrollTimers[galleryDomId];
            }
        }
        function startGalleryAutoScroll(galleryDomId, intervalMs = 4200) {
            stopGalleryAutoScroll(galleryDomId);
            const el = document.getElementById(galleryDomId);
            if (!el) return;
            const children = [...el.children].filter((c) => !c.classList.contains('adora-gallery-top-actions'));
            if (children.length <= 1) return;
            let idx = 0;
            adoraGalleryAutoScrollTimers[galleryDomId] = setInterval(() => {
                idx = (idx + 1) % children.length;
                try {
                    children[idx].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
                } catch (_e) {
                    try {
                        children[idx].scrollIntoView();
                    } catch (_e2) {}
                }
            }, intervalMs);
        }

        /** يستبدل شرائح المعرض فقط؛ أزرار المفضلة/المشاركة/الحفظ ثابتة خارج مسار التمرير (.product-noon-gallery-host) */
        function adoraReplaceGallerySlidesKeepingToolbar(gal, slidesHtml, autoScrollIntervalMs) {
            if (!gal) return;
            const gid = gal.id;
            if (gid) stopGalleryAutoScroll(gid);
            gal.innerHTML = slidesHtml;
            requestAnimationFrame(() => {
                try {
                    gal.scrollLeft = 0;
                } catch (_e) {}
            });
            if (gid && autoScrollIntervalMs && Number(autoScrollIntervalMs) > 0) {
                startGalleryAutoScroll(gid, autoScrollIntervalMs);
            }
        }
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
        /** خريطة optionId → valueId للمنتجات ذات المواصفات الديناميكية */
        let productDetailVariantPick = {};
        let listingSearchDebounceTimer = null;
        /** تبويب «مميز» — قسم الشبكة النشط + بحث ضمن المنتجات المفعّلة من لوحة التحكم */
        let featuredHubSection = null;
        let featuredHubSearchDebounceTimer = null;
        let productDetailBackScreen = 'screen-categories';
        let siteRatingSelected = 0;
        let productReviewSelected = 0;
        let flashSaleRemaining = 1 * 60 * 60 + 45 * 60 + 20;
        let flashCountdownInterval = null;
        let trackingCycleIndex = 0;
        let marketplaceBrowsePreset = null;
        let marketplaceBrowseVendorId = null;
        let marketplaceBrowseSectionId = null;
        let mpAppHomePlacements = null;
        let mpAppHomePlacementsPromise = null;
        function invalidateMpAppHomePlacements() {
            mpAppHomePlacements = null;
            mpAppHomePlacementsPromise = null;
        }
        /** شركات السوق العامة (مع أعلام الظهور في الشرائط) — تُحمَّل مع العلامات */
        let mpVendorsDirectoryCache = [];
        let marketplaceBrowseSectionsCache = [];
        let marketplaceBrowseVendorsCache = [];
        let marketplaceDetailQty = 1;
        let marketplaceDetailVariantPick = {};
        let marketplaceDetailSelectedColorIndex = 0;
        let marketplaceReviewSelected = 0;
        let currentMarketplaceProductDetail = null;

        const ADORA_SESSION_STACK_KEY = 'adora_nav_stack_v1';
        const ADORA_SESSION_LISTING_KEY = 'adora_listing_ctx_v1';
        const ADORA_SESSION_PRODUCT_KEY = 'adora_last_product_id_v1';
        const ADORA_SESSION_MP_PRODUCT_KEY = 'adora_last_mp_product_id_v1';

        const ADORA_VALID_RESTORE_SCREENS = new Set([
            'screen-categories',
            'screen-listing',
            'screen-featured-hub',
            'screen-offers',
            'screen-wishlist',
            'screen-vendor-join',
            'screen-app-ad-inquiry',
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
                if (currentScreen === 'screen-marketplace-product') {
                    const mid = currentMarketplaceProductDetail && currentMarketplaceProductDetail.id;
                    if (mid) {
                        sessionStorage.setItem(ADORA_SESSION_MP_PRODUCT_KEY, String(mid));
                    } else {
                        const pmp = sessionStorage.getItem(ADORA_SESSION_MP_PRODUCT_KEY);
                        if (!pmp) sessionStorage.removeItem(ADORA_SESSION_MP_PRODUCT_KEY);
                    }
                } else {
                    sessionStorage.removeItem(ADORA_SESSION_MP_PRODUCT_KEY);
                }
            } catch (_e) {}
        }

        function setActiveNavForScreen(screenId) {
            const keys = [
                'screen-categories',
                'screen-listing',
                'screen-featured-hub',
                'screen-offers',
                'screen-cart',
                'screen-profile',
            ];
            document.querySelectorAll('.nav-item').forEach((item) => {
                item.classList.remove('active', 'text-purple-600');
                item.classList.add('text-gray-400');
            });
            if (!keys.includes(screenId)) return;
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
            const lb = document.getElementById('adora-image-lightbox');
            if (lb && !lb.classList.contains('hidden')) {
                closeAdoraImageLightboxIfOpen({ fromPopstate: true });
                return;
            }
            if (adoraNavStack.length <= 1) {
                try {
                    history.pushState({ adora: 1, screen: adoraNavStack[0] }, '');
                } catch (_e) {}
                showExitAppModal();
                syncAdoraGlobalBackButton();
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
            try {
                if (typeof window.closeAdoraImageLightbox === 'function') window.closeAdoraImageLightbox();
                else closeAdoraImageLightboxIfOpen();
            } catch (_e) {
                closeAdoraImageLightboxIfOpen();
            }
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
            /* مهم: لا تستخدم display:block مضمّناً — يتفوق على CSS ويلغي display:flex لصفحات المنتج
               فيتعطل تقييد ارتفاع .adora-pdp-scroll ويختفي التمرير العمودي بالكامل */
            target.style.removeProperty('display');
            target.classList.add('active');

            currentScreen = screenId;
            try {
                document.body.classList.toggle('adora-screen-listing-active', screenId === 'screen-listing');
            } catch (_e) {}
            if (!opts.preserveScroll) {
                window.scrollTo(0, 0);
                if (screenId === 'screen-product' || screenId === 'screen-marketplace-product') {
                    try {
                        const pdp = document.getElementById(screenId);
                        const scr = pdp && pdp.querySelector('.adora-pdp-scroll');
                        if (scr) scr.scrollTop = 0;
                    } catch (_ePdp) {}
                }
            }
            setActiveNavForScreen(screenId);
            if (typeof onScreenEnter === 'function') {
                onScreenEnter(screenId);
            }
            persistAdoraSessionState();
            injectHomeBanners().catch(() => {});
            syncAdoraGlobalBackButton();
        }

        /** مزامنة حالة المتصفح مع أعلى المكدس (بدون history.back() التي تخرج عن مسار SPA) */
        function adoraSyncHistoryToScreen(screenId) {
            try {
                history.replaceState(
                    { adora: 1, screen: screenId },
                    '',
                    window.location.pathname + window.location.search + window.location.hash
                );
            } catch (_e) {}
        }

        function adoraPopIfTopIs(screenId) {
            if (adoraNavStack.length > 1 && adoraNavStack[adoraNavStack.length - 1] === screenId) {
                const leaving = adoraNavStack.pop();
                const prev = adoraNavStack[adoraNavStack.length - 1];
                return { leaving, prev };
            }
            return null;
        }

        function adoraAfterPopNavigate(prev, leaving) {
            if (leaving === 'screen-listing') {
                resetListingFiltersAfterLeave();
            }
            navigateTo(prev, { skipHistory: true });
            adoraSyncHistoryToScreen(prev);
            persistAdoraSessionState();
        }

        /** يضمن أن أعلى المكدس يطابق الشاشة الحالية قبل الرجوع */
        function adoraEnsureStackTailMatchesCurrent() {
            const cs = typeof currentScreen === 'string' ? currentScreen : 'screen-categories';
            if (!adoraNavStack.length) {
                adoraNavStack = [cs];
                return;
            }
            if (adoraNavStack[adoraNavStack.length - 1] === cs) return;
            const idx = adoraNavStack.lastIndexOf(cs);
            if (idx >= 0) {
                adoraNavStack.length = idx + 1;
            } else {
                adoraNavStack.push(cs);
            }
        }

        function syncAdoraGlobalBackButton() {
            const headerBtn = document.getElementById('main-header-back-btn');
            const listingBtn = document.getElementById('listing-toolbar-back-btn');
            const shell = document.getElementById('app-shell');
            const onListing = currentScreen === 'screen-listing';
            if (!shell || shell.classList.contains('hidden')) {
                headerBtn?.classList.add('hidden');
                listingBtn?.classList.add('hidden');
                listingBtn?.setAttribute('aria-hidden', 'true');
                return;
            }
            const label = isRTL ? 'رجوع' : 'Back';
            if (onListing) {
                headerBtn?.classList.add('hidden');
                listingBtn?.classList.remove('hidden');
                listingBtn?.setAttribute('aria-hidden', 'false');
                listingBtn?.setAttribute('aria-label', label);
            } else {
                listingBtn?.classList.add('hidden');
                listingBtn?.setAttribute('aria-hidden', 'true');
                headerBtn?.classList.remove('hidden');
                headerBtn?.setAttribute('aria-hidden', 'false');
                headerBtn?.setAttribute('aria-label', label);
            }
        }

        function backFromOrderTracking() {
            const popped = adoraPopIfTopIs('screen-order-tracking');
            if (popped) {
                if (popped.prev === 'screen-categories') {
                    navigateTo('screen-profile', { skipHistory: true });
                    adoraNavStack = ['screen-categories', 'screen-profile'];
                    adoraSyncHistoryToScreen('screen-profile');
                    persistAdoraSessionState();
                    return;
                }
                adoraAfterPopNavigate(popped.prev, popped.leaving);
                return;
            }
            navigateTo('screen-profile', { skipHistory: true });
            adoraNavStack = ['screen-categories', 'screen-profile'];
            adoraSyncHistoryToScreen('screen-profile');
            persistAdoraSessionState();
        }
        window.backFromOrderTracking = backFromOrderTracking;

        /**
         * رجوع موحّد: خطوة واحدة من المكدس، مع إغلاق معاينة الصورة أولاً؛
         * من الرئيسية فقط → تنبيه الخروج (لا قفزات عشوائية للرئيسية).
         */
        function adoraUnifiedBack() {
            const lb = document.getElementById('adora-image-lightbox');
            if (lb && !lb.classList.contains('hidden')) {
                closeAdoraImageLightboxIfOpen();
                return;
            }
            const vjTerms = document.getElementById('vendor-join-terms-modal');
            if (vjTerms && !vjTerms.classList.contains('hidden')) {
                closeVendorJoinTermsModal();
                return;
            }

            adoraEnsureStackTailMatchesCurrent();

            if (
                currentScreen === 'screen-categories' &&
                adoraNavStack.length === 1 &&
                adoraNavStack[0] === 'screen-categories'
            ) {
                showExitAppModal();
                try {
                    history.pushState({ adora: 1, screen: 'screen-categories' }, '');
                } catch (_e) {}
                syncAdoraGlobalBackButton();
                return;
            }

            if (currentScreen === 'screen-product') {
                backFromProductDetail();
                syncAdoraGlobalBackButton();
                return;
            }

            if (currentScreen === 'screen-marketplace-product') {
                backFromMarketplaceProduct();
                syncAdoraGlobalBackButton();
                return;
            }

            if (currentScreen === 'screen-order-tracking') {
                backFromOrderTracking();
                syncAdoraGlobalBackButton();
                return;
            }

            if (currentScreen === 'screen-listing') {
                if (adoraNavStack.length === 1 && adoraNavStack[0] === 'screen-listing') {
                    adoraNavStack.unshift('screen-categories');
                }
            }

            if (adoraNavStack.length > 1) {
                const leaving = adoraNavStack[adoraNavStack.length - 1];
                if (leaving === 'screen-product') {
                    try {
                        stopGalleryAutoScroll('product-gallery');
                    } catch (_e) {}
                }
                if (leaving === 'screen-marketplace-product') {
                    try {
                        stopGalleryAutoScroll('marketplace-product-gallery');
                    } catch (_e) {}
                }
                adoraNavStack.pop();
                if (leaving === 'screen-listing') {
                    resetListingFiltersAfterLeave();
                }
                const prev = adoraNavStack[adoraNavStack.length - 1];
                navigateTo(prev, { skipHistory: true });
                adoraSyncHistoryToScreen(prev);
                persistAdoraSessionState();
                return;
            }

            switchTab('screen-categories', null);
            syncAdoraGlobalBackButton();
        }
        window.adoraUnifiedBack = adoraUnifiedBack;

        function adoraPopNavStackOneStep() {
            adoraUnifiedBack();
        }
        window.adoraPopNavStackOneStep = adoraPopNavStackOneStep;

        function switchTab(screenId, btn) {
            const dockTabIds = [
                'screen-categories',
                'screen-listing',
                'screen-featured-hub',
                'screen-offers',
                'screen-cart',
                'screen-profile',
            ];
            const isSameDockTab = dockTabIds.includes(screenId) && currentScreen === screenId;

            if (screenId === 'screen-listing' && !isSameDockTab) {
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

            /* نفس تبويب الشريط السفلي: تحديث البيانات دون إعادة انتقال الشاشة (يبقى التمرير كما هو) */
            if (isSameDockTab) {
                const y = adoraGetDocumentScrollTop();
                try {
                    if (typeof window.closeAdoraImageLightbox === 'function') window.closeAdoraImageLightbox();
                    else closeAdoraImageLightboxIfOpen();
                } catch (_e) {
                    closeAdoraImageLightboxIfOpen();
                }
                onScreenEnter(screenId);
                try {
                    injectHomeBanners().catch(() => {});
                } catch (_e) {}
                persistAdoraSessionState();
                syncAdoraGlobalBackButton();
                const restoreScroll = () => {
                    try {
                        window.scrollTo(0, y);
                    } catch (_e) {}
                };
                requestAnimationFrame(() => {
                    restoreScroll();
                    requestAnimationFrame(restoreScroll);
                });
                setTimeout(restoreScroll, 50);
                setTimeout(restoreScroll, 200);
                setTimeout(restoreScroll, 600);
                setTimeout(restoreScroll, 1200);
                return;
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

        async function apiFetch(pathname, { method = 'GET', body = null, requireAuth = true, attachAuthIfAvailable = false, isFormData = false, cache } = {}) {
            const token = getStoredJwtToken();
            const headers = {};
            if (requireAuth && token) headers['Authorization'] = `Bearer ${token}`;
            else if (!requireAuth && attachAuthIfAvailable && token) headers['Authorization'] = `Bearer ${token}`;

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
            else fetchOpts.cache = 'no-store';
            const res = await fetch(`${getApiOrigin()}${pathname}`, fetchOpts);

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = data.error || `Request failed (${res.status})`;
                throw new Error(msg);
            }
            return data;
        }

        let _cachedPublicConfig = null;

        async function loadPublicAppConfig() {
            if (_cachedPublicConfig) return _cachedPublicConfig;
            try {
                const raw = await apiFetch('/api/public-config', { requireAuth: false });
                _cachedPublicConfig = {
                    app_download_url: String(raw.app_download_url || '').trim(),
                    google_oauth_client_id: String(raw.google_oauth_client_id || '').trim(),
                    apple_oauth_client_id: String(raw.apple_oauth_client_id || '').trim(),
                    apple_oauth_redirect_uri: String(raw.apple_oauth_redirect_uri || '').trim(),
                };
            } catch (_e) {
                _cachedPublicConfig = {
                    app_download_url: '',
                    google_oauth_client_id: '',
                    apple_oauth_client_id: '',
                    apple_oauth_redirect_uri: '',
                };
            }
            return _cachedPublicConfig;
        }

        async function resolveAppDownloadUrl() {
            try {
                const m = document.querySelector('meta[name="adora-app-download-url"]');
                const c = m && m.getAttribute('content');
                if (c && String(c).trim()) return String(c).trim();
            } catch (_e) {}
            const fromConst = String(typeof ADORA_APP_DOWNLOAD_URL !== 'undefined' ? ADORA_APP_DOWNLOAD_URL : '').trim();
            if (fromConst) return fromConst;
            const cfg = await loadPublicAppConfig();
            return cfg.app_download_url || '';
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
                ctx.fillStyle = 'rgba(245, 240, 252, 0.32)';
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

        let __adoraSignupResendTimer = null;

        function stopSignupResendCountdown() {
            if (__adoraSignupResendTimer) {
                clearTimeout(__adoraSignupResendTimer);
                __adoraSignupResendTimer = null;
            }
        }

        function startSignupResendCountdown(sec) {
            const btn = document.getElementById('auth-signup-resend-btn');
            const label = document.getElementById('auth-signup-resend-label');
            stopSignupResendCountdown();
            let s = Math.max(0, Number(sec) || 0);
            const tick = () => {
                if (btn) btn.disabled = s > 0;
                if (label) {
                    label.textContent =
                        s > 0
                            ? isRTL
                                ? `إعادة الإرسال خلال ${s} ث`
                                : `Resend in ${s}s`
                            : isRTL
                              ? 'إعادة إرسال الرمز'
                              : 'Resend code';
                }
                if (s <= 0) {
                    __adoraSignupResendTimer = null;
                    return;
                }
                s -= 1;
                __adoraSignupResendTimer = setTimeout(tick, 1000);
            };
            tick();
        }

        let __adoraForgotResendTimer = null;

        function stopForgotResendCountdown() {
            if (__adoraForgotResendTimer) {
                clearTimeout(__adoraForgotResendTimer);
                __adoraForgotResendTimer = null;
            }
        }

        function startForgotResendCountdown(sec) {
            const btn = document.getElementById('auth-forgot-resend-btn');
            const label = document.getElementById('auth-forgot-resend-label');
            stopForgotResendCountdown();
            let s = Math.max(0, Number(sec) || 0);
            const tick = () => {
                if (btn) btn.disabled = s > 0;
                if (label) {
                    label.textContent =
                        s > 0
                            ? isRTL
                                ? `إعادة الإرسال خلال ${s} ث`
                                : `Resend in ${s}s`
                            : isRTL
                              ? 'إعادة إرسال الرمز'
                              : 'Resend code';
                }
                if (s <= 0) {
                    __adoraForgotResendTimer = null;
                    return;
                }
                s -= 1;
                __adoraForgotResendTimer = setTimeout(tick, 1000);
            };
            tick();
        }

        function resetAuthForgotPasswordUi() {
            const block = document.getElementById('auth-login-form-block');
            const forgot = document.getElementById('auth-forgot-flow');
            const stepEmail = document.getElementById('auth-forgot-step-email');
            const stepOtp = document.getElementById('auth-forgot-step-otp');
            if (block) block.classList.remove('hidden');
            if (forgot) forgot.classList.add('hidden');
            if (stepEmail) stepEmail.classList.remove('hidden');
            if (stepOtp) stepOtp.classList.add('hidden');
            stopForgotResendCountdown();
            ['auth-forgot-email', 'auth-forgot-otp-code', 'auth-forgot-new-password', 'auth-forgot-confirm-password'].forEach(
                (id) => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                }
            );
            const btn = document.getElementById('auth-forgot-resend-btn');
            const label = document.getElementById('auth-forgot-resend-label');
            if (btn) btn.disabled = false;
            if (label) {
                const ar = label.getAttribute('data-ar');
                const en = label.getAttribute('data-en');
                label.textContent = isRTL ? ar || 'إعادة إرسال الرمز' : en || 'Resend code';
            }
        }

        function showAuthForgotPasswordFlow() {
            const block = document.getElementById('auth-login-form-block');
            const forgot = document.getElementById('auth-forgot-flow');
            const stepEmail = document.getElementById('auth-forgot-step-email');
            const stepOtp = document.getElementById('auth-forgot-step-otp');
            const msgEl = document.getElementById('auth-message');
            if (!block || !forgot || !stepEmail || !stepOtp) return;
            block.classList.add('hidden');
            forgot.classList.remove('hidden');
            stepEmail.classList.remove('hidden');
            stepOtp.classList.add('hidden');
            stopForgotResendCountdown();
            ['auth-forgot-email', 'auth-forgot-otp-code', 'auth-forgot-new-password', 'auth-forgot-confirm-password'].forEach(
                (id) => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                }
            );
            if (msgEl) msgEl.classList.add('hidden');
        }

        function cancelAuthForgotPasswordFlow() {
            resetAuthForgotPasswordUi();
        }

        function resetSignupEmailOtpUi(opts) {
            const forLoginTab = opts && opts.forLoginTab === true;
            const form = document.getElementById('auth-form-signup');
            const otpPanel = document.getElementById('auth-signup-otp-panel');
            const otpInput = document.getElementById('auth-signup-otp-code');
            if (!forLoginTab && form) form.classList.remove('hidden');
            if (otpPanel) otpPanel.classList.add('hidden');
            if (otpInput) otpInput.value = '';
            stopSignupResendCountdown();
            const btn = document.getElementById('auth-signup-resend-btn');
            if (btn) btn.disabled = false;
            const label = document.getElementById('auth-signup-resend-label');
            if (label) {
                const ar = label.getAttribute('data-ar');
                const en = label.getAttribute('data-en');
                label.textContent = isRTL ? ar || 'إعادة إرسال الرمز' : en || 'Resend code';
            }
        }

        function setAuthMode(mode) {
            const hLogin = document.getElementById('auth-modal-heading-login');
            const hSignup = document.getElementById('auth-modal-heading-signup');
            const loginScreen = document.getElementById('auth-login-screen');
            const signupScreen = document.getElementById('auth-signup-screen');
            const formSignup = document.getElementById('auth-form-signup');

            if (!loginScreen || !signupScreen || !formSignup) return;

            resetAuthForgotPasswordUi();

            const isLogin = mode === 'login';
            if (hLogin) hLogin.classList.toggle('hidden', !isLogin);
            if (hSignup) hSignup.classList.toggle('hidden', isLogin);

            loginScreen.classList.toggle('hidden', !isLogin);
            signupScreen.classList.toggle('hidden', isLogin);

            if (isLogin) resetSignupEmailOtpUi();
        }

        try {
            window.setAuthMode = setAuthMode;
        } catch (_e) {}

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
            if (mode === 'signup') resetSignupEmailOtpUi();
            adoraParticleModal.start();
            ensureAdoraAuthOauthButtons().catch(() => {});
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
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    injectHomeBanners().catch(() => {});
                    syncAdoraGlobalBackButton();
                });
            });
            if (typeof nextFn === 'function') await nextFn();
        }

        async function afterAuthLoginSuccess() {
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
            consumeMarketplaceDeepLink();
        }

        let __adoraGsiInitialized = false;
        let __adoraAppleInited = false;

        function loadGoogleIdentityScript() {
            return new Promise((resolve, reject) => {
                if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
                    resolve();
                    return;
                }
                const s = document.createElement('script');
                s.src = 'https://accounts.google.com/gsi/client';
                s.async = true;
                s.defer = true;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('Google script'));
                document.head.appendChild(s);
            });
        }

        function loadAppleAuthScript() {
            return new Promise((resolve, reject) => {
                if (typeof AppleID !== 'undefined' && AppleID.auth) {
                    resolve();
                    return;
                }
                const s = document.createElement('script');
                s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
                s.async = true;
                s.defer = true;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('Apple script'));
                document.head.appendChild(s);
            });
        }

        async function adoraFinishOAuthWithToken(provider, idToken, appleDisplayName) {
            if (!idToken) return;
            const body = { provider, id_token: idToken };
            if (appleDisplayName) body.name = appleDisplayName;
            try {
                const data = await apiFetchAuthSignup('/api/auth/oauth', body);
                setStoredJwtToken(data.token);
                await completeAuthTransitionToApp(afterAuthLoginSuccess);
            } catch (e) {
                openAuthModal(
                    'login',
                    isRTL ? `تعذر إكمال الدخول: ${e.message}` : `Sign-in failed: ${e.message}`
                );
            }
        }

        async function adoraEnsureAppleIdInit() {
            const cfg = await loadPublicAppConfig();
            if (!cfg.apple_oauth_client_id) return false;
            await loadAppleAuthScript();
            if (!__adoraAppleInited) {
                __adoraAppleInited = true;
                AppleID.auth.init({
                    clientId: cfg.apple_oauth_client_id,
                    scope: 'name email',
                    redirectURI: cfg.apple_oauth_redirect_uri || window.location.origin,
                    usePopup: true,
                });
            }
            return true;
        }

        async function adoraAppleSignIn() {
            try {
                if (!(await adoraEnsureAppleIdInit())) return;
                const res = await AppleID.auth.signIn();
                const id_token = res.authorization && res.authorization.id_token;
                let name = '';
                if (res.user && res.user.name) {
                    const fn = res.user.name.firstName || '';
                    const ln = res.user.name.lastName || '';
                    name = `${fn} ${ln}`.trim();
                }
                await adoraFinishOAuthWithToken('apple', id_token, name);
            } catch (e) {
                const code = e && (e.error || e.detail);
                if (code === 'popup_closed_by_user') return;
                const msg = (e && e.message) || String(e);
                openAuthModal('signup', isRTL ? `Apple: ${msg}` : `Apple: ${msg}`);
            }
        }

        async function ensureAdoraAuthOauthButtons() {
            const cfg = await loadPublicAppConfig();
            const hasG = !!cfg.google_oauth_client_id;
            const hasA = !!cfg.apple_oauth_client_id;
            const slotS = document.getElementById('auth-google-slot-signup');
            const slotL = document.getElementById('auth-google-slot-login');

            if (!hasG && !hasA) {
                slotS?.classList.add('hidden');
                slotL?.classList.add('hidden');
                document.getElementById('auth-apple-btn-signup')?.classList.add('hidden');
                document.getElementById('auth-apple-btn-login')?.classList.add('hidden');
                return;
            }

            if (hasG) {
                slotS?.classList.remove('hidden');
                slotL?.classList.remove('hidden');
                try {
                    await loadGoogleIdentityScript();
                    if (!__adoraGsiInitialized) {
                        __adoraGsiInitialized = true;
                        google.accounts.id.initialize({
                            client_id: cfg.google_oauth_client_id,
                            callback: (resp) => {
                                const cred = resp && resp.credential;
                                if (cred) void adoraFinishOAuthWithToken('google', cred);
                            },
                            ux_mode: 'popup',
                            locale: isRTL ? 'ar' : 'en',
                        });
                    }
                    if (slotS && slotS.getAttribute('data-adora-g') !== '1') {
                        slotS.innerHTML = '';
                        google.accounts.id.renderButton(slotS, {
                            theme: 'outline',
                            size: 'large',
                            width: 280,
                            text: 'continue_with',
                            shape: 'pill',
                        });
                        slotS.setAttribute('data-adora-g', '1');
                    }
                    if (slotL && slotL.getAttribute('data-adora-g') !== '1') {
                        slotL.innerHTML = '';
                        google.accounts.id.renderButton(slotL, {
                            theme: 'outline',
                            size: 'large',
                            width: 280,
                            text: 'signin_with',
                            shape: 'pill',
                        });
                        slotL.setAttribute('data-adora-g', '1');
                    }
                } catch (_e) {
                    /* ignore — OAuth optional */
                }
            } else {
                slotS?.classList.add('hidden');
                slotL?.classList.add('hidden');
            }

            if (hasA) {
                document.getElementById('auth-apple-btn-signup')?.classList.remove('hidden');
                document.getElementById('auth-apple-btn-login')?.classList.remove('hidden');
                adoraEnsureAppleIdInit().catch(() => {});
            } else {
                document.getElementById('auth-apple-btn-signup')?.classList.add('hidden');
                document.getElementById('auth-apple-btn-login')?.classList.add('hidden');
            }
        }

        async function handleLogin() {
            const raw = document.getElementById('auth-phone-login').value.trim();
            const password = document.getElementById('auth-password-login').value;
            const showLoginErr = (t) => openAuthModal('login', t);
            if (!raw || !password) {
                showLoginErr(
                    isRTL ? 'أدخل البريد أو رقم الهاتف وكلمة المرور' : 'Enter your email or phone and password'
                );
                return;
            }
            const digitsOnly = raw.replace(/\D/g, '');
            const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
            const looksLikePhone = digitsOnly.length >= 8;
            if (!looksLikeEmail && !looksLikePhone) {
                showLoginErr(
                    isRTL
                        ? 'أدخل البريد الإلكتروني كاملاً (مثل name@example.com) أو رقم الهاتف (8 أرقام على الأقل). لا يمكن تسجيل الدخول باسم مختصر فقط.'
                        : 'Use your full email (e.g. name@example.com) or phone number (8+ digits). Short names alone cannot sign in.'
                );
                return;
            }
            try {
                const data = await apiFetch('/api/auth/login', {
                    method: 'POST',
                    requireAuth: false,
                    body: { phone: raw, password },
                });
                setStoredJwtToken(data.token);
                await completeAuthTransitionToApp(afterAuthLoginSuccess);
            } catch (e) {
                const m = e && e.message ? String(e.message) : '';
                const friendly =
                    m === 'Invalid credentials'
                        ? isRTL
                            ? 'البريد/الهاتف أو كلمة المرور غير صحيحة. جرّب البريد كاملاً أو نفس رقم واتساب الذي سجّلت به.'
                            : 'Wrong email/phone or password. Use the full email or the phone number you signed up with.'
                        : m;
                showLoginErr(isRTL ? `فشل تسجيل الدخول: ${friendly}` : `Login failed: ${friendly}`);
            }
        }

        async function apiFetchAuthSignup(path, body) {
            const res = await fetch(`${getApiOrigin()}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const err = new Error(data.error || `Request failed (${res.status})`);
                err.status = res.status;
                err.retry_after_sec = data.retry_after_sec;
                throw err;
            }
            return data;
        }

        async function handleSignupSendCode() {
            const name = document.getElementById('auth-name')?.value.trim() || '';
            const email = document.getElementById('auth-email')?.value.trim() || '';
            const phone = document.getElementById('auth-signup-phone')?.value.trim() || '';
            const password = document.getElementById('auth-password')?.value || '';
            const msgEl = document.getElementById('auth-message');
            const showMsg = (t) => {
                if (msgEl) {
                    msgEl.textContent = t;
                    msgEl.classList.remove('hidden');
                }
            };
            if (msgEl) msgEl.classList.add('hidden');
            const phoneDigits = phone.replace(/\D/g, '');
            if (!name || !email || !password || phoneDigits.length < 8) {
                showMsg(
                    isRTL
                        ? 'أدخل الاسم والبريد ورقم واتساب صالح (8 أرقام على الأقل) وكلمة المرور'
                        : 'Enter name, email, a valid WhatsApp number (8+ digits), and password'
                );
                return;
            }
            if (password.length < 6) {
                showMsg(isRTL ? 'كلمة المرور 6 أحرف على الأقل' : 'Password must be at least 6 characters');
                return;
            }
            try {
                await apiFetchAuthSignup('/api/auth/signup/send-code', { name, email, password, phone });
                const form = document.getElementById('auth-form-signup');
                const otpPanel = document.getElementById('auth-signup-otp-panel');
                const disp = document.getElementById('auth-signup-otp-email-display');
                if (form) form.classList.add('hidden');
                if (otpPanel) otpPanel.classList.remove('hidden');
                if (disp) disp.textContent = email;
                document.getElementById('auth-signup-otp-code')?.focus();
                startSignupResendCountdown(60);
                showMsg('');
                if (msgEl) msgEl.classList.add('hidden');
            } catch (e) {
                const wait = e.retry_after_sec;
                if (wait != null) startSignupResendCountdown(wait);
                showMsg(e.message || String(e));
            }
        }

        async function handleSignupVerifyCode() {
            const email = document.getElementById('auth-email')?.value.trim() || '';
            const code = document.getElementById('auth-signup-otp-code')?.value.trim().replace(/\s/g, '') || '';
            const password = document.getElementById('auth-password')?.value || '';
            const msgEl = document.getElementById('auth-message');
            const showMsg = (t) => {
                if (msgEl) {
                    msgEl.textContent = t;
                    msgEl.classList.remove('hidden');
                }
            };
            if (!code || code.length < 4) {
                showMsg(isRTL ? 'أدخل رمز التحقق' : 'Enter the verification code');
                return;
            }
            let resumeOrder = null;
            if (pendingOrderPayload) {
                resumeOrder = { payload: pendingOrderPayload, source: pendingOrderSource };
                pendingOrderPayload = null;
                pendingOrderSource = null;
            }
            try {
                const data = await apiFetchAuthSignup('/api/auth/signup/verify', { email, code });
                setStoredJwtToken(data.token);
                setAuthMode('signup');
                await completeAuthTransitionToApp(async () => {
                    refreshSideMenuHeader().catch(() => {});
                    pendingAfterSignupCredentials = resumeOrder;
                    const pEl = document.getElementById('signup-cred-phone');
                    const pwEl = document.getElementById('signup-cred-password');
                    if (pEl) pEl.textContent = email;
                    if (pwEl) pwEl.textContent = password;
                    document.getElementById('signup-credentials-modal')?.classList.remove('hidden');
                    document.body.style.overflow = 'hidden';
                });
            } catch (e) {
                if (resumeOrder) {
                    pendingOrderPayload = resumeOrder.payload;
                    pendingOrderSource = resumeOrder.source;
                }
                showMsg(e.message || String(e));
            }
        }

        async function handleSignupResendCode() {
            const email = document.getElementById('auth-email')?.value.trim() || '';
            const msgEl = document.getElementById('auth-message');
            if (!email) return;
            try {
                await apiFetchAuthSignup('/api/auth/signup/resend-code', { email });
                if (msgEl) {
                    msgEl.textContent = isRTL ? 'تم إرسال رمز جديد' : 'A new code was sent';
                    msgEl.classList.remove('hidden');
                }
                startSignupResendCountdown(60);
            } catch (e) {
                const wait = e.retry_after_sec;
                if (wait != null) startSignupResendCountdown(wait);
                if (msgEl) {
                    msgEl.textContent = e.message || String(e);
                    msgEl.classList.remove('hidden');
                }
            }
        }

        async function handleForgotPasswordRequestCode() {
            const email = document.getElementById('auth-forgot-email')?.value.trim() || '';
            const msgEl = document.getElementById('auth-message');
            const showMsg = (t) => {
                if (msgEl) {
                    msgEl.textContent = t;
                    msgEl.classList.remove('hidden');
                }
            };
            if (msgEl) msgEl.classList.add('hidden');
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showMsg(isRTL ? 'أدخل بريداً إلكترونياً صالحاً' : 'Enter a valid email address');
                return;
            }
            try {
                await apiFetchAuthSignup('/api/auth/password-reset/request-code', { email });
                const stepEmail = document.getElementById('auth-forgot-step-email');
                const stepOtp = document.getElementById('auth-forgot-step-otp');
                const disp = document.getElementById('auth-forgot-otp-email-display');
                if (stepEmail) stepEmail.classList.add('hidden');
                if (stepOtp) stepOtp.classList.remove('hidden');
                if (disp) disp.textContent = email;
                document.getElementById('auth-forgot-otp-code')?.focus();
                startForgotResendCountdown(60);
                showMsg(
                    isRTL
                        ? 'إن وُجد حساب بهذا البريد، ستصلك رسالة تحتوي الرمز. صلاحية الرمز 5 دقائق.'
                        : 'If an account exists for this email, you will receive a code. It expires in 5 minutes.'
                );
            } catch (e) {
                const wait = e.retry_after_sec;
                if (wait != null) startForgotResendCountdown(wait);
                showMsg(e.message || String(e));
            }
        }

        async function handleForgotPasswordResendCode() {
            const email = document.getElementById('auth-forgot-email')?.value.trim() || '';
            const msgEl = document.getElementById('auth-message');
            if (!email) return;
            try {
                await apiFetchAuthSignup('/api/auth/password-reset/resend-code', { email });
                if (msgEl) {
                    msgEl.textContent = isRTL ? 'تم إرسال رمز جديد' : 'A new code was sent';
                    msgEl.classList.remove('hidden');
                }
                startForgotResendCountdown(60);
            } catch (e) {
                const wait = e.retry_after_sec;
                if (wait != null) startForgotResendCountdown(wait);
                if (msgEl) {
                    msgEl.textContent = e.message || String(e);
                    msgEl.classList.remove('hidden');
                }
            }
        }

        async function handleForgotPasswordConfirm() {
            const email = document.getElementById('auth-forgot-email')?.value.trim() || '';
            const code = document.getElementById('auth-forgot-otp-code')?.value.trim().replace(/\s/g, '') || '';
            const np = document.getElementById('auth-forgot-new-password')?.value || '';
            const cp = document.getElementById('auth-forgot-confirm-password')?.value || '';
            const msgEl = document.getElementById('auth-message');
            const showMsg = (t) => {
                if (msgEl) {
                    msgEl.textContent = t;
                    msgEl.classList.remove('hidden');
                }
            };
            if (!code || code.length < 4) {
                showMsg(isRTL ? 'أدخل رمز التحقق' : 'Enter the verification code');
                return;
            }
            if (!np || np.length < 6) {
                showMsg(isRTL ? 'كلمة المرور 6 أحرف على الأقل' : 'Password must be at least 6 characters');
                return;
            }
            if (np !== cp) {
                showMsg(isRTL ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
                return;
            }
            try {
                const data = await apiFetchAuthSignup('/api/auth/password-reset/confirm', {
                    email,
                    code,
                    new_password: np,
                });
                setStoredJwtToken(data.token);
                resetAuthForgotPasswordUi();
                await completeAuthTransitionToApp(afterAuthLoginSuccess);
            } catch (e) {
                showMsg(e.message || String(e));
            }
        }

        try {
            window.resetSignupEmailOtpUi = resetSignupEmailOtpUi;
            window.handleSignupSendCode = handleSignupSendCode;
            window.handleSignupVerifyCode = handleSignupVerifyCode;
            window.handleSignupResendCode = handleSignupResendCode;
            window.showAuthForgotPasswordFlow = showAuthForgotPasswordFlow;
            window.cancelAuthForgotPasswordFlow = cancelAuthForgotPasswordFlow;
            window.handleForgotPasswordRequestCode = handleForgotPasswordRequestCode;
            window.handleForgotPasswordResendCode = handleForgotPasswordResendCode;
            window.handleForgotPasswordConfirm = handleForgotPasswordConfirm;
            window.adoraAppleSignIn = adoraAppleSignIn;
        } catch (_e) {}

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
            const socketUrl = getApiOrigin();
            const norm = (o) => String(o || '').replace(/\/$/, '');
            /* واجهة على نطاق وخادم على نطاق آخر: polling فقط يعيد 400 «Session ID unknown» خلف موزّع حمل (Render بعدة نسخ) لأن كل طلب قد يذهب لنسخة مختلفة. WebSocket يبقى على اتصال واحد فيُفضّل أولاً. */
            const forcePollingOnly =
                typeof window.ADORA_FORCE_SOCKET_POLLING === 'boolean' && window.ADORA_FORCE_SOCKET_POLLING;
            const crossApi = norm(socketUrl) !== norm(window.location.origin) || forcePollingOnly;
            const transportOpts = forcePollingOnly
                ? { transports: ['polling'], upgrade: false }
                : crossApi
                  ? { transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true }
                  : { transports: ['polling', 'websocket'], upgrade: true, rememberUpgrade: true };
            appSocket = io(socketUrl, {
                auth: { token },
                ...transportOpts,
                withCredentials: true,
                timeout: 60000,
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1500,
                reconnectionDelayMax: 30000,
                randomizationFactor: 0.5,
            });
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
            const ordersSection = document.getElementById('profile-orders-section');
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
            const avImg = document.getElementById('profile-avatar-img');
            const avEl = document.getElementById('profile-avatar-placeholder');
            const avUrl = data.user && data.user.avatar_url ? String(data.user.avatar_url).trim() : '';
            const safeAv = avUrl && /^https:\/\//i.test(avUrl) ? avUrl : '';
            if (avImg && avEl) {
                if (safeAv) {
                    avImg.src = safeAv;
                    avImg.classList.remove('hidden');
                    avEl.classList.add('hidden');
                } else {
                    avImg.removeAttribute('src');
                    avImg.classList.add('hidden');
                    avEl.classList.remove('hidden');
                    const nm = String(data.user.name || '').trim();
                    avEl.textContent = nm ? nm.charAt(0).toUpperCase() : isRTL ? '؟' : '?';
                }
            } else if (avEl) {
                const nm = String(data.user.name || '').trim();
                avEl.textContent = nm ? nm.charAt(0).toUpperCase() : isRTL ? '؟' : '?';
            }
            if (profilePhoneEl) {
                const sub = [data.user.phone, data.user.email].filter(Boolean).join(' · ');
                profilePhoneEl.textContent = sub;
            }
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

            if (ordersBadge) {
                const n = Array.isArray(data.orders) ? data.orders.length : 0;
                if (n === 0) {
                    ordersBadge.classList.add('hidden');
                } else {
                    ordersBadge.textContent = n > 99 ? '99+' : String(n);
                    ordersBadge.classList.remove('hidden');
                }
            }
            refreshSideMenuHeader().catch(() => {});
            syncAppBroadcastBadge().catch(() => {});
            connectAppSocket();
            updateSiteRatingLoginHint();
            updateProductReviewLoginHint();
            updateMarketplaceReviewLoginHint();
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
                showToast(isRTL ? 'شكراً لملاحظتك، تم الإرسال' : 'Thank you — your message was sent.', {
                    variant: 'feedback-sent',
                    duration: 1000,
                });
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
            body.innerHTML = `<div class="px-2 py-2">${adoraSkeletonModalRowsHtml(5)}</div>`;
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
                try {
                    body.querySelectorAll('img').forEach((img) => {
                        img.classList.add('cursor-pointer', 'rounded-xl');
                        img.addEventListener('click', (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            const s = img.getAttribute('src');
                            if (s && typeof window.openAdoraImageLightbox === 'function') {
                                window.openAdoraImageLightbox(s);
                            }
                        });
                    });
                } catch (_imgE) {}
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

        /** Skeleton لشبكة منتجات عمودين (قائمة، مفضلة، عروض، سوق) */
        function adoraSkeletonProductGridHtml(cellCount) {
            const n = Math.min(12, Math.max(6, Number(cellCount) || 8));
            let html = '';
            for (let i = 0; i < n; i++) {
                html += `<div class="rounded-2xl overflow-hidden bg-white border border-gray-100 shadow-sm animate-pulse" aria-hidden="true">
                    <div class="aspect-[4/5] bg-gray-200/85 w-full"></div>
                    <div class="p-2 space-y-2">
                        <div class="h-2.5 bg-gray-200 rounded w-[92%]"></div>
                        <div class="h-2.5 bg-gray-200 rounded w-[58%]"></div>
                        <div class="h-4 bg-gray-200 rounded w-[44%] mt-1"></div>
                    </div>
                </div>`;
            }
            return html;
        }

        /** Skeleton لشريط منتجات أفقي (الرئيسية) */
        function adoraSkeletonHomeStripHtml(cellCount) {
            const n = Math.min(8, Math.max(4, Number(cellCount) || 6));
            let html = '';
            for (let i = 0; i < n; i++) {
                html += `<div class="flex-shrink-0 w-[9.25rem] rounded-2xl overflow-hidden bg-white/60 border border-gray-100/80 animate-pulse" aria-hidden="true">
                    <div class="h-[7.25rem] bg-gray-200/80 w-full"></div>
                    <div class="p-2 space-y-1.5"><div class="h-2 bg-gray-200 rounded"></div><div class="h-2 bg-gray-200 rounded w-[55%]"></div></div>
                </div>`;
            }
            return `<div class="flex gap-2 overflow-x-auto no-scrollbar py-2 px-1">${html}</div>`;
        }

        /** Skeleton لقوائم داخل النوافذ المنبثقة */
        function adoraSkeletonModalRowsHtml(rows) {
            const n = Math.min(8, Math.max(3, Number(rows) || 5));
            let html = '';
            for (let i = 0; i < n; i++) {
                html += `<div class="h-12 bg-gray-200/80 rounded-xl animate-pulse mb-2" aria-hidden="true"></div>`;
            }
            return html;
        }

        /**
         * إدراج أجزاء HTML على دفعات عبر requestAnimationFrame لتقليل تجميد الواجهة.
         * @param {HTMLElement|null} container
         * @param {string[]} fragments كل عنصر = HTML كامل لبطاقة/عنصر
         */
        function adoraInsertAdjacentHtmlChunked(container, fragments, chunkSize, onDone) {
            if (!container) {
                if (typeof onDone === 'function') onDone();
                return;
            }
            const parts = Array.isArray(fragments) ? fragments.filter((x) => x != null && String(x).length) : [];
            if (!parts.length) {
                container.innerHTML = '';
                if (typeof onDone === 'function') onDone();
                return;
            }
            container.innerHTML = '';
            const ch = Math.max(1, Math.min(20, Number(chunkSize) || 10));
            let idx = 0;
            function step() {
                const end = Math.min(idx + ch, parts.length);
                let batch = '';
                for (; idx < end; idx++) batch += parts[idx];
                container.insertAdjacentHTML('beforeend', batch);
                if (idx < parts.length) requestAnimationFrame(step);
                else if (typeof onDone === 'function') requestAnimationFrame(() => onDone());
            }
            requestAnimationFrame(step);
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
            latestTrackingFulfillments = Array.isArray(tracking.fulfillments) ? tracking.fulfillments : [];
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
            if (screenId === 'screen-featured-hub') {
                syncFeaturedHubCategoryTilesUi();
                loadFeaturedHubProducts().catch(() => {});
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
                refreshHomeLayoutFromApi().catch(() => {});
                loadHomeFeaturedGrid().catch(() => {});
                loadHomeNewCollectionGrid().catch(() => {});
                loadHomeBestsellers().catch(() => {});
                loadHomeMpPremiumVendors().catch(() => {});
                loadHomeMpFeaturedMarketplaceProducts().catch(() => {});
                injectHomeBanners().catch(() => {});
                refreshAdoraHomeSubcategoryCounts().catch(() => {});
                loadMarketplaceHomeEntrance().catch(() => {});
                loadPartnerCtaConfig().catch(() => {});
                loadMarketplaceHomeHighlights().catch(() => {});
                bindVendorJoinPageFormOnce();
                bindAppAdPageFormOnce();
            }
            if (screenId === 'screen-marketplace') {
                initMarketplaceBrowseScreen()
                    .then(() => {
                        syncPartnerCtaDom();
                        syncAppAdCtaDom();
                    })
                    .catch(() => {});
            }
            if (screenId === 'screen-vendor-join') {
                syncVendorJoinHeroFromConfig();
                syncVendorJoinTermsFromConfig();
                bindVendorJoinPageFormOnce();
                prefetchVendorJoinPlans().catch(() => {});
            }
            if (screenId === 'screen-app-ad-inquiry') {
                syncAppAdInquiryPageHeroFromConfig();
                syncAppAdInquiryTermsFromConfig();
                bindAppAdPageFormOnce();
            }
            if (screenId === 'screen-offers' || screenId === 'screen-listing' || screenId === 'screen-featured-hub') {
                syncPartnerCtaDom();
                syncAppAdCtaDom();
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
                            latestTrackingFulfillments = Array.isArray(tracking?.fulfillments) ? tracking.fulfillments : [];
                            updateOrderTrackingUI();
                        })
                        .catch(() => {});
                }
            }
        }

        function adoraGetDocumentScrollTop() {
            try {
                let y = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
                const mc = document.querySelector('.mobile-container');
                if (mc) y = Math.max(y, mc.scrollTop || 0);
                const shell = document.getElementById('app-shell');
                if (shell && !shell.classList.contains('hidden')) {
                    y = Math.max(y, shell.scrollTop || 0);
                    const pdpScroll = shell.querySelector(
                        '#screen-product.active .adora-pdp-scroll, #screen-marketplace-product.active .adora-pdp-scroll'
                    );
                    if (pdpScroll) y = Math.max(y, pdpScroll.scrollTop || 0);
                }
                return y;
            } catch (_e) {
                return 0;
            }
        }

        function adoraPtrOverlayBlocking() {
            const ids = [
                'auth-gate-screen',
                'auth-modal',
                'session-resume-overlay',
                'exit-app-modal',
                'filter-modal',
                'order-options-modal',
                'checkout-system-confirm-modal',
                'checkout-card-soon-modal',
                'orders-list-modal',
                'profile-edit-modal',
                'contact-info-modal',
                'signup-credentials-modal',
                'notification-prompt-modal',
                'language-prompt-modal',
                'download-prompt-modal',
                'app-broadcasts-modal',
                'product-share-modal',
                'vendor-subscription-modal',
                'app-ad-inquiries-modal',
                'vendor-join-terms-modal',
                'vendor-join-plans-modal',
                'adora-image-lightbox',
                'home-subcat-overlay',
            ];
            for (let i = 0; i < ids.length; i++) {
                const el = document.getElementById(ids[i]);
                if (el && !el.classList.contains('hidden')) return true;
            }
            const bd = document.getElementById('side-drawer-backdrop');
            if (bd && bd.classList.contains('open')) return true;
            return false;
        }

        function adoraPtrShouldIgnore() {
            const shell = document.getElementById('app-shell');
            if (!shell || shell.classList.contains('hidden')) return true;
            const splash = document.getElementById('splash-screen');
            if (splash && splash.style.display !== 'none') return true;
            if (adoraPtrOverlayBlocking()) return true;
            /* صفحات نماذج طويلة + تمرير النافذة: سحب-للتحديث كان يستدعي preventDefault فيلمس فيعلّق التمرير */
            if (document.getElementById('screen-vendor-join')?.classList.contains('active')) return true;
            if (document.getElementById('screen-app-ad-inquiry')?.classList.contains('active')) return true;
            return false;
        }

        function adoraPtrSetLabel(phase) {
            const label = document.getElementById('adora-ptr-label');
            if (!label) return;
            const rtl = typeof isRTL !== 'undefined' ? isRTL : true;
            if (phase === 'load') {
                label.textContent = rtl ? 'جاري التحديث...' : 'Refreshing...';
            } else if (phase === 'release') {
                label.textContent = rtl ? 'اترك للتحديث' : 'Release to refresh';
            } else {
                label.textContent = rtl ? 'اسحب للتحديث...' : 'Pull to refresh...';
            }
        }

        function adoraPtrApplyPullVisual(pullPx, phaseHint) {
            const root = document.getElementById('adora-ptr-indicator');
            const chip = root && root.querySelector('.adora-ptr-indicator__chip');
            if (!root || !chip) return;
            const p = Math.max(0, Math.min(Number(pullPx) || 0, 120));
            const y = Math.min(p * 0.35, 36) - 20;
            chip.style.setProperty('--adora-ptr-chip-y', `${y}px`);
            if (p < 4) {
                root.classList.remove('adora-ptr-indicator--visible');
                root.setAttribute('aria-hidden', 'true');
                return;
            }
            root.classList.add('adora-ptr-indicator--visible');
            root.setAttribute('aria-hidden', 'false');
            const threshold = 72;
            if (phaseHint === 'load') {
                adoraPtrSetLabel('load');
            } else {
                adoraPtrSetLabel(p >= threshold ? 'release' : 'pull');
            }
        }

        function adoraPtrHidePullVisual() {
            const root = document.getElementById('adora-ptr-indicator');
            const chip = root && root.querySelector('.adora-ptr-indicator__chip');
            if (chip) chip.style.setProperty('--adora-ptr-chip-y', '-20px');
            if (root) {
                root.classList.remove('adora-ptr-indicator--visible');
                root.setAttribute('aria-hidden', 'true');
            }
        }

        async function refreshAdoraCurrentScreenForPull() {
            const sid = typeof currentScreen === 'string' ? currentScreen : 'screen-categories';
            if (sid === 'screen-listing') {
                await loadListingPageProducts();
                syncPartnerCtaDom();
                syncAppAdCtaDom();
                return;
            }
            if (sid === 'screen-offers') {
                await loadOffersPageProducts();
                syncPartnerCtaDom();
                syncAppAdCtaDom();
                return;
            }
            if (sid === 'screen-featured-hub') {
                await loadFeaturedHubProducts();
                syncPartnerCtaDom();
                syncAppAdCtaDom();
                return;
            }
            if (sid === 'screen-wishlist') {
                await loadWishlistPageProducts();
                return;
            }
            if (sid === 'screen-cart') {
                renderCartUI();
                return;
            }
            if (sid === 'screen-profile') {
                await refreshProfileAndOrders();
                return;
            }
            if (sid === 'screen-categories') {
                syncSearchInputsFromQuery();
                invalidateMpAppHomePlacements();
                await Promise.all([
                    injectHomeBanners(),
                    loadHomeFeaturedGrid(),
                    loadHomeNewCollectionGrid(),
                    loadHomeBestsellers(),
                    loadHomeMpPremiumVendors(),
                    loadHomeMpFeaturedMarketplaceProducts(),
                    refreshAdoraHomeSubcategoryCounts(),
                    loadMarketplaceHomeEntrance(),
                    loadPartnerCtaConfig(),
                    loadMarketplaceHomeHighlights(),
                    syncBrandsFromApi()
                        .then(() => {
                            updateBrandSortButtons();
                        })
                        .catch(() => {}),
                    syncFlashSaleFromApi().finally(() => {
                        renderFlashSale();
                        initFlashCountdown();
                    }),
                ]);
                bindVendorJoinPageFormOnce();
                bindAppAdPageFormOnce();
                return;
            }
            if (sid === 'screen-marketplace') {
                await initMarketplaceBrowseScreen();
                syncPartnerCtaDom();
                syncAppAdCtaDom();
                return;
            }
            if (sid === 'screen-vendor-join') {
                syncVendorJoinHeroFromConfig();
                syncVendorJoinTermsFromConfig();
                bindVendorJoinPageFormOnce();
                prefetchVendorJoinPlans().catch(() => {});
                return;
            }
            if (sid === 'screen-app-ad-inquiry') {
                syncAppAdInquiryPageHeroFromConfig();
                syncAppAdInquiryTermsFromConfig();
                bindAppAdPageFormOnce();
                return;
            }
            if (sid === 'screen-marketplace-product' && currentMarketplaceProductDetail && currentMarketplaceProductDetail.id) {
                await openMarketplaceProductDetail(Number(currentMarketplaceProductDetail.id), { skipNavigate: true });
                return;
            }
            if (sid === 'screen-product' && currentProductDetail && currentProductDetail.id) {
                await openProductDetail(Number(currentProductDetail.id), { skipNavigate: true });
                return;
            }
            if (sid === 'screen-order-tracking' && latestOrderDbId) {
                try {
                    const tracking = await apiFetch(`/api/orders/${latestOrderDbId}/tracking`, { requireAuth: true });
                    if (tracking?.history?.length) {
                        latestOrderStatus = normalizeOrderStatus(tracking.history[tracking.history.length - 1].status);
                    } else if (tracking?.order?.status) {
                        latestOrderStatus = normalizeOrderStatus(tracking.order.status);
                    }
                    if (tracking?.order?.order_no) latestOrderId = tracking.order.order_no;
                    if (tracking?.order?.created_at) latestOrderCreatedAt = tracking.order.created_at;
                    latestTrackingOrder = tracking?.order || null;
                    latestTrackingItems = Array.isArray(tracking?.items) ? tracking.items : [];
                    latestTrackingFulfillments = Array.isArray(tracking?.fulfillments) ? tracking.fulfillments : [];
                    updateOrderTrackingUI();
                } catch (_e) {}
                return;
            }
            if (sid === 'screen-checkout') {
                await refreshCheckoutOrderPreviewNo().catch(() => {});
                renderCheckoutSummary();
                return;
            }
            injectHomeBanners().catch(() => {});
            refreshSideMenuHeader().catch(() => {});
        }

        let adoraPtrRefreshBusy = false;

        async function runAdoraPullRefresh() {
            if (adoraPtrRefreshBusy) return;
            adoraPtrRefreshBusy = true;
            let savedWinY = 0;
            try {
                savedWinY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
            } catch (_e0) {}
            const shell = document.getElementById('app-shell');
            const pdpScroll =
                shell && !shell.classList.contains('hidden')
                    ? shell.querySelector(
                          '#screen-product.active .adora-pdp-scroll, #screen-marketplace-product.active .adora-pdp-scroll'
                      )
                    : null;
            const savedPdpScroll = pdpScroll ? pdpScroll.scrollTop : 0;
            const root = document.getElementById('adora-ptr-indicator');
            adoraPtrApplyPullVisual(100, 'load');
            if (root) {
                root.classList.add('adora-ptr-indicator--visible');
                root.setAttribute('aria-hidden', 'false');
            }
            try {
                await refreshAdoraCurrentScreenForPull();
            } catch (_e) {}
            adoraPtrHidePullVisual();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        window.scrollTo(0, savedWinY);
                    } catch (_e2) {}
                    try {
                        if (pdpScroll) pdpScroll.scrollTop = savedPdpScroll;
                    } catch (_e3) {}
                    adoraPtrRefreshBusy = false;
                });
            });
        }

        function initAdoraPullToRefresh() {
            const THRESHOLD = 72;
            let startY = 0;
            let startX = 0;
            let armed = false;
            let maxPull = 0;

            document.addEventListener(
                'touchstart',
                (e) => {
                    if (adoraPtrRefreshBusy || adoraPtrShouldIgnore()) {
                        armed = false;
                        return;
                    }
                    const t = e.target;
                    if (t && t.closest && t.closest('.adora-pdp-scroll')) {
                        armed = false;
                        return;
                    }
                    if (t && t.closest && t.closest('.adora-scroll-strip, .mp-vendors-scroll-track')) {
                        armed = false;
                        return;
                    }
                    if (adoraGetDocumentScrollTop() > 8) {
                        armed = false;
                        return;
                    }
                    if (!e.touches || !e.touches.length) return;
                    armed = true;
                    startY = e.touches[0].clientY;
                    startX = e.touches[0].clientX;
                    maxPull = 0;
                },
                { passive: true }
            );

            document.addEventListener(
                'touchmove',
                (e) => {
                    if (!armed || adoraPtrRefreshBusy || adoraPtrShouldIgnore()) return;
                    if (!e.touches || !e.touches.length) return;
                    const t = e.target;
                    if (t && t.closest && t.closest('.adora-pdp-scroll')) {
                        armed = false;
                        adoraPtrHidePullVisual();
                        return;
                    }
                    if (t && t.closest && t.closest('.adora-scroll-strip, .mp-vendors-scroll-track')) {
                        armed = false;
                        adoraPtrHidePullVisual();
                        return;
                    }
                    const y = e.touches[0].clientY;
                    const x = e.touches[0].clientX;
                    const dy = y - startY;
                    const dx = Math.abs(x - startX);
                    const st = adoraGetDocumentScrollTop();
                    if (st > 8) {
                        armed = false;
                        adoraPtrHidePullVisual();
                        return;
                    }
                    if (dy <= 0) {
                        adoraPtrHidePullVisual();
                        return;
                    }
                    if (dx > dy + 12) return;
                    maxPull = Math.max(maxPull, dy);
                    e.preventDefault();
                    adoraPtrApplyPullVisual(dy, 'pull');
                },
                { passive: false }
            );

            const endPtrTouch = () => {
                if (!armed) return;
                const shouldRun = maxPull >= THRESHOLD && adoraGetDocumentScrollTop() <= 12 && !adoraPtrShouldIgnore();
                armed = false;
                if (shouldRun && !adoraPtrRefreshBusy) {
                    void runAdoraPullRefresh();
                } else {
                    adoraPtrHidePullVisual();
                }
                maxPull = 0;
            };

            document.addEventListener('touchend', endPtrTouch, { passive: true });
            document.addEventListener('touchcancel', endPtrTouch, { passive: true });
        }

        // Language Toggle
        function applyAppLanguage() {
            const dir = isRTL ? 'rtl' : 'ltr';
            const lang = isRTL ? 'ar' : 'en';
            document.documentElement.setAttribute('dir', dir);
            document.documentElement.setAttribute('lang', lang);
            document.body.setAttribute('dir', dir);
            const langTextEl = document.getElementById('lang-text');
            if (langTextEl) langTextEl.textContent = isRTL ? 'AR' : 'EN';
            
            document.querySelectorAll('[data-en]').forEach((el) => {
                const hasIconChild = el.querySelector && el.querySelector('i, svg, img');
                if (hasIconChild) return;
                const v = isRTL ? el.getAttribute('data-ar') : el.getAttribute('data-en');
                if (v !== null) el.textContent = v;
            });
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.setAttribute('placeholder', '');
                const ariaS = isRTL ? searchInput.getAttribute('data-ar-aria') : searchInput.getAttribute('data-en-aria');
                if (ariaS) searchInput.setAttribute('aria-label', ariaS);
            }
            const listingSearchInput = document.getElementById('listing-search-input');
            if (listingSearchInput) {
                listingSearchInput.setAttribute('placeholder', '');
            }
            ['auth-name', 'auth-email', 'auth-phone', 'auth-phone-login'].forEach((id) => {
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
                mpSearch.setAttribute('placeholder', '');
            }
            const mpRevTa = document.getElementById('marketplace-review-comment');
            if (mpRevTa) {
                const mph = isRTL ? mpRevTa.getAttribute('data-ar-ph') : mpRevTa.getAttribute('data-en-ph');
                if (mph) mpRevTa.setAttribute('placeholder', mph);
            }
            const appAdPrice = document.getElementById('aad-p-product-price');
            if (appAdPrice) {
                const ph = isRTL ? appAdPrice.getAttribute('data-ar-ph') : appAdPrice.getAttribute('data-en-ph');
                if (ph) appAdPrice.setAttribute('placeholder', ph);
            }
            const appAdDur = document.getElementById('aad-p-duration-days');
            if (appAdDur) {
                const dph = isRTL ? appAdDur.getAttribute('data-ar-ph') : appAdDur.getAttribute('data-en-ph');
                if (dph) appAdDur.setAttribute('placeholder', dph);
            }
            const searchVoiceBtn = document.getElementById('search-voice-btn');
            if (searchVoiceBtn) {
                searchVoiceBtn.setAttribute('aria-label', isRTL ? 'بحث صوتي' : 'Voice search');
            }
            const mpVoiceBtn = document.getElementById('marketplace-search-voice-btn');
            if (mpVoiceBtn) {
                mpVoiceBtn.setAttribute('aria-label', isRTL ? 'بحث صوتي في السوق' : 'Voice search in marketplace');
            }
            const mpInp = document.getElementById('marketplace-search-input');
            if (mpInp) {
                const a = isRTL ? mpInp.getAttribute('data-ar-aria') : mpInp.getAttribute('data-en-aria');
                if (a) mpInp.setAttribute('aria-label', a);
            }
            ['product-save-img-btn', 'marketplace-save-img-btn', 'marketplace-share-product-btn'].forEach((id) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                const a = isRTL ? btn.getAttribute('data-ar-aria') : btn.getAttribute('data-en-aria');
                if (a) btn.setAttribute('aria-label', a);
            });
            const vjTermsAckBtn = document.getElementById('vendor-join-terms-ack-btn');
            if (vjTermsAckBtn) {
                const a = isRTL
                    ? vjTermsAckBtn.getAttribute('data-ar-aria')
                    : vjTermsAckBtn.getAttribute('data-en-aria');
                if (a) vjTermsAckBtn.setAttribute('aria-label', a);
            }
            if (typeof applySplashCtaLang === 'function') applySplashCtaLang();
            syncExitAppModalLabels();
            refreshSideMenuHeader().catch(() => {});
            syncPartnerCtaDom();
            syncAppAdCtaDom();
            syncVendorJoinHeroFromConfig();
            syncVendorJoinTermsFromConfig();
            syncAppAdInquiryTermsFromConfig();
            if (typeof currentScreen === 'string' && currentScreen === 'screen-app-ad-inquiry') {
                syncAppAdInquiryPageHeroFromConfig();
            }
            restartAdoraAnimatedSearchTimer();
            try {
                const pr = document.getElementById('adora-ptr-indicator');
                if (pr && pr.classList.contains('adora-ptr-indicator--visible')) {
                    adoraPtrSetLabel(adoraPtrRefreshBusy ? 'load' : 'pull');
                }
            } catch (_e) {}
            updateProductDescToggleLabel();
            updateMarketplaceDescToggleLabel();
            syncAdoraGlobalBackButton();
        }

        function toggleLanguage() {
            isRTL = !isRTL;
            localStorage.setItem('adora_rtl', isRTL ? '1' : '0');
            applyAppLanguage();
            if (!document.getElementById('orders-list-modal')?.classList.contains('hidden')) {
                ordersListModalUpdateMoreButton();
            }
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
            if (currentScreen === 'screen-featured-hub') {
                syncFeaturedHubCategoryTilesUi();
                loadFeaturedHubProducts().catch(() => {});
            }
            if (currentScreen === 'screen-wishlist') {
                loadWishlistPageProducts().catch(() => {});
            }
            if (currentScreen === 'screen-marketplace') {
                initMarketplaceBrowseScreen().catch(() => {});
            }
            if (currentScreen === 'screen-marketplace-product' && currentMarketplaceProductDetail) {
                renderMarketplaceProductDetailUi();
                const mpId = currentMarketplaceProductDetail.id;
                const runMpRev = () => {
                    if (
                        currentScreen !== 'screen-marketplace-product' ||
                        !currentMarketplaceProductDetail ||
                        Number(currentMarketplaceProductDetail.id) !== Number(mpId)
                    ) {
                        return;
                    }
                    loadMarketplaceProductReviewsForDetail(mpId).catch(() => {});
                };
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(runMpRev, { timeout: 1200 });
                } else {
                    setTimeout(runMpRev, 0);
                }
            }
            if (currentScreen === 'screen-product' && currentProductDetail && currentProductDetail.id) {
                const pid = currentProductDetail.id;
                const runCatRev = () => {
                    if (currentScreen !== 'screen-product' || !currentProductDetail || Number(currentProductDetail.id) !== Number(pid)) {
                        return;
                    }
                    loadProductReviewsForDetail(pid).catch(() => {});
                };
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(runCatRev, { timeout: 1200 });
                } else {
                    setTimeout(runCatRev, 0);
                }
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

        const WISHLIST_ENTRIES_KEY = 'adora_wishlist_entries_v1';
        const WISHLIST_LEGACY_IDS_KEY = 'adora_wishlist_ids';

        function migrateWishlistStorageOnce() {
            try {
                if (localStorage.getItem(WISHLIST_ENTRIES_KEY)) return;
                const leg = localStorage.getItem(WISHLIST_LEGACY_IDS_KEY);
                let entries = [];
                if (leg) {
                    const arr = JSON.parse(leg);
                    if (Array.isArray(arr)) {
                        const seen = new Set();
                        for (const x of arr) {
                            const id = Number(x);
                            if (!Number.isFinite(id) || id < 1 || seen.has(id)) continue;
                            seen.add(id);
                            entries.push({ k: 'p', id });
                        }
                    }
                }
                localStorage.setItem(WISHLIST_ENTRIES_KEY, JSON.stringify(entries));
            } catch (_e) {
                try {
                    localStorage.setItem(WISHLIST_ENTRIES_KEY, '[]');
                } catch (_x) {}
            }
        }

        function loadWishlistEntries() {
            migrateWishlistStorageOnce();
            try {
                const raw = localStorage.getItem(WISHLIST_ENTRIES_KEY);
                const arr = JSON.parse(raw || '[]');
                if (!Array.isArray(arr)) return [];
                const seen = new Set();
                const out = [];
                for (const x of arr) {
                    const k = x && x.k === 'mp' ? 'mp' : 'p';
                    const id = Number(x && x.id);
                    if (!Number.isFinite(id) || id < 1) continue;
                    const key = `${k}:${id}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    out.push({ k, id });
                }
                return out;
            } catch (_e) {
                return [];
            }
        }

        function saveWishlistEntries(entries) {
            const uniq = [];
            const seen = new Set();
            for (const x of entries || []) {
                const k = x && x.k === 'mp' ? 'mp' : 'p';
                const id = Number(x && x.id);
                if (!Number.isFinite(id) || id < 1) continue;
                const key = `${k}:${id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                uniq.push({ k, id });
            }
            try {
                localStorage.setItem(WISHLIST_ENTRIES_KEY, JSON.stringify(uniq));
            } catch (_e) {}
            updateProfileWishlistUi();
        }

        function wishlistEntryKey(k, id) {
            return `${k === 'mp' ? 'mp' : 'p'}:${Number(id)}`;
        }

        function isWishlistEntry(k, id) {
            const key = wishlistEntryKey(k, id);
            return loadWishlistEntries().some((e) => wishlistEntryKey(e.k, e.id) === key);
        }

        function toggleWishlistEntryByKind(k, id) {
            const kind = k === 'mp' ? 'mp' : 'p';
            const nid = Number(id);
            const entries = loadWishlistEntries();
            const key = wishlistEntryKey(kind, nid);
            const idx = entries.findIndex((e) => wishlistEntryKey(e.k, e.id) === key);
            let nowOn = false;
            if (idx >= 0) entries.splice(idx, 1);
            else {
                entries.push({ k: kind, id: nid });
                nowOn = true;
            }
            saveWishlistEntries(entries);
            return nowOn;
        }

        function updateProfileWishlistUi() {
            const c = loadWishlistEntries().length;
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
            btn.classList.toggle('active', isWishlistEntry('p', Number(productId)));
        }

        function toggleWishlist(btn) {
            const id = currentProductDetail && currentProductDetail.id ? Number(currentProductDetail.id) : null;
            if (!id) {
                showToast(isRTL ? 'افتح منتجاً أولاً' : 'Open a product first');
                return;
            }
            const nowOn = toggleWishlistEntryByKind('p', id);
            if (btn) btn.classList.toggle('active', nowOn);
            showToast(nowOn ? (isRTL ? 'أُضيف إلى المفضلة' : 'Added to wishlist') : (isRTL ? 'أُزيل من المفضلة' : 'Removed from wishlist'));
            if (currentScreen === 'screen-wishlist') loadWishlistPageProducts().catch(() => {});
        }

        function toggleMarketplaceWishlistBtn(btn) {
            const id = currentMarketplaceProductDetail && currentMarketplaceProductDetail.id ? Number(currentMarketplaceProductDetail.id) : null;
            if (!id) return;
            const nowOn = toggleWishlistEntryByKind('mp', id);
            const b = btn || document.getElementById('marketplace-detail-wishlist-btn');
            if (b) b.classList.toggle('active', nowOn);
            showToast(nowOn ? (isRTL ? 'أُضيف إلى المفضلة' : 'Added to wishlist') : (isRTL ? 'أُزيل من المفضلة' : 'Removed from wishlist'));
            if (currentScreen === 'screen-wishlist') loadWishlistPageProducts().catch(() => {});
        }

        function wishlistCardToggle(ev, kind, id, btn) {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            const k = kind === 'mp' ? 'mp' : 'p';
            const nid = Number(id);
            const nowOn = toggleWishlistEntryByKind(k, nid);
            if (btn) btn.classList.toggle('active', nowOn);
            showToast(nowOn ? (isRTL ? 'أُضيف إلى المفضلة' : 'Added to wishlist') : (isRTL ? 'أُزيل من المفضلة' : 'Removed from wishlist'));
            if (currentScreen === 'screen-wishlist') loadWishlistPageProducts().catch(() => {});
        }

        function openWishlistScreen() {
            productDetailBackScreen = 'screen-profile';
            navigateTo('screen-wishlist');
        }

        async function loadWishlistPageProducts() {
            const grid = document.getElementById('wishlist-products-grid');
            if (!grid) return;
            const entries = loadWishlistEntries();
            if (!entries.length) {
                grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-12 text-sm leading-relaxed px-2">${
                    isRTL
                        ? 'المفضلة فارغة. اضغط القلب ❤ على أي منتج لإضافته.'
                        : 'Your wishlist is empty. Tap the heart on any product card to add items.'
                }</p>`;
                return;
            }
            grid.innerHTML = adoraSkeletonProductGridHtml(8);
            try {
                const results = await Promise.all(
                    entries.map((e) =>
                        e.k === 'mp'
                            ? apiFetch(`/api/marketplace/products/${e.id}`, { requireAuth: false }).catch(() => null)
                            : apiFetch(`/api/products/${e.id}`, { requireAuth: false }).catch(() => null)
                    )
                );
                const nextEntries = [];
                const parts = [];
                for (let i = 0; i < entries.length; i++) {
                    const e = entries[i];
                    const p = results[i];
                    if (!p || p.id == null) continue;
                    nextEntries.push(e);
                    if (e.k === 'mp') parts.push(renderMpProductCardHomeCompact(p));
                    else parts.push(renderProductCardHtml(p, { compact: true }));
                }
                if (nextEntries.length !== entries.length) saveWishlistEntries(nextEntries);
                if (!parts.length) {
                    grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-12 text-sm">${
                        isRTL ? 'تعذر تحميل المنتجات.' : 'Could not load products.'
                    }</p>`;
                    return;
                }
                adoraInsertAdjacentHtmlChunked(grid, parts, 6);
            } catch (e) {
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-8 text-sm">${escapeHtml(e.message)}</p>`;
            }
        }

        /* ========== السوق الشامل ========== */
        function openMarketplaceBrowse(opts) {
            marketplaceBrowsePreset = opts && typeof opts === 'object' ? opts : {};
            navigateTo('screen-marketplace');
        }
        window.openMarketplaceBrowse = openMarketplaceBrowse;

        let partnerCtaConfig = null;

        function partnerCtaPlacementOn(key) {
            if (!partnerCtaConfig || Number(partnerCtaConfig.partner_banner_enabled) !== 1) return false;
            const pl = partnerCtaConfig.partner_cta_placements;
            return Array.isArray(pl) && pl.includes(key);
        }

        function syncVendorJoinHeroFromConfig() {
            if (!partnerCtaConfig) return;
            const title = isRTL
                ? partnerCtaConfig.partner_banner_text_ar || partnerCtaConfig.partner_banner_text_en
                : partnerCtaConfig.partner_banner_text_en || partnerCtaConfig.partner_banner_text_ar;
            const sub = isRTL
                ? partnerCtaConfig.partner_cta_subtitle_ar || partnerCtaConfig.partner_cta_subtitle_en
                : partnerCtaConfig.partner_cta_subtitle_en || partnerCtaConfig.partner_cta_subtitle_ar;
            const ht = document.getElementById('vendor-join-hero-title');
            const hs = document.getElementById('vendor-join-hero-sub');
            if (ht) ht.textContent = title || (isRTL ? 'انضم كشركة داخل أدورا' : 'Partner with Adora');
            if (hs) {
                hs.textContent = sub || (isRTL ? 'قدّم طلبك وسيتواصل فريق أدورا معك.' : 'Submit your details and our team will reach out.');
            }
        }

        function syncPartnerCtaDom() {
            if (window.__adoraPartnerCtaRotateTimer) {
                clearInterval(window.__adoraPartnerCtaRotateTimer);
                window.__adoraPartnerCtaRotateTimer = null;
            }
            const master = partnerCtaConfig && Number(partnerCtaConfig.partner_banner_enabled) === 1;
            const fallbackTitle = isRTL ? 'انضم كشركة داخل أدورا' : 'Join as a company on Adora';
            const slidesRaw = partnerCtaConfig?.partner_cta_slides;
            const slides =
                Array.isArray(slidesRaw) && slidesRaw.length
                    ? slidesRaw
                    : [
                          {
                              title_ar: partnerCtaConfig?.partner_banner_text_ar || '',
                              title_en: partnerCtaConfig?.partner_banner_text_en || '',
                              subtitle_ar: partnerCtaConfig?.partner_cta_subtitle_ar || '',
                              subtitle_en: partnerCtaConfig?.partner_cta_subtitle_en || '',
                          },
                      ];

            const toggle = (id, show) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.classList.toggle('hidden', !show);
            };

            toggle('partner-cta-home-under-search', master && partnerCtaPlacementOn('home_under_search'));
            toggle('partner-cta-home-above-marketplace', master && partnerCtaPlacementOn('home_above_marketplace'));
            toggle('partner-cta-marketplace-screen', master && partnerCtaPlacementOn('marketplace_screen'));
            toggle('partner-cta-offers-screen', master && partnerCtaPlacementOn('offers_screen'));
            toggle('partner-cta-featured-hub-screen', master && partnerCtaPlacementOn('featured_hub_screen'));
            toggle('partner-cta-listing-screen', master && partnerCtaPlacementOn('listing_screen'));

            let slideIdx = 0;
            const applyPartnerSlide = () => {
                const sl = slides[slideIdx % slides.length];
                const lineTitle = isRTL
                    ? String(sl.title_ar || sl.title_en || '').trim() || fallbackTitle
                    : String(sl.title_en || sl.title_ar || '').trim() || fallbackTitle;
                const sub = isRTL
                    ? String(sl.subtitle_ar || sl.subtitle_en || '').trim()
                    : String(sl.subtitle_en || sl.subtitle_ar || '').trim();

                const uTitle = document.getElementById('partner-cta-under-search-title');
                const uSub = document.getElementById('partner-cta-under-search-sub');
                if (uTitle) uTitle.textContent = lineTitle;
                if (uSub) {
                    uSub.textContent = sub || '';
                    uSub.classList.toggle('hidden', !sub);
                }

                const aTitle = document.getElementById('partner-cta-above-market-title');
                const aSub = document.getElementById('partner-cta-above-market-sub');
                if (aTitle) aTitle.textContent = lineTitle;
                if (aSub) {
                    aSub.textContent = sub || '';
                    aSub.classList.toggle('hidden', !sub);
                }

                const compact = sub ? `${lineTitle} — ${sub}` : lineTitle;
                const mEl = document.getElementById('partner-cta-marketplace-title');
                if (mEl) mEl.textContent = compact;
                const oEl = document.getElementById('partner-cta-offers-title');
                if (oEl) oEl.textContent = compact;
                const fhEl = document.getElementById('partner-cta-featured-hub-title');
                if (fhEl) fhEl.textContent = compact;
                const lEl = document.getElementById('partner-cta-listing-title');
                if (lEl) lEl.textContent = compact;
            };
            applyPartnerSlide();
            if (master && slides.length > 1) {
                window.__adoraPartnerCtaRotateTimer = setInterval(() => {
                    slideIdx = (slideIdx + 1) % slides.length;
                    applyPartnerSlide();
                }, 4500);
            }
        }

        function appAdCtaPlacementOn(key) {
            if (!partnerCtaConfig || Number(partnerCtaConfig.app_ad_banner_enabled) !== 1) return false;
            const pl = partnerCtaConfig.app_ad_banner_placements;
            return Array.isArray(pl) && pl.includes(key);
        }

        function syncAppAdCtaDom() {
            if (window.__adoraAppAdCtaRotateTimer) {
                clearInterval(window.__adoraAppAdCtaRotateTimer);
                window.__adoraAppAdCtaRotateTimer = null;
            }
            const master = partnerCtaConfig && Number(partnerCtaConfig.app_ad_banner_enabled) === 1;
            const fallbackTitle = isRTL ? 'أعلن عن منتجك' : 'Advertise your product';
            const slidesRaw = partnerCtaConfig?.app_ad_cta_slides;
            const slides =
                Array.isArray(slidesRaw) && slidesRaw.length
                    ? slidesRaw
                    : [
                          {
                              title_ar: partnerCtaConfig?.app_ad_banner_text_ar || '',
                              title_en: partnerCtaConfig?.app_ad_banner_text_en || '',
                              subtitle_ar: partnerCtaConfig?.app_ad_banner_subtitle_ar || '',
                              subtitle_en: partnerCtaConfig?.app_ad_banner_subtitle_en || '',
                          },
                      ];

            const toggle = (id, show) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.classList.toggle('hidden', !show);
            };

            toggle('app-ad-cta-home-above-partner', master && appAdCtaPlacementOn('home_above_partner'));
            toggle('app-ad-cta-home-below-partner', master && appAdCtaPlacementOn('home_below_partner'));
            toggle('app-ad-cta-home-between-brands', master && appAdCtaPlacementOn('home_between_main_and_brands'));
            toggle('app-ad-cta-marketplace-screen', master && appAdCtaPlacementOn('marketplace_screen'));
            toggle('app-ad-cta-offers-screen', master && appAdCtaPlacementOn('offers_screen'));
            toggle('app-ad-cta-featured-hub-screen', master && appAdCtaPlacementOn('featured_hub_screen'));
            toggle('app-ad-cta-listing-screen', master && appAdCtaPlacementOn('listing_screen'));
            toggle('app-ad-side-menu', master && appAdCtaPlacementOn('side_menu_account'));
            toggle('app-ad-cta-profile-screen', master && appAdCtaPlacementOn('profile_screen'));

            const setSubVis = (subEl, sub) => {
                if (!subEl) return;
                subEl.textContent = sub || '';
                subEl.classList.toggle('hidden', !sub);
            };

            let adSlideIdx = 0;
            const applyAppAdSlide = () => {
                const sl = slides[adSlideIdx % slides.length];
                const lineTitle = isRTL
                    ? String(sl.title_ar || sl.title_en || '').trim() || fallbackTitle
                    : String(sl.title_en || sl.title_ar || '').trim() || fallbackTitle;
                const sub = isRTL
                    ? String(sl.subtitle_ar || sl.subtitle_en || '').trim()
                    : String(sl.subtitle_en || sl.subtitle_ar || '').trim();

                const t1 = document.getElementById('app-ad-cta-above-partner-title');
                const s1 = document.getElementById('app-ad-cta-above-partner-sub');
                if (t1) t1.textContent = lineTitle;
                setSubVis(s1, sub);

                const t2 = document.getElementById('app-ad-cta-below-partner-title');
                const s2 = document.getElementById('app-ad-cta-below-partner-sub');
                if (t2) t2.textContent = lineTitle;
                setSubVis(s2, sub);

                const t4 = document.getElementById('app-ad-cta-between-brands-title');
                const s4 = document.getElementById('app-ad-cta-between-brands-sub');
                if (t4) t4.textContent = lineTitle;
                setSubVis(s4, sub);

                const compact = sub ? `${lineTitle} — ${sub}` : lineTitle;
                [
                    ['app-ad-cta-listing-title'],
                    ['app-ad-cta-offers-title'],
                    ['app-ad-cta-featured-hub-title'],
                    ['app-ad-cta-marketplace-title'],
                    ['app-ad-side-menu-title'],
                    ['app-ad-cta-profile-title'],
                ].forEach(([id]) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = compact;
                });

                document.querySelectorAll('#app-ad-cta-home-above-partner button, #app-ad-cta-home-below-partner button, #app-ad-cta-home-between-brands button').forEach((btn) => {
                    if (btn) btn.setAttribute('aria-label', lineTitle);
                });
            };
            applyAppAdSlide();
            if (master && slides.length > 1) {
                window.__adoraAppAdCtaRotateTimer = setInterval(() => {
                    adSlideIdx = (adSlideIdx + 1) % slides.length;
                    applyAppAdSlide();
                }, 4500);
            }
        }

        async function loadPartnerCtaConfig() {
            try {
                partnerCtaConfig = await apiFetch('/api/public/vendor-platform/home', { requireAuth: false });
                if (!partnerCtaConfig || typeof partnerCtaConfig !== 'object') {
                    partnerCtaConfig = {
                        partner_banner_enabled: 0,
                        partner_cta_placements: [],
                        bestsellers_boost_enabled: 1,
                        app_ad_banner_enabled: 0,
                        app_ad_banner_placements: [],
                        vendor_join_terms_clauses: [],
                    };
                }
                if (!Array.isArray(partnerCtaConfig.partner_cta_placements)) {
                    partnerCtaConfig.partner_cta_placements = ['home_under_search'];
                }
                if (!Array.isArray(partnerCtaConfig.app_ad_banner_placements)) {
                    partnerCtaConfig.app_ad_banner_placements = [];
                }
                if (partnerCtaConfig.bestsellers_boost_enabled == null) {
                    partnerCtaConfig.bestsellers_boost_enabled = 1;
                }
                if (!Array.isArray(partnerCtaConfig.partner_cta_slides)) partnerCtaConfig.partner_cta_slides = [];
                if (!Array.isArray(partnerCtaConfig.app_ad_cta_slides)) partnerCtaConfig.app_ad_cta_slides = [];
                if (!Array.isArray(partnerCtaConfig.vendor_join_terms_clauses)) {
                    partnerCtaConfig.vendor_join_terms_clauses = [];
                }
            } catch (_e) {
                partnerCtaConfig = {
                    partner_banner_enabled: 0,
                    partner_cta_placements: [],
                    bestsellers_boost_enabled: 1,
                    app_ad_banner_enabled: 0,
                    app_ad_banner_placements: [],
                    partner_cta_slides: [],
                    app_ad_cta_slides: [],
                    vendor_join_terms_clauses: [],
                };
            }
            syncPartnerCtaDom();
            syncAppAdCtaDom();
            syncVendorJoinHeroFromConfig();
            syncVendorJoinTermsFromConfig();
            syncAppAdInquiryTermsFromConfig();
            refreshBestsellersSectionCombinedVisibility();
            loadHomeBestsellers().catch(() => {});
        }

        function vendorJoinClauseRowHasContent(c) {
            if (!c || typeof c !== 'object') return false;
            const t = (x) => String(x || '').trim();
            if (t(c.title_ar) || t(c.title_en)) return true;
            if (t(c.intro_ar) || t(c.intro_en)) return true;
            const br = Array.isArray(c.bullets_ar) ? c.bullets_ar : [];
            const be = Array.isArray(c.bullets_en) ? c.bullets_en : [];
            return br.some((x) => t(x)) || be.some((x) => t(x));
        }

        function escapeVendorTermsHtml(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function vendorTermsIntroToHtml(intro) {
            return escapeVendorTermsHtml(intro).replace(/\r\n|\r|\n/g, '<br/>');
        }

        function renderVendorJoinTermsClausesHtml(clauses, rtl) {
            if (!Array.isArray(clauses) || !clauses.length) return '';
            const parts = [];
            for (const c of clauses) {
                if (!vendorJoinClauseRowHasContent(c)) continue;
                const titleRaw = rtl
                    ? String(c.title_ar || '').trim()
                    : String(c.title_en || c.title_ar || '').trim();
                const introRaw = rtl
                    ? String(c.intro_ar || '').trim()
                    : String(c.intro_en || c.intro_ar || '').trim();
                let bulletList = rtl
                    ? Array.isArray(c.bullets_ar)
                        ? c.bullets_ar
                        : []
                    : Array.isArray(c.bullets_en) && c.bullets_en.some((x) => String(x || '').trim())
                      ? c.bullets_en
                      : Array.isArray(c.bullets_ar)
                        ? c.bullets_ar
                        : [];
                bulletList = bulletList.map((x) => String(x || '').trim()).filter(Boolean);
                const listStyle = c.list_style === 'none' ? 'none' : 'disc';
                const ulClass =
                    listStyle === 'none'
                        ? 'list-none ps-0 space-y-1.5'
                        : 'list-disc ps-4 space-y-1.5 marker:text-violet-500';
                const isHeader = c.is_header === true || Number(c.is_header) === 1;
                const inner = [];
                if (titleRaw) {
                    const tag = isHeader ? 'p' : 'h3';
                    const titleClass = isHeader
                        ? 'font-bold text-violet-950 text-sm sm:text-base'
                        : 'font-bold text-violet-900 text-xs sm:text-sm';
                    inner.push(`<${tag} class="${titleClass}">${escapeVendorTermsHtml(titleRaw)}</${tag}>`);
                }
                if (introRaw) {
                    const pClass = isHeader ? 'text-gray-700' : 'text-gray-800';
                    inner.push(`<p class="${pClass}">${vendorTermsIntroToHtml(introRaw)}</p>`);
                }
                if (bulletList.length) {
                    inner.push(`<ul class="${ulClass}">`);
                    for (const b of bulletList) {
                        inner.push(`<li>${escapeVendorTermsHtml(b)}</li>`);
                    }
                    inner.push('</ul>');
                }
                const wrap = isHeader ? 'header' : 'section';
                const wrapClass = isHeader ? 'space-y-2 pb-2 border-b border-violet-200/80' : 'space-y-2';
                parts.push(`<${wrap} class="${wrapClass}">${inner.join('')}</${wrap}>`);
            }
            return `<div class="space-y-4">${parts.join('')}</div>`;
        }

        function syncVendorJoinTermsFromConfig() {
            const customEl = document.getElementById('vendor-join-terms-custom');
            const defaultEl = document.getElementById('vendor-join-terms-default');
            if (!customEl || !defaultEl) return;
            const clauses = partnerCtaConfig?.vendor_join_terms_clauses;
            const clausesActive =
                Array.isArray(clauses) && clauses.length && clauses.some(vendorJoinClauseRowHasContent);
            if (clausesActive) {
                customEl.className = 'space-y-4 leading-relaxed text-[11px] sm:text-xs text-gray-800 pb-4';
                customEl.innerHTML = renderVendorJoinTermsClausesHtml(clauses, isRTL);
                customEl.classList.remove('hidden');
                defaultEl.classList.add('hidden');
                return;
            }
            const primary = isRTL
                ? String(partnerCtaConfig?.vendor_join_terms_ar || '').trim()
                : String(partnerCtaConfig?.vendor_join_terms_en || '').trim();
            const secondary = isRTL
                ? String(partnerCtaConfig?.vendor_join_terms_en || '').trim()
                : String(partnerCtaConfig?.vendor_join_terms_ar || '').trim();
            const text = primary || secondary;
            if (text) {
                customEl.textContent = text;
                customEl.className = 'whitespace-pre-line leading-relaxed text-gray-800 pb-4';
                customEl.classList.remove('hidden');
                defaultEl.classList.add('hidden');
            } else {
                customEl.textContent = '';
                customEl.classList.add('hidden');
                defaultEl.classList.remove('hidden');
            }
        }

        function syncAppAdInquiryPageHeroFromConfig() {
            if (!partnerCtaConfig) return;
            const titleAr = partnerCtaConfig.app_ad_banner_text_ar || '';
            const titleEn = partnerCtaConfig.app_ad_banner_text_en || '';
            const subAr = partnerCtaConfig.app_ad_banner_subtitle_ar || '';
            const subEn = partnerCtaConfig.app_ad_banner_subtitle_en || '';
            const title = isRTL ? titleAr || titleEn : titleEn || titleAr;
            const sub = isRTL ? subAr || subEn : subEn || subAr;
            const ht = document.getElementById('app-ad-page-hero-title');
            const hs = document.getElementById('app-ad-page-hero-sub');
            if (ht) {
                ht.textContent =
                    title || (isRTL ? 'أعلن عن منتجك' : 'Advertise your product');
            }
            if (hs) {
                hs.textContent =
                    sub ||
                    (isRTL
                        ? 'عبّئ النموذج وارفع صورة المنتج — يصل الطلب لفريق أدورا للمراجعة.'
                        : 'Fill the form and upload a product photo — your request goes to the Adora team for review.');
                hs.classList.remove('hidden');
            }
        }

        function syncAppAdInquiryTermsFromConfig() {
            const customEl = document.getElementById('app-ad-page-terms-custom');
            const defaultEl = document.getElementById('app-ad-page-terms-default');
            if (!customEl || !defaultEl) return;
            const primary = isRTL
                ? String(partnerCtaConfig?.app_ad_terms_ar || '').trim()
                : String(partnerCtaConfig?.app_ad_terms_en || '').trim();
            const secondary = isRTL
                ? String(partnerCtaConfig?.app_ad_terms_en || '').trim()
                : String(partnerCtaConfig?.app_ad_terms_ar || '').trim();
            const text = primary || secondary;
            if (text) {
                customEl.textContent = text;
                customEl.classList.remove('hidden');
                defaultEl.classList.add('hidden');
            } else {
                customEl.textContent = '';
                customEl.classList.add('hidden');
                defaultEl.classList.remove('hidden');
            }
        }

        function openAppAdInquiryPage() {
            syncAppAdInquiryPageHeroFromConfig();
            syncAppAdInquiryTermsFromConfig();
            navigateTo('screen-app-ad-inquiry');
            bindAppAdPageFormOnce();
        }
        window.openAppAdInquiryPage = openAppAdInquiryPage;
        window.openAppAdInquiryModal = openAppAdInquiryPage;

        function backFromAppAdInquiry() {
            adoraUnifiedBack();
        }
        window.backFromAppAdInquiry = backFromAppAdInquiry;

        function bindAppAdPageFormOnce() {
            const form = document.getElementById('app-ad-page-form');
            if (!form || form.dataset.adoraAppAdBound === '1') return;
            form.dataset.adoraAppAdBound = '1';
            form.querySelectorAll('.aad-p-section-cb').forEach((cb) => {
                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        form.querySelectorAll('.aad-p-section-cb').forEach((o) => {
                            if (o !== cb) o.checked = false;
                        });
                    }
                });
            });
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const msg = document.getElementById('app-ad-page-msg');
                if (msg) {
                    msg.classList.add('hidden');
                    msg.textContent = '';
                }
                const imgIn = document.getElementById('aad-p-product-image');
                const file = imgIn?.files?.[0];
                if (!file) {
                    if (msg) {
                        msg.textContent = isRTL ? 'يرجى إرفاق صورة المنتج.' : 'Please attach a product photo.';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-amber-100 text-amber-900 border border-amber-200/80';
                        msg.classList.remove('hidden');
                    }
                    return;
                }
                const sectionCb = form.querySelector('.aad-p-section-cb:checked');
                const sectionCount = sectionCb ? Number(sectionCb.value) : NaN;
                if (!Number.isFinite(sectionCount) || sectionCount < 1 || sectionCount > 4) {
                    if (msg) {
                        msg.textContent = isRTL
                            ? 'يرجى اختيار عدد الأقسام (قسم واحد حتى أربعة).'
                            : 'Please choose how many sections (one through four).';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-amber-100 text-amber-900 border border-amber-200/80';
                        msg.classList.remove('hidden');
                    }
                    return;
                }
                const durRaw = document.getElementById('aad-p-duration-days')?.value?.trim() || '';
                const durDays = Number(durRaw);
                if (!Number.isFinite(durDays) || durDays < 1 || durDays > 366) {
                    if (msg) {
                        msg.textContent = isRTL
                            ? 'يرجى إدخال عدد أيام صحيح (1–366).'
                            : 'Enter a valid number of days (1–366).';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-amber-100 text-amber-900 border border-amber-200/80';
                        msg.classList.remove('hidden');
                    }
                    return;
                }
                const fd = new FormData();
                fd.append('full_name', document.getElementById('aad-p-full-name')?.value?.trim() || '');
                fd.append('company_name', document.getElementById('aad-p-company')?.value?.trim() || '');
                fd.append('email', document.getElementById('aad-p-email')?.value?.trim() || '');
                fd.append('phone', document.getElementById('aad-p-phone')?.value?.trim() || '');
                fd.append('residence', document.getElementById('aad-p-residence')?.value?.trim() || '');
                fd.append('ad_duration_days', String(Math.floor(durDays)));
                fd.append('ad_section_count', String(Math.floor(sectionCount)));
                fd.append('product_price', document.getElementById('aad-p-product-price')?.value?.trim() || '');
                fd.append('terms_accepted', document.getElementById('aad-p-terms')?.checked ? '1' : '0');
                fd.append('product_image', file);
                try {
                    const headers = {};
                    const tok = getStoredJwtToken();
                    if (tok) headers['Authorization'] = `Bearer ${tok}`;
                    const res = await fetch(`${getApiOrigin()}/api/app-ad-inquiries`, {
                        method: 'POST',
                        headers,
                        body: fd,
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        throw new Error(data.error || (isRTL ? 'تعذر الإرسال' : 'Could not submit'));
                    }
                    if (msg) {
                        msg.textContent = isRTL
                            ? 'تم إرسال طلبك. سيتم التواصل معك خلال 24 ساعة من قبل إدارة Adora.'
                            : 'Your request was sent. Adora administration will contact you within 24 hours.';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-emerald-100 text-emerald-800 border border-emerald-200/80';
                        msg.classList.remove('hidden');
                    }
                    form.reset();
                    setTimeout(() => backFromAppAdInquiry(), 2400);
                } catch (err) {
                    if (msg) {
                        msg.textContent = err.message || (isRTL ? 'تعذر الإرسال' : 'Could not submit');
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-red-100 text-red-800 border border-red-200/80';
                        msg.classList.remove('hidden');
                    }
                }
            });
        }

        function openCustomerFeedbackBannerModal(bannerId) {
            const idEl = document.getElementById('customer-feedback-banner-id');
            const ta = document.getElementById('customer-feedback-banner-text');
            const modal = document.getElementById('customer-feedback-banner-modal');
            if (!idEl || !ta || !modal) return;
            if (!getStoredJwtToken()) {
                alert(isRTL ? 'سجّل الدخول لإرسال ملاحظة.' : 'Sign in to send a note.');
                return;
            }
            idEl.value = String(bannerId || '');
            ta.value = '';
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            ta.focus();
        }
        function closeCustomerFeedbackBannerModal() {
            const modal = document.getElementById('customer-feedback-banner-modal');
            if (modal) modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
        async function submitCustomerFeedbackBannerNote() {
            const idEl = document.getElementById('customer-feedback-banner-id');
            const ta = document.getElementById('customer-feedback-banner-text');
            const bid = idEl && idEl.value ? Number(idEl.value) : NaN;
            const note = ta ? String(ta.value || '').trim() : '';
            if (!note || note.length < 2) {
                alert(isRTL ? 'اكتب ملاحظة.' : 'Write a note.');
                return;
            }
            try {
                await apiFetch('/api/customer-feedback-notes', {
                    requireAuth: true,
                    method: 'POST',
                    body: { note, banner_id: Number.isFinite(bid) ? bid : null },
                });
                closeCustomerFeedbackBannerModal();
                showToast(isRTL ? 'شكراً لملاحظتك، تم الإرسال' : 'Thank you — your message was sent.', {
                    variant: 'feedback-sent',
                    duration: 1000,
                });
            } catch (e) {
                alert(e.message || String(e));
            }
        }
        window.openCustomerFeedbackBannerModal = openCustomerFeedbackBannerModal;
        window.closeCustomerFeedbackBannerModal = closeCustomerFeedbackBannerModal;
        window.submitCustomerFeedbackBannerNote = submitCustomerFeedbackBannerNote;

        function openVendorJoinPage() {
            syncVendorJoinHeroFromConfig();
            syncVendorJoinTermsFromConfig();
            navigateTo('screen-vendor-join');
        }
        window.openVendorJoinPage = openVendorJoinPage;

        function backFromVendorJoin() {
            adoraUnifiedBack();
        }
        window.backFromVendorJoin = backFromVendorJoin;

        function renderMarketplaceHighlightRow(title, products, opts) {
            if (!products || !products.length) return '';
            const loc = isRTL ? 'ar' : 'en';
            const showHomePromo = opts && opts.showHomePromo;
            const cards = products
                .map((p) => {
                    const pid = Number(p.id);
                    const ptitle = loc === 'ar' ? p.name_ar || p.name_en : p.name_en || p.name_ar;
                    const vendor = loc === 'ar' ? p.vendor_name_ar || p.vendor_name_en : p.vendor_name_en || p.vendor_name_ar;
                    const vendorHtml = vendor ? `<p class="adora-pcard__vendor" dir="auto">${escapeHtml(String(vendor).trim())}</p>` : '';
                    const imgs = Array.isArray(p.images) ? p.images : [];
                    const img0 = imgs.length ? absoluteMediaUrl(imgs[0]) : adoraPlaceholderImageUrl();
                    const homeAd =
                        showHomePromo && Number(p.is_home_featured_promo) === 1
                            ? `<span class="absolute top-1 left-1 rtl:left-auto rtl:right-1 text-[9px] font-bold bg-fuchsia-600 text-white px-1.5 py-0.5 rounded-md shadow-sm z-[2]">${isRTL ? 'رئيسية' : 'Home'}</span>`
                            : '';
                    const mpFeat =
                        Number(p.is_mp_featured_effective) === 1
                            ? `<span class="adora-mp-hot-badge" dir="auto"><span class="adora-mp-hot-emoji" aria-hidden="true">🔥</span>${isRTL ? 'مميز' : 'Hot'}</span>`
                            : '';
                    const listP = Number(p.price ?? 0);
                    const disc = Math.min(100, Math.max(0, Number(p.discount_percent ?? 0)));
                    const saleP = p.final_price != null ? Number(p.final_price) : disc > 0 && disc < 100 ? listP * (1 - disc / 100) : listP;
                    const inWish = isWishlistEntry('mp', pid);
                    const canCart = Number(p.stock || 0) > 0;
                    const wishActive = inWish ? ' active' : '';
                    const addDis = canCart ? '' : ' disabled';
                    const ratingHtml = `<div class="adora-pcard__rating-row">${adoraPcardRatingHtml(p)}</div>`;
                    const priceHtml = adoraPcardPriceRowHtml({ disc, listP, saleP });
                    return `<div class="flex-shrink-0 w-[38%] max-w-[9.5rem] text-start">
                        <div class="adora-pcard adora-pcard--highlight">
                        <div role="button" tabindex="0" class="adora-pcard__hit cursor-pointer text-start active:scale-[0.98] transition-transform" onclick="openMarketplaceProductDetail(${pid})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMarketplaceProductDetail(${pid});}">
                        <div class="adora-pcard__top">
                        <div class="adora-pcard__media">
                            <div class="adora-pcard__media-inner relative">${homeAd}${mpFeat}<img src="${escapeHtml(img0)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>
                            <button type="button" class="adora-pcard__wish wishlist-btn${wishActive}" aria-label="Wishlist" onclick="wishlistCardToggle(event,'mp',${pid},this)">${adoraPcardWishIconsHtml()}</button>
                            <button type="button" class="adora-pcard__add"${addDis} aria-label="Add to cart" onclick="quickAddMarketplaceProductToCart(${pid},event)">+</button>
                        </div>
                        </div>
                        <div class="adora-pcard__body">
                            <h3 class="adora-pcard__title">${escapeHtml(ptitle)}</h3>
                            ${vendorHtml}
                            ${ratingHtml}
                            ${priceHtml}
                        </div>
                        </div>
                        </div>
                    </div>`;
                })
                .join('');
            return `<div class="space-y-1.5">
                <p class="adora-section-heading adora-section-heading--pulse px-0.5">${escapeHtml(title)}</p>
                <div class="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-0.5 px-0.5">${cards}</div>
            </div>`;
        }

        async function loadMarketplaceHomeHighlights() {
            const host = document.getElementById('marketplace-home-highlights');
            if (!host) return;
            try {
                const data = await apiFetch('/api/marketplace/home-highlights', { requireAuth: false });
                const feat = Array.isArray(data.featured) ? data.featured : [];
                const best = Array.isArray(data.bestsellers) ? data.bestsellers : [];
                const off = Array.isArray(data.offers) ? data.offers : [];
                const parts = [];
                if (feat.length) parts.push(renderMarketplaceHighlightRow(isRTL ? 'منتجات مميزة' : 'Featured', feat, { showHomePromo: true }));
                if (best.length) parts.push(renderMarketplaceHighlightRow(isRTL ? 'الأكثر مبيعاً' : 'Bestsellers', best));
                if (off.length) parts.push(renderMarketplaceHighlightRow(isRTL ? 'عروض' : 'Offers', off));
                if (!parts.length) {
                    host.classList.add('hidden');
                    host.innerHTML = '';
                    return;
                }
                host.classList.remove('hidden');
                host.innerHTML = parts.join('');
            } catch (_e) {
                host.classList.add('hidden');
                host.innerHTML = '';
            }
        }

        function backFromMarketplaceBrowse() {
            adoraUnifiedBack();
        }

        function backFromMarketplaceProduct() {
            stopGalleryAutoScroll('marketplace-product-gallery');
            const popped = adoraPopIfTopIs('screen-marketplace-product');
            if (popped) {
                adoraAfterPopNavigate(popped.prev, popped.leaving);
            } else {
                navigateTo('screen-marketplace', { skipHistory: true });
                adoraNavStack = ['screen-categories', 'screen-marketplace'];
                adoraSyncHistoryToScreen('screen-marketplace');
                persistAdoraSessionState();
            }
        }
        window.backFromMarketplaceProduct = backFromMarketplaceProduct;

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

        function renderMarketplaceVendorsStrip() {
            const wrap = document.getElementById('marketplace-vendors-strip-wrap');
            const row1 = document.getElementById('marketplace-vendors-row-1');
            const row2 = document.getElementById('marketplace-vendors-row-2');
            if (!wrap || !row1 || !row2) return;
            const list = Array.isArray(marketplaceBrowseVendorsCache) ? marketplaceBrowseVendorsCache : [];
            if (!list.length) {
                wrap.classList.add('hidden');
                row1.innerHTML = '';
                row2.innerHTML = '';
                row2.classList.add('hidden');
                return;
            }
            wrap.classList.remove('hidden');
            const loc = isRTL ? 'ar' : 'en';
            const buildChip = (v) => {
                const name = String(loc === 'ar' ? v.name_ar || v.name_en : v.name_en || v.name_ar || '').trim();
                const vid = Number(v.id);
                if (!Number.isFinite(vid)) return '';
                const sel = marketplaceBrowseVendorId != null && marketplaceBrowseVendorId === vid;
                const cls = `mp-vendor-chip${sel ? ' mp-vendor-chip--selected' : ''}`;
                const logoRaw = v.logo_url ? String(v.logo_url).trim() : '';
                const premiumStar =
                    Number(v.is_premium_active) === 1
                        ? `<span class="mp-vendor-premium-star" title="${isRTL ? 'شركة مميزة' : 'Featured company'}" aria-hidden="true">★</span>`
                        : '';
                const logo = logoRaw
                    ? `<span class="mp-vendor-logo-box">${premiumStar}<img src="${escapeHtml(absoluteMediaUrl(logoRaw))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
                    : `<span class="mp-vendor-logo-box mp-vendor-logo-box--placeholder">${premiumStar}${escapeHtml((name || '?').charAt(0))}</span>`;
                return `<button type="button" data-mp-browse-vendor-id="${vid}" class="${cls}">${logo}<span class="mp-vendor-chip-name" dir="auto">${escapeHtml(name || '—')}</span></button>`;
            };
            const parts = list.map(buildChip).filter(Boolean);
            const mid = Math.ceil(parts.length / 2);
            row1.innerHTML = parts.slice(0, mid).join('');
            const row2html = parts.slice(mid).join('');
            if (row2html) {
                row2.innerHTML = row2html;
                row2.classList.remove('hidden');
            } else {
                row2.innerHTML = '';
                row2.classList.add('hidden');
            }
        }

        async function loadMarketplaceVendorsStrip() {
            const wrap = document.getElementById('marketplace-vendors-strip-wrap');
            if (!wrap) return;
            try {
                let url = '/api/marketplace/vendors';
                if (marketplaceBrowseSectionId != null && Number.isFinite(marketplaceBrowseSectionId)) {
                    url += `?section_id=${encodeURIComponent(marketplaceBrowseSectionId)}`;
                }
                const rows = await apiFetch(url, { requireAuth: false });
                marketplaceBrowseVendorsCache = Array.isArray(rows) ? rows : [];
            } catch (_e) {
                marketplaceBrowseVendorsCache = [];
            }
            renderMarketplaceVendorsStrip();
        }

        function initMarketplaceVendorStripDelegation() {
            const screen = document.getElementById('screen-marketplace');
            if (!screen || screen.dataset.adoraMpVStripBound === '1') return;
            screen.dataset.adoraMpVStripBound = '1';
            screen.addEventListener('click', (e) => {
                const secBtn = e.target.closest('[data-mp-browse-section-id]');
                if (secBtn && screen.contains(secBtn)) {
                    e.preventDefault();
                    const raw = secBtn.getAttribute('data-mp-browse-section-id');
                    if (raw === '' || raw == null) {
                        marketplaceBrowseSectionId = null;
                    } else {
                        const n = Number(raw);
                        if (!Number.isFinite(n)) return;
                        marketplaceBrowseSectionId = marketplaceBrowseSectionId === n ? null : n;
                    }
                    marketplaceBrowseVendorId = null;
                    const si = document.getElementById('marketplace-search-input');
                    if (si) {
                        si.value = '';
                        resetAdoraSearchTypingForInput(si);
                    }
                    syncAdoraAnimatedSearchVisibility();
                    renderMarketplaceSectionsStrip();
                    loadMarketplaceVendorsStrip().catch(() => {});
                    refreshMarketplaceProductList().catch(() => {});
                    return;
                }
                const vbtn = e.target.closest('[data-mp-browse-vendor-id]');
                if (!vbtn || !screen.contains(vbtn)) return;
                e.preventDefault();
                const vid = Number(vbtn.getAttribute('data-mp-browse-vendor-id'));
                if (!Number.isFinite(vid)) return;
                if (marketplaceBrowseVendorId === vid) {
                    marketplaceBrowseVendorId = null;
                } else {
                    marketplaceBrowseVendorId = vid;
                    marketplaceBrowseSectionId = null;
                    const si = document.getElementById('marketplace-search-input');
                    if (si) {
                        si.value = '';
                        resetAdoraSearchTypingForInput(si);
                    }
                    syncAdoraAnimatedSearchVisibility();
                }
                renderMarketplaceVendorsStrip();
                renderMarketplaceSectionsStrip();
                refreshMarketplaceProductList().catch(() => {});
            });
        }

        function syncVendorJoinDocTypePanels() {
            const commercial = document.querySelector('input[name="vj-doc-type"][value="commercial"]')?.checked;
            document.getElementById('vj-national-uploads')?.classList.toggle('hidden', !!commercial);
            document.getElementById('vj-commercial-upload')?.classList.toggle('hidden', !commercial);
        }

        let vendorJoinPlansCache = null;
        let vendorJoinSelectedPlanKey = null;

        async function ensureVendorJoinPlansLoaded() {
            if (Array.isArray(vendorJoinPlansCache)) return vendorJoinPlansCache;
            const res = await fetch(`${getApiOrigin()}/api/public/vendor-platform/join-plans`);
            const data = await res.json().catch(() => ({}));
            vendorJoinPlansCache = Array.isArray(data.plans) ? data.plans : [];
            return vendorJoinPlansCache;
        }

        function prefetchVendorJoinPlans() {
            return ensureVendorJoinPlansLoaded();
        }

        function updateVendorJoinSelectedPlanUi() {
            const el = document.getElementById('vj-selected-plan-label');
            if (!el) return;
            const plans = vendorJoinPlansCache || [];
            const p = plans.find((x) => x && String(x.key) === String(vendorJoinSelectedPlanKey));
            if (vendorJoinSelectedPlanKey && p) {
                const title = isRTL ? p.title_ar || p.title_en || p.key : p.title_en || p.title_ar || p.key;
                el.textContent = isRTL ? `الباقة المختارة: ${title}` : `Selected plan: ${title}`;
                el.classList.remove('hidden');
            } else {
                el.textContent = '';
                el.classList.add('hidden');
            }
        }

        function syncVendorJoinPlansModalLocale() {
            const mh = document.getElementById('vendor-join-plans-modal-title');
            if (mh) {
                const da = mh.getAttribute('data-ar');
                const de = mh.getAttribute('data-en');
                if (da && de) {
                    let t = isRTL ? da : de;
                    t = t.replace(/&amp;/g, '&');
                    mh.textContent = t;
                }
            }
        }

        function renderVendorJoinPlansModalList() {
            const root = document.getElementById('vendor-join-plans-modal-list');
            if (!root) return;
            const plans = vendorJoinPlansCache || [];
            if (!plans.length) {
                root.innerHTML = `<p class="text-center text-sm text-gray-500 py-6">${isRTL ? 'لا توجد باقات حالياً.' : 'No plans available.'}</p>`;
                return;
            }
            root.innerHTML = plans
                .map((p) => {
                    const title = isRTL ? p.title_ar || p.title_en : p.title_en || p.title_ar;
                    const price = isRTL ? p.price_label_ar || '' : p.price_label_en || '';
                    const bullets = (isRTL ? p.bullets_ar : p.bullets_en) || [];
                    const bl = Array.isArray(bullets)
                        ? bullets
                              .slice(0, 14)
                              .map((l) => `<li class="text-[11px] text-gray-600">${escapeHtml(l)}</li>`)
                              .join('')
                        : '';
                    const sel = vendorJoinSelectedPlanKey === p.key;
                    return `<div class="rounded-2xl border ${sel ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'} bg-white p-4 shadow-sm">
                        <div class="flex flex-col gap-1">
                            <p class="font-bold text-gray-900 text-sm">${escapeHtml(title || p.key)}</p>
                            ${price ? `<p class="text-xs font-semibold text-violet-700">${escapeHtml(price)}</p>` : ''}
                            ${bl ? `<ul class="list-disc ps-4 mt-2 space-y-0.5">${bl}</ul>` : ''}
                        </div>
                        <button type="button" class="mt-3 w-full py-2.5 rounded-xl bg-violet-600 text-white text-xs font-bold shadow-md shadow-violet-600/20 hover:bg-violet-700 active:scale-[0.99] touch-manipulation" data-vj-pick-plan="${escapeHtml(String(p.key || '').trim())}">${isRTL ? 'اختيار هذه الباقة' : 'Select this plan'}</button>
                    </div>`;
                })
                .join('');
        }

        function openVendorJoinPlansModal() {
            const modal = document.getElementById('vendor-join-plans-modal');
            if (!modal) return;
            document.body.style.overflow = 'hidden';
            const sc = document.getElementById('vendor-join-plans-modal-scroll');
            if (sc) {
                sc.scrollTop = 0;
            }
            syncVendorJoinPlansModalLocale();
            ensureVendorJoinPlansLoaded()
                .then(() => {
                    renderVendorJoinPlansModalList();
                    modal.classList.remove('hidden');
                    modal.setAttribute('aria-hidden', 'false');
                })
                .catch(() => {
                    const root = document.getElementById('vendor-join-plans-modal-list');
                    if (root) {
                        root.innerHTML = `<p class="text-center text-red-600 text-sm py-6">${isRTL ? 'تعذر تحميل الباقات.' : 'Could not load plans.'}</p>`;
                    }
                    modal.classList.remove('hidden');
                    modal.setAttribute('aria-hidden', 'false');
                });
        }

        function closeVendorJoinPlansModal() {
            const modal = document.getElementById('vendor-join-plans-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.setAttribute('aria-hidden', 'true');
            }
            restoreBodyScrollIfIdle();
        }

        try {
            window.closeVendorJoinPlansModal = closeVendorJoinPlansModal;
        } catch (_eW) {}

        function bindVendorJoinDocTypeOnce() {
            const form = document.getElementById('vendor-join-page-form');
            if (!form || form.dataset.adoraVjDocBound === '1') return;
            form.dataset.adoraVjDocBound = '1';
            document.querySelectorAll('input[name="vj-doc-type"]').forEach((r) => r.addEventListener('change', syncVendorJoinDocTypePanels));
            syncVendorJoinDocTypePanels();
        }

        function bindVendorJoinPageFormOnce() {
            const form = document.getElementById('vendor-join-page-form');
            if (!form || form.dataset.adoraVjBound === '1') return;
            form.dataset.adoraVjBound = '1';
            bindVendorJoinDocTypeOnce();
            const plansModal = document.getElementById('vendor-join-plans-modal');
            /* استخدم مرحلة الالتقاط (capture): اللوحة الداخلية تستدعي stopPropagation() لمنع إغلاق الخلفية،
               وهذا يمنع وصول النقر في الفقاعة إلى #vendor-join-plans-modal فيُفقد اختيار الباقة على اللمس. */
            if (plansModal && plansModal.dataset.vjPlanPickBound !== '1') {
                plansModal.dataset.vjPlanPickBound = '1';
                plansModal.addEventListener(
                    'click',
                    (ev) => {
                        const raw = ev.target;
                        const btn = raw && raw.closest ? raw.closest('[data-vj-pick-plan]') : null;
                        if (!btn || !plansModal.contains(btn)) return;
                        const k = btn.getAttribute('data-vj-pick-plan');
                        if (!k) return;
                        try {
                            ev.preventDefault();
                            ev.stopPropagation();
                        } catch (_e) {}
                        vendorJoinSelectedPlanKey = k;
                        updateVendorJoinSelectedPlanUi();
                        closeVendorJoinPlansModal();
                    },
                    true
                );
            }
            const pickPlanBtn = document.getElementById('vendor-join-btn-pick-plan');
            if (pickPlanBtn && pickPlanBtn.dataset.adoraVjPickPlan !== '1') {
                pickPlanBtn.dataset.adoraVjPickPlan = '1';
                pickPlanBtn.addEventListener('click', (e) => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_e2) {}
                    openVendorJoinPlansModal();
                });
            }
            const readTermsBtn = document.getElementById('vendor-join-btn-read-terms');
            if (readTermsBtn && readTermsBtn.dataset.adoraVjTermsBtn !== '1') {
                readTermsBtn.dataset.adoraVjTermsBtn = '1';
                readTermsBtn.addEventListener(
                    'click',
                    (e) => {
                        try {
                            e.preventDefault();
                            e.stopPropagation();
                        } catch (_e2) {}
                        openVendorJoinTermsModal(e);
                    },
                    true
                );
            }
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const msg = document.getElementById('vendor-join-page-msg');
                if (msg) {
                    msg.classList.add('hidden');
                    msg.textContent = '';
                }
                const docCommercial = document.querySelector('input[name="vj-doc-type"][value="commercial"]')?.checked;
                const ff = document.getElementById('vj-p-id-front')?.files?.[0];
                const fb = document.getElementById('vj-p-id-back')?.files?.[0];
                const fc = document.getElementById('vj-p-commercial-img')?.files?.[0];
                if (!docCommercial) {
                    if (!ff && !fb) {
                        if (msg) {
                            msg.textContent = isRTL
                                ? 'ارفع صورة وجه الهوية أو الخلفية (أو كليهما).'
                                : 'Upload the front and/or back of your ID.';
                            msg.className =
                                'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-amber-100 text-amber-900 border border-amber-200/80';
                            msg.classList.remove('hidden');
                        }
                        return;
                    }
                } else if (!fc) {
                    if (msg) {
                        msg.textContent = isRTL
                            ? 'ارفع صورة السجل التجاري.'
                            : 'Upload your commercial registration image.';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-amber-100 text-amber-900 border border-amber-200/80';
                        msg.classList.remove('hidden');
                    }
                    return;
                }
                if (!vendorJoinSelectedPlanKey) {
                    if (msg) {
                        msg.textContent = isRTL
                            ? 'يرجى اختيار باقة من القائمة قبل الإرسال.'
                            : 'Please choose a subscription plan before submitting.';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-amber-100 text-amber-900 border border-amber-200/80';
                        msg.classList.remove('hidden');
                    }
                    return;
                }
                if (!document.getElementById('vj-p-terms')?.checked) {
                    if (msg) {
                        msg.textContent = isRTL
                            ? 'يجب الموافقة على الشروط والأحكام لإرسال الطلب.'
                            : 'You must accept the terms and conditions to submit.';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-amber-100 text-amber-900 border border-amber-200/80';
                        msg.classList.remove('hidden');
                    }
                    return;
                }
                const fd = new FormData();
                fd.append('full_name', document.getElementById('vj-p-full-name')?.value?.trim() || '');
                fd.append('phone', document.getElementById('vj-p-phone')?.value?.trim() || '');
                fd.append('company_name', document.getElementById('vj-p-company')?.value?.trim() || '');
                fd.append('email', document.getElementById('vj-p-email')?.value?.trim() || '');
                fd.append('doc_type', docCommercial ? 'commercial' : 'national_id');
                fd.append('terms_accepted', document.getElementById('vj-p-terms')?.checked ? '1' : '0');
                fd.append('selected_plan_key', String(vendorJoinSelectedPlanKey));
                if (ff) fd.append('id_front', ff);
                if (fb) fd.append('id_back', fb);
                if (fc) fd.append('commercial_register', fc);
                try {
                    const headers = {};
                    const tok = getStoredJwtToken();
                    if (tok) headers['Authorization'] = `Bearer ${tok}`;
                    const res = await fetch(`${getApiOrigin()}/api/vendor-subscription-requests`, {
                        method: 'POST',
                        headers,
                        body: fd,
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        const errLine = isRTL
                            ? data.error || data.error_en || 'تعذر الإرسال'
                            : data.error_en || data.error || 'Could not submit';
                        throw new Error(errLine);
                    }
                    refreshVendorSubscriptionSideMenu().catch(() => {});
                    if (msg) {
                        msg.textContent = isRTL
                            ? 'تم إرسال الطلب إلى شركة Adora'
                            : 'Your request has been sent to Adora';
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-emerald-100 text-emerald-800 border border-emerald-200/80';
                        msg.classList.remove('hidden');
                    }
                    form.reset();
                    syncVendorJoinDocTypePanels();
                    vendorJoinSelectedPlanKey = null;
                    updateVendorJoinSelectedPlanUi();
                    setTimeout(() => backFromVendorJoin(), 2400);
                } catch (err) {
                    if (msg) {
                        msg.textContent = err.message || (isRTL ? 'تعذر الإرسال' : 'Could not submit');
                        msg.className =
                            'text-xs text-center font-semibold rounded-xl py-2 px-3 bg-red-100 text-red-800 border border-red-200/80';
                        msg.classList.remove('hidden');
                    }
                }
            });
        }

        async function initMarketplaceBrowseScreen() {
            attachMarketplaceSearchListeners();
            const preset = marketplaceBrowsePreset;
            marketplaceBrowsePreset = null;
            marketplaceBrowseVendorId = null;
            marketplaceBrowseSectionId = null;
            if (preset && typeof preset === 'object') {
                const vid = preset.vendor_id != null ? Number(preset.vendor_id) : NaN;
                const sid = preset.section_id != null ? Number(preset.section_id) : NaN;
                if (Number.isFinite(vid)) marketplaceBrowseVendorId = vid;
                if (Number.isFinite(sid)) marketplaceBrowseSectionId = sid;
                if (preset.q) {
                    const si = document.getElementById('marketplace-search-input');
                    if (si) si.value = String(preset.q);
                }
            }
            syncAdoraAnimatedSearchVisibility();
            await loadMarketplaceSectionsStrip();
            await loadMarketplaceVendorsStrip();
            await refreshMarketplaceProductList();
        }

        function renderMarketplaceSectionsStrip() {
            const wrap = document.getElementById('marketplace-sections-strip-wrap');
            const row = document.getElementById('marketplace-sections-row');
            if (!wrap || !row) return;
            const list = Array.isArray(marketplaceBrowseSectionsCache) ? marketplaceBrowseSectionsCache : [];
            if (!list.length) {
                wrap.classList.add('hidden');
                row.innerHTML = '';
                return;
            }
            wrap.classList.remove('hidden');
            const loc = isRTL ? 'ar' : 'en';
            const allLabel = isRTL ? 'الكل' : 'All';
            const allSel = marketplaceBrowseSectionId == null;
            const allChip = `<button type="button" data-mp-browse-section-id="" class="mp-section-chip${
                allSel ? ' mp-section-chip--selected' : ''
            }"><span class="truncate">${escapeHtml(allLabel)}</span></button>`;
            const chips = list
                .map((s) => {
                    const id = Number(s.id);
                    if (!Number.isFinite(id)) return '';
                    const name = String(loc === 'ar' ? s.name_ar || s.name_en : s.name_en || s.name_ar || '').trim();
                    const imgRaw = s.card_image_url ? String(s.card_image_url).trim() : '';
                    const sel = marketplaceBrowseSectionId === id;
                    const thumb = imgRaw
                        ? `<span class="mp-section-chip-thumb"><img src="${escapeHtml(absoluteMediaUrl(imgRaw))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
                        : '';
                    return `<button type="button" data-mp-browse-section-id="${id}" class="mp-section-chip${
                        sel ? ' mp-section-chip--selected' : ''
                    }">${thumb}<span class="truncate min-w-0">${escapeHtml(name || '—')}</span></button>`;
                })
                .join('');
            row.innerHTML = allChip + chips;
        }

        async function loadMarketplaceSectionsStrip() {
            const wrap = document.getElementById('marketplace-sections-strip-wrap');
            const row = document.getElementById('marketplace-sections-row');
            if (!wrap || !row) return;
            try {
                const rows = await apiFetch('/api/marketplace/sections', { requireAuth: false });
                marketplaceBrowseSectionsCache = Array.isArray(rows) ? rows : [];
            } catch (_e) {
                marketplaceBrowseSectionsCache = [];
            }
            renderMarketplaceSectionsStrip();
        }

        async function loadMarketplaceHomeEntrance() {
            const img = document.getElementById('marketplace-home-entrance-img');
            const tEl = document.getElementById('marketplace-home-entrance-title');
            const sEl = document.getElementById('marketplace-home-entrance-subtitle');
            if (!tEl || !sEl) {
                return;
            }
            try {
                const d = await apiFetch('/api/marketplace/entrance', { requireAuth: false });
                const loc = isRTL ? 'ar' : 'en';
                const title = loc === 'ar' ? d.title_ar || d.title_en : d.title_en || d.title_ar;
                const sub = loc === 'ar' ? d.subtitle_ar || d.subtitle_en : d.subtitle_en || d.subtitle_ar;
                tEl.textContent = title || (isRTL ? 'سوق الشركات في أدورا' : 'Adora partner market');
                sEl.textContent = sub || (isRTL ? 'ابحث في منتجات كل الشركات من مكان واحد.' : 'Search products from every partner in one place.');
                const heroSrc = String(d.hero_image_url || d.image_url || '').trim();
                if (img && heroSrc) {
                    const abs = absoluteMediaUrl(heroSrc);
                    if (abs) {
                        try {
                            img.loading = 'eager';
                        } catch (_x) {}
                        img.hidden = false;
                        img.alt = title || '';
                        img.src = abs;
                    } else {
                        img.removeAttribute('src');
                        img.hidden = true;
                    }
                } else if (img) {
                    img.removeAttribute('src');
                    img.hidden = true;
                }
            } catch (_e) {
                tEl.textContent = isRTL ? 'سوق الشركات في أدورا' : 'Adora partner market';
                sEl.textContent = isRTL ? 'ادخل وابحث في كل المنتجات.' : 'Enter and search all products.';
                if (img) {
                    img.removeAttribute('src');
                    img.hidden = true;
                }
            }
        }

        function runMarketplaceSearchFromUi() {
            hideAdoraSearchSuggestions();
            refreshMarketplaceProductList().catch(() => {});
        }
        window.runMarketplaceSearchFromUi = runMarketplaceSearchFromUi;

        async function refreshMarketplaceProductList() {
            const grid = document.getElementById('marketplace-products-grid');
            if (!grid) return;
            const params = new URLSearchParams();
            const q = (document.getElementById('marketplace-search-input')?.value || '').trim();
            if (q) params.set('q', q);
            if (marketplaceBrowseVendorId != null && Number.isFinite(marketplaceBrowseVendorId)) {
                params.set('vendor_id', String(marketplaceBrowseVendorId));
            }
            if (marketplaceBrowseSectionId != null && Number.isFinite(marketplaceBrowseSectionId)) {
                params.set('section_id', String(marketplaceBrowseSectionId));
            }
            params.set('sort', 'newest');
            grid.innerHTML = adoraSkeletonProductGridHtml(8);
            try {
                const narrow =
                    (marketplaceBrowseVendorId != null && Number.isFinite(marketplaceBrowseVendorId)) ||
                    (marketplaceBrowseSectionId != null && Number.isFinite(marketplaceBrowseSectionId));
                const products = await apiFetch(`/api/marketplace/products?${params.toString()}`, { requireAuth: false });
                const arr = Array.isArray(products) ? products : [];
                let catList = [];
                if (!narrow && q) {
                    try {
                        const cq = new URLSearchParams();
                        cq.set('q', q);
                        cq.set('merge_marketplace', '0');
                        const cr = await apiFetch(`/api/products?${cq.toString()}`, { requireAuth: false });
                        catList = Array.isArray(cr) ? cr : [];
                    } catch (_e) {
                        catList = [];
                    }
                }
                const combined = arr.length + catList.length;
                if (!combined) {
                    let emptyMsg;
                    if (q) {
                        emptyMsg = isRTL ? 'لا نتائج.' : 'No results.';
                    } else if (narrow) {
                        emptyMsg = isRTL ? 'لا توجد منتجات لهذه الشركة حالياً.' : 'No products for this company right now.';
                    } else {
                        emptyMsg = isRTL
                            ? 'لا توجد منتجات للعرض حالياً. جرّب البحث أو اختر شركة.'
                            : 'Nothing to show yet. Try search or pick a company.';
                    }
                    grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-12 text-sm">${emptyMsg}</p>`;
                    return;
                }
                const loc = isRTL ? 'ar' : 'en';
                const renderMpSearchCardHtml = (p) => {
                    const mid = Number(p.id);
                    const title = loc === 'ar' ? p.name_ar || p.name_en : p.name_en || p.name_ar;
                    const vendor = loc === 'ar' ? p.vendor_name_ar || p.vendor_name_en : p.vendor_name_en || p.vendor_name_ar;
                    const vendorHtml = vendor ? `<p class="adora-pcard__vendor" dir="auto">${escapeHtml(String(vendor).trim())}</p>` : '';
                    const imgs = Array.isArray(p.images) ? p.images : [];
                    const img0 = imgs.length ? absoluteMediaUrl(imgs[0]) : adoraPlaceholderImageUrl();
                    const offer = Number(p.is_offer) === 1;
                    const sponsored = Number(p.is_search_sponsored) === 1;
                    let promoLeft = '';
                    if (sponsored) {
                        promoLeft = `<span class="absolute top-2 left-2 rtl:left-auto rtl:right-2 text-[10px] font-bold bg-violet-600 text-white px-2 py-0.5 rounded-full z-[2]">${isRTL ? 'ممول' : 'Sponsored'}</span>`;
                    }
                    const disc = Number(p.discount_percent || 0);
                    const finalP = p.final_price != null ? Number(p.final_price) : Number(p.price || 0);
                    const listP = Number(p.price || 0);
                    const saleP = disc > 0 && disc < 100 ? finalP : listP;
                    const featBadge =
                        Number(p.is_mp_featured_effective) === 1
                            ? `<span class="adora-mp-hot-badge" dir="auto"><span class="adora-mp-hot-emoji" aria-hidden="true">🔥</span>${isRTL ? 'مميز' : 'Hot'}</span>`
                            : '';
                    const inWish = isWishlistEntry('mp', mid);
                    const canCart = Number(p.stock || 0) > 0;
                    const wishActive = inWish ? ' active' : '';
                    const addDis = canCart ? '' : ' disabled';
                    const offerTop = sponsored ? 'top-10' : 'top-2';
                    const ratingHtml = `<div class="adora-pcard__rating-row">${adoraPcardRatingHtml(p)}</div>`;
                    const priceHtml = adoraPcardPriceRowHtml({ disc, listP, saleP });
                    return `<div class="adora-pcard adora-pcv product-card active:scale-[0.99] transition-transform">
                            <div role="button" tabindex="0" class="adora-pcard__hit cursor-pointer" onclick="openMarketplaceProductDetail(${mid})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMarketplaceProductDetail(${mid});}">
                            <div class="adora-pcard__top">
                            <div class="adora-pcard__media">
                            <div class="adora-pcard__media-inner">
                                <img src="${escapeHtml(img0)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                                ${promoLeft}
                                ${offer ? `<span class="absolute ${offerTop} right-2 rtl:right-auto rtl:left-2 text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full z-[2]">${isRTL ? 'عرض' : 'Offer'}</span>` : ''}
                                ${featBadge}
                            </div>
                            <button type="button" class="adora-pcard__wish wishlist-btn${wishActive}" aria-label="Wishlist" onclick="wishlistCardToggle(event,'mp',${mid},this)">${adoraPcardWishIconsHtml()}</button>
                            <button type="button" class="adora-pcard__add"${addDis} aria-label="Add to cart" onclick="quickAddMarketplaceProductToCart(${mid},event)">+</button>
                            </div>
                            </div>
                            <div class="adora-pcard__body">
                            <h3 class="adora-pcard__title">${escapeHtml(title)}</h3>
                            ${vendorHtml}
                            ${ratingHtml}
                            ${priceHtml}
                            </div>
                            </div>
                        </div>`;
                };
                let combinedPieces;
                if (!narrow && q && catList.length) {
                    const merged = [
                        ...arr.map((p) => ({ src: 'mp', p })),
                        ...catList.map((p) => ({ src: 'cat', p })),
                    ];
                    merged.sort((a, b) => {
                        const sa =
                            a.src === 'mp'
                                ? Number(a.p.is_mp_featured_effective) === 1
                                    ? 1
                                    : 0
                                : Number(a.p.is_featured) === 1
                                  ? 1
                                  : 0;
                        const sb =
                            b.src === 'mp'
                                ? Number(b.p.is_mp_featured_effective) === 1
                                    ? 1
                                    : 0
                                : Number(b.p.is_featured) === 1
                                  ? 1
                                  : 0;
                        if (sb !== sa) return sb - sa;
                        return (Number(b.p.id) || 0) - (Number(a.p.id) || 0);
                    });
                    combinedPieces = merged.map(({ src, p }) =>
                        src === 'mp' ? renderMpSearchCardHtml(p) : renderProductCardHtml(p, { compact: true })
                    );
                } else {
                    combinedPieces = [
                        ...arr.map((p) => renderMpSearchCardHtml(p)),
                        ...catList.map((p) => renderProductCardHtml(p, { compact: true })),
                    ];
                }
                adoraInsertAdjacentHtmlChunked(grid, combinedPieces, 8);
            } catch (e) {
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-10 text-sm">${escapeHtml(e.message || (isRTL ? 'تعذر التحميل' : 'Failed to load'))}</p>`;
            }
        }

        function legacyMarketplaceStockForPick(p, size, color) {
            if (!p) return 0;
            const inv = Array.isArray(p.inventory) ? p.inventory : [];
            const szRaw = String(size || '').trim();
            const sz = szRaw === '—' ? '' : szRaw;
            const cl = String(color || '').trim();
            if (!inv.length) return Number(p.stock || 0);
            const row = inv.find((r) => {
                if (r.options && typeof r.options === 'object' && Object.keys(r.options).length) return false;
                const rs = String(r.size || '').trim().toLowerCase();
                const rc = String(r.color || '').trim().toLowerCase();
                const szMatch = !sz || rs === sz.toLowerCase();
                const clMatch = !cl || rc === cl.toLowerCase();
                return szMatch && clMatch;
            });
            return row ? Number(row.stock || 0) : 0;
        }

        function getSelectedMarketplaceDetailColor() {
            const p = currentMarketplaceProductDetail;
            const colors = p && Array.isArray(p.colors) ? p.colors : [];
            if (!colors.length) return '';
            const c = colors[marketplaceDetailSelectedColorIndex];
            return c != null ? String(c).trim() : '';
        }

        function getSelectedMarketplaceDetailSize() {
            const btn = document.querySelector('#marketplace-size-options .size-btn.selected:not(.disabled)');
            return btn ? String(btn.getAttribute('data-size') || '').trim() : '';
        }

        function selectMarketplaceDetailColorIdx(idx) {
            const p = currentMarketplaceProductDetail;
            const colors = p && Array.isArray(p.colors) ? p.colors.map((c) => String(c)) : [];
            const n = Number(idx);
            if (!Number.isFinite(n) || n < 0 || n >= colors.length) return;
            marketplaceDetailSelectedColorIndex = n;
            document.querySelectorAll('#marketplace-color-options .color-btn').forEach((b) => {
                const i = Number(b.getAttribute('data-mp-color-idx'));
                b.classList.toggle('selected', i === marketplaceDetailSelectedColorIndex);
            });
            const sc = document.getElementById('marketplace-selected-color');
            if (sc) sc.textContent = colors[n] || '—';
            rebuildMarketplaceDetailSizes(p);
            const stEl = document.getElementById('marketplace-detail-stock');
            if (stEl && p && !productUsesDynamicOptions(p)) {
                const st = legacyMarketplaceStockForPick(p, getSelectedMarketplaceDetailSize(), getSelectedMarketplaceDetailColor());
                stEl.textContent = st > 0 ? (isRTL ? `متوفر: ${st}` : `In stock: ${st}`) : isRTL ? 'غير متوفر' : 'Out of stock';
                if (st > 0 && marketplaceDetailQty > st) marketplaceDetailQty = st;
                const qd = document.getElementById('marketplace-qty-display');
                if (qd) qd.textContent = String(marketplaceDetailQty);
            }
        }

        function selectMarketplaceDetailSize(btn) {
            if (!btn || btn.classList.contains('disabled')) return;
            document.querySelectorAll('#marketplace-size-options .size-btn').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
            const p = currentMarketplaceProductDetail;
            if (!p || productUsesDynamicOptions(p)) return;
            const cap = legacyMarketplaceStockForPick(p, getSelectedMarketplaceDetailSize(), getSelectedMarketplaceDetailColor());
            if (cap > 0 && marketplaceDetailQty > cap) marketplaceDetailQty = cap;
            const qd = document.getElementById('marketplace-qty-display');
            if (qd) qd.textContent = String(marketplaceDetailQty);
        }

        function rebuildMarketplaceDetailSizes(p) {
            const szWrap = document.getElementById('marketplace-size-options');
            if (!szWrap || !p) return;
            const color = getSelectedMarketplaceDetailColor();
            const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.map((s) => String(s)) : ['—'];
            let firstSel = null;
            szWrap.innerHTML = sizes
                .map((s) => {
                    const ok = s === '—' ? Number(p.stock || 0) > 0 : variantHasStock(p, s, color);
                    const sel = ok && firstSel == null;
                    if (sel) firstSel = s;
                    const safe = escapeHtml(s);
                    return `<button type="button" class="size-btn ${sel ? 'selected' : ''} w-14 h-14 rounded-2xl border-2 font-semibold text-sm ${
                        ok ? 'border-gray-200 text-gray-800 hover:border-purple-400' : 'disabled border-gray-100 text-gray-400'
                    }" data-size="${safe}" ${ok ? '' : 'disabled'}>${safe}</button>`;
                })
                .join('');
            szWrap.querySelectorAll('.size-btn').forEach((b) => {
                b.addEventListener('click', () => selectMarketplaceDetailSize(b));
            });
        }

        function fillMarketplaceLegacyVariantUi(p) {
            if (!p) return;
            marketplaceDetailSelectedColorIndex = 0;
            const colWrap = document.getElementById('marketplace-color-options');
            const colors = Array.isArray(p.colors) && p.colors.length ? p.colors.map((c) => String(c)) : [];
            if (colWrap) {
                if (!colors.length) {
                    colWrap.innerHTML = `<span class="text-sm text-gray-500">${isRTL ? 'لون واحد' : 'Standard'}</span>`;
                    const sc = document.getElementById('marketplace-selected-color');
                    if (sc) sc.textContent = '—';
                } else {
                    colWrap.innerHTML = colors
                        .map((c, i) => {
                            const lab = escapeHtml(String(c).slice(0, 6));
                            return `<button type="button" class="color-btn ${i === 0 ? 'selected' : ''} w-10 h-10 min-w-[2.5rem] rounded-full border-2 border-gray-200 shadow-sm text-[9px] font-bold text-gray-700 flex items-center justify-center px-1" data-mp-color-idx="${i}">${lab}</button>`;
                        })
                        .join('');
                    colWrap.querySelectorAll('.color-btn').forEach((b) => {
                        b.addEventListener('click', () => {
                            const i = Number(b.getAttribute('data-mp-color-idx'));
                            selectMarketplaceDetailColorIdx(i);
                        });
                    });
                    const sc = document.getElementById('marketplace-selected-color');
                    if (sc) sc.textContent = colors[0];
                }
            }
            rebuildMarketplaceDetailSizes(p);
        }

        async function openMarketplaceProductDetail(id, opts = {}) {
            const skipNavigate = opts.skipNavigate === true;
            const loadGen = ++adoraMpPdpLoadGen;
            const relSec = document.getElementById('mp-product-related-section');
            const relWrap = document.getElementById('mp-product-related-scroll');
            if (relWrap) {
                relWrap.innerHTML = `<p class="text-sm text-gray-500 text-center py-6 px-2" data-en="Loading suggestions…" data-ar="جاري تحميل الاقتراحات…">جاري تحميل الاقتراحات…</p>`;
            }
            if (relSec) relSec.classList.remove('hidden');
            if (!skipNavigate) {
                navigateTo('screen-marketplace-product');
            }
            setMpPdpBusy(true);
            try {
                const p = await apiFetch(`/api/marketplace/products/${Number(id)}`, { requireAuth: false });
                if (loadGen !== adoraMpPdpLoadGen) return;
                currentMarketplaceProductDetail = p;
                marketplaceDetailQty = 1;
                renderMarketplaceProductDetailUi();
                if (skipNavigate) {
                    persistAdoraSessionState();
                }
                scheduleMpPdpReviews(loadGen, p.id);
                scheduleMpPdpYouMayAlsoLike(loadGen, p.id);
            } catch (err) {
                if (loadGen !== adoraMpPdpLoadGen) return;
                try {
                    console.error('[Adora] openMarketplaceProductDetail', id, err);
                } catch (_log) {}
                showToast(isRTL ? 'تعذر فتح المنتج' : 'Could not open product');
                if (!skipNavigate) {
                    const popped = adoraPopIfTopIs('screen-marketplace-product');
                    if (popped) {
                        adoraAfterPopNavigate(popped.prev, popped.leaving);
                    } else {
                        navigateTo('screen-marketplace', { skipHistory: true });
                        adoraNavStack = ['screen-categories', 'screen-marketplace'];
                        adoraSyncHistoryToScreen('screen-marketplace');
                        persistAdoraSessionState();
                    }
                }
            } finally {
                if (loadGen === adoraMpPdpLoadGen) {
                    setMpPdpBusy(false, loadGen);
                }
            }
        }

        function renderMarketplaceProductDetailUi() {
            const p = currentMarketplaceProductDetail;
            if (!p) return;
            applyProductReviewThemeById(p.id, 'marketplace');
            const isDyn = productUsesDynamicOptions(p);
            if (isDyn) {
                marketplaceDetailVariantPick = defaultVariantPickDynamic(p);
            } else {
                marketplaceDetailVariantPick = {};
            }
            const loc = isRTL ? 'ar' : 'en';
            const title = loc === 'ar' ? p.name_ar || p.name_en : p.name_en || p.name_ar;
            const vendor = loc === 'ar' ? p.vendor_name_ar || p.vendor_name_en : p.vendor_name_en || p.vendor_name_ar;
            const sec = loc === 'ar' ? p.section_name_ar || p.section_name_en : p.section_name_en || p.section_name_ar;
            const dept = loc === 'ar' ? p.department_name_ar || p.department_name_en : p.department_name_en || p.department_name_ar;
            const secLine = [sec, dept].filter(Boolean).join(' · ');
            const desc = loc === 'ar' ? p.description_ar || p.description_en : p.description_en || p.description_ar;
            const tEl = document.getElementById('marketplace-detail-title');
            const vEl = document.getElementById('marketplace-detail-vendor');
            const vNameEl = document.getElementById('marketplace-detail-vendor-name');
            const vBtn = document.getElementById('marketplace-detail-vendor-products-btn');
            const sEl = document.getElementById('marketplace-detail-section');
            const priceEl = document.getElementById('marketplace-detail-price');
            const priceOldEl = document.getElementById('marketplace-detail-price-old');
            const discBadge = document.getElementById('marketplace-detail-discount-badge');
            const stEl = document.getElementById('marketplace-detail-stock');
            const addPEl = document.getElementById('marketplace-detail-add-price');
            const off = document.getElementById('marketplace-detail-offer-badge');
            const dynRoot = document.getElementById('marketplace-dynamic-variant-root');
            if (dynRoot && !isDyn) {
                dynRoot.innerHTML = '';
                dynRoot.classList.add('hidden');
            }
            const leg = document.getElementById('marketplace-legacy-variant-sections');
            if (leg) leg.classList.toggle('hidden', isDyn);
            if (!isDyn) fillMarketplaceLegacyVariantUi(p);
            if (tEl) tEl.textContent = title || '—';
            if (vEl) {
                vEl.classList.add('hidden');
                vEl.innerHTML = '';
            }
            if (vNameEl) vNameEl.textContent = vendor || '—';
            if (vBtn) {
                const okVid = p.vendor_id != null && Number.isFinite(Number(p.vendor_id));
                vBtn.classList.toggle('hidden', !okVid);
            }
            if (sEl) sEl.textContent = secLine || '';
            syncMarketplaceDescriptionUi(desc);
            if (off) off.classList.toggle('hidden', Number(p.is_offer) !== 1);
            if (!isDyn) {
                const discPct = Math.min(100, Math.max(0, Number(p.discount_percent || 0)));
                const listP = Number(p.price || 0);
                const finalP = p.final_price != null ? Number(p.final_price) : listP;
                const displayP = discPct > 0 && discPct < 100 ? finalP : listP;
                if (priceEl) priceEl.textContent = formatSyp(displayP);
                if (addPEl) addPEl.textContent = ` — ${formatSyp(displayP)}`;
                if (priceOldEl) {
                    const showOld = discPct > 0 && discPct < 100;
                    priceOldEl.classList.toggle('hidden', !showOld);
                    priceOldEl.textContent = showOld ? formatSyp(listP) : '';
                }
                if (discBadge) discBadge.classList.add('hidden');
                const dpill = document.getElementById('marketplace-detail-discount-pill');
                const gb = document.getElementById('marketplace-gallery-discount-badge');
                const showD = discPct > 0 && discPct < 100;
                if (dpill) {
                    if (showD) {
                        dpill.textContent = formatPdpDiscountLine(discPct);
                        dpill.classList.remove('hidden');
                    } else dpill.classList.add('hidden');
                }
                if (gb) {
                    if (showD) {
                        gb.textContent = `-${discPct}%`;
                        gb.classList.remove('hidden');
                    } else gb.classList.add('hidden');
                }
                if (stEl) {
                    const st = legacyMarketplaceStockForPick(
                        p,
                        getSelectedMarketplaceDetailSize(),
                        getSelectedMarketplaceDetailColor()
                    );
                    stEl.textContent = st > 0 ? (isRTL ? `متوفر: ${st}` : `In stock: ${st}`) : isRTL ? 'غير متوفر' : 'Out of stock';
                }
                const gal = document.getElementById('marketplace-product-gallery');
                if (gal) {
                    const list = normalizePdpImageList(p.images);
                    const imgs = list.length ? list : [adoraPlaceholderImageUrl()];
                    adoraReplaceGallerySlidesKeepingToolbar(gal, adoraBuildPdpGallerySlidesHtml(imgs), 0);
                    syncHorizontalGalleryDots('marketplace-product-gallery', 'marketplace-gallery-dots', 'marketplace-gallery-fraction');
                }
                const stockN = legacyMarketplaceStockForPick(
                    p,
                    getSelectedMarketplaceDetailSize(),
                    getSelectedMarketplaceDetailColor()
                );
                if (stockN > 0) marketplaceDetailQty = Math.min(Math.max(1, marketplaceDetailQty), Math.min(99, stockN));
                else marketplaceDetailQty = 1;
                const qd = document.getElementById('marketplace-qty-display');
                if (qd) qd.textContent = String(marketplaceDetailQty);
            } else {
                applyMarketplaceDetailVariantToUi(p);
            }
            const wbtn = document.getElementById('marketplace-detail-wishlist-btn');
            if (wbtn) wbtn.classList.toggle('active', isWishlistEntry('mp', Number(p.id)));
        }

        function applyMarketplaceDetailVariantToUi(p) {
            if (!p || !productUsesDynamicOptions(p)) return;
            const row = findInventoryRowDynamic(p, marketplaceDetailVariantPick);
            const listU = variantListUnitForRow(p, row);
            const discPct = Math.min(100, Math.max(0, Number(p.discount_percent || 0)));
            const saleU = saleUnitFromListAndDiscount(listU, discPct);
            const priceEl = document.getElementById('marketplace-detail-price');
            const priceOldEl = document.getElementById('marketplace-detail-price-old');
            const discBadge = document.getElementById('marketplace-detail-discount-badge');
            const addPEl = document.getElementById('marketplace-detail-add-price');
            const stEl = document.getElementById('marketplace-detail-stock');
            const displayP = discPct > 0 && discPct < 100 ? saleU : listU;
            if (priceEl) priceEl.textContent = formatSyp(displayP);
            if (addPEl) addPEl.textContent = ` — ${formatSyp(displayP)}`;
            if (priceOldEl) {
                const showOld = discPct > 0 && discPct < 100;
                priceOldEl.classList.toggle('hidden', !showOld);
                priceOldEl.textContent = showOld ? formatSyp(listU) : '';
            }
            if (discBadge) discBadge.classList.add('hidden');
            const dpill = document.getElementById('marketplace-detail-discount-pill');
            const gb = document.getElementById('marketplace-gallery-discount-badge');
            const showD = discPct > 0 && discPct < 100;
            if (dpill) {
                if (showD) {
                    dpill.textContent = formatPdpDiscountLine(discPct);
                    dpill.classList.remove('hidden');
                } else dpill.classList.add('hidden');
            }
            if (gb) {
                if (showD) {
                    gb.textContent = `-${discPct}%`;
                    gb.classList.remove('hidden');
                } else gb.classList.add('hidden');
            }
            const st = row ? Number(row.stock || 0) : 0;
            if (stEl) {
                stEl.textContent = st > 0 ? (isRTL ? `متوفر: ${st}` : `In stock: ${st}`) : isRTL ? 'غير متوفر' : 'Out of stock';
            }
            const gal = document.getElementById('marketplace-product-gallery');
            const baseList = normalizePdpImageList(p.images);
            const baseForMerge = baseList.length ? baseList : [adoraPlaceholderImageUrl()];
            const extraRaw = row && row.image ? String(row.image).trim() : '';
            const extraAbs = extraRaw ? absoluteMediaUrl(extraRaw) : '';
            const baseAbsSet = new Set(baseForMerge.map((u) => absoluteMediaUrl(u)));
            const merged =
                extraAbs && !baseAbsSet.has(extraAbs) ? [extraRaw, ...baseForMerge] : baseForMerge;
            if (gal) {
                adoraReplaceGallerySlidesKeepingToolbar(gal, adoraBuildPdpGallerySlidesHtml(merged), 0);
                syncHorizontalGalleryDots('marketplace-product-gallery', 'marketplace-gallery-dots', 'marketplace-gallery-fraction');
            }
            renderMarketplaceDynamicVariantOptions(p);
            if (st > 0) marketplaceDetailQty = Math.min(Math.max(1, marketplaceDetailQty), Math.min(99, st));
            else marketplaceDetailQty = 1;
            const qd = document.getElementById('marketplace-qty-display');
            if (qd) qd.textContent = String(marketplaceDetailQty);
        }

        function renderMarketplaceDynamicVariantOptions(p) {
            const root = document.getElementById('marketplace-dynamic-variant-root');
            if (!root) return;
            const defs = sortProductOptionDefinitionsForDisplay(productOptionDefinitions(p));
            if (!defs.length) {
                root.innerHTML = '';
                root.classList.add('hidden');
                return;
            }
            root.classList.remove('hidden');
            root.innerHTML = defs
                .map((d) => {
                    const partial = { ...marketplaceDetailVariantPick };
                    delete partial[d.id];
                    const avail = valuesAvailableForOptionDynamic(p, d.id, partial);
                    const title = isRTL ? d.name_ar || d.name_en : d.name_en || d.name_ar;
                    const chips = (d.values || [])
                        .map((v) => {
                            const on = String(marketplaceDetailVariantPick[d.id] || '') === String(v.id);
                            const dis = !avail.has(String(v.id));
                            const lab = isRTL ? v.label_ar || v.label_en : v.label_en || v.label_ar;
                            return `<button type="button" role="radio" aria-checked="${on}" class="px-3 py-2 rounded-xl border-2 text-sm font-semibold transition ${
                                on
                                    ? 'border-indigo-400 bg-indigo-50/95 text-indigo-900 shadow-sm'
                                    : dis
                                      ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                      : 'border-gray-200/90 text-gray-800 hover:border-indigo-200 hover:bg-indigo-50/40'
                            }" data-mpdv-opt="${escapeHtml(d.id)}" data-mpdv-val="${escapeHtml(v.id)}" ${dis ? 'disabled' : ''}>${escapeHtml(lab)}</button>`;
                        })
                        .join('');
                    return `<div class="space-y-2">
                        <h3 class="text-sm font-bold text-gray-800">${escapeHtml(title)}</h3>
                        <div class="flex flex-wrap gap-2">${chips}</div>
                    </div>`;
                })
                .join('');
            root.querySelectorAll('[data-mpdv-opt]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    if (btn.disabled) return;
                    const oid = btn.getAttribute('data-mpdv-opt');
                    const vid = btn.getAttribute('data-mpdv-val');
                    marketplaceDetailVariantPick[oid] = vid;
                    const defs2 = sortProductOptionDefinitionsForDisplay(productOptionDefinitions(p));
                    const idx = defs2.findIndex((x) => x.id === oid);
                    for (let j = idx + 1; j < defs2.length; j++) {
                        const nx = defs2[j];
                        const partial = {};
                        for (let k = 0; k < j; k++) partial[defs2[k].id] = marketplaceDetailVariantPick[defs2[k].id];
                        const av = valuesAvailableForOptionDynamic(p, nx.id, partial);
                        const cur = marketplaceDetailVariantPick[nx.id];
                        if (!av.has(String(cur))) {
                            const pickFirst = (nx.values || []).find((v) => av.has(String(v.id)));
                            marketplaceDetailVariantPick[nx.id] = pickFirst ? pickFirst.id : '';
                        }
                    }
                    applyMarketplaceDetailVariantToUi(p);
                });
            });
        }

        function updateMarketplaceReviewLoginHint() {
            const hint = document.getElementById('marketplace-review-login-hint');
            if (!hint) return;
            hint.classList.toggle('hidden', !!getStoredJwtToken());
        }

        function setMarketplaceReviewStarCount(n) {
            marketplaceReviewSelected = Math.min(5, Math.max(0, n));
            document.querySelectorAll('.mp-product-review-star').forEach((btn) => {
                const v = Number(btn.getAttribute('data-star'));
                const icon = btn.querySelector('i');
                if (!icon) return;
                const on = marketplaceReviewSelected >= 1 && v <= marketplaceReviewSelected;
                icon.className = on ? 'fas fa-star text-amber-400' : 'far fa-star text-gray-300';
            });
        }

        function initMarketplaceProductReviewStars() {
            document.querySelectorAll('.mp-product-review-star').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const v = Number(btn.getAttribute('data-star'));
                    if (v >= 1 && v <= 5) setMarketplaceReviewStarCount(v);
                });
            });
        }

        async function loadMarketplaceProductReviewsForDetail(marketplaceProductId) {
            const mpId = Number(marketplaceProductId);
            setMarketplaceReviewStarCount(0);
            marketplaceReviewSelected = 0;
            const ta = document.getElementById('marketplace-review-comment');
            if (ta) ta.value = '';
            updateMarketplaceReviewLoginHint();
            const listEl = document.getElementById('marketplace-reviews-list');
            const badge = document.getElementById('marketplace-reviews-count-badge');
            document.getElementById('marketplace-detail-rating-row')?.classList.add('hidden');
            if (listEl) {
                listEl.innerHTML = `<p class="text-sm text-gray-500 py-2">${isRTL ? 'جاري التحميل…' : 'Loading…'}</p>`;
            }
            resetMarketplaceRatingSummaryCardLoading();
            try {
                const data = await apiFetch(`/api/marketplace/products/${mpId}/reviews`, { requireAuth: false });
                if (
                    currentScreen !== 'screen-marketplace-product' ||
                    !currentMarketplaceProductDetail ||
                    Number(currentMarketplaceProductDetail.id) !== mpId
                ) {
                    return;
                }
                const count = Number(data.count || 0);
                updateMarketplaceRatingSummaryCard(data);
                updateMarketplaceDetailInlineRating(data);
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
                updateRatingSummaryCard(MARKETPLACE_PRODUCT_RATING_SUMMARY_IDS, {
                    average: null,
                    count: 0,
                    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
                });
                updateMarketplaceDetailInlineRating({ average: null, count: 0 });
                const countEl = document.getElementById(MARKETPLACE_PRODUCT_RATING_SUMMARY_IDS.count);
                if (countEl) countEl.textContent = isRTL ? 'تعذر تحميل ملخص التقييم' : 'Could not load rating summary';
                if (listEl) {
                    listEl.innerHTML = `<p class="text-sm text-red-500 py-2">${isRTL ? 'تعذر تحميل التقييمات' : 'Could not load reviews'}</p>`;
                }
            }
        }

        async function submitMarketplaceProductReview() {
            if (!currentMarketplaceProductDetail || !currentMarketplaceProductDetail.id) return;
            if (!getStoredJwtToken()) {
                openAuthModal('login', isRTL ? 'سجّل الدخول لإرسال تقييم' : 'Log in to submit a review');
                return;
            }
            if (marketplaceReviewSelected < 1 || marketplaceReviewSelected > 5) {
                showToast(isRTL ? 'اختر من نجمة إلى خمس نجوم' : 'Choose 1–5 stars');
                return;
            }
            const ta = document.getElementById('marketplace-review-comment');
            const comment = ta ? ta.value.trim() : '';
            try {
                await apiFetch('/api/marketplace/product-reviews', {
                    method: 'POST',
                    requireAuth: true,
                    body: {
                        marketplace_product_id: currentMarketplaceProductDetail.id,
                        stars: marketplaceReviewSelected,
                        comment: comment || undefined,
                    },
                });
                if (ta) ta.value = '';
                setMarketplaceReviewStarCount(0);
                marketplaceReviewSelected = 0;
                showToast(isRTL ? 'تم إرسال تقييمك' : 'Your review was sent');
                await loadMarketplaceProductReviewsForDetail(currentMarketplaceProductDetail.id);
            } catch (e) {
                showToast(e.message || (isRTL ? 'تعذر الإرسال' : 'Could not send'));
            }
        }
        window.submitMarketplaceProductReview = submitMarketplaceProductReview;

        function updateMarketplaceDetailQty(delta) {
            const p = currentMarketplaceProductDetail;
            marketplaceDetailQty += delta;
            if (marketplaceDetailQty < 1) marketplaceDetailQty = 1;
            if (marketplaceDetailQty > 99) marketplaceDetailQty = 99;
            if (p) {
                let cap = 0;
                if (productUsesDynamicOptions(p)) {
                    const row = findInventoryRowDynamic(p, marketplaceDetailVariantPick);
                    cap = row ? Number(row.stock) || 0 : 0;
                } else {
                    cap = legacyMarketplaceStockForPick(
                        p,
                        getSelectedMarketplaceDetailSize(),
                        getSelectedMarketplaceDetailColor()
                    );
                }
                if (cap > 0) marketplaceDetailQty = Math.min(marketplaceDetailQty, cap);
            }
            const qd = document.getElementById('marketplace-qty-display');
            if (qd) qd.textContent = String(marketplaceDetailQty);
        }

        function addMarketplacePayloadToCart(p, qty, opts = {}) {
            const silent = opts.silent === true;
            const resetDetailQty = opts.resetDetailQty !== false;
            const replaceLineQty = opts.replaceLineQty === true;
            const pick = opts.variantPick != null ? opts.variantPick : marketplaceDetailVariantPick;
            if (!p || !p.id) {
                showToast(isRTL ? 'تعذر إضافة المنتج' : 'Cannot add to cart');
                return false;
            }
            const q = Math.max(1, Math.min(99, Number(qty || 1)));
            let listUnit = Number(p.price || 0);
            let variantOptions = null;
            let variantLabel = '';
            let lineSize = '';
            let lineColor = '';
            const imgs = Array.isArray(p.images) ? p.images : [];
            let img0 = imgs.length ? absoluteMediaUrl(imgs[0]) : adoraPlaceholderImageUrl();
            if (productUsesDynamicOptions(p)) {
                const row = findInventoryRowDynamic(p, pick);
                if (!row || Number(row.stock || 0) < 1) {
                    showToast(isRTL ? 'غير متوفر بهذه المواصفات' : 'Not available for this combination');
                    return false;
                }
                listUnit = variantListUnitForRow(p, row);
                variantOptions = { ...pick };
                variantLabel = formatVariantLabelFromPick(p, pick);
                const ri = row.image && String(row.image).trim();
                if (ri) img0 = absoluteMediaUrl(ri);
            } else {
                lineColor = getSelectedMarketplaceDetailColor();
                const szPick = getSelectedMarketplaceDetailSize();
                if (!variantHasStock(p, szPick === '—' ? '' : szPick, lineColor)) {
                    showToast(isRTL ? 'غير متوفر بهذا المقاس/اللون' : 'Not available for this size/color');
                    return false;
                }
                lineSize = szPick === '—' ? '' : szPick;
            }
            const stock = productUsesDynamicOptions(p)
                ? Number(findInventoryRowDynamic(p, pick)?.stock || 0)
                : legacyMarketplaceStockForPick(p, getSelectedMarketplaceDetailSize(), getSelectedMarketplaceDetailColor());
            if (stock < q) {
                showToast(isRTL ? 'الكمية غير متوفرة' : 'Not enough stock');
                return false;
            }
            const vendorLabel = isRTL ? p.vendor_name_ar || p.vendor_name_en || '' : p.vendor_name_en || p.vendor_name_ar || '';
            const discPct = Math.min(100, Math.max(0, Number(p.discount_percent || 0)));
            const line = {
                marketplaceProductId: p.id,
                name: { ar: p.name_ar, en: p.name_en },
                qty: q,
                unitPrice: listUnit,
                price: listUnit,
                discountPct: discPct,
                image: img0,
                brand: vendorLabel,
                size: lineSize,
                color: lineColor,
                variantOptions,
                variantLabel,
                selected: true,
            };
            const key = getCartLineKey(line);
            const existing = cartItems.find((x) => getCartLineKey(x) === key);
            if (existing) {
                const nextQty = replaceLineQty
                    ? Math.min(99, q, stock)
                    : Math.min(99, Number(existing.qty || 1) + q);
                if (nextQty > stock) {
                    showToast(isRTL ? 'الكمية غير متوفرة' : 'Not enough stock');
                    return false;
                }
                if (nextQty < 1) {
                    showToast(isRTL ? 'الكمية غير متوفرة' : 'Not enough stock');
                    return false;
                }
                existing.qty = nextQty;
                existing.selected = true;
                existing.unitPrice = listUnit;
                existing.price = listUnit;
                existing.discountPct = discPct;
                if (img0) existing.image = img0;
                existing.name = { ar: p.name_ar, en: p.name_en };
                existing.brand = vendorLabel;
                existing.variantOptions = variantOptions;
                existing.variantLabel = variantLabel;
                existing.size = line.size;
                existing.color = line.color;
                existing.marketplaceProductId = p.id;
            } else {
                cartItems.push(line);
            }
            if (resetDetailQty) {
                marketplaceDetailQty = 1;
                const qd = document.getElementById('marketplace-qty-display');
                if (qd) qd.textContent = '1';
            }
            persistCart();
            if (!silent) showToast(isRTL ? 'أُضيف إلى السلة' : 'Added to cart');
            return true;
        }

        function addMarketplaceProductToCart(opts = {}) {
            const silent = opts.silent === true;
            const replaceLineQty = opts.replaceLineQty === true;
            const p = currentMarketplaceProductDetail;
            const qty = Math.max(1, Math.min(99, Number(marketplaceDetailQty || 1)));
            return addMarketplacePayloadToCart(p, qty, { silent, resetDetailQty: true, replaceLineQty });
        }

        async function quickAddMarketplaceProductToCart(productId, ev) {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
            try {
                const p = await apiFetch(`/api/marketplace/products/${Number(productId)}`, { requireAuth: false });
                if (!p || !p.id) throw new Error('x');
                if (productUsesDynamicOptions(p)) {
                    const pick = defaultVariantPickDynamic(p);
                    const row = findInventoryRowDynamic(p, pick);
                    if (!row || Number(row.stock || 0) < 1) {
                        showToast(isRTL ? 'افتح المنتج واختر المواصفات' : 'Open the product to choose options');
                        return;
                    }
                    addMarketplacePayloadToCart(p, 1, { silent: false, resetDetailQty: false, variantPick: pick });
                    return;
                }
                addMarketplacePayloadToCart(p, 1, { silent: false, resetDetailQty: false });
            } catch (_e) {
                showToast(isRTL ? 'تعذر إضافة المنتج' : 'Cannot add to cart');
            }
        }

        function buyMarketplaceNow() {
            if (!addMarketplaceProductToCart({ silent: true, replaceLineQty: true })) return;
            openOrderOptions();
        }

        // Cart Functions
        /** يُرجع true عند نجاح الإضافة — لاستخدام «اشتري الآن» قبل فتح الطلب */
        function addToCart(opts = {}) {
            const silent = opts.silent === true;
            const forceQtyOne = opts.forceQtyOne === true;
            const replaceLineQty = opts.replaceLineQty === true;
            if (!currentProductDetail || !currentProductDetail.id) {
                showToast(isRTL ? 'تعذر إضافة المنتج' : 'Cannot add to cart');
                return false;
            }
            const p = currentProductDetail;
            const qty = forceQtyOne
                ? 1
                : Math.max(1, Math.min(99, Number(currentQty || 1)));
            if (replaceLineQty && !forceQtyOne) {
                const cap = getProductDetailStockCount();
                if (cap > 0 && qty > cap) {
                    showToast(isRTL ? 'الكمية غير متوفرة' : 'Not enough stock');
                    return false;
                }
            }
            let size = getSelectedDetailSize();
            let color = getSelectedDetailColor();
            let listUnit = Number(p.price || 0);
            let img0 = p.images && p.images.length ? p.images[0] : '';
            let variantOptions = null;
            let variantLabel = '';
            if (productUsesDynamicOptions(p)) {
                const row = findInventoryRowDynamic(p, productDetailVariantPick);
                if (!row || Number(row.stock || 0) < 1) {
                    showToast(isRTL ? 'غير متوفر بهذه المواصفات' : 'Not available for this combination');
                    return false;
                }
                listUnit = variantListUnitForRow(p, row);
                const ri = row.image && String(row.image).trim();
                if (ri) img0 = ri;
                variantOptions = { ...productDetailVariantPick };
                variantLabel = formatVariantLabelFromPick(p, productDetailVariantPick);
                size = '';
                color = '';
            } else {
                if (!variantHasStock(p, size === '—' ? '' : size, color)) {
                    showToast(isRTL ? 'غير متوفر بهذا المقاس/اللون' : 'Not available for this size/color');
                    return false;
                }
            }
            const discPct = Number(p.discount || 0);
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
                variantOptions: variantOptions || undefined,
                variantLabel: variantLabel || undefined,
                selected: true,
            };
            const key = getCartLineKey(line);
            const existing = cartItems.find((x) => getCartLineKey(x) === key);
            if (existing) {
                if (replaceLineQty && !forceQtyOne) {
                    const cap = getProductDetailStockCount();
                    existing.qty = cap > 0 ? Math.min(qty, cap, 99) : Math.min(qty, 99);
                } else if (forceQtyOne) {
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
                existing.size = line.size;
                existing.color = line.color;
                existing.variantOptions = line.variantOptions;
                existing.variantLabel = line.variantLabel;
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
            if (!addToCart({ silent: true, replaceLineQty: true })) return;
            openOrderOptions();
        }

        async function quickAddCatalogProductToCart(productId, ev) {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
            try {
                const p = await apiFetch(`/api/products/${Number(productId)}`, { requireAuth: false });
                if (!p || !p.id) throw new Error('x');
                if (productUsesDynamicOptions(p)) {
                    const pick = defaultVariantPickDynamic(p);
                    const row = findInventoryRowDynamic(p, pick);
                    if (!row || Number(row.stock || 0) < 1) {
                        showToast(isRTL ? 'غير متوفر' : 'Out of stock');
                        return;
                    }
                    const listUnit = variantListUnitForRow(p, row);
                    const discPct = Number(p.discount || 0);
                    const ri = row.image && String(row.image).trim();
                    const img0 = ri ? ri : p.images && p.images.length ? p.images[0] : '';
                    const brandVal = String(p.brand || '').trim();
                    const line = {
                        productId: p.id,
                        id: p.id,
                        name: { ar: p.name_ar, en: p.name_en },
                        qty: 1,
                        unitPrice: listUnit,
                        price: listUnit,
                        discountPct: discPct,
                        image: img0,
                        brand: brandVal,
                        size: '',
                        color: '',
                        variantOptions: { ...pick },
                        variantLabel: formatVariantLabelFromPick(p, pick),
                        selected: true,
                    };
                    const key = getCartLineKey(line);
                    const existing = cartItems.find((x) => getCartLineKey(x) === key);
                    if (existing) {
                        existing.qty = Math.min(99, Number(existing.qty || 1) + 1);
                        existing.selected = true;
                        existing.unitPrice = listUnit;
                        existing.price = listUnit;
                        existing.discountPct = discPct;
                        if (img0) existing.image = img0;
                        existing.variantOptions = line.variantOptions;
                        existing.variantLabel = line.variantLabel;
                    } else {
                        cartItems.push(line);
                    }
                    persistCart();
                    showToast(isRTL ? 'أُضيف إلى السلة' : 'Added to cart');
                    return;
                }
                const inv = Array.isArray(p.inventory) ? p.inventory : [];
                let size = '—';
                let color = '';
                if (inv.length) {
                    const row = inv.find((r) => {
                        if (r.options && typeof r.options === 'object' && Object.keys(r.options).length) return false;
                        return Number(r.stock || 0) > 0;
                    });
                    if (!row) {
                        showToast(isRTL ? 'غير متوفر' : 'Out of stock');
                        return;
                    }
                    size = String(row.size != null ? row.size : '—').trim() || '—';
                    color = String(row.color != null ? row.color : '').trim();
                } else {
                    if (Number(p.stock || 0) < 1) {
                        showToast(isRTL ? 'غير متوفر' : 'Out of stock');
                        return;
                    }
                    const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.map((s) => String(s)) : ['—'];
                    const colors = Array.isArray(p.colors) && p.colors.length ? p.colors.map((c) => String(c)) : [''];
                    let picked = null;
                    for (const szRaw of sizes) {
                        const szTrim = String(szRaw).trim();
                        const sv = szTrim === '—' ? '' : szTrim;
                        for (const col of colors) {
                            const cl = String(col).trim();
                            if (variantHasStock(p, sv, cl)) {
                                picked = { size: szTrim === '—' ? '—' : szTrim, color: cl };
                                break;
                            }
                        }
                        if (picked) break;
                    }
                    if (!picked) {
                        showToast(isRTL ? 'غير متوفر' : 'Out of stock');
                        return;
                    }
                    size = picked.size;
                    color = picked.color;
                }
                const sizeArg = size === '—' ? '' : size;
                if (!variantHasStock(p, sizeArg, color)) {
                    showToast(isRTL ? 'غير متوفر' : 'Out of stock');
                    return;
                }
                const qty = 1;
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
                    existing.qty = Math.min(99, Number(existing.qty || 1) + qty);
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
                persistCart();
                showToast(isRTL ? 'أُضيف إلى السلة' : 'Added to cart');
            } catch (_e) {
                showToast(isRTL ? 'تعذر إضافة المنتج' : 'Cannot add to cart');
            }
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

        /** ترتيب بحث: مميز أولاً (كتالوج: is_featured، سوق: is_mp_featured_effective) */
        function adoraProductSearchFeaturedScore(p) {
            if (!p) return 0;
            if (p.adora_listing_kind === 'marketplace') {
                return Number(p.is_mp_featured_effective) === 1 ? 1 : 0;
            }
            return Number(p.is_featured) === 1 ? 1 : 0;
        }

        function adoraSortProductsFeaturedFirst(arr) {
            const list = Array.isArray(arr) ? arr.slice() : [];
            list.sort((a, b) => {
                const d = adoraProductSearchFeaturedScore(b) - adoraProductSearchFeaturedScore(a);
                if (d !== 0) return d;
                return (Number(b.id) || 0) - (Number(a.id) || 0);
            });
            return list;
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
                if (p.adora_listing_kind === 'marketplace') {
                    return true;
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
            const pieces = products.map((p) =>
                p.adora_listing_kind === 'marketplace'
                    ? renderMpProductCardHomeCompact(p)
                    : renderProductCardHtml(p, { compact: true })
            );
            adoraInsertAdjacentHtmlChunked(grid, pieces, 10);
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
            loadStructuredShippingToForm();
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
                        const meta =
                            (item.variantLabel && String(item.variantLabel).trim()) ||
                            [item.size, item.color].filter(Boolean).join(' · ');
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
            const ship = getShippingAddressSummaryForDisplay();
            if (shippingEl) shippingEl.textContent = locale === 'ar' ? ship.ar : ship.en;
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

        function openCheckoutSystemConfirmModal() {
            const m = document.getElementById('checkout-system-confirm-modal');
            if (!m) return;
            m.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeCheckoutSystemConfirmModal() {
            const m = document.getElementById('checkout-system-confirm-modal');
            if (m) m.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        async function confirmCheckoutSystemProceed() {
            closeCheckoutSystemConfirmModal();
            const token = getStoredJwtToken();
            if (!token) {
                const order = buildOrderSummary();
                pendingOrderPayload = order;
                pendingOrderSource = 'system';
                closeOrderOptions();
                openAuthModal('signup', isRTL ? 'سجّل أو سجّل الدخول لإتمام الطلب' : 'Sign up or log in to complete checkout');
                return;
            }
            closeOrderOptions();
            await refreshCheckoutOrderPreviewNo();
            const order = buildOrderSummary();
            await sendOrderToSystem(order, 'system');
        }

        function openCheckoutCardSoonModal() {
            const m = document.getElementById('checkout-card-soon-modal');
            if (!m) return;
            m.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeCheckoutCardSoonModal() {
            const m = document.getElementById('checkout-card-soon-modal');
            if (m) m.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        window.openCheckoutSystemConfirmModal = openCheckoutSystemConfirmModal;
        window.closeCheckoutSystemConfirmModal = closeCheckoutSystemConfirmModal;
        window.confirmCheckoutSystemProceed = confirmCheckoutSystemProceed;
        window.openCheckoutCardSoonModal = openCheckoutCardSoonModal;
        window.closeCheckoutCardSoonModal = closeCheckoutCardSoonModal;

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

            const shipStruct = getStructuredShippingFromForm();
            if (cartHasMarketplaceSelected()) {
                if (!structuredShippingComplete(shipStruct)) {
                    showToast(
                        isRTL
                            ? 'الرجاء إدخال بياناتك كاملة بشكل صحيح (الاسم، واتساب، المحافظة، المنطقة، العنوان).'
                            : 'Please enter your details fully and correctly (name, WhatsApp, governorate, area, address).'
                    );
                    return null;
                }
                persistStructuredShipping(shipStruct);
            }

            showToast(
                isRTL
                    ? translationMap.checkoutSaveOrderNoHint
                    : 'You will get an order number when sent — save it. You will also receive an in-app notification when the order is received.'
            );

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
                    const mpid = effectiveMarketplaceProductId(item);
                    const pidRaw = item.productId ?? item.id ?? null;
                    const pid = mpid ? null : pidRaw != null && Number.isFinite(Number(pidRaw)) ? Number(pidRaw) : null;
                    const vo = item.variantOptions;
                    const variant_options =
                        vo && typeof vo === 'object' && !Array.isArray(vo) && Object.keys(vo).length ? vo : undefined;
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
                        variant_options,
                        variant_label: item.variantLabel != null ? String(item.variantLabel) : '',
                    };
                });

                const shipStructPost = getStructuredShippingFromForm();
                const shipLine =
                    structuredShippingComplete(shipStructPost) && cartHasMarketplaceSelected()
                        ? [
                              shipStructPost.full_name,
                              shipStructPost.phone,
                              `${shipStructPost.governorate} — ${shipStructPost.region}`,
                              shipStructPost.address,
                          ]
                              .join('\n')
                              .slice(0, 2000)
                        : getSavedDeliveryAddressText() || (isRTL ? order.shippingAddress?.ar : order.shippingAddress?.en) || '';
                const created = await apiFetch('/api/orders', {
                    method: 'POST',
                    requireAuth: true,
                    body: {
                        products: apiProducts,
                        total_price: order.totals?.total ?? 0,
                        payment_method: order.paymentMethod,
                        source,
                        shipping_address: shipLine.slice(0, 2000),
                        shipping_structured: structuredShippingComplete(shipStructPost) ? shipStructPost : undefined,
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

                const ordNo = o.order_no != null && String(o.order_no).trim() ? String(o.order_no).trim() : '';
                showToast(
                    ordNo
                        ? isRTL
                            ? `تم إرسال الطلب. رقم الطلب: ${ordNo} — احفظه`
                            : `Order sent. Number: ${ordNo} — save it`
                        : isRTL
                          ? translationMap.orderSent
                          : 'Order submitted to system'
                );
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
                customerPhone = bundle?.user?.phone
                    ? String(bundle.user.phone)
                    : bundle?.user?.email
                      ? String(bundle.user.email)
                      : '';
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

        /** روابط https أو Cloudinary؛ المسارات النسبية والـ /uploads/ من خادم الـ API */
        function absoluteMediaUrl(u) {
            const s = String(u || '').trim();
            if (!s) return '';
            if (s.startsWith('http://') || s.startsWith('https://')) return s;
            if (s.startsWith('//')) {
                const proto = typeof window !== 'undefined' && window.location && window.location.protocol ? window.location.protocol : 'https:';
                return `${proto}${s}`;
            }
            const tail = s.replace(/^\/+/, '');
            const origin = getApiOrigin();
            if (tail.toLowerCase().startsWith('uploads/')) {
                return `${origin}/${tail}`;
            }
            if (s.startsWith('/')) return origin + s;
            if (s.includes('/')) return `${origin}/${tail}`;
            return adoraPlaceholderImageUrl();
        }

        /** تطبيع مصفوفة روابط الصور (نص، JSON، أو عناصر {url}) لتفادي أخطاء DOM/المعرض */
        function normalizePdpImageList(raw) {
            const out = [];
            const pushVal = (v) => {
                if (v == null) return;
                if (typeof v === 'string') {
                    const t = v.trim();
                    if (t) out.push(t);
                    return;
                }
                if (typeof v === 'object') {
                    const u = v.url != null ? String(v.url) : v.src != null ? String(v.src) : '';
                    const t = u.trim();
                    if (t) out.push(t);
                }
            };
            if (Array.isArray(raw)) {
                raw.forEach(pushVal);
                return out;
            }
            if (typeof raw === 'string') {
                const t = raw.trim();
                if (!t) return [];
                if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
                    try {
                        return normalizePdpImageList(JSON.parse(t));
                    } catch (_e) {
                        return [t];
                    }
                }
                return [t];
            }
            return [];
        }

        /** ضغط عرض لروابط Cloudinary في معرض المنتج (أخف على الشبكة والذاكرة) */
        function pdpCloudinaryOptimizeUrl(url, maxW) {
            const s = String(url || '').trim();
            if (!s) return s;
            if (!/^https?:\/\//i.test(s)) return s;
            if (!/res\.cloudinary\.com\/[^/?#\s]+\/image\/upload\//i.test(s)) return s;
            if (/\/image\/upload\/c_/i.test(s)) return s;
            const w = Math.min(1024, Math.max(280, Number(maxW) || 720));
            return s.replace(/\/image\/upload\//i, `/image/upload/c_limit,w_${w},q_auto,f_auto/`);
        }

        /** حد شرائح المعرض — تقليل DOM والذاكرة (أسلوب تطبيقات التسوق) */
        const ADORA_PDP_GALLERY_MAX_SLIDES = 24;

        function adoraBuildPdpGallerySlidesHtml(imageUrls) {
            const raw = normalizePdpImageList(imageUrls);
            const capped = raw.length > ADORA_PDP_GALLERY_MAX_SLIDES ? raw.slice(0, ADORA_PDP_GALLERY_MAX_SLIDES) : raw;
            const urls = capped.length ? capped.map((u) => absoluteMediaUrl(u)) : [adoraPlaceholderImageUrl()];
            return urls
                .map((src, i) => {
                    const hero = i === 0;
                    const opt = pdpCloudinaryOptimizeUrl(src, hero ? 840 : 560);
                    const esc = escapeHtml(opt);
                    const lazy = hero ? 'eager' : 'lazy';
                    const fp = hero ? ' fetchpriority="high"' : ' fetchpriority="low"';
                    const sizesEsc = escapeHtml('(max-width: 480px) 100vw, min(100vw, 480px)');
                    return `<div class="snap-center product-gallery-slide adora-pdp-gallery-slide w-full flex-shrink-0 min-w-full flex items-center justify-center bg-transparent"><img src="${esc}" class="adora-pdp-gallery-img w-full max-w-full h-auto object-contain" alt="" width="800" height="800" sizes="${sizesEsc}" loading="${lazy}" decoding="async"${fp} referrerpolicy="no-referrer" draggable="false"></div>`;
                })
                .join('');
        }

        let adoraCatalogPdpLoadGen = 0;
        let adoraMpPdpLoadGen = 0;

        function setCatalogPdpBusy(show, forGen) {
            const el = document.getElementById('catalog-pdp-loading');
            const screen = document.getElementById('screen-product');
            if (!el || !screen) return;
            if (!show && forGen != null && forGen !== adoraCatalogPdpLoadGen) return;
            el.classList.toggle('hidden', !show);
            el.setAttribute('aria-hidden', show ? 'false' : 'true');
            try {
                screen.setAttribute('aria-busy', show ? 'true' : 'false');
            } catch (_e) {}
        }

        function setMpPdpBusy(show, forGen) {
            const el = document.getElementById('mp-pdp-loading');
            const screen = document.getElementById('screen-marketplace-product');
            if (!el || !screen) return;
            if (!show && forGen != null && forGen !== adoraMpPdpLoadGen) return;
            el.classList.toggle('hidden', !show);
            el.setAttribute('aria-hidden', show ? 'false' : 'true');
            try {
                screen.setAttribute('aria-busy', show ? 'true' : 'false');
            } catch (_e) {}
        }

        function scheduleCatalogPdpSecondaryContent(loadGen, productId) {
            const runReviews = () => {
                if (loadGen !== adoraCatalogPdpLoadGen) return;
                if (currentScreen !== 'screen-product' || !currentProductDetail || Number(currentProductDetail.id) !== Number(productId)) return;
                loadProductReviewsForDetail(productId).catch(() => {});
            };
            const runRelated = () => {
                if (loadGen !== adoraCatalogPdpLoadGen) return;
                if (currentScreen !== 'screen-product' || !currentProductDetail || Number(currentProductDetail.id) !== Number(productId)) return;
                loadProductRelatedForDetail(productId).catch(() => {});
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(() => runReviews(), { timeout: 2200 });
                requestIdleCallback(() => setTimeout(runRelated, 200), { timeout: 3200 });
            } else {
                setTimeout(runReviews, 48);
                setTimeout(runRelated, 220);
            }
        }

        function scheduleMpPdpReviews(loadGen, mpId) {
            const run = () => {
                if (loadGen !== adoraMpPdpLoadGen) return;
                if (currentScreen !== 'screen-marketplace-product' || !currentMarketplaceProductDetail) return;
                if (Number(currentMarketplaceProductDetail.id) !== Number(mpId)) return;
                loadMarketplaceProductReviewsForDetail(mpId).catch(() => {});
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(() => run(), { timeout: 1800 });
            } else {
                setTimeout(run, 16);
            }
        }

        function scheduleMpPdpYouMayAlsoLike(loadGen, mpId) {
            const run = () => {
                if (loadGen !== adoraMpPdpLoadGen) return;
                if (currentScreen !== 'screen-marketplace-product' || !currentMarketplaceProductDetail) return;
                if (Number(currentMarketplaceProductDetail.id) !== Number(mpId)) return;
                loadMarketplaceYouMayAlsoLikeForPdp(mpId).catch(() => {});
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(() => run(), { timeout: 2000 });
            } else {
                setTimeout(run, 120);
            }
        }

        async function loadMarketplaceYouMayAlsoLikeForPdp(excludeMpId) {
            const section = document.getElementById('mp-product-related-section');
            const wrap = document.getElementById('mp-product-related-scroll');
            if (!wrap || !section) return;
            section.classList.remove('hidden');
            try {
                const qs = new URLSearchParams();
                qs.set('exclude_id', String(excludeMpId));
                qs.set('limit', '12');
                const rows = await apiFetch(`/api/marketplace/products/you-may-also-like?${qs}`, { requireAuth: false });
                if (currentScreen !== 'screen-marketplace-product' || !currentMarketplaceProductDetail) return;
                if (Number(currentMarketplaceProductDetail.id) !== Number(excludeMpId)) return;
                const list = Array.isArray(rows) ? rows : [];
                if (!list.length) {
                    wrap.innerHTML = `<p class="text-sm text-gray-500 text-center py-6 px-3 leading-relaxed" data-en="Thank you for visiting. Related products will be available here soon." data-ar="شكراً لحضوركم، سيتم تفعيل المنتجات هنا عما قريب.">شكراً لحضوركم، سيتم تفعيل المنتجات هنا عما قريب.</p>`;
                    return;
                }
                wrap.innerHTML = `<div class="home-product-strip">${list.map((p) => renderMpProductCardHomeCompact(p)).join('')}</div>`;
            } catch (_e) {
                wrap.innerHTML = `<p class="text-sm text-gray-500 text-center py-6 px-2" data-en="Could not load suggestions." data-ar="تعذر تحميل الاقتراحات.">تعذر تحميل الاقتراحات.</p>`;
            }
        }

        const DEFAULT_HOME_SECTIONS_VISIBILITY = {
            banners: true,
            comprehensive_market: true,
            main_categories: true,
            brands: true,
            mp_premium_vendors: true,
            top_brands: true,
            mp_featured_marketplace_products: true,
            flash_sale: true,
            curated: true,
            home_featured: true,
            promo_collection: true,
            bestsellers: true,
        };

        const DEFAULT_HOME_SECTIONS_ORDER = [
            'comprehensive_market',
            'banner_home_top',
            'main_categories',
            'home_subcat_overlay',
            'banner_below_categories',
            'brands',
            'mp_premium_vendors',
            'banner_below_brands',
            'top_brands',
            'mp_featured_marketplace_products',
            'banner_below_top_brands',
            'flash_sale',
            'banner_below_flash',
            'curated',
            'banner_below_curated',
            'promo_collection',
            'banner_below_trending',
            'bestsellers',
        ];

        function mergeHomeSectionsOrder(raw) {
            const allowed = new Set(DEFAULT_HOME_SECTIONS_ORDER);
            const def = [...DEFAULT_HOME_SECTIONS_ORDER];
            if (!Array.isArray(raw)) return def;
            const rawHadBannerHomeTop = raw.some((k) => k === 'banner_home_top');
            const seen = new Set();
            const out = [];
            for (const k of raw) {
                if (typeof k !== 'string' || !allowed.has(k) || seen.has(k)) continue;
                seen.add(k);
                out.push(k);
            }
            for (const k of def) {
                if (!seen.has(k)) out.push(k);
            }
            const mi = out.indexOf('comprehensive_market');
            const bi = out.indexOf('banner_home_top');
            if (!rawHadBannerHomeTop && mi >= 0 && bi >= 0) {
                out.splice(bi, 1);
                const mi2 = out.indexOf('comprehensive_market');
                out.splice(mi2 + 1, 0, 'banner_home_top');
            }
            return out;
        }

        let cachedHomeSectionsOrder = null;
        let cachedHomeTopBannersSticky = false;

        function normalizeHomeTopBannersSticky(v) {
            return v === true || v === 1 || v === '1';
        }

        function placeHomeTopBannerSlotInReorderRoot(slot, root) {
            if (!slot || !root) return;
            const order = mergeHomeSectionsOrder(cachedHomeSectionsOrder);
            const idx = order.indexOf('banner_home_top');
            if (idx < 0) {
                const m = root.querySelector('[data-home-order-key="comprehensive_market"]');
                if (m && m.nextSibling) root.insertBefore(slot, m.nextSibling);
                else if (m) root.appendChild(slot);
                else root.insertBefore(slot, root.firstChild);
                return;
            }
            for (let j = idx + 1; j < order.length; j++) {
                const el = root.querySelector(`[data-home-order-key="${order[j]}"]`);
                if (el) {
                    root.insertBefore(slot, el);
                    return;
                }
            }
            root.appendChild(slot);
        }

        function applyHomeSectionOrder(raw) {
            const root = document.getElementById('home-reorder-root');
            if (!root) return;
            const order = mergeHomeSectionsOrder(raw);
            for (const key of order) {
                const el = root.querySelector(`[data-home-order-key="${key}"]`);
                if (el) root.appendChild(el);
            }
        }

        function mergeHomeSectionsVisibility(raw) {
            const o = raw && typeof raw === 'object' ? raw : {};
            const out = { ...DEFAULT_HOME_SECTIONS_VISIBILITY };
            for (const k of Object.keys(out)) {
                if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = Boolean(o[k]);
            }
            return out;
        }

        let cachedHomeSectionsVisibility = null;

        function applyHomeSectionsVisibility(raw) {
            const v = mergeHomeSectionsVisibility(raw);
            Object.keys(DEFAULT_HOME_SECTIONS_VISIBILITY).forEach((key) => {
                const on = v[key] !== false;
                document.querySelectorAll(`[data-adora-section="${key}"]`).forEach((el) => {
                    el.classList.toggle('hidden', !on);
                });
            });
        }

        /** بانر home_top + أزرار الإعلان/الشراكة تحت البحث: مع التثبيت داخل الشريط اللاصق؛ بدونه تمرّ مع التمرير */
        function applyHomeTopBannerStickyPlacement(sticky) {
            const slot = document.getElementById('banner-slot-home_top');
            const wrap = document.querySelector('#screen-categories .partner-cta-sticky-search-wrap');
            const root = document.getElementById('home-reorder-root');
            const ctaGroup = document.getElementById('home-under-search-cta-group');
            if (!slot || !wrap || !root) return;
            const on = normalizeHomeTopBannersSticky(sticky);
            slot.classList.toggle('adora-home-top-banners--sticky-below-search', on);
            if (ctaGroup) {
                ctaGroup.classList.toggle('home-under-search-cta-group--detached', !on);
                if (on) {
                    const sc = wrap.querySelector('.search-container');
                    if (sc) sc.insertAdjacentElement('afterend', ctaGroup);
                    else wrap.insertBefore(ctaGroup, wrap.firstChild);
                } else if (wrap.parentNode) {
                    wrap.parentNode.insertBefore(ctaGroup, root);
                }
            }
            if (on) {
                wrap.appendChild(slot);
            } else {
                placeHomeTopBannerSlotInReorderRoot(slot, root);
            }
        }

        /** قسم «الأكثر مبيعاً» بالرئيسية: يحترم إظهار الصفحة الرئيسية + خيار منصة البائعين */
        function refreshBestsellersSectionCombinedVisibility() {
            const v = mergeHomeSectionsVisibility(cachedHomeSectionsVisibility);
            const boostOff = partnerCtaConfig && Number(partnerCtaConfig.bestsellers_boost_enabled) === 0;
            const show = v.bestsellers !== false && !boostOff;
            document.querySelectorAll('[data-adora-section="bestsellers"]').forEach((el) => {
                el.classList.toggle('hidden', !show);
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

        /** تحديث ترتيب/ظهور أقسام الرئيسية من الخادم (بدون لمس صور الأقسام أو شرائح الفرعي) — يُستدعى عند فتح الرئيسية لالتقاط تغييرات لوحة التحكم */
        async function refreshHomeLayoutFromApi() {
            try {
                const data = await apiFetch('/api/contact', { requireAuth: false, cache: 'no-store' });
                if (data.home_sections_visibility && typeof data.home_sections_visibility === 'object') {
                    cachedHomeSectionsVisibility = data.home_sections_visibility;
                }
                if (Array.isArray(data.home_sections_order)) {
                    cachedHomeSectionsOrder = data.home_sections_order;
                }
                cachedHomeTopBannersSticky = normalizeHomeTopBannersSticky(data.home_top_banners_sticky);
                applyHomeSectionOrder(data.home_sections_order);
                applyHomeSectionsVisibility(data.home_sections_visibility);
                applyHomeTopBannerStickyPlacement(cachedHomeTopBannersSticky);
                refreshBestsellersSectionCombinedVisibility();
            } catch (_e) {
                /* الإبقاء على التخزين المؤقت الحالي */
            }
        }

        async function applyHomeContactFromApi() {
            try {
                const data = await apiFetch('/api/contact', { requireAuth: false, cache: 'no-store' });
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
                cachedHomeSectionsVisibility = data.home_sections_visibility;
                cachedHomeSectionsOrder = data.home_sections_order;
                cachedHomeTopBannersSticky = normalizeHomeTopBannersSticky(data.home_top_banners_sticky);
                applyHomeSectionOrder(data.home_sections_order);
                applyHomeSectionsVisibility(data.home_sections_visibility);
                applyHomeTopBannerStickyPlacement(cachedHomeTopBannersSticky);
                refreshBestsellersSectionCombinedVisibility();
                loadHomeMpPremiumVendors().catch(() => {});
                loadHomeMpFeaturedMarketplaceProducts().catch(() => {});
            } catch (_e) {
                cachedHomeSectionsVisibility = null;
                cachedHomeSectionsOrder = null;
                cachedHomeTopBannersSticky = false;
                applyHomeSectionOrder(null);
                applyHomeSectionsVisibility(null);
                applyHomeTopBannerStickyPlacement(false);
                refreshBestsellersSectionCombinedVisibility();
                loadHomeMpPremiumVendors().catch(() => {});
                loadHomeMpFeaturedMarketplaceProducts().catch(() => {});
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
                if (item.variantLabel) ar.push(`    📎  المواصفات: ${item.variantLabel}`);
                else {
                    if (item.size) ar.push(`    📏  المقاس: ${item.size}`);
                    if (item.color) ar.push(`    🎨  اللون: ${item.color}`);
                }
                ar.push(`    🔢  الكمية: ${item.qty}`);
                ar.push(`    💵  السعر: ${formatSyp(saleUnit)} × ${item.qty} = ${formatSyp(line)}`);
                if (discPct > 0) ar.push(`    📎  السعر قبل الخصم: ${formatSyp(listUnit)}`);
                if (img) ar.push(`    🖼  ${img}`);
                ar.push('');
                en.push(`▸▸  ${num} — Line ${num}`);
                en.push('    ─────────────────');
                en.push(`    📦  ${ne}`);
                en.push(`    🏷  ${br}`);
                if (item.variantLabel) en.push(`    📎  Options: ${item.variantLabel}`);
                else {
                    if (item.size) en.push(`    📏  Size: ${item.size}`);
                    if (item.color) en.push(`    🎨  Color: ${item.color}`);
                }
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
            const splitWrap = document.getElementById('order-tracking-vendor-splits-wrap');
            const splitEl = document.getElementById('order-tracking-vendor-splits');

            if (!timeline || !progressLine) return;

            if (splitWrap && splitEl) {
                const ff = latestTrackingFulfillments || [];
                if (ff.length) {
                    splitWrap.classList.remove('hidden');
                    splitEl.innerHTML = ff
                        .map((f) => {
                            const name = isRTL
                                ? f.vendor_name_ar || ''
                                : f.vendor_name_en || f.vendor_name_ar || '';
                            const lab = VENDOR_SPLIT_STATUS_UI[f.status] || { ar: f.status, en: f.status };
                            const st = isRTL ? lab.ar : lab.en;
                            return `<div class="flex justify-between gap-2 py-2 border-b border-gray-100 last:border-0">
                                <span class="font-semibold text-gray-800 truncate">${escapeHtml(name)}</span>
                                <span class="text-xs text-indigo-600 shrink-0">${escapeHtml(st)}</span>
                            </div>`;
                        })
                        .join('');
                } else {
                    splitWrap.classList.add('hidden');
                    splitEl.innerHTML = '';
                }
            }
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
                            const meta = [it.variant_label, it.color, it.size]
                                .filter(Boolean)
                                .map((x) => escapeHtml(String(x)))
                                .join(' · ');
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
            try {
                const mv = await apiFetch('/api/marketplace/vendors', { requireAuth: false });
                mpVendorsDirectoryCache = Array.isArray(mv) ? mv : [];
            } catch (_e) {
                mpVendorsDirectoryCache = [];
            }
            await ensureMpAppHomePlacements();
            renderBrandCards();
            renderTopBrands();
        }

        function renderBrandCards() {
            const container = document.getElementById('brand-scroll');
            if (!container) return;
            const mpVen = Array.isArray(mpAppHomePlacements?.brands_strip)
                ? mpAppHomePlacements.brands_strip.filter((x) => x && x.kind === 'mp_vendor')
                : [];
            const mpVendorStripCardFromRow = (v) => {
                const name = String((isRTL ? v.name_ar || v.name_en : v.name_en || v.name_ar) || '').trim();
                if (!name) return '';
                const logo = v.logo_url ? String(v.logo_url).trim() : '';
                const premiumStar =
                    Number(v.is_premium_active) === 1
                        ? `<span class="mp-vendor-premium-star" title="${isRTL ? 'شركة مميزة' : 'Featured company'}" aria-hidden="true">★</span>`
                        : '';
                const logoHtml = logo
                    ? `${premiumStar}<img src="${escapeHtml(logo)}" alt="" class="w-full h-full" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
                    : `${premiumStar}<span class="text-2xl font-bold text-emerald-600">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
                return `<button type="button" class="brand-strip-card mp-vendor-strip-card" data-mp-vendor-id="${Number(v.id)}" title="${escapeHtml(isRTL ? 'شركة في السوق الشامل' : 'Marketplace vendor')}">
                            <div class="brand-strip-logo">${logoHtml}</div>
                            <div class="brand-strip-name">${escapeHtml(name)}</div>
                        </button>`;
            };
            const mpHtml = mpVen.map(mpVendorStripCardFromRow).filter(Boolean).join('');
            const seenStripIds = new Set(
                mpVen.map((x) => Number(x.id)).filter((n) => Number.isFinite(n))
            );
            const extraStrip = (Array.isArray(mpVendorsDirectoryCache) ? mpVendorsDirectoryCache : [])
                .filter(
                    (v) =>
                        Number(v.show_in_app_brands_section) === 1 &&
                        Number.isFinite(Number(v.id)) &&
                        !seenStripIds.has(Number(v.id))
                )
                .sort((a, b) => (Number(a.sort_order) - Number(b.sort_order)) || Number(a.id) - Number(b.id));
            const mpHtmlExtra = extraStrip.map(mpVendorStripCardFromRow).filter(Boolean).join('');
            const rows = apiBrandsList.map((b) => ({
                key: String(b.id),
                name: String(b.name || '').trim(),
                logo: b.logo || '',
                selling: Number(b.product_count || 0),
                popular: (Number(b.is_top_brand) ? 1000 : 0) + Number(b.product_count || 0),
            }));
            if (!mpHtml && !mpHtmlExtra && !rows.length) {
                container.innerHTML = `<p class="text-xs text-gray-500 px-2">${isRTL ? 'لا توجد علامات تجارية لعرضها حالياً.' : 'No brands to show yet.'}</p>`;
                return;
            }
            const sorted = [...rows].sort((a, b) => b[brandSortKey] - a[brandSortKey]);
            const catHtml = sorted
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
            container.innerHTML = mpHtml + mpHtmlExtra + catHtml;
        }

        function sortBrands(key) {
            brandSortKey = key;
            updateBrandSortButtons();
            renderBrandCards();
            showToast('(✅ Done)', { variant: 'sort-done', duration: 500 });
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

        function openBrandStoreFromCurrentProduct() {
            const p = currentProductDetail;
            if (!p) return;
            const br = String(p.brand || '').trim();
            if (!br) return;
            const cat = String(p.category || '').trim();
            openBrandStore(br, ['Men', 'Women', 'Kids'].includes(cat) ? cat : undefined);
        }
        window.openBrandStoreFromCurrentProduct = openBrandStoreFromCurrentProduct;

        function openCurrentMpVendorProducts() {
            const p = currentMarketplaceProductDetail;
            if (!p || p.vendor_id == null) return;
            const vid = Number(p.vendor_id);
            if (!Number.isFinite(vid)) return;
            openMarketplaceBrowse({ vendor_id: vid });
        }
        window.openCurrentMpVendorProducts = openCurrentMpVendorProducts;

        function formatPdpDiscountLine(pct) {
            const n = Math.round(Number(pct) || 0);
            return isRTL ? `خصم ${n}%` : `${n}% off`;
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
            adoraUnifiedBack();
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
            const catSec = document.getElementById('product-related-section');
            const catWrap = document.getElementById('product-related-scroll');
            const mpSec = document.getElementById('product-marketplace-ymal-section');
            const mpWrap = document.getElementById('product-marketplace-ymal-scroll');
            if (catWrap) catWrap.innerHTML = '';
            if (catSec) catSec.classList.add('hidden');
            if (mpWrap) mpWrap.innerHTML = '';
            if (mpSec) mpSec.classList.add('hidden');
            try {
                const mpQs = new URLSearchParams();
                mpQs.set('limit', '12');
                const [rows, mpRows] = await Promise.all([
                    apiFetch(`/api/products/${productId}/related?limit=12`, { requireAuth: false }),
                    apiFetch(`/api/marketplace/products/you-may-also-like?${mpQs}`, { requireAuth: false }).catch(() => []),
                ]);
                if (currentScreen !== 'screen-product' || !currentProductDetail || Number(currentProductDetail.id) !== Number(productId)) {
                    return;
                }
                const list = Array.isArray(rows) ? rows : [];
                const mpList = Array.isArray(mpRows) ? mpRows : [];
                if (mpList.length && mpWrap && mpSec) {
                    mpSec.classList.remove('hidden');
                    mpWrap.innerHTML = `<div class="home-product-strip">${mpList.map((p) => renderMpProductCardHomeCompact(p)).join('')}</div>`;
                }
                if (list.length && catWrap && catSec) {
                    catSec.classList.remove('hidden');
                    catWrap.innerHTML = `<div class="home-product-strip">${list.map((p) => renderProductCardHtml(p, { compact: true })).join('')}</div>`;
                }
            } catch (_e) {
                if (catSec) catSec.classList.add('hidden');
                if (mpSec) mpSec.classList.add('hidden');
            }
        }

        async function loadListingPageProducts() {
            const grid = document.getElementById('listing-products-grid');
            if (!grid) return;
            const startedWithTextSearch = !!(listingSearchQuery && String(listingSearchQuery).trim());
            const lsi = document.getElementById('listing-search-input');
            if (lsi && document.activeElement !== lsi) lsi.value = listingSearchQuery || '';
            grid.innerHTML = adoraSkeletonProductGridHtml(8);
            const titleEl = document.getElementById('listing-screen-title');
            try {
                const params = new URLSearchParams();
                const sq = listingSearchQuery && String(listingSearchQuery).trim();
                if (sq) {
                    params.set('q', sq);
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
                    if (homeInp && document.activeElement !== homeInp) {
                        homeInp.value = '';
                        resetAdoraSearchTypingForInput(homeInp);
                    }
                    if (listInp && document.activeElement !== listInp) {
                        listInp.value = '';
                        resetAdoraSearchTypingForInput(listInp);
                    }
                    const te = document.getElementById('listing-screen-title');
                    if (te) {
                        te.setAttribute('data-en', 'Search results');
                        te.setAttribute('data-ar', 'نتائج البحث');
                        te.textContent = isRTL ? te.getAttribute('data-ar') : te.getAttribute('data-en');
                    }
                    syncAdoraAnimatedSearchVisibility();
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
            ['search-voice-btn', 'marketplace-search-voice-btn'].forEach((id) => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.classList.toggle('listening', voiceSearchListening);
                    btn.setAttribute('aria-pressed', voiceSearchListening ? 'true' : 'false');
                }
            });
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

        function toggleVoiceSearch(ev) {
            const fromBtn =
                ev && ev.currentTarget && ev.currentTarget instanceof Element ? ev.currentTarget : null;
            const voiceInputId =
                (fromBtn && fromBtn.getAttribute && fromBtn.getAttribute('data-voice-input')) || 'search-input';
            window.__adoraVoiceTargetInputId = voiceInputId;

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
                    const raw = normalizeArabicSpeechForSearch(text);
                    const tid = window.__adoraVoiceTargetInputId || 'search-input';
                    const input = document.getElementById(tid) || document.getElementById('search-input');
                    if (input) input.value = raw;
                    if (raw) {
                        if (tid === 'marketplace-search-input') {
                            hideAdoraSearchSuggestions();
                            syncAdoraAnimatedSearchVisibility();
                            refreshMarketplaceProductList().catch(() => {});
                        } else if (tid === 'listing-search-input') {
                            listingSearchQuery = raw;
                            hideAdoraSearchSuggestions();
                            if (input) resetAdoraSearchTypingForInput(input);
                            syncAdoraAnimatedSearchVisibility();
                            loadListingPageProducts().catch(() => {});
                        } else {
                            runProductSearch();
                        }
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
                        if (document.activeElement !== home) {
                            home.value = q;
                            resetAdoraSearchTypingForInput(home);
                        } else if (!String(home.value || '').trim() && q) {
                            home.value = q;
                            resetAdoraSearchTypingForInput(home);
                        }
                    } else if (document.activeElement !== home) {
                        home.value = '';
                        resetAdoraSearchTypingForInput(home);
                    }
                }
                if (list) {
                    if (document.activeElement !== list) {
                        list.value = q;
                        resetAdoraSearchTypingForInput(list);
                    } else if (!String(list.value || '').trim() && q) {
                        list.value = q;
                        resetAdoraSearchTypingForInput(list);
                    }
                }
                syncAdoraAnimatedSearchVisibility();
            } catch (_e) {}
        }

        /** كلمات تظهر بعد «بحث عن» / Search for — كل حقول البحث في التطبيق */
        const ADORA_SEARCH_ROTATE_AR = [
            'عطور',
            'ملابس',
            'موبايلات',
            'أحذية',
            'حقائب',
            'ساعات',
            'مكياج',
            'أثاث',
            'إلكترونيات',
            'ألعاب',
            'هدايا',
            'رياضة',
            'شركات',
            'نسائي',
            'رجالي',
            'أطفال',
            'عروض',
        ];
        const ADORA_SEARCH_ROTATE_EN = [
            'Perfumes',
            'Clothes',
            'Phones',
            'Shoes',
            'Bags',
            'Watches',
            'Makeup',
            'Furniture',
            'Electronics',
            'Games',
            'Gifts',
            'Sports',
            'Brands',
            'Women',
            'Men',
            'Kids',
            'Deals',
        ];
        const ADORA_SEARCH_ROTATE_INTERVAL_MS = 1500;
        const ADORA_SEARCH_TYPING_IDLE_MS = 420;
        const adoraSearchTypingIdleTimers = new WeakMap();

        let adoraSearchRotateIndex = 0;
        let adoraSearchRotateTimer = null;
        let adoraAnimatedSearchListenersBound = false;

        function getAdoraSearchRotateWords() {
            return isRTL ? ADORA_SEARCH_ROTATE_AR : ADORA_SEARCH_ROTATE_EN;
        }

        function syncAdoraSearchFauxPrefixes() {
            document.querySelectorAll('.adora-search-faux-prefix').forEach((el) => {
                const v = isRTL ? el.getAttribute('data-ar') : el.getAttribute('data-en');
                if (v !== null) el.textContent = v;
            });
        }

        function getInputForAnimatedPh(fauxEl) {
            const wrap = fauxEl.parentElement;
            if (!wrap) return null;
            return (
                wrap.querySelector(
                    '#search-input, #listing-search-input, #featured-hub-search-input, #marketplace-search-input'
                ) ||
                wrap.querySelector('input[type="search"], input[type="text"]')
            );
        }

        function clearAdoraSearchTypingIdleTimer(input) {
            const t = adoraSearchTypingIdleTimers.get(input);
            if (t) {
                clearTimeout(t);
                adoraSearchTypingIdleTimers.delete(input);
            }
        }

        function resetAdoraSearchTypingForInput(input) {
            if (!input) return;
            clearAdoraSearchTypingIdleTimer(input);
            delete input.dataset.adoraPhTyping;
        }

        let adoraSearchSuggestTimer = null;
        let adoraSearchSuggestOutsideBound = false;

        function bindAdoraSearchSuggestOutsideClose() {
            if (adoraSearchSuggestOutsideBound) return;
            adoraSearchSuggestOutsideBound = true;
            document.addEventListener(
                'pointerdown',
                (ev) => {
                    const t = ev.target;
                    if (t && t.closest && t.closest('.adora-search-suggest-anchor')) return;
                    if (t && t.closest && t.closest('.adora-search-suggest-panel')) return;
                    hideAdoraSearchSuggestions();
                },
                true
            );
        }

        function getAdoraSearchSuggestScope(inputId) {
            if (inputId === 'marketplace-search-input') return 'marketplace';
            if (inputId === 'listing-search-input' || inputId === 'featured-hub-search-input') return 'products';
            return 'all';
        }

        function normalizeAdoraSearchSuggestionRows(rows) {
            if (!Array.isArray(rows)) return [];
            const out = [];
            for (const row of rows) {
                if (typeof row === 'string') {
                    const q = row.trim();
                    if (q) out.push({ kind: 'query', q });
                    continue;
                }
                if (!row || typeof row !== 'object') continue;
                if (row.kind === 'query' && row.q) {
                    out.push({ kind: 'query', q: String(row.q).trim() });
                    continue;
                }
                if (row.kind === 'adora' && row.id != null && Number.isFinite(Number(row.id))) {
                    out.push({
                        kind: 'adora',
                        id: Number(row.id),
                        title_ar: row.title_ar,
                        title_en: row.title_en,
                        subtitle_ar: row.subtitle_ar,
                        subtitle_en: row.subtitle_en,
                        image_url: row.image_url,
                    });
                    continue;
                }
                if (row.kind === 'marketplace' && row.id != null && Number.isFinite(Number(row.id))) {
                    out.push({
                        kind: 'marketplace',
                        id: Number(row.id),
                        title_ar: row.title_ar,
                        title_en: row.title_en,
                        subtitle_ar: row.subtitle_ar,
                        subtitle_en: row.subtitle_en,
                        image_url: row.image_url,
                    });
                }
            }
            return out;
        }

        let adoraSuggestScrollListenersBound = false;
        let adoraSuggestRepositionRaf = 0;

        function positionAdoraSearchSuggestPanel(anchor, panel) {
            if (!anchor || !panel || !document.body.contains(panel)) return;
            try {
                if (!anchor.isConnected) return;
            } catch (_e) {
                return;
            }
            const r = anchor.getBoundingClientRect();
            const m = 8;
            const vw = window.innerWidth;
            const maxW = Math.min(Math.max(120, r.width), vw - m * 2);
            const left = Math.min(Math.max(m, r.left), Math.max(m, vw - m - maxW));
            panel.style.left = `${Math.round(left)}px`;
            panel.style.width = `${Math.round(maxW)}px`;
            panel.style.top = `${Math.round(r.bottom + 5)}px`;
        }

        function scheduleAdoraSuggestReposition() {
            const anchor = window.__adoraSuggestActiveAnchor;
            const panel = window.__adoraSuggestActivePanel;
            if (!anchor || !panel || !document.body.contains(panel)) return;
            if (adoraSuggestRepositionRaf) cancelAnimationFrame(adoraSuggestRepositionRaf);
            adoraSuggestRepositionRaf = requestAnimationFrame(() => {
                adoraSuggestRepositionRaf = 0;
                positionAdoraSearchSuggestPanel(anchor, panel);
            });
        }

        function ensureAdoraSuggestScrollListeners() {
            if (adoraSuggestScrollListenersBound) return;
            adoraSuggestScrollListenersBound = true;
            window.addEventListener('scroll', scheduleAdoraSuggestReposition, true);
            window.addEventListener('resize', scheduleAdoraSuggestReposition);
        }

        function hideAdoraSearchSuggestions() {
            window.__adoraSuggestActiveAnchor = null;
            window.__adoraSuggestActivePanel = null;
            document.querySelectorAll('.adora-search-suggest-panel, .adora-search-suggestions').forEach((n) => n.remove());
        }

        function handleAdoraSearchSuggestPick(input, item) {
            if (!input || !item) return;
            hideAdoraSearchSuggestions();
            if (item.kind === 'adora' && item.id != null) {
                openProductDetail(Number(item.id)).catch(() => {});
                try {
                    input.blur();
                } catch (_e) {}
                return;
            }
            if (item.kind === 'marketplace' && item.id != null) {
                openMarketplaceProductDetail(Number(item.id)).catch(() => {});
                try {
                    input.blur();
                } catch (_e2) {}
                return;
            }
            if (item.kind === 'query' && item.q) {
                const q = String(item.q).trim();
                if (!q) return;
                if (input.id === 'search-input') {
                    listingSearchQuery = q;
                    input.value = '';
                    resetAdoraSearchTypingForInput(input);
                    syncAdoraAnimatedSearchVisibility();
                    navigateTo('screen-listing');
                    loadListingPageProducts().catch(() => {});
                } else if (input.id === 'listing-search-input') {
                    listingSearchQuery = q;
                    input.value = q;
                    loadListingPageProducts().catch(() => {});
                } else if (input.id === 'featured-hub-search-input') {
                    input.value = q;
                    loadFeaturedHubProducts().catch(() => {});
                } else if (input.id === 'marketplace-search-input') {
                    input.value = q;
                    refreshMarketplaceProductList().catch(() => {});
                }
                try {
                    input.blur();
                } catch (_e3) {}
            }
        }

        function showAdoraSearchSuggestionsUnder(input, items) {
            hideAdoraSearchSuggestions();
            if (!input || !Array.isArray(items) || !items.length) return;
            const anchor = input.closest('.adora-search-suggest-anchor');
            if (!anchor) return;
            if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';

            const loc = isRTL ? 'ar' : 'en';
            const rowHtml = (it, i) => {
                let title = '';
                let sub = '';
                if (it.kind === 'query') {
                    title = String(it.q || '').trim();
                } else {
                    title =
                        loc === 'ar'
                            ? String(it.title_ar || it.title_en || '').trim()
                            : String(it.title_en || it.title_ar || '').trim();
                    const subRaw =
                        loc === 'ar'
                            ? it.subtitle_ar != null
                                ? String(it.subtitle_ar)
                                : it.subtitle_en != null
                                  ? String(it.subtitle_en)
                                  : ''
                            : it.subtitle_en != null
                              ? String(it.subtitle_en)
                              : it.subtitle_ar != null
                                ? String(it.subtitle_ar)
                                : '';
                    sub = subRaw.trim();
                }
                if (!title) title = isRTL ? 'اقتراح' : 'Suggestion';
                const imgRaw = it.image_url ? String(it.image_url).trim() : '';
                const imgAbs = imgRaw ? absoluteMediaUrl(imgRaw) : '';
                const thumb = imgAbs
                    ? `<span class="adora-search-suggest-thumb"><img src="${escapeHtml(imgAbs)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
                    : `<span class="adora-search-suggest-thumb" aria-hidden="true"><i class="fas fa-search"></i></span>`;
                const subBlock = sub ? `<div class="adora-search-suggest-sub">${escapeHtml(sub)}</div>` : '';
                const chev = isRTL ? 'left' : 'right';
                return `<button type="button" class="adora-search-suggest-row" data-suggest-i="${i}" role="option">
                    ${thumb}
                    <span class="adora-search-suggest-text">
                        <span class="adora-search-suggest-title">${escapeHtml(title)}</span>
                        ${subBlock}
                    </span>
                    <span class="adora-search-suggest-chevron" aria-hidden="true"><i class="fas fa-chevron-${chev}"></i></span>
                </button>`;
            };

            const el = document.createElement('div');
            el.className = 'adora-search-suggest-panel adora-search-suggest-panel--portal';
            el.setAttribute('role', 'listbox');
            el.innerHTML = items.map((it, i) => rowHtml(it, i)).join('');

            el.querySelectorAll('.adora-search-suggest-row').forEach((btn, i) => {
                btn.addEventListener('mousedown', (ev) => {
                    ev.preventDefault();
                });
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    handleAdoraSearchSuggestPick(input, items[i]);
                });
            });
            document.body.appendChild(el);
            window.__adoraSuggestActiveAnchor = anchor;
            window.__adoraSuggestActivePanel = el;
            positionAdoraSearchSuggestPanel(anchor, el);
            ensureAdoraSuggestScrollListeners();
        }

        function scheduleAdoraSearchSuggestions(input, scope) {
            clearTimeout(adoraSearchSuggestTimer);
            adoraSearchSuggestTimer = setTimeout(async () => {
                const q = String(input?.value || '').trim();
                if (q.length < 1) {
                    hideAdoraSearchSuggestions();
                    return;
                }
                try {
                    let sugUrl = `/api/search/suggestions?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope || 'all')}`;
                    if (input && input.id === 'featured-hub-search-input') {
                        sugUrl += '&featured_hub=1';
                        if (featuredHubSection) {
                            sugUrl += `&featured_hub_section=${encodeURIComponent(featuredHubSection)}`;
                        }
                    }
                    const rows = await apiFetch(sugUrl, { requireAuth: false });
                    const list = normalizeAdoraSearchSuggestionRows(rows);
                    showAdoraSearchSuggestionsUnder(input, list);
                } catch (_e) {
                    hideAdoraSearchSuggestions();
                }
            }, 260);
        }

        function scheduleAdoraSearchTypingIdle(input) {
            clearAdoraSearchTypingIdleTimer(input);
            input.dataset.adoraPhTyping = '1';
            syncAdoraAnimatedSearchVisibility();
            const t = setTimeout(() => {
                adoraSearchTypingIdleTimers.delete(input);
                delete input.dataset.adoraPhTyping;
                syncAdoraAnimatedSearchVisibility();
            }, ADORA_SEARCH_TYPING_IDLE_MS);
            adoraSearchTypingIdleTimers.set(input, t);
        }

        function syncAdoraAnimatedSearchVisibility() {
            document.querySelectorAll('[data-adora-animated-ph]').forEach((faux) => {
                const input = getInputForAnimatedPh(faux);
                const typingHold = input && input.dataset.adoraPhTyping === '1';
                const show = input && !String(input.value || '').trim() && !typingHold;
                faux.classList.toggle('adora-search-faux-ph--hidden', !show);
            });
        }

        function anyAdoraAnimatedSearchPhVisible() {
            let any = false;
            document.querySelectorAll('[data-adora-animated-ph]').forEach((faux) => {
                if (!faux.classList.contains('adora-search-faux-ph--hidden')) any = true;
            });
            return any;
        }

        function onAdoraSearchRotAnimationEnd(ev) {
            if (ev.animationName !== 'adoraSearchRotWord') return;
            ev.target.classList.remove('adora-search-rot-tick');
        }

        function updateAdoraAnimatedSearchWords(opts) {
            const animate = opts && opts.animate === true;
            const words = getAdoraSearchRotateWords();
            if (!words.length) return;
            adoraSearchRotateIndex = ((adoraSearchRotateIndex % words.length) + words.length) % words.length;
            const next = words[adoraSearchRotateIndex];
            document.querySelectorAll('.adora-search-faux-rot-text').forEach((el) => {
                if (animate) {
                    el.classList.remove('adora-search-rot-tick');
                    void el.offsetWidth;
                    el.textContent = next;
                    el.classList.add('adora-search-rot-tick');
                } else {
                    el.textContent = next;
                }
            });
        }

        function tickAdoraAnimatedSearch() {
            if (!anyAdoraAnimatedSearchPhVisible()) return;
            const words = getAdoraSearchRotateWords();
            if (!words.length) return;
            adoraSearchRotateIndex = (adoraSearchRotateIndex + 1) % words.length;
            updateAdoraAnimatedSearchWords({ animate: true });
        }

        function restartAdoraAnimatedSearchTimer() {
            if (adoraSearchRotateTimer) {
                clearInterval(adoraSearchRotateTimer);
                adoraSearchRotateTimer = null;
            }
            if (!document.querySelector('[data-adora-animated-ph]')) return;
            adoraSearchRotateIndex = 0;
            syncAdoraSearchFauxPrefixes();
            updateAdoraAnimatedSearchWords({ animate: false });
            syncAdoraAnimatedSearchVisibility();
            adoraSearchRotateTimer = setInterval(tickAdoraAnimatedSearch, ADORA_SEARCH_ROTATE_INTERVAL_MS);
        }

        function initAdoraAnimatedSearch() {
            document.querySelectorAll('.adora-search-faux-rot-text').forEach((el) => {
                el.removeEventListener('animationend', onAdoraSearchRotAnimationEnd);
                el.addEventListener('animationend', onAdoraSearchRotAnimationEnd);
            });
            if (!adoraAnimatedSearchListenersBound) {
                adoraAnimatedSearchListenersBound = true;
                bindAdoraSearchSuggestOutsideClose();
                const bind = (id) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.addEventListener('focus', () => {
                        syncAdoraAnimatedSearchVisibility();
                        const q = String(el.value || '').trim();
                        if (q.length >= 1) {
                            scheduleAdoraSearchSuggestions(el, getAdoraSearchSuggestScope(el.id));
                        }
                    });
                    el.addEventListener('blur', () => {
                        setTimeout(() => hideAdoraSearchSuggestions(), 220);
                        clearAdoraSearchTypingIdleTimer(el);
                        delete el.dataset.adoraPhTyping;
                        syncAdoraAnimatedSearchVisibility();
                    });
                    el.addEventListener('input', () => {
                        if (String(el.value || '').trim()) {
                            clearAdoraSearchTypingIdleTimer(el);
                            delete el.dataset.adoraPhTyping;
                        } else {
                            hideAdoraSearchSuggestions();
                            scheduleAdoraSearchTypingIdle(el);
                            return;
                        }
                        syncAdoraAnimatedSearchVisibility();
                        scheduleAdoraSearchSuggestions(el, getAdoraSearchSuggestScope(el.id));
                    });
                };
                bind('search-input');
                bind('listing-search-input');
                bind('featured-hub-search-input');
                bind('marketplace-search-input');
            }
            restartAdoraAnimatedSearchTimer();
        }

        function runProductSearch() {
            const input = document.getElementById('search-input');
            listingSearchQuery = input ? input.value.trim() : '';
            listingAdoraOnly = false;
            listingNewCollectionOnly = false;
            if (input) {
                input.value = '';
                resetAdoraSearchTypingForInput(input);
            }
            syncAdoraAnimatedSearchVisibility();
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

        function formatVendorBrandPill(text) {
            const t = String(text || '').trim();
            if (!t) return '';
            return `<span class="inline-flex items-center gap-0.5 max-w-full px-2 py-0.5 rounded-full text-[9px] font-bold tracking-tight bg-gradient-to-r from-violet-50 via-fuchsia-50 to-purple-50 text-violet-800 border border-violet-100/90 shadow-sm" dir="auto"><i class="fas fa-store text-[8px] opacity-75 shrink-0"></i><span class="truncate min-w-0">${escapeHtml(t)}</span></span>`;
        }

        function productHasAnyStockQuick(p) {
            if (!p) return false;
            const inv = Array.isArray(p.inventory) ? p.inventory : [];
            if (inv.length) return inv.some((r) => Number(r.stock || 0) > 0);
            return Number(p.stock || 0) > 0;
        }

        function adoraPcardWishIconsHtml() {
            return '<i class="far fa-heart wl-i-outline text-[11px] opacity-90" aria-hidden="true"></i><i class="fas fa-heart wl-i-fill text-[11px]" aria-hidden="true"></i>';
        }

        function adoraPcardRatingHtml(p) {
            const rc = Math.max(0, Math.round(Number(p.review_count || 0)));
            const avgRaw = p.review_avg != null ? Number(p.review_avg) : null;
            const hasReviews = rc > 0 && avgRaw != null && !Number.isNaN(avgRaw);
            const avgStr = hasReviews ? (avgRaw % 1 === 0 ? String(Math.round(avgRaw)) : avgRaw.toFixed(1)) : '';
            if (!hasReviews) {
                return `<span class="adora-pcard-rating text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold border border-gray-200/80">${isRTL ? 'لا تقييمات بعد' : 'No reviews yet'}</span>`;
            }
            return `<span class="adora-pcard-rating inline-flex items-center gap-1 text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 font-bold border border-gray-200/80" dir="ltr"><span class="text-gray-500 font-semibold">(${rc})</span><span>${escapeHtml(avgStr)}</span><i class="fas fa-star text-emerald-600 text-[8px]" aria-hidden="true"></i></span>`;
        }

        function adoraPcardPriceRowHtml({ disc, listP, saleP }) {
            const d = Math.round(Number(disc || 0));
            const showDisc = d > 0 && d < 100;
            const parts = [];
            if (showDisc) parts.push(`<span class="adora-pcard__disc">${d}%</span>`);
            if (showDisc) parts.push(`<span class="adora-pcard__price-old">${escapeHtml(formatSyp(listP))}</span>`);
            parts.push(`<span class="adora-pcard__price-now">${escapeHtml(formatSyp(saleP))}</span>`);
            return `<div class="adora-pcard__prices" dir="auto">${parts.join('')}</div>`;
        }

        function renderProductCardHtml(p, opts = {}) {
            const compact = opts.compact === true;
            const stripMod = compact ? ' adora-pcard--strip' : '';
            const br = resolveDisplayBrand(p.brand);
            const vendorHtml = br ? `<p class="adora-pcard__vendor" dir="auto">${escapeHtml(br)}</p>` : '';
            const img = p.images && p.images.length ? p.images[0] : adoraPlaceholderImageUrl();
            const name = isRTL ? p.name_ar : p.name_en;
            const listP = productListPrice(p);
            const disc = productDiscountPct(p);
            const saleP = productSaleUnitPrice(p);
            const pid = Number(p.id);
            const cardExtra = compact ? ' home-compact-product-card' : '';
            const inWish = isWishlistEntry('p', pid);
            const canCart = productHasAnyStockQuick(p);
            const wishActive = inWish ? ' active' : '';
            const addDis = canCart ? '' : ' disabled';
            const ratingHtml = `<div class="adora-pcard__rating-row">${adoraPcardRatingHtml(p)}</div>`;
            const priceHtml = adoraPcardPriceRowHtml({ disc, listP, saleP });
            return `<div class="adora-pcard adora-pcv product-card${stripMod}${cardExtra}">
                <div role="button" tabindex="0" class="adora-pcard__hit cursor-pointer text-start" onclick="openProductDetail(${pid})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProductDetail(${pid});}">
                <div class="adora-pcard__top">
                <div class="adora-pcard__media">
                    <div class="adora-pcard__media-inner">
                        <img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                    </div>
                    <button type="button" class="adora-pcard__wish wishlist-btn${wishActive}" aria-label="Wishlist" onclick="wishlistCardToggle(event,'p',${pid},this)">${adoraPcardWishIconsHtml()}</button>
                    <button type="button" class="adora-pcard__add"${addDis} aria-label="Add to cart" onclick="quickAddCatalogProductToCart(${pid},event)">+</button>
                </div>
                </div>
                <div class="adora-pcard__body">
                    <h3 class="adora-pcard__title">${escapeHtml(name)}</h3>
                    ${vendorHtml}
                    ${ratingHtml}
                    ${priceHtml}
                </div>
                </div>
            </div>`;
        }

        function mpHomeVendorLabel(p) {
            const v = isRTL ? p.vendor_name_ar || p.vendor_name_en : p.vendor_name_en || p.vendor_name_ar;
            return String(v || '').trim();
        }

        async function ensureMpAppHomePlacements() {
            if (mpAppHomePlacements && typeof mpAppHomePlacements === 'object') return mpAppHomePlacements;
            if (mpAppHomePlacementsPromise) return mpAppHomePlacementsPromise;
            mpAppHomePlacementsPromise = apiFetch('/api/marketplace/app-home-placements', { requireAuth: false })
                .then((data) => {
                    mpAppHomePlacements = data && typeof data === 'object' ? data : {};
                    return mpAppHomePlacements;
                })
                .catch(() => {
                    mpAppHomePlacements = {};
                    return mpAppHomePlacements;
                })
                .finally(() => {
                    mpAppHomePlacementsPromise = null;
                });
            return mpAppHomePlacementsPromise;
        }

        /** بطاقة منتج سوق للرئيسية: يفتح تفاصيل السوق ويعرض اسم الشركة */
        function renderMpProductCardHomeCompact(p) {
            const vendorName = mpHomeVendorLabel(p);
            const vendorHtml = vendorName ? `<p class="adora-pcard__vendor" dir="auto">${escapeHtml(vendorName)}</p>` : '';
            const rawImg = p.images && p.images.length ? p.images[0] : '';
            const img = rawImg ? absoluteMediaUrl(String(rawImg)) : adoraPlaceholderImageUrl();
            const name = isRTL ? p.name_ar : p.name_en;
            const listP = Number(p.price ?? 0);
            const disc = Math.min(100, Math.max(0, Number(p.discount_percent ?? 0)));
            const saleP = disc > 0 && disc < 100 ? listP * (1 - disc / 100) : listP;
            const mid = Number(p.id);
            const inWish = isWishlistEntry('mp', mid);
            const canCart = Number(p.stock || 0) > 0;
            const wishActive = inWish ? ' active' : '';
            const addDis = canCart ? '' : ' disabled';
            const ratingHtml = `<div class="adora-pcard__rating-row">${adoraPcardRatingHtml(p)}</div>`;
            const priceHtml = adoraPcardPriceRowHtml({ disc, listP, saleP });
            const featBadge =
                Number(p.is_mp_featured_effective) === 1
                    ? `<span class="adora-mp-hot-badge" dir="auto"><span class="adora-mp-hot-emoji" aria-hidden="true">🔥</span>${isRTL ? 'مميز' : 'Hot'}</span>`
                    : '';
            return `<div class="adora-pcard adora-pcv adora-pcard--strip product-card home-compact-product-card">
                <div role="button" tabindex="0" class="adora-pcard__hit cursor-pointer text-start" onclick="openMarketplaceProductDetail(${mid})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMarketplaceProductDetail(${mid});}">
                <div class="adora-pcard__top">
                <div class="adora-pcard__media">
                    <div class="adora-pcard__media-inner relative">
                        ${featBadge}
                        <img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                    </div>
                    <button type="button" class="adora-pcard__wish wishlist-btn${wishActive}" aria-label="Wishlist" onclick="wishlistCardToggle(event,'mp',${mid},this)">${adoraPcardWishIconsHtml()}</button>
                    <button type="button" class="adora-pcard__add"${addDis} aria-label="Add to cart" onclick="quickAddMarketplaceProductToCart(${mid},event)">+</button>
                </div>
                </div>
                <div class="adora-pcard__body">
                    <h3 class="adora-pcard__title">${escapeHtml(name)}</h3>
                    ${vendorHtml}
                    ${ratingHtml}
                    ${priceHtml}
                </div>
                </div>
            </div>`;
        }

        function mergeHomeGridHtmlFromSlot(slotKey, catalogList, maxN) {
            const slot = mpAppHomePlacements && mpAppHomePlacements[slotKey];
            const mpProds = Array.isArray(slot) ? slot.filter((x) => x && x.kind === 'mp_product') : [];
            const seen = new Set();
            const pieces = [];
            for (const x of mpProds) {
                if (pieces.length >= maxN) break;
                const id = Number(x.id);
                if (!Number.isFinite(id) || seen.has(id)) continue;
                seen.add(id);
                pieces.push(renderMpProductCardHomeCompact(x));
            }
            const cat = Array.isArray(catalogList) ? catalogList : [];
            for (const p of cat) {
                if (pieces.length >= maxN) break;
                pieces.push(renderProductCardHtml(p, { compact: true }));
            }
            return pieces.join('');
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
            grid.innerHTML = adoraSkeletonProductGridHtml(8);
            try {
                const rows = await apiFetch('/api/offers', { requireAuth: false });
                const list = Array.isArray(rows) ? rows.filter(offerRowIsActive) : [];
                if (!list.length) {
                    grid.innerHTML = `<p class="col-span-2 text-center text-gray-500 py-10 text-sm leading-relaxed px-2">${isRTL ? 'لا توجد عروض نشطة حالياً.' : 'No active offers right now.'}</p>`;
                    return;
                }
                const offerPieces = list.map((row) => {
                    const offerDisc = Number(row.discount_percent || 0);
                    const prodDisc = Number(row.discount || 0);
                    const disc = offerDisc > 0 ? offerDisc : prodDisc;
                    const mid = row.marketplace_product_id != null ? Number(row.marketplace_product_id) : NaN;
                    if (Number.isFinite(mid) && mid > 0) {
                        const mpCard = {
                            id: mid,
                            name_ar: row.name_ar,
                            name_en: row.name_en,
                            price: row.price,
                            discount_percent: disc,
                            images: Array.isArray(row.images) ? row.images : [],
                            vendor_name_ar: row.brand,
                            vendor_name_en: row.brand,
                            stock: row.stock,
                            review_avg: row.review_avg,
                            review_count: row.review_count,
                        };
                        return renderMpProductCardHomeCompact(mpCard);
                    }
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
                });
                adoraInsertAdjacentHtmlChunked(grid, offerPieces, 10);
            } catch (e) {
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-8 text-sm">${escapeHtml(e.message)}</p>`;
            }
        }

        const FEATURED_HUB_SECTION_LABELS = {
            clothes: { ar: 'ملابس', en: 'Clothes' },
            electronics: { ar: 'إلكترونيات', en: 'Electronics' },
            phones: { ar: 'موبايلات', en: 'Phones' },
            shoes: { ar: 'أحذية', en: 'Shoes' },
            accessories: { ar: 'إكسسوارات', en: 'Accessories' },
            bedding: { ar: 'فرش', en: 'Bedding' },
            medical: { ar: 'طبية', en: 'Medical' },
            used: { ar: 'مستعمل', en: 'Used' },
        };

        function syncFeaturedHubCategoryTilesUi() {
            document.querySelectorAll('#screen-featured-hub [data-featured-hub-section]').forEach((btn) => {
                const k = btn.getAttribute('data-featured-hub-section') || '';
                const on = !!featuredHubSection && k === featuredHubSection;
                btn.classList.toggle('adora-featured-hub-tile--active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            const lab = document.getElementById('featured-hub-section-label');
            if (!lab) return;
            if (!featuredHubSection) {
                lab.textContent = isRTL ? 'اختر القسم' : 'Choose a category';
                return;
            }
            const L = FEATURED_HUB_SECTION_LABELS[featuredHubSection];
            lab.textContent = L ? (isRTL ? L.ar : L.en) : featuredHubSection;
        }

        function selectFeaturedHubSection(sectionKey) {
            const k = String(sectionKey || '').trim().toLowerCase();
            if (!FEATURED_HUB_SECTION_LABELS[k]) return;
            featuredHubSection = k;
            syncFeaturedHubCategoryTilesUi();
            loadFeaturedHubProducts().catch(() => {});
        }
        window.selectFeaturedHubSection = selectFeaturedHubSection;

        function scheduleFeaturedHubSearchDebounced() {
            clearTimeout(featuredHubSearchDebounceTimer);
            featuredHubSearchDebounceTimer = setTimeout(() => {
                loadFeaturedHubProducts().catch(() => {});
            }, 380);
        }
        window.scheduleFeaturedHubSearchDebounced = scheduleFeaturedHubSearchDebounced;

        function featuredHubSearchOnEnter(ev) {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            clearTimeout(featuredHubSearchDebounceTimer);
            loadFeaturedHubProducts().catch(() => {});
        }
        window.featuredHubSearchOnEnter = featuredHubSearchOnEnter;

        async function loadFeaturedHubProducts() {
            const grid = document.getElementById('featured-hub-products-grid');
            if (!grid) return;
            if (!featuredHubSection) {
                grid.innerHTML = `<p class="col-span-2 text-center text-violet-700/80 py-10 text-sm leading-relaxed px-3">${
                    isRTL ? 'اختر أحد الأقسام لعرض المنتجات.' : 'Pick a category tile to see products.'
                }</p>`;
                return;
            }
            grid.innerHTML = adoraSkeletonProductGridHtml(8);
            const inp = document.getElementById('featured-hub-search-input');
            const q = inp ? String(inp.value || '').trim() : '';
            try {
                const qs = new URLSearchParams();
                qs.set('featured_hub', '1');
                qs.set('featured_hub_section', featuredHubSection);
                if (q) qs.set('q', q);
                const [rowsCat, rowsMp] = await Promise.all([
                    apiFetch(`/api/products?${qs.toString()}`, { requireAuth: false }),
                    apiFetch(
                        `/api/marketplace/products?${(() => {
                            const m = new URLSearchParams();
                            m.set('featured_hub', '1');
                            m.set('featured_hub_section', featuredHubSection);
                            if (q) m.set('q', q);
                            return m.toString();
                        })()}`,
                        { requireAuth: false }
                    ),
                ]);
                const listCat = Array.isArray(rowsCat) ? rowsCat : [];
                const listMp = (Array.isArray(rowsMp) ? rowsMp : []).map((p) => ({ ...p, adora_listing_kind: 'marketplace' }));
                let list = [...listCat, ...listMp];
                if (q) {
                    list = adoraSortProductsFeaturedFirst(list);
                }
                if (!list.length) {
                    grid.innerHTML = `<p class="col-span-2 text-center text-violet-700/80 py-10 text-sm leading-relaxed px-3">${
                        isRTL ? 'لا توجد منتجات تطابق البحث أو القسم.' : 'No products match this section or search.'
                    }</p>`;
                    return;
                }
                const pieces = list.map((p) =>
                    p.adora_listing_kind === 'marketplace'
                        ? renderMpProductCardHomeCompact(p)
                        : renderProductCardHtml(p, { compact: true })
                );
                adoraInsertAdjacentHtmlChunked(grid, pieces, 10);
            } catch (e) {
                grid.innerHTML = `<p class="col-span-2 text-center text-red-500 py-8 text-sm">${escapeHtml(e.message)}</p>`;
            }
        }
        window.loadFeaturedHubProducts = loadFeaturedHubProducts;

        async function openProductDetail(id, opts = {}) {
            const skipNavigate = opts.skipNavigate === true;
            if (!skipNavigate) {
                productDetailBackScreen = currentScreen || 'screen-listing';
            }
            const loadGen = ++adoraCatalogPdpLoadGen;
            const mpYmalSec = document.getElementById('product-marketplace-ymal-section');
            const mpYmalWrap = document.getElementById('product-marketplace-ymal-scroll');
            if (mpYmalWrap) mpYmalWrap.innerHTML = '';
            if (mpYmalSec) mpYmalSec.classList.add('hidden');
            if (!skipNavigate) {
                navigateTo('screen-product');
            }
            setCatalogPdpBusy(true);
            try {
                const p = await apiFetch(`/api/products/${id}`, { requireAuth: false });
                if (loadGen !== adoraCatalogPdpLoadGen) return;
                currentProductDetail = p;
                fillProductDetailScreen(p);
                if (skipNavigate) {
                    persistAdoraSessionState();
                }
                scheduleCatalogPdpSecondaryContent(loadGen, p.id);
            } catch (err) {
                if (loadGen !== adoraCatalogPdpLoadGen) return;
                try {
                    console.error('[Adora] openProductDetail', id, err);
                } catch (_log) {}
                showToast(isRTL ? 'تعذر تحميل المنتج' : 'Failed to load product');
                if (!skipNavigate) {
                    const popped = adoraPopIfTopIs('screen-product');
                    if (popped) {
                        adoraAfterPopNavigate(popped.prev, popped.leaving);
                    } else {
                        navigateTo(productDetailBackScreen || 'screen-listing', { skipHistory: true });
                        adoraSyncHistoryToScreen(productDetailBackScreen || 'screen-listing');
                        persistAdoraSessionState();
                    }
                }
            } finally {
                if (loadGen === adoraCatalogPdpLoadGen) {
                    setCatalogPdpBusy(false, loadGen);
                }
            }
        }

        window.openProductDetail = openProductDetail;
        window.openMarketplaceProductDetail = openMarketplaceProductDetail;

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
                } else if (top === 'screen-marketplace-product') {
                    const mid = sessionStorage.getItem(ADORA_SESSION_MP_PRODUCT_KEY);
                    if (mid && /^\d+$/.test(mid)) {
                        await openMarketplaceProductDetail(Number(mid), { skipNavigate: true });
                    }
                }
            } catch (_e) {}
        }

        function fillProductDetailScreen(p) {
            applyProductReviewThemeById(p && p.id != null ? p.id : 0, 'adora');
            productDetailSelectedColorIndex = 0;
            productDetailVariantPick = {};
            currentQty = 1;
            const qd0 = document.getElementById('qty-display');
            if (qd0) qd0.textContent = '1';
            const leg = document.getElementById('product-legacy-variant-sections');
            const dynRoot = document.getElementById('product-dynamic-variant-root');
            const isDyn = productUsesDynamicOptions(p);
            if (isDyn) {
                leg?.classList.add('hidden');
                dynRoot?.classList.remove('hidden');
                productDetailVariantPick = defaultVariantPickDynamic(p);
            } else {
                leg?.classList.remove('hidden');
                dynRoot?.classList.add('hidden');
            }
            const title = isRTL ? p.name_ar : p.name_en;
            const listP = productListPrice(p);
            const disc = productDiscountPct(p);
            const saleP = productSaleUnitPrice(p);
            const gal = document.getElementById('product-gallery');
            if (gal) {
                const imgsNorm = normalizePdpImageList(p.images);
                const imgs = imgsNorm.length ? imgsNorm : [adoraPlaceholderImageUrl()];
                adoraReplaceGallerySlidesKeepingToolbar(gal, adoraBuildPdpGallerySlidesHtml(imgs), 0);
                syncProductGalleryDotsFromGallery();
            }
            const tEl = document.getElementById('product-detail-title');
            if (tEl) tEl.textContent = title;
            const brandNameEl = document.getElementById('product-detail-brand-name');
            const brandBtn = document.getElementById('product-detail-brand-products-btn');
            const displayBrand = resolveDisplayBrand(p.brand);
            if (brandNameEl) brandNameEl.textContent = displayBrand || (isRTL ? 'أدورا' : 'Adora');
            if (brandBtn) {
                const rawBr = String(p.brand || '').trim();
                brandBtn.classList.toggle('hidden', !rawBr);
            }
            const metaEl = document.getElementById('product-detail-meta');
            if (metaEl) {
                metaEl.textContent = '';
                metaEl.classList.add('hidden');
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
            if (sEl) sEl.classList.add('hidden');
            const db = document.getElementById('product-detail-discount-badge');
            if (db) {
                if (disc > 0) {
                    db.classList.remove('hidden');
                    db.textContent = `-${Math.round(disc)}%`;
                } else db.classList.add('hidden');
            }
            const dpill = document.getElementById('product-detail-discount-pill');
            if (dpill) {
                if (disc > 0) {
                    dpill.textContent = formatPdpDiscountLine(disc);
                    dpill.classList.remove('hidden');
                } else dpill.classList.add('hidden');
            }
            syncProductDescriptionUi(p.description);
            const addP = document.getElementById('product-detail-add-price');
            if (addP) addP.textContent = ` — ${formatSyp(saleP)}`;

            const finishVariantsAndChrome = () => {
                if (isDyn) {
                    applyProductDetailVariantToUi(p);
                } else {
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
                }
                syncProductDetailStockUi();
                updateWishlistButtonForProduct(p.id);
            };
            requestAnimationFrame(() => requestAnimationFrame(finishVariantsAndChrome));
        }

        function productOptionDefinitions(p) {
            const o = p && p.product_options;
            return Array.isArray(o) && o.length ? o : [];
        }

        /** عرض المقاس/المقاسات قبل اللون في الواجهة (أدورا + السوق) */
        function sortProductOptionDefinitionsForDisplay(defs) {
            const arr = Array.isArray(defs) ? [...defs] : [];
            const rank = (d) => {
                const n = `${d && d.name_en ? d.name_en : ''} ${d && d.name_ar ? d.name_ar : ''}`.toLowerCase();
                if (/size|مقاس|measure|length|width|طول|عرض|المقاس/i.test(n)) return 0;
                if (/color|colour|لون|اللون/i.test(n)) return 2;
                return 1;
            };
            arr.sort((a, b) => rank(a) - rank(b));
            return arr;
        }

        function productUsesDynamicOptions(p) {
            return productOptionDefinitions(p).length > 0;
        }

        function findInventoryRowDynamic(p, pick) {
            const defs = productOptionDefinitions(p);
            if (!defs.length || !pick) return null;
            for (const d of defs) {
                if (!pick[d.id]) return null;
            }
            const inv = Array.isArray(p.inventory) ? p.inventory : [];
            for (const row of inv) {
                if (!row.options || typeof row.options !== 'object') continue;
                let ok = true;
                for (const d of defs) {
                    if (String(row.options[d.id] || '') !== String(pick[d.id] || '')) {
                        ok = false;
                        break;
                    }
                }
                if (ok) return row;
            }
            return null;
        }

        function valuesAvailableForOptionDynamic(p, optionId, partialPick) {
            const defs = productOptionDefinitions(p);
            const inv = Array.isArray(p.inventory) ? p.inventory : [];
            const allowed = new Set();
            for (const row of inv) {
                if (!row.options || typeof row.options !== 'object') continue;
                if (Number(row.stock || 0) <= 0) continue;
                let ok = true;
                for (const d of defs) {
                    if (d.id === optionId) continue;
                    const need = partialPick[d.id];
                    if (need && String(row.options[d.id] || '') !== String(need)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) allowed.add(String(row.options[optionId] || ''));
            }
            return allowed;
        }

        function defaultVariantPickDynamic(p) {
            const defs = sortProductOptionDefinitionsForDisplay(productOptionDefinitions(p));
            const pick = {};
            for (const d of defs) {
                const avail = valuesAvailableForOptionDynamic(p, d.id, pick);
                const firstVal = (d.values || []).find((v) => avail.has(String(v.id)));
                if (!firstVal) return pick;
                pick[d.id] = firstVal.id;
            }
            return pick;
        }

        function variantListUnitForRow(p, row) {
            const base = productListPrice(p);
            if (row && row.price != null && !Number.isNaN(Number(row.price))) return Number(row.price);
            return base;
        }

        function formatVariantLabelFromPick(p, pick) {
            const defs = sortProductOptionDefinitionsForDisplay(productOptionDefinitions(p));
            const parts = [];
            for (const d of defs) {
                const vid = pick[d.id];
                const vobj = (d.values || []).find((v) => String(v.id) === String(vid));
                const lab = vobj ? (isRTL ? vobj.label_ar || vobj.label_en : vobj.label_en || vobj.label_ar) : '';
                if (lab) parts.push(`${isRTL ? d.name_ar || d.name_en : d.name_en || d.name_ar}: ${lab}`);
            }
            return parts.join(' · ');
        }

        function renderProductDynamicOptions(p) {
            const root = document.getElementById('product-dynamic-variant-root');
            if (!root) return;
            const defs = sortProductOptionDefinitionsForDisplay(productOptionDefinitions(p));
            if (!defs.length) {
                root.innerHTML = '';
                return;
            }
            root.innerHTML = defs
                .map((d) => {
                    const partial = { ...productDetailVariantPick };
                    delete partial[d.id];
                    const avail = valuesAvailableForOptionDynamic(p, d.id, partial);
                    const title = isRTL ? d.name_ar || d.name_en : d.name_en || d.name_ar;
                    const chips = (d.values || [])
                        .map((v) => {
                            const on = String(productDetailVariantPick[d.id] || '') === String(v.id);
                            const dis = !avail.has(String(v.id));
                            const lab = isRTL ? v.label_ar || v.label_en : v.label_en || v.label_ar;
                            return `<button type="button" role="radio" aria-checked="${on}" class="px-3 py-2 rounded-xl border-2 text-sm font-semibold transition ${
                                on
                                    ? 'border-indigo-400 bg-indigo-50/95 text-indigo-900 shadow-sm'
                                    : dis
                                      ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                      : 'border-gray-200/90 text-gray-800 hover:border-indigo-200 hover:bg-indigo-50/40'
                            }" data-pv-opt="${escapeHtml(d.id)}" data-pv-val="${escapeHtml(v.id)}" ${dis ? 'disabled' : ''}>${escapeHtml(lab)}</button>`;
                        })
                        .join('');
                    return `<div class="space-y-2">
                        <h3 class="text-sm font-bold text-gray-800">${escapeHtml(title)}</h3>
                        <div class="flex flex-wrap gap-2">${chips}</div>
                    </div>`;
                })
                .join('');
            root.querySelectorAll('[data-pv-opt]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    if (btn.disabled) return;
                    const oid = btn.getAttribute('data-pv-opt');
                    const vid = btn.getAttribute('data-pv-val');
                    productDetailVariantPick[oid] = vid;
                    const defs2 = sortProductOptionDefinitionsForDisplay(productOptionDefinitions(p));
                    let idx = defs2.findIndex((x) => x.id === oid);
                    for (let j = idx + 1; j < defs2.length; j++) {
                        const nx = defs2[j];
                        const partial = {};
                        for (let k = 0; k < j; k++) partial[defs2[k].id] = productDetailVariantPick[defs2[k].id];
                        const av = valuesAvailableForOptionDynamic(p, nx.id, partial);
                        const cur = productDetailVariantPick[nx.id];
                        if (!av.has(String(cur))) {
                            const pickFirst = (nx.values || []).find((v) => av.has(String(v.id)));
                            productDetailVariantPick[nx.id] = pickFirst ? pickFirst.id : '';
                        }
                    }
                    applyProductDetailVariantToUi(p);
                });
            });
        }

        function applyProductDetailVariantToUi(p) {
            if (!p || !productUsesDynamicOptions(p)) return;
            const row = findInventoryRowDynamic(p, productDetailVariantPick);
            const listU = variantListUnitForRow(p, row);
            const disc = productDiscountPct(p);
            const saleU = saleUnitFromListAndDiscount(listU, disc);
            const pEl = document.getElementById('product-detail-price');
            if (pEl) pEl.textContent = formatSyp(saleU);
            const oEl = document.getElementById('product-detail-old-price');
            if (oEl) {
                if (disc > 0) {
                    oEl.classList.remove('hidden');
                    oEl.textContent = formatSyp(listU);
                } else oEl.classList.add('hidden');
            }
            const sEl = document.getElementById('product-detail-save');
            if (sEl) sEl.classList.add('hidden');
            const db = document.getElementById('product-detail-discount-badge');
            if (db) {
                if (disc > 0) {
                    db.classList.remove('hidden');
                    db.textContent = `-${Math.round(disc)}%`;
                } else db.classList.add('hidden');
            }
            const dpill = document.getElementById('product-detail-discount-pill');
            if (dpill) {
                if (disc > 0) {
                    dpill.textContent = formatPdpDiscountLine(disc);
                    dpill.classList.remove('hidden');
                } else dpill.classList.add('hidden');
            }
            const addP = document.getElementById('product-detail-add-price');
            if (addP) addP.textContent = ` — ${formatSyp(saleU)}`;
            const gal = document.getElementById('product-gallery');
            const baseList = normalizePdpImageList(p.images);
            const baseImgs = baseList.length ? baseList : [adoraPlaceholderImageUrl()];
            const extra = row && row.image ? String(row.image).trim() : '';
            const merged = extra && !baseImgs.includes(extra) ? [extra, ...baseImgs] : baseImgs;
            if (gal) {
                adoraReplaceGallerySlidesKeepingToolbar(gal, adoraBuildPdpGallerySlidesHtml(merged), 0);
                syncProductGalleryDotsFromGallery();
            }
            renderProductDynamicOptions(p);
            syncProductDetailStockUi();
        }

        function getProductDetailStockCount() {
            const p = currentProductDetail;
            if (!p) return 0;
            if (productUsesDynamicOptions(p)) {
                const row = findInventoryRowDynamic(p, productDetailVariantPick);
                return row ? Math.max(0, Number(row.stock || 0)) : 0;
            }
            const inv = Array.isArray(p.inventory) ? p.inventory : [];
            const sz = String(getSelectedDetailSize() || '').trim().toLowerCase();
            const cl = String(getSelectedDetailColor() || '').trim().toLowerCase();
            if (!inv.length) return Math.max(0, Number(p.stock || 0));
            const row = inv.find((r) => {
                if (r.options && typeof r.options === 'object' && Object.keys(r.options).length) return false;
                const rs = String(r.size || '').trim().toLowerCase();
                const rc = String(r.color || '').trim().toLowerCase();
                const szMatch = !sz || rs === sz;
                const clMatch = !cl || rc === cl;
                return szMatch && clMatch;
            });
            if (row) return Math.max(0, Number(row.stock || 0));
            return Math.max(0, Number(p.stock || 0));
        }

        function syncProductDetailStockUi() {
            const el = document.getElementById('product-detail-stock');
            if (!el) return;
            if (!currentProductDetail) {
                el.classList.add('hidden');
                return;
            }
            const st = getProductDetailStockCount();
            el.classList.remove('hidden');
            el.classList.remove('text-emerald-700', 'text-rose-600');
            if (st > 0) {
                el.textContent = isRTL ? `متوفر · ${st}` : `In stock · ${st}`;
                el.classList.add('text-emerald-700');
            } else {
                el.textContent = isRTL ? 'غير متوفر' : 'Out of stock';
                el.classList.add('text-rose-600');
            }
        }

        function variantHasStock(p, size, color) {
            if (!p) return false;
            if (productUsesDynamicOptions(p)) {
                const row = findInventoryRowDynamic(p, productDetailVariantPick);
                return !!(row && Number(row.stock || 0) > 0);
            }
            const inv = Array.isArray(p.inventory) ? p.inventory : [];
            const sz = String(size || '').trim().toLowerCase();
            const cl = String(color || '').trim().toLowerCase();
            if (!inv.length) return Number(p.stock || 0) > 0;
            const row = inv.find((r) => {
                if (r.options && typeof r.options === 'object' && Object.keys(r.options).length) return false;
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
            syncProductDetailStockUi();
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
            syncProductDetailStockUi();
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

        function renderProductInlineStarsFromAvg(avg) {
            const emptyCls = 'far fa-star text-gray-300';
            const fillCls = 'fas fa-star adora-inline-rating-star-fill';
            const halfCls = 'fas fa-star-half-alt adora-inline-rating-star-half';
            if (avg == null || Number.isNaN(Number(avg))) {
                return [1, 2, 3, 4, 5].map(() => `<i class="${emptyCls} text-xs"></i>`).join('');
            }
            const a = Math.min(5, Math.max(0, Number(avg)));
            const rounded = Math.round(a * 2) / 2;
            const full = Math.floor(rounded);
            const hasHalf = rounded - full === 0.5;
            let html = '';
            for (let i = 1; i <= 5; i++) {
                if (i <= full) html += `<i class="${fillCls} text-xs"></i>`;
                else if (hasHalf && i === full + 1) html += `<i class="${halfCls} text-xs"></i>`;
                else html += `<i class="${emptyCls} text-xs"></i>`;
            }
            return html;
        }

        function updateProductDetailInlineRating(data) {
            const row = document.getElementById('product-detail-rating-row');
            const starsEl = document.getElementById('product-detail-rating-stars');
            const scoreEl = document.getElementById('product-detail-rating-score');
            const countBtn = document.getElementById('product-detail-rating-count');
            if (!row || !starsEl || !scoreEl || !countBtn) return;
            const avg = data && data.average != null ? Number(data.average) : null;
            const cnt = Math.max(0, Number(data && data.count != null ? data.count : 0) || 0);
            if (cnt === 0 && (avg == null || Number.isNaN(avg))) {
                row.classList.add('hidden');
                return;
            }
            row.classList.remove('hidden');
            starsEl.innerHTML = '<i class="fas fa-star text-emerald-500 text-[13px]" aria-hidden="true"></i>';
            scoreEl.textContent = avg != null && !Number.isNaN(avg) ? avg.toFixed(1) : '—';
            if (cnt > 0) {
                countBtn.classList.remove('hidden');
                countBtn.textContent = isRTL
                    ? cnt === 1
                      ? '(تقييم واحد)'
                      : `(${cnt} تقييمات)`
                    : cnt === 1
                      ? '(1 rating)'
                      : `(${cnt} ratings)`;
            } else {
                countBtn.classList.add('hidden');
                countBtn.textContent = '';
            }
        }

        function updateMarketplaceDetailInlineRating(data) {
            const row = document.getElementById('marketplace-detail-rating-row');
            const starsEl = document.getElementById('marketplace-detail-rating-stars');
            const scoreEl = document.getElementById('marketplace-detail-rating-score');
            const countBtn = document.getElementById('marketplace-detail-rating-count');
            if (!row || !starsEl || !scoreEl || !countBtn) return;
            const avg = data && data.average != null ? Number(data.average) : null;
            const cnt = Math.max(0, Number(data && data.count != null ? data.count : 0) || 0);
            if (cnt === 0 && (avg == null || Number.isNaN(avg))) {
                row.classList.add('hidden');
                return;
            }
            row.classList.remove('hidden');
            starsEl.innerHTML = '<i class="fas fa-star text-emerald-500 text-[13px]" aria-hidden="true"></i>';
            scoreEl.textContent = avg != null && !Number.isNaN(avg) ? avg.toFixed(1) : '—';
            if (cnt > 0) {
                countBtn.classList.remove('hidden');
                countBtn.textContent = isRTL
                    ? cnt === 1
                      ? '(تقييم واحد)'
                      : `(${cnt} تقييمات)`
                    : cnt === 1
                      ? '(1 rating)'
                      : `(${cnt} ratings)`;
            } else {
                countBtn.classList.add('hidden');
                countBtn.textContent = '';
            }
        }

        const adoraHorizontalGalleryDotsBound = new Set();
        function syncHorizontalGalleryDots(galleryId, dotsHostId, fractionId) {
            const gal = document.getElementById(galleryId);
            const host = document.getElementById(dotsHostId);
            const frac = fractionId ? document.getElementById(fractionId) : null;
            if (!gal || !host) return;
            const slides = [...gal.querySelectorAll('.product-gallery-slide')];
            const n = slides.length;
            host.innerHTML = '';
            if (n <= 1) {
                host.classList.add('hidden');
                if (frac) {
                    frac.classList.add('hidden');
                    frac.textContent = '';
                }
                return;
            }
            host.classList.remove('hidden');
            host.classList.add('noon-dots');
            if (frac) {
                frac.classList.remove('hidden');
            }
            const setActive = () => {
                const w = Math.max(1, gal.clientWidth);
                const idx = Math.min(n - 1, Math.max(0, Math.round(gal.scrollLeft / w)));
                [...host.children].forEach((c, j) => c.setAttribute('aria-current', j === idx ? 'true' : 'false'));
                if (frac) frac.textContent = `${idx + 1} / ${n}`;
            };
            for (let i = 0; i < n; i++) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'pointer-events-auto';
                btn.setAttribute('aria-label', `${i + 1} / ${n}`);
                btn.addEventListener('click', () => {
                    try {
                        slides[i].scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
                    } catch (_e) {
                        gal.scrollTo({ left: i * gal.clientWidth, behavior: 'smooth' });
                    }
                });
                host.appendChild(btn);
            }
            setActive();
            if (!adoraHorizontalGalleryDotsBound.has(galleryId)) {
                adoraHorizontalGalleryDotsBound.add(galleryId);
                gal.addEventListener('scroll', () => requestAnimationFrame(setActive), { passive: true });
            }
        }

        function syncProductGalleryDotsFromGallery() {
            syncHorizontalGalleryDots('product-gallery', 'product-gallery-dots', 'product-gallery-fraction');
        }

        let productDescExpanded = false;
        function updateProductDescToggleLabel() {
            const tog = document.getElementById('product-desc-toggle');
            if (!tog || tog.classList.contains('hidden')) return;
            const more = isRTL ? tog.getAttribute('data-ar-more') : tog.getAttribute('data-en-more');
            const less = isRTL ? tog.getAttribute('data-ar-less') : tog.getAttribute('data-en-less');
            tog.textContent = productDescExpanded ? less || 'Show less' : more || 'Show more';
        }

        function syncProductDescriptionUi(raw) {
            const text = (raw != null ? String(raw) : '').trim();
            const prev = document.getElementById('product-desc-preview');
            const full = document.getElementById('product-desc-full');
            const tog = document.getElementById('product-desc-toggle');
            productDescExpanded = false;
            if (!prev || !full) return;
            const placeholder = isRTL ? 'لا يتوفر وصف.' : 'No description.';
            prev.textContent = text || placeholder;
            full.textContent = text || '';
            full.classList.add('hidden');
            prev.classList.remove('hidden');
            const needsMore = text.length > 140 || text.split(/\n/).filter((l) => l.trim()).length > 2;
            if (tog) {
                if (!text) {
                    tog.classList.add('hidden');
                    return;
                }
                tog.classList.toggle('hidden', !needsMore);
                updateProductDescToggleLabel();
            }
        }

        function toggleProductDescExpanded() {
            productDescExpanded = !productDescExpanded;
            const prev = document.getElementById('product-desc-preview');
            const full = document.getElementById('product-desc-full');
            if (!prev || !full) return;
            prev.classList.toggle('hidden', productDescExpanded);
            full.classList.toggle('hidden', !productDescExpanded);
            updateProductDescToggleLabel();
        }
        window.toggleProductDescExpanded = toggleProductDescExpanded;

        let marketplaceDescExpanded = false;
        function updateMarketplaceDescToggleLabel() {
            const tog = document.getElementById('marketplace-desc-toggle');
            if (!tog || tog.classList.contains('hidden')) return;
            const more = isRTL ? tog.getAttribute('data-ar-more') : tog.getAttribute('data-en-more');
            const less = isRTL ? tog.getAttribute('data-ar-less') : tog.getAttribute('data-en-less');
            tog.textContent = marketplaceDescExpanded ? less || 'Show less' : more || 'Show more';
        }

        function syncMarketplaceDescriptionUi(raw) {
            const text = (raw != null ? String(raw) : '').trim();
            const prev = document.getElementById('marketplace-desc-preview');
            const full = document.getElementById('marketplace-desc-full');
            const tog = document.getElementById('marketplace-desc-toggle');
            marketplaceDescExpanded = false;
            if (!prev || !full) return;
            const placeholder = isRTL ? 'لا يوجد وصف.' : 'No description.';
            prev.textContent = text || placeholder;
            full.textContent = text || '';
            full.classList.add('hidden');
            prev.classList.remove('hidden');
            const needsMore = text.length > 140 || text.split(/\n/).filter((l) => l.trim()).length > 2;
            if (tog) {
                if (!text) {
                    tog.classList.add('hidden');
                    return;
                }
                tog.classList.toggle('hidden', !needsMore);
                updateMarketplaceDescToggleLabel();
            }
        }

        function toggleMarketplaceDescExpanded() {
            marketplaceDescExpanded = !marketplaceDescExpanded;
            const prev = document.getElementById('marketplace-desc-preview');
            const full = document.getElementById('marketplace-desc-full');
            if (!prev || !full) return;
            prev.classList.toggle('hidden', marketplaceDescExpanded);
            full.classList.toggle('hidden', !marketplaceDescExpanded);
            updateMarketplaceDescToggleLabel();
        }
        window.toggleMarketplaceDescExpanded = toggleMarketplaceDescExpanded;

        function renderProductSummaryStarsFromAvg(avg) {
            const emptyCls = 'far fa-star text-gray-200 adora-rating-summary-star-empty';
            const fillCls = 'fas fa-star adora-rating-summary-star-fill';
            const halfCls = 'fas fa-star-half-alt adora-rating-summary-star-half';
            if (avg == null || Number.isNaN(Number(avg))) {
                return [1, 2, 3, 4, 5].map(() => `<i class="${emptyCls}"></i>`).join('');
            }
            const a = Math.min(5, Math.max(0, Number(avg)));
            const rounded = Math.round(a * 2) / 2;
            const full = Math.floor(rounded);
            const hasHalf = rounded - full === 0.5;
            let html = '';
            for (let i = 1; i <= 5; i++) {
                if (i <= full) html += `<i class="${fillCls}"></i>`;
                else if (hasHalf && i === full + 1) html += `<i class="${halfCls}"></i>`;
                else html += `<i class="${emptyCls}"></i>`;
            }
            return html;
        }

        function formatProductReviewCountSubtitle(count) {
            const n = Math.max(0, Number(count) || 0);
            if (n === 0) return isRTL ? 'لا تقييمات بعد' : 'No ratings yet';
            if (isRTL) {
                if (n === 1) return 'استناداً إلى تقييم واحد';
                if (n === 2) return 'استناداً إلى تقييمين';
                return `استناداً إلى ${n} تقييماً`;
            }
            return n === 1 ? 'Based on 1 rating' : `Based on ${n} ratings`;
        }

        function renderProductRatingDistributionHtml(distribution, totalCount) {
            const dist = distribution || {};
            const pick = (k) => Number(dist[k] != null ? dist[k] : dist[String(k)] || 0) || 0;
            const total = Math.max(0, Number(totalCount) || 0);
            const barClass = {
                5: 'bg-emerald-700',
                4: 'bg-emerald-600',
                3: 'bg-lime-500',
                2: 'bg-amber-500',
                1: 'bg-red-500',
            };
            const pctTextClass = {
                5: 'text-emerald-800',
                4: 'text-emerald-700',
                3: 'text-lime-700',
                2: 'text-amber-700',
                1: 'text-red-600',
            };
            const order = [5, 4, 3, 2, 1];
            return order
                .map((star) => {
                    const n = pick(star);
                    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                    const label = isRTL ? (star === 1 ? '1 نجمة' : `${star} نجوم`) : star === 1 ? '1 star' : `${star} stars`;
                    const lc = pctTextClass[star];
                    return `<div class="flex items-center gap-2 sm:gap-3" role="listitem">
                        <span class="w-[4.25rem] sm:w-[5.5rem] shrink-0 text-xs font-semibold ${lc} text-end">${escapeHtml(label)}</span>
                        <div class="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden min-w-0">
                            <div class="h-full rounded-full ${barClass[star]} transition-[width] duration-500 ease-out" style="width:${pct}%"></div>
                        </div>
                        <span class="w-9 sm:w-10 shrink-0 text-xs font-extrabold ${lc} tabular-nums text-start">${pct}%</span>
                    </div>`;
                })
                .join('');
        }

        const ADORA_PR_THEME_CLASSES = [
            'adora-pr-theme-0',
            'adora-pr-theme-1',
            'adora-pr-theme-2',
            'adora-pr-theme-3',
            'adora-pr-theme-4',
            'adora-pr-theme-5',
        ];

        /** سمة ألوان التقييمات حسب معرف المنتج — أدورا أو السوق الشامل فقط */
        function applyProductReviewThemeById(productId, scope) {
            const n = Math.abs(Math.floor(Number(productId) || 0)) % ADORA_PR_THEME_CLASSES.length;
            const theme = ADORA_PR_THEME_CLASSES[n];
            const roots =
                scope === 'marketplace'
                    ? [
                          document.querySelector('#screen-marketplace-product .product-noon-sheet'),
                          document.getElementById('marketplace-review-panel'),
                      ]
                    : [
                          document.querySelector('#screen-product .product-noon-sheet'),
                          document.getElementById('product-review-panel'),
                      ];
            roots.forEach((el) => {
                if (!el) return;
                ADORA_PR_THEME_CLASSES.forEach((c) => el.classList.remove(c));
                el.classList.add(theme);
            });
        }

        const ADORA_PRODUCT_RATING_SUMMARY_IDS = {
            card: 'product-rating-summary-card',
            score: 'product-rating-summary-score',
            stars: 'product-rating-summary-stars',
            count: 'product-rating-summary-count',
            dist: 'product-rating-distribution',
        };
        const MARKETPLACE_PRODUCT_RATING_SUMMARY_IDS = {
            card: 'marketplace-rating-summary-card',
            score: 'marketplace-rating-summary-score',
            stars: 'marketplace-rating-summary-stars',
            count: 'marketplace-rating-summary-count',
            dist: 'marketplace-rating-distribution',
        };

        function updateRatingSummaryCard(ids, data) {
            const scoreEl = document.getElementById(ids.score);
            const starsEl = document.getElementById(ids.stars);
            const countEl = document.getElementById(ids.count);
            const distEl = document.getElementById(ids.dist);
            const cardEl = ids.card ? document.getElementById(ids.card) : null;
            const avg = data && data.average != null ? Number(data.average) : null;
            const cnt = Math.max(0, Number(data && data.count != null ? data.count : 0) || 0);
            if (scoreEl) {
                scoreEl.textContent = avg != null && !Number.isNaN(avg) ? avg.toFixed(1) : '—';
            }
            if (starsEl) starsEl.innerHTML = renderProductSummaryStarsFromAvg(avg);
            if (countEl) countEl.textContent = formatProductReviewCountSubtitle(cnt);
            if (distEl) distEl.innerHTML = renderProductRatingDistributionHtml(data && data.distribution, cnt);
            if (cardEl) {
                cardEl.classList.remove('hidden');
                cardEl.setAttribute('aria-hidden', 'false');
            }
        }

        function resetRatingSummaryCardLoading(ids) {
            updateRatingSummaryCard(ids, { average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
            const countEl = document.getElementById(ids.count);
            if (countEl) countEl.textContent = isRTL ? 'جاري التحميل…' : 'Loading…';
            const cardEl = ids.card ? document.getElementById(ids.card) : null;
            if (cardEl) {
                cardEl.classList.remove('hidden');
                cardEl.setAttribute('aria-hidden', 'false');
            }
        }

        function updateProductRatingSummaryCard(data) {
            updateRatingSummaryCard(ADORA_PRODUCT_RATING_SUMMARY_IDS, data);
        }

        function resetProductRatingSummaryCardLoading() {
            resetRatingSummaryCardLoading(ADORA_PRODUCT_RATING_SUMMARY_IDS);
        }

        function updateMarketplaceRatingSummaryCard(data) {
            updateRatingSummaryCard(MARKETPLACE_PRODUCT_RATING_SUMMARY_IDS, data);
        }

        function resetMarketplaceRatingSummaryCardLoading() {
            resetRatingSummaryCardLoading(MARKETPLACE_PRODUCT_RATING_SUMMARY_IDS);
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
            return `<div class="adora-review-user-card rounded-2xl p-4">
                <div class="flex justify-between items-start mb-2 gap-2">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="adora-review-avatar w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">${escapeHtml(initials)}</div>
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
            document.getElementById('product-detail-rating-row')?.classList.add('hidden');
            if (listEl) {
                listEl.innerHTML = `<p class="text-sm text-gray-500 py-2">${isRTL ? 'جاري التحميل…' : 'Loading…'}</p>`;
            }
            resetProductRatingSummaryCardLoading();
            try {
                const data = await apiFetch(`/api/products/${productId}/reviews`, { requireAuth: false });
                if (currentScreen !== 'screen-product' || !currentProductDetail || Number(currentProductDetail.id) !== Number(productId)) {
                    return;
                }
                const count = Number(data.count || 0);
                updateProductRatingSummaryCard(data);
                updateProductDetailInlineRating(data);
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
                updateRatingSummaryCard(ADORA_PRODUCT_RATING_SUMMARY_IDS, {
                    average: null,
                    count: 0,
                    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
                });
                updateProductDetailInlineRating({ average: null, count: 0 });
                const countEl = document.getElementById(ADORA_PRODUCT_RATING_SUMMARY_IDS.count);
                if (countEl) countEl.textContent = isRTL ? 'تعذر تحميل ملخص التقييم' : 'Could not load rating summary';
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
            const lb = document.getElementById('adora-image-lightbox');
            if (lb && !lb.classList.contains('hidden')) {
                closeAdoraImageLightboxIfOpen();
                return;
            }
            stopGalleryAutoScroll('product-gallery');
            const popped = adoraPopIfTopIs('screen-product');
            if (popped) {
                adoraAfterPopNavigate(popped.prev, popped.leaving);
                return;
            }
            const back = productDetailBackScreen || 'screen-categories';
            adoraNavStack = adoraNavStack.filter((s) => s !== 'screen-product');
            if (back === 'screen-categories') {
                adoraNavStack = ['screen-categories'];
            } else if (!adoraNavStack.length || adoraNavStack[adoraNavStack.length - 1] !== back) {
                adoraNavStack = ['screen-categories', back];
            }
            navigateTo(back, { skipHistory: true });
            adoraSyncHistoryToScreen(back);
            persistAdoraSessionState();
        }
        window.backFromProductDetail = backFromProductDetail;

        function captureProductDeepLinkFromUrl() {
            try {
                const u = new URL(window.location.href);
                const p = u.searchParams.get('p') || u.searchParams.get('product');
                if (p && /^\d+$/.test(String(p).trim())) {
                    sessionStorage.setItem('adora_deeplink_product', String(p).trim());
                }
                const mp = u.searchParams.get('mp');
                if (mp && /^\d+$/.test(String(mp).trim())) {
                    sessionStorage.setItem('adora_deeplink_mp_product', String(mp).trim());
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

        function stripMpQueryFromUrl() {
            try {
                const u = new URL(window.location.href);
                if (!u.searchParams.has('mp')) return;
                u.searchParams.delete('mp');
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

        function consumeMarketplaceDeepLink() {
            try {
                const raw = sessionStorage.getItem('adora_deeplink_mp_product');
                if (!raw || !/^\d+$/.test(raw)) return;
                const id = Number(raw);
                sessionStorage.removeItem('adora_deeplink_mp_product');
                stripMpQueryFromUrl();
                setTimeout(() => {
                    openMarketplaceProductDetail(id).catch(() => {});
                }, 400);
            } catch (_e) {}
        }

        function getProductShareUrl() {
            if (currentScreen === 'screen-marketplace-product' && currentMarketplaceProductDetail && currentMarketplaceProductDetail.id) {
                const mid = currentMarketplaceProductDetail.id;
                try {
                    const u = new URL(window.location.href);
                    u.searchParams.set('mp', String(mid));
                    u.searchParams.delete('p');
                    u.searchParams.delete('product');
                    u.hash = '';
                    return u.toString();
                } catch (_e) {
                    return `${window.location.origin}${window.location.pathname}?mp=${encodeURIComponent(String(mid))}`;
                }
            }
            const id = currentProductDetail?.id;
            if (!id) return String(window.location.href || '').split('#')[0];
            try {
                const u = new URL(window.location.href);
                u.searchParams.set('p', String(id));
                u.searchParams.delete('mp');
                u.hash = '';
                return u.toString();
            } catch (_e) {
                return `${window.location.origin}${window.location.pathname}?p=${encodeURIComponent(String(id))}`;
            }
        }

        function getProductShareMessage() {
            if (currentScreen === 'screen-marketplace-product' && currentMarketplaceProductDetail) {
                const p = currentMarketplaceProductDetail;
                const title = isRTL ? (p.name_ar || p.name_en || '') : (p.name_en || p.name_ar || '');
                return String(title).trim();
            }
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
            if (currentScreen === 'screen-marketplace-product') {
                if (!currentMarketplaceProductDetail || !currentMarketplaceProductDetail.id) {
                    showToast(isRTL ? 'افتح منتجاً أولاً' : 'Open a product first');
                    return;
                }
            } else if (!currentProductDetail || !currentProductDetail.id) {
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
            const mpTop = Array.isArray(mpAppHomePlacements?.top_brands_strip)
                ? mpAppHomePlacements.top_brands_strip.filter((x) => x && x.kind === 'mp_vendor')
                : [];
            const mpTopVendorBlockHtml = (v) => {
                const name = String((isRTL ? v.name_ar || v.name_en : v.name_en || v.name_ar) || '').trim();
                if (!name) return '';
                const logo = v.logo_url ? String(v.logo_url).trim() : '';
                const chip = isRTL ? 'السوق الشامل' : 'Marketplace';
                const premStar =
                    Number(v.is_premium_active) === 1
                        ? `<span class="mp-vendor-premium-star" title="${isRTL ? 'شركة مميزة' : 'Featured company'}" aria-hidden="true">★</span>`
                        : '';
                return `                        <div class="top-brand-slot">
                            <button type="button" class="top-brand-minimal-btn mp-top-vendor-card" data-mp-vendor-id="${Number(v.id)}">
                                <span class="top-brand-minimal-logo">
                                    ${premStar}
                                    ${
                                        logo
                                            ? `<img src="${escapeHtml(logo)}" class="top-brand-minimal-logo-img" alt="">`
                                            : `<span class="text-3xl font-bold text-emerald-600">${escapeHtml(name.charAt(0))}</span>`
                                    }
                                </span>
                                <span class="top-brand-minimal-name" dir="auto">${escapeHtml(name)}</span>
                            </button>
                            <div class="top-brand-slot-meta"><span class="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-200/60 text-emerald-800">${escapeHtml(chip)}</span></div>
                        </div>`;
            };
            const mpBlock = mpTop.map(mpTopVendorBlockHtml).filter(Boolean).join('');
            const seenTopIds = new Set(mpTop.map((x) => Number(x.id)).filter((n) => Number.isFinite(n)));
            const extraTop = (Array.isArray(mpVendorsDirectoryCache) ? mpVendorsDirectoryCache : [])
                .filter(
                    (v) =>
                        Number(v.show_in_app_top_brands_section) === 1 &&
                        Number.isFinite(Number(v.id)) &&
                        !seenTopIds.has(Number(v.id))
                )
                .sort((a, b) => (Number(a.sort_order) - Number(b.sort_order)) || Number(a.id) - Number(b.id));
            const mpBlockExtra = extraTop.map(mpTopVendorBlockHtml).filter(Boolean).join('');
            const tops = apiBrandsList.filter((b) => Number(b.is_top_brand));
            const catBlock = tops.length
                ? tops
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
                          return `                        <div class="top-brand-slot">
                            <button type="button" class="top-brand-minimal-btn" data-brand-name="${nameEnc}">
                                <span class="top-brand-minimal-logo">
                                    ${
                                        b.logo
                                            ? `<img src="${escapeHtml(b.logo)}" class="top-brand-minimal-logo-img" alt="">`
                                            : `<span class="text-3xl font-bold text-purple-600">${escapeHtml(String(b.name || '').charAt(0))}</span>`
                                    }
                                </span>
                                <span class="top-brand-minimal-name">${escapeHtml(b.name)}</span>
                            </button>
                            <div class="top-brand-slot-meta">${chips}</div>
                        </div>`;
                      })
                      .join('')
                : '';
            if (mpBlock || mpBlockExtra || catBlock) {
                container.innerHTML = mpBlock + mpBlockExtra + catBlock;
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
                const imgSrc = item.image ? escapeHtml(item.image) : escapeHtml(adoraPlaceholderImageUrl());
                const safeTitle = escapeHtml(String(title || ''));
                const br = item.brand ? String(item.brand).trim() : '';
                const vendorHtml = br ? `<p class="adora-pcard__vendor" dir="auto">${escapeHtml(br)}</p>` : '';
                const isMp = item.isMp === true && item.mpId != null && Number.isFinite(Number(item.mpId));
                const pid = isMp ? Number(item.mpId) : Number(item.id);
                const wlNs = isMp ? 'mp' : 'p';
                const openFn = isMp ? `openMarketplaceProductDetail(${pid})` : `openProductDetail(${pid})`;
                const inWish = isWishlistEntry(wlNs, pid);
                const canCart = isMp ? Number(item.stock || 0) > 0 : !!item.canCart;
                const listP = Number(item.old || 0);
                const saleP = Number(item.now || 0);
                const disc =
                    listP > 0 && saleP < listP ? Math.min(99, Math.max(1, Math.round((1 - saleP / listP) * 100))) : 0;
                const wishActive = inWish ? ' active' : '';
                const addDis = canCart ? '' : ' disabled';
                const addOn = canCart
                    ? isMp
                        ? `onclick="event.stopPropagation(); quickAddMarketplaceProductToCart(${pid},event)"`
                        : `onclick="event.stopPropagation(); quickAddCatalogProductToCart(${pid},event)"`
                    : `onclick="event.stopPropagation()"`;
                const revStub = { review_avg: item.review_avg, review_count: item.review_count };
                const ratingHtml = `<div class="adora-pcard__rating-row">${adoraPcardRatingHtml(revStub)}</div>`;
                const priceHtml = adoraPcardPriceRowHtml({ disc, listP, saleP });
                const endsSoon = isRTL ? 'ينتهي قريباً' : 'Ends soon';
                return `<div class="adora-pcard adora-pcard--strip adora-pcard--flash product-card text-start">
                            <div role="button" tabindex="0" class="adora-pcard__hit cursor-pointer" onclick="${openFn}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${openFn};}">
                            <div class="adora-pcard__top">
                            <div class="adora-pcard__media">
                            <div class="adora-pcard__media-inner">
                                <img src="${imgSrc}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                            </div>
                            <button type="button" class="adora-pcard__wish wishlist-btn${wishActive}" aria-label="Wishlist" onclick="event.stopPropagation(); wishlistCardToggle(event,'${wlNs}',${pid},this)">${adoraPcardWishIconsHtml()}</button>
                            <button type="button" class="adora-pcard__add"${addDis} aria-label="Add to cart" ${addOn}>+</button>
                            </div>
                            </div>
                            <div class="adora-pcard__body">
                                <p class="text-[10px] font-semibold text-violet-600/90 mb-0.5" data-en="Ends soon" data-ar="ينتهي قريباً">${endsSoon}</p>
                                <span class="inline-flex text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 mb-1">${escapeHtml(String(item.discount || ''))}</span>
                                <h3 class="adora-pcard__title">${safeTitle}</h3>
                                ${vendorHtml}
                                ${ratingHtml}
                                ${priceHtml}
                            </div>
                            </div>
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
            grid.className = 'home-product-strip';
            grid.innerHTML = adoraSkeletonHomeStripHtml(6);
            try {
                await ensureMpAppHomePlacements();
                const products = await apiFetch('/api/products?featured=1&adora_only=1', { requireAuth: false });
                const list = Array.isArray(products) ? products : [];
                const merged = mergeHomeGridHtmlFromSlot('curated', list, 28);
                if (!merged) {
                    grid.className = '';
                    grid.innerHTML = `<p class="text-center text-gray-500 text-sm py-8 leading-relaxed px-3 w-[min(100%,22rem)]">${
                        isRTL ? 'لا توجد منتجات مميزة لعرضها حالياً.' : 'No featured picks to show yet.'
                    }</p>`;
                    return;
                }
                grid.className = 'home-product-strip';
                grid.innerHTML = merged;
            } catch (_e) {
                grid.className = '';
                grid.innerHTML = `<p class="text-center text-red-500 text-sm py-6 px-3 w-[min(100%,22rem)]">${isRTL ? 'تعذر التحميل' : 'Load failed'}</p>`;
            }
        }

        async function loadHomeNewCollectionGrid() {
            const grid = document.getElementById('home-new-collection-grid');
            if (!grid) return;
            grid.className = 'home-product-strip';
            grid.innerHTML = adoraSkeletonHomeStripHtml(6);
            try {
                await ensureMpAppHomePlacements();
                const products = await apiFetch('/api/products?new_collection=1', { requireAuth: false });
                const list = Array.isArray(products) ? products : [];
                const merged = mergeHomeGridHtmlFromSlot('promo_collection', list, 36);
                if (!merged) {
                    grid.className = '';
                    grid.innerHTML = `<p class="text-center text-white/85 text-xs py-4 leading-relaxed px-3 w-[min(100vw-2rem,22rem)]">${
                        isRTL ? 'فعّل «الظهور في البانر» من إعدادات المنتج في لوحة التحكم.' : 'Enable the banner & list option on products in the admin panel.'
                    }</p>`;
                    return;
                }
                grid.className = 'home-product-strip';
                grid.innerHTML = merged;
            } catch (_e) {
                grid.className = '';
                grid.innerHTML = `<p class="text-center text-red-200 text-xs py-4 px-3 w-[min(100vw-2rem,22rem)]">${isRTL ? 'تعذر التحميل' : 'Load failed'}</p>`;
            }
        }

        async function loadHomeMpPremiumVendors() {
            const scroll = document.getElementById('home-mp-premium-vendors-scroll');
            const section = document.getElementById('home-mp-premium-vendors-section');
            if (!scroll || !section) return;
            const vis = mergeHomeSectionsVisibility(cachedHomeSectionsVisibility);
            if (vis.mp_premium_vendors === false) {
                section.classList.add('hidden');
                return;
            }
            scroll.innerHTML = `<p class="text-xs text-gray-400 py-3 w-full text-center">${isRTL ? 'جاري التحميل…' : 'Loading…'}</p>`;
            try {
                const rows = await apiFetch('/api/marketplace/home/featured-vendors', { requireAuth: false });
                const list = Array.isArray(rows) ? rows : [];
                if (!list.length) {
                    scroll.innerHTML = '';
                    section.classList.add('hidden');
                    return;
                }
                section.classList.remove('hidden');
                const loc = isRTL ? 'ar' : 'en';
                scroll.innerHTML = list
                    .map((v) => {
                        const name = String(loc === 'ar' ? v.name_ar || v.name_en : v.name_en || v.name_ar || '').trim();
                        const vid = Number(v.id);
                        if (!Number.isFinite(vid)) return '';
                        const logoRaw = v.logo_url ? String(v.logo_url).trim() : '';
                        const star =
                            '<span class="mp-vendor-premium-star" aria-hidden="true">★</span>';
                        const logo = logoRaw
                            ? `<span class="home-mp-premium-vendor-logo">${star}<img src="${escapeHtml(absoluteMediaUrl(logoRaw))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
                            : `<span class="home-mp-premium-vendor-logo">${star}<span class="text-amber-800 font-bold text-3xl">${escapeHtml((name || '?').charAt(0))}</span></span>`;
                        return `<button type="button" class="flex flex-col items-center gap-2 shrink-0 min-w-[7.75rem] sm:min-w-[8rem] active:scale-95 transition-transform" onclick="openMarketplaceBrowse({ vendor_id: ${vid} })">
                        <div class="flex items-center justify-center">${logo}</div>
                        <span class="text-sm font-extrabold text-gray-800 text-center leading-snug line-clamp-2 max-w-[8.25rem]" dir="auto">${escapeHtml(name || '—')}</span>
                        </button>`;
                    })
                    .join('');
            } catch (_e) {
                scroll.innerHTML = '';
                section.classList.add('hidden');
            }
        }

        async function loadHomeMpFeaturedMarketplaceProducts() {
            const grid = document.getElementById('home-mp-featured-products-grid');
            const section = document.getElementById('home-mp-featured-products-section');
            if (!grid || !section) return;
            const vis = mergeHomeSectionsVisibility(cachedHomeSectionsVisibility);
            if (vis.mp_featured_marketplace_products === false) {
                section.classList.add('hidden');
                return;
            }
            grid.className = 'home-product-strip';
            grid.innerHTML = adoraSkeletonHomeStripHtml(6);
            try {
                const rows = await apiFetch('/api/marketplace/home/featured-products', { requireAuth: false });
                const list = Array.isArray(rows) ? rows : [];
                if (!list.length) {
                    grid.innerHTML = '';
                    section.classList.add('hidden');
                    return;
                }
                section.classList.remove('hidden');
                grid.innerHTML = list.map((p) => renderMpProductCardHomeCompact(p)).join('');
            } catch (_e) {
                grid.innerHTML = '';
                section.classList.add('hidden');
            }
        }

        async function loadHomeBestsellers() {
            const el = document.getElementById('home-bestsellers-scroll');
            if (!el) return;
            if (partnerCtaConfig && Number(partnerCtaConfig.bestsellers_boost_enabled) === 0) {
                el.innerHTML = '';
                return;
            }
            try {
                await ensureMpAppHomePlacements();
                const slot = mpAppHomePlacements && mpAppHomePlacements.bestsellers;
                const mpList = Array.isArray(slot) ? slot.filter((x) => x && x.kind === 'mp_product') : [];
                const rows = await apiFetch('/api/bestsellers?limit=14', { requireAuth: false });
                const catList = Array.isArray(rows) ? rows : [];
                const maxN = 14;
                const seenMp = new Set();
                const pieces = [];
                for (const p of mpList) {
                    if (pieces.length >= maxN) break;
                    const id = Number(p.id);
                    if (!Number.isFinite(id) || seenMp.has(id)) continue;
                    seenMp.add(id);
                    const imgRaw = p.images && p.images.length ? p.images[0] : '';
                    const img = imgRaw ? absoluteMediaUrl(String(imgRaw)) : adoraPlaceholderImageUrl();
                    const name = isRTL ? p.name_ar : p.name_en;
                    const vn = mpHomeVendorLabel(p);
                    const vendorHtml = vn ? `<p class="adora-pcard__vendor" dir="auto">${escapeHtml(vn)}</p>` : '';
                    const listP = Number(p.price ?? 0);
                    const disc = Math.min(100, Math.max(0, Number(p.discount_percent ?? 0)));
                    const saleP = disc > 0 && disc < 100 ? listP * (1 - disc / 100) : listP;
                    const inWish = isWishlistEntry('mp', id);
                    const canCart = Number(p.stock || 0) > 0;
                    const wishActive = inWish ? ' active' : '';
                    const addDis = canCart ? '' : ' disabled';
                    const addClk = canCart ? `onclick="event.stopPropagation(); quickAddMarketplaceProductToCart(${id},event)"` : `onclick="event.stopPropagation()"`;
                    const ratingHtml = `<div class="adora-pcard__rating-row">${adoraPcardRatingHtml(p)}</div>`;
                    const priceHtml = adoraPcardPriceRowHtml({ disc, listP, saleP });
                    pieces.push(`<div class="home-bestseller-card adora-pcv flex-shrink-0">
                        <div class="adora-pcard adora-pcard--mini product-card">
                        <div role="button" tabindex="0" class="adora-pcard__hit cursor-pointer text-start" onclick="openMarketplaceProductDetail(${id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMarketplaceProductDetail(${id});}">
                        <div class="adora-pcard__top">
                        <div class="adora-pcard__media">
                        <div class="adora-pcard__media-inner">
                            <img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                        </div>
                        <button type="button" class="adora-pcard__wish wishlist-btn${wishActive}" aria-label="Wishlist" onclick="event.stopPropagation(); wishlistCardToggle(event,'mp',${id},this)">${adoraPcardWishIconsHtml()}</button>
                        <button type="button" class="adora-pcard__add"${addDis} aria-label="Add to cart" ${addClk}>+</button>
                        </div>
                        </div>
                        <div class="adora-pcard__body">
                            <h3 class="adora-pcard__title">${escapeHtml(name)}</h3>
                            ${vendorHtml}
                            ${ratingHtml}
                            ${priceHtml}
                        </div>
                        </div>
                        </div>
                    </div>`);
                }
                for (const p of catList) {
                    if (pieces.length >= maxN) break;
                    const img = p.images && p.images.length ? p.images[0] : adoraPlaceholderImageUrl();
                    const name = isRTL ? p.name_ar : p.name_en;
                    const br = resolveDisplayBrand(p.brand);
                    const vendorHtml = br ? `<p class="adora-pcard__vendor" dir="auto">${escapeHtml(br)}</p>` : '';
                    const listP = productListPrice(p);
                    const disc = productDiscountPct(p);
                    const saleP = productSaleUnitPrice(p);
                    const pid = Number(p.id);
                    const inWish = isWishlistEntry('p', pid);
                    const canCart = productHasAnyStockQuick(p);
                    const wishActive = inWish ? ' active' : '';
                    const addDis = canCart ? '' : ' disabled';
                    const addClk = canCart ? `onclick="event.stopPropagation(); quickAddCatalogProductToCart(${pid},event)"` : `onclick="event.stopPropagation()"`;
                    const ratingHtml = `<div class="adora-pcard__rating-row">${adoraPcardRatingHtml(p)}</div>`;
                    const priceHtml = adoraPcardPriceRowHtml({ disc, listP, saleP });
                    pieces.push(`<div class="home-bestseller-card adora-pcv flex-shrink-0">
                        <div class="adora-pcard adora-pcard--mini product-card">
                        <div role="button" tabindex="0" class="adora-pcard__hit cursor-pointer text-start" onclick="openProductDetail(${pid})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProductDetail(${pid});}">
                        <div class="adora-pcard__top">
                        <div class="adora-pcard__media">
                        <div class="adora-pcard__media-inner">
                            <img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                        </div>
                        <button type="button" class="adora-pcard__wish wishlist-btn${wishActive}" aria-label="Wishlist" onclick="event.stopPropagation(); wishlistCardToggle(event,'p',${pid},this)">${adoraPcardWishIconsHtml()}</button>
                        <button type="button" class="adora-pcard__add"${addDis} aria-label="Add to cart" ${addClk}>+</button>
                        </div>
                        </div>
                        <div class="adora-pcard__body">
                            <h3 class="adora-pcard__title">${escapeHtml(name)}</h3>
                            ${vendorHtml}
                            ${ratingHtml}
                            ${priceHtml}
                        </div>
                        </div>
                        </div>
                    </div>`);
                }
                if (!pieces.length) {
                    el.innerHTML = `<p class="text-sm text-gray-500 py-6 px-2">${
                        isRTL ? 'لا مبيعات بعد — تظهر هنا بعد أول طلبات.' : 'No sales yet — appears after orders.'
                    }</p>`;
                    return;
                }
                el.innerHTML = pieces.join('');
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
            const allCustomerNote =
                banners.length > 0 &&
                banners.every(
                    (b) =>
                        String(b.banner_kind || 'standard')
                            .toLowerCase()
                            .replace(/-/g, '_') === 'customer_note'
                );
            const sliderH = allCustomerNote ? 132 : 200;
            const feedbackPillMin = allCustomerNote ? 'min-h-[88px]' : 'min-h-[120px]';
            const slidesHtml = banners
                .map((b, slideIdx) => {
                    const title = isRTL ? b.title_ar || b.title_en : b.title_en || b.title_ar;
                    const bodyTxt = isRTL ? b.body_ar || b.body_en : b.body_en || b.body_ar;
                    const rawUrl = b.image_url != null ? String(b.image_url).trim() : '';
                    const imgAbs = rawUrl ? absoluteMediaUrl(rawUrl) : '';
                    const hasImg = !!rawUrl;
                    const bid = Number(b.id);
                    const isFeedback =
                        String(b.banner_kind || 'standard')
                            .toLowerCase()
                            .replace(/-/g, '_') === 'customer_note' && Number.isFinite(bid);
                    const linkRaw = b.link_url != null ? String(b.link_url).trim() : '';
                    const linkHref =
                        linkRaw && (linkRaw.startsWith('http://') || linkRaw.startsWith('https://') || linkRaw.startsWith('mailto:') || linkRaw.startsWith('tel:'))
                            ? linkRaw
                            : linkRaw
                              ? absoluteMediaUrl(linkRaw)
                              : '';
                    const linkLine =
                        !isFeedback && linkHref
                            ? `<a href="${escapeHtml(linkHref)}" target="_blank" rel="noopener noreferrer" class="inline-block mt-1 text-[11px] font-semibold text-white underline underline-offset-2">${isRTL ? 'افتح الرابط' : 'Open link'}</a>`
                            : '';
                    if (hasImg && isFeedback) {
                        const imgLoading = slideIdx < 3 ? 'eager' : 'lazy';
                        const ariaN = isRTL ? 'أرسل ملاحظة للفريق' : 'Send a note to the team';
                        const gradPad = allCustomerNote ? 'pt-6 pb-2' : 'pt-10 pb-2.5';
                        const tTitle = allCustomerNote ? 'text-[12px]' : 'text-[13px]';
                        const tBody = allCustomerNote ? 'text-[10px]' : 'text-[11px]';
                        return `<div class="adora-banner-slide relative shrink-0 overflow-hidden bg-gray-200 snap-start snap-always" style="height:${sliderH}px">
  <button type="button" class="absolute inset-0 z-[2] cursor-pointer bg-transparent border-0 p-0" style="-webkit-tap-highlight-color:transparent" onclick="openCustomerFeedbackBannerModal(${bid})" aria-label="${escapeHtml(ariaN)}"></button>
  <img src="${escapeHtml(imgAbs)}" alt="" class="absolute inset-0 z-0 h-full w-full object-cover pointer-events-none" style="object-position:center center" width="1200" height="400" loading="${imgLoading}" decoding="async" fetchpriority="${slideIdx === 0 ? 'high' : 'auto'}" referrerpolicy="no-referrer" data-adora-banner-img="1" />
  <div class="absolute inset-x-0 bottom-0 z-[1] px-3 ${gradPad} bg-gradient-to-t from-black/70 via-black/35 to-transparent pointer-events-none">
    ${title ? `<p class="${tTitle} font-bold leading-tight text-white drop-shadow-sm line-clamp-1">${escapeHtml(title)}</p>` : ''}
    ${bodyTxt ? `<p class="mt-0.5 ${tBody} leading-snug text-white/95 line-clamp-2">${escapeHtml(bodyTxt)}</p>` : ''}
  </div>
</div>`;
                    }
                    if (!hasImg && isFeedback) {
                        const gap = allCustomerNote ? 'gap-2' : 'gap-2.5';
                        const iconBox = allCustomerNote ? 'h-9 w-9 rounded-lg' : 'h-10 w-10 rounded-xl';
                        const iconI = allCustomerNote ? 'text-base' : 'text-lg';
                        const ch = allCustomerNote ? 'text-xs' : 'text-sm';
                        const titSz = allCustomerNote ? 'text-xs' : 'text-sm';
                        const bodySz = allCustomerNote ? 'text-[10px]' : 'text-xs';
                        return `<div class="adora-banner-slide relative flex shrink-0 items-center justify-center overflow-hidden snap-start snap-always bg-slate-50 px-2" style="height:${sliderH}px">
<button type="button" class="partner-cta-pill partner-cta-pill--customer-note flex w-full max-w-lg items-center ${gap} py-2 ${feedbackPillMin}" onclick="openCustomerFeedbackBannerModal(${bid})">
  <span class="adora-cta-pill-chevron adora-cta-pill-chevron--lead text-slate-500" aria-hidden="true"><i class="fas fa-chevron-right ${ch} opacity-90 rtl:rotate-180"></i></span>
  <span class="flex ${iconBox} shrink-0 items-center justify-center bg-slate-200/90 text-slate-600"><i class="fas fa-message ${iconI}" aria-hidden="true"></i></span>
  <span class="min-w-0 flex-1 text-start">
    ${title ? `<span class="block ${titSz} font-extrabold leading-tight text-slate-800">${escapeHtml(title)}</span>` : ''}
    ${bodyTxt ? `<span class="mt-0.5 block ${bodySz} font-medium leading-snug text-slate-500">${escapeHtml(bodyTxt)}</span>` : ''}
  </span>
  <span class="adora-cta-pill-chevron text-slate-500" aria-hidden="true"><i class="fas fa-chevron-left ${ch} opacity-90 rtl:rotate-180"></i></span>
</button>
</div>`;
                    }
                    if (hasImg) {
                        const imgLoading = slideIdx < 3 ? 'eager' : 'lazy';
                        return `<div class="adora-banner-slide relative shrink-0 overflow-hidden bg-gray-200 snap-start snap-always" style="height:${sliderH}px">
  <img src="${escapeHtml(imgAbs)}" alt="" class="absolute inset-0 z-0 h-full w-full object-cover" style="object-position:center center" width="1200" height="400" loading="${imgLoading}" decoding="async" fetchpriority="${slideIdx === 0 ? 'high' : 'auto'}" referrerpolicy="no-referrer" data-adora-banner-img="1" />
  <div class="absolute inset-x-0 bottom-0 z-[1] px-3 pb-2.5 pt-10 bg-gradient-to-t from-black/70 via-black/35 to-transparent">
    ${title ? `<p class="text-[13px] font-bold leading-tight text-white drop-shadow-sm line-clamp-1">${escapeHtml(title)}</p>` : ''}
    ${bodyTxt ? `<p class="mt-0.5 text-[11px] leading-snug text-white/95 line-clamp-2">${escapeHtml(bodyTxt)}</p>` : ''}
    ${linkLine}
  </div>
</div>`;
                    }
                    return `<div class="adora-banner-slide relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-purple-600 to-pink-600 px-4 text-center snap-start snap-always" style="height:${sliderH}px">
  <div class="max-w-full">
    ${title ? `<p class="text-[14px] font-bold text-white drop-shadow">${escapeHtml(title)}</p>` : ''}
    ${bodyTxt ? `<p class="mt-1 text-[12px] leading-snug text-white/95 line-clamp-3">${escapeHtml(bodyTxt)}</p>` : ''}
    ${linkLine}
  </div>
</div>`;
                })
                .join('');
            host.innerHTML = `<div dir="ltr" class="adora-banner-slider-viewport adora-banner-scroll relative w-full shadow-md snap-x snap-mandatory" style="height:${sliderH}px;border-radius:16px">
  <div class="adora-banner-slider-track flex flex-row flex-nowrap" style="height:${sliderH}px">
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
                listingtop: 'listing_top',
                offerstop: 'offers_top',
                wishlisttop: 'wishlist_top',
                marketplacetop: 'marketplace_top',
                producttop: 'product_top',
                mpproducttop: 'mp_product_top',
                carttop: 'cart_top',
                checkouttop: 'checkout_top',
                profiletop: 'profile_top',
                ordertrackingtop: 'order_tracking_top',
                vendorjointop: 'vendor_join_top',
                appadinquirytop: 'app_ad_inquiry_top',
                categoriestop: 'categories_top',
                featuredhubtop: 'featured_hub_top',
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
                Object.keys(byPl).forEach((pl) => {
                    byPl[pl].sort((a, b) => {
                        const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
                        if (so !== 0) return so;
                        return (Number(a.id) || 0) - (Number(b.id) || 0);
                    });
                });
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
                await ensureMpAppHomePlacements();
                const mpSlot = mpAppHomePlacements && mpAppHomePlacements.flash_sale;
                const mpProds = Array.isArray(mpSlot) ? mpSlot.filter((x) => x && x.kind === 'mp_product') : [];
                const mpMapped = [];
                for (const p of mpProds) {
                    if (mpMapped.length >= 4) break;
                    const discountPercent = Math.min(100, Math.max(0, Number(p.discount_percent ?? 0)));
                    const listPrice = Number(p.price || 0);
                    let nowPrice = listPrice;
                    let oldPrice = listPrice;
                    if (discountPercent > 0 && discountPercent < 100) {
                        nowPrice = listPrice * (1 - discountPercent / 100);
                        oldPrice = listPrice;
                    }
                    const rawImg = p.images && p.images.length ? p.images[0] : '';
                    const mpId = Number(p.id);
                    mpMapped.push({
                        isMp: true,
                        mpId,
                        id: mpId,
                        image: rawImg ? absoluteMediaUrl(String(rawImg)) : '',
                        name: { en: p.name_en, ar: p.name_ar },
                        brand: mpHomeVendorLabel(p) || '',
                        old: oldPrice,
                        now: nowPrice,
                        discount: `${discountPercent}% OFF`,
                        stock: Number(p.stock ?? 0),
                        review_avg: p.review_avg != null ? p.review_avg : null,
                        review_count: p.review_count != null ? Number(p.review_count) : 0,
                    });
                }

                const products = await apiFetch('/api/products?flash=1', { requireAuth: false });
                const catArr = Array.isArray(products) ? products : [];

                if (catArr.length) {
                    const first = catArr[0];
                    if (first.flash_sale_end_time) {
                        const end = new Date(first.flash_sale_end_time).getTime();
                        const now = Date.now();
                        const diffSeconds = Math.floor((end - now) / 1000);
                        if (!isNaN(diffSeconds) && diffSeconds > 0) {
                            flashSaleRemaining = diffSeconds;
                        }
                    }
                }

                const catMapped = catArr.slice(0, Math.max(0, 4 - mpMapped.length)).map((p) => {
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
                        isMp: false,
                        id: Number(p.id),
                        image: rawImg ? absoluteMediaUrl(rawImg) : '',
                        name: { en: p.name_en, ar: p.name_ar },
                        brand: resolveDisplayBrand(p.brand),
                        old: oldPrice,
                        now: nowPrice,
                        discount: `${discountPercent}% OFF`,
                        canCart: productHasAnyStockQuick(p),
                        review_avg: p.review_avg != null ? p.review_avg : null,
                        review_count: p.review_count != null ? Number(p.review_count) : 0,
                    };
                });

                const combined = [...mpMapped, ...catMapped];
                if (!combined.length) {
                    flashSaleItems.splice(0, flashSaleItems.length);
                    return;
                }
                flashSaleItems.splice(0, flashSaleItems.length, ...combined.slice(0, 4));
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
                document.getElementById('side-menu-notif-block')?.classList.add('hidden');
                document.getElementById('side-menu-notifications-btn')?.classList.add('hidden');
                document.getElementById('side-menu-vendor-sub-btn')?.classList.add('hidden');
                return;
            }
            guestActions?.classList.add('hidden');
            userBadge?.classList.remove('hidden');
            logoutBtn?.classList.remove('hidden');
            document.getElementById('side-menu-notif-block')?.classList.remove('hidden');
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
            await refreshVendorSubscriptionSideMenu();
        }

        function vendorSubStatusLabel(status) {
            const ar = isRTL;
            const m = {
                pending: ar ? 'قيد المراجعة' : 'Under review',
                approved: ar ? 'تمت الموافقة' : 'Approved',
                rejected: ar ? 'مرفوض' : 'Rejected',
                incomplete: ar ? 'ناقص' : 'Incomplete',
            };
            return m[String(status || '').trim()] || String(status || '—');
        }

        function appAdInquiryStatusLabel(status) {
            const ar = isRTL;
            const k = String(status || '').trim().toLowerCase();
            const m = {
                pending: ar ? 'قيد الانتظار' : 'Pending',
                reviewed: ar ? 'تمت المراجعة' : 'Reviewed',
                approved: ar ? 'تمت الموافقة على إعلانك' : 'Your ad was approved',
                archived: ar ? 'مؤرشف' : 'Archived',
            };
            return m[k] || String(status || '—');
        }

        function applyAppAdInquiryStatusBadge(el, status) {
            if (!el) return;
            el.textContent = appAdInquiryStatusLabel(status);
            const base = 'shrink-0 text-[10px] font-bold px-2 py-1 rounded-full max-w-[140px] truncate ';
            const s = String(status || '').trim().toLowerCase();
            if (s === 'approved') el.className = base + 'bg-emerald-100 text-emerald-800';
            else if (s === 'archived') el.className = base + 'bg-slate-100 text-slate-700';
            else if (s === 'reviewed') el.className = base + 'bg-sky-100 text-sky-800';
            else el.className = base + 'bg-amber-50 text-amber-900';
        }

        function applyVendorSubStatusBadge(el, status) {
            if (!el) return;
            el.textContent = vendorSubStatusLabel(status);
            const base = 'shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full max-w-[100px] truncate ';
            const s = String(status || '').trim();
            if (s === 'approved') el.className = base + 'bg-emerald-100 text-emerald-800';
            else if (s === 'rejected') el.className = base + 'bg-red-100 text-red-800';
            else if (s === 'incomplete') el.className = base + 'bg-amber-100 text-amber-800';
            else el.className = base + 'bg-slate-100 text-slate-700';
        }

        async function refreshVendorSubscriptionSideMenu() {
            const btn = document.getElementById('side-menu-vendor-sub-btn');
            if (!btn) return;
            if (!getStoredJwtToken()) {
                btn.classList.add('hidden');
                return;
            }
            btn.classList.remove('hidden');
            const detail = document.getElementById('side-menu-vendor-sub-detail');
            const badge = document.getElementById('side-menu-vendor-sub-badge');
            try {
                const rows = await apiFetch('/api/me/vendor-subscription-requests', { requireAuth: true });
                const list = Array.isArray(rows) ? rows : [];
                if (!list.length) {
                    if (detail) detail.textContent = isRTL ? 'لا يوجد طلب حتى الآن' : 'No request yet';
                    if (badge) {
                        badge.textContent = '—';
                        badge.className =
                            'shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 max-w-[100px] truncate';
                    }
                    return;
                }
                const latest = list[0];
                if (detail) detail.textContent = latest.company_name || '—';
                applyVendorSubStatusBadge(badge, latest.status);
            } catch (_e) {
                if (detail) detail.textContent = isRTL ? 'تعذر التحميل' : 'Could not load';
                if (badge) {
                    badge.textContent = '—';
                    badge.className =
                        'shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 max-w-[100px] truncate';
                }
            }
        }

        function renderVendorSubscriptionModalBody(container, rows) {
            if (!container) return;
            const list = Array.isArray(rows) ? rows : [];
            const ar = isRTL;
            if (!list.length) {
                container.innerHTML = `<p class="text-sm text-gray-500 text-center py-6">${ar ? 'لا توجد طلبات مرتبطة بحسابك.' : 'No subscription requests linked to your account.'}</p>`;
                return;
            }
            const escAttr = (u) =>
                String(u || '')
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;');
            container.innerHTML = list
                .map((r) => {
                    const st = vendorSubStatusLabel(r.status);
                    const msg =
                        r.admin_message && String(r.admin_message).trim()
                            ? `<p class="text-xs text-gray-600 mt-2 whitespace-pre-wrap">${String(r.admin_message)
                                  .replace(/</g, '&lt;')
                                  .replace(/>/g, '&gt;')}</p>`
                            : '';
                    const dt = r.updated_at || r.created_at || '';
                    const dstr = dt ? new Date(dt).toLocaleString(ar ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' }) : '';
                    const links = [];
                    if (r.id_front_url) {
                        links.push(
                            `<a href="${escAttr(r.id_front_url)}" target="_blank" rel="noopener noreferrer" class="text-purple-600 underline text-xs font-semibold">${ar ? 'وجه الهوية' : 'ID front'}</a>`
                        );
                    }
                    if (r.id_back_url) {
                        links.push(
                            `<a href="${escAttr(r.id_back_url)}" target="_blank" rel="noopener noreferrer" class="text-purple-600 underline text-xs font-semibold">${ar ? 'خلف الهوية' : 'ID back'}</a>`
                        );
                    }
                    if (r.commercial_register_url) {
                        links.push(
                            `<a href="${escAttr(r.commercial_register_url)}" target="_blank" rel="noopener noreferrer" class="text-purple-600 underline text-xs font-semibold">${ar ? 'السجل التجاري' : 'Commercial reg.'}</a>`
                        );
                    }
                    const docRow =
                        links.length > 0 ? `<div class="flex flex-wrap gap-3 mt-2">${links.join('')}</div>` : '';
                    return `<div class="rounded-2xl border border-gray-100 p-4 bg-gray-50/80">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-gray-900 truncate">${String(r.company_name || '—').replace(/</g, '&lt;')}</p>
                <p class="text-xs text-gray-500 mt-0.5">#${r.id}${dstr ? ` · ${dstr}` : ''}</p>
              </div>
              <span class="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-800">${st}</span>
            </div>
            ${docRow}
            ${msg}
          </div>`;
                })
                .join('');
        }

        async function sideMenuOpenVendorSubscriptionModal() {
            if (!getStoredJwtToken()) {
                closeSideDrawer(true);
                openAuthModal('login', isRTL ? 'سجّل الدخول لعرض طلب اشتراكك كشركة' : 'Log in to view your company subscription request');
                return;
            }
            closeSideDrawer(true);
            const modal = document.getElementById('vendor-subscription-modal');
            const body = document.getElementById('vendor-subscription-modal-body');
            if (!modal || !body) return;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            body.innerHTML = `<div class="py-2">${adoraSkeletonModalRowsHtml(5)}</div>`;
            try {
                const rows = await apiFetch('/api/me/vendor-subscription-requests', { requireAuth: true });
                renderVendorSubscriptionModalBody(body, rows);
            } catch (_e) {
                body.innerHTML = `<p class="text-sm text-red-600 text-center py-6">${isRTL ? 'تعذر التحميل.' : 'Could not load.'}</p>`;
            }
        }

        function closeVendorSubscriptionModal() {
            document.getElementById('vendor-subscription-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
        }

        function renderAppAdInquiriesModalBody(container, rows) {
            if (!container) return;
            const list = Array.isArray(rows) ? rows : [];
            const ar = isRTL;
            if (!list.length) {
                container.innerHTML = `<p class="text-sm text-gray-500 text-center py-6">${ar ? 'لا توجد طلبات إعلان مرتبطة بحسابك.' : 'No ad requests linked to your account.'}</p>`;
                return;
            }
            const escAttr = (u) =>
                String(u || '')
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;');
            container.innerHTML = list
                .map((r) => {
                    const st = appAdInquiryStatusLabel(r.status);
                    const msg =
                        r.admin_note && String(r.admin_note).trim()
                            ? `<p class="text-xs text-gray-600 mt-2 whitespace-pre-wrap">${String(r.admin_note)
                                  .replace(/</g, '&lt;')
                                  .replace(/>/g, '&gt;')}</p>`
                            : '';
                    const dt = r.updated_at || r.created_at || '';
                    const dstr = dt ? new Date(dt).toLocaleString(ar ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' }) : '';
                    const imgUrl = r.product_image_url ? String(r.product_image_url).trim() : '';
                    const imgLink = imgUrl
                        ? `<a href="${escAttr(imgUrl)}" target="_blank" rel="noopener noreferrer" class="text-fuchsia-600 underline text-xs font-semibold">${ar ? 'صورة المنتج' : 'Product image'}</a>`
                        : '';
                    const price = r.product_price ? String(r.product_price).replace(/</g, '&lt;') : '—';
                    const ddays = Number(r.ad_duration_days);
                    const secs = Number(r.ad_section_count);
                    const durLine =
                        Number.isFinite(ddays) && ddays > 0
                            ? `<p class="text-xs text-gray-600 mt-0.5">${ar ? 'أيام الظهور:' : 'Display days:'} ${ddays}</p>`
                            : '';
                    const secLine =
                        Number.isFinite(secs) && secs > 0
                            ? `<p class="text-xs text-gray-600 mt-0.5">${ar ? 'عدد الأقسام:' : 'Sections:'} ${secs}</p>`
                            : '';
                    return `<div class="rounded-2xl border border-gray-100 p-4 bg-gray-50/80">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-gray-900 truncate">${String(r.company_name || '—').replace(/</g, '&lt;')}</p>
                <p class="text-xs text-gray-500 mt-0.5">#${r.id}${dstr ? ` · ${dstr}` : ''}</p>
                ${durLine}${secLine}
                <p class="text-xs text-gray-600 mt-1">${ar ? 'السعر:' : 'Price:'} ${price}</p>
                ${imgLink ? `<div class="mt-1">${imgLink}</div>` : ''}
              </div>
              <span class="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-800 app-ad-inq-badge" data-app-ad-st="${String(r.status || '').replace(/"/g, '')}">${st}</span>
            </div>
            ${msg}
          </div>`;
                })
                .join('');
            container.querySelectorAll('.app-ad-inq-badge').forEach((el) => {
                const st = el.getAttribute('data-app-ad-st') || '';
                applyAppAdInquiryStatusBadge(el, st);
            });
        }

        async function sideMenuOpenAppAdInquiriesModal() {
            if (!getStoredJwtToken()) {
                closeSideDrawer(true);
                openAuthModal('login', isRTL ? 'سجّل الدخول لعرض طلبات الإعلان' : 'Log in to view your ad requests');
                return;
            }
            closeSideDrawer(true);
            const modal = document.getElementById('app-ad-inquiries-modal');
            const body = document.getElementById('app-ad-inquiries-modal-body');
            if (!modal || !body) return;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            body.innerHTML = `<div class="py-2">${adoraSkeletonModalRowsHtml(5)}</div>`;
            try {
                const rows = await apiFetch('/api/me/app-ad-inquiries', { requireAuth: true });
                renderAppAdInquiriesModalBody(body, rows);
            } catch (_e) {
                body.innerHTML = `<p class="text-sm text-red-600 text-center py-6">${isRTL ? 'تعذر التحميل.' : 'Could not load.'}</p>`;
            }
        }

        function closeAppAdInquiriesModal() {
            document.getElementById('app-ad-inquiries-modal')?.classList.add('hidden');
            restoreBodyScrollIfIdle();
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
                'checkout-system-confirm-modal',
                'checkout-card-soon-modal',
                'signup-credentials-modal',
                'notification-prompt-modal',
                'language-prompt-modal',
                'download-prompt-modal',
                'auth-gate-screen',
                'session-resume-overlay',
                'app-broadcasts-modal',
                'product-share-modal',
                'vendor-subscription-modal',
                'app-ad-inquiries-modal',
                'vendor-join-terms-modal',
                'vendor-join-plans-modal',
                'logout-farewell-modal',
                'adora-image-lightbox',
            ];
            const anyOpen = overlayIds.some((id) => {
                const el = document.getElementById(id);
                return el && !el.classList.contains('hidden');
            });
            if (!anyOpen) document.body.style.overflow = '';
        }

        /** إغلاق معاينة الصورة المكبّرة — من popstate لا يُعدّل history (سبق أن نزال الإدخال) */
        function closeAdoraImageLightboxIfOpen(opts) {
            const fromPopstate = opts && opts.fromPopstate === true;
            try {
                const overlay = document.getElementById('adora-image-lightbox');
                if (!overlay || overlay.classList.contains('hidden')) return;
                try {
                    const ae = document.activeElement;
                    if (ae && overlay.contains(ae)) ae.blur();
                } catch (_eBlur) {}
                try {
                    window.__adoraLightboxPanzoom?.destroy?.();
                } catch (_e) {}
                window.__adoraLightboxPanzoom = null;
                try {
                    window.__adoraLightboxUrls = [];
                    window.adoraLightboxStep = null;
                } catch (_eLb) {}
                document.getElementById('adora-lightbox-counter')?.classList.add('hidden');
                overlay.classList.add('hidden');
                overlay.setAttribute('aria-hidden', 'true');
                try {
                    overlay.setAttribute('inert', '');
                } catch (_eInert) {}
                try {
                    overlay.style.transform = '';
                    overlay.style.opacity = '';
                } catch (_eTr) {}
                const imgEl = document.getElementById('adora-image-lightbox-img');
                if (imgEl) {
                    imgEl.removeAttribute('src');
                    imgEl.removeAttribute('srcset');
                }
                const panzoom = document.getElementById('adora-lightbox-panzoom');
                if (panzoom) {
                    try {
                        panzoom.style.transform = '';
                    } catch (_e3) {}
                }
                if (window.__adoraLightboxHistoryPushed && !fromPopstate) {
                    window.__adoraLightboxHistoryPushed = false;
                    try {
                        const top = adoraNavStack[adoraNavStack.length - 1] || 'screen-categories';
                        const url = window.location.pathname + window.location.search + window.location.hash;
                        history.replaceState({ adora: 1, screen: top }, '', url);
                    } catch (_e2) {}
                } else if (fromPopstate) {
                    window.__adoraLightboxHistoryPushed = false;
                }
                restoreBodyScrollIfIdle();
            } catch (_e) {}
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

        function sideMenuOpenAuthLogin() {
            closeSideDrawer(true);
            openAuthModal('login');
        }

        function sideMenuOpenAuthSignup() {
            closeSideDrawer(true);
            openAuthModal('signup');
        }

        try {
            window.sideMenuOpenAuthLogin = sideMenuOpenAuthLogin;
            window.sideMenuOpenAuthSignup = sideMenuOpenAuthSignup;
            window.sideMenuOpenAppAdInquiriesModal = sideMenuOpenAppAdInquiriesModal;
            window.closeAppAdInquiriesModal = closeAppAdInquiriesModal;
        } catch (_e) {}

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
            openLogoutFarewellModal();
        }

        function openLogoutFarewellModal() {
            const m = document.getElementById('logout-farewell-modal');
            if (!m) return;
            m.classList.remove('hidden');
            m.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }

        function closeLogoutFarewellModal() {
            const m = document.getElementById('logout-farewell-modal');
            if (!m) return;
            m.classList.add('hidden');
            m.setAttribute('aria-hidden', 'true');
            restoreBodyScrollIfIdle();
            const panel = document.getElementById('side-drawer-panel');
            if (panel && panel.classList.contains('open')) {
                document.body.style.overflow = 'hidden';
            }
        }

        function confirmLogoutFarewellModal() {
            performLogout();
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

        const ORDERS_LIST_MODAL_PAGE_SIZE = 6;
        let ordersListModalState = { all: [], nextIndex: 0, pageSize: ORDERS_LIST_MODAL_PAGE_SIZE };

        function buildOrderListCardHtml(o) {
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
        }

        function ordersListModalResetDomForLoading(itemsEl, moreWrap) {
            if (itemsEl) itemsEl.innerHTML = `<div class="py-1 space-y-3">${adoraSkeletonModalRowsHtml(6)}</div>`;
            if (moreWrap) moreWrap.classList.add('hidden');
        }

        function ordersListModalUpdateMoreButton() {
            const wrap = document.getElementById('orders-list-modal-more-wrap');
            const btn = document.getElementById('orders-list-modal-more-btn');
            if (!wrap || !btn) return;
            const left = ordersListModalState.all.length - ordersListModalState.nextIndex;
            if (left <= 0) {
                wrap.classList.add('hidden');
                return;
            }
            wrap.classList.remove('hidden');
            const baseAr = btn.getAttribute('data-ar') || 'عرض المزيد';
            const baseEn = btn.getAttribute('data-en') || 'Show more';
            const base = isRTL ? baseAr : baseEn;
            btn.textContent = `${base} (${left})`;
        }

        function ordersListModalAppendBatch() {
            const itemsEl = document.getElementById('orders-list-modal-items');
            if (!itemsEl) return;
            const { all, nextIndex, pageSize } = ordersListModalState;
            const end = Math.min(nextIndex + pageSize, all.length);
            for (let i = nextIndex; i < end; i++) {
                itemsEl.insertAdjacentHTML('beforeend', buildOrderListCardHtml(all[i]));
            }
            ordersListModalState.nextIndex = end;
            ordersListModalUpdateMoreButton();
        }

        function ordersListModalLoadMore() {
            ordersListModalAppendBatch();
        }
        try {
            window.ordersListModalLoadMore = ordersListModalLoadMore;
        } catch (_e) {}

        async function profileOpenOrdersModal() {
            if (!getStoredJwtToken()) {
                openAuthModal('login', isRTL ? 'سجّل الدخول لعرض طلباتك' : 'Log in to view your orders');
                return;
            }
            await openOrdersListModal();
        }
        try {
            window.profileOpenOrdersModal = profileOpenOrdersModal;
        } catch (_e) {}

        function ordersModalEmptyStateHtml() {
            const title = isRTL ? 'لا توجد طلبات بعد' : 'No orders yet';
            const desc = isRTL ? 'اكتشف تشكيلتنا وابدأ أول طلب لك بسهولة.' : 'Browse our collection and place your first order.';
            const cta = isRTL ? 'اذهب للتسوق' : 'Go shopping';
            const closeHint = isRTL ? 'أو أغلق النافذة للمتابعة لاحقاً' : 'Or close to continue later';
            return `<div class="flex flex-col items-center justify-center py-8 px-2 sm:px-4 text-center">
                <div class="relative mb-5">
                    <div class="absolute inset-0 rounded-full bg-violet-400/20 blur-xl scale-150" aria-hidden="true"></div>
                    <div class="relative w-[88px] h-[88px] rounded-[28px] bg-gradient-to-br from-violet-100 via-white to-purple-50 border border-violet-100/80 shadow-inner flex items-center justify-center">
                        <i class="fas fa-shopping-bag text-[2.25rem] text-violet-500/90"></i>
                    </div>
                </div>
                <p class="text-gray-900 font-bold text-[1.05rem] mb-1.5 tracking-tight">${escapeHtml(title)}</p>
                <p class="text-sm text-gray-500 leading-relaxed max-w-[260px] mb-6">${escapeHtml(desc)}</p>
                <button type="button" onclick="closeOrdersListModal(); navigateTo('screen-categories');" class="w-full max-w-[280px] py-3.5 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 text-white font-bold text-sm shadow-lg shadow-violet-500/25 hover:shadow-violet-500/35 active:scale-[0.98] transition flex items-center justify-center gap-2">
                    <i class="fas fa-store text-sm opacity-95"></i>
                    <span>${escapeHtml(cta)}</span>
                </button>
                <p class="text-[11px] text-gray-400 mt-5 max-w-[240px] leading-relaxed">${escapeHtml(closeHint)}</p>
            </div>`;
        }

        async function openOrdersListModal() {
            const modal = document.getElementById('orders-list-modal');
            const body = document.getElementById('orders-list-modal-body');
            if (!modal || !body) return;
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            const itemsEl = document.getElementById('orders-list-modal-items');
            const moreWrap = document.getElementById('orders-list-modal-more-wrap');
            ordersListModalResetDomForLoading(itemsEl, moreWrap);
            try {
                const orders = await apiFetch('/api/orders', { requireAuth: true });
                if (!Array.isArray(orders) || orders.length === 0) {
                    if (itemsEl) itemsEl.innerHTML = ordersModalEmptyStateHtml();
                    if (moreWrap) moreWrap.classList.add('hidden');
                    return;
                }
                ordersListModalState = {
                    all: orders,
                    nextIndex: 0,
                    pageSize: ORDERS_LIST_MODAL_PAGE_SIZE,
                };
                if (itemsEl) itemsEl.innerHTML = '';
                ordersListModalAppendBatch();
            } catch (e) {
                if (itemsEl) itemsEl.innerHTML = `<p class="text-center text-red-600 py-8">${escapeHtml(e.message)}</p>`;
                if (moreWrap) moreWrap.classList.add('hidden');
            }
        }

        async function toggleOrderHistory(orderId) {
            const box = document.getElementById(`order-history-${orderId}`);
            if (!box) return;
            if (box.classList.contains('hidden')) {
                box.classList.remove('hidden');
                box.innerHTML = `<div class="space-y-2 py-1">${adoraSkeletonModalRowsHtml(3)}</div>`;
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

        function openVendorJoinTermsModal(ev) {
            try {
                if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            } catch (_e) {}
            const modal = document.getElementById('vendor-join-terms-modal');
            if (!modal || !modal.classList.contains('hidden')) return;
            const sc = document.getElementById('vendor-join-terms-modal-scroll');
            if (sc) {
                sc.scrollTop = 0;
                try {
                    sc.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                } catch (_s) {
                    sc.scrollTop = 0;
                }
            }
            document.body.style.overflow = 'hidden';
            requestAnimationFrame(() => {
                try {
                    modal.classList.remove('hidden');
                    modal.setAttribute('aria-hidden', 'false');
                    if (sc) {
                        sc.scrollTop = 0;
                        try {
                            sc.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                        } catch (_s2) {}
                        void sc.offsetHeight;
                    }
                } catch (_e2) {}
                requestAnimationFrame(() => {
                    if (!sc) return;
                    sc.scrollTop = 0;
                    try {
                        sc.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                    } catch (_s3) {}
                });
                setTimeout(() => {
                    if (!sc || !modal || modal.classList.contains('hidden')) return;
                    sc.scrollTop = 0;
                    try {
                        sc.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                    } catch (_s4) {}
                }, 0);
                setTimeout(() => {
                    if (!sc || !modal || modal.classList.contains('hidden')) return;
                    sc.scrollTop = 0;
                }, 80);
            });
        }
        function closeVendorJoinTermsModal() {
            try {
                const modal = document.getElementById('vendor-join-terms-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.setAttribute('aria-hidden', 'true');
                }
            } finally {
                restoreBodyScrollIfIdle();
            }
        }
        try {
            window.openVendorJoinTermsModal = openVendorJoinTermsModal;
            window.closeVendorJoinTermsModal = closeVendorJoinTermsModal;
        } catch (_e) {}

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
                const em = document.getElementById('profile-edit-email');
                if (name) name.value = data.user?.name || '';
                if (phone) phone.value = data.user?.phone || '';
                if (em) em.value = data.user?.email || '';
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
                'Email already exists': 'البريد الإلكتروني مستخدم مسبقاً',
                'Missing name or phone': 'الاسم والهاتف مطلوبان',
                'Profile must keep at least phone or email': 'احتفظ ببريد أو هاتف على الأقل',
                'Invalid email address': 'عنوان البريد غير صالح',
            };
            const en = Object.fromEntries(Object.entries(ar).map(([k, v]) => [v, k]));
            if (isRTL && ar[m]) return ar[m];
            if (!isRTL && en[m]) return en[m];
            return m;
        }

        async function saveProfileEdit() {
            const name = document.getElementById('profile-edit-name')?.value.trim();
            const phone = document.getElementById('profile-edit-phone')?.value.trim();
            const email = document.getElementById('profile-edit-email')?.value.trim();
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
            if (!name || (!phone && !email)) {
                showErr(isRTL ? 'أدخل الاسم وبريد أو هاتف على الأقل' : 'Enter name and at least email or phone');
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
                    body: { name, phone, email },
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
            body.innerHTML = `<div class="py-2">${adoraSkeletonModalRowsHtml(4)}</div>`;
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
        function performLogout() {
            disconnectAppSocket();
            clearStoredJwtToken();
            updateSiteRatingLoginHint();
            updateProductReviewLoginHint();
            updateMarketplaceReviewLoginHint();
            shouldPersistOrderStatusUpdates = false;
            latestOrderDbId = null;
            latestOrderCreatedAt = null;
            closeLogoutFarewellModal();
            closeSideDrawer();
            refreshSideMenuHeader().catch(() => {});
            showAuthGateOnly();
            showToast(isRTL ? 'تم تسجيل الخروج' : 'Logged out successfully');
        }

        function logout() {
            if (confirm(isRTL ? 'هل أنت متأكد من تسجيل الخروج؟' : 'Are you sure you want to logout?')) {
                performLogout();
            }
        }

        // Toast System — opts: { duration?: number, variant?: 'sort-done' | 'feedback-sent' }
        function showToast(message, opts) {
            const toast = document.getElementById('toast');
            const msgEl = document.getElementById('toast-message');
            if (!toast || !msgEl) return;
            const duration = opts && typeof opts.duration === 'number' ? opts.duration : 2500;
            const v = opts && opts.variant;
            const violetLight = v === 'sort-done' || v === 'feedback-sent';
            const feedbackSent = v === 'feedback-sent';
            msgEl.textContent = message;
            toast.classList.toggle('toast--sort-done', violetLight);
            toast.classList.toggle('toast--feedback-sent', feedbackSent);
            toast.classList.add('show');
            if (toast._adoraToastTimer) clearTimeout(toast._adoraToastTimer);
            toast._adoraToastTimer = setTimeout(() => {
                toast.classList.remove('show');
                toast.classList.remove('toast--sort-done');
                toast.classList.remove('toast--feedback-sent');
                toast._adoraToastTimer = null;
            }, duration);
        }

        function adoraAllowNativeTextInteraction(target) {
            if (!target || !target.closest) return false;
            if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
            if (
                target.closest(
                    '#auth-modal, #auth-gate-screen, #signup-credentials-modal, #product-share-modal, #contact-info-modal'
                )
            )
                return true;
            return false;
        }

        function adoraDrawWatermarkOnCanvas(ctx, w, h) {
            if (!ctx || !w || !h) return;
            const cx = w * 0.5;
            const cy = h * 0.5;
            ctx.save();
            ctx.globalAlpha = 0.075;
            ctx.fillStyle = '#ffffff';
            ctx.font = `900 ${Math.max(40, Math.floor(w * 0.15))}px system-ui, -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.translate(cx, cy);
            ctx.rotate(-0.38);
            ctx.fillText('Adora', 0, 0);
            ctx.restore();

            const fs = Math.max(12, Math.floor(w * 0.026));
            ctx.save();
            ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
            const label = 'Adora';
            const tw = ctx.measureText(label).width;
            const padX = fs * 0.9;
            const padY = fs * 0.55;
            const boxW = tw + padX * 2;
            const boxH = fs + padY * 2;
            const margin = Math.max(8, Math.floor(Math.min(w, h) * 0.018));
            const bx = w - boxW - margin;
            const by = h - boxH - margin;
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            if (typeof ctx.roundRect === 'function') {
                ctx.beginPath();
                ctx.roundRect(bx, by, boxW, boxH, Math.min(10, fs * 0.65));
                ctx.fill();
            } else {
                ctx.fillRect(bx, by, boxW, boxH);
            }
            ctx.globalAlpha = 0.78;
            ctx.fillStyle = '#5b21b6';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(label, bx + padX, by + padY * 0.75);
            ctx.restore();
        }

        async function adoraDownloadImageWithWatermark(imageUrl, baseName) {
            const src = String(imageUrl || '').trim();
            if (!src) throw new Error('no src');

            let drawable = null;
            try {
                const res = await fetch(src, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
                if (res.ok) {
                    const blob = await res.blob();
                    if (typeof createImageBitmap === 'function') {
                        try {
                            drawable = await createImageBitmap(blob);
                        } catch (_e) {}
                    }
                }
            } catch (_e) {}

            if (!drawable) {
                await new Promise((resolve, reject) => {
                    const im = new Image();
                    im.crossOrigin = 'anonymous';
                    im.onload = () => {
                        drawable = im;
                        resolve();
                    };
                    im.onerror = () => reject(new Error('img load'));
                    im.src = src;
                });
            }

            const nw = drawable.naturalWidth || drawable.width;
            const nh = drawable.naturalHeight || drawable.height;
            if (!nw || !nh) throw new Error('dims');

            const canvas = document.createElement('canvas');
            canvas.width = nw;
            canvas.height = nh;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('ctx');
            try {
                ctx.drawImage(drawable, 0, 0, nw, nh);
            } catch (_e) {
                throw new Error('draw');
            }
            adoraDrawWatermarkOnCanvas(ctx, nw, nh);

            await new Promise((resolve, reject) => {
                canvas.toBlob(
                    (b) => {
                        if (!b) {
                            reject(new Error('blob'));
                            return;
                        }
                        const u = URL.createObjectURL(b);
                        const a = document.createElement('a');
                        a.href = u;
                        const safe = String(baseName || 'adora-product')
                            .replace(/[^a-z0-9-_]+/gi, '-')
                            .replace(/^-+|-+$/g, '')
                            .slice(0, 72);
                        a.download = `${safe || 'adora-product'}.png`;
                        a.rel = 'noopener';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(u);
                        resolve();
                    },
                    'image/png',
                    0.92
                );
            });

            try {
                if (drawable && typeof drawable.close === 'function') drawable.close();
            } catch (_e2) {}
        }

        function adoraGetVisibleGalleryImageUrl(galleryId) {
            const host = document.getElementById(galleryId);
            if (!host) return '';
            const hostRect = host.getBoundingClientRect();
            let bestSrc = '';
            let bestScore = 0;
            host.querySelectorAll('img[src]').forEach((im) => {
                const s = (im.getAttribute('src') || '').trim();
                if (!s || /adora-icon\.(svg|png)/i.test(s)) return;
                const r = im.getBoundingClientRect();
                const iw = Math.max(0, Math.min(r.right, hostRect.right) - Math.max(r.left, hostRect.left));
                const ih = Math.max(0, Math.min(r.bottom, hostRect.bottom) - Math.max(r.top, hostRect.top));
                const area = iw * ih;
                if (area > bestScore) {
                    bestScore = area;
                    bestSrc = s;
                }
            });
            return bestSrc;
        }

        async function adoraSaveGalleryImageWithWatermark(galleryId, filenameHint) {
            const url = adoraGetVisibleGalleryImageUrl(galleryId);
            if (!url) {
                showToast(isRTL ? 'لا توجد صورة للحفظ' : 'No image to save');
                return;
            }
            try {
                await adoraDownloadImageWithWatermark(url, filenameHint);
                showToast(isRTL ? 'تم تنزيل الصورة مع علامة Adora' : 'Image downloaded with Adora watermark');
            } catch (_e) {
                showToast(
                    isRTL
                        ? 'تعذر حفظ الصورة. جرّب مرة أخرى أو تأكد أن الصورة من نفس الموقع.'
                        : 'Could not save the image. Try again or ensure the image loads from this site.'
                );
            }
        }

        function adoraSaveCurrentProductImage() {
            const id = currentProductDetail && currentProductDetail.id ? `product-${currentProductDetail.id}` : 'adora-product';
            adoraSaveGalleryImageWithWatermark('product-gallery', id);
        }

        function adoraSaveCurrentMarketplaceProductImage() {
            const id =
                currentMarketplaceProductDetail && currentMarketplaceProductDetail.id
                    ? `mp-product-${currentMarketplaceProductDetail.id}`
                    : 'adora-marketplace-product';
            adoraSaveGalleryImageWithWatermark('marketplace-product-gallery', id);
        }

        window.adoraSaveCurrentProductImage = adoraSaveCurrentProductImage;
        window.adoraSaveCurrentMarketplaceProductImage = adoraSaveCurrentMarketplaceProductImage;

        let adoraContentProtectionBound = false;
        function initAdoraContentProtection() {
            if (adoraContentProtectionBound) return;
            adoraContentProtectionBound = true;

            const shellContainsNode = (node) => {
                const shell = document.getElementById('app-shell');
                if (!shell || shell.classList.contains('hidden') || !node) return false;
                try {
                    return shell.contains(node);
                } catch (_e) {
                    return false;
                }
            };

            const blockClipboardUnlessAllowed = (e) => {
                if (adoraAllowNativeTextInteraction(e.target)) return;
                const shell = document.getElementById('app-shell');
                if (shell && !shell.classList.contains('hidden') && shell.contains(e.target)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                try {
                    const sel = document.getSelection();
                    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
                        const a = sel.anchorNode;
                        const el = a && a.nodeType === 1 ? a : a && a.parentElement;
                        if (a && shellContainsNode(a) && el && !adoraAllowNativeTextInteraction(el)) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    }
                } catch (_e2) {}
            };
            document.addEventListener('copy', blockClipboardUnlessAllowed, true);
            document.addEventListener('cut', blockClipboardUnlessAllowed, true);
            document.addEventListener('paste', blockClipboardUnlessAllowed, true);

            document.addEventListener(
                'selectstart',
                (e) => {
                    if (adoraAllowNativeTextInteraction(e.target)) return;
                    const shell = document.getElementById('app-shell');
                    if (shell && !shell.classList.contains('hidden') && shell.contains(e.target)) {
                        e.preventDefault();
                    }
                },
                true
            );

            document.addEventListener(
                'contextmenu',
                (e) => {
                    if (!e.target || !e.target.closest) return;
                    if (adoraAllowNativeTextInteraction(e.target)) return;
                    const shell = document.getElementById('app-shell');
                    if (shell && !shell.classList.contains('hidden') && shell.contains(e.target)) {
                        e.preventDefault();
                        return;
                    }
                    const lb = document.getElementById('adora-image-lightbox');
                    if (lb && !lb.classList.contains('hidden') && lb.contains(e.target)) {
                        e.preventDefault();
                    }
                },
                true
            );

            document.addEventListener(
                'dragstart',
                (e) => {
                    if (e.target && e.target.tagName === 'IMG' && !adoraAllowNativeTextInteraction(e.target)) {
                        e.preventDefault();
                    }
                },
                true
            );

            document.addEventListener(
                'keydown',
                (e) => {
                    const ae = document.activeElement;
                    if (adoraAllowNativeTextInteraction(ae)) return;
                    const shell = document.getElementById('app-shell');
                    if (!shell || shell.classList.contains('hidden') || !ae || !shell.contains(ae)) return;
                    const k = e.key && String(e.key).toLowerCase();
                    if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'x' || k === 'a')) {
                        e.preventDefault();
                    }
                },
                true
            );
        }

        let adoraProductGalleryLongPressBound = false;
        function initAdoraProductGalleryLongPressSave() {
            if (adoraProductGalleryLongPressBound) return;
            adoraProductGalleryLongPressBound = true;
            const setups = [
                { id: 'product-gallery', save: () => adoraSaveCurrentProductImage() },
                { id: 'marketplace-product-gallery', save: () => adoraSaveCurrentMarketplaceProductImage() },
            ];
            setups.forEach(({ id, save }) => {
                const el = document.getElementById(id);
                if (!el) return;
                let timer = null;
                let sx = 0;
                let sy = 0;
                const clear = () => {
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                };
                el.addEventListener(
                    'touchstart',
                    (e) => {
                        clear();
                        if (e.target && e.target.closest && e.target.closest('.adora-gallery-top-actions')) return;
                        if (!e.touches || e.touches.length !== 1) return;
                        sx = e.touches[0].clientX;
                        sy = e.touches[0].clientY;
                        timer = setTimeout(() => {
                            timer = null;
                            save();
                        }, 680);
                    },
                    { passive: true }
                );
                el.addEventListener('touchend', clear, { passive: true });
                el.addEventListener('touchcancel', clear, { passive: true });
                el.addEventListener(
                    'touchmove',
                    (e) => {
                        if (!timer || !e.touches || !e.touches.length) return;
                        const dx = Math.abs(e.touches[0].clientX - sx);
                        const dy = Math.abs(e.touches[0].clientY - sy);
                        if (dx > 14 || dy > 14) clear();
                    },
                    { passive: true }
                );
            });
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
                const banImg = e.target.closest('img[data-adora-banner-img]');
                if (banImg && shell.contains(banImg) && banImg.closest('.adora-banner-slider-viewport')) {
                    const slide = banImg.closest('.adora-banner-slide');
                    if (slide && slide.querySelector('button[onclick*="openCustomerFeedbackBannerModal"]')) return;
                    const s = banImg.getAttribute('src');
                    if (s && typeof window.openAdoraImageLightbox === 'function') {
                        e.preventDefault();
                        e.stopPropagation();
                        window.openAdoraImageLightbox(s);
                    }
                    return;
                }
                const mpV = e.target.closest('.mp-vendor-strip-card[data-mp-vendor-id], .mp-top-vendor-card[data-mp-vendor-id]');
                if (mpV && shell.contains(mpV)) {
                    e.preventDefault();
                    const raw = mpV.getAttribute('data-mp-vendor-id');
                    const vid = raw != null ? Number(raw) : NaN;
                    if (Number.isFinite(vid)) openMarketplaceBrowse({ vendor_id: vid });
                    return;
                }
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
                const btn = e.target.closest(
                    '.brand-strip-card[data-brand-name], .top-brand-card[data-brand-name], .top-brand-minimal-btn[data-brand-name]'
                );
                if (!btn || !shell.contains(btn)) return;
                const enc = btn.getAttribute('data-brand-name');
                if (!enc) return;
                e.preventDefault();
                try {
                    openBrandStore(decodeURIComponent(enc));
                } catch (_) {}
            });
        }

        function initAdoraProductImageLightbox() {
            const overlay = document.getElementById('adora-image-lightbox');
            const viewport = document.getElementById('adora-lightbox-viewport');
            const panzoomEl = document.getElementById('adora-lightbox-panzoom');
            const imgEl = document.getElementById('adora-image-lightbox-img');
            const closeBtn = document.getElementById('adora-image-lightbox-close');
            const btnIn = document.getElementById('adora-lightbox-zoom-in');
            const btnOut = document.getElementById('adora-lightbox-zoom-out');
            const btnReset = document.getElementById('adora-lightbox-zoom-reset');
            const counterEl = document.getElementById('adora-lightbox-counter');
            if (!overlay || !viewport || !panzoomEl || !imgEl) return;

            let panzoomUiBound = false;
            let lbUrls = [];
            let lbIndex = 0;
            let lbLoadToken = 0;
            let swipeStartX = 0;
            let swipeStartY = 0;
            let swipeTracking = false;
            let pullStart = null;
            let pullDownActive = false;

            function lbPanzoom() {
                return window.__adoraLightboxPanzoom;
            }

            function destroyLbPanzoom() {
                try {
                    window.__adoraLightboxPanzoom?.destroy?.();
                } catch (_e) {}
                window.__adoraLightboxPanzoom = null;
                try {
                    panzoomEl.style.transform = '';
                } catch (_e2) {}
            }

            /** يُنشأ بعد تحميل الصورة وقياس الـ viewport حتى يعمل contain وpinch بشكل صحيح */
            function createLbPanzoom() {
                destroyLbPanzoom();
                const PanzoomCtor = typeof window !== 'undefined' ? window.Panzoom : null;
                if (typeof PanzoomCtor !== 'function') return null;
                const useCanvas =
                    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
                const pz = PanzoomCtor(panzoomEl, {
                    canvas: useCanvas,
                    contain: 'inside',
                    maxScale: 5,
                    minScale: 1,
                    startScale: 1,
                    startX: 0,
                    startY: 0,
                    panOnlyWhenZoomed: true,
                    roundPixels: false,
                    cursor: 'grab',
                    animate: true,
                    duration: 320,
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    overflow: 'hidden',
                });
                window.__adoraLightboxPanzoom = pz;
                return pz;
            }

            function resetContainAfterPaint(pz) {
                if (!pz) return;
                try {
                    requestAnimationFrame(() => {
                        try {
                            pz.reset({ animate: false });
                        } catch (_e) {}
                    });
                } catch (_e2) {}
            }

            function updateLbCounter() {
                if (!counterEl) return;
                if (lbUrls.length > 0) {
                    counterEl.classList.remove('hidden');
                    counterEl.textContent = `${lbIndex + 1} / ${lbUrls.length}`;
                } else {
                    counterEl.classList.add('hidden');
                    counterEl.textContent = '';
                }
            }

            function syncLbGlobals() {
                try {
                    window.__adoraLightboxUrls = lbUrls.slice();
                } catch (_e) {}
            }

            function adoraLbGo(delta) {
                if (!lbUrls.length || lbUrls.length < 2) return;
                const ni = lbIndex + delta;
                if (ni < 0 || ni >= lbUrls.length) return;
                lbIndex = ni;
                updateLbCounter();
                syncLbGlobals();
                lbLoadToken++;
                const token = lbLoadToken;
                destroyLbPanzoom();
                imgEl.src = lbUrls[lbIndex];
                const onLoad = () => {
                    if (token !== lbLoadToken) return;
                    imgEl.removeEventListener('load', onLoad);
                    requestAnimationFrame(() => {
                        if (token !== lbLoadToken) return;
                        const pz = createLbPanzoom();
                        resetContainAfterPaint(pz);
                    });
                };
                imgEl.addEventListener('load', onLoad);
                if (imgEl.complete && imgEl.naturalWidth > 0) {
                    queueMicrotask(onLoad);
                }
            }

            function bindPanzoomUiOnce() {
                if (panzoomUiBound) return;
                panzoomUiBound = true;

                viewport.addEventListener(
                    'wheel',
                    (e) => {
                        if (overlay.classList.contains('hidden')) return;
                        const pz = lbPanzoom();
                        if (pz) pz.zoomWithWheel(e);
                    },
                    { passive: false }
                );

                btnIn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    lbPanzoom()?.zoomIn({ animate: true });
                });
                btnOut?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const pz = lbPanzoom();
                    if (!pz) return;
                    pz.zoomOut({ animate: true });
                    window.setTimeout(() => {
                        try {
                            if (pz.getScale() <= 1.04) pz.reset({ animate: true });
                        } catch (_e) {}
                    }, 260);
                });
                btnReset?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    lbPanzoom()?.reset({ animate: true });
                });

                function doubleTapZoom(clientX, clientY, originalEvent) {
                    const pz = lbPanzoom();
                    if (!pz) return;
                    const pt = { clientX, clientY };
                    if (pz.getScale() > 1.08) {
                        pz.reset({ animate: true });
                    } else {
                        const next = Math.min(5, 2.35);
                        pz.zoomToPoint(next, pt, { animate: true }, originalEvent);
                    }
                }

                panzoomEl.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    doubleTapZoom(e.clientX, e.clientY, e);
                });

                let lastTouchEnd = 0;
                let lastTapX = 0;
                let lastTapY = 0;
                panzoomEl.addEventListener(
                    'touchend',
                    (e) => {
                        if (overlay.classList.contains('hidden')) return;
                        if (e.changedTouches.length !== 1) return;
                        const touch = e.changedTouches[0];
                        const now = Date.now();
                        const dt = lastTouchEnd ? now - lastTouchEnd : 9999;
                        const moved = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);
                        if (dt < 320 && dt > 0 && moved < 30) {
                            e.preventDefault();
                            doubleTapZoom(touch.clientX, touch.clientY, e);
                            lastTouchEnd = 0;
                            return;
                        }
                        lastTouchEnd = now;
                        lastTapX = touch.clientX;
                        lastTapY = touch.clientY;
                    },
                    { passive: false }
                );

                viewport.addEventListener(
                    'touchstart',
                    (e) => {
                        if (overlay.classList.contains('hidden')) return;
                        if (e.touches.length !== 1) {
                            swipeTracking = false;
                            pullStart = null;
                            pullDownActive = false;
                            return;
                        }
                        const pz = lbPanzoom();
                        if (pz && pz.getScale() > 1.06) {
                            swipeTracking = false;
                            pullStart = null;
                            pullDownActive = false;
                            return;
                        }
                        const t = e.touches[0];
                        swipeStartX = t.clientX;
                        swipeStartY = t.clientY;
                        pullStart = { x: t.clientX, y: t.clientY };
                        pullDownActive = false;
                        swipeTracking = lbUrls.length >= 2;
                    },
                    { passive: true }
                );

                viewport.addEventListener(
                    'touchmove',
                    (e) => {
                        if (overlay.classList.contains('hidden') || !pullStart) return;
                        if (e.touches.length !== 1) return;
                        const pz = lbPanzoom();
                        if (pz && pz.getScale() > 1.06) return;
                        const t = e.touches[0];
                        const dx = t.clientX - pullStart.x;
                        const dy = t.clientY - pullStart.y;
                        if (!pullDownActive) {
                            if (dy > 18 && dy > Math.abs(dx) * 1.35) {
                                pullDownActive = true;
                                swipeTracking = false;
                            } else if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.25) {
                                pullStart = null;
                                pullDownActive = false;
                                return;
                            }
                        }
                        if (pullDownActive && dy > 0) {
                            try {
                                overlay.style.transform = `translateY(${dy}px)`;
                                overlay.style.opacity = String(Math.max(0.22, 1 - dy / 520));
                            } catch (_ePd) {}
                            e.preventDefault();
                        }
                    },
                    { passive: false }
                );

                viewport.addEventListener(
                    'touchend',
                    (e) => {
                        if (overlay.classList.contains('hidden')) return;

                        if (pullDownActive && pullStart && e.changedTouches.length === 1) {
                            const dyClose = e.changedTouches[0].clientY - pullStart.y;
                            pullDownActive = false;
                            pullStart = null;
                            swipeTracking = false;
                            try {
                                overlay.style.transform = '';
                                overlay.style.opacity = '';
                            } catch (_ePu) {}
                            if (dyClose > 96) {
                                closeAdoraImageLightbox();
                                return;
                            }
                        } else {
                            try {
                                overlay.style.transform = '';
                                overlay.style.opacity = '';
                            } catch (_ePu2) {}
                            pullStart = null;
                            pullDownActive = false;
                        }

                        if (!swipeTracking) return;
                        if (e.changedTouches.length !== 1) {
                            swipeTracking = false;
                            return;
                        }
                        const pz = lbPanzoom();
                        if (pz && pz.getScale() > 1.06) {
                            swipeTracking = false;
                            return;
                        }
                        const ex = e.changedTouches[0].clientX;
                        const ey = e.changedTouches[0].clientY;
                        const dx = ex - swipeStartX;
                        const dy = ey - swipeStartY;
                        swipeTracking = false;
                        if (lbUrls.length < 2) return;
                        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
                        if (dx < 0) adoraLbGo(1);
                        else adoraLbGo(-1);
                    },
                    { passive: true }
                );
            }

            function closeAdoraImageLightbox() {
                closeAdoraImageLightboxIfOpen();
            }

            function openAdoraImageLightbox(src, opts) {
                opts = opts || {};
                const raw = src != null ? String(src).trim() : '';
                let urls = [];
                if (Array.isArray(opts.urls) && opts.urls.length) {
                    urls = opts.urls.map((u) => String(u || '').trim()).filter(Boolean);
                } else if (raw) {
                    urls = [raw];
                }
                if (!urls.length) return;
                let idx = Number.isFinite(opts.index) ? Math.trunc(opts.index) : 0;
                idx = Math.max(0, Math.min(urls.length - 1, idx));
                lbUrls = urls;
                lbIndex = idx;
                pullStart = null;
                pullDownActive = false;
                swipeTracking = false;
                updateLbCounter();
                syncLbGlobals();
                lbLoadToken++;
                const token = lbLoadToken;
                const s = lbUrls[lbIndex];

                const lbUseHistory =
                    typeof window.matchMedia === 'function' &&
                    window.matchMedia('(min-width: 640px)').matches &&
                    window.matchMedia('(pointer: fine)').matches;
                if (lbUseHistory) {
                    try {
                        const url = window.location.pathname + window.location.search + window.location.hash;
                        history.pushState({ adora: 1, imageLightbox: true }, '', url);
                        window.__adoraLightboxHistoryPushed = true;
                    } catch (_e) {
                        window.__adoraLightboxHistoryPushed = false;
                    }
                } else {
                    window.__adoraLightboxHistoryPushed = false;
                }
                overlay.removeAttribute('inert');
                overlay.classList.remove('hidden');
                overlay.setAttribute('aria-hidden', 'false');
                document.body.style.overflow = 'hidden';

                destroyLbPanzoom();
                bindPanzoomUiOnce();

                const run = () => {
                    if (token !== lbLoadToken) return;
                    imgEl.src = s;
                    const onLoad = () => {
                        if (token !== lbLoadToken) return;
                        imgEl.removeEventListener('load', onLoad);
                        requestAnimationFrame(() => {
                            if (token !== lbLoadToken) return;
                            const pz = createLbPanzoom();
                            resetContainAfterPaint(pz);
                        });
                    };
                    imgEl.addEventListener('load', onLoad);
                    if (imgEl.complete && imgEl.naturalWidth > 0) {
                        queueMicrotask(onLoad);
                    }
                };

                requestAnimationFrame(() => {
                    requestAnimationFrame(run);
                });
            }

            window.closeAdoraImageLightbox = closeAdoraImageLightbox;
            window.openAdoraImageLightbox = openAdoraImageLightbox;
            window.adoraLightboxStep = (delta) => adoraLbGo(Number(delta) || 0);

            closeBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAdoraImageLightbox();
            });

            overlay.addEventListener('click', (e) => {
                if (overlay.classList.contains('hidden')) return;
                const t = e.target;
                if (t.closest('#adora-image-lightbox-close') || t.closest('#adora-image-lightbox-close-text')) return;
                if (t.closest('#adora-lightbox-toolbar')) return;
                if (t.closest('#adora-lightbox-panzoom')) return;
                closeAdoraImageLightbox();
            });

            function collectGallerySrcs(host) {
                const out = [];
                if (!host) return out;
                host.querySelectorAll('img[src]').forEach((im) => {
                    const u = (im.getAttribute('src') || '').trim();
                    if (!u || /adora-icon\.(svg|png)/i.test(u)) return;
                    out.push(u);
                });
                return out;
            }

            function openGalleryLightboxFromImg(host, im) {
                if (!host || !im || !host.contains(im)) return;
                const s = im.getAttribute('src');
                if (!s || /adora-icon\.(svg|png)/i.test(String(s))) return;
                const urls = collectGallerySrcs(host);
                const idx = urls.indexOf(String(s).trim());
                if (urls.length > 1 && idx >= 0) {
                    openAdoraImageLightbox(s, { urls, index: idx });
                } else {
                    openAdoraImageLightbox(s);
                }
            }

            ['product-gallery', 'marketplace-product-gallery'].forEach((id) => {
                const host = document.getElementById(id);
                if (!host) return;
                host.addEventListener('click', (e) => {
                    if (e.target && e.target.closest && e.target.closest('.adora-gallery-top-actions')) return;
                    const im = e.target && e.target.closest && e.target.closest('img');
                    if (!im || !host.contains(im)) return;
                    openGalleryLightboxFromImg(host, im);
                });
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
                .catch(() => {})
                .finally(() => applyHomeTopBannerStickyPlacement(cachedHomeTopBannersSticky));
            loadCartFromStorage();
            loadHomeFeaturedGrid().catch(() => {});
            loadHomeNewCollectionGrid().catch(() => {});
            loadHomeMpPremiumVendors().catch(() => {});
            loadHomeMpFeaturedMarketplaceProducts().catch(() => {});
            loadMarketplaceHomeEntrance().catch(() => {});
            loadPartnerCtaConfig().catch(() => {});
            loadMarketplaceHomeHighlights().catch(() => {});
            bindVendorJoinPageFormOnce();
            bindAppAdPageFormOnce();
            refreshAdoraHomeSubcategoryCounts().catch(() => {});
            updateProfileWishlistUi();
            initOnboardingStorageMigration();
            initBrandClickDelegation();
            initMarketplaceVendorStripDelegation();
            initAdoraAuthParticles();
            initSiteRatingStars();
            initProductReviewStars();
            initMarketplaceProductReviewStars();
            initAdoraProductImageLightbox();
            initAdoraContentProtection();
            initAdoraProductGalleryLongPressSave();
            updateSiteRatingLoginHint();
            updateProductReviewLoginHint();
            updateMarketplaceReviewLoginHint();
            applyAppLanguage();
            document.addEventListener('keydown', (e) => {
                const lb = document.getElementById('adora-image-lightbox');
                if (lb && !lb.classList.contains('hidden')) {
                    if (e.key === 'Escape') {
                        window.closeAdoraImageLightbox?.();
                        return;
                    }
                    const urls = window.__adoraLightboxUrls;
                    if (
                        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
                        Array.isArray(urls) &&
                        urls.length > 1 &&
                        typeof window.adoraLightboxStep === 'function'
                    ) {
                        e.preventDefault();
                        const rtl = localStorage.getItem('adora_rtl') !== '0';
                        if (e.key === 'ArrowLeft') window.adoraLightboxStep(rtl ? 1 : -1);
                        else window.adoraLightboxStep(rtl ? -1 : 1);
                    }
                    return;
                }
                if (e.key !== 'Escape') return;
                const ov = document.getElementById('home-subcat-overlay');
                if (ov && !ov.classList.contains('hidden')) closeHomeCategoryPanel();
            });
            initAdoraAnimatedSearch();
            initAdoraPullToRefresh();
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        runProductSearch();
                    }
                });
            }
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
            updateBrandSortButtons();
            syncFlashSaleFromApi().finally(() => {
                renderFlashSale();
                initFlashCountdown();
                applyAppLanguage();
            });
        });
