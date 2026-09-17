// C3 — Scanner QR présence production-ready (html5-qrcode, open-source, aucun service externe).
// États (init/scanning/denied/error), choix caméra multi, fallback saisie manuelle, debounce
// anti double-scan, vibration mobile, bouton recommencer. Le token reste opaque ; jamais affiché
// en clair après validation (le parent affiche seulement le nom).
import { useCallback, useEffect, useRef, useState } from 'react';

const REGION_ID = 'lrn-qr-region';
const DEBOUNCE_MS = 2500;

type ScanState = 'init' | 'scanning' | 'denied' | 'error';
interface Camera { id: string; label: string }

export function QrScanner({ onDecode, onClose }: { onDecode: (text: string) => void; onClose: () => void }) {
  const instanceRef = useRef<{ start: (...a: unknown[]) => Promise<void>; stop: () => Promise<void>; clear: () => void } | null>(null);
  const lastDecodeRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const [state, setState] = useState<ScanState>('init');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [showManual, setShowManual] = useState(false);

  // Debounce anti double-scan + vibration mobile.
  const handleDecode = useCallback((text: string) => {
    const now = Date.now();
    if (text === lastDecodeRef.current.text && now - lastDecodeRef.current.at < DEBOUNCE_MS) return;
    lastDecodeRef.current = { text, at: now };
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(60);
    }
    onDecode(text);
  }, [onDecode]);

  const stopScanner = useCallback(async () => {
    const inst = instanceRef.current;
    instanceRef.current = null;
    if (inst) {
      try { await inst.stop(); inst.clear(); } catch { /* déjà arrêté */ }
    }
  }, []);

  const startScanner = useCallback(async (camId?: string) => {
    setErrorMsg('');
    try {
      const mod = await import('html5-qrcode');
      const Html5Qrcode = mod.Html5Qrcode;
      // Liste des caméras (déclenche la demande de permission).
      let cams: Camera[] = [];
      try {
        cams = await Html5Qrcode.getCameras();
      } catch {
        setState('denied');
        return;
      }
      if (!cams || cams.length === 0) { setState('error'); setErrorMsg('Aucune caméra détectée.'); return; }
      setCameras(cams);
      const chosen = camId || cameraId || cams[cams.length - 1].id; // arrière par défaut (dernière)
      setCameraId(chosen);
      await stopScanner();
      const instance = new Html5Qrcode(REGION_ID, { verbose: false }) as unknown as typeof instanceRef.current;
      instanceRef.current = instance;
      await instance!.start(
        chosen,
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText: string) => handleDecode(decodedText),
        () => { /* scan miss — ignoré */ },
      );
      setState('scanning');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/permission|denied|NotAllowed/i.test(msg)) { setState('denied'); }
      else { setState('error'); setErrorMsg(msg || 'Caméra indisponible.'); }
    }
  }, [cameraId, handleDecode, stopScanner]);

  useEffect(() => {
    void startScanner();
    return () => { void stopScanner(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitManual() {
    const t = manualToken.trim();
    if (t) { handleDecode(t); setManualToken(''); }
  }

  return (
    <div className="lrn-scanner" data-testid="lrn-scanner" data-state={state}>
      <div className="lrn-scanner__head">
        <span className="lrn-scanner__title"><i className="bi bi-qr-code-scan" aria-hidden="true" /> Scanner une présence</span>
        <button type="button" className="cat-iconbtn" aria-label="Fermer le scanner" onClick={() => { void stopScanner(); onClose(); }}>
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </div>

      {cameras.length > 1 && state === 'scanning' ? (
        <label className="lrn-scanner__camera">
          <span>Caméra</span>
          <select className="cat-input" value={cameraId} onChange={(e) => { setCameraId(e.target.value); void startScanner(e.target.value); }}>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.label || 'Caméra'}</option>)}
          </select>
        </label>
      ) : null}

      <div id={REGION_ID} className="lrn-scanner__region" hidden={state !== 'scanning'} />

      {state === 'init' ? <p className="cat-note" role="status">Activation de la caméra…</p> : null}
      {state === 'scanning' ? <p className="cat-note" role="status">Pointez la caméra sur le QR du participant.</p> : null}
      {state === 'denied' ? (
        <div className="lrn-scanner__fallback">
          <p className="cat-note cat-note--warning" role="alert"><i className="bi bi-camera-video-off" aria-hidden="true" /> Caméra refusée. Autorisez l'accès, ou saisissez le code manuellement.</p>
          <button type="button" className="cat-btn cat-btn--ghost" onClick={() => void startScanner()}>Réessayer la caméra</button>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="lrn-scanner__fallback">
          <p className="cat-note cat-note--error" role="alert">{errorMsg || 'Erreur caméra.'}</p>
          <button type="button" className="cat-btn cat-btn--ghost" onClick={() => void startScanner()}>Recommencer</button>
        </div>
      ) : null}

      {/* Fallback saisie manuelle, toujours disponible. */}
      <div className="lrn-scanner__manual">
        <button type="button" className="lrn-scanner__manualtoggle" aria-expanded={showManual} onClick={() => setShowManual((v) => !v)}>
          <i className={`bi ${showManual ? 'bi-chevron-down' : 'bi-chevron-right'}`} aria-hidden="true" /> Saisie manuelle du code
        </button>
        {showManual ? (
          <div className="cat-form__row">
            <input className="cat-input" placeholder="Code / token présence" value={manualToken} onChange={(e) => setManualToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }} />
            <button type="button" className="cat-btn cat-btn--primary" disabled={!manualToken.trim()} onClick={submitManual}>Valider</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
