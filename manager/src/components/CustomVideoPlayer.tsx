import * as React from 'react';
import { CheckCircle2, FastForward, Loader2, Maximize, Minimize, Pause, Play, Rewind, Shield, Volume2, VolumeX } from 'lucide-react';
import { api } from '@/lib/api';
import { useCompany } from '@/context/CompanyContext';

/** 83 s -> « 1:23 ». */
function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * LE LECTEUR VIDÉO DU MANAGER — une vidéo Streamable (`shortcode`, source
 * résolue à la lecture) OU un fichier hébergé chez nous (`src`), par exemple
 * la vidéo du geste envoyée par une cliente. Même lecteur, mêmes commandes.
 */
export function CustomVideoPlayer({ shortcode, src: directSrc, title }: { shortcode?: string; src?: string; title: string }) {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const { company } = useCompany();
  const [src, setSrc] = React.useState('');
  const [loadingSource, setLoadingSource] = React.useState(Boolean(shortcode) && !directSrc);
  const [sourceError, setSourceError] = React.useState('');
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [current, setCurrent] = React.useState(0);
  const [volume, setVolume] = React.useState(0.9);
  const [muted, setMuted] = React.useState(false);
  const [speed, setSpeed] = React.useState('1');
  const [fullscreen, setFullscreen] = React.useState(false);
  const [volumeOpen, setVolumeOpen] = React.useState(false);
  const [speedOpen, setSpeedOpen] = React.useState(false);
  const companyName = company?.name?.trim() || 'BeautySavage';

  React.useEffect(() => {
    let alive = true;
    // Vidéo hébergée chez nous (livrable envoyé par une cliente) : rien à résoudre.
    if (directSrc) {
      setSrc(directSrc);
      setSourceError('');
      setLoadingSource(false);
      return () => { alive = false; };
    }
    if (!shortcode) {
      setSrc('');
      setLoadingSource(false);
      return () => { alive = false; };
    }
    setLoadingSource(true);
    setSourceError('');
    api.streamablePlaybackUrl(shortcode)
      .then((resolved) => {
        if (!alive) return;
        setSrc(resolved.playbackUrl);
      })
      .catch((err) => {
        if (!alive) return;
        setSourceError(err instanceof Error ? err.message : 'Source video Streamable introuvable');
        setSrc('');
      })
      .finally(() => {
        if (alive) setLoadingSource(false);
    });
    return () => { alive = false; };
  }, [shortcode, directSrc]);

  React.useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, volume]);

  React.useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = Number(speed || 1);
  }, [speed, src]);

  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = ref.current;
      if (video && !video.paused) {
        setCurrent(video.currentTime || 0);
        setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
        frame = window.requestAnimationFrame(tick);
      }
    };
    if (playing) frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [playing]);

  React.useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  React.useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setVolumeOpen(false);
        setSpeedOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video || !src) return;
    if (video.paused) void video.play();
    else video.pause();
  };
  const seek = (delta: number) => {
    const video = ref.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
    setCurrent(video.currentTime || 0);
    setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
  };
  const toggleFullscreen = async () => {
    if (!shellRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await shellRef.current.requestFullscreen().catch(() => {});
  };
  const handleVideoError = React.useCallback(() => {
    setSourceError(directSrc
      ? 'Cette video ne peut pas etre lue par le navigateur (format non supporte ou fichier absent).'
      : 'Streamable a refuse ce flux temporaire. Cliquez sur recharger la source pour en demander une nouvelle.');
    setSrc('');
  }, [directSrc]);
  const reloadTemporarySource = React.useCallback(() => {
    if (!shortcode) return;
    setLoadingSource(true);
    setSourceError('');
    api.streamablePlaybackUrl(shortcode)
      .then((resolved) => setSrc(resolved.playbackUrl))
      .catch((err) => {
        setSrc('');
        setSourceError(err instanceof Error ? err.message : 'Source video Streamable introuvable');
      })
      .finally(() => setLoadingSource(false));
  }, [shortcode]);
  return (
    <div
      ref={shellRef}
      className="overflow-hidden rounded-lg border bg-black text-white shadow-sm"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="relative aspect-video w-full bg-black">
        {loadingSource && <div className="absolute inset-0 grid place-items-center text-sm text-white/70"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Chargement de la video</div>}
        {!loadingSource && sourceError && !src && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-red-200">
            <div className="grid gap-3">
              <span>{sourceError}</span>
              {shortcode && (
                <button type="button" onClick={reloadTemporarySource} className="justify-self-center rounded-md border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">
                  Recharger la video
                </button>
              )}
            </div>
          </div>
        )}
        {src && (
          <video
            ref={ref}
            src={src}
            className="h-full w-full bg-black object-contain"
            playsInline
            preload="metadata"
            controls={false}
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onError={handleVideoError}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              setCurrent(video.currentTime || 0);
              setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
            }}
          />
        )}
        {src && (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Mettre en pause' : 'Lire'}
            className="absolute inset-0 z-10 cursor-pointer bg-transparent"
          />
        )}
        <div className="pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs font-semibold text-white/85 backdrop-blur">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span>{companyName}</span>
        </div>
      </div>
      <div className="grid gap-3 border-t border-white/10 bg-gradient-to-r from-primary/35 via-black to-primary/20 p-3">
        <input
          type="range"
          min="0"
          max="1000"
          value={Math.round(progress * 10)}
          onChange={(event) => {
            const video = ref.current;
            const next = Number(event.target.value) / 10;
            setProgress(next);
            if (video && duration) {
              video.currentTime = (next / 100) * duration;
              setCurrent(video.currentTime || 0);
            }
          }}
          className="h-2 w-full cursor-pointer accent-primary"
          aria-label="Progression video"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={toggle} disabled={!src || loadingSource} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow disabled:opacity-50" aria-label={playing ? 'Pause' : 'Lecture'}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
            <button type="button" onClick={() => seek(-10)} disabled={!src} className="hidden h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40 sm:inline-flex" aria-label="Reculer de 10 secondes">
              <Rewind className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => seek(10)} disabled={!src} className="hidden h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40 sm:inline-flex" aria-label="Avancer de 10 secondes">
              <FastForward className="h-4 w-4" />
            </button>
            <span className="hidden text-xs tabular-nums text-white/75 sm:inline">{formatClock(current)} / {formatClock(duration)}</span>
          </div>
          <p className="min-w-0 flex-1 truncate px-1 text-xs font-semibold sm:text-sm">{title}</p>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <div className="relative">
              <button type="button" onClick={() => { setVolumeOpen((value) => !value); setSpeedOpen(false); }} disabled={!src} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40" aria-label={muted ? 'Activer le son' : 'Regler le son'}>
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
              {volumeOpen && (
                <div className="absolute bottom-11 right-0 z-30 rounded-lg border border-white/15 bg-black/90 p-3 shadow-xl">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(volume * 100)}
                    onChange={(event) => {
                      const next = Number(event.target.value) / 100;
                      setVolume(next);
                      setMuted(next === 0);
                    }}
                    className="w-28 accent-primary"
                    aria-label="Volume"
                  />
                  <button type="button" className="mt-2 w-full rounded px-2 py-1 text-xs hover:bg-white/10" onClick={() => setMuted((value) => !value)}>
                    {muted ? 'Activer' : 'Couper'}
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button type="button" onClick={() => { setSpeedOpen((value) => !value); setVolumeOpen(false); }} disabled={!src} className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-xs font-semibold text-white/85 hover:bg-white/10 disabled:opacity-40" aria-label="Vitesse">
                {speed}x
              </button>
              {speedOpen && (
                <div className="absolute bottom-11 right-0 z-30 min-w-28 rounded-lg border border-white/15 bg-black/90 p-1 shadow-xl">
                  {['0.75', '1', '1.25', '1.5', '2'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-xs hover:bg-white/10"
                      onClick={() => {
                        setSpeed(value);
                        setSpeedOpen(false);
                      }}
                    >
                      <span>{value}x</span>
                      {speed === value && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={toggleFullscreen} disabled={!src} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40" aria-label={fullscreen ? 'Quitter le plein ecran' : 'Plein ecran'}>
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

