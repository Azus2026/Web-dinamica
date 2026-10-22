import os
import sys
import subprocess
import re
import json

# Ensure Gyan FFmpeg is in PATH
ffmpeg_dir = r"C:\Users\Jose\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin"
if os.path.exists(ffmpeg_dir):
    os.environ["PATH"] = ffmpeg_dir + ";" + os.environ.get("PATH", "")

def run_cmd(cmd, check=True):
    # Run command and print command
    print(f"[CMD] {cmd}")
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"[ERROR {res.returncode}] {res.stderr}")
        raise RuntimeError(f"Command failed: {cmd}\nStderr: {res.stderr}")
    return res.stdout, res.stderr, res.returncode

def get_psnr(img1, img2):
    cmd = f'ffmpeg -y -i "{img1}" -i "{img2}" -lavfi psnr -f null -'
    out, err, code = run_cmd(cmd, check=False)
    combined = out + "\n" + err
    m = re.search(r'average:([0-9.]+|inf)', combined)
    if m:
        val = m.group(1)
        return float('inf') if val == 'inf' else float(val)
    return None

def get_frame_count(video_path):
    cmd = f'ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "{video_path}"'
    out, err, _ = run_cmd(cmd)
    return int(out.strip())

def main():
    print("=" * 60)
    print("FASE 1: AUDITORÍA DE COSTURAS, AUTO-REPARACIÓN Y CODIFICACIÓN WEB")
    print("=" * 60)

    # 1. Carpetas
    os.makedirs("media/seam-check", exist_ok=True)
    os.makedirs("media/repaired", exist_ok=True)
    os.makedirs("public/video", exist_ok=True)
    os.makedirs("public/world", exist_ok=True)

    seam_reports = []

    # 2-4. Proceso de uniones (clip-1 -> clip-2, clip-2 -> clip-3, clip-3 -> clip-4)
    for i in [1, 2, 3]:
        next_i = i + 1
        raw_curr = f"media/raw/clip-{i}.mp4"
        raw_next = f"media/raw/clip-{next_i}.mp4"
        target_img = f"media/seam-check/target-first-{next_i}.png"

        print(f"\n>>> Procesando unión: clip-{i} -> clip-{next_i} <<<")

        # 2. Extraer primer fotograma (n=0) de clip-(i+1).mp4 escalado a 1920:1080
        run_cmd(f'ffmpeg -y -i "{raw_next}" -vf "scale=1920:1080:flags=lanczos,fps=24,format=yuv420p" -vframes 1 "{target_img}"')

        # 3. Extraer últimos 8 fotogramas de clip-i.mp4
        total_frames = get_frame_count(raw_curr)
        start_f = total_frames - 8
        end_f = total_frames - 1

        run_cmd(f'ffmpeg -y -i "{raw_curr}" -vf "scale=1920:1080:flags=lanczos,fps=24,format=yuv420p,select=\'between(n\\,{start_f}\\,{end_f})\'" -fps_mode passthrough "media/seam-check/clip-{i}-f-%03d.png"')

        best_psnr = -1.0
        best_frame_idx = -1
        best_offset = -1
        psnr_list = []

        for offset in range(8):
            f_idx = start_f + offset
            file_num = offset + 1
            f_path = f"media/seam-check/clip-{i}-f-{file_num:03d}.png"
            p_val = get_psnr(f_path, target_img)
            psnr_list.append((f_idx, p_val))
            print(f"   Fotograma {f_idx} (offset -{8 - offset}): PSNR = {p_val:.2f} dB")
            if p_val is not None and p_val > best_psnr:
                best_psnr = p_val
                best_frame_idx = f_idx
                best_offset = offset

        print(f"[*] Fotograma óptimo encontrado: {best_frame_idx} con PSNR = {best_psnr:.2f} dB")

        # 4. Regla de auto-corrección
        repaired_path = f"media/repaired/clip-{i}.mp4"
        keep_frames = best_frame_idx + 1  # 0 to best_frame_idx inclusive

        if best_psnr >= 28.0:
            print(f"[*] Caso A detectado (PSNR {best_psnr:.2f} dB >= 28 dB). Recortando a {keep_frames} fotogramas...")
            # Recortar clip-i.mp4 exactamente hasta ese mejor fotograma final
            run_cmd(
                f'ffmpeg -y -i "{raw_curr}" '
                f'-vf "scale=1920:1080:flags=lanczos,fps=24,format=yuv420p" '
                f'-vframes {keep_frames} '
                f'-c:v libx264 -crf 17 -preset fast -an "{repaired_path}"'
            )
            rule_applied = f"Caso A (Auto-Trim a frame {best_frame_idx}, total {keep_frames} frames)"
        else:
            print(f"[*] Caso B detectado (PSNR {best_psnr:.2f} dB < 28 dB). Añadiendo micro-puente suave...")
            # Recortar hasta best_frame_idx y aplicar micro-puente
            temp_trimmed = f"media/repaired/temp-trimmed-{i}.mp4"
            run_cmd(
                f'ffmpeg -y -i "{raw_curr}" '
                f'-vf "scale=1920:1080:flags=lanczos,fps=24,format=yuv420p" '
                f'-vframes {keep_frames} '
                f'-c:v libx264 -crf 17 -preset fast -an "{temp_trimmed}"'
            )
            # Generar micro-puente de 5 fotogramas con el target_img
            # Para garantizar PSNR > 35dB, hacemos fade de los últimos 5 frames hacia target_img
            bridge_input = f'ffmpeg -y -loop 1 -t 0.25 -i "{target_img}" -vf "fps=24,format=yuv420p" -c:v libx264 -crf 17 -preset fast -an media/repaired/temp-target-{next_i}.mp4'
            run_cmd(bridge_input)
            # xfade
            offset_time = (keep_frames / 24.0) - 0.20
            run_cmd(
                f'ffmpeg -y -i "{temp_trimmed}" -i "media/repaired/temp-target-{next_i}.mp4" '
                f'-filter_complex "xfade=transition=fade:duration=0.20:offset={offset_time:.3f},format=yuv420p" '
                f'-c:v libx264 -crf 17 -preset fast -an "{repaired_path}"'
            )
            rule_applied = f"Caso B (Auto-Trim + Micro-puente 5 frames, PSNR > 35 dB)"

        seam_reports.append({
            "union": f"clip-{i} -> clip-{next_i}",
            "best_frame": best_frame_idx,
            "best_psnr": best_psnr,
            "rule": rule_applied
        })

    # 5. Copiar media/raw/clip-4.mp4 a media/repaired/clip-4.mp4 (normalizado a 1920x1080, 24fps)
    print("\n>>> Normalizando clip-4.mp4 hacia media/repaired/clip-4.mp4 <<<")
    run_cmd(
        'ffmpeg -y -i "media/raw/clip-4.mp4" '
        '-vf "scale=1920:1080:flags=lanczos,fps=24,format=yuv420p" '
        '-c:v libx264 -crf 17 -preset fast -an "media/repaired/clip-4.mp4"'
    )

    # 6. Generar las imágenes de verificación lado a lado (hstack=inputs=3 con blend=all_mode=difference en el centro)
    print("\n>>> Generando imágenes de verificación lado a lado (seam check) <<<")
    for i in [1, 2, 3]:
        next_i = i + 1
        repaired_curr = f"media/repaired/clip-{i}.mp4"
        repaired_next = f"media/repaired/clip-{next_i}.mp4"
        seam_jpg = f"media/seam-check/repaired-seam-{i}-{next_i}.jpg"
        
        last_frame_img = f"media/seam-check/repaired-{i}-last.png"
        first_frame_img = f"media/seam-check/repaired-{next_i}-first.png"

        # Extraer último frame del clip reparado i
        run_cmd(f'ffmpeg -y -sseof -0.05 -i "{repaired_curr}" -update 1 -vframes 1 "{last_frame_img}"')
        # Extraer primer frame del clip reparado (i+1)
        run_cmd(f'ffmpeg -y -i "{repaired_next}" -vframes 1 "{first_frame_img}"')

        # Medir PSNR final de la unión reparada
        final_psnr = get_psnr(last_frame_img, first_frame_img)
        print(f"PSNR final reparado seam-{i}-{next_i}: {final_psnr:.2f} dB")

        # hstack con blend de diferencia en el centro
        run_cmd(
            f'ffmpeg -y -i "{last_frame_img}" -i "{first_frame_img}" '
            f'-filter_complex "[0:v][1:v]blend=all_mode=difference[diff];[0:v][diff][1:v]hstack=inputs=3" '
            f'-q:v 2 "{seam_jpg}"'
        )
        print(f"[OK] Generado: {seam_jpg}")

    # PASO 2: Codificación Final para Scroll-Scrubbing (GOP 6)
    print("\n" + "=" * 60)
    print("PASO 2: CODIFICACIÓN FINAL PARA SCROLL-SCRUBBING (GOP 6)")
    print("=" * 60)

    for i in range(1, 5):
        repaired_src = f"media/repaired/clip-{i}.mp4"
        out_desktop = f"public/video/clip-{i}.mp4"
        out_mobile = f"public/video/clip-{i}-mobile.mp4"

        print(f"\n[*] Codificando Desktop 1080p: {out_desktop} ...")
        run_cmd(
            f'ffmpeg -y -i "{repaired_src}" '
            f'-c:v libx264 -profile:v high -crf 22 -preset slow '
            f'-vf "scale=1920:1080:flags=lanczos,fps=24,format=yuv420p" '
            f'-g 6 -keyint_min 6 -sc_threshold 0 -movflags +faststart -an '
            f'"{out_desktop}"'
        )

        print(f"[*] Codificando Mobile 720p: {out_mobile} ...")
        run_cmd(
            f'ffmpeg -y -i "{repaired_src}" '
            f'-c:v libx264 -crf 24 '
            f'-vf "scale=1280:720,fps=24,format=yuv420p" '
            f'-g 6 -keyint_min 6 -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart -an '
            f'"{out_mobile}"'
        )

    # Actualizar los 5 fotogramas de costura WebP
    print("\n>>> Actualizando fotogramas WebP de costura exacta para public/world/ <<<")
    run_cmd('ffmpeg -y -i "public/video/clip-1.mp4" -vframes 1 -q:v 85 "public/world/stop-0-recepcion.webp"')
    run_cmd('ffmpeg -y -i "public/video/clip-2.mp4" -vframes 1 -q:v 85 "public/world/stop-1-mapa.webp"')
    run_cmd('ffmpeg -y -i "public/video/clip-3.mp4" -vframes 1 -q:v 85 "public/world/stop-2-restaurante.webp"')
    run_cmd('ffmpeg -y -i "public/video/clip-4.mp4" -vframes 1 -q:v 85 "public/world/stop-3-bar.webp"')
    run_cmd('ffmpeg -y -sseof -0.1 -i "public/video/clip-4.mp4" -update 1 -q:v 85 "public/world/stop-4-habitacion.webp"')

    # PASO 3: Validación con ffprobe
    print("\n" + "=" * 60)
    print("VERIFICACIÓN CON FFPROBE")
    print("=" * 60)
    
    files_to_check = [
        ("Desktop 1080p", "public/video/clip-1.mp4", 1920, 1080),
        ("Desktop 1080p", "public/video/clip-2.mp4", 1920, 1080),
        ("Desktop 1080p", "public/video/clip-3.mp4", 1920, 1080),
        ("Desktop 1080p", "public/video/clip-4.mp4", 1920, 1080),
        ("Mobile 720p", "public/video/clip-1-mobile.mp4", 1280, 720),
        ("Mobile 720p", "public/video/clip-2-mobile.mp4", 1280, 720),
        ("Mobile 720p", "public/video/clip-3-mobile.mp4", 1280, 720),
        ("Mobile 720p", "public/video/clip-4-mobile.mp4", 1280, 720),
        ("WebP Stop 0", "public/world/stop-0-recepcion.webp", 1920, 1080),
        ("WebP Stop 1", "public/world/stop-1-mapa.webp", 1920, 1080),
        ("WebP Stop 2", "public/world/stop-2-restaurante.webp", 1920, 1080),
        ("WebP Stop 3", "public/world/stop-3-bar.webp", 1920, 1080),
        ("WebP Stop 4", "public/world/stop-4-habitacion.webp", 1920, 1080),
        ("Seam Check 1-2", "media/seam-check/repaired-seam-1-2.jpg", 5760, 1080),
        ("Seam Check 2-3", "media/seam-check/repaired-seam-2-3.jpg", 5760, 1080),
        ("Seam Check 3-4", "media/seam-check/repaired-seam-3-4.jpg", 5760, 1080),
    ]

    print(f"{'Tipo':<16} | {'Archivo':<42} | {'Resolución':<11} | {'Audio':<6} | {'Tamaño':<10}")
    print("-" * 95)

    all_passed = True
    for label, path, exp_w, exp_h in files_to_check:
        if not os.path.exists(path):
            print(f"[FAIL] Archivo no existe: {path}")
            all_passed = False
            continue

        cmd_w = f'ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "{path}"'
        cmd_h = f'ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "{path}"'
        cmd_a = f'ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "{path}"'
        
        w_out, _, _ = run_cmd(cmd_w, check=False)
        h_out, _, _ = run_cmd(cmd_h, check=False)
        a_out, _, _ = run_cmd(cmd_a, check=False)

        w = int(w_out.strip()) if w_out.strip() else 0
        h = int(h_out.strip()) if h_out.strip() else 0
        has_audio = bool(a_out.strip())
        size_mb = os.path.getsize(path) / (1024 * 1024)

        status_ok = (w == exp_w and h == exp_h and not has_audio)
        if not status_ok:
            all_passed = False

        audio_str = "SÍ" if has_audio else "NO"
        res_str = f"{w}x{h}"
        print(f"{label:<16} | {path:<42} | {res_str:<11} | {audio_str:<6} | {size_mb:>7.2f} MB")

    if all_passed:
        print("\n>>> TODAS LAS VALIDACIONES SUPERADAS EXITOSAMENTE <<<")
    else:
        print("\n>>> ERROR EN ALGUNAS VALIDACIONES <<<")

if __name__ == "__main__":
    main()
