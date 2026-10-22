import { hotelData } from "../data/hotel";

interface TimelineSegment {
  type: "stop" | "connector";
  index: number;
  weight: number;
  start: number; // 0 to 1
  end: number;   // 0 to 1
}

export class ScrollWorldEngine {
  private container: HTMLElement;
  private track: HTMLElement;
  private timelineNav: HTMLElement | null;
  private canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stillImages: HTMLImageElement[] = [];
  private videoElements: HTMLVideoElement[] = [];
  private textSections: HTMLElement[] = [];
  private progressIndicators: HTMLElement[] = [];

  private segments: TimelineSegment[] = [];
  private totalWeight: number = 0;

  private isMobile: boolean = false;
  private prefersReducedMotion: boolean = false;

  private currentProgress: number = 0;
  private targetProgress: number = 0;
  private lastFrameTime: number = performance.now();
  private videoReady: boolean[] = [false, false, false, false];
  private pendingSeekTimes: (number | null)[] = [null, null, null, null];
  private preloadedClips: Set<number> = new Set([0]);

  private rafId: number | null = null;
  private activeMedia: HTMLImageElement | HTMLVideoElement | null = null;
  private activeStopIndex: number = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    const track = container.querySelector<HTMLElement>("#scroll-world-track");
    this.timelineNav = container.querySelector<HTMLElement>("#sw-vertical-timeline");
    this.canvas = container.querySelector<HTMLCanvasElement>("#ambilight-canvas");

    if (!track) {
      throw new Error("ScrollWorldEngine: Missing #scroll-world-track element.");
    }

    this.track = track;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    }

    // Queries
    this.isMobile = window.matchMedia("(max-width: 1023px)").matches;
    this.prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Elements
    this.stillImages = Array.from(container.querySelectorAll<HTMLImageElement>(".sw-still-img"));
    this.videoElements = Array.from(container.querySelectorAll<HTMLVideoElement>(".sw-connector-video"));
    this.textSections = Array.from(container.querySelectorAll<HTMLElement>(".sw-narrative-section"));
    this.progressIndicators = Array.from(container.querySelectorAll<HTMLElement>(".sw-progress-item"));

    this.buildTimeline();
    this.initMedia();
    this.bindEvents();
    this.startLoop();
  }

  private buildTimeline() {
    this.segments = [];
    const { sections, connScroll } = hotelData.scrollWorld;

    const rawSegments: { type: "stop" | "connector"; index: number; weight: number }[] = [];

    for (let i = 0; i < sections.length; i++) {
      rawSegments.push({
        type: "stop",
        index: i,
        weight: sections[i].scrollWeight
      });

      if (i < sections.length - 1) {
        rawSegments.push({
          type: "connector",
          index: i, // connector i goes from stop i to stop i+1
          weight: connScroll
        });
      }
    }

    this.totalWeight = rawSegments.reduce((sum, seg) => sum + seg.weight, 0);

    let currentOffset = 0;
    this.segments = rawSegments.map((seg) => {
      const start = currentOffset / this.totalWeight;
      currentOffset += seg.weight;
      const end = currentOffset / this.totalWeight;
      return {
        ...seg,
        start,
        end
      };
    });
  }

  private initMedia() {
    // 1. Mostrar sólo el still 0 inicialmente y pre-decodificar todos los stills en GPU
    this.stillImages.forEach((img, idx) => {
      img.style.opacity = idx === 0 ? "1" : "0";
      if (this.isMobile) {
        img.style.objectPosition =
          hotelData.scrollWorld.sections[idx]?.mobileObjectPosition || "center center";
      } else {
        img.style.objectPosition = "center center";
      }
      if (typeof img.decode === "function") {
        img.decode().catch(() => {});
      }
    });

    // 2. Configurar los 4 clips de vídeo y registrar estado persistente de decodificación + cola de seek
    const connectors = this.isMobile
      ? hotelData.scrollWorld.connectorsMobile
      : hotelData.scrollWorld.connectors;

    this.videoElements.forEach((video, idx) => {
      video.style.opacity = "0";
      video.muted = true;
      video.playsInline = true;
      video.pause();

      const markReady = () => {
        if (video.readyState >= 1) {
          this.videoReady[idx] = true;
        }
      };

      video.addEventListener("loadedmetadata", markReady);
      video.addEventListener("loadeddata", markReady);
      video.addEventListener("canplay", markReady);

      // En cuanto termina un seek en curso, si hay un targetTime más reciente pendiente, saltar inmediatamente a él
      video.addEventListener("seeked", () => {
        this.videoReady[idx] = true;
        const pending = this.pendingSeekTimes[idx];
        if (pending !== null && Math.abs(video.currentTime - pending) > 0.025) {
          const nextTarget = pending;
          this.pendingSeekTimes[idx] = null;
          try {
            video.currentTime = nextTarget;
          } catch {
            // Ignorar si aún no está disponible
          }
        } else {
          this.pendingSeekTimes[idx] = null;
        }
      });

      if (connectors[idx] && video.getAttribute("src") !== connectors[idx]) {
        video.src = connectors[idx];
      }

      if (!this.prefersReducedMotion) {
        video.preload = "auto";
        this.preloadedClips.add(idx);
        video.load();
        if (video.readyState >= 1) {
          this.videoReady[idx] = true;
        }
      } else {
        video.preload = "none";
      }
    });

    if (this.stillImages[0]) {
      this.activeMedia = this.stillImages[0];
      this.drawAmbilight();
    }
  }

  private preloadClip(clipIdx: number) {
    if (this.prefersReducedMotion) return;
    if (clipIdx >= 0 && clipIdx < this.videoElements.length && !this.preloadedClips.has(clipIdx)) {
      this.preloadedClips.add(clipIdx);
      const v = this.videoElements[clipIdx];
      if (v) {
        v.preload = "auto";
        v.load();
      }
    }
  }

  private seekVideoSafe(clipIdx: number, targetTime: number) {
    const video = this.videoElements[clipIdx];
    if (!video || this.prefersReducedMotion) return;
    if (!video.duration || isNaN(video.duration)) return;

    const clamped = Math.max(0, Math.min(video.duration - 0.02, targetTime));
    this.pendingSeekTimes[clipIdx] = clamped;

    if (!video.seeking && Math.abs(video.currentTime - clamped) > 0.015) {
      this.pendingSeekTimes[clipIdx] = null;
      try {
        video.currentTime = clamped;
      } catch {
        // Ignorar si el navegador aún no acepta el seek
      }
    }
  }

  private bindEvents() {
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize, { passive: true });

    // Clics en el timeline vertical de la derecha
    this.progressIndicators.forEach((btn, idx) => {
      btn.addEventListener("click", () => this.scrollToStop(idx));
    });

    // Interceptar enlaces de ancla (#recepcion, #comunidad, #restaurante, #bar, #suites) para navegación precisa
    const stopIds = hotelData.scrollWorld.sections.map((s) => s.id);
    document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", (e) => {
        const href = anchor.getAttribute("href");
        if (!href) return;
        const targetId = href.slice(1);
        const stopIdx = stopIds.indexOf(targetId);
        if (stopIdx !== -1) {
          e.preventDefault();
          this.scrollToStop(stopIdx);
        }
      });
    });

    // Escuchar cambio en media queries
    window.matchMedia("(max-width: 1023px)").addEventListener("change", (e) => {
      this.isMobile = e.matches;
      this.updateMediaSources();
    });

    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
      this.prefersReducedMotion = e.matches;
    });

    // Trigger inicial
    this.onScroll();
    this.currentProgress = this.targetProgress;
  }

  private updateMediaSources() {
    const connectors = this.isMobile
      ? hotelData.scrollWorld.connectorsMobile
      : hotelData.scrollWorld.connectors;

    this.videoElements.forEach((video, i) => {
      const targetSrc = connectors[i];
      if (targetSrc && video.getAttribute("src") !== targetSrc) {
        const curTime = video.currentTime;
        this.videoReady[i] = false;
        video.src = targetSrc;
        video.currentTime = curTime;
        if (this.preloadedClips.has(i)) {
          video.load();
        }
      }
    });

    this.stillImages.forEach((img, idx) => {
      if (this.isMobile) {
        img.style.objectPosition =
          hotelData.scrollWorld.sections[idx]?.mobileObjectPosition || "center center";
      } else {
        img.style.objectPosition = "center center";
      }
    });
  }

  private onScroll = () => {
    const rect = this.track.getBoundingClientRect();
    const trackHeight = this.track.offsetHeight;
    const windowHeight = window.innerHeight;

    // Mostrar/ocultar el timeline vertical fijo cuando salimos de ScrollWorld hacia HotelDetails
    if (this.timelineNav) {
      const isInsideTrack = rect.bottom > windowHeight * 0.4 && rect.top < windowHeight * 0.6;
      this.timelineNav.style.opacity = isInsideTrack ? "1" : "0";
      this.timelineNav.style.pointerEvents = isInsideTrack ? "auto" : "none";
    }

    const scrollableDist = trackHeight - windowHeight;
    if (scrollableDist <= 0) {
      this.targetProgress = 0;
      return;
    }

    const currentScrolled = -rect.top;
    const rawProgress = currentScrolled / scrollableDist;
    this.targetProgress = Math.max(0, Math.min(1, rawProgress));
  };

  private onResize = () => {
    this.onScroll();
  };

  public scrollToStop(stopIndex: number) {
    const stopSegment = this.segments.find((s) => s.type === "stop" && s.index === stopIndex);
    if (!stopSegment) return;

    const targetNorm = stopIndex === 0 ? 0 : (stopSegment.start + stopSegment.end) / 2;
    const trackHeight = this.track.offsetHeight;
    const windowHeight = window.innerHeight;
    const scrollableDist = trackHeight - windowHeight;

    const trackTop = this.track.getBoundingClientRect().top + window.scrollY;
    const targetScrollY = trackTop + targetNorm * scrollableDist;

    window.scrollTo({
      top: targetScrollY,
      behavior: "smooth"
    });
  }

  private startLoop() {
    this.lastFrameTime = performance.now();
    const loop = (now: number) => {
      this.tick(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private tick(now: number = performance.now()) {
    const dt = Math.min(0.05, Math.max(0.004, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    // Interpolación suave con límite de velocidad máxima en conectores para que la rueda del ratón
    // nunca salte un conector entero en 2 frames sin reproducir el recorrido de vídeo
    const delta = this.targetProgress - this.currentProgress;
    if (Math.abs(delta) < 0.0004) {
      this.currentProgress = this.targetProgress;
    } else {
      const currentSeg = this.findSegment(this.currentProgress);
      const maxSpeedPerSec = currentSeg?.type === "connector" ? 0.135 : 0.28;
      const maxStep = maxSpeedPerSec * dt;
      const desiredStep = delta * 0.16;
      const clampedStep = Math.sign(desiredStep) * Math.min(Math.abs(desiredStep), maxStep);
      this.currentProgress += clampedStep;
    }

    // Localizar segmento actual
    const seg = this.findSegment(this.currentProgress);
    if (!seg) return;

    if (seg.type === "stop") {
      this.handleStopSegment(seg);
    } else {
      this.handleConnectorSegment(seg);
    }

    // Actualizar Ambilight si existe canvas
    this.drawAmbilight();

    // Actualizar timeline vertical
    this.updateProgressIndicator(seg);
  }

  private findSegment(progress: number): TimelineSegment | null {
    for (const seg of this.segments) {
      if (progress >= seg.start && progress <= seg.end) {
        return seg;
      }
    }
    return this.segments[this.segments.length - 1] || null;
  }

  private handleStopSegment(seg: TimelineSegment) {
    const stopIdx = seg.index;
    this.activeStopIndex = stopIdx;

    // Preload por cercanía del siguiente conector y del anterior
    this.preloadClip(stopIdx);
    if (stopIdx > 0) {
      this.preloadClip(stopIdx - 1);
    }

    // Pre-posicionar el clip siguiente en t=0 (idéntico a stop-k.webp)
    // y el clip anterior en t=duration (idéntico a stop-k.webp) para que al entrar al conector no haya salto hacia atrás
    if (stopIdx < this.videoElements.length) {
      this.seekVideoSafe(stopIdx, 0);
    }
    if (stopIdx > 0) {
      const prevVideo = this.videoElements[stopIdx - 1];
      if (prevVideo && prevVideo.duration && !isNaN(prevVideo.duration)) {
        this.seekVideoSafe(stopIdx - 1, prevVideo.duration - 0.03);
      }
    }

    // Activar únicamente el still de la parada actual al 100%
    this.stillImages.forEach((img, idx) => {
      img.style.opacity = idx === stopIdx ? "1" : "0";
      if (this.isMobile && idx === stopIdx) {
        const pos = hotelData.scrollWorld.sections[stopIdx]?.mobileObjectPosition || "center center";
        img.style.objectPosition = pos;
      }
    });

    // Ocultar todos los vídeos mientras estamos estacionados en la parada
    this.videoElements.forEach((video) => {
      video.style.opacity = "0";
    });

    // Mostrar el texto de la parada actual al 100% sin solapamientos
    this.updateStopNarrative(stopIdx);

    // Media activa
    this.activeMedia = this.stillImages[stopIdx] || null;
  }

  private handleConnectorSegment(seg: TimelineSegment) {
    const connIdx = seg.index; // conecta stopIdx -> stopIdx + 1
    const fromStopIdx = connIdx;
    const toStopIdx = connIdx + 1;

    // Asegurar que el clip actual y el siguiente estén precargados
    this.preloadClip(connIdx);
    this.preloadClip(connIdx + 1);

    // Progreso local dentro del conector (0 a 1)
    const localProgress = Math.max(
      0,
      Math.min(1, (this.currentProgress - seg.start) / (seg.end - seg.start))
    );
    const crossfade = hotelData.scrollWorld.crossfade; // 0.07

    const video = this.videoElements[connIdx];
    const fromStill = this.stillImages[fromStopIdx];
    const toStill = this.stillImages[toStopIdx];

    // Ocultar stills y vídeos que no participan en este conector
    this.stillImages.forEach((img, idx) => {
      if (idx !== fromStopIdx && idx !== toStopIdx) {
        img.style.opacity = "0";
      }
    });
    this.videoElements.forEach((v, idx) => {
      if (idx !== connIdx) {
        v.style.opacity = "0";
      }
    });

    // Sincronizar currentTime del vídeo directamente con localProgress (con cola en evento seeked)
    if (video && video.duration && !isNaN(video.duration)) {
      this.seekVideoSafe(connIdx, localProgress * video.duration);
    }

    // Un único still opaco debajo como respaldo en z-0 (JAMÁS mezclar fromStill y toStill entre sí para evitar doble exposición)
    if (localProgress < 0.5) {
      if (fromStill) fromStill.style.opacity = "1";
      if (toStill) toStill.style.opacity = "0";
    } else {
      if (fromStill) fromStill.style.opacity = "0";
      if (toStill) toStill.style.opacity = "1";
    }

    // Comprobar si el vídeo ya decodificó su primer frame (sin caer a false durante video.seeking)
    const isVideoReady = Boolean(
      !this.prefersReducedMotion &&
        video &&
        (this.videoReady[connIdx] || video.readyState >= 1)
    );

    if (!isVideoReady || !video) {
      this.videoElements.forEach((v) => (v.style.opacity = "0"));
      this.activeMedia = localProgress < 0.5 ? fromStill : toStill;
    } else {
      if (localProgress < crossfade) {
        // Crossfade corto de entrada (0 -> 0.07) sobre fromStill (que es idéntico al frame 0 del vídeo)
        const t = localProgress / crossfade;
        video.style.opacity = String(t);
        this.activeMedia = t > 0.5 ? video : fromStill;
      } else if (localProgress > 1 - crossfade) {
        // Crossfade corto de salida (0.93 -> 1.0) hacia toStill (que es idéntico al último frame del vídeo)
        const t = (localProgress - (1 - crossfade)) / crossfade;
        video.style.opacity = String(1 - t);
        this.activeMedia = t > 0.5 ? toStill : video;
      } else {
        // Tramo central (0.07 -> 0.93): vídeo 100% opaco sin parpadeos durante seeking
        video.style.opacity = "1";
        this.activeMedia = video;
      }

      // Aplicar encuadre móvil al vídeo
      if (this.isMobile) {
        const pos =
          localProgress < 0.5
            ? hotelData.scrollWorld.sections[fromStopIdx]?.mobileObjectPosition || "center center"
            : hotelData.scrollWorld.sections[toStopIdx]?.mobileObjectPosition || "center center";
        video.style.objectPosition = pos;
      } else {
        video.style.objectPosition = "center center";
      }
    }

    // Transición limpia de textos sin solapamiento
    this.updateConnectorNarrative(fromStopIdx, toStopIdx, localProgress);
  }

  private updateStopNarrative(activeIdx: number) {
    this.textSections.forEach((sec, idx) => {
      const isCurrent = idx === activeIdx;
      sec.style.opacity = isCurrent ? "1" : "0";
      sec.style.transform = isCurrent ? "translateY(0px)" : "translateY(14px)";
      sec.style.pointerEvents = isCurrent ? "auto" : "none";
      sec.setAttribute("aria-hidden", isCurrent ? "false" : "true");
    });
  }

  private updateConnectorNarrative(fromIdx: number, toIdx: number, localProgress: number) {
    const fadeOutEnd = 0.18;
    const fadeInStart = 0.82;

    this.textSections.forEach((sec, idx) => {
      if (idx === fromIdx && localProgress <= fadeOutEnd) {
        const p = localProgress / fadeOutEnd; // 0 -> 1
        const alpha = Math.max(0, 1 - p);
        sec.style.opacity = alpha.toFixed(3);
        sec.style.transform = `translateY(${(-p * 12).toFixed(1)}px)`;
        sec.style.pointerEvents = alpha > 0.6 ? "auto" : "none";
        sec.setAttribute("aria-hidden", alpha > 0.1 ? "false" : "true");
      } else if (idx === toIdx && localProgress >= fadeInStart) {
        const p = (localProgress - fadeInStart) / (1 - fadeInStart); // 0 -> 1
        const alpha = Math.min(1, Math.max(0, p));
        sec.style.opacity = alpha.toFixed(3);
        sec.style.transform = `translateY(${((1 - alpha) * 14).toFixed(1)}px)`;
        sec.style.pointerEvents = alpha > 0.6 ? "auto" : "none";
        sec.setAttribute("aria-hidden", alpha > 0.1 ? "false" : "true");
      } else {
        sec.style.opacity = "0";
        sec.style.transform = "translateY(14px)";
        sec.style.pointerEvents = "none";
        sec.setAttribute("aria-hidden", "true");
      }
    });
  }

  private updateProgressIndicator(seg: TimelineSegment) {
    let currentStop = seg.index;
    if (seg.type === "connector") {
      const localProgress = (this.currentProgress - seg.start) / (seg.end - seg.start);
      currentStop = localProgress < 0.5 ? seg.index : seg.index + 1;
    }

    this.progressIndicators.forEach((item, idx) => {
      const isActive = idx === currentStop;
      const dot = item.querySelector<HTMLElement>(".sw-progress-dot");
      const pill = item.querySelector<HTMLElement>(".sw-progress-pill");

      if (dot) {
        if (isActive) {
          dot.classList.add(
            "bg-[#C87D4B]",
            "border-[#C87D4B]",
            "scale-125",
            "shadow-[0_0_12px_rgba(200,125,75,0.85)]"
          );
          dot.classList.remove("bg-[#0F0E0C]", "border-[#F4EFE6]/40");
        } else {
          dot.classList.remove(
            "bg-[#C87D4B]",
            "border-[#C87D4B]",
            "scale-125",
            "shadow-[0_0_12px_rgba(200,125,75,0.85)]"
          );
          dot.classList.add("bg-[#0F0E0C]", "border-[#F4EFE6]/40");
        }
      }

      if (pill) {
        if (isActive) {
          pill.classList.add("opacity-100", "translate-x-0");
          pill.classList.remove("opacity-0", "translate-x-2", "pointer-events-none");
        } else {
          pill.classList.remove("opacity-100", "translate-x-0");
          pill.classList.add("opacity-0", "translate-x-2", "pointer-events-none");
        }
      }
    });
  }

  private drawAmbilight() {
    if (!this.ctx || !this.activeMedia) return;
    try {
      if (
        this.activeMedia instanceof HTMLVideoElement &&
        (this.activeMedia.readyState < 2 || this.activeMedia.seeking)
      ) {
        return;
      }
      this.ctx.drawImage(this.activeMedia, 0, 0, 36, 64);
    } catch (e) {
      // Ignorar si el frame no está decodificado
    }
  }

  public destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);
  }
}
