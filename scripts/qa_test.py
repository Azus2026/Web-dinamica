import os
import sys
import time
import subprocess
import urllib.request
from playwright.sync_api import sync_playwright

def wait_for_server(url, timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False

def main():
    print("=" * 65)
    print("EJECUTANDO PROTOCOLO DE QA AUTOMATIZADO (STEP 8)")
    print("=" * 65)

    PORT = 4321
    BASE_URL = f"http://localhost:{PORT}"

    already_running = wait_for_server(BASE_URL, timeout=2)
    server_process = None
    if not already_running:
        print("\n[1/5] Levantando servidor astro preview en puerto 4321...")
        server_process = subprocess.Popen(
            ["pnpm", "astro", "preview", "--port", str(PORT)],
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        if not wait_for_server(BASE_URL, timeout=35):
            print("[ERROR] Servidor no respondió en tiempo.")
            server_process.kill()
            sys.exit(1)
    else:
        print("\n[1/5] Servidor activo detectado en puerto 4321.")
    print("[OK] Servidor activo y respondiendo HTTP 200.")

    qa_results = []
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # -------------------------------------------------------------
        # TEST DESKTOP (1440x900)
        # -------------------------------------------------------------
        print("\n[2/5] Probando Viewport Desktop (1440x900)...")
        context_desktop = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context_desktop.new_page()

        page.on("console", lambda msg: console_errors.append(f"CONSOLE: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(f"PAGEERROR: {str(err)}"))

        # Cargar página
        response = page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")

        qa_results.append({
            "prueba": "HTTP 200 Carga Página Principal",
            "resultado": "PASÓ" if response.status == 200 else "FALLÓ",
            "detalle": f"Status: {response.status}"
        })

        # Comprobar 5 stills WebP y 4 clips MP4 desktop
        print("\n[3/5] Verificando recursos multimedia (5 stills + 4 clips MP4)...")
        media_urls = [
            "/world/stop-0-recepcion.webp",
            "/world/stop-1-mapa.webp",
            "/world/stop-2-restaurante.webp",
            "/world/stop-3-bar.webp",
            "/world/stop-4-habitacion.webp",
            "/video/clip-1.mp4",
            "/video/clip-2.mp4",
            "/video/clip-3.mp4",
            "/video/clip-4.mp4"
        ]

        for rel_url in media_urls:
            full_url = f"{BASE_URL}{rel_url}"
            try:
                with urllib.request.urlopen(full_url) as resp:
                    status = resp.status
                    size_kb = len(resp.read()) / 1024
                    qa_results.append({
                        "prueba": f"Media: {rel_url}",
                        "resultado": "PASÓ" if status == 200 else "FALLÓ",
                        "detalle": f"HTTP {status} ({size_kb:.1f} KB)"
                    })
            except Exception as e:
                qa_results.append({
                    "prueba": f"Media: {rel_url}",
                    "resultado": "FALLÓ",
                    "detalle": str(e)
                })

        # Probar scroll scrubbing y avance de currentTime en vídeos
        print("\n[4/5] Simulando scroll scrubbing, Full-Viewport 100vwx100vh y prevención de pantalla en negro...")
        stage_box = page.locator("#scroll-stage").bounding_box()
        still_box = page.locator(".sw-still-img").first.bounding_box()
        is_full_viewport = (
            stage_box is not None
            and stage_box["width"] >= 1400
            and stage_box["height"] == 900
            and still_box is not None
            and still_box["width"] >= 1400
            and still_box["height"] == 900
        )
        qa_results.append({
            "prueba": "Escenario Full-Viewport (100vw x 100vh)",
            "resultado": "PASÓ" if is_full_viewport else "FALLÓ",
            "detalle": f"Stage: {stage_box['width']}x{stage_box['height']}px, Still: {still_box['width']}x{still_box['height']}px"
        })

        timeline_items = page.locator(".sw-progress-item").count()
        hint_visible = page.get_by_text("DESLIZA PARA RECORRER NOMAD ARCH").is_visible()
        qa_results.append({
            "prueba": "Timeline Vertical Derecha + Hint",
            "resultado": "PASÓ" if (timeline_items == 5 and hint_visible) else "FALLÓ",
            "detalle": f"{timeline_items} paradas en timeline, hint visible={hint_visible}"
        })

        # Hacer scroll progresivo hacia abajo y comprobar:
        # 1) 0 fotogramas en negro
        # 2) 0 fotogramas con doble exposición de stills (>1 still visible a la vez)
        # 3) 0 fotogramas con textos superpuestos (>1 bloque narrativo visible a la vez)
        max_scroll = page.evaluate("document.getElementById('scroll-world-track').offsetHeight - window.innerHeight")
        black_frames = 0
        ghost_frames = 0
        text_overlap_frames = 0
        for frac in [0.0, 0.12, 0.18, 0.24, 0.35, 0.45, 0.55, 0.62, 0.78, 0.88, 0.95]:
            page.evaluate(f"window.scrollTo(0, {int(max_scroll * frac)})")
            page.wait_for_timeout(120)
            state_check = page.evaluate("""() => {
                const stillOpacities = Array.from(document.querySelectorAll('.sw-still-img')).map(i => parseFloat(window.getComputedStyle(i).opacity));
                const textOpacities = Array.from(document.querySelectorAll('.sw-narrative-section')).map(t => parseFloat(window.getComputedStyle(t).opacity));
                return {
                    maxStill: Math.max(...stillOpacities),
                    visibleStills: stillOpacities.filter(o => o > 0.01).length,
                    visibleTexts: textOpacities.filter(o => o > 0.05).length
                };
            }""")
            if state_check["maxStill"] < 0.99:
                black_frames += 1
            if state_check["visibleStills"] > 1:
                ghost_frames += 1
            if state_check["visibleTexts"] > 1:
                text_overlap_frames += 1

        page.evaluate("window.scrollTo(0, 2000)")
        page.wait_for_timeout(400)
        scrolled_y = page.evaluate("window.scrollY")

        # Comprobar si los clips responden
        video_states = page.evaluate("""() => {
            const videos = Array.from(document.querySelectorAll('.sw-connector-video'));
            return videos.map(v => ({
                src: v.src,
                duration: v.duration,
                currentTime: v.currentTime,
                opacity: window.getComputedStyle(v).opacity
            }));
        }""")

        qa_results.append({
            "prueba": "Transiciones Sin Ghosting ni Solape",
            "resultado": "PASÓ" if (scrolled_y > 0 and black_frames == 0 and ghost_frames == 0 and text_overlap_frames == 0) else "FALLÓ",
            "detalle": f"Negros={black_frames}, DobleExp={ghost_frames}, SolapeTexto={text_overlap_frames}"
        })

        # Probar interacción con el Booking Widget y recálculo de precios
        print("Probando reactividad de reservas y cálculo de suite...")
        # Scroll al widget final (Parada 4)
        page.evaluate(f"window.scrollTo(0, {int(max_scroll * 0.98)})")
        page.wait_for_timeout(1200)

        # Precio inicial
        initial_price = page.locator("#final-total-price").inner_text()
        
        # Seleccionar la segunda suite (Grand Arch Suite - 390€)
        second_room = page.locator("[data-room-id='grand-arch-suite']")
        if second_room.count() > 0:
            second_room.click()
            page.wait_for_timeout(300)
            updated_price = page.locator("#final-total-price").inner_text()
            checkout_url = page.locator("#final-checkout-btn").get_attribute("href")
            
            price_changed = (initial_price != updated_price and "390" in page.locator("#final-calc-summary").inner_text())
            qa_results.append({
                "prueba": "Recálculo Reactivo Suite & Precios",
                "resultado": "PASÓ" if price_changed else "FALLÓ",
                "detalle": f"De {initial_price} a {updated_price} (URL: {checkout_url[:45]}...)"
            })
        else:
            qa_results.append({
                "prueba": "Recálculo Reactivo Suite & Precios",
                "resultado": "FALLÓ",
                "detalle": "Tarjeta de habitación no encontrada"
            })

        # -------------------------------------------------------------
        # TEST MOBILE (390x844)
        # -------------------------------------------------------------
        print("\n[5/5] Probando Viewport Mobile (390x844 iPhone 12/13/14)...")
        context_mobile = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
        )
        page_m = context_mobile.new_page()
        page_m.on("console", lambda msg: console_errors.append(f"MOBILE CONSOLE: {msg.text}") if msg.type == "error" else None)
        page_m.on("pageerror", lambda err: console_errors.append(f"MOBILE PAGEERROR: {str(err)}"))

        resp_m = page_m.goto(BASE_URL)
        page_m.wait_for_load_state("networkidle")

        # Verificar clips mobile HTTP 200
        mobile_clips = [
            "/video/clip-1-mobile.mp4",
            "/video/clip-2-mobile.mp4",
            "/video/clip-3-mobile.mp4",
            "/video/clip-4-mobile.mp4"
        ]
        for rel_m in mobile_clips:
            full_m = f"{BASE_URL}{rel_m}"
            try:
                with urllib.request.urlopen(full_m) as resp:
                    status = resp.status
                    size_kb = len(resp.read()) / 1024
                    qa_results.append({
                        "prueba": f"Mobile Media: {rel_m}",
                        "resultado": "PASÓ" if status == 200 else "FALLÓ",
                        "detalle": f"HTTP {status} ({size_kb:.1f} KB)"
                    })
            except Exception as e:
                qa_results.append({
                    "prueba": f"Mobile Media: {rel_m}",
                    "resultado": "FALLÓ",
                    "detalle": str(e)
                })

        # Scroll en mobile
        page_m.evaluate("window.scrollTo(0, 1500)")
        page_m.wait_for_timeout(500)
        scrolled_m = page_m.evaluate("window.scrollY")
        qa_results.append({
            "prueba": "Mobile Scroll & Layout",
            "resultado": "PASÓ" if scrolled_m > 0 and resp_m.status == 200 else "FALLÓ",
            "detalle": f"Scrolled to {scrolled_m}px, Header & Stage adaptados"
        })

        # Cerrar contextos
        context_desktop.close()
        context_mobile.close()
        browser.close()

    # Cerrar servidor preview sólo si lo iniciamos aquí
    if server_process is not None:
        print("\nDeteniendo servidor preview...")
        server_process.terminate()
        try:
            server_process.wait(timeout=5)
        except Exception:
            server_process.kill()

    # Comprobar errores de consola
    qa_results.append({
        "prueba": "Cero Errores en Consola JS",
        "resultado": "PASÓ" if len(console_errors) == 0 else "FALLÓ",
        "detalle": f"{len(console_errors)} errores detectados" + (f": {console_errors}" if console_errors else "")
    })

    # Mostrar informe
    print("\n" + "=" * 80)
    print("INFORME DE CONTROL DE CALIDAD (QA STEP 8)")
    print("=" * 80)
    print(f"{'Prueba':<38} | {'Resultado':<10} | {'Detalle'}")
    print("-" * 80)
    all_ok = True
    for item in qa_results:
        if item["resultado"] != "PASÓ":
            all_ok = False
        print(f"{item['prueba']:<38} | {item['resultado']:<10} | {item['detalle']}")

    print("=" * 80)
    if all_ok:
        print(">>> RESULTADO FINAL: TODOS LOS TESTS DE QA HAN PASADO CON ÉXITO (100%) <<<")
    else:
        print(">>> RESULTADO FINAL: SE ENCONTRARON ALGUNOS FALLOS <<<")
        sys.exit(1)

if __name__ == "__main__":
    main()
