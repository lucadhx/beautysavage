// ════════════════════════════════════════════════════════
// Theme + Site identity loader
// ════════════════════════════════════════════════════════
async function loadTheme() {
  try {
    const res = await fetch('/api/vitrine/theme');
    if (!res.ok) throw new Error('theme_fetch_failed');
    const data = await res.json();
    const theme = data.theme || {};
    const colors = theme.colors || {};
    const derived = theme.derivedTokens || {};
    const root = document.documentElement;

    const primary = colors.primary || '#c5bb96';
    const secondary = colors.secondary || '#615c4a';
    const surface = colors.surface || '#ffffff';
    const text = colors.text || '#0f172a';
    const background = colors.background || '#ffffff';
    const accent = derived.accent || primary;
    const accentStrong = derived.accentStrong || secondary;

    if (derived.surfaceHeader) {
      root.style.setProperty('--theme-surface-header', derived.surfaceHeader);
    }
    root.style.setProperty('--theme-accent', accent);
    root.style.setProperty('--theme-accent-strong', accentStrong);

    root.style.setProperty('--theme-primary', primary);
    root.style.setProperty('--theme-secondary', secondary);
    root.style.setProperty('--theme-background', background);
    root.style.setProperty('--theme-surface', surface);
    root.style.setProperty('--theme-text', text);

    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-secondary', secondary);
    root.style.setProperty('--color-background', background);
    root.style.setProperty('--color-surface', surface);
    root.style.setProperty('--color-text', text);
  } catch (e) {
    console.warn('[Theme] Chargement echoue, fallback couleurs par defaut');
  }
}

function updateSiteFavicon(logoUrl) {
  const href = String(logoUrl || '').trim();
  const head = document.head || document.querySelector('head');
  if (!head) return;
  if (!href) {
    head.querySelectorAll('link[data-site-favicon-managed="true"]').forEach(link => {
      link.setAttribute('href', '/favicon.ico');
    });
    return;
  }
  ['icon', 'shortcut icon'].forEach(rel => {
    let link =
      head.querySelector(`link[rel="${rel}"][data-site-favicon-managed="true"]`) ||
      head.querySelector(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', rel);
      head.appendChild(link);
    }
    link.setAttribute('data-site-favicon-managed', 'true');
    link.setAttribute('href', href);
  });
}

async function loadSiteIdentity() {
  try {
    const r = await fetch('/api/vitrine/site-identity');
    if (!r.ok) return;
    const data = await r.json();
    const name = data?.siteName || data?.identity?.siteName || 'Beauty Savage';
    const logoUrl = data?.logoUrlResolved || data?.identity?.logoUrlResolved || '';
    updateSiteFavicon(logoUrl);
    const nameNodes = document.querySelectorAll('[data-login-site-name]');
    nameNodes.forEach(n => { n.textContent = name; });
    const logoEl = document.querySelector('[data-login-logo]');
    const fallbackEl = document.querySelector('[data-login-logo-fallback]');
    if (logoUrl && logoEl) {
      logoEl.src = logoUrl; logoEl.hidden = false;
      if (fallbackEl) fallbackEl.hidden = true;
    } else if (fallbackEl) {
      fallbackEl.textContent = (name.match(/\b\w/g) || ['B','S']).slice(0,2).join('').toUpperCase();
      fallbackEl.hidden = false;
      if (logoEl) logoEl.hidden = true;
    }
    return name;
  } catch (_) { return 'Beauty Savage'; }
}

// ════════════════════════════════════════════════════════
// Login form
// ════════════════════════════════════════════════════════
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

async function handleLogin(e) {
  if (e) e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Connexion…';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    console.log('[Login] data recu:', data);

    if (!res.ok) {
      loginError.textContent = data.error || 'Identifiants invalides.';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Se connecter';
      return;
    }

    const role = data.role;

    // Developer → redirect directly, never a modal
    if (role === 'developer' || role === 'dev') {
      window.location.replace('/gestion.html');
      return;
    }

    if (role !== 'admin') {
      loginError.textContent = 'Accès réservé aux administrateurs et développeurs.';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Se connecter';
      return;
    }

    // Admin: login response includes blocked info from the backend
    if (data.blocked === true) {
      if (data.reason === 'pending') {
        // Contract pending → open settlement modal
        loginBtn.disabled = false;
        loginBtn.textContent = 'Se connecter';
        await openContractModal();
        return;
      }
      // no_contract or unknown reason
      loginError.textContent = 'Aucun contrat actif. Contactez votre prestataire.';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Se connecter';
      return;
    }

    // Admin + active contract → direct redirect
    window.location.replace('/gestion.html');
  } catch (err) {
    loginError.textContent = 'Erreur de connexion. Réessayez.';
    loginBtn.disabled = false;
    loginBtn.textContent = 'Se connecter';
  }
}

loginBtn.addEventListener('click', handleLogin);
loginForm.addEventListener('submit', handleLogin);

// ════════════════════════════════════════════════════════
// Settlement Modal
// ════════════════════════════════════════════════════════
const overlay = document.getElementById('contract-modal');
const nextBtn = document.getElementById('settlement-next-btn');
const retryBtn = document.getElementById('settlement-retry-btn');
const slideTitle = document.getElementById('settlement-slide-title');
const dotsContainer = document.getElementById('settlement-dots');
retryBtn.hidden = false;
retryBtn.style.display = 'none';

let contractData = null;
let stripeInstance = null;
let launchElements = null;
let monthlyElements = null;
let launchPaymentElement = null;
let monthlyPaymentElement = null;
let currentSlide = 1;
let slideSequence = [];
let fileWasDownloaded = false;
let siteName = 'Beauty Savage';
let retryClickAbortController = null;
let paymentSubmitAbortController = null;
let launchSubmitInFlight = false;
let monthlySubmitInFlight = false;

function formatEur(cents) {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatEurFromAmount(amount) {
  return Number(amount || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function amountTtcCents(amount, taxRate) {
  return Math.round(Number(amount || 0) * (1 + Number(taxRate || 0)) * 100);
}

async function openContractModal() {
  let resumeSlide = 1;
  try {
    const r = await fetch('/api/contract/pending-info', { credentials: 'include' });
    const d = await r.json();
    if (!r.ok || !d.ok) {
      loginError.textContent = d.error || 'Impossible de charger le contrat.';
      return;
    }
    contractData = d.contract;
    fileWasDownloaded = d.fileDownloaded || d.contract.fileDownloaded || Boolean(d.contract.fileDownloadedAt);
    resumeSlide = d.resumeSlide || 1;
  } catch (_) {
    loginError.textContent = 'Erreur lors du chargement du contrat.';
    return;
  }

  const hasLaunch = (contractData.launchFee?.amount || 0) > 0;
  const hasMonthly = (contractData.monthlyFee?.amount || 0) > 0;

  slideSequence = [1, 2];
  if (hasLaunch) { slideSequence.push(3, 4); }
  if (hasLaunch && hasMonthly) { slideSequence.push(5); }
  if (hasMonthly) { slideSequence.push(6, 7); }
  slideSequence.push(8);

  buildDots();
  populateSlide1(hasLaunch, hasMonthly);
  populateSlide2();
  if (hasLaunch) populateSlide3();
  // Pré-initialiser slide 6 uniquement si le launch fee est déjà réglé (ou absent)
  // — évite un 409 immédiat si l'admin arrive sur slide 1 avec launch fee impayé
  const launchReady = !Number(contractData.launchFee?.amount || 0) || contractData.launchFee?.paid;
  if (hasMonthly && launchReady) populateSlide6();

  overlay.hidden = false;
  goToSlide(resumeSlide);

  if (resumeSlide > 1) {
    showResumeBanner(resumeSlide);
  }

  // Si reprise sur slide 8, charger le suivi d'activation
  if (resumeSlide === 8) {
    populateSlide8();
  }
}

function buildDots() {
  dotsContainer.innerHTML = '';
  slideSequence.forEach(n => {
    const dot = document.createElement('span');
    dot.className = 'settlement-dot';
    dot.dataset.slide = n;
    dotsContainer.appendChild(dot);
  });
}

function updateDots() {
  const idx = slideSequence.indexOf(currentSlide);
  dotsContainer.querySelectorAll('.settlement-dot').forEach((dot, i) => {
    dot.className = 'settlement-dot' + (i < idx ? ' done' : i === idx ? ' active' : '');
  });
}

const SLIDE_TITLES = {
  1: 'Votre contrat',
  2: 'Acceptation',
  3: 'Frais de lancement',
  4: 'Vérification paiement',
  5: 'Lancement confirmé',
  6: 'Souscription mensuelle',
  7: 'Vérification souscription',
  8: 'Activation'
};

function showSlide(n) {
  document.querySelectorAll('.slide').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`slide-${n}`);
  if (el) el.classList.add('active');
  slideTitle.textContent = SLIDE_TITLES[n] || '';
  updateDots();
  configureFooterForSlide(n);
}

function configureFooterForSlide(n) {
  clearPaymentSubmitListener();
  hideRetryButton();
  nextBtn.style.opacity = '';
  nextBtn.style.cursor = '';
  nextBtn.hidden = false;

  switch (n) {
    case 1:
      nextBtn.textContent = 'Démarrer';
      nextBtn.disabled = false;
      break;
    case 2:
      nextBtn.textContent = 'Continuer';
      nextBtn.disabled = !document.getElementById('s2-accept-checkbox').checked;
      break;
    case 3:
      nextBtn.textContent = 'Payer';
      nextBtn.disabled = false;
      launchSubmitInFlight = false;
      armPaymentSubmitListener(3);
      break;
    case 4:
      nextBtn.hidden = true;
      break;
    case 5:
      nextBtn.textContent = 'Souscrire à la maintenance';
      nextBtn.disabled = false;
      break;
    case 6:
      nextBtn.textContent = 'Souscrire';
      nextBtn.disabled = false;
      monthlySubmitInFlight = false;
      armPaymentSubmitListener(6);
      break;
    case 7:
      nextBtn.hidden = true;
      break;
    case 8:
      nextBtn.innerHTML = '<i class="bi bi-rocket-takeoff" aria-hidden="true"></i> Activer le contrat';
      nextBtn.disabled = false;
      break;
    default:
      nextBtn.disabled = false;
  }
}

function setPaymentSubmitLoadingState() {
  nextBtn.disabled = true;
  nextBtn.style.opacity = '0.4';
  nextBtn.style.cursor = 'not-allowed';
}

function clearPaymentSubmitListener() {
  if (paymentSubmitAbortController) {
    paymentSubmitAbortController.abort();
    paymentSubmitAbortController = null;
  }
}

function armPaymentSubmitListener(slideNumber) {
  paymentSubmitAbortController = new AbortController();
  nextBtn.addEventListener('click', async (event) => {
    if (currentSlide !== slideNumber) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (slideNumber === 3) {
      if (launchSubmitInFlight) return;
      launchSubmitInFlight = true;
      setPaymentSubmitLoadingState();
      await confirmLaunchPayment();
      return;
    }

    if (slideNumber === 6) {
      if (monthlySubmitInFlight) return;
      monthlySubmitInFlight = true;
      setPaymentSubmitLoadingState();
      await confirmMonthlySetup();
    }
  }, { once: true, capture: true, signal: paymentSubmitAbortController.signal });
}

function hideRetryButton() {
  if (retryClickAbortController) {
    retryClickAbortController.abort();
    retryClickAbortController = null;
  }
  retryBtn.style.display = 'none';
}

function showRetryButton() {
  hideRetryButton();
  retryBtn.style.display = 'block';
  const targetSlide = currentSlide;
  retryClickAbortController = new AbortController();
  retryBtn.addEventListener('click', () => {
    retryBtn.style.display = 'none';
    const icon = retryBtn.querySelector('.retry-icon');
    if (icon) {
      retryBtn.classList.add('spinning');
      setTimeout(() => retryBtn.classList.remove('spinning'), 600);
    }

    if (targetSlide === 4) {
      currentSlide = 3;
      showSlide(3);
    } else if (targetSlide === 7) {
      currentSlide = 6;
      showSlide(6);
    }
    retryClickAbortController = null;
  }, { once: true, signal: retryClickAbortController.signal });
}

function goNext() {
  const idx = slideSequence.indexOf(currentSlide);
  if (idx < slideSequence.length - 1) {
    currentSlide = slideSequence[idx + 1];
    showSlide(currentSlide);
  }
}

function goToSlide(n) {
  // If slide not in current sequence, find the closest preceding one
  if (!slideSequence.includes(n)) {
    const before = slideSequence.filter(s => s <= n);
    n = before.length ? before[before.length - 1] : slideSequence[0];
  }
  currentSlide = n;
  showSlide(n);
}

const RESUME_SLIDE_LABELS = {
  3: 'Paiement des frais de lancement',
  5: 'Souscription mensuelle à finaliser',
  6: 'Souscription mensuelle à finaliser',
  8: 'Activation'
};

function showResumeBanner(slide) {
  const banner = document.getElementById('resume-banner');
  if (!banner) return;
  const label = RESUME_SLIDE_LABELS[slide] || `étape ${slide}`;
  banner.querySelector('.resume-banner__text').textContent =
    `Reprise de votre activation — ${label}`;
  banner.hidden = false;
  // Force reflow so transition plays
  banner.offsetHeight; // eslint-disable-line no-unused-expressions
  banner.classList.add('resume-banner--visible');
  setTimeout(() => {
    banner.classList.add('resume-banner--hiding');
    banner.addEventListener('animationend', () => {
      banner.hidden = true;
      banner.classList.remove('resume-banner--visible', 'resume-banner--hiding');
    }, { once: true });
  }, 4000);
}

// ── Slide 1 ──────────────────────────────────────────────
function populateSlide1(hasLaunch, hasMonthly) {
  document.getElementById('s1-institute-name').textContent = siteName;

  const amountsEl = document.getElementById('s1-amounts');
  amountsEl.innerHTML = '';
  const rows = [];

  if (hasLaunch) {
    const ht = Number(contractData.launchFee.amount || 0);
    const tax = Number(contractData.launchFee.taxRate || 0);
    const ttc = ht * (1 + tax);
    rows.push({ label: 'Frais de lancement HT', value: formatEurFromAmount(ht) });
    rows.push({ label: 'TVA', value: `${(tax * 100).toFixed(0)}%` });
    rows.push({ label: 'Frais de lancement TTC', value: formatEurFromAmount(ttc) });
  }
  if (hasMonthly) {
    const ht = Number(contractData.monthlyFee.amount || 0);
    const tax = Number(contractData.monthlyFee.taxRate || 0);
    const ttc = ht * (1 + tax);
    rows.push({ label: 'Mensualité HT', value: formatEurFromAmount(ht) });
    rows.push({ label: 'TVA mensualité', value: `${(tax * 100).toFixed(0)}%` });
    rows.push({ label: 'Mensualité TTC', value: `${formatEurFromAmount(ttc)} / mois` });
  }
  if (!hasLaunch && !hasMonthly) {
    rows.push({ label: 'Contrat gratuit', value: '0,00 €' });
  }
  rows.forEach(({ label, value }) => {
    amountsEl.innerHTML += `
      <div class="slide-amount-row">
        <span class="slide-amount-label">${label}</span>
        <span class="slide-amount-value">${value}</span>
      </div>`;
  });

  const policyWrap = document.getElementById('s1-policy-wrap');
  const policy = contractData.cancellationPolicy || {};
  if (policy.type === 'locked' && policy.lockedMonths) {
    policyWrap.innerHTML = `<span class="slide-policy-badge locked">
      <i class="bi bi-lock-fill" aria-hidden="true"></i>
      Engagement minimum de <strong>${policy.lockedMonths} mois</strong>
    </span>`;
  } else {
    policyWrap.innerHTML = `<span class="slide-policy-badge anytime">
      <i class="bi bi-check2-circle" aria-hidden="true"></i>
      Résiliable à tout moment
    </span>`;
  }

  const stepsEl = document.getElementById('s1-steps');
  stepsEl.innerHTML = '';
  const steps = ['Lecture et acceptation du contrat'];
  if (hasLaunch) steps.push('Règlement des frais de lancement');
  if (hasMonthly) steps.push('Souscription mensuelle');
  steps.push('Activation du site');
  steps.forEach(s => {
    stepsEl.innerHTML += `<li><i class="bi bi-dot" aria-hidden="true"></i>${s}</li>`;
  });
}

// ── Slide 2 ──────────────────────────────────────────────
function unlockCheckbox() {
  const label = document.getElementById('s2-accept-label');
  const lockIcon = document.getElementById('s2-lock-icon');
  const checkbox = document.getElementById('s2-accept-checkbox');
  label.classList.remove('slide-checkbox-row--locked');
  label.classList.add('slide-checkbox-row--unlocked');
  label.removeAttribute('title');
  lockIcon.className = 'bi bi-unlock-fill s2-lock-unlocking';
  lockIcon.addEventListener('animationend', () => {
    lockIcon.classList.remove('s2-lock-unlocking');
  }, { once: true });
  checkbox.disabled = false;
}

function populateSlide2() {
  const fileOrigName = contractData.fileOriginalName || 'contrat.pdf';
  const ext = fileOrigName.split('.').pop().toLowerCase();
  const icon = document.getElementById('s2-file-icon');
  icon.className = ext === 'pdf'
    ? 'bi bi-file-earmark-pdf'
    : 'bi bi-file-earmark-word';

  const checkbox = document.getElementById('s2-accept-checkbox');
  const downloadStatus = document.getElementById('s2-download-status');

  if (fileWasDownloaded) {
    unlockCheckbox();
    downloadStatus.textContent = 'Fichier déjà téléchargé.';
    document.getElementById('s2-download-btn').textContent = 'Télécharger à nouveau';
  }

  checkbox.addEventListener('change', () => {
    if (currentSlide === 2) {
      nextBtn.disabled = !checkbox.checked;
      if (checkbox.checked) {
        checkbox.classList.add('s2-checkbox-popping');
        checkbox.addEventListener('animationend', () => {
          checkbox.classList.remove('s2-checkbox-popping');
        }, { once: true });
      }
    }
  });
}

document.getElementById('s2-download-btn').addEventListener('click', async () => {
  const btn = document.getElementById('s2-download-btn');
  const status = document.getElementById('s2-download-status');
  const checkbox = document.getElementById('s2-accept-checkbox');
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split" aria-hidden="true"></i>&nbsp;Téléchargement…';
  try {
    const r = await fetch('/api/contract/download-file', {
      method: 'POST',
      credentials: 'include'
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      status.textContent = d.error || 'Erreur lors du téléchargement.';
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-download" aria-hidden="true"></i>&nbsp;Lire le contrat';
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = r.headers.get('content-disposition') || '';
    const fnMatch = cd.match(/filename="?([^"]+)"?/);
    a.download = fnMatch ? fnMatch[1] : (contractData?.fileOriginalName || 'contrat.pdf');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    fileWasDownloaded = true;
    status.textContent = 'Téléchargement confirmé.';
    unlockCheckbox();
    btn.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i>&nbsp;Téléchargé';
  } catch (err) {
    status.textContent = 'Erreur réseau. Réessayez.';
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-download" aria-hidden="true"></i>&nbsp;Lire le contrat';
  }
});

// ── Slide 3 — Launch payment ─────────────────────────────
async function populateSlide3() {
  const ht = Number(contractData.launchFee.amount || 0);
  const tax = Number(contractData.launchFee.taxRate || 0);
  const ttcCents = amountTtcCents(ht, tax);

  document.getElementById('s3-amount-display').textContent = formatEur(ttcCents);
  document.getElementById('s3-amount-detail').textContent =
    `${formatEurFromAmount(ht)} HT + TVA ${(tax * 100).toFixed(0)}%`;

  try {
    const r = await fetch('/api/contract/create-launch-intent', {
      method: 'POST',
      credentials: 'include'
    });
    const d = await r.json();
    if (!r.ok || !d.ok) {
      document.getElementById('s3-error').textContent = d.error || 'Impossible d\'initialiser le paiement.';
      return;
    }
    if (d.alreadyProcessed) {
      const info = await fetch('/api/contract/pending-info', { credentials: 'include' }).then(res => res.json());
      if (info.ok) goToSlide(info.resumeSlide || 8);
      return;
    }

    const configR = await fetch('/api/stripe/config');
    const configD = await configR.json();
    const devKeyR = await fetch('/api/contract/stripe-dev-config');
    const devKeyD = await devKeyR.json().catch(() => ({}));
    const pubKey = devKeyD.publishableKey || configD.publishableKey;

    stripeInstance = Stripe(pubKey);
    launchElements = stripeInstance.elements({ clientSecret: d.clientSecret });
    launchPaymentElement = launchElements.create('payment');
    launchPaymentElement.mount('#launch-payment-element');
  } catch (err) {
    document.getElementById('s3-error').textContent = 'Erreur lors de l\'initialisation du paiement.';
  }
}

// ── Slide 4 — Launch result ──────────────────────────────
async function confirmLaunchPayment() {
  document.getElementById('s3-error').textContent = '';
  goNext();

  if (!stripeInstance || !launchElements) {
    setS4Result('error', 'Stripe non initialisé.');
    return;
  }

  try {
    const { error, paymentIntent } = await stripeInstance.confirmPayment({
      elements: launchElements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required'
    });

    if (error) {
      setS4Result('error', error.message || 'Paiement échoué.');
      return;
    }
    if (paymentIntent?.status === 'succeeded') {
      setS4Result('pending', 'Vérification en cours...');
      const verifyRes = await fetch('/api/contract/verify-launch-payment', {
        method: 'POST',
        credentials: 'include'
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (verifyRes.ok && verifyData?.ok === true) {
        setS4Result('success', 'Paiement validé !');
        setTimeout(() => goNext(), 1500);
      } else {
        setS4Result('error', 'Paiement non confirmé par le serveur. Réessayez.');
      }
    } else {
      setS4Result('error', 'Paiement non finalisé. Statut : ' + (paymentIntent?.status || 'inconnu'));
    }
  } catch (err) {
    setS4Result('error', 'Erreur réseau. Réessayez.');
  }
}

function setS4Result(type, message) {
  const el = document.getElementById('s4-result');
  if (type === 'success') {
    el.innerHTML = `
      <div class="result-icon success pop-in"><i class="bi bi-check-circle-fill" aria-hidden="true"></i></div>
      <p class="result-label">${message}</p>`;
    hideRetryButton();
  } else if (type === 'pending') {
    el.innerHTML = `
      <div class="result-icon"><i class="bi bi-hourglass-split" aria-hidden="true"></i></div>
      <p class="result-label">${message}</p>`;
    hideRetryButton();
    nextBtn.hidden = true;
  } else {
    el.innerHTML = `
      <div class="result-icon error shake"><i class="bi bi-x-circle-fill" aria-hidden="true"></i></div>
      <p class="result-label">${message}</p>`;
    showRetryButton();
    nextBtn.hidden = true;
  }
}

// ── Slide 5 — Transition ─────────────────────────────────
function populateSlide5() {
  const monthly = contractData.monthlyFee;
  const ht = Number(monthly?.amount || 0);
  const tax = Number(monthly?.taxRate || 0);
  const ttc = ht * (1 + tax);
  document.getElementById('s5-monthly-recap').innerHTML =
    `<strong>${formatEurFromAmount(ttc)} TTC / mois</strong><br>
     <span style="font-size:0.8rem;opacity:0.6">${formatEurFromAmount(ht)} HT + TVA ${(tax * 100).toFixed(0)}%</span>`;
}

// ── Slide 6 — Monthly setup ──────────────────────────────
async function populateSlide6() {
  const monthly = contractData.monthlyFee;
  const ht = Number(monthly?.amount || 0);
  const tax = Number(monthly?.taxRate || 0);
  const ttcCents = amountTtcCents(ht, tax);

  document.getElementById('s6-amount-display').textContent = formatEur(ttcCents) + ' / mois';
  document.getElementById('s6-amount-detail').textContent =
    `${formatEurFromAmount(ht)} HT + TVA ${(tax * 100).toFixed(0)}%`;

  try {
    const r = await fetch('/api/contract/create-monthly-setup', {
      method: 'POST',
      credentials: 'include'
    });
    const d = await r.json();
    if (!r.ok || !d.ok) {
      document.getElementById('s6-error').textContent = d.error || 'Impossible d\'initialiser la souscription.';
      return;
    }
    if (d.alreadyProcessed) {
      const info = await fetch('/api/contract/pending-info', { credentials: 'include' }).then(res => res.json());
      if (info.ok) goToSlide(info.resumeSlide || 8);
      return;
    }

    const devKeyR = await fetch('/api/contract/stripe-dev-config');
    const devKeyD = await devKeyR.json().catch(() => ({}));
    const configR = await fetch('/api/stripe/config');
    const configD = await configR.json();
    const pubKey = devKeyD.publishableKey || configD.publishableKey;

    if (!stripeInstance) stripeInstance = Stripe(pubKey);
    monthlyElements = stripeInstance.elements({ clientSecret: d.clientSecret });
    monthlyPaymentElement = monthlyElements.create('payment');
    monthlyPaymentElement.mount('#monthly-payment-element');
  } catch (err) {
    document.getElementById('s6-error').textContent = 'Erreur lors de l\'initialisation de la souscription.';
  }
}

// ── Slide 7 — Monthly result ─────────────────────────────
async function confirmMonthlySetup() {
  document.getElementById('s6-error').textContent = '';
  goNext();

  if (!stripeInstance || !monthlyElements) {
    setS7Result('error', 'Stripe non initialisé.');
    return;
  }

  try {
    const { error, setupIntent } = await stripeInstance.confirmSetup({
      elements: monthlyElements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required'
    });

    if (error) {
      setS7Result('error', error.message || 'Souscription échouée.');
      return;
    }
    if (setupIntent?.status === 'succeeded') {
      setS7Result('pending', 'Vérification en cours...');
      const verifyRes = await fetch('/api/contract/verify-monthly-setup', {
        method: 'POST',
        credentials: 'include'
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (verifyRes.ok && verifyData?.ok === true) {
        setS7Result('success', 'Souscription enregistrée !');
        setTimeout(() => {
          removeSlide7InjectedButtons();
          goToSlide(8);
          populateSlide8();
        }, 2000);
      } else {
        setS7Result('error', 'Souscription non confirmée par le serveur. Réessayez.');
      }
    } else {
      setS7Result('error', 'Statut inattendu : ' + (setupIntent?.status || 'inconnu'));
    }
  } catch (err) {
    setS7Result('error', 'Erreur réseau. Réessayez.');
  }
}

function removeSlide7InjectedButtons() {
  const slide7 = document.getElementById('slide-7');
  if (!slide7) return;
  slide7.querySelectorAll('button').forEach((buttonEl) => {
    buttonEl.remove();
  });
}

function setS7Result(type, message) {
  const el = document.getElementById('s7-result');
  if (type === 'success') {
    el.innerHTML = `
      <div class="result-icon success pop-in"><i class="bi bi-check-circle-fill" aria-hidden="true"></i></div>
      <p class="result-label">${message}</p>`;
    hideRetryButton();
  } else if (type === 'pending') {
    el.innerHTML = `
      <div class="result-icon"><i class="bi bi-hourglass-split" aria-hidden="true"></i></div>
      <p class="result-label">${message}</p>`;
    hideRetryButton();
    nextBtn.hidden = true;
  } else {
    el.innerHTML = `
      <div class="result-icon error shake"><i class="bi bi-x-circle-fill" aria-hidden="true"></i></div>
      <p class="result-label">${message}</p>`;
    showRetryButton();
    nextBtn.hidden = true;
  }
}

// ── Slide 8 — Récapitulatif et activation ─────────────────
let s8PollingTimer = null;

function stopSlide8Polling() {
  if (s8PollingTimer) {
    clearInterval(s8PollingTimer);
    s8PollingTimer = null;
  }
}

function populateSlide8() {
  const content = document.getElementById('slide-8-content');
  if (!content) return;
  stopSlide8Polling();
  hideRetryButton();

  const hasLaunch = Number(contractData?.launchFee?.amount || 0) > 0;
  const hasMonthly = Number(contractData?.monthlyFee?.amount || 0) > 0;
  const policy = contractData?.cancellationPolicy || {};
  const isLocked = policy.type === 'locked' && policy.lockedMonths;

  const items = [];
  if (!hasLaunch && !hasMonthly) {
    items.push({ label: 'Contrat gratuit', icon: 'bi-check-circle-fill', color: 'var(--color-success,#1f7a3a)' });
  } else {
    if (hasLaunch) {
      const ttc = amountTtcCents(contractData.launchFee.amount, contractData.launchFee.taxRate);
      items.push({ label: `Frais de lancement ${formatEur(ttc)} réglés`, icon: 'bi-check-circle-fill', color: 'var(--color-success,#1f7a3a)' });
    }
    if (hasMonthly) {
      const ttc = amountTtcCents(contractData.monthlyFee.amount, contractData.monthlyFee.taxRate);
      items.push({ label: `Souscription mensuelle ${formatEur(ttc)}/mois activée`, icon: 'bi-check-circle-fill', color: 'var(--color-success,#1f7a3a)' });
    }
  }
  if (isLocked) {
    items.push({ label: `Engagement minimum de ${policy.lockedMonths} mois`, icon: 'bi-lock-fill', color: 'rgba(15,23,42,0.45)' });
  }

  content.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0">
      <p style="font-size:0.8rem;font-weight:700;opacity:0.45;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.65rem">Récapitulatif</p>
      ${items.map(item => `
        <div style="display:flex;align-items:center;gap:0.6rem;padding:0.42rem 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:0.9rem">
          <i class="bi ${item.icon}" style="font-size:1.1rem;color:${item.color};flex-shrink:0"></i>
          <span>${item.label}</span>
        </div>`).join('')}
    </div>
    <div style="margin-top:1.25rem">
      <div id="s8-activate-area"></div>
    </div>
  `;
}

function showActivationConfirmModal(isLocked, lockedMonths) {
  const existing = document.getElementById('s8-confirm-overlay');
  if (existing) existing.remove();

  let lockWarning = '';
  if (isLocked && lockedMonths) {
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + lockedMonths);
    const formatted = endDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    lockWarning = `
      <div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.65rem 0.85rem;background:rgba(245,158,11,0.08);border-radius:0.6rem;margin-top:0.75rem;font-size:0.84rem">
        <i class="bi bi-lock-fill" style="color:#b45309;flex-shrink:0;margin-top:0.1rem" aria-hidden="true"></i>
        <span>Engagement minimum de <strong>${lockedMonths} mois</strong> — non résiliable avant le <strong>${formatted}</strong>.</span>
      </div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 's8-confirm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:var(--color-surface,#fff);border-radius:1.1rem;padding:1.5rem;width:100%;max-width:380px;box-shadow:0 8px 40px rgba(0,0,0,0.22)">
      <h3 style="font-size:1rem;font-weight:700;margin:0 0 0.4rem">Confirmer l'activation</h3>
      <p style="font-size:0.87rem;opacity:0.65;margin:0">À partir de maintenant votre site sera accessible au public.</p>
      ${lockWarning}
      <div style="display:flex;gap:0.75rem;margin-top:1.25rem;flex-wrap:wrap">
        <button id="s8-cancel-btn" type="button"
          style="flex:1;padding:0.6rem 1rem;border-radius:999px;border:1.5px solid rgba(0,0,0,0.14);background:none;font-size:0.9rem;font-weight:600;cursor:pointer;font-family:inherit;color:inherit">
          Annuler
        </button>
        <button id="s8-confirm-btn" type="button"
          style="flex:2;padding:0.6rem 1rem;border-radius:999px;border:none;background:var(--theme-accent,var(--color-primary,#5f4ff7));color:#fff;font-size:0.9rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:0.4rem">
          <i class="bi bi-rocket-takeoff" aria-hidden="true"></i> Confirmer
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#s8-cancel-btn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#s8-confirm-btn').addEventListener('click', () => {
    overlay.remove();
    handleActivateContract();
  });
}

async function handleActivateContract() {
  const mainBtn = nextBtn;
  const activateArea = document.getElementById('s8-activate-area');

  if (mainBtn) {
    mainBtn.disabled = true;
    mainBtn.innerHTML = '<i class="bi bi-hourglass-split" aria-hidden="true"></i> Activation…';
  }
  if (activateArea) {
    activateArea.innerHTML = '<div class="spin-loader" style="min-height:70px"></div>';
  }

  try {
    const r = await fetch('/api/contract/activate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const d = await r.json();

    if (!r.ok) {
      if (mainBtn) {
        mainBtn.disabled = false;
        mainBtn.innerHTML = '<i class="bi bi-rocket-takeoff" aria-hidden="true"></i> Activer le contrat';
      }
      if (activateArea) {
        activateArea.innerHTML = `<p class="s8-activate-error" style="margin-top:0.5rem"><i class="bi bi-exclamation-triangle"></i> ${d.error || 'Erreur lors de l\'activation.'}</p>`;
      }
      return;
    }

    // Succès — remplacer le contenu entier de la slide
    const content = document.getElementById('slide-8-content');
    if (content) {
      content.innerHTML = `
        <div style="text-align:center;padding:1rem 0;display:flex;flex-direction:column;align-items:center;gap:0.75rem">
          <i class="bi bi-check-circle-fill pop-in"
            style="font-size:4.5rem;color:var(--color-success,#1f7a3a);display:block"></i>
          <h3 style="font-size:1.2rem;font-weight:800;margin:0">Contrat activé !</h3>
          <p style="font-size:0.88rem;opacity:0.55;margin:0">Redirection vers la vitrine…</p>
        </div>
      `;
    }

    nextBtn.hidden = false;
    nextBtn.textContent = 'Accéder à la vitrine';
    nextBtn.onclick = () => window.location.replace('/');

    setTimeout(() => window.location.replace('/'), 2000);
  } catch (_) {
    if (mainBtn) {
      mainBtn.disabled = false;
      mainBtn.innerHTML = '<i class="bi bi-rocket-takeoff" aria-hidden="true"></i> Activer le contrat';
    }
    if (activateArea) {
      activateArea.innerHTML = '<p class="s8-activate-error" style="margin-top:0.5rem"><i class="bi bi-wifi-off"></i> Erreur réseau.</p>';
    }
  }
}

// startActivationPolling conservée pour compatibilité — non appelée
async function startActivationPolling() {}

// ── Next button dispatcher ────────────────────────────────
nextBtn.addEventListener('click', async () => {
  switch (currentSlide) {
    case 1:
      goNext();
      break;
    case 2:
      if (!document.getElementById('s2-accept-checkbox').checked) return;
      goNext();
      break;
    case 3:
      if (launchSubmitInFlight) return;
      launchSubmitInFlight = true;
      setPaymentSubmitLoadingState();
      await confirmLaunchPayment();
      break;
    case 5:
      if (document.getElementById('slide-5').classList.contains('active')) {
        populateSlide5();
      }
      goNext();
      if (!monthlyPaymentElement) {
        await populateSlide6();
      }
      break;
    case 6:
      if (monthlySubmitInFlight) return;
      monthlySubmitInFlight = true;
      setPaymentSubmitLoadingState();
      await confirmMonthlySetup();
      break;
    case 8: {
      const policy = contractData?.cancellationPolicy || {};
      const isLocked = policy.type === 'locked' && policy.lockedMonths;
      showActivationConfirmModal(isLocked, policy.lockedMonths);
      break;
    }
    default:
      goNext();
  }
});

// ════════════════════════════════════════════════════════
// Init
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await loadTheme();
  siteName = await loadSiteIdentity() || 'Beauty Savage';
});
