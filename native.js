/* Puente nativo de Fortuna Mágica: anuncios (AdMob), compras y vibración.
   En el navegador no hace nada (el juego usa la versión simulada).
   ⚠️ CÓDIGO SIN PROBAR EN DISPOSITIVO: el desarrollador debe verificarlo
   contra la documentación vigente de cada plugin. Mismo esquema que los otros juegos. */
(function () {
  var TEST = true; // ⚠️ PONER false ANTES DE PUBLICAR
  var IS = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  var PLAT = IS && Capacitor.getPlatform ? Capacitor.getPlatform() : 'web';

  var AD_TEST_IDS = {
    ios: { banner: 'ca-app-pub-3940256099942544/2934735716', inter: 'ca-app-pub-3940256099942544/4411468910', rewarded: 'ca-app-pub-3940256099942544/1712485313' },
    android: { banner: 'ca-app-pub-3940256099942544/6300978111', inter: 'ca-app-pub-3940256099942544/1033173712', rewarded: 'ca-app-pub-3940256099942544/5224354917' }
  };
  var AD_REAL_IDS = {
    ios: { banner: 'ca-app-pub-7854858972816820/6328798646', inter: 'ca-app-pub-7854858972816820/2277962283', rewarded: 'ca-app-pub-7854858972816820/1132312285' },
    android: { banner: 'ca-app-pub-0000000000000000/0000000000', inter: 'ca-app-pub-0000000000000000/0000000000', rewarded: 'ca-app-pub-0000000000000000/0000000000' }
  };
  var AD = TEST ? AD_TEST_IDS : AD_REAL_IDS;

  var PRODUCTS = {
    fortuna_monedas_300: { id: 'fortuna_monedas_300', t: 'consumable' },
    fortuna_monedas_900: { id: 'fortuna_monedas_900', t: 'consumable' },
    fortuna_monedas_2500: { id: 'fortuna_monedas_2500', t: 'consumable' },
    fortuna_remove_ads: { id: 'fortuna_remove_ads', t: 'non' }
  };

  var AdMob = function () { return window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.AdMob; };
  var pending = {};
  var plat = null;

  function ids() { return AD[PLAT] || AD.ios; }

  function initPurchases() {
    return new Promise(function (res) {
      if (!window.CdvPurchase) { res(); return; }
      var CP = CdvPurchase, store = CP.store;
      plat = PLAT === 'ios' ? CP.Platform.APPLE_APPSTORE : CP.Platform.GOOGLE_PLAY;
      var types = { consumable: CP.ProductType.CONSUMABLE, non: CP.ProductType.NON_CONSUMABLE };
      store.register(Object.keys(PRODUCTS).map(function (k) {
        return { id: PRODUCTS[k].id, type: types[PRODUCTS[k].t], platform: plat };
      }));
      store.when().approved(function (tx) {
        tx.products.forEach(function (p) { var r = pending[p.id]; if (r) { r(true); delete pending[p.id]; } });
        tx.finish();
      });
      store.initialize([plat]).then(function () { res(); }).catch(function () { res(); });
    });
  }

  var N = {
    isNative: IS,
    ready: false,

    init: function () {
      if (!IS) return Promise.resolve();
      return new Promise(function (r) {
        if (window.cordova) { document.addEventListener('deviceready', r, { once: true }); setTimeout(r, 3000); } else r();
      }).then(async function () {
        var A = AdMob();
        try {
          if (A) {
            if (PLAT === 'ios') {
              var st = await A.trackingAuthorizationStatus();
              if (st.status === 'notDetermined') await A.requestTrackingAuthorization();
            }
            var info = await A.requestConsentInfo();
            if (info.isConsentFormAvailable && info.status === 'REQUIRED') await A.showConsentForm();
            await A.initialize({ initializeForTesting: TEST });
          }
        } catch (e) { console.log('AdMob init error', e); }
        await initPurchases();
        N.ready = true;
      });
    },

    showBanner: function () {
      var A = AdMob(); if (!A || !N.ready) return;
      A.showBanner({ adId: ids().banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: TEST }).catch(function () {});
    },
    hideBanner: function () { var A = AdMob(); if (A) A.removeBanner().catch(function () {}); },

    showAd: async function (kind) {
      var A = AdMob(); if (!A) return false;
      try {
        if (kind === 'interstitial') {
          await A.prepareInterstitial({ adId: ids().inter, isTesting: TEST });
          await A.showInterstitial();
          return true;
        }
        return await new Promise(async function (res) {
          var ok = false, hs = [];
          var done = function (v) { hs.forEach(function (h) { h.remove(); }); res(v); };
          hs.push(await A.addListener('onRewardedVideoAdReward', function () { ok = true; }));
          hs.push(await A.addListener('onRewardedVideoAdDismissed', function () { done(ok); }));
          hs.push(await A.addListener('onRewardedVideoAdFailedToShow', function () { done(false); }));
          try {
            await A.prepareRewardVideoAd({ adId: ids().rewarded, isTesting: TEST });
            await A.showRewardVideoAd();
          } catch (e) { done(false); }
        });
      } catch (e) { return false; }
    },
    showRewarded: function () { return N.showAd('rewarded'); },
    showInterstitial: function () { return N.showAd('interstitial'); },

    buy: function (key) {
      var p = PRODUCTS[key];
      if (!window.CdvPurchase || !p) return Promise.resolve(false);
      var store = CdvPurchase.store, prod = store.get(p.id, plat), offer = prod && prod.getOffer();
      if (!offer) return Promise.resolve(false);
      return new Promise(function (res) {
        pending[p.id] = res;
        store.order(offer).then(function (err) { if (err) { delete pending[p.id]; res(false); } });
      });
    },

    restore: function () {
      if (!window.CdvPurchase) return Promise.resolve([]);
      var store = CdvPurchase.store;
      return store.restorePurchases().then(function () {
        return Object.keys(PRODUCTS).filter(function (k) {
          return PRODUCTS[k].t !== 'consumable' && store.owned(PRODUCTS[k].id);
        });
      }).catch(function () { return []; });
    },

    haptic: function (n) {
      var H = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Haptics;
      if (H) H.impact({ style: n > 40 ? 'HEAVY' : 'LIGHT' }).catch(function () {});
    }
  };
  window.Native = N;
})();
