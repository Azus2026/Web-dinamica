import os
import subprocess
import re

os.environ["PATH"] = r"C:\Users\Jose\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin;" + os.environ.get("PATH", "")

def run(cmd):
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return res.stdout, res.stderr, res.returncode

def get_psnr(img1, img2):
    cmd = f'ffmpeg -y -i "{img1}" -i "{img2}" -lavfi psnr -f null -'
    out, err, code = run(cmd)
    text = out + "\n" + err
    m = re.search(r'average:([0-9.]+|inf)', text)
    if m:
        val = m.group(1)
        return float('inf') if val == 'inf' else float(val)
    return None

def get_frame_count(video_path):
    cmd = f'ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "{video_path}"'
    out, err, code = run(cmd)
    return int(out.strip())

os.makedirs("media/seam-check", exist_ok=True)
os.makedirs("media/repaired", exist_ok=True)

for i in [1, 2, 3]:
    next_i = i + 1
    clip_curr = f"media/raw/clip-{i}.mp4"
    clip_next = f"media/raw/clip-{next_i}.mp4"
    target_img = f"media/seam-check/target-first-{next_i}.png"
    
    # 1. Extract target first frame
    run(f'ffmpeg -y -i "{clip_next}" -vf "scale=1920:1080:flags=lanczos,fps=24" -vframes 1 "{target_img}"')
    
    # 2. Get total frames of clip_curr
    total_frames = get_frame_count(clip_curr)
    start_f = total_frames - 8
    end_f = total_frames - 1
    
    print(f"\n==========================================")
    print(f"UNION clip-{i} -> clip-{next_i} (total frames: {total_frames})")
    print(f"Evaluating frames {start_f} to {end_f} against target-first-{next_i}.png")
    print(f"==========================================")
    
    # Extract last 8 frames
    run(f'ffmpeg -y -i "{clip_curr}" -vf "scale=1920:1080:flags=lanczos,fps=24,select=\'between(n\\,{start_f}\\,{end_f})\'" -fps_mode passthrough "media/seam-check/clip-{i}-f-%03d.png"')
    
    best_psnr = -1
    best_frame_idx = -1
    best_offset = -1
    
    for offset in range(8):
        f_idx = start_f + offset
        file_idx = offset + 1
        img_path = f"media/seam-check/clip-{i}-f-{file_idx:03d}.png"
        psnr_val = get_psnr(img_path, target_img)
        print(f"  Frame {f_idx} (offset -{8 - offset}): PSNR = {psnr_val:.2f} dB")
        if psnr_val is not None and psnr_val > best_psnr:
            best_psnr = psnr_val
            best_frame_idx = f_idx
            best_offset = offset

    print(f"--> BEST FRAME: {best_frame_idx} with PSNR = {best_psnr:.2f} dB")
