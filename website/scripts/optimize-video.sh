#!/usr/bin/env bash
# Creates the web variants of a master MP4: WebM (AV1 + VP9) with Opus audio and MP4 (H.264) with AAC audio.
# Usage (in website/): ./scripts/optimize-video.sh [master.mp4]   (default: src/assets/video/colwerk.mp4)
# Output: <name>-av1.webm, <name>-vp9.webm and <name>-h264.mp4 next to the input file.
set -euo pipefail

INPUT="${1:-src/assets/video/colwerk.mp4}"
BASE="${INPUT%.*}"
AUDIO=(-c:a libopus -b:a 64k)
COMMON=(-map_metadata -1 -pix_fmt yuv420p)

# AV1 (SVT-AV1): CRF mode, slow preset for better compression
ffmpeg -hide_banner -loglevel warning -stats -y -i "$INPUT" "${COMMON[@]}" \
  -c:v libsvtav1 -preset 4 -crf 35 -g 240 -svtav1-params tune=0 \
  "${AUDIO[@]}" "$BASE-av1.webm"

# VP9 (libvpx): two-pass constant quality
VP9=(-c:v libvpx-vp9 -crf 33 -b:v 0 -g 240 -deadline good -cpu-used 1 -row-mt 1 -tile-columns 2 -auto-alt-ref 1 -lag-in-frames 25)
ffmpeg -hide_banner -loglevel warning -stats -y -i "$INPUT" "${COMMON[@]}" "${VP9[@]}" -pass 1 -passlogfile "$BASE-vp9" -an -f null /dev/null
ffmpeg -hide_banner -loglevel warning -stats -y -i "$INPUT" "${COMMON[@]}" "${VP9[@]}" -pass 2 -passlogfile "$BASE-vp9" "${AUDIO[@]}" "$BASE-vp9.webm"
rm -f "$BASE-vp9"-*.log

# H.264 fallback: copy the video track as is, only compress the audio; moov atom first for a fast start
ffmpeg -hide_banner -loglevel warning -stats -y -i "$INPUT" -map_metadata -1 -c:v copy -c:a aac -b:a 96k -movflags +faststart "$BASE-h264.mp4"

ls -lh "$INPUT" "$BASE-av1.webm" "$BASE-vp9.webm" "$BASE-h264.mp4"
